// generateSystemBet()가 예산을 넘지 않으면서 확신도 낮은 경기부터 헤지하는지 검증
import { describe, expect, it } from "vitest";
import { generateSystemBet, generateSystemBetTiers, UNIT_PRICE_WON, type ComboMatch } from "../src/lib/combinations";
import fixture from "./fixtures/round42_prediction_v2.json";

function buildMatches(): ComboMatch[] {
  return (fixture as any[]).map((row, i) => ({
    seq: i + 1,
    league: row.league,
    home: row.home,
    away: row.away,
    prediction: {
      pHome: row.p_home / 100,
      pDraw: row.p_draw / 100,
      pAway: row.p_away / 100,
      rankedPicks: row.ranked_picks,
      confidenceGap: row.confidence_gap / 100,
    },
  }));
}

describe("generateSystemBet", () => {
  it("never exceeds the budget", () => {
    const matches = buildMatches();
    for (const budget of [1_000, 5_000, 10_000, 30_000, 50_000, 100_000]) {
      const plan = generateSystemBet(matches, budget);
      expect(plan.totalCostWon).toBeLessThanOrEqual(budget);
      expect(plan.totalCombinations * UNIT_PRICE_WON).toBe(plan.totalCostWon);
    }
  });

  it("caps at the 100,000-won personal limit even if a larger budget is given", () => {
    const matches = buildMatches();
    const plan = generateSystemBet(matches, 500_000);
    expect(plan.totalCostWon).toBeLessThanOrEqual(100_000);
  });

  it("hedges the lowest-confidence match first", () => {
    const matches = buildMatches();
    const plan = generateSystemBet(matches, 10_000);
    const sorted = [...plan.picks].sort((a, b) => a.confidenceGap - b.confidenceGap);
    // 가장 확신도 낮은 경기(부산아이 vs 서울이랜, gap=1.3)는 1픽보다 커야 함
    expect(sorted[0].picks.length).toBeGreaterThan(1);
  });

  it("single-pick only when budget is below one combination", () => {
    const matches = buildMatches();
    const plan = generateSystemBet(matches, 500);
    expect(plan.totalCombinations).toBe(0);
    expect(plan.picks.every((p) => p.picks.length === 1)).toBe(true);
  });

  it("generateSystemBetTiers returns one plan per tier", () => {
    const matches = buildMatches();
    const plans = generateSystemBetTiers(matches);
    expect(plans).toHaveLength(5);
  });
});

describe("generateSystemBet guaranteeDrawCount", () => {
  it("forces 무승부 into the closest matches even when it's ranked 3rd", () => {
    const matches = buildMatches();
    // 확신도 1위 vs 2위 순서로 정렬했을 때 가장 낮은 두 경기 확인
    const sorted = [...matches].sort((a, b) => a.prediction.confidenceGap - b.prediction.confidenceGap);
    const closest = sorted[0];
    expect(closest.prediction.rankedPicks[2]).toBe("무승부"); // 부산아이 vs 서울이랜: 무승부가 3위

    const plan = generateSystemBet(matches, 100_000, UNIT_PRICE_WON, { guaranteeDrawCount: 1 });
    const pick = plan.picks.find((p) => p.home === closest.home && p.away === closest.away)!;
    expect(pick.picks).toContain("무승부");
  });

  it("never exceeds the budget even with guaranteeDrawCount set", () => {
    const matches = buildMatches();
    for (const budget of [5_000, 10_000, 30_000]) {
      const plan = generateSystemBet(matches, budget, UNIT_PRICE_WON, { guaranteeDrawCount: 3 });
      expect(plan.totalCostWon).toBeLessThanOrEqual(budget);
    }
  });
});
