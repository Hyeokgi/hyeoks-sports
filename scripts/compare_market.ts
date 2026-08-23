// 우리 모델 vs 북메이커 배당 정면 비교 (워크포워드).
//
// 배경: DEFAULT_MARKET_WEIGHT=0.4은 32~41회차 139경기라는 작은 표본으로 정한 값이다.
// football-data.co.uk CSV에는 시즌별 북메이커 종가배당이 같이 들어 있어, 백테스트와
// 동일한 4개 리그·4시즌(~4,300경기)에 대해 훨씬 큰 표본으로 재검증할 수 있다.
//
// 측정 대상
//   pure   : 우리 모델(배당 미반영)
//   market : 배당 암시확률(오버라운드 제거)
//   blend  : 둘을 marketWeight로 섞은 것 = 실제 서비스 동작
// 지표: top-pick 적중률 / Brier(다항) / 로그손실 / 무승부 확률 / 불일치 시 승자
// 마지막에 marketWeight를 0~1로 훑어 0.4가 실제로 최적인지 본다.
//
// 샌드박스에서는 football-data.co.uk가 막혀 있어 GitHub Actions 러너에서 실행한다.
// 실행: npx tsx scripts/compare_market.ts
import fs from "node:fs";
import path from "node:path";
import {
  computeEloAndHistory,
  recentForm,
  h2hDiff,
  leagueDrawRate,
  type MatchRow,
} from "../src/lib/elo";
import { predictMatch, DEFAULT_TOGGLES, type MarketOdds } from "../src/lib/prediction";

const LEAGUES: { league: string; fdCode: string }[] = [
  { league: "EPL", fdCode: "E0" },
  { league: "세리에A", fdCode: "I1" },
  { league: "라리가", fdCode: "SP1" },
  { league: "분데스리가", fdCode: "D1" },
];
const SEASONS = ["2324", "2425", "2526", "2627"];
const WARMUP = 15; // 백테스트와 동일: 팀당 15경기 이후부터 평가

type Outcome = 0 | 1 | 2; // H, D, A

interface Row extends MatchRow {
  market: MarketOdds | null;
  oddsSource: string;
}

function parseFdDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[2]}-${m[1]}`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// 배당 -> 암시확률. 합이 1을 넘는 만큼(오버라운드=북메이커 마진)을 비례 배분으로 제거한다.
// 정석은 Shin 모델이지만 비례 정규화가 표준적이고, 여기 결론(어느 쪽이 더 정확한가)은
// 그 선택에 좌우되지 않는다.
function impliedProbs(oh: number, od: number, oa: number): MarketOdds | null {
  if (!(oh > 1 && od > 1 && oa > 1)) return null;
  const rh = 1 / oh, rd = 1 / od, ra = 1 / oa;
  const s = rh + rd + ra;
  if (!(s > 1.0) || s > 1.5) return null; // 비정상 마진이면 버림
  return { pHome: rh / s, pDraw: rd / s, pAway: ra / s, nBookmakers: 1 };
}

// 종가 평균 -> 종가 B365 -> 개장 평균 -> 개장 B365 순으로 폴백
const ODDS_SETS: [string, string, string, string][] = [
  ["AvgCH", "AvgCD", "AvgCA", "종가평균"],
  ["B365CH", "B365CD", "B365CA", "종가B365"],
  ["AvgH", "AvgD", "AvgA", "개장평균"],
  ["B365H", "B365D", "B365A", "개장B365"],
];

async function fetchCsv(season: string, fdCode: string): Promise<string | null> {
  const url = `https://www.football-data.co.uk/mmz4281/${season}/${fdCode}.csv`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) { console.log(`  ${url} -> HTTP ${res.status} (스킵)`); return null; }
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
}

interface Metrics {
  n: number;
  hit: number;
  brier: number;
  logloss: number;
  sumDraw: number;
  drawTop: number;
}

function newMetrics(): Metrics {
  return { n: 0, hit: 0, brier: 0, logloss: 0, sumDraw: 0, drawTop: 0 };
}

function accumulate(m: Metrics, probs: [number, number, number], actual: Outcome): void {
  m.n++;
  const top = probs.indexOf(Math.max(...probs));
  if (top === actual) m.hit++;
  if (top === 1) m.drawTop++;
  m.sumDraw += probs[1];
  for (let i = 0; i < 3; i++) {
    const y = i === actual ? 1 : 0;
    m.brier += (probs[i] - y) ** 2;
  }
  m.logloss += -Math.log(Math.max(probs[actual], 1e-12));
}

