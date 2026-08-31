// 유럽 4대리그 확신도 캘리브레이션을 새 marketWeight 기준으로 재산출한다.
//
// 왜 필요한가: calibration.ts의 구간별 적중률은 "모델 확률의 1위-2위 격차"로 백테스트한
// 값이다(EPL 전체 0.524는 실제로 배당 미반영 모델의 적중률과 일치한다). marketWeight를
// 0.4 -> 0.8로 올리면 확률 출처가 달라져 그 표가 더 이상 맞지 않는다. 등급 라벨은
// "확신픽이면 과거에 이만큼 맞았다"는 약속이므로, 근거를 갱신하지 않고 가중치만 바꾸면
// 화면이 검증되지 않은 등급을 표시하게 된다.
//
// 프로토콜은 기존 캘리브레이션과 동일: 워크포워드(그 경기 이전 데이터만), 팀당 15경기
// 워밍업 이후, calibration.ts와 같은 4구간. 데이터는 football-data(결과+배당 한 파일).
//
// 실행: npx tsx scripts/calibrate_market_blend.ts   (러너 전용)
import { buildFeatures, toProbs, blend, type Features, type MarketProbs } from "./lib/evalHarness";
import { DEFAULT_FORM_WEIGHT, DEFAULT_H2H_WEIGHT, EUROPEAN_MARKET_WEIGHT } from "../src/lib/prediction";
import type { MatchRow } from "../src/lib/elo";

const LEAGUES = [
  { league: "EPL", fdCode: "E0" },
  { league: "세리에A", fdCode: "I1" },
  { league: "라리가", fdCode: "SP1" },
  { league: "분데스리가", fdCode: "D1" },
];
const SEASONS = ["2324", "2425", "2526", "2627"];
// calibration.ts와 같은 구간 경계를 쓴다 - 구간까지 바꾸면 이전 값과 비교가 안 된다.
const BUCKETS: [number, number][] = [
  [0, 0.05],
  [0.05, 0.15],
  [0.15, 0.3],
  [0.3, 1.01],
];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const parseFdDate = (s: string) => {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  return m ? `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2]}-${m[1]}` : null;
};
function impliedProbs(oh: number, od: number, oa: number): MarketProbs | null {
  if (!(oh > 1 && od > 1 && oa > 1)) return null;
  const rh = 1 / oh, rd = 1 / od, ra = 1 / oa, s = rh + rd + ra;
  if (!(s > 1) || s > 1.5) return null;
  return { pHome: rh / s, pDraw: rd / s, pAway: ra / s };
}
const ODDS_SETS: [string, string, string][] = [
  ["AvgCH", "AvgCD", "AvgCA"], ["B365CH", "B365CD", "B365CA"],
  ["AvgH", "AvgD", "AvgA"], ["B365H", "B365D", "B365A"],
];

async function load(): Promise<{ rows: MatchRow[]; odds: Map<string, MarketProbs> }> {
  const rows: MatchRow[] = [];
  const odds = new Map<string, MarketProbs>();
  for (const { league, fdCode } of LEAGUES) {
    for (const season of SEASONS) {
      const url = `https://www.football-data.co.uk/mmz4281/${season}/${fdCode}.csv`;
      let csv: string;
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) { console.log(`  ${league} ${season}: HTTP ${r.status}`); continue; }
        csv = new TextDecoder("utf-8").decode(await r.arrayBuffer());
      } catch (e) { console.log(`  ${league} ${season}: ${(e as Error).message}`); continue; }
      const lines = csv.split(/\r?\n/).filter((l) => l.trim());
      const h = parseCsvLine(lines[0]);
      const ix = (c: string) => h.indexOf(c);
      for (const line of lines.slice(1)) {
        const c = parseCsvLine(line);
        const date = parseFdDate(c[ix("Date")] ?? "");
        const home = c[ix("HomeTeam")]?.trim(), away = c[ix("AwayTeam")]?.trim();
        const hg = Number(c[ix("FTHG")]), ag = Number(c[ix("FTAG")]);
        if (!date || !home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
        rows.push({ league, date, home, away, hg, ag });
        for (const [a, b, cc] of ODDS_SETS) {
          if (ix(a) < 0) continue;
          const p = impliedProbs(Number(c[ix(a)]), Number(c[ix(b)]), Number(c[ix(cc)]));
          if (p) { odds.set(`${league}|${date}|${home}|${away}`, p); break; }
        }
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows, odds };
}

function predict(f: Features, w: number) {
  const model = toProbs(
    f.eloDiff + f.homeAdv + DEFAULT_FORM_WEIGHT * f.formDiff + DEFAULT_H2H_WEIGHT * f.h2hDiff,
    f.drawBase,
    Math.abs(f.eloDiff),
  );
  const p = f.market ? blend(model, f.market, w) : model;
  const sorted = [...p].sort((a, b) => b - a);
  return { probs: p, top: p.indexOf(sorted[0]), gap: sorted[0] - sorted[1] };
}

async function main() {
  console.log("football-data 수집...");
  const { rows, odds } = await load();
  console.log(`${rows.length}경기, 배당 ${odds.size}건\n`);
  if (!rows.length) { console.log("데이터 없음."); process.exit(1); }

  const feats = buildFeatures(rows, {
    market: (m) => odds.get(`${m.league}|${m.date}|${m.home}|${m.away}`) ?? null,
  });

  for (const w of [0.4, EUROPEAN_MARKET_WEIGHT]) {
    console.log("=".repeat(72));
    console.log(w === 0.4 ? `marketWeight ${w} (종전 - 대조용)` : `marketWeight ${w} (신규 - calibration.ts에 반영할 값)`);
    console.log("=".repeat(72));
    for (const { league } of LEAGUES) {
      const sub = feats.filter((f) => f.league === league && f.market);
      if (!sub.length) continue;
      const stats = BUCKETS.map(() => ({ n: 0, hit: 0 }));
      let hit = 0;
      for (const f of sub) {
        const { top, gap } = predict(f, w);
        const bi = BUCKETS.findIndex(([lo, hi]) => gap >= lo && gap < hi);
        const ok = top === f.outcome;
        if (ok) hit++;
        if (bi >= 0) { stats[bi].n++; if (ok) stats[bi].hit++; }
      }
      console.log(`\n  "${league}": n=${sub.length}, 전체 적중률 ${(hit / sub.length * 100).toFixed(1)}%`);
      for (let i = 0; i < BUCKETS.length; i++) {
        const [lo, hi] = BUCKETS[i], s = stats[i];
        const acc = s.n ? s.hit / s.n : 0;
        console.log(`    { minGap: ${lo}, maxGap: ${hi}, accuracy: ${acc.toFixed(3)}, n: ${s.n} },`);
      }
    }
    console.log();
  }
  console.log("위 신규 블록을 calibration.ts의 해당 리그에 그대로 옮긴다.");
  console.log("주의: 구간 경계는 기존과 동일하게 유지했다(경계까지 바꾸면 이전 값과 비교가 안 된다).");
}

main();
