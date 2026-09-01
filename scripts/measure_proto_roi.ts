// 프로토 승부식 야구 승패에 우리 모델로 베팅했을 때 실현 수익률.
//
// 왜 적중률이 아니라 수익률인가
//   야구토토 승1패는 파리뮤추얼 고정 슬레이트라 '14경기 전부 적중'이 목표였고, 그건
//   실측 0/778로 끝났다(scripts/measure_baseball_combo.ts). 프로토 승부식은 다르다.
//   배당제라 경기를 골라 살 수 있고, 이기고 지는 게 아니라 '배당 대비 우리 확률이
//   높은가'가 전부다. 적중률 55%가 배당 1.8짜리에서 나면 이익이고 1.7짜리에서 나면 손해다.
//
// 세 전략을 같은 경기에서 비교한다.
//   1) 모델 픽에 균등 베팅
//   2) 시장 favorite(배당 낮은 쪽)에 균등 베팅 - 아무 생각 없이 사는 기준선
//   3) 밸류 베팅: 모델확률 x 배당 > 1 인 경기만
// 오버라운드 때문에 2)는 구조적으로 마이너스다. 1)이 2)보다 나은지, 3)이 0을 넘는지가 질문이다.
//
// 실행: npx tsx scripts/measure_proto_roi.ts
import { readFileSync } from "node:fs";
import { ELO_PARAMS, predictWinLose, BASEBALL_MARKET_WEIGHT } from "../src/lib/baseball/prediction";
import type { BaseballLeague } from "../src/lib/baseball/types";

const WARMUP = 20;
const EVAL_FROM = "2026-01-01";

interface Seed { date: string; home: string; away: string; hs: number; as: number }
interface Odds {
  gameKey: string; date: string; league: string;
  score: string | null; winAllot: number; loseAllot: number;
}

const load = <T,>(p: string): T[] => JSON.parse(readFileSync(p, "utf8"));
const shiftDay = (d: string, n: number) =>
  new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

function eloTimeline(rows: Seed[], league: BaseballLeague) {
  const { k, seasonRegression } = ELO_PARAMS[league];
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const elo = new Map<string, number>();
  const played = new Map<string, number>();
  let season = Number(sorted[0].date.slice(0, 4));
  const out = new Map<string, { diff: number; warm: boolean; g: Seed }>();
  for (const r of sorted) {
    const s = Number(r.date.slice(0, 4));
    if (s !== season) {
      for (const [t, v] of elo) elo.set(t, 1500 + (v - 1500) * (1 - seasonRegression));
      season = s;
    }
    const eh = elo.get(r.home) ?? 1500, ea = elo.get(r.away) ?? 1500;
    out.set(`${r.date}|${r.home}|${r.away}`, {
      diff: eh - ea,
      warm: (played.get(r.home) ?? 0) >= WARMUP && (played.get(r.away) ?? 0) >= WARMUP,
      g: r,
    });
    const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
    const sc = r.hs === r.as ? 0.5 : r.hs > r.as ? 1 : 0;
    elo.set(r.home, eh + k * (sc - exp));
    elo.set(r.away, ea + k * (exp - sc));
    played.set(r.home, (played.get(r.home) ?? 0) + 1);
    played.set(r.away, (played.get(r.away) ?? 0) + 1);
  }
  return out;
}

// compare_baseball_market.ts와 같은 조인 규칙 - gameKey를 쪼개고, 정확한 날짜 우선, 없으면 앞뒤 하루.
function learnMap(odds: Odds[], seed: Seed[]) {
  const byDate = new Map<string, Seed[]>();
  for (const g of seed) {
    const a = byDate.get(g.date) ?? [];
    a.push(g);
    byDate.set(g.date, a);
  }
  const votes = new Map<string, Map<string, number>>();
  for (const o of odds) {
    if (!o.score || !/^\d+:\d+$/.test(o.score)) continue;
    const kp = o.gameKey.split(":");
    if (kp.length !== 2) continue;
    const [hs, as_] = o.score.split(":").map(Number);
    const find = (d: string) => (byDate.get(d) ?? []).filter((g) => g.hs === hs && g.as === as_);
    let c = find(o.date);
    if (c.length === 0) c = [...find(shiftDay(o.date, -1)), ...find(shiftDay(o.date, 1))];
    if (c.length !== 1) continue;
    for (const [kr, en] of [[kp[0], c[0].home], [kp[1], c[0].away]] as const) {
      const m = votes.get(kr) ?? new Map<string, number>();
      m.set(en, (m.get(en) ?? 0) + 1);
      votes.set(kr, m);
    }
  }
  const map = new Map<string, string>();
  for (const [kr, m] of votes) {
    const tot = [...m.values()].reduce((s, n) => s + n, 0);
    const [en, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= 3 && n / tot >= 0.6) map.set(kr, en);
  }
  return map;
}

