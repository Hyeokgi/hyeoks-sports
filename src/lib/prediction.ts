// Elo/최근폼/상대전적/홈어드밴티지/리그별 무승부율을 토글 가능한 가중치로 결합해 승무패 확률을 계산
import { HOME_ADV } from "./elo";
import { closenessAdjustedDrawRate } from "./drawCurve";

// 1~41회차 실측 전체 리그 평균 무승부율 (리그별 값을 끄면 이 값으로 대체)
export const FALLBACK_DRAW_RATE = 0.271;

// 유럽 4대리그 백테스트 상관계수 비율(Elo 0.40 : 폼 0.27 : H2H 0.23 ≈ 1 : 0.68 : 0.58)에서 도출한 기본 가중치
export const DEFAULT_FORM_WEIGHT = 60.0;
export const DEFAULT_H2H_WEIGHT = 50.0;

// 2026-07-30: xG 격차는 별도 백테스트로 fit한 값이 아니라, xG 1점 차이가 대략 Elo 100점과
// 비슷한 무게를 갖는다는 축구 분석 업계 통념을 그대로 채택한 값(추후 조정 가능).
export const DEFAULT_XG_WEIGHT = 100.0;

// 2026-08-04: K리그2 한정, 최근5경기 평균 코너킥 격차 - train/test 4개 분할(50/50~80/20) 전부에서
// 정확도+Brier 개선 확인된 실증 가중치. 다른 리그(K리그1/J1리그)는 같은 방식으로 검증했을 때
// 무효/역효과라 corners_diff 자체를 계산해 넣지 않는다(round_predictions에서 항상 null).
export const DEFAULT_CORNERS_WEIGHT = 30.0;

export interface MarketOdds {
  pHome: number;
  pDraw: number;
  pAway: number;
  nBookmakers: number;
}

export interface PredictionInputs {
  eloDiff: number;
  formDiff: number;
  h2hDiff: number;
  leagueDrawRate: number;
  marketOdds?: MarketOdds | null; // 해외 북메이커 배당 기반 암시확률(오버라운드 제거됨), 없으면 미반영
  xgDiff?: number | null; // 팀 시즌 xG(공격-실점) 격차. K리그2는 FotMob에 데이터가 없어 null
  cornersDiff?: number | null; // 최근5경기 평균 코너킥 격차. K리그2 경기만 값이 있고 나머지는 null
}

export interface PredictionToggles {
  useElo: boolean;
  useForm: boolean;
  useH2H: boolean;
  useHomeAdvantage: boolean;
  useLeagueDrawRate: boolean; // false면 FALLBACK_DRAW_RATE 사용
  useClosenessDrawAdjustment: boolean; // true면 Elo 격차가 작을수록 무승부 확률을 실측 곡선으로 보정
  useMarketOdds: boolean; // true면 해외 배당 암시확률을 모델 확률과 블렌딩
  marketWeight: number; // 블렌딩 시 마켓 확률에 주는 가중치(0~1), 나머지는 모델 확률
  useXG: boolean; // true면 xG 격차 반영(xgDiff가 있는 경기에만 적용, K리그2는 자동 미적용)
  xgWeight: number;
  useCorners: boolean; // true면 코너킥 격차 반영(cornersDiff가 있는 경기, 즉 K리그2에만 적용)
  cornersWeight: number;
  formWeight: number;
  h2hWeight: number;
}

// 2026-07-30: 32~41회차 139경기 실측 백테스트 결과, 마켓 top-pick 적중률 45.3%
// (항상 홈승 찍기 38.1%와 큰 차이 없음), Brier score 0.6092(완전 무작위 0.667 대비 근소 우위).
// 특히 마켓이 40~50% 확신을 보인 구간(표본 37개)은 실제 적중률이 18.9%로 오히려 나빠서,
// 애초 계획했던 0.6 가중치는 과했다고 판단해 낮춘다.
export const DEFAULT_MARKET_WEIGHT = 0.4;

export const DEFAULT_TOGGLES: PredictionToggles = {
  useElo: true,
  useForm: true,
  useH2H: true,
  useHomeAdvantage: true,
  useLeagueDrawRate: true,
  useClosenessDrawAdjustment: true,
  useMarketOdds: true,
  marketWeight: DEFAULT_MARKET_WEIGHT,
  useXG: true,
  xgWeight: DEFAULT_XG_WEIGHT,
  useCorners: true,
  cornersWeight: DEFAULT_CORNERS_WEIGHT,
  formWeight: DEFAULT_FORM_WEIGHT,
  h2hWeight: DEFAULT_H2H_WEIGHT,
};

export interface MatchPrediction {
  pHome: number;
  pDraw: number;
  pAway: number;
  rankedPicks: ("홈승" | "무승부" | "원정승")[];
  confidenceGap: number;
}

export function predictMatch(
  inputs: PredictionInputs,
  toggles: PredictionToggles = DEFAULT_TOGGLES,
): MatchPrediction {
  const totalDiff =
    (toggles.useElo ? inputs.eloDiff : 0) +
    (toggles.useForm ? toggles.formWeight * inputs.formDiff : 0) +
    (toggles.useH2H ? toggles.h2hWeight * inputs.h2hDiff : 0) +
    (toggles.useXG && inputs.xgDiff != null ? toggles.xgWeight * inputs.xgDiff : 0) +
    (toggles.useCorners && inputs.cornersDiff != null ? toggles.cornersWeight * inputs.cornersDiff : 0);

  const homeAdv = toggles.useHomeAdvantage ? HOME_ADV : 0;
  const pHomeRaw = 1.0 / (1.0 + 10.0 ** (-(totalDiff + homeAdv) / 400.0));

  const baseDrawRate = toggles.useLeagueDrawRate ? inputs.leagueDrawRate : FALLBACK_DRAW_RATE;
  const pDraw0 = toggles.useClosenessDrawAdjustment
    ? closenessAdjustedDrawRate(baseDrawRate, Math.abs(inputs.eloDiff))
    : baseDrawRate;
  const pHome0 = pHomeRaw * (1 - pDraw0);
  const pAway0 = (1 - pHomeRaw) * (1 - pDraw0);

  let pHome = pHome0;
  let pDraw = pDraw0;
  let pAway = pAway0;

  if (toggles.useMarketOdds && inputs.marketOdds) {
    const w = toggles.marketWeight;
    pHome = w * inputs.marketOdds.pHome + (1 - w) * pHome0;
    pDraw = w * inputs.marketOdds.pDraw + (1 - w) * pDraw0;
    pAway = w * inputs.marketOdds.pAway + (1 - w) * pAway0;
  }

  const probs: [MatchPrediction["rankedPicks"][number], number][] = [
    ["홈승", pHome],
    ["무승부", pDraw],
    ["원정승", pAway],
  ];
  const ranked = [...probs].sort((a, b) => b[1] - a[1]);

  return {
    pHome,
    pDraw,
    pAway,
    rankedPicks: ranked.map((r) => r[0]),
    confidenceGap: ranked[0][1] - ranked[1][1],
  };
}
