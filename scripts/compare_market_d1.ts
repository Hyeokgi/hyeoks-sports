// 우리 앱이 실제로 수집한 배당(wisetoto 해외배당, D1 market_odds) vs 우리 모델 비교.
//
// 왜 별도로 필요한가: compare_market.ts는 football-data.co.uk의 "종가 평균" 배당으로 쟀다.
// 그건 킥오프 직전의 가장 예리한 배당이라 서비스가 실제로 쓰는 값과 다르다. 서비스는
// wisetoto가 표시하는 해외배당을 2시간마다 스냅샷할 뿐이고, 회차엔 시장이 얇은
// K리그/J1/MLS도 섞인다. marketWeight를 조정하려면 이쪽 수치가 근거가 되어야 한다.
//
// 누수 없음: raw 성분(elo_diff 등)은 round_predictions에 회차 생성 시점 값으로 동결돼 있고,
// refreshXgForActiveRounds는 status='upcoming' 회차만 건드린다(정산된 회차는 불변).
//
// 실행: npx tsx scripts/compare_market_d1.ts   (러너에서 Worker에 HTTP로 접근)
import fs from "node:fs";
import path from "node:path";
import { predictMatch, DEFAULT_TOGGLES, type MarketOdds } from "../src/lib/prediction";

const BASE = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";

type Outcome = 0 | 1 | 2;

interface Sample {
  roundNo: number | null;
  league: string;
  home: string;
  away: string;
  actual: Outcome;
  market: MarketOdds;
  inputs: Parameters<typeof predictMatch>[0];
}

interface Metrics { n: number; hit: number; brier: number; logloss: number; sumDraw: number; drawTop: number; }
const newMetrics = (): Metrics => ({ n: 0, hit: 0, brier: 0, logloss: 0, sumDraw: 0, drawTop: 0 });

function accumulate(m: Metrics, p: [number, number, number], actual: Outcome): void {
  m.n++;
  const top = p.indexOf(Math.max(...p));
  if (top === actual) m.hit++;
  if (top === 1) m.drawTop++;
  m.sumDraw += p[1];
  for (let i = 0; i < 3; i++) m.brier += (p[i] - (i === actual ? 1 : 0)) ** 2;
  m.logloss += -Math.log(Math.max(p[actual], 1e-12));
}

function report(label: string, m: Metrics): void {
  if (m.n === 0) { console.log(`  ${label.padEnd(24)} (표본 없음)`); return; }
  console.log(
    `  ${label.padEnd(24)} 적중 ${((m.hit / m.n) * 100).toFixed(1)}%  Brier ${(m.brier / m.n).toFixed(4)}  ` +
      `로그손실 ${(m.logloss / m.n).toFixed(4)}  평균무 ${((m.sumDraw / m.n) * 100).toFixed(1)}%  ` +
      `무1픽 ${((m.drawTop / m.n) * 100).toFixed(1)}%  n=${m.n}`,
  );
}