interface Bet { p: number; oddsWin: number; oddsLose: number; pickHome: boolean; won: boolean; odds: number }

function collect(league: BaseballLeague, seed: Seed[], odds: Odds[], w: number): Bet[] {
  const tl = eloTimeline(seed, league);
  const map = league === "MLB" ? learnMap(odds.filter((o) => o.league === league), seed) : new Map<string, string>();
  const name = (kr: string) => (league === "MLB" ? map.get(kr) ?? "" : kr);
  const bets: Bet[] = [];
  for (const o of odds) {
    if (o.league !== league) continue;
    if (!(o.winAllot > 1 && o.loseAllot > 1)) continue;
    const kp = o.gameKey.split(":");
    if (kp.length !== 2) continue;
    const h = name(kp[0]), a = name(kp[1]);
    if (!h || !a) continue;
    let rec = tl.get(`${o.date}|${h}|${a}`);
    if (!rec) {
      const alts = [shiftDay(o.date, -1), shiftDay(o.date, 1)].map((d) => tl.get(`${d}|${h}|${a}`)).filter(Boolean);
      if (alts.length !== 1) continue;
      rec = alts[0]!;
    }
    if (!rec.warm || rec.g.date < EVAL_FROM || rec.g.hs === rec.g.as) continue;
    const pred = predictWinLose(
      { league, eloDiff: rec.diff, marketOdds: { winAllot: o.winAllot, loseAllot: o.loseAllot } },
      { useElo: true, useMarketOdds: true, marketWeight: w },
    );
    const homeWon = rec.g.hs > rec.g.as;
    const pickHome = pred.pick === "승";
    bets.push({
      p: pickHome ? pred.pHome : pred.pAway,
      oddsWin: o.winAllot,
      oddsLose: o.loseAllot,
      pickHome,
      won: pickHome === homeWon,
      odds: pickHome ? o.winAllot : o.loseAllot,
    });
  }
  return bets;
}

const roi = (bets: Array<{ won: boolean; odds: number }>) => {
  if (!bets.length) return { n: 0, roi: 0, hit: 0 };
  const ret = bets.reduce((s, b) => s + (b.won ? b.odds : 0), 0);
  return { n: bets.length, roi: ret / bets.length - 1, hit: bets.filter((b) => b.won).length / bets.length };
};
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

function main() {
  const odds = load<Odds>("seed/proto_baseball_odds.json").filter((o) => o.score && /^\d+:\d+$/.test(o.score));
  for (const [league, path] of [["KBO", "seed/kbo_games.json"], ["MLB", "seed/mlb_games.json"]] as const) {
    const seed = load<Seed>(path);
    const w = BASEBALL_MARKET_WEIGHT[league];
    const bets = collect(league, seed, odds, w);
    console.log(`\n${"=".repeat(70)}\n${league}  (marketWeight ${w})  베팅 가능 ${bets.length}건\n${"=".repeat(70)}`);
    if (bets.length < 100) { console.log("  100건 미만 - 판정하지 않는다"); continue; }

    const m = roi(bets);
    console.log(`  1) 모델 픽 균등베팅        n=${m.n} 적중 ${pct(m.hit)} 수익률 ${pct(m.roi)}`);

    const fav = bets.map((b) => {
      const favHome = b.oddsWin <= b.oddsLose;
      const won = favHome === b.pickHome ? b.won : !b.won;
      return { won, odds: favHome ? b.oddsWin : b.oddsLose };
    });
    const f = roi(fav);
    console.log(`  2) 시장 favorite 균등베팅  n=${f.n} 적중 ${pct(f.hit)} 수익률 ${pct(f.roi)}`);

    // 오버라운드: 이만큼이 구조적으로 빠진다. 어떤 전략도 이걸 넘어야 이익이다.
    const or = bets.reduce((s, b) => s + 1 / b.oddsWin + 1 / b.oddsLose, 0) / bets.length;
    console.log(`  참고) 평균 오버라운드 ${or.toFixed(4)} -> 무작위 베팅의 기대 수익률 ${pct(1 / or - 1)}`);

    for (const edge of [1.0, 1.05, 1.1]) {
      const v = bets.filter((b) => b.p * b.odds > edge);
      const r = roi(v);
      console.log(`  3) 밸류베팅 p*배당 > ${edge.toFixed(2)}   n=${r.n} 적중 ${pct(r.hit)} 수익률 ${r.n ? pct(r.roi) : "-"}`);
    }
  }
  console.log(`\n주의: 표본이 2026 한 시즌(약 4개월)이다. 수익률은 적중률보다 분산이 훨씬 커서`);
  console.log(`이 크기로는 부호가 뒤집히기 쉽다. 여기 수치는 '가능성 확인'이지 '검증'이 아니다.`);
}

main();
