// 야구 지표 기반 시스템이 승패/승1패에 실제로 쓸모가 있는지 실측.
//
// 앞선 measure_baseball.ts는 "전력차로 1점차를 예측할 수 있는가"를 물었고 답은 아니오였다
// (MLB 7,290경기, 전력차 구간별 1점차 비율 30.1/26.5/28.4/27.5/29.0%, chi2=7.49 p=0.112).
// 그런데 세이버메트릭스 지표가 겨냥하는 경로는 그게 아니다. 다른 메커니즘이 하나 있다.
//
//   1점차 승부는 "전력이 비슷해서" 나오는 게 아니라 "점수가 적게 나서" 나온다.
//   2-1 경기는 1점차가 되기 쉽고 9-4 경기는 어렵다. 그리고 총득점은 선발투수·구장·타선처럼
//   야구가 객관적으로 잘 재는 것들로 예측이 되는 영역이다.
//
// 그래서 사슬을 나눠서 각 고리를 따로 잰다. 어느 고리가 끊어지는지 알아야 판단이 된다.
//   고리1  총득점 -> 1점차 확률          (구조적으로 성립하는가)
//   고리2  사전정보 -> 총득점            (예측이 되는가)
//   고리3  둘을 이어 승1패가 실제로 개선되는가  (4분할 홀드아웃)
//   참고   승패(2택)는 어디까지 가는가    (축구 승무패와 같은 잣대로)
//
// 고리2의 사전정보로는 팀 득점환경(최근 N경기 득점/실점)을 쓴다. 선발투수 기반 모델보다
// 약하지만, 이건 "메커니즘이 살아 있는가"를 보는 1차 검증이다 - 팀 단위로도 신호가 전혀
// 없으면 더 정교한 지표를 붙일 이유가 없고, 신호가 있으면 그때 선발투수 파이프라인을
// 만들 근거가 생긴다. 마지막에 statsapi가 과거 선발투수를 실제로 주는지도 같이 확인한다.
//
// 실행: npx tsx scripts/measure_baseball_sabr.ts   (러너 전용 - 샌드박스는 외부 접근 차단)
const UA = { "User-Agent": "Mozilla/5.0" };
const TIMEOUT_MS = 30000;
const SEASONS = [2023, 2024, 2025];
const WARMUP = 20; // 팀당 이만큼 치른 뒤부터 평가
const SPLITS = [0.5, 0.6, 0.7, 0.8];

