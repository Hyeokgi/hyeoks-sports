// KBO 정규시즌 경기 결과를 시즌 단위로 수집한다.
//
// 소스: 네이버 스포츠 스케줄 API.
//   목록  https://api-gw.sports.naver.com/schedule/games?upperCategoryId=kbaseball&categoryId=kbo
//           &fromDate=&toDate=&page=&size=
//   상세  https://api-gw.sports.naver.com/schedule/games/{gameId}
//
// 과거 오판 기록 두 건을 이 파일에 남겨둔다. 둘 다 "데이터가 없다"가 아니라 "내 호출이 틀렸다"였다.
//   1) measure_baseball.ts는 size만 주고 page를 안 줘서 시즌당 10건만 받았고, 나는 그걸
//      "네이버가 10건만 준다"고 결론냈다. page를 함께 주면 size가 먹는다.
//   2) 1차 수집분 2,365경기는 시범경기·올스타·포스트시즌이 섞여 있었다(팀당 최대 168경기).
//      목록 응답의 게임 객체에는 시리즈 필드가 아예 없어서 "구분자가 없다"고 볼 뻔했으나,
//      상세 응답에는 roundCode가 있다(probe_kbo_series.ts 실측).
//
// 경기 종류 구분 (실측, seed/kbo_series_probe.txt)
//   목록만으로 걸러지는 것 - gameId 앞 4자리가 연도가 아니면 정규시즌이 아니다
//     9999 올스타(2023-07-15 등)  4444 와일드카드  3333 준플레이오프
//     5555 플레이오프            7777 한국시리즈  6666 타이브레이커(2024-10-01)
//   목록만으로는 안 걸러지는 것 - 시범경기도 앞 4자리가 연도다(20230313HTHH02023)
//     상세의 roundCode로만 구분된다: kbo_e 시범 / kbo_r 정규 / kbo_ps_* 포스트시즌
//   그래서 앞자리로 1차로 거른 뒤, 남은 것만 상세를 받아 roundCode == "kbo_r"만 남긴다.
//   날짜로 자르지 않는다 - 개막일이 연도마다 다르고(2023-04-01, 2024-03-23, 2025-03-22)
//   그 경계를 코드에 적어 넣으면 조용히 틀린다.
//
// 상세를 받는 김에 선발투수도 같이 저장한다(homeStarterName/awayStarterName). 야구 승1패
// 사슬의 고리2(사전정보 -> 총득점)가 팀 단위 지표로는 R^2 0.70%에서 끊어졌는데, 선발투수가
// 그 고리를 개선할 유일한 후보다. 나중에 다시 2,600번 긁지 않기 위해 지금 같이 받아둔다.
//
// 실행: npx tsx scripts/fetch_kbo_history.ts [시즌...]   (러너 전용 - 샌드박스는 네이버 차단)
import { writeFileSync } from "node:fs";

const SEASONS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [2023, 2024, 2025];
const PAGE_SIZE = 100;
const CONCURRENCY = 8;
const OUT = "seed/kbo_games.json";
const REGULAR = "kbo_r";

interface Game {
  gameId: string;
  date: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  roundCode: string;
  stadium: string;
  homeStarter: string;
  awayStarter: string;
}

const UA = { "User-Agent": "Mozilla/5.0", Referer: "https://m.sports.naver.com/" };

async function getJson(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

// 목록: page를 끝까지 돈다. "더 안 나올 때까지"가 종료조건이지 페이지 수를 가정하지 않는다.
async function listSeason(year: number): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const url =
      `https://api-gw.sports.naver.com/schedule/games?upperCategoryId=kbaseball&categoryId=kbo` +
      `&fromDate=${year}-03-01&toDate=${year}-11-30&page=${page}&size=${PAGE_SIZE}`;
    const data = await getJson(url);
    const list: any[] = data?.result?.games ?? [];
    out.push(...list);
    if (list.length < PAGE_SIZE) break;
  }
  return out;
}

async function detail(gameId: string): Promise<any> {
  const data = await getJson(`https://api-gw.sports.naver.com/schedule/games/${gameId}`);
  return data?.result?.game ?? null;
}

