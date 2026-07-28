// Elo/최근폼/상대전적/홈어드밴티지/리그별 무승부율을 토글 가능한 가중치로 결합해 승무패 확률을 계산
import { HOME_ADV } from "./elo";
import { closenessAdjustedDrawRate } from "./drawCurve";

// 1~41회차 실측 전체 리그 평균 무승부율 (리그별 값을 끄면 이 값으로 대체)
export const FALLBACK_DRAW_RATE = 0.271;

// 유럽 4대리그 백테스트 상관계수 비율(Elo 0.40 : 폼 0.27 : H2H 0.23 ≈ 1 : 0.68 : 0.58)에서 도출한 기본 가중치
export const DEFAULT_FORM_WEIGHT = 60.0;
export const DEFAULT_H2H_WEIGHT = 50.0;

export interface PredictionInputs {
  eloDiff: number;
  formDiff: number;
  h2hDiff: number;
  leagueDrawRate: number;
}

export interface PredictionToggles {
  useElo: boolean;
  useForm: boolean;
  useH2H: boolean;
  useHomeAdvantage: boolean;
  useLeagueDrawRate: boolean; // false면 FALLBACK_DRAW_RATE 사용
  useClosenessDrawAdjustment: boolean; // true면 Elo 격차가 작을수록 무승부 확률을 실측 곡선으로 보정
  formWeight: number;
  h2hWeight: number;
}

export const DEFAULT_TOGGLES: PredictionToggles = {
  useElo: true,
  useForm: true,
  useH2H: true,
  useHomeAdvantage: true,
  useLeagueDrawRate: true,
  useClosenessDrawAdjustment: true,
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
    (toggles.useH2H ? toggles.h2hWeight * inputs.h2hDiff : 0);

  const homeAdv = toggles.useHomeAdvantage ? HOME_ADV : 0;
  const pHomeRaw = 1.0 / (1.0 + 10.0 ** (-(totalDiff + homeAdv) / 400.0));

  const baseDrawRate = toggles.useLeagueDrawRate ? inputs.leagueDrawRate : FALLBACK_DRAW_RATE;
  const pDraw = toggles.useClosenessDrawAdjustment
    ? closenessAdjustedDrawRate(baseDrawRate, Math.abs(inputs.eloDiff))
    : baseDrawRate;
  const pHome = pHomeRaw * (1 - pDraw);
  const pAway = (1 - pHomeRaw) * (1 - pDraw);

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
