// 야구토토 승1패 조합이 실제로 살 만한지 잰다.
//
// 생성기를 만들어 놓고 기대값을 안 재면 '돌아가는 코드'만 있고 '살 이유'는 없는 셈이다.
// 축구 조합은 회차당 무승부 실측 빈도라는 근거가 있었는데, 야구는 구조가 달라서 그 근거가
// 그대로 오지 않는다.
//
// 여기서 드러난 제약
//   "1"은 절대 1순위가 안 되고(실측: 우리 모델도 배당도 픽 0건), 게다가 전력이 비슷하면
//   최하위라 삼복식이라야 덮인다(KBO 99.9% / MLB 83.3%). 경기당 조합수가 3배가 되므로
//   10만원(100구좌)으로도 4경기까지밖에 못 덮는다.
//   반면 14경기 중 "1"은 평균 3.2개(KBO) ~ 3.9개(MLB) 나온다.
//
// 그래서 묻는다: 예산별로 14경기 전부 적중할 확률이 얼마인가.
//   모델 기준 기대값  각 경기에서 고른 픽들의 확률 합을 곱한다
//   실측              과거 실제 슬레이트에 그대로 적용해 몇 번 전부 맞았나
// 둘을 같이 내는 이유는, 모델 확률이 과신이면 기대값만 좋고 실측은 안 따라오기 때문이다.
//
// 실행: npx tsx scripts/measure_baseball_combo.ts
import { readFileSync } from "node:fs";
import { ELO_PARAMS, predictSeung1Pae } from "../src/lib/baseball/prediction";
import { seung1PaeOf } from "../src/lib/baseball/types";
import {
  DEFAULT_BUDGET_TIERS,
  generateBaseballBet,
  type BaseballComboMatch,
} from "../src/lib/baseball/combinations";
import type { BaseballLeague } from "../src/lib/baseball/types";

const WARMUP = 20;
const SLATE = 14;

interface Row { date: string; home: string; away: string; hs: number; as: number; league: BaseballLeague }

function load(path: string, league: BaseballLeague): Row[] {
  return (JSON.parse(readFileSync(path, "utf8")) as any[]).map((r) => ({ ...r, league }));
}

// 리그별로 Elo를 굴려 경기별 '경기 전' 격차를 붙인다. 두 리그는 서로 붙지 않으므로 따로 굴린다.
function withElo(rows: Row[], league: BaseballLeague) {
  const { k, seasonRegression } = ELO_PARAMS[league];
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const elo = new Map<string, number>();
  const played = new Map<string, number>();
  let season = Number(sorted[0].date.slice(0, 4));
  const out: Array<Row & { eloDiff: number }> = [];
  for (const r of sorted) {
    const s = Number(r.date.slice(0, 4));
    if (s !== season) {
      for (const [t, v] of elo) elo.set(t, 1500 + (v - 1500) * (1 - seasonRegression));
      season = s;
    }
    const eh = elo.get(r.home) ?? 1500;
    const ea = elo.get(r.away) ?? 1500;
    if ((played.get(r.home) ?? 0) >= WARMUP && (played.get(r.away) ?? 0) >= WARMUP) {
      out.push({ ...r, eloDiff: eh - ea });
    }
    const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
    const sc = r.hs === r.as ? 0.5 : r.hs > r.as ? 1 : 0;
    elo.set(r.home, eh + k * (sc - exp));
    elo.set(r.away, ea + k * (exp - sc));
    played.set(r.home, (played.get(r.home) ?? 0) + 1);
    played.set(r.away, (played.get(r.away) ?? 0) + 1);
  }
  return out;
}

