// 야구토토 승1패가 예측 가능한 종목인지 실측으로 판단하기 위한 조사 스크립트.
//
// 승1패는 축구 승무패와 구조가 다르다. 승무패는 "누가 이기나"를 묻지만 승1패의 "1"은
// "몇 점 차로 끝나나"를 묻는다.
//   승 = 홈팀 2점차 이상 승 / 1 = 1점차 승부(홈·원정 무관) / 패 = 원정팀 2점차 이상 승
// 우리 Elo 모델은 승률만 계산하므로 야구 데이터를 넣어도 "1점차 확률"은 나오지 않는다.
// 그래서 종목을 붙일지 판단하려면 먼저 두 가지를 재야 한다.
//
//   (1) 세 구간의 실제 비율. "1"이 정말 대중 투표(21.7%)보다 흔한가?
//   (2) "1"이 예측 가능한가. 이게 핵심이다 - 1점차 확률이 대진과 무관하게 늘 비슷하다면
//       그 구간은 예측 대상이 아니라 상수이고, 아무리 좋은 모델도 못 맞힌다.
//       전력차 구간별로 1점차 비율이 움직이는지 본다.
//
// === 2026-08-31 실측 결과 (MLB 2023~2025, 7,290경기) ===
//   승(홈 2점차+) 35.6% / 1(1점차) 28.3% / 패(원정 2점차+) 36.1%
//   -> 가장 흔한 구간만 찍었을 때 상한 36.1%. 축구 승무패 모델 실측(EPL 52.4%)과 큰 격차.
//
//   1점차 비율의 전력차 구간별 값 (승률차 워크포워드, n=6,965):
//     0~5% 30.1% / 5~10% 26.5% / 10~15% 28.4% / 15~25% 27.5% / 25%+ 29.0%
//     카이제곱 chi2=7.49, df=4, p=0.112 -> 구간별 차이를 찾을 수 없음. 단조 추세도 없음.
//   대조) 축구 무승부는 같은 방식에서 29.5% -> 21.5%로 8.0%p 단조 감소가 뚜렷하고,
//   그래서 drawCurve.ts의 closenessAdjustedDrawRate가 성립한다.
//
//   결론: "1"은 예측 대상이 아니라 사실상 상수(~28%)다. 전력을 아무리 잘 모델링해도
//   이 구간은 못 가른다. 게다가 28%가 상수로 묶여 있어 어떤 대진에서도 최대 확신도가
//   눌린다(남은 72%를 승/패가 나눠 가짐). 헤지 우선순위도 근거가 없다 - 축구는 팽팽한
//   경기일수록 무승부가 잦아 "어디를 덮을지" 신호가 있지만, 야구 1점차는 어느 경기나 균일하다.
//
//   KBO는 측정 실패. 네이버 API가 size 파라미터와 무관하게 시즌당 10건만 반환해
//   3시즌 합쳐 25경기밖에 못 모았다(위 결론은 MLB만 근거). KBO를 재려면 다른 소스가 필요하다.
//
// 실행: npx tsx scripts/measure_baseball.ts   (러너 전용 - 샌드박스는 외부 접근 차단)
const UA = { "User-Agent": "Mozilla/5.0" };
const TIMEOUT_MS = 20000;

interface Game {
  date: string; // YYYY-MM-DD
  home: string;
  away: string;
  hs: number;
  as: number;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- MLB: statsapi.mlb.com (공개 API, 키 불필요) ---
async function fetchMlbSeason(year: number): Promise<Game[]> {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R` +
    `&startDate=${year}-03-01&endDate=${year}-11-10` +
    `&fields=dates,date,games,status,detailedState,teams,home,away,score,team,name`;
  const data = await getJson(url);
  const out: Game[] = [];
  for (const d of data?.dates ?? []) {
    for (const g of d.games ?? []) {
      if (g?.status?.detailedState !== "Final") continue;
      const h = g?.teams?.home, a = g?.teams?.away;
      if (typeof h?.score !== "number" || typeof a?.score !== "number") continue;
      out.push({ date: d.date, home: h.team?.name ?? "?", away: a.team?.name ?? "?", hs: h.score, as: a.score });
    }
  }
  return out;
}

// --- KBO: 네이버 스포츠 공개 스케줄 API ---
// 응답 구조를 추측하지 않고, 못 뽑으면 그렇다고 찍고 넘어간다(축구 쪽에서 자작 파싱이
// "배당 0건"을 "배당 없음"으로 오판할 뻔한 적이 있어 같은 실수를 반복하지 않는다).
async function fetchKboSeason(year: number): Promise<{ games: Game[]; note: string }> {
  const url =
    `https://api-gw.sports.naver.com/schedule/games?upperCategoryId=kbaseball&categoryId=kbo` +
    `&fromDate=${year}-03-01&toDate=${year}-11-10&size=2000`;
  let data: any;
  try {
    data = await getJson(url);
  } catch (e) {
    return { games: [], note: `조회 실패: ${(e as Error).message}` };
  }
  const list: any[] = data?.result?.games ?? data?.games ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    return { games: [], note: `응답은 받았으나 경기 배열을 못 찾음. 최상위 키: ${Object.keys(data ?? {}).join(",")}` };
  }
  const out: Game[] = [];
  let skipped = 0;
  for (const g of list) {
    const hs = Number(g.homeTeamScore), as_ = Number(g.awayTeamScore);
    const done = g.statusCode === "RESULT" || g.statusInfo === "종료";
    if (!done || !Number.isFinite(hs) || !Number.isFinite(as_)) { skipped++; continue; }
    out.push({
      date: String(g.gameDate ?? g.gmkey ?? "").slice(0, 10).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
      home: g.homeTeamName ?? g.hFullName ?? "?", away: g.awayTeamName ?? g.aFullName ?? "?",
      hs, as: as_,
    });
  }
  return { games: out, note: `전체 ${list.length}건 중 종료·스코어 확보 ${out.length}건(스킵 ${skipped})` };
}

