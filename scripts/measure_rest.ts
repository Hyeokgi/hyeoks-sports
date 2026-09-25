// 휴식일/일정강도(rest & congestion)가 승무패 예측에 추가 정보를 주는지 실측.
//
// 배경: 챗GPT 분석이 "휴식일 ★★★☆☆ / 일정강도 ★★★☆☆"로 제안한 변수다. 우리 모델에는
// 없다. seed/backfill_leagues.json(4개 리그 4시즌, 4,348경기)은 경기 날짜를 갖고 있으므로
// 외부 데이터 없이 오프라인에서 바로 검증할 수 있는 유일한 제안 변수다.
//
// 핵심 함정 - 교란(confounding):
//   휴식일이 짧은 팀은 대부분 유럽대항전을 병행하는 강팀이다. 그래서 "휴식 적은 팀이 이겼다"는
//   원시 상관은 휴식 효과가 아니라 강팀 효과일 수 있다. 따라서 원시 상관만 보면 안 되고,
//   Elo 모델이 이미 설명한 만큼을 뺀 "잔차"에 신호가 남는지를 봐야 한다.
//
// 한계(정직하게 기록):
//   이 데이터셋은 리그 경기만 담고 있다. 컵/유럽대항전 일정이 빠져 있어 실제 휴식일보다
//   길게 계산된다. 즉 여기서 재는 것은 "리그 일정 간격"이지 진짜 피로도가 아니다.
//   신호가 나오면 그건 하한(과소추정)이고, 안 나온다고 진짜 피로 효과가 없다는 뜻은 아니다.
//
// 실행: npx tsx scripts/measure_rest.ts
import { readFileSync } from "node:fs";
import {
  computeEloAndHistory,
  recentForm,
  h2hDiff as h2hDiffOf,
  leagueDrawRate,
  seasonOf,
  homeAdvForLeague,
  K_FACTOR,
  SEASON_REGRESSION,
  type MatchRow,
} from "../src/lib/elo";
import { closenessAdjustedDrawRate } from "../src/lib/drawCurve";
import { DEFAULT_FORM_WEIGHT, DEFAULT_H2H_WEIGHT } from "../src/lib/prediction";

const WARMUP = 15;
const MAX_REST_DAYS = 21; // 시즌 첫 경기/휴식기는 상한으로 자른다(이상치 방지)

