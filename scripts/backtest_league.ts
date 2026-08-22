// EPL/세리에A 워크포워드 백테스트 (npx tsx scripts/backtest_league.ts [grid])
// calibration.ts에 기록된 기존 리그들과 동일 프로토콜: 각 경기를 "그 경기 이전 데이터만"으로
// 예측(팀당 15경기+ 워밍업 후), 확신도(1-2위 확률차) 구간별 실제 적중률을 집계한다.
// 데이터: seed/backfill_leagues.json (backfill 워크플로우 산출물).
//
// grid 모드: HOME_ADV 그리드서치(MLS 편입 때와 동일한 목적). 이때는 homeAdv를 주입해야 해서
// predictMatch의 비마켓 경로(Elo 로지스틱 + 격차보정 무승부율)를 그대로 미러링한다 -
// prediction.ts가 바뀌면 이 미러도 같이 갱신해야 한다. 최종 캘리브레이션 수치는 반드시
// 기본 모드(실제 predictMatch 사용)로 뽑는다.
import { readFileSync } from "node:fs";
import { K_FACTOR, SEASON_REGRESSION, seasonOf, homeAdvForLeague, type MatchRow } from "../src/lib/elo";
import { predictMatch, DEFAULT_TOGGLES, FALLBACK_DRAW_RATE } from "../src/lib/prediction";
import { closenessAdjustedDrawRate } from "../src/lib/drawCurve";

const WARMUP_MATCHES = 15;
const BUCKETS: [number, number][] = [
  [0, 0.05],
  [0.05, 0.15],
  [0.15, 0.3],
  [0.3, 1.01],
];

interface TeamState {
  elo: number;
  lastSeason: number;
  history: { pts: number }[];
}

function mirrorPredict(
  eloDiff: number,
  formDiff: number,
  h2hDiff: number,
  drawRate: number,
  homeAdv: number,
): { picks: ("홈승" | "무승부" | "원정승")[]; gap: number } {
  // prediction.ts predictMatch의 비마켓/비xG/비코너 경로 미러 (grid 모드 전용)
  const totalDiff = eloDiff + 60.0 * formDiff + 50.0 * h2hDiff;
  const pHomeRaw = 1.0 / (1.0 + 10.0 ** (-(totalDiff + homeAdv) / 400.0));
  const pDraw = closenessAdjustedDrawRate(drawRate, Math.abs(eloDiff));
  const pHome = pHomeRaw * (1 - pDraw);
  const pAway = (1 - pHomeRaw) * (1 - pDraw);
  const probs: [("홈승" | "무승부" | "원정승"), number][] = [
    ["홈승", pHome],
    ["무승부", pDraw],
    ["원정승", pAway],
  ];
  probs.sort((a, b) => b[1] - a[1]);
  return { picks: probs.map((p) => p[0]), gap: probs[0][1] - probs[1][1] };
}

