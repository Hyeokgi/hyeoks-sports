// 야구 예측. 축구 predictMatch와 같은 자리를 차지하지만 별도 모듈인 이유는 결과 구조가
// 다르기 때문이다(승1패의 "1"은 무승부가 아니라 점수차 구간이다 - types.ts 참고).
//
// 모든 상수는 실측에서 나왔다. 업계 통념이나 어림값이 아니고, 출처를 각 상수에 적어둔다.
import type { BaseballLeague, Seung1PaeOutcome, WinLoseOutcome } from "./types";

/**
 * Elo 파라미터. scripts/backtest_baseball.ts가 2023~2025 시간순 4분할에서 고른 값이다.
 * 두 리그 모두 '무조건 홈' 기준선을 4분할 전부에서 적중률·로그손실 모두 앞섰다.
 *   KBO  분할별 54.79 / 56.75 / 52.94 / 52.01%  (무조건 홈 51.18 / 51.30 / 50.56 / 50.59%)
 *   MLB  분할별 54.78 / 55.69 / 54.65 / 54.19%  (무조건 홈 53.32 / 53.80 / 53.65 / 53.44%)
 * homeAdv는 scripts/compare_baseball_market.ts가 2026 이전 경기에서만 추정한 값(Elo 점수).
 */
// 선발투수는 넣지 않는다. 후보로 검증했고 배포 구성에서 기준 미달이었다
// (scripts/measure_starter_signal.ts).
//   모델 단독      KBO 4/4 통과(w=20, 적중률 4분할 전부 개선) / MLB 1/4 미달
//   배당 위 증분   KBO 2/4 미달 - 배당이 이미 선발을 반영하고 있어 증분이 사라진다
//                  (축구에서 최근폼·H2H가 Elo와 겹쳐 증분 0이었던 것과 같은 패턴)
// KBO는 배당을 0.8로 쓰는 게 배포 구성이므로 '배당 위 증분'이 판단 기준이다.
// 덧붙여 KBO는 네이버 상세에 선발 결측이 많아(2024년 41%, 2025년 61%) 넣어도 절반만 적용된다.
export const ELO_PARAMS: Record<BaseballLeague, { k: number; seasonRegression: number; homeAdv: number }> = {
  KBO: { k: 4, seasonRegression: 0, homeAdv: 9.7 },
  MLB: { k: 6, seasonRegression: 0.25, homeAdv: 21.8 },
};

/**
 * 배당 블렌딩 가중치. 리그마다 정반대라 하나로 못 묶는다.
 *
 * scripts/compare_baseball_market.ts, 2026 프로토 배당 창에서 시간순 4분할.
 * train에서 고르고 test에서만 평가했으며 적중률을 기준에 포함했다.
 *
 *   KBO (n=333)  고정 w별 test 적중률/로그손실
 *     w=0.4  63.5%/0.6653   w=0.6  64.7%/0.6635
 *     w=0.8  67.1%/0.6623   w=1.0  65.9%/0.6615   -> 전부 4/4 통과
 *     0.8을 쓴다. 1.0은 모델을 통째로 버려 확신도 격차의 근거가 사라지는데, 마침
 *     0.8이 적중률에서 4분할 중 3개에서 1.0보다 낫다. 안전한 선택과 최선이 일치한다.
 *
 *   MLB (n=1,705)  w=0.4~1.0 어느 값도 4분할 전부에서 w=0보다 나빴다(0/4).
 *     블렌딩하지 않는다. 우리 Elo가 이 리그에서는 배당과 대등하거나 낫다.
 */
export const BASEBALL_MARKET_WEIGHT: Record<BaseballLeague, number> = {
  KBO: 0.8,
  MLB: 0.0,
};

/**
 * 1점차 구간의 기저확률. seed/kbo_games.json, seed/mlb_games.json 실측.
 *   KBO 2,736경기 중 23.14%   MLB 9,353경기 중 28.07%
 * 배당이 없을 때 "1"의 확률로 쓴다. 아래 predictSeung1Pae 주석에 왜 이걸 상수로 두는지 적었다.
 */
export const ONE_RUN_BASE_RATE: Record<BaseballLeague, number> = {
  KBO: 0.2314,
  MLB: 0.2807,
};

export interface BaseballMarketOdds {
  /** 승패 2택 배당 (프로토 betId 2). 오버라운드 제거 전 원본 배당 */
  winAllot?: number | null;
  loseAllot?: number | null;
  /** 승1패 3택 배당 (프로토 betId 108) */
  s1WinAllot?: number | null;
  s1DrawAllot?: number | null;
  s1LoseAllot?: number | null;
}

