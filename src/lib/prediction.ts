// Elo/최근폼/상대전적/홈어드밴티지/리그별 무승부율을 토글 가능한 가중치로 결합해 승무패 확률을 계산
import { HOME_ADV, homeAdvForLeague } from "./elo";
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
  league?: string; // 리그별 HOME_ADV 조회용(elo.ts homeAdvForLeague) - 없으면 기본값(K리그 기준) 사용
  // true면 Elo/폼/H2H를 아예 쓰지 않고 배당 암시확률만 쓴다(가중치 1.0).
  // UCL/UEL처럼 서로 다른 리그 클럽이 붙는 대회는 Elo가 리그 내 상대평가라 비교 자체가
  // 성립하지 않는다 - 이때 eloDiff=0으로 두고 블렌딩하면 "홈어드밴티지만 반영된 가짜 모델"이
  // 배당을 60% 희석시킨다. 그래서 섞지 않고 배당을 그대로 쓴다.
  marketOnly?: boolean;
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
//
// 이 값은 시장이 얇은 리그(K리그/J1/MLS)에서만 계속 쓴다. 그쪽은 아직 큰 표본으로
// 검증된 적이 없어 기존 값을 유지하는 것이고, "검증됐다"는 뜻이 아니다.
export const DEFAULT_MARKET_WEIGHT = 0.4;

// 유럽 4대리그는 2026-08-31에 큰 표본으로 재측정해서 따로 정했다.
//
// 근거 (football-data 4리그 4시즌, 배당 보유 3,512경기, 시간순 4분할 홀드아웃):
//   w      분할0.5          분할0.6          분할0.7          분할0.8
//   0.4    53.76%/0.9811   53.45%/0.9842   52.56%/0.9933   52.63%/0.9952   <- 종전
//   0.8    54.38%/0.9715   54.02%/0.9749   52.94%/0.9845   53.20%/0.9857
//   1.0    54.61%/0.9689   54.38%/0.9724   53.32%/0.9822   53.34%/0.9833
//   train에서 로그손실 최적 w를 고르면 4개 분할 전부 1.00이 선택된다.
//
// 이 근거를 앱에 적용해도 되는지 따로 확인했다. 위 수치는 football-data의 북메이커
// 배당인데 앱은 wisetoto 표시 해외배당을 쓰기 때문이다(compare_odds_source.ts).
//   같은 경기 대조: 암시확률 평균 절대차 0.45%p, 홈승 확률 상관 r = 0.9994
//   -> 사실상 같은 시장이다. 근거가 전이된다.
//   (그래서 compare_market_d1.ts의 n=84 표본에서 "배당이 모델보다 나쁘다"고 나온 것은
//    노이즈로 본다. 그 표본은 84경기 중 56경기가 K리그/J1/MLS이고 McNemar p=0.386이다.)
//
// 측정된 최적은 1.0인데 0.8을 쓰는 이유: w=1.0은 모델을 완전히 버린다는 뜻이고, 그러면
// 확신도 등급(확신픽/보통/불확실)의 근거가 사라진다. 그 등급은 모델 확률의 1위-2위 격차로
// 백테스트한 값이라(calibration.ts) 확률 출처가 배당으로 바뀌면 그대로 쓸 수 없다.
// 1.0으로 가려면 배당 확률 기준으로 등급 체계를 다시 만들어야 하고, 그건 화면에 보이는
// 제품 변경이라 따로 결정할 일이다. 0.8은 0.4->1.0 개선분의 약 2/3를 가져오면서
// 모델을 블렌딩에 남겨 등급 체계를 유지한다(등급 자체는 0.8 기준으로 재산출했다).
export const EUROPEAN_MARKET_WEIGHT = 0.8;

const MARKET_WEIGHT_BY_LEAGUE: Record<string, number> = {
  EPL: EUROPEAN_MARKET_WEIGHT,
  라리가: EUROPEAN_MARKET_WEIGHT,
  세리에A: EUROPEAN_MARKET_WEIGHT,
  분데스리가: EUROPEAN_MARKET_WEIGHT,
};

export function marketWeightForLeague(league: string | undefined): number {
  if (!league) return DEFAULT_MARKET_WEIGHT;
  return MARKET_WEIGHT_BY_LEAGUE[league] ?? DEFAULT_MARKET_WEIGHT;
}

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

// 이 확률이 무엇에서 나왔는지. UI/리포트가 "모델 분석"과 "배당 그대로"를 구분해 표시하기 위한 것 -
// 백테스트 근거가 없는 확률을 있는 것처럼 보이게 하지 않는다.
//   model  : Elo+폼+H2H(+배당 블렌딩). 리그별 실측 캘리브레이션이 존재한다.
//   market : 배당 암시확률 그대로. 캘리브레이션 없음.
//   none   : 배당도 아직 없음. 아래 확률은 리그 평균 사전확률일 뿐 예측이 아니다.
export type PredictionBasis = "model" | "market" | "none";

export interface MatchPrediction {
  pHome: number;
  pDraw: number;
  pAway: number;
  rankedPicks: ("홈승" | "무승부" | "원정승")[];
  confidenceGap: number;
  basis: PredictionBasis;
}

function rank(pHome: number, pDraw: number, pAway: number, basis: PredictionBasis): MatchPrediction {
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
    basis,
  };
}

export function predictMatch(
  inputs: PredictionInputs,
  toggles: PredictionToggles = DEFAULT_TOGGLES,
): MatchPrediction {
  // 모델 피처가 없는 대회: 배당이 있으면 그대로, 없으면 리그 평균 사전확률(예측 아님).
  if (inputs.marketOnly) {
    if (inputs.marketOdds) {
      const m = inputs.marketOdds;
      return rank(m.pHome, m.pDraw, m.pAway, "market");
    }
    const d = inputs.leagueDrawRate || FALLBACK_DRAW_RATE;
    return rank((1 - d) / 2, d, (1 - d) / 2, "none");
  }

  const totalDiff =
    (toggles.useElo ? inputs.eloDiff : 0) +
    (toggles.useForm ? toggles.formWeight * inputs.formDiff : 0) +
    (toggles.useH2H ? toggles.h2hWeight * inputs.h2hDiff : 0) +
    (toggles.useXG && inputs.xgDiff != null ? toggles.xgWeight * inputs.xgDiff : 0) +
    (toggles.useCorners && inputs.cornersDiff != null ? toggles.cornersWeight * inputs.cornersDiff : 0);

  const homeAdv = toggles.useHomeAdvantage ? (inputs.league ? homeAdvForLeague(inputs.league) : HOME_ADV) : 0;
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
    // predictMatch는 받은 값을 그대로 쓴다. 리그별 가중치 적용은 호출부(predictRound)가
    // 한다 - 여기서 "값이 기본값과 같으면 리그값으로 바꾼다"는 식으로 처리했더니,
    // 백테스트가 w를 0부터 1까지 훑을 때 0.4 지점만 조용히 0.8로 바뀌었다.
    // 명시적으로 넘긴 값과 안 넘긴 값을 구분할 수 없는 sentinel이었다.
    const w = toggles.marketWeight;
    pHome = w * inputs.marketOdds.pHome + (1 - w) * pHome0;
    pDraw = w * inputs.marketOdds.pDraw + (1 - w) * pDraw0;
    pAway = w * inputs.marketOdds.pAway + (1 - w) * pAway0;
  }

  return rank(pHome, pDraw, pAway, "model");
}