interface Game {
  date: string;
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

async function fetchSeason(year: number): Promise<Game[]> {
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

const isOneRun = (g: Game) => Math.abs(g.hs - g.as) === 1;
const total = (g: Game) => g.hs + g.as;

// 워크포워드 상태: 팀별 득점/실점 이력과 Elo
interface Ctx {
  g: Game;
  expTotal: number;   // 사전정보로 만든 총득점 기대값
  eloDiff: number;
  outcome3: 0 | 1 | 2; // 승(홈 2점차+) / 1(1점차) / 패(원정 2점차+)
  homeWin: 0 | 1;
}

function buildContexts(games: Game[]): { ctx: Ctx[]; leagueAvgTotal: number } {
  const rs = new Map<string, number[]>(); // 득점 이력
  const ra = new Map<string, number[]>(); // 실점 이력
  const elo = new Map<string, number>();
  const cnt = new Map<string, number>();
  const K = 6; // 야구는 경기수가 많고 경기당 정보량이 적어 K를 작게 둔다
  const HOME_ADV = 24; // 실측 홈승률 약 54% -> Elo 점수 환산 근사치

  const leagueAvgTotal = games.reduce((s, g) => s + total(g), 0) / games.length;
  const out: Ctx[] = [];

  for (const g of games) {
    const h = g.home, a = g.away;
    const he = elo.get(h) ?? 1500, ae = elo.get(a) ?? 1500;

    if ((cnt.get(h) ?? 0) >= WARMUP && (cnt.get(a) ?? 0) >= WARMUP) {
      // 기대 총득점 = (홈 공격력 + 원정 수비력) + (원정 공격력 + 홈 수비력)
      // 최근 20경기 평균을 리그 평균에 대한 비율로 보정한 단순 가법 모형.
      const mean = (xs: number[] | undefined) => {
        const l = (xs ?? []).slice(-20);
        return l.length ? l.reduce((s, x) => s + x, 0) / l.length : leagueAvgTotal / 2;
      };
      const expTotal = (mean(rs.get(h)) + mean(ra.get(a))) / 2 + (mean(rs.get(a)) + mean(ra.get(h))) / 2;
      const d = g.hs - g.as;
      out.push({
        g,
        expTotal,
        eloDiff: he - ae,
        outcome3: Math.abs(d) === 1 ? 1 : d > 0 ? 0 : 2,
        homeWin: d > 0 ? 1 : 0,
      });
    }

    // 상태 갱신
    const exp = 1 / (1 + 10 ** (-(he - ae + HOME_ADV) / 400));
    const sc = g.hs > g.as ? 1 : 0;
    elo.set(h, he + K * (sc - exp));
    elo.set(a, ae - K * (sc - exp));
    for (const [k, f, ag] of [[h, g.hs, g.as], [a, g.as, g.hs]] as [string, number, number][]) {
      const x = rs.get(k) ?? []; x.push(f); rs.set(k, x);
      const y = ra.get(k) ?? []; y.push(ag); ra.set(k, y);
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
    }
  }
  return { ctx: out, leagueAvgTotal };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}

async function probeProbablePitcher(): Promise<void> {
  console.log("\n" + "=".repeat(72));
  console.log("참고 조사: statsapi가 과거 경기의 선발투수를 주는가");
  console.log("=".repeat(72));
  console.log("(팀 득점환경보다 강한 예측자다. 고리2가 살아 있다면 다음 단계에서 필요하다.)");
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=2024-07-01&endDate=2024-07-02` +
    `&hydrate=probablePitcher`;
  try {
    const data = await getJson(url);
    const games = (data?.dates ?? []).flatMap((d: any) => d.games ?? []);
    console.log(`2024-07-01~02 경기 ${games.length}건 조회`);
    let withPitcher = 0;
    for (const g of games) {
      if (g?.teams?.home?.probablePitcher?.id && g?.teams?.away?.probablePitcher?.id) withPitcher++;
    }
    console.log(`선발투수 양팀 모두 확보: ${withPitcher}/${games.length}`);
    const s = games[0];
    if (s) {
      console.log(`샘플: ${s.teams?.away?.probablePitcher?.fullName ?? "(없음)"} vs ${s.teams?.home?.probablePitcher?.fullName ?? "(없음)"}`);
    }
    console.log(withPitcher > 0
      ? "-> 과거 선발투수를 준다. 선발 기반 모델을 만들 수 있다."
      : "-> 과거 경기에는 안 채워준다. 선발 기반 모델은 다른 소스가 필요하다.");
  } catch (e) {
    console.log(`조회 실패: ${(e as Error).message} -> 판정 불가`);
  }
}

async function main() {
  console.log("MLB 수집 중...");
  const games: Game[] = [];
  for (const y of SEASONS) {
    try {
      const g = await fetchSeason(y);
      console.log(`  ${y}: ${g.length}경기`);
      games.push(...g);
    } catch (e) {
      console.log(`  ${y}: 실패 ${(e as Error).message}`);
    }
  }
  games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  console.log(`총 ${games.length}경기\n`);
  if (games.length === 0) { console.log("데이터 없음. 결론 내지 말 것."); process.exit(1); }

  const { ctx, leagueAvgTotal } = buildContexts(games);
  const baseOneRun = ctx.filter((c) => c.outcome3 === 1).length / ctx.length;
  console.log(`평가 대상 ${ctx.length}경기 (팀당 ${WARMUP}경기 워밍업 이후)`);
  console.log(`리그 평균 총득점 ${leagueAvgTotal.toFixed(2)}, 1점차 비율 ${(baseOneRun * 100).toFixed(1)}%\n`);

  // ── 고리1: 총득점 -> 1점차 확률 ───────────────────────────────────────────
  console.log("=".repeat(72));
  console.log("고리1  실제 총득점별 1점차 비율  (이 고리가 죽어 있으면 나머지는 볼 필요 없다)");
  console.log("=".repeat(72));
  const totBuckets: [number, number, string][] = [
    [0, 5.5, "5점 이하"], [5.5, 7.5, "6~7점"], [7.5, 9.5, "8~9점"],
    [9.5, 12.5, "10~12점"], [12.5, 99, "13점 이상"],
  ];
  console.log("총득점       n      1점차 비율");
  for (const [lo, hi, label] of totBuckets) {
    const g = ctx.filter((c) => total(c.g) > lo && total(c.g) <= hi);
    if (!g.length) continue;
    const p = g.filter((c) => c.outcome3 === 1).length / g.length;
    const bar = "█".repeat(Math.round(p * 60));
    console.log(`${label.padEnd(11)} ${String(g.length).padStart(5)}   ${(p * 100).toFixed(1)}%  ${bar}`);
  }
  console.log("\n대조) 전력차로 갈랐을 때는 30.1/26.5/28.4/27.5/29.0% 로 평평했다(p=0.112).");

  // ── 고리2: 사전정보 -> 총득점 ────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("고리2  경기 전 정보로 총득점을 예측할 수 있는가");
  console.log("=".repeat(72));
  const r2 = pearson(ctx.map((c) => c.expTotal), ctx.map((c) => total(c.g)));
  const t2 = Math.abs(r2) * Math.sqrt((ctx.length - 2) / (1 - r2 * r2));
  console.log(`기대총득점 vs 실제총득점  r = ${r2 >= 0 ? "+" : ""}${r2.toFixed(4)}  |t| = ${t2.toFixed(2)}  (설명력 R^2 = ${(r2 * r2 * 100).toFixed(2)}%)`);
  console.log("\n기대총득점 구간별 실제값:");
  const sorted = [...ctx].sort((a, b) => a.expTotal - b.expTotal);
  const q = Math.floor(sorted.length / 5);
  console.log("5분위        n     기대총득점  실제총득점  1점차 비율");
  for (let i = 0; i < 5; i++) {
    const g = sorted.slice(i * q, i === 4 ? sorted.length : (i + 1) * q);
    const e = g.reduce((s, c) => s + c.expTotal, 0) / g.length;
    const a = g.reduce((s, c) => s + total(c.g), 0) / g.length;
    const p = g.filter((c) => c.outcome3 === 1).length / g.length;
    console.log(`${(i + 1) + "분위"}       ${String(g.length).padStart(5)}   ${e.toFixed(2)}       ${a.toFixed(2)}       ${(p * 100).toFixed(1)}%`);
  }

  // ── 고리3: 이어붙였을 때 승1패가 실제로 개선되는가 ──────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("고리3  기대총득점을 넣어 승1패 3택을 예측 (4분할 홀드아웃)");
  console.log("=".repeat(72));
  console.log("모형: P(1) = 기대총득점의 선형함수, 나머지를 Elo 승률로 승/패에 배분.");
  console.log("train에서 계수를 고르고 test에서만 평가한다.\n");

  const predict3 = (c: Ctx, a: number, b: number): [number, number, number] => {
    const p1 = Math.min(0.6, Math.max(0.05, a + b * (c.expTotal - leagueAvgTotal)));
    const pHomeRaw = 1 / (1 + 10 ** (-(c.eloDiff + 24) / 400));
    return [pHomeRaw * (1 - p1), p1, (1 - pHomeRaw) * (1 - p1)];
  };
  const score = (items: Ctx[], a: number, b: number) => {
    let hit = 0, brier = 0, ll = 0;
    for (const c of items) {
      const p = predict3(c, a, b);
      if (p.indexOf(Math.max(...p)) === c.outcome3) hit++;
      for (let i = 0; i < 3; i++) brier += (p[i] - (i === c.outcome3 ? 1 : 0)) ** 2;
      ll -= Math.log(Math.max(p[c.outcome3], 1e-12));
    }
    return { acc: hit / items.length, brier: brier / items.length, ll: ll / items.length };
  };

  console.log("분할  train/test    (a,b)          적중률(b=0 -> 튜닝)   Brier              로그손실");
  let pass = 0;
  for (const frac of SPLITS) {
    const cut = Math.floor(ctx.length * frac);
    const train = ctx.slice(0, cut), test = ctx.slice(cut);
    const aBase = train.filter((c) => c.outcome3 === 1).length / train.length;
    let bb = 0, bll = Infinity;
    for (let b = -0.06; b <= 0.06001; b += 0.002) {
      const s = score(train, aBase, b);
      if (s.ll < bll) { bll = s.ll; bb = b; }
    }
    const base = score(test, aBase, 0), tuned = score(test, aBase, bb);
    const ok = tuned.acc >= base.acc && tuned.brier <= base.brier && tuned.ll <= base.ll;
    if (ok) pass++;
    console.log(
      `${frac.toFixed(1)}  ${String(train.length).padStart(5)}/${String(test.length).padEnd(5)}  ` +
        `(${aBase.toFixed(3)},${bb >= 0 ? "+" : ""}${bb.toFixed(3)})   ` +
        `${(base.acc * 100).toFixed(2)}->${(tuned.acc * 100).toFixed(2)}%      ` +
        `${base.brier.toFixed(4)}->${tuned.brier.toFixed(4)}   ` +
        `${base.ll.toFixed(4)}->${tuned.ll.toFixed(4)}   ${ok ? "통과" : "실패"}`,
    );
  }
  console.log(`=> ${pass}/4 통과.`);
  console.log(`참고: 무조건 가장 흔한 구간만 찍으면 적중률 상한은 아래 '승/1/패 최대 구간'이다.`);
  const c3 = [0, 1, 2].map((o) => ctx.filter((c) => c.outcome3 === o).length / ctx.length);
  console.log(`  승 ${(c3[0] * 100).toFixed(1)}% / 1 ${(c3[1] * 100).toFixed(1)}% / 패 ${(c3[2] * 100).toFixed(1)}%  -> 상한 ${(Math.max(...c3) * 100).toFixed(1)}%`);

  // ── 상한: 총득점을 완벽하게 안다면 승1패는 어디까지 가는가 ──────────────
  // 고리2를 아무리 잘 만들어도 넘을 수 없는 천장이다. 이 값이 낮으면 선발투수든
  // Statcast든 더 좋은 예측자를 붙이는 것 자체가 의미가 없다.
  // 계산: 실제 총득점 구간별로 승/1/패 중 가장 흔한 것을 "미리 알고" 찍었을 때의 적중률.
  // (실제로는 총득점을 완벽히 알 수 없으므로 도달 불가능한 상한이다.)
  console.log("\n" + "=".repeat(72));
  console.log("상한  총득점을 완벽하게 안다고 가정했을 때 승1패 적중률");
  console.log("=".repeat(72));
  let ceilHit = 0;
  console.log("총득점       n      승     1점차   패     최적픽   그 구간 적중률");
  for (const [lo, hi, label] of totBuckets) {
    const g = ctx.filter((c) => total(c.g) > lo && total(c.g) <= hi);
    if (!g.length) continue;
    const c = [0, 1, 2].map((o) => g.filter((x) => x.outcome3 === o).length);
    const best = c.indexOf(Math.max(...c));
    ceilHit += c[best];
    const nm = ["승", "1", "패"][best];
    console.log(
      `${label.padEnd(11)} ${String(g.length).padStart(5)}  ` +
        c.map((x) => ((x / g.length) * 100).toFixed(1).padStart(5) + "%").join(" ") +
        `   ${nm}      ${((c[best] / g.length) * 100).toFixed(1)}%`,
    );
  }
  const ceil = ceilHit / ctx.length;
  const baseCeil = Math.max(...[0, 1, 2].map((o) => ctx.filter((c) => c.outcome3 === o).length)) / ctx.length;
  console.log(`\n총득점을 완벽히 알 때 상한: ${(ceil * 100).toFixed(1)}%`);
  console.log(`총득점을 전혀 모를 때(최빈 구간만 찍기): ${(baseCeil * 100).toFixed(1)}%`);
  console.log(`-> 완벽한 총득점 예측이 벌어주는 최대치는 ${((ceil - baseCeil) * 100).toFixed(1)}%p다.`);
  console.log(`   현재 팀 득점환경의 설명력은 R^2 = ${(r2 * r2 * 100).toFixed(2)}%. 선발투수를 넣어`);
  console.log(`   이걸 크게 끌어올린다 해도 위 ${((ceil - baseCeil) * 100).toFixed(1)}%p 중 그 비율만큼만 가져온다.`);

  // ── 참고: 승패 2택은 어디까지 가는가 ────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("참고  승패 2택 (무승부 없음) - Elo가 어디까지 가는가");
  console.log("=".repeat(72));
  console.log("분할  train/test    적중률   Brier    로그손실");
  for (const frac of SPLITS) {
    const cut = Math.floor(ctx.length * frac);
    const test = ctx.slice(cut);
    let hit = 0, brier = 0, ll = 0;
    for (const c of test) {
      const p = 1 / (1 + 10 ** (-(c.eloDiff + 24) / 400));
      if ((p > 0.5 ? 1 : 0) === c.homeWin) hit++;
      brier += (p - c.homeWin) ** 2;
      ll -= Math.log(Math.max(c.homeWin ? p : 1 - p, 1e-12));
    }
    const n = test.length;
    console.log(`${frac.toFixed(1)}  ${String(cut).padStart(5)}/${String(n).padEnd(5)}   ${((hit / n) * 100).toFixed(2)}%  ${(brier / n).toFixed(4)}  ${(ll / n).toFixed(4)}`);
  }
  const homeWinRate = ctx.filter((c) => c.homeWin === 1).length / ctx.length;
  console.log(`\n무조건 홈승 기준선: ${(homeWinRate * 100).toFixed(2)}%`);
  console.log("대조) 축구 승무패에서 우리 모델은 4분할 51.07~52.46%, 배당은 53.32~54.61%였다.");
  console.log("      단 축구는 3택이라 무작위 33.3%가 기준이고 야구 승패는 2택이라 50%가 기준이다.");

  await probeProbablePitcher();
}

main();
