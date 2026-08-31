// MLB 정규시즌 경기 결과를 시즌 단위로 수집해 seed/mlb_games.json에 저장한다.
//
// 소스: statsapi.mlb.com 공개 API(키 불필요).
//   https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=&endDate=
//
// KBO와 달리 여기는 경기 종류가 파라미터로 있다(gameType=R). KBO는 목록에 시리즈 필드가
// 아예 없어 상세를 2,600건 받아야 했는데(fetch_kbo_history.ts 참고) MLB는 서버가 걸러준다.
//
// measure_baseball_sabr.ts가 이미 같은 API를 쓰지만 매번 새로 긁는다. 백테스트를 돌릴 때마다
// 네트워크에 의존하면 샌드박스에서 못 돌리고 결과 재현도 안 되므로, KBO와 같은 형식으로
// 파일에 떨궈 둔다. 선발투수도 같이 받는다(hydrate=probablePitcher) - 승1패 사슬의
// 고리2를 살릴 유일한 후보이고, 나중에 다시 긁지 않기 위해서다.
//
// 실행: npx tsx scripts/fetch_mlb_history.ts [시즌...]   (러너 전용 - 샌드박스는 statsapi 차단)
import { writeFileSync } from "node:fs";

const SEASONS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [2023, 2024, 2025];
const OUT = "seed/mlb_games.json";

interface Game {
  gamePk: string;
  date: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  homeStarter: string;
  awayStarter: string;
}

async function getJson(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(40000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
}

async function fetchSeason(year: number): Promise<Game[]> {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R` +
    `&startDate=${year}-03-01&endDate=${year}-11-10&hydrate=probablePitcher`;
  const data = await getJson(url);
  const out: Game[] = [];
  let seen = 0;
  const stateSeen = new Map<string, number>();
  for (const d of data?.dates ?? []) {
    for (const g of d.games ?? []) {
      seen++;
      const st = String(g?.status?.detailedState ?? "?");
      stateSeen.set(st, (stateSeen.get(st) ?? 0) + 1);
      if (st !== "Final") continue;
      const h = g?.teams?.home, a = g?.teams?.away;
      if (typeof h?.score !== "number" || typeof a?.score !== "number") continue;
      out.push({
        gamePk: String(g.gamePk),
        date: String(d.date),
        home: String(h.team?.name ?? "?"),
        away: String(a.team?.name ?? "?"),
        hs: h.score,
        as: a.score,
        homeStarter: String(h.probablePitcher?.fullName ?? ""),
        awayStarter: String(a.probablePitcher?.fullName ?? ""),
      });
    }
  }
  console.log(`\n${year}시즌: 원본 ${seen}건 -> 종료 ${out.length}경기`);
  console.log(`  상태 분포: ${[...stateSeen.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(" / ")}`);
  return out;
}

// 검증: MLB 정규시즌은 팀당 162경기, 30팀 = 2,430경기가 기준이다.
// KBO 수집기와 같은 이유로 '몇 건이 와야 맞는지'를 스스로 대조한다.
function verify(games: Game[]): void {
  const perTeam = new Map<string, number>();
  for (const g of games) {
    perTeam.set(g.home, (perTeam.get(g.home) ?? 0) + 1);
    perTeam.set(g.away, (perTeam.get(g.away) ?? 0) + 1);
  }
  const counts = [...perTeam.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${games.length}경기 (기준 2430), 팀 ${counts.length}개 (기준 30)`);
  console.log(`  팀당 최소 ${Math.min(...counts.map((c) => c[1]))} / 최대 ${Math.max(...counts.map((c) => c[1]))} (기준 162)`);
  if (counts.length !== 30) console.log(`  ** 팀이 30개가 아니다`);
  const off = counts.filter(([, n]) => Math.abs(n - 162) > 3);
  if (off.length) console.log(`  ** 162에서 3경기 넘게 벗어남: ${off.map(([t, n]) => `${t} ${n}`).join(" / ")}`);
  if (games.length) console.log(`  기간: ${games[0].date} ~ ${games.at(-1)!.date}`);
  const withStarter = games.filter((g) => g.homeStarter && g.awayStarter).length;
  console.log(`  선발투수 양쪽 확보: ${withStarter}/${games.length}`);
}

async function main() {
  console.log(`MLB 정규시즌 수집: ${SEASONS.join(", ")} 시즌 (gameType=R)`);
  const all: Game[] = [];
  for (const y of SEASONS) {
    const games = await fetchSeason(y);
    games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.gamePk < b.gamePk ? -1 : 1));
    verify(games);
    all.push(...games);
  }
  console.log(`\n총 ${all.length}경기`);
  if (all.length === 0) {
    console.log("한 경기도 못 받았다. 커밋하지 않는다.");
    process.exit(1);
  }
  const one = all.filter((g) => Math.abs(g.hs - g.as) === 1).length;
  const w = all.filter((g) => g.hs - g.as >= 2).length;
  const l = all.filter((g) => g.as - g.hs >= 2).length;
  const n = all.length;
  console.log(`승1패 분포: 승(홈2점차+) ${(w / n * 100).toFixed(1)}% / 1점차 ${(one / n * 100).toFixed(1)}% / 패(원정2점차+) ${(l / n * 100).toFixed(1)}%`);
  console.log(`홈 승률: ${(all.filter((g) => g.hs > g.as).length / n * 100).toFixed(2)}%  (MLB는 무승부가 없다)`);
  writeFileSync(OUT, JSON.stringify(all, null, 0));
  console.log(`\n${OUT}에 저장 (${all.length}경기)`);
}

main();