// --- 분석 ---
type Bucket = "승" | "1" | "패";
const bucketOf = (g: Game): Bucket => {
  const d = g.hs - g.as;
  if (Math.abs(d) === 1) return "1";
  return d > 0 ? "승" : "패";
};

function analyze(label: string, games: Game[]): void {
  if (games.length === 0) { console.log(`\n### ${label}: 데이터 없음 - 분석 생략`); return; }
  console.log(`\n${"=".repeat(64)}`);
  console.log(`### ${label}  (${games.length}경기)`);
  console.log("=".repeat(64));

  const cnt: Record<Bucket, number> = { "승": 0, "1": 0, "패": 0 };
  let tie = 0;
  for (const g of games) { if (g.hs === g.as) tie++; cnt[bucketOf(g)]++; }
  const n = games.length;
  console.log(`\n[승1패 3구간 실제 비율]`);
  for (const b of ["승", "1", "패"] as Bucket[]) {
    console.log(`  ${b}: ${String(cnt[b]).padStart(5)}경기  ${(cnt[b] / n * 100).toFixed(1)}%`);
  }
  if (tie > 0) console.log(`  (무승부 ${tie}경기 - 0점차는 위 분류에서 홈 '패'로 들어감, 주의)`);
  console.log(`  -> 가장 흔한 구간만 계속 찍었을 때 적중률: ${(Math.max(...Object.values(cnt)) / n * 100).toFixed(1)}%`);

  // 점수차 분포
  const diff = new Map<number, number>();
  for (const g of games) { const d = Math.abs(g.hs - g.as); diff.set(d, (diff.get(d) ?? 0) + 1); }
  const top = [...diff.entries()].sort((a, b) => a[0] - b[0]).slice(0, 8);
  console.log(`\n[점수차 분포] ${top.map(([d, c]) => `${d}점차 ${(c / n * 100).toFixed(1)}%`).join(" / ")}`);

  // 핵심: 1점차 비율이 전력차에 따라 움직이는가 (워크포워드 승률차, 누수 없음)
  const wins = new Map<string, number>(), played = new Map<string, number>();
  const rows: { gap: number; b: Bucket }[] = [];
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));
  const WARMUP = 20;
  for (const g of sorted) {
    const hp = played.get(g.home) ?? 0, ap = played.get(g.away) ?? 0;
    if (hp >= WARMUP && ap >= WARMUP) {
      const hw = (wins.get(g.home) ?? 0) / hp, aw = (wins.get(g.away) ?? 0) / ap;
      rows.push({ gap: Math.abs(hw - aw), b: bucketOf(g) });
    }
    played.set(g.home, hp + 1); played.set(g.away, ap + 1);
    if (g.hs > g.as) wins.set(g.home, (wins.get(g.home) ?? 0) + 1);
    else if (g.as > g.hs) wins.set(g.away, (wins.get(g.away) ?? 0) + 1);
  }
  console.log(`\n[1점차 비율이 전력차에 따라 움직이는가]  (승률차 워크포워드, 팀당 ${WARMUP}경기 이후 ${rows.length}경기)`);
  const edges = [0, 0.05, 0.10, 0.15, 0.25, 1.01];
  for (let i = 0; i < edges.length - 1; i++) {
    const g = rows.filter((r) => r.gap >= edges[i] && r.gap < edges[i + 1]);
    if (g.length < 30) continue;
    const one = g.filter((r) => r.b === "1").length;
    console.log(`  승률차 ${(edges[i] * 100).toFixed(0).padStart(2)}~${(edges[i + 1] * 100).toFixed(0).padStart(3)}%: ` +
      `1점차 ${(one / g.length * 100).toFixed(1)}%  (n=${g.length})`);
  }
  const allOne = rows.filter((r) => r.b === "1").length / Math.max(rows.length, 1);
  console.log(`  전체 평균 1점차 ${(allOne * 100).toFixed(1)}%`);
}

async function main() {
  const YEARS = [2023, 2024, 2025];
  console.log(`야구토토 승1패 예측 가능성 조사 (대상 시즌 ${YEARS.join(", ")})`);

  const mlb: Game[] = [];
  for (const y of YEARS) {
    try {
      const g = await fetchMlbSeason(y);
      console.log(`  MLB ${y}: ${g.length}경기`);
      mlb.push(...g);
    } catch (e) {
      console.log(`  MLB ${y}: 실패 - ${(e as Error).message}`);
    }
  }
  const kbo: Game[] = [];
  for (const y of YEARS) {
    const { games, note } = await fetchKboSeason(y);
    console.log(`  KBO ${y}: ${games.length}경기  (${note})`);
    kbo.push(...games);
  }

  analyze("MLB", mlb);
  analyze("KBO", kbo);

  console.log(`\n${"=".repeat(64)}`);
  console.log("### 축구 승무패와 비교 (우리 실측)");
  console.log("=".repeat(64));
  console.log("  축구 1~41회차 574경기: 승 37.8% / 무 26.8% / 패 34.8%");
  console.log("  축구 모델 실측 적중률: EPL 52.4%, 세리에A 52.3%, K리그 42.8%");
  console.log("  -> 위 야구 수치의 '가장 흔한 구간만 찍기'와 비교하면 출발선 차이를 알 수 있다.");
}

main().catch((e) => { console.error(e); process.exit(1); });