// 동시성 제한 풀. 2,600건을 한꺼번에 던지지 않는다.
async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function fetchSeason(year: number): Promise<Game[]> {
  const raw = await listSeason(year);

  // 1차: gameId 앞 4자리. 연도가 아니면 올스타/포스트시즌이다.
  const byPrefix = new Map<string, number>();
  for (const g of raw) {
    const p = String(g.gameId).slice(0, 4);
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }
  const dropped = [...byPrefix.entries()].filter(([p]) => p !== String(year));
  console.log(`\n${year}시즌: 목록 ${raw.length}건`);
  console.log(`  앞자리 제외(정규시즌 아님): ${dropped.map(([p, n]) => `${p} ${n}건`).join(" / ") || "(없음)"}`);

  const candidates = raw.filter((g) => String(g.gameId).slice(0, 4) === String(year));

  // 2차: 상세의 roundCode. 시범경기는 앞자리로 안 걸러지므로 여기서만 걸러진다.
  const details = await mapPool(candidates, CONCURRENCY, async (g) => {
    try {
      return { g, d: await detail(String(g.gameId)) };
    } catch (e) {
      console.log(`  ! 상세 실패 ${g.gameId}: ${(e as Error).message}`);
      return { g, d: null };
    }
  });

  const roundSeen = new Map<string, number>();
  let noDetail = 0;
  const games: Game[] = [];
  for (const { g, d } of details) {
    if (!d) { noDetail++; continue; }
    const rc = String(d.roundCode ?? "(없음)");
    roundSeen.set(rc, (roundSeen.get(rc) ?? 0) + 1);
    if (rc !== REGULAR) continue;
    const hs = Number(d.homeTeamScore);
    const as_ = Number(d.awayTeamScore);
    const done = d.statusCode === "RESULT" && !d.cancel;
    if (!done || !Number.isFinite(hs) || !Number.isFinite(as_)) continue;
    games.push({
      gameId: String(d.gameId),
      date: String(d.gameDate),
      home: String(d.homeTeamName),
      away: String(d.awayTeamName),
      hs,
      as: as_,
      roundCode: rc,
      stadium: String(d.stadium ?? ""),
      homeStarter: String(d.homeStarterName ?? ""),
      awayStarter: String(d.awayStarterName ?? ""),
    });
  }
  console.log(`  roundCode 분포: ${[...roundSeen.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" / ")}`);
  if (noDetail) console.log(`  ** 상세를 못 받은 경기 ${noDetail}건 - 그만큼 빠졌다`);

  games.sort((a, b) => (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
  return games;
}

function verify(year: number, games: Game[]): void {
  const perTeam = new Map<string, number>();
  for (const g of games) {
    perTeam.set(g.home, (perTeam.get(g.home) ?? 0) + 1);
    perTeam.set(g.away, (perTeam.get(g.away) ?? 0) + 1);
  }
  const counts = [...perTeam.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  정규시즌 ${games.length}경기 (기준 720)`);
  console.log(`  팀 ${counts.length}개: ${counts.map(([t, n]) => `${t} ${n}`).join(" / ")}`);
  if (games.length) console.log(`  기간: ${games[0].date} ~ ${games.at(-1)!.date}`);

  // 기준에서 벗어나면 조용히 넘기지 않는다. 우천 취소가 끝내 편성되지 않으면
  // 720/144에 못 미칠 수 있으므로 '틀렸다'가 아니라 '얼마나 벗어났나'를 찍는다.
  if (counts.length !== 10) console.log(`  ** 팀이 10개가 아니다(${counts.length}개) - 정규시즌이 아닌 경기가 남았을 수 있다`);
  const off = counts.filter(([, n]) => Math.abs(n - 144) > 3);
  if (off.length) console.log(`  ** 팀당 144에서 3경기 넘게 벗어남: ${off.map(([t, n]) => `${t} ${n}`).join(" / ")}`);
  if (Math.abs(games.length - 720) > 15) console.log(`  ** 총 720에서 15경기 넘게 벗어남`);
  const withStarter = games.filter((g) => g.homeStarter && g.awayStarter).length;
  console.log(`  선발투수 양쪽 확보: ${withStarter}/${games.length}`);
}

async function main() {
  console.log(`KBO 정규시즌 수집: ${SEASONS.join(", ")} 시즌 (roundCode == ${REGULAR})`);
  const all: Game[] = [];
  for (const y of SEASONS) {
    const games = await fetchSeason(y);
    verify(y, games);
    all.push(...games);
  }

  console.log(`\n총 ${all.length}경기`);
  if (all.length === 0) {
    console.log("한 경기도 못 받았다. 커밋하지 않는다.");
    process.exit(1);
  }

  // 승1패 3구간 분포 - MLB(35.7/28.4/35.8)와 비교하기 위한 기준값.
  let w = 0, one = 0, l = 0;
  for (const g of all) {
    const d = g.hs - g.as;
    if (Math.abs(d) === 1) one++;
    else if (d > 0) w++;
    else if (d < 0) l++;
  }
  const n = all.length;
  console.log(`승1패 분포: 승(홈2점차+) ${(w / n * 100).toFixed(1)}% / 1점차 ${(one / n * 100).toFixed(1)}% / 패(원정2점차+) ${(l / n * 100).toFixed(1)}%`);
  console.log(`무승부(동점): ${n - w - one - l}건  <- KBO는 연장 후 무승부가 있다`);
  console.log(`홈 승률: ${(all.filter((g) => g.hs > g.as).length / n * 100).toFixed(2)}%`);

  writeFileSync(OUT, JSON.stringify(all, null, 0));
  console.log(`\n${OUT}에 저장 (${all.length}경기)`);
}

main();