function main() {
  const kbo = withElo(load("seed/kbo_games.json", "KBO"), "KBO");
  const mlb = withElo(load("seed/mlb_games.json", "MLB"), "MLB");
  // 실제 야구토토 승1패는 KBO와 MLB를 한 회차에 섞는다(실측 260064: KBO 5 + MLB 9).
  // 날짜순으로 합쳐 14경기씩 끊어 가상의 회차를 만든다.
  const all = [...kbo, ...mlb].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const slates: Array<Array<typeof all[number]>> = [];
  for (let i = 0; i + SLATE <= all.length; i += SLATE) slates.push(all.slice(i, i + SLATE));

  console.log(`가상 회차 ${slates.length}개 (14경기씩, KBO+MLB 혼합, 워밍업 후 ${all.length}경기)`);

  // "1"이 회차당 몇 개나 나오는지 - 덮어야 할 양
  let oneTot = 0, graded = 0, ungraded = 0;
  for (const s of slates) for (const g of s) {
    const o = seung1PaeOf(g.hs, g.as);
    if (!o) { ungraded++; continue; }
    graded++;
    if (o === "1") oneTot++;
  }
  console.log(`회차당 "1" 평균 ${(oneTot / slates.length).toFixed(2)}개 / 14  (무승부로 판정 불가 ${ungraded}건은 제외)`);

  console.log(`\n예산     조합수  "1" 덮은 경기  모델 기대 적중확률   실측 전부적중`);
  for (const budget of DEFAULT_BUDGET_TIERS) {
    let expSum = 0, hits = 0, usable = 0, combosSum = 0, coveredSum = 0;
    for (const s of slates) {
      const matches: BaseballComboMatch[] = s.map((g, i) => ({
        seq: i + 1,
        league: g.league,
        home: g.home,
        away: g.away,
        prediction: predictSeung1Pae({ league: g.league, eloDiff: g.eloDiff }),
      }));
      const plan = generateBaseballBet(matches, budget, 1000, { guaranteeOneCount: "auto" });
      combosSum += plan.totalCombinations;
      coveredSum += plan.oneCoveredCount;

      // 모델 기준: 고른 픽들의 확률 합을 경기마다 곱한다
      let p = 1;
      for (let i = 0; i < s.length; i++) {
        const pr = matches[i].prediction;
        const map: Record<string, number> = { 승: pr.pWin, "1": pr.pOne, 패: pr.pLose };
        p *= plan.picks[i].picks.reduce((acc, o) => acc + map[o], 0);
      }
      expSum += p;

      // 실측: 실제 결과가 전부 픽 안에 있었나. 무승부가 하나라도 있으면 판정 불가로 뺀다.
      const outs = s.map((g) => seung1PaeOf(g.hs, g.as));
      if (outs.some((o) => o === null)) continue;
      usable++;
      if (outs.every((o, i) => plan.picks[i].picks.includes(o!))) hits++;
    }
    const n = slates.length;
    console.log(
      `${String(budget.toLocaleString()).padStart(7)}원  ${String(Math.round(combosSum / n)).padStart(5)}  ` +
      `${(coveredSum / n).toFixed(1).padStart(11)}개  ` +
      `${(expSum / n * 100).toFixed(4).padStart(14)}%  ` +
      `${String(hits).padStart(6)}/${usable} (${(hits / (usable || 1) * 100).toFixed(3)}%)`,
    );
  }

  console.log(`\n대조: "1"을 아예 안 덮고 단식/복식만 쓸 때`);
  for (const budget of [10_000, 100_000]) {
    let expSum = 0, hits = 0, usable = 0;
    for (const s of slates) {
      const matches: BaseballComboMatch[] = s.map((g, i) => ({
        seq: i + 1, league: g.league, home: g.home, away: g.away,
        prediction: predictSeung1Pae({ league: g.league, eloDiff: g.eloDiff }),
      }));
      const plan = generateBaseballBet(matches, budget, 1000, { guaranteeOneCount: 0 });
      let p = 1;
      for (let i = 0; i < s.length; i++) {
        const pr = matches[i].prediction;
        const map: Record<string, number> = { 승: pr.pWin, "1": pr.pOne, 패: pr.pLose };
        p *= plan.picks[i].picks.reduce((acc, o) => acc + map[o], 0);
      }
      expSum += p;
      const outs = s.map((g) => seung1PaeOf(g.hs, g.as));
      if (outs.some((o) => o === null)) continue;
      usable++;
      if (outs.every((o, i) => plan.picks[i].picks.includes(o!))) hits++;
    }
    console.log(`  ${budget.toLocaleString()}원  모델 기대 ${(expSum / slates.length * 100).toFixed(4)}%  실측 ${hits}/${usable}`);
  }
}

main();
