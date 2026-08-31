// 변수 검증 공용 하네스.
//
// 챗GPT 제안대로 "좋아 보이는 변수를 하나씩 추가"하는 방식 대신, 베이스라인을 고정하고
// 후보를 같은 프로토콜로 재는 방식으로 통일한다. 스크립트마다 워크포워드를 다시 짜면
// 미묘하게 달라져서 비교가 안 되므로(실제로 measure_rest / measure_h2h / measure_xg가
// 각자 복붙본을 갖고 있었다) 여기 한 곳에 모은다.
//
// 지표: 적중률 / Brier / 로그손실 / 캘리브레이션(ECE)
// 검증: 시간순 4분할 워크포워드 (train에서 하이퍼파라미터 선택 -> test에서만 평가)
import {
  h2hDiff as h2hDiffOf,
  leagueDrawRate,
  seasonOf,
  homeAdvForLeague,
  K_FACTOR,
  SEASON_REGRESSION,
  type MatchRow,
} from "../../src/lib/elo";
import { closenessAdjustedDrawRate } from "../../src/lib/drawCurve";

export const WARMUP = 15;
export const SPLITS = [0.5, 0.6, 0.7, 0.8];

export type Outcome = 0 | 1 | 2; // 홈승/무/원정승
export type Probs = [number, number, number];

export interface MarketProbs {
  pHome: number;
  pDraw: number;
  pAway: number;
}

// 각 경기 시점에 "그 경기 이전 정보만"으로 만들어진 피처들.
export interface Features {
  league: string;
  date: string;
  season: number;
  eloDiff: number;
  formDiff: number;
  h2hDiff: number;
  drawBase: number;
  homeAdv: number;
  market: MarketProbs | null;
  outcome: Outcome;
  // 리그별/스크립트별 추가 피처는 여기 담는다(xG 변형 등).
  extra: Record<string, number | null>;
}

export interface Metrics {
  n: number;
  acc: number;
  brier: number;
  logloss: number;
  ece: number; // 캘리브레이션 오차: 1픽 확률과 실제 적중률의 가중 절대차
}

function avgPts(h: number[]): number {
  const l = h.slice(-5);
  return l.length ? l.reduce((s, x) => s + x, 0) / l.length / 3 : 0;
}

export interface BuildOptions {
  // 경기별 부가 피처를 만드는 훅. 상태 갱신 전에 호출되므로 누수가 없다.
  extraFeatures?: (m: MatchRow, key: { home: string; away: string; season: number }) => Record<string, number | null>;
  // 상태 갱신 훅(예: xG 히스토리 누적). 피처 생성 이후에 호출된다.
  onMatch?: (m: MatchRow, key: { home: string; away: string; season: number }) => void;
  market?: (m: MatchRow) => MarketProbs | null;
}

// 워크포워드로 피처를 만든다. 정렬은 호출자가 날짜순으로 넘겨야 한다.
export function buildFeatures(rows: MatchRow[], opts: BuildOptions = {}): Features[] {
  const drawRates = new Map<string, number>();
  for (const lg of new Set(rows.map((r) => r.league))) drawRates.set(lg, leagueDrawRate(rows, lg));

  const elo = new Map<string, { elo: number; lastSeason: number }>();
  const hist = new Map<string, number[]>();
  const h2h = new Map<string, { home: string; hg: number; ag: number }[]>();
  const count = new Map<string, number>();
  const out: Features[] = [];

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

    if ((count.get(hk) ?? 0) >= WARMUP && (count.get(ak) ?? 0) >= WARMUP) {
      out.push({
        league: r.league,
        date: r.date,
        season,
        eloDiff: he.elo - ae.elo,
        formDiff: avgPts(hist.get(hk) ?? []) - avgPts(hist.get(ak) ?? []),
        h2hDiff: h2hDiffOf(h2h, r.league, r.home, r.away).diff,
        drawBase: drawRates.get(r.league)!,
        homeAdv: homeAdvForLeague(r.league),
        market: opts.market?.(r) ?? null,
        outcome: r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2,
        extra: opts.extraFeatures?.(r, { home: r.home, away: r.away, season }) ?? {},
      });
    }

    // 상태 갱신 (피처 생성 이후 - 누수 방지)
    const exp = 1 / (1 + 10 ** (-(he.elo - ae.elo + homeAdvForLeague(r.league)) / 400));
    const sc = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
    he.elo += K_FACTOR * (sc - exp);
    ae.elo -= K_FACTOR * (sc - exp);
    for (const [k, pts] of [
      [hk, r.hg > r.ag ? 3 : r.hg === r.ag ? 1 : 0],
      [ak, r.ag > r.hg ? 3 : r.hg === r.ag ? 1 : 0],
    ] as [string, number][]) {
      const h = hist.get(k) ?? [];
      h.push(pts);
      hist.set(k, h);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    const pk = `${r.league}|${[r.home, r.away].sort().join("|")}`;
    const arr = h2h.get(pk) ?? [];
    arr.push({ home: r.home, hg: r.hg, ag: r.ag });
    h2h.set(pk, arr);
    opts.onMatch?.(r, { home: r.home, away: r.away, season });
  }
  return out;
}