function report(label: string, m: Metrics): void {
  console.log(
    `  ${label.padEnd(24)} 적중 ${((m.hit / m.n) * 100).toFixed(1)}%  ` +
      `Brier ${(m.brier / m.n).toFixed(4)}  ` +
      `로그손실 ${(m.logloss / m.n).toFixed(4)}  ` +
      `평균무 ${((m.sumDraw / m.n) * 100).toFixed(1)}%  ` +
      `무1픽 ${((m.drawTop / m.n) * 100).toFixed(1)}%`,
  );
}

async function main() {
  const rows: Row[] = [];
  const srcCount: Record<string, number> = {};

  for (const { league, fdCode } of LEAGUES) {
    for (const season of SEASONS) {
      const csv = await fetchCsv(season, fdCode);
      if (!csv) continue;
      const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const header = parseCsvLine(lines[0]);
      const idx = (c: string) => header.indexOf(c);
      const iDate = idx("Date"), iH = idx("HomeTeam"), iA = idx("AwayTeam");
      const iHg = idx("FTHG"), iAg = idx("FTAG");
      if ([iDate, iH, iA, iHg, iAg].some((i) => i < 0)) continue;

      for (const line of lines.slice(1)) {
        const c = parseCsvLine(line);
        const date = parseFdDate(c[iDate] ?? "");
        const home = (c[iH] ?? "").trim(), away = (c[iA] ?? "").trim();
        const hg = Number(c[iHg]), ag = Number(c[iAg]);
        if (!date || !home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;

        let market: MarketOdds | null = null;
        let oddsSource = "없음";
        for (const [ch, cd, ca, label] of ODDS_SETS) {
          const [a, b, d] = [idx(ch), idx(cd), idx(ca)];
          if (a < 0 || b < 0 || d < 0) continue;
          const p = impliedProbs(Number(c[a]), Number(c[b]), Number(c[d]));
          if (p) { market = p; oddsSource = label; break; }
        }
        srcCount[oddsSource] = (srcCount[oddsSource] ?? 0) + 1;
        rows.push({ league, date, home, away, hg, ag, market, oddsSource });
      }
    }
  }

  rows.sort((a, b) => (a.league === b.league ? a.date.localeCompare(b.date) : a.league.localeCompare(b.league)));
  console.log(`\n수집 ${rows.length}경기 | 배당 출처: ${JSON.stringify(srcCount)}`);

  const pure = newMetrics(), market = newMetrics(), blend = newMetrics();
  // marketWeight 스윕: 0.4가 실제로 최적인지 확인
  const weights = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const sweep = weights.map(() => newMetrics());

  let agree = 0, disagree = 0, pureWins = 0, marketWins = 0, bothWrong = 0;
  const byLeague: Record<string, { n: number; pure: number; market: number }> = {};

  const seen: MatchRow[] = [];
  const played = new Map<string, number>();

  for (const r of rows) {
    const kh = `${r.league}|${r.home}`, ka = `${r.league}|${r.away}`;
    const warm = (played.get(kh) ?? 0) >= WARMUP && (played.get(ka) ?? 0) >= WARMUP;

    if (warm && r.market) {
      const c = computeEloAndHistory(seen);
      const inputs = {
        eloDiff: c.elo.get(kh)!.elo - c.elo.get(ka)!.elo,
        formDiff:
          recentForm(c.teamHistory, r.league, r.home).avgPts -
          recentForm(c.teamHistory, r.league, r.away).avgPts,
        h2hDiff: h2hDiff(c.h2h, r.league, r.home, r.away).diff,
        leagueDrawRate: leagueDrawRate(seen, r.league),
        xgDiff: null,
        cornersDiff: null,
        league: r.league,
      };
      const actual: Outcome = r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2;

      const pp = predictMatch({ ...inputs, marketOdds: null }, { ...DEFAULT_TOGGLES, useMarketOdds: false });
      const pureP: [number, number, number] = [pp.pHome, pp.pDraw, pp.pAway];
      const mktP: [number, number, number] = [r.market.pHome, r.market.pDraw, r.market.pAway];
      const bp = predictMatch({ ...inputs, marketOdds: r.market }, DEFAULT_TOGGLES);
      const blendP: [number, number, number] = [bp.pHome, bp.pDraw, bp.pAway];

      accumulate(pure, pureP, actual);
      accumulate(market, mktP, actual);
      accumulate(blend, blendP, actual);

      for (let i = 0; i < weights.length; i++) {
        const w = predictMatch({ ...inputs, marketOdds: r.market }, { ...DEFAULT_TOGGLES, marketWeight: weights[i] });
        accumulate(sweep[i], [w.pHome, w.pDraw, w.pAway], actual);
      }

      const pt = pureP.indexOf(Math.max(...pureP));
      const mt = mktP.indexOf(Math.max(...mktP));
      if (pt === mt) agree++;
      else {
        disagree++;
        if (pt === actual) pureWins++;
        else if (mt === actual) marketWins++;
        else bothWrong++;
      }

      byLeague[r.league] ??= { n: 0, pure: 0, market: 0 };
      byLeague[r.league].n++;
      if (pt === actual) byLeague[r.league].pure++;
      if (mt === actual) byLeague[r.league].market++;
    }

    seen.push(r);
    played.set(kh, (played.get(kh) ?? 0) + 1);
    played.set(ka, (played.get(ka) ?? 0) + 1);
  }

  console.log(`\n=== 전체 비교 (평가 ${pure.n}경기, 팀당 ${WARMUP}경기 워밍업 후 + 배당 존재) ===`);
  console.log("  (Brier·로그손실은 낮을수록 좋음)");
  report("우리 모델(배당 미반영)", pure);
  report("배당 암시확률", market);
  report("혼합(현재 서비스, w=0.4)", blend);

  console.log(`\n=== 1픽 일치/불일치 ===`);
  console.log(`  일치 ${agree}건 (${((agree / pure.n) * 100).toFixed(1)}%) / 불일치 ${disagree}건`);
  if (disagree > 0) {
    console.log(
      `  불일치 시  우리 모델 적중 ${pureWins}건(${((pureWins / disagree) * 100).toFixed(1)}%)  ` +
        `배당 적중 ${marketWins}건(${((marketWins / disagree) * 100).toFixed(1)}%)  ` +
        `둘 다 실패 ${bothWrong}건(${((bothWrong / disagree) * 100).toFixed(1)}%)`,
    );
  }

  console.log(`\n=== 리그별 top-pick 적중률 ===`);
  for (const [lg, v] of Object.entries(byLeague)) {
    console.log(
      `  ${lg.padEnd(8)} n=${String(v.n).padStart(4)}  우리 ${((v.pure / v.n) * 100).toFixed(1)}%  ` +
        `배당 ${((v.market / v.n) * 100).toFixed(1)}%  차이 ${(((v.pure - v.market) / v.n) * 100).toFixed(1)}%p`,
    );
  }

  console.log(`\n=== marketWeight 스윕 (0=우리 모델만, 1=배당만) ===`);
  let bestAcc = -1, bestAccW = 0, bestBrier = Infinity, bestBrierW = 0;
  for (let i = 0; i < weights.length; i++) {
    const m = sweep[i];
    const acc = m.hit / m.n, br = m.brier / m.n;
    if (acc > bestAcc) { bestAcc = acc; bestAccW = weights[i]; }
    if (br < bestBrier) { bestBrier = br; bestBrierW = weights[i]; }
    report(`w=${weights[i].toFixed(1)}`, m);
  }
  console.log(`\n  적중률 최적 w=${bestAccW.toFixed(1)} (${(bestAcc * 100).toFixed(1)}%)`);
  console.log(`  Brier  최적 w=${bestBrierW.toFixed(1)} (${bestBrier.toFixed(4)})`);
  console.log(`  현재 기본값 w=0.4 -> 적중 ${((blend.hit / blend.n) * 100).toFixed(1)}%, Brier ${(blend.brier / blend.n).toFixed(4)}`);

  const out = {
    generatedAt: new Date().toISOString(),
    evaluated: pure.n,
    pure: { acc: pure.hit / pure.n, brier: pure.brier / pure.n, logloss: pure.logloss / pure.n },
    market: { acc: market.hit / market.n, brier: market.brier / market.n, logloss: market.logloss / market.n },
    blend04: { acc: blend.hit / blend.n, brier: blend.brier / blend.n, logloss: blend.logloss / blend.n },
    agreement: { agree, disagree, pureWins, marketWins, bothWrong },
    byLeague,
    sweep: weights.map((w, i) => ({ w, acc: sweep[i].hit / sweep[i].n, brier: sweep[i].brier / sweep[i].n })),
  };
  fs.writeFileSync(path.join(process.cwd(), "seed", "market_comparison.json"), JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n저장: seed/market_comparison.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
