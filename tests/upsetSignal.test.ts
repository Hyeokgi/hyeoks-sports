// computeUpsetSignal 동작 검증: 절대 픽을 안 바꾸고, contrarian은 "불일치+확신픽"일 때만 true.
import { describe, expect, it } from "vitest";
import { computeUpsetSignal } from "../src/lib/upsetSignal";
import type { MatchPrediction } from "../src/lib/prediction";

function pred(
  pHome: number,
  pDraw: number,
  pAway: number,
  basis: MatchPrediction["basis"] = "model",
): MatchPrediction {
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

describe("computeUpsetSignal", () => {
  it("시장 데이터 없으면 hasMarket=false, contrarian=false", () => {
    const s = computeUpsetSignal(pred(0.6, 0.2, 0.2), null, "확신픽");
    expect(s.hasMarket).toBe(false);
    expect(s.contrarian).toBe(false);
  });

  it("모델픽과 시장픽이 같으면 합의", () => {
    const s = computeUpsetSignal(pred(0.6, 0.2, 0.2), { pHome: 0.5, pDraw: 0.3, pAway: 0.2 }, "확신픽");
    expect(s.marketPick).toBe("홈승");
    expect(s.agreement).toBe("합의");
    expect(s.contrarian).toBe(false);
  });

  it("불일치+확신픽일 때만 contrarian=true", () => {
    const s = computeUpsetSignal(pred(0.6, 0.2, 0.2), { pHome: 0.2, pDraw: 0.3, pAway: 0.5 }, "확신픽");
    expect(s.agreement).toBe("불일치");
    expect(s.contrarian).toBe(true);
    expect(s.note).toContain("관측 사례가 아직 없음");
  });

  it("불일치여도 확신픽이 아니면 contrarian=false", () => {
    const s = computeUpsetSignal(pred(0.4, 0.35, 0.25), { pHome: 0.2, pDraw: 0.3, pAway: 0.5 }, "불확실");
    expect(s.agreement).toBe("불일치");
    expect(s.contrarian).toBe(false);
  });

  // 배당이 곧 예측인 경기(UCL/UEL)는 모델픽과 시장픽이 정의상 같아서 비교가 의미 없다.
  // "합의"로 표시하면 독립적인 두 근거가 맞아떨어진 것처럼 읽히므로 신호를 내면 안 된다.
  it("basis=market이면 합의/불일치 판정을 하지 않는다", () => {
    const s = computeUpsetSignal(pred(0.6, 0.25, 0.15, "market"), { pHome: 0.6, pDraw: 0.25, pAway: 0.15 }, "근거없음");
    expect(s.agreement).toBeNull();
    expect(s.contrarian).toBe(false);
    expect(s.marketPick).toBe("홈승");
  });
});