// 강도 항(Elo점수 단위)을 확률로 바꾼다. 모든 arm이 같은 무승부 모델을 쓰므로
// 비교가 강도 항 차이만 반영한다.
export function toProbs(strengthDiff: number, drawBase: number, absEloForDraw: number): Probs {
  const pHomeRaw = 1 / (1 + 10 ** (-strengthDiff / 400));
  const pDraw = closenessAdjustedDrawRate(drawBase, absEloForDraw);
  return [pHomeRaw * (1 - pDraw), pDraw, (1 - pHomeRaw) * (1 - pDraw)];
}

export function blend(model: Probs, market: MarketProbs, w: number): Probs {
  return [
    model[0] * (1 - w) + market.pHome * w,
    model[1] * (1 - w) + market.pDraw * w,
    model[2] * (1 - w) + market.pAway * w,
  ];
}

export function evaluate(items: { probs: Probs; outcome: Outcome }[]): Metrics {
  let hit = 0, brier = 0, ll = 0;
  // ECE: 1픽 확률을 10구간으로 나눠 (평균 확신도 - 실제 적중률) 가중 평균
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, hit: 0 }));
  for (const { probs, outcome } of items) {
    const top = probs.indexOf(Math.max(...probs));
    const correct = top === outcome;
    if (correct) hit++;
    for (let i = 0; i < 3; i++) brier += (probs[i] - (i === outcome ? 1 : 0)) ** 2;
    ll -= Math.log(Math.max(probs[outcome], 1e-12));
    const p = probs[top];
    const b = bins[Math.min(9, Math.max(0, Math.floor(p * 10)))];
    b.n++;
    b.conf += p;
    if (correct) b.hit++;
  }
  const n = items.length;
  let ece = 0;
  for (const b of bins) if (b.n > 0) ece += (b.n / n) * Math.abs(b.conf / b.n - b.hit / b.n);
  return { n, acc: hit / n, brier: brier / n, logloss: ll / n, ece };
}

export function fmtMetrics(m: Metrics): string {
  return `적중 ${(m.acc * 100).toFixed(2)}%  Brier ${m.brier.toFixed(4)}  로그손실 ${m.logloss.toFixed(4)}  ECE ${m.ece.toFixed(4)}`;
}

// 시간순 4분할. tune이 있으면 train에서 하이퍼파라미터를 고르고 test에서만 평가한다.
export function walkForward<T>(
  feats: Features[],
  predict: (f: Features, tuned: T) => Probs | null,
  tune: (train: Features[]) => T,
): { split: number; nTrain: number; nTest: number; tuned: T; base: Metrics | null; test: Metrics }[] {
  return SPLITS.map((frac) => {
    const cut = Math.floor(feats.length * frac);
    const train = feats.slice(0, cut);
    const test = feats.slice(cut);
    const tuned = tune(train);
    const items: { probs: Probs; outcome: Outcome }[] = [];
    for (const f of test) {
      const p = predict(f, tuned);
      if (p) items.push({ probs: p, outcome: f.outcome });
    }
    return { split: frac, nTrain: train.length, nTest: test.length, tuned, base: null, test: evaluate(items) };
  });
}