export interface BaseballInputs {
  league: BaseballLeague;
  /** 홈 - 원정 Elo 격차. 홈어드밴티지는 포함하지 않는다(여기서 더한다) */
  eloDiff: number;
  marketOdds?: BaseballMarketOdds | null;
}

export interface BaseballToggles {
  useElo: boolean;
  useMarketOdds: boolean;
  /** 지정하면 리그별 기본값 대신 이 값을 쓴다. 백테스트가 w를 훑을 때 필요하다 */
  marketWeight?: number;
}

export const DEFAULT_BASEBALL_TOGGLES: BaseballToggles = {
  useElo: true,
  useMarketOdds: true,
};

export type BaseballBasis = "model" | "market" | "blend" | "none";

export interface WinLosePrediction {
  pHome: number;
  pAway: number;
  pick: WinLoseOutcome;
  /** 1위와 2위의 확률 격차. 확신도 등급의 입력값 */
  confidenceGap: number;
  basis: BaseballBasis;
}

export interface Seung1PaePrediction {
  pWin: number;   // 홈 2점차 이상
  pOne: number;   // 1점차 (홈·원정 무관)
  pLose: number;  // 원정 2점차 이상
  rankedPicks: Seung1PaeOutcome[];
  confidenceGap: number;
  basis: BaseballBasis;
  /**
   * "1" 확률의 출처. 현재는 항상 "baseRate"다 - 배당에서 가져오는 쪽이 4분할 8/8에서
   * 졌기 때문이다. 필드를 남겨 두는 건 화면에 근거를 밝히기 위해서이고, 나중에 더 나은
   * 소스(선발투수 기반 총득점 모델 등)가 검증을 통과하면 여기 값이 바뀐다.
   */
  oneFrom: "market" | "baseRate";
}

/** 오버라운드 제거 - 역수 합으로 정규화 */
function devig(allots: number[]): number[] | null {
  if (allots.some((a) => !Number.isFinite(a) || a <= 1)) return null;
  const inv = allots.map((a) => 1 / a);
  const s = inv.reduce((x, y) => x + y, 0);
  if (!(s > 0)) return null;
  return inv.map((v) => v / s);
}

const clamp01 = (p: number) => Math.min(0.999, Math.max(0.001, p));

export function marketWeightForBaseball(league: BaseballLeague): number {
  return BASEBALL_MARKET_WEIGHT[league];
}

/**
 * 승패 2택.
 *
 * predictMatch와 같은 원칙으로, 이 함수는 받은 marketWeight를 그대로 쓴다. 리그를 보고
 * 몰래 바꾸지 않는다 - 축구에서 그렇게 했다가 백테스트가 특정 w에서만 조용히 다른 값으로
 * 계산되는 버그를 만들었다(회귀 테스트로 고정해 둔 동작이다).
 */
export function predictWinLose(inputs: BaseballInputs, toggles: BaseballToggles = DEFAULT_BASEBALL_TOGGLES): WinLosePrediction {
  const { homeAdv } = ELO_PARAMS[inputs.league];
  const w = toggles.useMarketOdds ? (toggles.marketWeight ?? marketWeightForBaseball(inputs.league)) : 0;

  const pModel = toggles.useElo
    ? clamp01(1 / (1 + Math.pow(10, -(inputs.eloDiff + homeAdv) / 400)))
    : null;

  const o = inputs.marketOdds;
  const pm = toggles.useMarketOdds && o?.winAllot && o?.loseAllot
    ? devig([o.winAllot, o.loseAllot])?.[0] ?? null
    : null;

  let pHome: number;
  let basis: BaseballBasis;
  if (pModel !== null && pm !== null && w > 0) {
    pHome = w * pm + (1 - w) * pModel;
    basis = w >= 1 ? "market" : "blend";
  } else if (pModel !== null) {
    pHome = pModel;
    basis = "model";
  } else if (pm !== null) {
    pHome = pm;
    basis = "market";
  } else {
    // 근거가 없으면 반반이라고 말한다. 홈어드밴티지만으로 픽을 내면 '가짜 신호'가 된다.
    return { pHome: 0.5, pAway: 0.5, pick: "승", confidenceGap: 0, basis: "none" };
  }

  pHome = clamp01(pHome);
  const pAway = 1 - pHome;
  return {
    pHome,
    pAway,
    pick: pHome >= pAway ? "승" : "패",
    confidenceGap: Math.abs(pHome - pAway),
    basis,
  };
}

