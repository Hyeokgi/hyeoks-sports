// xG를 형태별로 나눠 검증한다.
//
// 배경: 앞선 실험에서 시즌누적 xG는 4/4 분할 실패(적중률 전부 하락), 롤링5는 3/4 통과로
// 갈렸다. 챗GPT의 해석은 "장기 전력 수준"과 "최근 경기내용의 변화"가 서로 다른 변수인데
// 우리가 둘을 같은 것으로 취급했다는 것이고, 그 해석은 위 결과와 일치한다.
// 시즌누적 xG는 Elo가 이미 재고 있는 것을 다시 재므로 중복이고, 변화량은 Elo에 없는 정보다.
//
// 그래서 다섯 형태를 같은 4분할 프로토콜로 나란히 잰다.
//   1 season    시즌누적 xGD/경기            (앱 createRound.computeXgDiff와 동일 = 현재 구현)
//   2 roll5     최근 5경기 평균 xGD
//   3 roll10    최근 10경기 평균 xGD
//   4 formDelta 최근5 - 시즌누적             (챗GPT 제안: xGD Momentum)
//   5 attDelta  공격 변화 - 실점 변화를 분리  (xG Form과 xGA Form을 따로 본 뒤 합성)
//
// 각 형태는 홈팀 값에서 원정팀 값을 뺀 격차로 모델에 들어간다.
// 채택 기준(코너킥 피처 때와 동일): 4개 분할 전부에서 적중률·Brier·로그손실이 나빠지지 않을 것.
// 적중률을 반드시 포함하는 이유: 승무패는 argmax 픽으로 돈이 오가므로 확률만 좋아지고
// 픽이 나빠지는 변경은 개선이 아니다(시즌누적 xG가 정확히 그랬다).
//
// 데이터: understat GET /getLeagueData/<리그>/<시즌> (js/league.min.js에서 확인한 엔드포인트).
// ── 실측 결과 (2026-08-31, understat 4,412경기 / 3,446~3,539경기 평가) ──────────
//
// 형태        잔차상관 r  |t|    4분할 통과   비고
//   season     +0.1021   6.02    0/4        적중률 4/4 하락 (= 앱 현재 구현)
//   roll5      +0.0994   5.94    3/4        0.8 분할만 로그손실에서 실패
//   roll10     +0.1099   6.58    0/4        적중률 4/4 하락
//   formDelta  +0.0156   0.91    3/4*       유의하지 않음. *선택 w가 10/5/5/0으로
//                                            0에 수렴 - "아무 것도 안 한 것"이 통과로
//                                            찍힌 것이지 개선이 아니다.
//
// 결론: 챗GPT의 핵심 가설(xGD Momentum = 최근 경기내용의 변화)은 기각된다.
//   잔차 상관이 |t|=0.91로 유의하지 않고, 4분할 어디서도 0이 아닌 가중치가 선택되지 않는다.
//
// 그런데 흥미로운 것은 "수준"을 재는 세 형태(season/roll5/roll10)가 전부 r=+0.10 안팎으로
// 강하게 유의하다는 점이다. 즉 잔차에 남은 xG 신호는 "최근에 좋아졌는가"가 아니라
// "이 팀이 원래 얼마나 좋은가"에서 온다. 그건 Elo가 이미 재는 것이라 중복이고,
// 실제로 셋 중 둘(season/roll10)은 적중률을 떨어뜨린다.
//
// roll5만 3/4인 이유도 "변화를 잡아서"가 아니라 창이 짧아 Elo와 덜 겹치기 때문으로 보인다.
// 어느 쪽이든 4/4 기준에 미달하므로 채택하지 않는다.
//
//   5 공수분리 (수정 후 재실행, 독립 가중치 2차원 그리드): 1/4 통과
//     잔차 상관  attForm r=+0.0079 |t|=0.46 / defForm r=+0.0157 |t|=0.92  둘 다 유의하지 않음
//     선택된 (wa,wd)는 (10,10)/(10,0)/(10,0)/(0,0)으로 역시 0에 수렴한다.
//     -> 공격 변화와 수비 변화를 따로 놓아도 결과는 formDelta와 같다. 합쳐서 신호가 없었던
//        게 두 항이 상쇄돼서가 아니라, 애초에 각각 신호가 없기 때문이었다.
//
// 설계 오류 기록: 처음에 5번째 형태를 attDelta = (최근공격-시즌공격) + (시즌실점-최근실점)
// 으로 두고 "공수 분리"라고 이름 붙였는데, 이건 분리가 아니었다.
//   (rF-sF) + (sA-rA) = (rF-rA) - (sF-sA) = roll5_xGD - season_xGD = formDelta
// 대수적으로 formDelta와 같은 값이라 실행 결과가 소수점까지 동일하게 나왔고, 그걸 보고서야
// 알았다. 진짜 분리는 두 항에 독립적인 가중치를 주는 것이라 2차원 그리드로 다시 짰다.
// ──────────────────────────────────────────────────────────────────────────────
// 샌드박스에서 막혀 있어 GitHub Actions 러너에서 실행한다.
import {
  buildFeatures,
  toProbs,
  evaluate,
  SPLITS,
  type Features,
  type Probs,
} from "./lib/evalHarness";
import { DEFAULT_FORM_WEIGHT, DEFAULT_H2H_WEIGHT } from "../src/lib/prediction";
import type { MatchRow } from "../src/lib/elo";

