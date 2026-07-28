// predictMatch()가 predict_round42_v2.py(파이썬) 산출값과 일치하는지, 그리고 격차 보정 무승부율이 의도대로 동작하는지 검증
import { describe, expect, it } from "vitest";
import { predictMatch, DEFAULT_TOGGLES } from "../src/lib/prediction";
import fixture from "./fixtures/round42_prediction_v2.json";

const LEAGUE_DRAW_RATE: Record<string, number> = {
  "K리그1": 0.2849,
  "K리그2": 0.2893,
};

// 격차 보정을 끄면 predict_round42_v2.py(고정 리그 무승부율)의 산출값과 그대로 일치해야 한다
describe("predictMatch matches Python reference output (closeness adjustment off)", () => {
  const flatToggles = { ...DEFAULT_TOGGLES, useClosenessDrawAdjustment: false };
  for (const row of fixture as any[]) {
    it(`${row.home} vs ${row.away}`, () => {
      const result = predictMatch(
        {
          eloDiff: row.elo_diff,
          formDiff: row.form_diff,
          h2hDiff: row.h2h_diff,
          leagueDrawRate: LEAGUE_DRAW_RATE[row.league],
        },
        flatToggles,
      );

      expect(result.pHome * 100).toBeCloseTo(row.p_home, 0);
      expect(result.pDraw * 100).toBeCloseTo(row.p_draw, 0);
      expect(result.pAway * 100).toBeCloseTo(row.p_away, 0);
      expect(result.confidenceGap * 100).toBeCloseTo(row.confidence_gap, 0);
      expect(result.rankedPicks).toEqual(row.ranked_picks);
    });
  }
});

describe("closeness-adjusted draw rate (default toggles)", () => {
  it("gives a near-even matchup a higher draw probability than a lopsided one", () => {
    const even = predictMatch(
      { eloDiff: 5, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.2849 },
      DEFAULT_TOGGLES,
    );
    const lopsided = predictMatch(
      { eloDiff: 250, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.2849 },
      DEFAULT_TOGGLES,
    );
    expect(even.pDraw).toBeGreaterThan(lopsided.pDraw);
  });

  it("always sums the three outcome probabilities to 1", () => {
    for (const row of fixture as any[]) {
      const result = predictMatch(
        {
          eloDiff: row.elo_diff,
          formDiff: row.form_diff,
          h2hDiff: row.h2h_diff,
          leagueDrawRate: LEAGUE_DRAW_RATE[row.league],
        },
        DEFAULT_TOGGLES,
      );
      expect(result.pHome + result.pDraw + result.pAway).toBeCloseTo(1, 6);
    }
  });

  it("falls back to the flat rate when the toggle is off", () => {
    const withAdjustment = predictMatch(
      { eloDiff: 5, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.2849 },
      DEFAULT_TOGGLES,
    );
    const withoutAdjustment = predictMatch(
      { eloDiff: 5, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.2849 },
      { ...DEFAULT_TOGGLES, useClosenessDrawAdjustment: false },
    );
    expect(withoutAdjustment.pDraw).toBeCloseTo(0.2849, 6);
    expect(withAdjustment.pDraw).not.toBeCloseTo(withoutAdjustment.pDraw, 3);
  });
});
