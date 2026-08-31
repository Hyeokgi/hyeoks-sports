// predictMatch()가 predict_round42_v2.py(파이썬) 산출값과 일치하는지, 그리고 격차 보정 무승부율이 의도대로 동작하는지 검증
import { describe, expect, it } from "vitest";
import {
  predictMatch,
  DEFAULT_TOGGLES,
  DEFAULT_MARKET_WEIGHT,
  EUROPEAN_MARKET_WEIGHT,
  marketWeightForLeague,
} from "../src/lib/prediction";
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

  // UCL/UEL처럼 Elo가 성립하지 않는 대회: 배당을 섞지 않고 그대로 쓴다.
  // eloDiff에 값이 들어와 있어도 무시해야 한다(round_predictions에는 0이 저장되지만,
  // 혹시라도 값이 새어들어와도 예측이 오염되지 않는지 확인).
  it("marketOnly면 배당 암시확률을 그대로 쓰고 모델 성분을 무시한다", () => {
    const market = { pHome: 0.751, pDraw: 0.154, pAway: 0.095, nBookmakers: 7 };
    const p = predictMatch(
      { eloDiff: 400, formDiff: 3, h2hDiff: 1, leagueDrawRate: 0.27, marketOdds: market, marketOnly: true },
      DEFAULT_TOGGLES,
    );
    expect(p.pHome).toBeCloseTo(0.751, 10);
    expect(p.pDraw).toBeCloseTo(0.154, 10);
    expect(p.pAway).toBeCloseTo(0.095, 10);
    expect(p.basis).toBe("market");
    expect(p.rankedPicks[0]).toBe("홈승");
  });

  // 배당이 아직 안 붙은 상태. 여기서 홈승을 추천하면 근거 없는 픽이 된다.
  it("marketOnly인데 배당이 없으면 basis=none, 홈/원정 확률이 같다", () => {
    const p = predictMatch(
      { eloDiff: 0, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.27, marketOdds: null, marketOnly: true },
      DEFAULT_TOGGLES,
    );
    expect(p.basis).toBe("none");
    expect(p.pHome).toBeCloseTo(p.pAway, 10);
    expect(p.pDraw).toBeCloseTo(0.27, 10);
  });

  it("일반 경기는 basis=model", () => {
    const p = predictMatch({ eloDiff: 50, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.27 }, DEFAULT_TOGGLES);
    expect(p.basis).toBe("model");
  });
});

describe("리그별 marketWeight", () => {
  const market = { pHome: 0.6, pDraw: 0.25, pAway: 0.15, nBookmakers: 3 };
  const base = {
    eloDiff: 0,
    formDiff: 0,
    h2hDiff: 0,
    leagueDrawRate: 0.27,
    marketOdds: market,
  };

  it("predictMatch는 넘겨받은 marketWeight를 그대로 쓴다(리그를 보고 몰래 바꾸지 않는다)", () => {
    // 회귀 테스트. 한때 'marketWeight가 기본값(0.4)과 같으면 리그별 값으로 교체'하는
    // sentinel을 뒀는데, 그러면 백테스트가 w를 훑을 때 0.4 지점만 조용히 다른 값이 되어
    // 측정이 오염된다. 명시적으로 넘긴 0.4와 안 넘긴 것을 구분할 수 없기 때문이다.
    const epl = predictMatch(
      { ...base, league: "EPL" },
      { ...DEFAULT_TOGGLES, marketWeight: DEFAULT_MARKET_WEIGHT },
    );
    const k1 = predictMatch(
      { ...base, league: "K리그1" },
      { ...DEFAULT_TOGGLES, marketWeight: DEFAULT_MARKET_WEIGHT },
    );
    expect(epl.pHome).toBeCloseTo(k1.pHome, 10);
  });

  it("marketWeightForLeague는 유럽 4대리그만 높은 값을 준다", () => {
    for (const lg of ["EPL", "라리가", "세리에A", "분데스리가"]) {
      expect(marketWeightForLeague(lg)).toBe(EUROPEAN_MARKET_WEIGHT);
    }
    for (const lg of ["K리그1", "K리그2", "J1리그", "MLS"]) {
      expect(marketWeightForLeague(lg)).toBe(DEFAULT_MARKET_WEIGHT);
    }
    expect(marketWeightForLeague(undefined)).toBe(DEFAULT_MARKET_WEIGHT);
    expect(marketWeightForLeague("UCL")).toBe(DEFAULT_MARKET_WEIGHT);
  });

  it("가중치가 커지면 배당 쪽으로 더 끌린다", () => {
    const low = predictMatch({ ...base, league: "EPL" }, { ...DEFAULT_TOGGLES, marketWeight: 0.4 });
    const high = predictMatch({ ...base, league: "EPL" }, { ...DEFAULT_TOGGLES, marketWeight: 0.8 });
    expect(Math.abs(high.pHome - market.pHome)).toBeLessThan(Math.abs(low.pHome - market.pHome));
  });
});