// 연속성 보정 McNemar + 정규근사 p값
function mcnemar(b: number, c: number): { chi2: number; p: number } {
  if (b + c === 0) return { chi2: 0, p: 1 };
  const chi2 = (Math.abs(b - c) - 1) ** 2 / (b + c);
  const z = Math.sqrt(chi2);
  // erfc 근사(Abramowitz-Stegun 7.1.26 기반 보완오차함수)
  const t = 1 / (1 + 0.5 * (z / Math.SQRT2));
  const erfc =
    t *
    Math.exp(
      -((z / Math.SQRT2) ** 2) - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
        t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
          t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return { chi2, p: erfc };
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function main() {
  console.log(`Worker: ${BASE}`);
  const roundsData = await getJson(`${BASE}/api/rounds`);
  const rounds: any[] = roundsData.rounds ?? [];
  console.log(`회차 ${rounds.length}건 조회`);

  const samples: Sample[] = [];
  let noResult = 0, noMarket = 0, failed = 0;

  for (const r of rounds) {
    let data: any;
    try {
      data = await getJson(`${BASE}/api/rounds/${r.id}`);
    } catch (e) {
      failed++;
      console.log(`  ! 회차 ${r.round_no ?? r.id} 조회 실패: ${(e as Error).message}`);
      continue;
    }
    for (const m of data.matches ?? []) {
      if (!m.result) { noResult++; continue; }
      if (!m.raw?.market) { noMarket++; continue; }
      const actual: Outcome = m.result.actual === "H" ? 0 : m.result.actual === "D" ? 1 : 2;
      samples.push({
        roundNo: r.round_no ?? null,
        league: m.league,
        home: m.home,
        away: m.away,
        actual,
        market: m.raw.market,
        inputs: {
          eloDiff: m.raw.eloDiff,
          formDiff: m.raw.formDiff,
          h2hDiff: m.raw.h2hDiff,
          leagueDrawRate: m.raw.leagueDrawRate,
          marketOdds: m.raw.market,
          xgDiff: m.raw.xgDiff ?? null,
          cornersDiff: m.raw.cornersDiff ?? null,
          league: m.league,
        },
      });
    }
  }

  console.log(`\n평가 대상 ${samples.length}경기 (결과없음 ${noResult} / 배당없음 ${noMarket} / 조회실패 회차 ${failed})`);
  if (samples.length === 0) {
    console.log("배당+결과가 모두 있는 경기가 없습니다. 정산된 회차가 쌓일 때까지 기다려야 합니다.");
    return;
  }

  const bookCounts: Record<number, number> = {};
  for (const s of samples) bookCounts[s.market.nBookmakers] = (bookCounts[s.market.nBookmakers] ?? 0) + 1;
  console.log(`배당 북메이커 수 분포: ${JSON.stringify(bookCounts)}`);

  const weights = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const pure = newMetrics(), market = newMetrics(), blend = newMetrics();
  const sweep = weights.map(() => newMetrics());
  // 유럽 5대리그와 그 외(시장이 얇은 쪽)를 나눠 본다 - 가중치를 리그별로 둘지 판단하려면 필요
  const EURO = new Set(["EPL", "세리에A", "라리가", "분데스리가"]);
  const grp: Record<string, { pure: Metrics; market: Metrics }> = {
    "유럽4": { pure: newMetrics(), market: newMetrics() },
    "아시아·MLS": { pure: newMetrics(), market: newMetrics() },
  };
  const byLeague: Record<string, { n: number; pure: number; market: number }> = {};
  let agree = 0, disagree = 0, pureWins = 0, marketWins = 0, bothWrong = 0;

  for (const s of samples) {
    const pp = predictMatch({ ...s.inputs, marketOdds: null }, { ...DEFAULT_TOGGLES, useMarketOdds: false });
    const pureP: [number, number, number] = [pp.pHome, pp.pDraw, pp.pAway];
    const mktP: [number, number, number] = [s.market.pHome, s.market.pDraw, s.market.pAway];
    const bp = predictMatch(s.inputs, DEFAULT_TOGGLES);
    accumulate(pure, pureP, s.actual);
    accumulate(market, mktP, s.actual);
    accumulate(blend, [bp.pHome, bp.pDraw, bp.pAway], s.actual);

    for (let i = 0; i < weights.length; i++) {
      const w = predictMatch(s.inputs, { ...DEFAULT_TOGGLES, marketWeight: weights[i] });
      accumulate(sweep[i], [w.pHome, w.pDraw, w.pAway], s.actual);
    }

    const g = EURO.has(s.league) ? "유럽4" : "아시아·MLS";
    accumulate(grp[g].pure, pureP, s.actual);
    accumulate(grp[g].market, mktP, s.actual);

    const pt = pureP.indexOf(Math.max(...pureP));
    const mt = mktP.indexOf(Math.max(...mktP));
    if (pt === mt) agree++;
    else {
      disagree++;
      if (pt === s.actual) pureWins++;
      else if (mt === s.actual) marketWins++;
      else bothWrong++;
    }
    byLeague[s.league] ??= { n: 0, pure: 0, market: 0 };
    byLeague[s.league].n++;
    if (pt === s.actual) byLeague[s.league].pure++;
    if (mt === s.actual) byLeague[s.league].market++;
  }

  console.log(`\n=== 전체 (앱 실제 배당) ===  (Brier·로그손실은 낮을수록 좋음)`);
  report("우리 모델(배당 미반영)", pure);
  report("앱 수집 배당", market);
  report("혼합 w=0.4(현재)", blend);

  const mc = mcnemar(marketWins, pureWins);
  console.log(`\n=== 1픽 일치/불일치 ===`);
  console.log(`  일치 ${agree}/${samples.length} (${((agree / samples.length) * 100).toFixed(1)}%) / 불일치 ${disagree}`);
  if (disagree > 0) {
    console.log(`  불일치 시  우리 승 ${pureWins} / 배당 승 ${marketWins} / 둘다 실패 ${bothWrong}`);
    console.log(`  McNemar chi2=${mc.chi2.toFixed(2)}, p=${mc.p.toExponential(2)} ${mc.p < 0.05 ? "(유의)" : "(유의하지 않음 - 표본 부족일 수 있음)"}`);
  }

  console.log(`\n=== 시장 두께별 ===`);
  for (const [g, v] of Object.entries(grp)) {
    if (v.pure.n === 0) continue;
    console.log(`  [${g}]`);
    report("    우리 모델", v.pure);
    report("    배당", v.market);
  }

  console.log(`\n=== 리그별 top-pick 적중률 ===`);
  for (const [lg, v] of Object.entries(byLeague).sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${lg.padEnd(8)} n=${String(v.n).padStart(3)}  우리 ${((v.pure / v.n) * 100).toFixed(1)}%  ` +
        `배당 ${((v.market / v.n) * 100).toFixed(1)}%  차 ${(((v.pure - v.market) / v.n) * 100).toFixed(1)}%p`,
    );
  }

  console.log(`\n=== marketWeight 스윕 ===`);
  let bestBrier = Infinity, bestBrierW = 0, bestAcc = -1, bestAccW = 0;
  for (let i = 0; i < weights.length; i++) {
    const m = sweep[i];
    if (m.brier / m.n < bestBrier) { bestBrier = m.brier / m.n; bestBrierW = weights[i]; }
    if (m.hit / m.n > bestAcc) { bestAcc = m.hit / m.n; bestAccW = weights[i]; }
    report(`w=${weights[i].toFixed(1)}`, m);
  }
  console.log(`\n  적중률 최적 w=${bestAccW.toFixed(1)} (${(bestAcc * 100).toFixed(1)}%)`);
  console.log(`  Brier  최적 w=${bestBrierW.toFixed(1)} (${bestBrier.toFixed(4)})`);
  console.log(
    `\n  ※ 표본 ${samples.length}경기. 경기당 1%p는 약 ${(0.01 * samples.length).toFixed(1)}경기 차이라,` +
      ` 수백 경기 미만이면 스윕의 미세한 차이는 노이즈로 봐야 한다.`,
  );

  const out = {
    generatedAt: new Date().toISOString(),
    source: "app D1 market_odds (wisetoto 해외배당)",
    evaluated: samples.length,
    pure: { acc: pure.hit / pure.n, brier: pure.brier / pure.n, logloss: pure.logloss / pure.n },
    market: { acc: market.hit / market.n, brier: market.brier / market.n, logloss: market.logloss / market.n },
    blend04: { acc: blend.hit / blend.n, brier: blend.brier / blend.n, logloss: blend.logloss / blend.n },
    agreement: { agree, disagree, pureWins, marketWins, bothWrong, mcnemarChi2: mc.chi2, mcnemarP: mc.p },
    byLeague,
    byMarketDepth: Object.fromEntries(
      Object.entries(grp).map(([g, v]) => [g, { n: v.pure.n, pureAcc: v.pure.hit / (v.pure.n || 1), marketAcc: v.market.hit / (v.market.n || 1) }]),
    ),
    sweep: weights.map((w, i) => ({ w, acc: sweep[i].hit / sweep[i].n, brier: sweep[i].brier / sweep[i].n })),
  };
  fs.writeFileSync(path.join(process.cwd(), "seed", "market_comparison_d1.json"), JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n저장: seed/market_comparison_d1.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