interface Row extends MatchRow {
  homeRest: number | null;
  awayRest: number | null;
  homeCong: number; // 최근 14일간 경기 수(당 경기 제외)
  awayCong: number;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function loadRows(): Row[] {
  const raw = JSON.parse(readFileSync("seed/backfill_leagues.json", "utf8")) as MatchRow[];
  const sorted = [...raw].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lastPlayed = new Map<string, string>();
  const played = new Map<string, string[]>();
  const out: Row[] = [];
  for (const m of sorted) {
    const hk = `${m.league}|${m.home}`;
    const ak = `${m.league}|${m.away}`;
    const rest = (k: string): number | null => {
      const prev = lastPlayed.get(k);
      if (!prev) return null;
      const d = daysBetween(prev, m.date);
      return Math.min(d, MAX_REST_DAYS);
    };
    const cong = (k: string): number =>
      (played.get(k) ?? []).filter((d) => daysBetween(d, m.date) <= 14).length;
    out.push({
      ...m,
      homeRest: rest(hk),
      awayRest: rest(ak),
      homeCong: cong(hk),
      awayCong: cong(ak),
    });
    for (const k of [hk, ak]) {
      lastPlayed.set(k, m.date);
      const arr = played.get(k) ?? [];
      arr.push(m.date);
      played.set(k, arr);
    }
  }
  return out;
}

// 워크포워드로 각 경기 시점의 Elo/폼/H2H와 모델 확률을 만든다(backtest_league.ts와 동일 프로토콜).
interface Ctx {
  row: Row;
  eloDiff: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  restDiff: number;
  congDiff: number;
  outcome: 0 | 1 | 2;
}

function buildContexts(rows: Row[]): Ctx[] {
  const elo = new Map<string, { elo: number; lastSeason: number }>();
  const hist = new Map<string, { pts: number }[]>();
  const h2h = new Map<string, { home: string; hg: number; ag: number }[]>();
  const count = new Map<string, number>();
  const drawRates = new Map<string, number>();
  for (const lg of new Set(rows.map((r) => r.league))) {
    drawRates.set(lg, leagueDrawRate(rows as MatchRow[], lg));
  }

  const out: Ctx[] = [];
  for (const r of rows) {
    const hk = `${r.league}|${r.home}`;
    const ak = `${r.league}|${r.away}`;
    const season = seasonOf(r.league, r.date);
    for (const k of [hk, ak]) {
      const st = elo.get(k) ?? { elo: 1500, lastSeason: season };
      if (st.lastSeason !== season) {
        st.elo = st.elo + (1500 - st.elo) * SEASON_REGRESSION;
        st.lastSeason = season;
      }
      elo.set(k, st);
    }
    const he = elo.get(hk)!;
    const ae = elo.get(ak)!;
    const ready =
      (count.get(hk) ?? 0) >= WARMUP && (count.get(ak) ?? 0) >= WARMUP && r.homeRest != null && r.awayRest != null;

    if (ready) {
      const eloDiff = he.elo - ae.elo;
      const formDiff =
        avgPts(hist.get(hk) ?? []) - avgPts(hist.get(ak) ?? []);
      const hd = h2hDiffOf(h2h, r.league, r.home, r.away).diff; // h2hDiff는 {diff,n}을 반환한다
      const total = eloDiff + DEFAULT_FORM_WEIGHT * formDiff + DEFAULT_H2H_WEIGHT * hd;
      const pHomeRaw = 1 / (1 + 10 ** (-(total + homeAdvForLeague(r.league)) / 400));
      const pDraw = closenessAdjustedDrawRate(drawRates.get(r.league)!, Math.abs(eloDiff));
      out.push({
        row: r,
        eloDiff,
        pHome: pHomeRaw * (1 - pDraw),
        pDraw,
        pAway: (1 - pHomeRaw) * (1 - pDraw),
        restDiff: r.homeRest! - r.awayRest!,
        congDiff: r.homeCong - r.awayCong,
        outcome: r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2,
      });
    }

    // 상태 갱신
    const exp = 1 / (1 + 10 ** (-(he.elo - ae.elo + homeAdvForLeague(r.league)) / 400));
    const score = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
    he.elo += K_FACTOR * (score - exp);
    ae.elo -= K_FACTOR * (score - exp);
    pushHist(hist, hk, r.hg > r.ag ? 3 : r.hg === r.ag ? 1 : 0);
    pushHist(hist, ak, r.ag > r.hg ? 3 : r.hg === r.ag ? 1 : 0);
    const pairKey = `${r.league}|${[r.home, r.away].sort().join("|")}`;
    const arr = h2h.get(pairKey) ?? [];
    arr.push({ home: r.home, hg: r.hg, ag: r.ag });
    h2h.set(pairKey, arr);
    count.set(hk, (count.get(hk) ?? 0) + 1);
    count.set(ak, (count.get(ak) ?? 0) + 1);
  }
  return out;
}

function pushHist(m: Map<string, { pts: number }[]>, k: string, pts: number) {
  const arr = m.get(k) ?? [];
  arr.push({ pts });
  m.set(k, arr);
}
function avgPts(h: { pts: number }[]): number {
  const last = h.slice(-5);
  if (last.length === 0) return 0;
  return last.reduce((s, x) => s + x.pts, 0) / last.length / 3;
}

function fmtPct(x: number) {
  return (x * 100).toFixed(1) + "%";
}

function main() {
  const rows = loadRows();
  const ctx = buildContexts(rows);
  console.log(`평가 대상 ${ctx.length}경기 (워밍업 ${WARMUP}경기 이후, 전체 ${rows.length}경기 중)\n`);

  // ── 1. 원시 상관: 휴식일 격차 구간별 홈 실제 승점
  const buckets: [number, number, string][] = [
    [-99, -3.5, "홈이 4일+ 적게 쉼"],
    [-3.5, -1.5, "홈이 2~3일 적게 쉼"],
    [-1.5, 1.5, "비슷 (±1일)"],
    [1.5, 3.5, "홈이 2~3일 더 쉼"],
    [3.5, 99, "홈이 4일+ 더 쉼"],
  ];
  console.log("── 1. 휴식일 격차별 홈 성적 (원시) ─────────────────────────────");
  console.log("구간                  n     홈승    무     원정승   홈승점  모델기대  잔차");
  const resid: { label: string; n: number; diff: number }[] = [];
  for (const [lo, hi, label] of buckets) {
    const g = ctx.filter((c) => c.restDiff > lo && c.restDiff <= hi);
    if (g.length === 0) continue;
    const n = g.length;
    const h = g.filter((c) => c.outcome === 0).length;
    const d = g.filter((c) => c.outcome === 1).length;
    const a = g.filter((c) => c.outcome === 2).length;
    const actualPts = (h * 3 + d) / n;
    const expPts = g.reduce((s, c) => s + (c.pHome * 3 + c.pDraw), 0) / n;
    resid.push({ label, n, diff: actualPts - expPts });
    console.log(
      `${label.padEnd(20)} ${String(n).padStart(4)}  ${fmtPct(h / n).padStart(6)} ${fmtPct(d / n).padStart(6)} ${fmtPct(a / n).padStart(6)}  ${actualPts.toFixed(3)}  ${expPts.toFixed(3)}  ${(actualPts - expPts >= 0 ? "+" : "") + (actualPts - expPts).toFixed(3)}`,
    );
  }

  // ── 2. 잔차 상관계수: 모델이 설명하지 못한 부분과 휴식일 격차의 관계
  console.log("\n── 2. 잔차 상관 (모델이 못 잡은 부분 vs 휴식일 격차) ───────────");
  const pts = ctx.map((c) => (c.outcome === 0 ? 3 : c.outcome === 1 ? 1 : 0));
  const exp = ctx.map((c) => c.pHome * 3 + c.pDraw);
  const res = pts.map((p, i) => p - exp[i]);
  for (const [name, xs] of [
    ["휴식일 격차", ctx.map((c) => c.restDiff)],
    ["일정강도 격차(14일 경기수)", ctx.map((c) => c.congDiff)],
    ["[대조군] Elo 격차", ctx.map((c) => c.eloDiff)],
  ] as [string, number[]][]) {
    const r = pearson(xs, res);
    const t = Math.abs(r) * Math.sqrt((res.length - 2) / (1 - r * r));
    console.log(`${name.padEnd(28)} r = ${r >= 0 ? "+" : ""}${r.toFixed(4)}   |t| = ${t.toFixed(2)}   ${t > 1.96 ? "유의(p<0.05)" : "유의하지 않음"}`);
  }
  console.log("  * 대조군 Elo 격차의 r이 0에 가까우면 정상이다 - 모델이 이미 Elo를 썼으니");
  console.log("    잔차에 Elo 신호가 남아 있으면 안 된다. 이 줄은 잔차 계산이 맞는지 검증용이다.");

  // ── 3. 가중치를 실제로 넣어보고 적중률/Brier가 개선되는지
  console.log("\n── 3. restWeight를 모델에 넣었을 때 (Elo점수 환산) ──────────────");
  console.log("restWeight  적중률    Brier     무승부율");
  for (const w of [0, 2, 5, 10, 20, 40, -10]) {
    let correct = 0;
    let brier = 0;
    for (const c of ctx) {
      const total = Math.log10(c.pHome / c.pAway) * 400 + w * c.restDiff;
      const pHomeRaw = 1 / (1 + 10 ** (-total / 400));
      const p = [pHomeRaw * (1 - c.pDraw), c.pDraw, (1 - pHomeRaw) * (1 - c.pDraw)];
      const top = p.indexOf(Math.max(...p));
      if (top === c.outcome) correct++;
      for (let i = 0; i < 3; i++) brier += (p[i] - (i === c.outcome ? 1 : 0)) ** 2;
    }
    console.log(
      `${String(w).padStart(9)}  ${fmtPct(correct / ctx.length).padStart(7)}  ${(brier / ctx.length).toFixed(4)}`,
    );
  }
  console.log("\n판정 기준: 2번의 |t|가 1.96을 넘고 3번에서 w≠0이 w=0보다 적중률·Brier 둘 다");
  console.log("좋아야 채택할 가치가 있다. 하나라도 아니면 노이즈다.");
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

main();
