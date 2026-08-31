// KBO 경기 결과를 시즌 단위로 수집한다.
//
// 소스: 네이버 스포츠 스케줄 API.
//   https://api-gw.sports.naver.com/schedule/games?upperCategoryId=kbaseball&categoryId=kbo
//     &fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&page=N&size=M
//
// 중요(과거 오판 기록): 앞서 measure_baseball.ts는 size=2000만 넣고 page를 안 줘서
// 시즌당 10건만 받았고, 나는 그걸 "네이버가 10건만 준다"고 결론냈다. 틀렸다.
// size는 page 없이는 무시되고, page를 주면 size가 먹는다(probe_kbo_source.ts 실측:
// size=2000 -> 10건 / page=1&size=100 -> 100건). API의 한계가 아니라 내 호출이 문제였다.
//
// 그래서 이 수집기는 "몇 건이 와야 맞는지"를 스스로 검증한다.
//   - page를 끝까지 돌려 더 안 나올 때까지 받는다
//   - gameId로 중복 제거(더블헤더가 같은 날 같은 팀으로 두 번 잡히는 것을 잃지 않기 위해
//     날짜+팀이 아니라 gameId를 키로 쓴다)
//   - 시즌별 수집량과 팀별 경기수를 찍어, 정규시즌 예상치(팀당 144경기)와 어긋나면 드러나게 한다
//
// 실행: npx tsx scripts/fetch_kbo_history.ts [시즌...]   (러너 전용 - 샌드박스는 네이버 차단)
import { writeFileSync } from "node:fs";

const SEASONS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [2023, 2024, 2025];
const PAGE_SIZE = 100;
const OUT = "seed/kbo_games.json";

interface Game {
  gameId: string;
  date: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  status: string;
}

async function getPage(from: string, to: string, page: number): Promise<any> {
  const url =
    `https://api-gw.sports.naver.com/schedule/games?upperCategoryId=kbaseball&categoryId=kbo` +
    `&fromDate=${from}&toDate=${to}&page=${page}&size=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://m.sports.naver.com/" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let dumpedKeys = false;
const seriesSeen = new Map<string, number>();

async function fetchSeason(year: number): Promise<{ games: Game[]; pages: number; raw: number }> {
  const byId = new Map<string, Game>();
  let page = 1;
  let raw = 0;
  // 페이지를 끝까지 돈다. "더 안 나올 때까지"가 종료조건이지, 페이지 수를 가정하지 않는다.
  for (;;) {
    let data: any;
    try {
      data = await getPage(`${year}-03-01`, `${year}-11-30`, page);
    } catch (e) {
      console.log(`  ! ${year} page ${page} 실패: ${(e as Error).message}`);
      break;
    }
    const list: any[] = data?.result?.games ?? [];
    raw += list.length;
    if (!dumpedKeys && list.length) {
      dumpedKeys = true;
      console.log(`  [필드 확인] 게임 객체 키: ${Object.keys(list[0]).join(", ")}`);
      console.log(`  [필드 확인] 샘플: ${JSON.stringify(list[0]).slice(0, 500)}`);
    }
    for (const g of list) {
      const k = `${g.seriesId ?? "?"}|${g.seriesName ?? g.seriesOutcome ?? "?"}`;
      seriesSeen.set(k, (seriesSeen.get(k) ?? 0) + 1);
    }
    for (const g of list) {
      const hs = Number(g.homeTeamScore);
      const as_ = Number(g.awayTeamScore);
      const done = g.statusCode === "RESULT" || g.statusInfo === "종료";
      if (!done || !Number.isFinite(hs) || !Number.isFinite(as_)) continue;
      // gameId를 키로 쓴다. 더블헤더는 같은 날 같은 두 팀이 두 경기를 하므로
      // 날짜+팀 조합을 키로 쓰면 한 경기를 잃는다.
      byId.set(String(g.gameId), {
        gameId: String(g.gameId),
        date: String(g.gameDate),
        home: String(g.homeTeamName),
        away: String(g.awayTeamName),
        hs,
        as: as_,
        status: String(g.statusCode ?? g.statusInfo ?? ""),
      });
    }
    if (list.length < PAGE_SIZE) break;
    page++;
    if (page > 50) { console.log(`  ! ${year} page 50 초과 - 종료조건 의심, 중단`); break; }
  }
  return { games: [...byId.values()], pages: page, raw };
}

async function main() {
  console.log(`KBO 수집: ${SEASONS.join(", ")} 시즌`);
  const all: Game[] = [];
  for (const y of SEASONS) {
    const { games, pages, raw } = await fetchSeason(y);
    games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    console.log(`\n${y}시즌: ${pages}페이지, 원본 ${raw}건 -> 종료·스코어 확보 ${games.length}경기`);

    // 검증: 팀별 경기수. KBO 정규시즌은 팀당 144경기(10팀 = 720경기)가 기준이다.
    // 크게 어긋나면 수집이 덜 됐다는 신호이므로 조용히 넘기지 않는다.
    const perTeam = new Map<string, number>();
    for (const g of games) {
      perTeam.set(g.home, (perTeam.get(g.home) ?? 0) + 1);
      perTeam.set(g.away, (perTeam.get(g.away) ?? 0) + 1);
    }
    const counts = [...perTeam.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  팀 ${counts.length}개, 팀당 경기수: ${counts.map(([t, n]) => `${t} ${n}`).join(" / ")}`);
    const min = Math.min(...counts.map((c) => c[1]));
    const max = Math.max(...counts.map((c) => c[1]));
    console.log(`  팀당 최소 ${min} / 최대 ${max} (KBO 정규시즌 기준 144, 총 720경기)`);
    if (games.length < 600) console.log(`  ** 720경기에 크게 못 미친다. 수집이 덜 됐을 가능성.`);
    if (games.length > 0) {
      console.log(`  첫 경기: ${games[0].date} ${games[0].away} @ ${games[0].home} ${games[0].as}:${games[0].hs}`);
      console.log(`  끝 경기: ${games.at(-1)!.date} ${games.at(-1)!.away} @ ${games.at(-1)!.home} ${games.at(-1)!.as}:${games.at(-1)!.hs}`);
    }
    all.push(...games);
  }

  console.log(`\n[시리즈 구분 값 분포] (정규시즌만 남기려면 이 중 어느 값인지 알아야 한다)`);
  for (const [k, v] of [...seriesSeen.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}  ${v}건`);
  }

  console.log(`\n총 ${all.length}경기`);
  if (all.length === 0) {
    console.log("한 경기도 못 받았다. 커밋하지 않는다.");
    process.exit(1);
  }
  // 승1패 3구간 분포도 같이 낸다 - MLB(35.7/28.4/35.8)와 비교하기 위한 기준값.
  let w = 0, one = 0, l = 0;
  for (const g of all) {
    const d = g.hs - g.as;
    if (Math.abs(d) === 1) one++;
    else if (d > 0) w++;
    else if (d < 0) l++;
  }
  const n = all.length;
  console.log(`승1패 분포: 승(홈2점차+) ${(w / n * 100).toFixed(1)}% / 1점차 ${(one / n * 100).toFixed(1)}% / 패(원정2점차+) ${(l / n * 100).toFixed(1)}%`);
  console.log(`무승부(동점): ${(n - w - one - l)}건  <- KBO는 연장 후 무승부가 있다`);
  const homeWin = all.filter((g) => g.hs > g.as).length;
  console.log(`홈 승률: ${(homeWin / n * 100).toFixed(2)}%`);

  writeFileSync(OUT, JSON.stringify(all, null, 0));
  console.log(`\n${OUT}에 저장 (${all.length}경기)`);
}

main();