/**
 * 승1패 3택.
 *
 * "1"을 예측하지 않고 기저확률/시장확률로 두는 이유가 이 모듈에서 가장 중요한 판단이다.
 *
 *   산수        이게 결정적이다. 총득점과 점수차는 홀짝이 같으므로 총득점이 짝수면
 *               1점차가 나올 수 없다. 실측으로 정확히 0건이다(KBO 짝수 1,163경기 중 0,
 *               MLB 3,855경기 중 0). 그래서 P(1) = P(총득점 홀수) x P(1 | 홀수)로 갈라지는데,
 *               앞쪽 홀짝은 예측되지 않는다 - 예측 총득점 5분위별 실제 홀수 비율이
 *               58.1 / 58.2 / 58.5 / 57.1 / 57.1%로 평평하다. 북메이커도 마찬가지다:
 *               프로토 '야구 SUM(홀짝)' 배당 1.59 / 2.07을 오버라운드 제거하면
 *               56.6% / 43.4%로 실제 홀수 비율과 사실상 같다. 아무도 예측하지 않는다.
 *   우리 모델   scripts/measure_baseball_sabr.ts에서 사슬을 끊어 재봤다. 총득점이 1점차
 *               확률을 크게 좌우하는 건 맞지만(총득점 구간별 46.8% ~ 14.7%, 32%p 스윙),
 *               사전정보로 총득점을 예측하는 고리가 R^2 0.70%에서 끊어졌다.
 *               선발투수를 넣어 개선을 시도했고 실제로 개선됐지만 미미하다
 *               (scripts/measure_starter_signal.ts: MLB 0.76->0.99%, KBO 0.89->1.62%).
 *               위 홀짝 제약 때문에 이 정도로는 "1"을 예측할 수 없다.
 *   시장        프로토 승1패 배당 2,521건으로 확인했다. 평균은 정확하다(시장 27.1% vs
 *               실제 27.0%). 그런데 변별력이 거의 없다 - 시장 암시확률 5분위별 실제
 *               1점차 비율이 26.1 / 24.2 / 28.6 / 26.7 / 29.6%로 단조 증가하지 않는다.
 *               시장 자신의 폭은 20.5~37.9%인데 실현값은 24~30%에 몰려 있다.
 *
 * 그래서 "1"은 리그 기저확률 상수로 두고, 나머지 (1 - P(1))을 승패 모델 비율로 나눈다.
 * 우리가 실제로 예측할 수 있는 것(누가 이기는가)만 예측하고, 못 하는 것(몇 점차인가)은
 * 예측하는 척하지 않는다.
 *
 * 두 가지를 배당으로 대체해 봤고 둘 다 기각됐다(scripts/compare_baseball_market.ts, 4분할).
 *   3택 전체 블렌딩   KBO 1/4, MLB 0/4 통과. 전체창만 보면 블렌딩이 최선처럼 보이지만
 *                     분할 test에서 뒤집힌다.
 *   "1"만 배당에서    8/8 분할 전부 기저확률 상수가 로그손실이 낮았다(적중률은 "1"을
 *                     어차피 못 고르므로 동일). 시장의 "1"은 평균만 맞고 변별력이 없다.
 * 그래서 승1패는 배당을 쓰지 않는다. 승패 2택(predictWinLose)에서 KBO가 0.8로 배당을
 * 크게 쓰는 것과 정반대인데, 서로 다른 상품이고 각각 따로 검증한 결과다.
 */
export function predictSeung1Pae(inputs: BaseballInputs, toggles: BaseballToggles = DEFAULT_BASEBALL_TOGGLES): Seung1PaePrediction {
  // 승/패 비율은 순수 모델로 낸다. 위 주석대로 3택에서는 블렌딩이 기준 미달이었다.
  const wl = predictWinLose(inputs, { ...toggles, marketWeight: 0 });

  const pOne = ONE_RUN_BASE_RATE[inputs.league];
  const oneFrom: "market" | "baseRate" = "baseRate";

  // 남은 확률을 승패 비율대로 나눈다. wl.basis가 none이면 5:5가 되어 결국 기저분포가 된다.
  const rest = Math.max(0, 1 - pOne);
  const pWin = rest * wl.pHome;
  const pLose = rest * wl.pAway;

  const ranked: Array<[Seung1PaeOutcome, number]> = [["승", pWin], ["1", pOne], ["패", pLose]];
  ranked.sort((a, b) => b[1] - a[1]);

  return {
    pWin,
    pOne,
    pLose,
    rankedPicks: ranked.map(([o2]) => o2),
    confidenceGap: ranked[0][1] - ranked[1][1],
    // 승1패 전체의 근거는 승패 쪽 근거를 따르되, "1"의 출처는 따로 밝힌다
    basis: wl.basis,
    oneFrom,
  };
}
