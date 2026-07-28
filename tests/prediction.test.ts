// predictMatch()가 predict_round42_v2.py(파이썬) 산출값과 일치하는지 검증
import { describe, expect, it } from "vitest";
import { predictMatch, DEFAULT_TOGGLES } from "../src/lib/prediction";
import fixture from "./fixtures/round42_prediction_v2.json";

const LEAGUE_DRAW_RATE: Record<string, number> = {
  "K리그1": 0.2849,
  "K리그2": 0.2893,
};

describe("predictMatch matches Python reference output", () => {
  for (const row of fixture as any[]) {
    it(`${row.home} vs ${row.away}`, () => {
      const result = predictMatch(
        {
          eloDiff: row.elo_diff,
          formDiff: row.form_diff,
          h2hDiff: row.h2h_diff,
          leagueDrawRate: LEAGUE_DRAW_RATE[row.league],
        },
        DEFAULT_TOGGLES,
      );

      expect(result.pHome * 100).toBeCloseTo(row.p_home, 0);
      expect(result.pDraw * 100).toBeCloseTo(row.p_draw, 0);
      expect(result.pAway * 100).toBeCloseTo(row.p_away, 0);
      expect(result.confidenceGap * 100).toBeCloseTo(row.confidence_gap, 0);
      expect(result.rankedPicks).toEqual(row.ranked_picks);
    });
  }
});
