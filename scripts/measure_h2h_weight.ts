// H2H(상대전적) 가중치가 실제로 값을 하는지 검증.
//
// 배경: 챗GPT 분석이 변수 중요도표에서 상대전적을 ★★☆☆☆로 낮게 매기고 "생각보다
// 과대평가하지 않는 것이 좋다"고 지적했다. 우리 모델의 DEFAULT_H2H_WEIGHT=50.0은
// 유럽 4대리그 백테스트 상관계수 비율(Elo 0.40 : 폼 0.27 : H2H 0.23)에서 나온 값인데,
// "단독 상관이 있다"와 "Elo·폼을 이미 쓴 뒤에도 추가 정보가 있다"는 서로 다른 얘기다.
// 상대전적은 Elo와 강하게 겹친다(강팀이 상대전적도 좋다) - 단독 상관은 그 겹침을 그대로
// 다시 세는 것이라 가중치 근거로 약하다.
//
// 그래서 여기서는 단독 상관이 아니라, 실제 모델에 넣고 뺐을 때 적중률/Brier/로그손실이
// 어떻게 변하는지를 워크포워드로 잰다. 데이터: seed/backfill_leagues.json (4리그 4시즌).
//
// 실행: npx tsx scripts/measure_h2h_weight.ts
import { readFileSync } from "node:fs";
import {
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

interface Ctx {
  league: string;
  eloDiff: number;
  formDiff: number;
  h2hDiff: number;
  h2hN: number;
  drawBase: number;
  homeAdv: number;
  outcome: 0 | 1 | 2;
}

function avgPts(h: number[]): number {
  const last = h.slice(-5);
  if (last.length === 0) return 0;
  return last.reduce((s, x) => s + x, 0) / last.length / 3;
}

function build(): Ctx[] {
  const raw = JSON.parse(readFileSync("seed/backfill_leagues.json", "utf8")) as MatchRow[];
  const rows = [...raw].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const drawRates = new Map<string, number>();
  for (const lg of new Set(rows.map((r) => r.league))) drawRates.set(lg, leagueDrawRate(rows, lg));

  const elo = new Map<string, { elo: number; lastSeason: number }>();
  const hist = new Map<string, number[]>();
  const h2h = new Map<string, { home: string; hg: number; ag: number }[]>();
  const count = new Map<string, number>();
  const out: Ctx[] = [];

  for (const r of rows) {
    const hk = `${r.league}|${r.home}`;
    const ak = `${r.league}|${r.away}`;
    const season = seasonOf(r.league, r.date);
    for (const k of [hk, ak]) {
      const st = elo.get(k) ?? { elo: 1500, lastSeason: season };
      if (st.lastSeason !== season) {
        st.elo += (1500 - st.elo) * SEASON_REGRESSION;
        st.lastSeason = season;
      }
      elo.set(k, st);
    }
    const he = elo.get(hk)!;
    const ae = elo.get(ak)!;
    const hd = h2hDiffOf(h2h, r.league, r.home, r.away);
    if ((count.get(hk) ?? 0) >= WARMUP && (count.get(ak) ?? 0) >= WARMUP) {
      out.push({
        league: r.league,
        eloDiff: he.elo - ae.elo,
        formDiff: avgPts(hist.get(hk) ?? []) - avgPts(hist.get(ak) ?? []),
        h2hDiff: hd.diff,
        h2hN: hd.n,
        drawBase: drawRates.get(r.league)!,
        homeAdv: homeAdvForLeague(r.league),
        outcome: r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2,
      });
    }
    const exp = 1 / (1 + 10 ** (-(he.elo - ae.elo + homeAdvForLeague(r.league)) / 400));
    const sc = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
    he.elo += K_FACTOR * (sc - exp);
    ae.elo -= K_FACTOR * (sc - exp);
    (hist.get(hk) ?? hist.set(hk, []).get(hk)!).push(r.hg > r.ag ? 3 : r.hg === r.ag ? 1 : 0);
    (hist.get(ak) ?? hist.set(ak, []).get(ak)!).push(r.ag > r.hg ? 3 : r.hg === r.ag ? 1 : 0);
    const pk = `${r.league}|${[r.home, r.away].sort().join("|")}`;
    (h2h.get(pk) ?? h2h.set(pk, []).get(pk)!).push({ home: r.home, hg: r.hg, ag: r.ag });
    count.set(hk, (count.get(hk) ?? 0) + 1);
    count.set(ak, (count.get(ak) ?? 0) + 1);
  }
  return out;
}

function evaluate(ctx: Ctx[], formW: number, h2hW: number) {
  let correct = 0,
    brier = 0,
    logloss = 0;
  for (const c of ctx) {
    const total = c.eloDiff + formW * c.formDiff + h2hW * c.h2hDiff;
    const pHomeRaw = 1 / (1 + 10 ** (-(total + c.homeAdv) / 400));
    const pDraw = closenessAdjustedDrawRate(c.drawBase, Math.abs(c.eloDiff));
    const p = [pHomeRaw * (1 - pDraw), pDraw, (1 - pHomeRaw) * (1 - pDraw)];
    if (p.indexOf(Math.max(...p)) === c.outcome) correct++;
    for (let i = 0; i < 3; i++) brier += (p[i] - (i === c.outcome ? 1 : 0)) ** 2;
    logloss -= Math.log(Math.max(p[c.outcome], 1e-9));
  }
  const n = ctx.length;
  return { acc: correct / n, brier: brier / n, ll: logloss / n };
}

function main() {
  const ctx = build();
  console.log(`평가 ${ctx.length}경기 (4리그 4시즌, 워밍업 ${WARMUP}경기 이후)`);
  const withH2H = ctx.filter((c) => c.h2hN > 0).length;
  console.log(`이 중 상대전적 기록이 1경기 이상 있는 경기: ${withH2H} (${((withH2H / ctx.length) * 100).toFixed(1)}%)\n`);

  console.log("── H2H 가중치만 바꿔가며 (formWeight는 현행 60 고정) ────────────");
  console.log("h2hWeight   적중률    Brier     로그손실");
  let best = { w: 0, ll: Infinity };
  for (const w of [0, 10, 20, 30, 50, 80, 120]) {
    const r = evaluate(ctx, DEFAULT_FORM_WEIGHT, w);
    if (r.ll < best.ll) best = { w, ll: r.ll };
    const mark = w === DEFAULT_H2H_WEIGHT ? "  <- 현행" : "";
    console.log(
      `${String(w).padStart(9)}   ${(r.acc * 100).toFixed(2)}%   ${r.brier.toFixed(4)}   ${r.ll.toFixed(4)}${mark}`,
    );
  }
  console.log(`로그손실 최적: h2hWeight = ${best.w}`);

  console.log("\n── 폼 가중치도 같이 (2차원) ────────────────────────────────────");
  console.log("        h2h=0    h2h=20   h2h=50   h2h=80");
  for (const fw of [0, 30, 60, 90]) {
    const cells = [0, 20, 50, 80].map((hw) => evaluate(ctx, fw, hw).ll.toFixed(4));
    console.log(`form=${String(fw).padStart(2)}  ${cells.join("   ")}`);
  }

  console.log("\n── 상대전적 기록이 있는 경기만 (H2H가 실제로 작동하는 부분집합) ──");
  const sub = ctx.filter((c) => c.h2hN >= 2);
  console.log(`n=${sub.length} (상대전적 2경기 이상)`);
  console.log("h2hWeight   적중률    Brier     로그손실");
  for (const w of [0, 20, 50, 80]) {
    const r = evaluate(sub, DEFAULT_FORM_WEIGHT, w);
    console.log(`${String(w).padStart(9)}   ${(r.acc * 100).toFixed(2)}%   ${r.brier.toFixed(4)}   ${r.ll.toFixed(4)}`);
  }
}

main();

// ── 추가: Elo 스케일 ────────────────────────────────────────────────────────
// measure_rest.ts의 대조군에서 "잔차 vs Elo격차" r=+0.044 (|t|=2.60, p<0.05)가 나왔다.
// 잔차에 Elo 신호가 남아 있다는 것은 모델이 Elo를 과소반영하고 있다는 뜻이다(과대반영이면
// 음의 상관이 나온다). 로지스틱의 분모 400을 줄이면(=스케일 배수를 키우면) 같은 Elo 격차가
// 더 큰 확률 격차로 번역된다. 실제로 개선되는지 확인한다.
function evalScaled(ctx: Ctx[], scale: number) {
  let correct = 0, brier = 0, logloss = 0;
  for (const c of ctx) {
    const total = (c.eloDiff + DEFAULT_FORM_WEIGHT * c.formDiff + DEFAULT_H2H_WEIGHT * c.h2hDiff + c.homeAdv) * scale;
    const pHomeRaw = 1 / (1 + 10 ** (-total / 400));
    const pDraw = closenessAdjustedDrawRate(c.drawBase, Math.abs(c.eloDiff));
    const p = [pHomeRaw * (1 - pDraw), pDraw, (1 - pHomeRaw) * (1 - pDraw)];
    if (p.indexOf(Math.max(...p)) === c.outcome) correct++;
    for (let i = 0; i < 3; i++) brier += (p[i] - (i === c.outcome ? 1 : 0)) ** 2;
    logloss -= Math.log(Math.max(p[c.outcome], 1e-9));
  }
  const n = ctx.length;
  return { acc: correct / n, brier: brier / n, ll: logloss / n };
}

console.log("\n── Elo 스케일 배수 (1.0 = 현행, 분모 400) ──────────────────────");
console.log("scale   유효분모   적중률    Brier     로그손실");
for (const s of [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) {
  const ctx2 = build();
  const r = evalScaled(ctx2, s);
  console.log(
    `${s.toFixed(1).padStart(5)}   ${String(Math.round(400 / s)).padStart(6)}   ${(r.acc * 100).toFixed(2)}%   ${r.brier.toFixed(4)}   ${r.ll.toFixed(4)}${s === 1.0 ? "  <- 현행" : ""}`,
  );
}
