// 모델픽-시장픽 합의여부 + 조건부 역배당 신호. 작업4(2026-08-06)에서 처음 "불일치+확신 n=2"로
// 보고했으나, 그때 쓴 "확신" 기준이 gap>=15%p라는 임의 값이었음이 이후(1~41회차 회고적 재구성,
// calibration.ts의 실제 확신픽 경계 30%p+ 기준 재검산) 드러남 - 올바른 기준으로 다시 보면
// "불일치+확신픽" 조합은 재구성 가능했던 63경기 중 단 한 번도 관측되지 않았다(n=0). 즉 이
// 신호는 "근거가 약하다" 정도가 아니라 "관측 사례가 아직 없다"는 뜻 - 그래도 사용자가 지금
// 구축하길 원해 만들지만, 절대 메인 예측픽을 덮어쓰지 않고 이 사실을 항상 같이 명시한다.
// 표본이 쌓이면(계속 로그만 남는 market_odds_history/round_vote_share) 재검증할 예정.
import type { ConfidenceTier } from "./calibration";
import type { MatchPrediction } from "./prediction";

export type Pick = "홈승" | "무승부" | "원정승";

export interface UpsetSignal {
  hasMarket: boolean;
  marketPick: Pick | null;
  agreement: "합의" | "불일치" | null; // market 없으면 null
  contrarian: boolean; // 불일치 && 모델 확신픽일 때만 true (작업4의 n=2 구간과 동일 조건)
  note: string;
}

function pickFromProbs(pHome: number, pDraw: number, pAway: number): Pick {
  if (pHome >= pDraw && pHome >= pAway) return "홈승";
  if (pDraw >= pAway) return "무승부";
  return "원정승";
}

export function computeUpsetSignal(
  prediction: MatchPrediction,
  market: { pHome: number; pDraw: number; pAway: number } | null,
  tier: ConfidenceTier,
): UpsetSignal {
  if (!market) {
    return { hasMarket: false, marketPick: null, agreement: null, contrarian: false, note: "" };
  }
  // 배당 그대로가 곧 예측인 경기(UCL/UEL 등)는 모델픽과 시장픽이 정의상 항상 같다.
  // 여기서 "합의"라고 표시하면 두 독립적인 근거가 일치한 것처럼 읽히므로 신호를 내지 않는다.
  if (prediction.basis !== "model") {
    return {
      hasMarket: true,
      marketPick: pickFromProbs(market.pHome, market.pDraw, market.pAway),
      agreement: null,
      contrarian: false,
      note: "이 경기는 예측 자체가 배당이라 모델픽과 시장픽을 비교할 수 없습니다.",
    };
  }
  const modelPick = prediction.rankedPicks[0];
  const marketPick = pickFromProbs(market.pHome, market.pDraw, market.pAway);
  const agreement = modelPick === marketPick ? "합의" : "불일치";
  const contrarian = agreement === "불일치" && tier === "확신픽";

  const note = contrarian
    ? "⚠️ 모델은 확신, 시장 배당은 반대 픽 - 2026-08-06 기준 이 조합의 관측 사례가 아직 없음(1~41회차 회고 검증 63건 중 0건), 판단 근거 없음. 참고만 하세요."
    : agreement === "불일치"
      ? "모델픽과 시장(해외배당) 픽이 다릅니다. 확신도가 낮아 역배당 신호로 보진 않습니다."
      : "모델픽과 시장(해외배당) 픽이 일치합니다.";

  return { hasMarket: true, marketPick, agreement, contrarian, note };
}
