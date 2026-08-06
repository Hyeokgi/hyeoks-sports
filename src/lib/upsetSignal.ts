// 모델픽-시장픽 합의여부 + 조건부 역배당 신호. 작업4(2026-08-06, n=45, betman 1~41회차)
// 근거: "불일치+확신픽" 구간이 n=2로 통계적으로 무의미함을 사용자에게 확인받고도 지금 바로
// 구축하기로 함 - 그래서 이 신호는 절대 메인 예측픽을 덮어쓰지 않고, 표본 부족을 항상 같이
// 명시하는 참고용 부가 정보로만 노출한다. 표본이 쌓이면(계속 로그만 남는 market_odds_history/
// round_vote_share) 재검증해서 근거가 쌓이면 그때 실제 추천 강도를 올린다.
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
  const modelPick = prediction.rankedPicks[0];
  const marketPick = pickFromProbs(market.pHome, market.pDraw, market.pAway);
  const agreement = modelPick === marketPick ? "합의" : "불일치";
  const contrarian = agreement === "불일치" && tier === "확신픽";

  const note = contrarian
    ? "⚠️ 모델은 확신, 시장 배당은 반대 픽 - 2026-08-06 기준 이 조합 과거 표본 n=2뿐(둘 다 모델이 틀림), 통계적으로 신뢰 불가. 참고만 하세요."
    : agreement === "불일치"
      ? "모델픽과 시장(해외배당) 픽이 다릅니다. 확신도가 낮아 역배당 신호로 보진 않습니다."
      : "모델픽과 시장(해외배당) 픽이 일치합니다.";

  return { hasMarket: true, marketPick, agreement, contrarian, note };
}