function runBacktest(matches: MatchRow[], league: string, homeAdvOverride: number | null) {
  const rows = matches.filter((m) => m.league === league);
  const homeAdv = homeAdvOverride ?? homeAdvForLeague(league);

  const teams = new Map<string, TeamState>();
  const h2h = new Map<string, { home: string; hg: number; ag: number }[]>();
  let draws = 0;
  let played = 0;

  const bucketStats = BUCKETS.map(() => ({ n: 0, correct: 0 }));
  let total = 0;
  let correct = 0;
  let homeWins = 0;
  let brierSum = 0;

  const teamKey = (t: string) => t;
  const h2hKey = (a: string, b: string) => [a, b].sort().join("|");

  for (const row of rows) {
    const season = seasonOf(league, row.date);
    for (const t of [row.home, row.away]) {
      const st = teams.get(teamKey(t));
      if (!st) teams.set(teamKey(t), { elo: 1500, lastSeason: season, history: [] });
      else if (st.lastSeason !== season) {
        st.elo = 1500 + (st.elo - 1500) * (1 - SEASON_REGRESSION);
        st.lastSeason = season;
      }
    }
    const hs = teams.get(teamKey(row.home))!;
    const as_ = teams.get(teamKey(row.away))!;

    // 예측 (업데이트 전 상태만 사용 - 워크포워드)
    if (hs.history.length >= WARMUP_MATCHES && as_.history.length >= WARMUP_MATCHES) {
      const eloDiff = hs.elo - as_.elo;
      const formDiff =
        hs.history.slice(-5).reduce((s, x) => s + x.pts, 0) / Math.min(5, hs.history.length) -
        as_.history.slice(-5).reduce((s, x) => s + x.pts, 0) / Math.min(5, as_.history.length);
      const meetings = (h2h.get(h2hKey(row.home, row.away)) ?? []).slice(-5);
      let h2hDiff = 0;
      if (meetings.length > 0) {
        const pts = meetings.map((m) => {
          const winnerPts = m.hg > m.ag ? 2 : m.hg === m.ag ? 1 : 0;
          return m.home === row.home ? winnerPts : 2 - winnerPts;
        });
        h2hDiff = pts.reduce((s, x) => s + x, 0) / pts.length - 1.0;
      }
      const drawRate = played >= 50 ? draws / played : FALLBACK_DRAW_RATE;

      let picks: ("홈승" | "무승부" | "원정승")[];
      let gap: number;
      let probs: { pHome: number; pDraw: number; pAway: number };
      if (homeAdvOverride != null) {
        const p = mirrorPredict(eloDiff, formDiff, h2hDiff, drawRate, homeAdv);
        picks = p.picks;
        gap = p.gap;
        probs = { pHome: 0, pDraw: 0, pAway: 0 }; // grid 모드는 Brier 미산출
      } else {
        const p = predictMatch(
          { eloDiff, formDiff, h2hDiff, leagueDrawRate: drawRate, marketOdds: null, xgDiff: null, cornersDiff: null, league },
          DEFAULT_TOGGLES,
        );
        picks = p.rankedPicks;
        gap = p.confidenceGap;
        probs = { pHome: p.pHome, pDraw: p.pDraw, pAway: p.pAway };
      }

      const actual = row.hg > row.ag ? "홈승" : row.hg === row.ag ? "무승부" : "원정승";
      const hit = picks[0] === actual;
      total++;
      if (hit) correct++;
      if (actual === "홈승") homeWins++;
      if (homeAdvOverride == null) {
        const y = { "홈승": [1, 0, 0], "무승부": [0, 1, 0], "원정승": [0, 0, 1] }[actual]!;
        brierSum +=
          (probs.pHome - y[0]) ** 2 + (probs.pDraw - y[1]) ** 2 + (probs.pAway - y[2]) ** 2;
      }
      const bi = BUCKETS.findIndex(([lo, hi]) => gap >= lo && gap < hi);
      if (bi >= 0) {
        bucketStats[bi].n++;
        if (hit) bucketStats[bi].correct++;
      }
    }

    // 상태 업데이트 (computeEloAndHistory와 동일 수식, homeAdv만 파라미터)
    const sH = row.hg > row.ag ? 1.0 : row.hg === row.ag ? 0.5 : 0.0;
    const eH = 1.0 / (1.0 + 10.0 ** ((as_.elo - (hs.elo + homeAdv)) / 400.0));
    hs.elo += K_FACTOR * (sH - eH);
    as_.elo += K_FACTOR * (1.0 - sH - (1.0 - eH));
    hs.history.push({ pts: row.hg > row.ag ? 3 : row.hg === row.ag ? 1 : 0 });
    as_.history.push({ pts: row.ag > row.hg ? 3 : row.hg === row.ag ? 1 : 0 });
    const hk = h2hKey(row.home, row.away);
    if (!h2h.has(hk)) h2h.set(hk, []);
    h2h.get(hk)!.push({ home: row.home, hg: row.hg, ag: row.ag });
    if (row.hg === row.ag) draws++;
    played++;

    void teamKey;
  }

  return {
    total,
    accuracy: total > 0 ? correct / total : 0,
    homeBaseline: total > 0 ? homeWins / total : 0,
    brier: total > 0 && homeAdvOverride == null ? brierSum / total : null,
    drawRate: played > 0 ? draws / played : 0,
    buckets: bucketStats.map((b, i) => ({
      range: `${(BUCKETS[i][0] * 100).toFixed(0)}~${(BUCKETS[i][1] * 100).toFixed(0)}%p`,
      n: b.n,
      accuracy: b.n > 0 ? b.correct / b.n : 0,
    })),
  };
}

function main() {
  const matches: MatchRow[] = JSON.parse(readFileSync("seed/backfill_leagues.json", "utf-8"));
  const leagues = [...new Set(matches.map((m) => m.league))];
  const gridMode = process.argv.includes("grid");

  for (const league of leagues) {
    console.log(`\n===== ${league} =====`);
    if (gridMode) {
      for (const adv of [30, 45, 60, 75, 90, 105]) {
        const r = runBacktest(matches, league, adv);
        console.log(`HOME_ADV=${adv}: 적중률 ${(r.accuracy * 100).toFixed(1)}% (n=${r.total})`);
      }
    } else {
      const r = runBacktest(matches, league, null);
      console.log(
        `전체: 적중률 ${(r.accuracy * 100).toFixed(1)}% / 홈승 베이스라인 ${(r.homeBaseline * 100).toFixed(1)}% / Brier ${r.brier?.toFixed(4)} / 무승부율 ${(r.drawRate * 100).toFixed(1)}% (n=${r.total})`,
      );
      for (const b of r.buckets) {
        console.log(`  ${b.range}: ${(b.accuracy * 100).toFixed(1)}% (n=${b.n})`);
      }
    }
  }
}

main();