const LEAGUES = [
  { league: "EPL", understat: "EPL" },
  { league: "라리가", understat: "La_liga" },
  { league: "세리에A", understat: "Serie_A" },
  { league: "분데스리가", understat: "Bundesliga" },
];
const SEASONS = ["2023", "2024", "2025", "2026"];

interface XRow extends MatchRow {
  hxg: number;
  axg: number;
}

async function fetchSeason(understat: string, season: string): Promise<any[]> {
  const url = `https://understat.com/getLeagueData/${understat}/${season}`;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        referer: `https://understat.com/league/${understat}/${season}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) { console.log(`  !! ${understat} ${season}: HTTP ${res.status}`); return []; }
    const json = JSON.parse(await res.text());
    return Array.isArray(json?.dates) ? json.dates : [];
  } catch (e) {
    console.log(`  !! ${understat} ${season}: ${(e as Error).message}`);
    return [];
  }
}

async function load(): Promise<XRow[]> {
  const out: XRow[] = [];
  for (const { league, understat } of LEAGUES) {
    for (const season of SEASONS) {
      const rows = await fetchSeason(understat, season);
      let n = 0;
      for (const r of rows) {
        if (!r?.isResult) continue;
        const hg = Number(r.goals?.h), ag = Number(r.goals?.a);
        const hxg = Number(r.xG?.h), axg = Number(r.xG?.a);
        if (![hg, ag, hxg, axg].every(Number.isFinite)) continue;
        out.push({
          league, date: String(r.datetime).slice(0, 10),
          home: r.h?.title ?? "", away: r.a?.title ?? "", hg, ag, hxg, axg,
        });
        n++;
      }
      console.log(`  ${league} ${season}: ${n}경기`);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// 팀별 xG 이력 (시즌 태그 포함)
type Entry = { f: number; a: number; season: number };

const VARIANTS = ["season", "roll5", "roll10", "formDelta"] as const;
// 공수 분리는 가중치가 둘이라 1차원 그리드로 못 잰다 - 아래에서 따로 처리한다.
const PAIR_VARIANTS = ["attForm", "defForm"] as const;
type Variant = (typeof VARIANTS)[number];

const VARIANT_LABEL: Record<Variant, string> = {
  season: "1 season   시즌누적 xGD/경기  (= 앱 현재 구현)",
  roll5: "2 roll5    최근 5경기 평균 xGD",
  roll10: "3 roll10   최근 10경기 평균 xGD",
  formDelta: "4 formDelta 최근5 - 시즌누적 (xGD Momentum)",


};

function teamValues(hist: Entry[], season: number): Record<Variant | (typeof PAIR_VARIANTS)[number], number | null> {
  const cur = hist.filter((e) => e.season === season);
  const seasonAvg = cur.length ? cur.reduce((s, e) => s + (e.f - e.a), 0) / cur.length : null;
  const r5 = hist.slice(-5), r10 = hist.slice(-10);
  const roll5 = r5.length >= 5 ? r5.reduce((s, e) => s + (e.f - e.a), 0) / 5 : null;
  const roll10 = r10.length >= 10 ? r10.reduce((s, e) => s + (e.f - e.a), 0) / 10 : null;
  // 공격 변화(xG Form)와 수비 변화(xGA Form)를 따로 낸다.
  // 부호 규약: 공격이 좋아지면 +, 실점이 줄면 + (둘 다 팀에 유리한 방향).
  //
  // 처음엔 이 둘을 더해서 attDelta 하나로 만들었는데, 그건 분리가 아니었다:
  //   (rF-sF) + (sA-rA) = (rF-rA) - (sF-sA) = roll5_xGD - season_xGD = formDelta
  // 대수적으로 formDelta와 완전히 같은 값이라 실행 결과도 소수점까지 동일하게 나왔다.
  // 진짜로 분리하려면 두 항에 독립적인 가중치를 줘야 하므로 따로 내보낸다.
  let attForm: number | null = null;
  let defForm: number | null = null;
  if (cur.length > 0 && r5.length >= 5) {
    const sF = cur.reduce((s, e) => s + e.f, 0) / cur.length;
    const sA = cur.reduce((s, e) => s + e.a, 0) / cur.length;
    const rF = r5.reduce((s, e) => s + e.f, 0) / 5;
    const rA = r5.reduce((s, e) => s + e.a, 0) / 5;
    attForm = rF - sF;
    defForm = sA - rA;
  }
  return {
    season: seasonAvg,
    roll5,
    roll10,
    formDelta: seasonAvg != null && roll5 != null ? roll5 - seasonAvg : null,
    attForm,
    defForm,
  };
}

function baseStrength(f: Features): number {
  return f.eloDiff + f.homeAdv + DEFAULT_FORM_WEIGHT * f.formDiff + DEFAULT_H2H_WEIGHT * f.h2hDiff;
}

function predictWith(f: Features, v: Variant, w: number): Probs | null {
  const x = f.extra[v];
  if (x == null) return null;
  return toProbs(baseStrength(f) + w * x, f.drawBase, Math.abs(f.eloDiff));
}

function metricsFor(feats: Features[], v: Variant, w: number) {
  const items = [];
  for (const f of feats) {
    const p = predictWith(f, v, w);
    if (p) items.push({ probs: p, outcome: f.outcome });
  }
  return items.length ? evaluate(items) : null;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}

async function main() {
  console.log("understat 경기별 xG 수집 중...");
  const rows = await load();
  console.log(`\n총 ${rows.length}경기\n`);
  if (rows.length === 0) { console.log("데이터 없음. 결론 내지 말 것."); process.exit(1); }

  const xgHist = new Map<string, Entry[]>();
  const feats = buildFeatures(rows as MatchRow[], {
    extraFeatures: (m, k) => {
      const hv = teamValues(xgHist.get(`${m.league}|${k.home}`) ?? [], k.season);
      const av = teamValues(xgHist.get(`${m.league}|${k.away}`) ?? [], k.season);
      const out: Record<string, number | null> = {};
      for (const v of [...VARIANTS, ...PAIR_VARIANTS]) out[v] = hv[v] != null && av[v] != null ? hv[v]! - av[v]! : null;
      return out;
    },
    onMatch: (m, k) => {
      const r = m as XRow;
      for (const [key, f, a] of [
        [`${m.league}|${k.home}`, r.hxg, r.axg],
        [`${m.league}|${k.away}`, r.axg, r.hxg],
      ] as [string, number, number][]) {
        const h = xgHist.get(key) ?? [];
        h.push({ f, a, season: k.season });
        xgHist.set(key, h);
      }
    },
  });
  console.log(`워밍업 이후 평가 대상 ${feats.length}경기`);
  for (const v of [...VARIANTS, ...PAIR_VARIANTS]) console.log(`  ${v} 확보: ${feats.filter((f) => f.extra[v] != null).length}경기`);

  for (const v of VARIANTS) {
    const sub = feats.filter((f) => f.extra[v] != null);
    if (sub.length < 500) { console.log(`\n${VARIANT_LABEL[v]}: 표본 ${sub.length}개로 부족. 건너뜀.`); continue; }
    console.log("\n" + "═".repeat(76));
    console.log(VARIANT_LABEL[v]);
    console.log("═".repeat(76));

    // 잔차 상관: 베이스라인이 못 잡은 부분에 이 형태의 신호가 남아 있는가
    const resid = sub.map((f) => {
      const p = toProbs(baseStrength(f), f.drawBase, Math.abs(f.eloDiff));
      return (f.outcome === 0 ? 3 : f.outcome === 1 ? 1 : 0) - (p[0] * 3 + p[1]);
    });
    const r = pearson(sub.map((f) => f.extra[v]!), resid);
    const t = Math.abs(r) * Math.sqrt((resid.length - 2) / (1 - r * r));
    console.log(`잔차 상관 r = ${r >= 0 ? "+" : ""}${r.toFixed(4)}  |t| = ${t.toFixed(2)}  n = ${sub.length}  ${t > 1.96 ? (r > 0 ? "유의(부호 일치)" : "유의하나 부호 반대") : "유의하지 않음"}`);

    console.log("\n4분할 워크포워드 (train에서 w 선택 -> test에서만 평가)");
    console.log("분할  train/test   w    적중률(0->w)       Brier              로그손실           판정");
    let pass = 0;
    for (const frac of SPLITS) {
      const cut = Math.floor(sub.length * frac);
      const train = sub.slice(0, cut), test = sub.slice(cut);
      let bw = 0, bll = Infinity;
      for (let w = -150; w <= 150; w += 5) {
        const m = metricsFor(train, v, w);
        if (m && m.logloss < bll) { bll = m.logloss; bw = w; }
      }
      const b = metricsFor(test, v, 0)!, tu = metricsFor(test, v, bw)!;
      const ok = tu.acc >= b.acc && tu.brier <= b.brier && tu.logloss <= b.logloss;
      if (ok) pass++;
      console.log(
        `${frac.toFixed(1)}  ${String(train.length).padStart(5)}/${String(test.length).padEnd(5)} ${String(bw).padStart(4)}  ` +
          `${(b.acc * 100).toFixed(2)}->${(tu.acc * 100).toFixed(2)}%   ` +
          `${b.brier.toFixed(4)}->${tu.brier.toFixed(4)}   ` +
          `${b.logloss.toFixed(4)}->${tu.logloss.toFixed(4)}   ${ok ? "통과" : "실패"}`,
      );
    }
    console.log(`=> ${pass}/4 통과. ${pass === 4 ? "채택 기준 충족." : "채택 기준 미달."}`);
  }

  // ── 5. 공격변화/수비변화 분리 (가중치 2개, 2차원 그리드) ────────────────
  const sub2 = feats.filter((f) => f.extra.attForm != null && f.extra.defForm != null);
  if (sub2.length >= 500) {
    console.log("\n" + "═".repeat(76));
    console.log("5 공수 분리  attForm(공격변화) / defForm(수비변화) 를 독립 가중치로");
    console.log("═".repeat(76));
    for (const k of PAIR_VARIANTS) {
      const resid = sub2.map((f) => {
        const p = toProbs(baseStrength(f), f.drawBase, Math.abs(f.eloDiff));
        return (f.outcome === 0 ? 3 : f.outcome === 1 ? 1 : 0) - (p[0] * 3 + p[1]);
      });
      const r = pearson(sub2.map((f) => f.extra[k]!), resid);
      const t = Math.abs(r) * Math.sqrt((resid.length - 2) / (1 - r * r));
      console.log(`잔차 상관 ${k.padEnd(8)} r = ${r >= 0 ? "+" : ""}${r.toFixed(4)}  |t| = ${t.toFixed(2)}  ${t > 1.96 ? "유의" : "유의하지 않음"}`);
    }
    const pairMetrics = (fs: Features[], wa: number, wd: number) => {
      const items = [];
      for (const f of fs) {
        const a = f.extra.attForm, d = f.extra.defForm;
        if (a == null || d == null) continue;
        items.push({
          probs: toProbs(baseStrength(f) + wa * a + wd * d, f.drawBase, Math.abs(f.eloDiff)),
          outcome: f.outcome,
        });
      }
      return items.length ? evaluate(items) : null;
    };
    console.log("\n분할  train/test   (wa,wd)     적중률(0->w)       Brier              로그손실           판정");
    let pass = 0;
    for (const frac of SPLITS) {
      const cut = Math.floor(sub2.length * frac);
      const train = sub2.slice(0, cut), test = sub2.slice(cut);
      let bwa = 0, bwd = 0, bll = Infinity;
      for (let wa = -100; wa <= 100; wa += 10) {
        for (let wd = -100; wd <= 100; wd += 10) {
          const m = pairMetrics(train, wa, wd);
          if (m && m.logloss < bll) { bll = m.logloss; bwa = wa; bwd = wd; }
        }
      }
      const b = pairMetrics(test, 0, 0)!, tu = pairMetrics(test, bwa, bwd)!;
      const ok = tu.acc >= b.acc && tu.brier <= b.brier && tu.logloss <= b.logloss;
      if (ok) pass++;
      console.log(
        `${frac.toFixed(1)}  ${String(train.length).padStart(5)}/${String(test.length).padEnd(5)} (${String(bwa).padStart(4)},${String(bwd).padStart(4)})  ` +
          `${(b.acc * 100).toFixed(2)}->${(tu.acc * 100).toFixed(2)}%   ${b.brier.toFixed(4)}->${tu.brier.toFixed(4)}   ` +
          `${b.logloss.toFixed(4)}->${tu.logloss.toFixed(4)}   ${ok ? "통과" : "실패"}`,
      );
    }
    console.log(`=> ${pass}/4 통과. ${pass === 4 ? "채택 기준 충족." : "채택 기준 미달."}`);
  }

  console.log("\n" + "═".repeat(76));
  console.log("판정 기준: 4개 분할 전부에서 적중률·Brier·로그손실이 모두 나빠지지 않을 것.");
  console.log("(코너킥 피처를 채택할 때 쓴 것과 같은 기준)");
}

main();
