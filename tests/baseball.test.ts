import { describe, expect, it } from "vitest";
import { seung1PaeOf, winLoseOf } from "../src/lib/baseball/types";
import {
  BASEBALL_MARKET_WEIGHT,
  ONE_RUN_BASE_RATE,
  predictSeung1Pae,
  predictWinLose,
} from "../src/lib/baseball/prediction";
import { generateBaseballBet, type BaseballComboMatch } from "../src/lib/baseball/combinations";

describe("승1패 결과 판정", () => {
  it("1점차는 홈·원정 무관하게 '1'이다 - 무승부가 아니라 점수차 구간이라서", () => {
    expect(seung1PaeOf(3, 2)).toBe("1");
    expect(seung1PaeOf(2, 3)).toBe("1");
    expect(seung1PaeOf(5, 3)).toBe("승");
    expect(seung1PaeOf(3, 5)).toBe("패");
  });

  it("무승부는 어느 구간도 아니라 null이다 - 추측해서 넣지 않는다", () => {
    // KBO는 연장 뒤 무승부가 있다(실측 2,736경기 중 58건). 토토 정산 규정을 확인하기
    // 전까지 임의 구간에 넣으면 조용히 틀린다.
    expect(seung1PaeOf(4, 4)).toBeNull();
    expect(winLoseOf(4, 4)).toBeNull();
  });
});

describe("승패 2택 예측", () => {
  it("Elo 격차가 0이어도 홈어드밴티지 때문에 홈이 앞선다", () => {
    const p = predictWinLose({ league: "KBO", eloDiff: 0 }, { useElo: true, useMarketOdds: false });
    expect(p.pHome).toBeGreaterThan(0.5);
    expect(p.pick).toBe("승");
    expect(p.basis).toBe("model");
  });

  it("근거가 하나도 없으면 5:5에 basis=none - 홈어드밴티지만으로 픽을 내지 않는다", () => {
    const p = predictWinLose({ league: "MLB", eloDiff: 0 }, { useElo: false, useMarketOdds: false });
    expect(p.pHome).toBe(0.5);
    expect(p.basis).toBe("none");
    expect(p.confidenceGap).toBe(0);
  });

  it("넘겨받은 marketWeight를 그대로 쓴다 - 리그를 보고 몰래 바꾸지 않는다", () => {
    // 축구에서 predictMatch가 리그별 가중치를 안에서 적용했다가, 백테스트가 w를 훑을 때
    // 특정 값만 조용히 다르게 계산되는 버그를 만들었다. 같은 실수를 막는 회귀 테스트다.
    const inputs = {
      league: "KBO" as const,
      eloDiff: 0,
      marketOdds: { winAllot: 1.5, loseAllot: 2.5 },
    };
    const w0 = predictWinLose(inputs, { useElo: true, useMarketOdds: true, marketWeight: 0 });
    const w1 = predictWinLose(inputs, { useElo: true, useMarketOdds: true, marketWeight: 1 });
    expect(w0.basis).toBe("model");
    expect(w1.basis).toBe("market");
    // 배당은 홈 우세(1.5 vs 2.5)이므로 w를 올리면 홈 확률이 커진다
    expect(w1.pHome).toBeGreaterThan(w0.pHome);
  });

  it("리그별 기본 가중치는 측정 결과를 따른다 - KBO만 배당을 쓴다", () => {
    // 4분할 홀드아웃: KBO는 w=0.8이 4/4 통과, MLB는 어떤 w도 0/4.
    expect(BASEBALL_MARKET_WEIGHT.KBO).toBe(0.8);
    expect(BASEBALL_MARKET_WEIGHT.MLB).toBe(0);
  });
});

describe("승1패 3택 예측", () => {
  const inputs = { league: "KBO" as const, eloDiff: 200 };

  it("'1'은 리그 기저확률 상수다 - 우리도 시장도 예측하지 못한 값이라서", () => {
    const p = predictSeung1Pae(inputs);
    expect(p.pOne).toBeCloseTo(ONE_RUN_BASE_RATE.KBO, 6);
    expect(p.oneFrom).toBe("baseRate");
  });

  it("배당을 줘도 '1'은 배당에서 가져오지 않는다 - 4분할 8/8에서 상수가 이겼다", () => {
    const withOdds = predictSeung1Pae({
      ...inputs,
      marketOdds: { s1WinAllot: 2.0, s1DrawAllot: 3.35, s1LoseAllot: 2.85 },
    });
    expect(withOdds.pOne).toBeCloseTo(ONE_RUN_BASE_RATE.KBO, 6);
  });

  it("세 확률의 합은 1이다", () => {
    const p = predictSeung1Pae(inputs);
    expect(p.pWin + p.pOne + p.pLose).toBeCloseTo(1, 10);
  });

  it("'1'은 절대 1순위가 될 수 없다 - 조합에서 덮어야 하는 구조적 이유", () => {
    // P(1)이 0.21~0.28이고 나머지를 승/패로 나누면 큰 쪽이 항상 0.36 이상이다.
    for (const league of ["KBO", "MLB"] as const) {
      for (const eloDiff of [-400, -150, -100, 0, 100, 150, 400]) {
        expect(predictSeung1Pae({ league, eloDiff }).rankedPicks[0]).not.toBe("1");
      }
    }
  });

  it("전력이 비슷하면 '1'이 최하위가 된다 - 복식이 아니라 삼복식이라야 덮인다", () => {
    // 처음엔 "1"이 항상 2위라고 봤는데 틀렸다. P(1)이 상수라 양팀이 비슷할수록 승/패가
    // 둘 다 "1"보다 커진다. 경계는 KBO |eloDiff+HA| > 146점, MLB > 78점이고,
    // 실제 경기의 |eloDiff| 중앙값이 KBO 27 / MLB 33이라 대부분 최하위다.
    expect(predictSeung1Pae({ league: "KBO", eloDiff: 0 }).rankedPicks).toEqual(["승", "패", "1"]);
    expect(predictSeung1Pae({ league: "KBO", eloDiff: 300 }).rankedPicks).toEqual(["승", "1", "패"]);
    expect(predictSeung1Pae({ league: "MLB", eloDiff: 0 }).rankedPicks).toEqual(["승", "패", "1"]);
    expect(predictSeung1Pae({ league: "MLB", eloDiff: 300 }).rankedPicks).toEqual(["승", "1", "패"]);
  });
});

describe("승1패 조합", () => {
  const mk = (seq: number, eloDiff: number): BaseballComboMatch => ({
    seq,
    league: "KBO",
    home: `H${seq}`,
    away: `A${seq}`,
    prediction: predictSeung1Pae({ league: "KBO", eloDiff }),
  });
  const matches = Array.from({ length: 14 }, (_, i) => mk(i + 1, (i - 7) * 40));

  it("예산을 넘지 않는다", () => {
    for (const budget of [5_000, 10_000, 30_000, 100_000]) {
      const plan = generateBaseballBet(matches, budget);
      expect(plan.totalCostWon).toBeLessThanOrEqual(budget);
      expect(plan.totalCombinations).toBe(
        plan.picks.reduce((n, p) => n * p.picks.length, 1),
      );
    }
  });

  it("1인 구매한도(10만원)를 넘겨 달라고 해도 한도에서 멈춘다", () => {
    const plan = generateBaseballBet(matches, 500_000);
    expect(plan.totalCostWon).toBeLessThanOrEqual(100_000);
  });

  it("auto면 예산이 커질수록 '1'을 더 많이 덮는다", () => {
    const small = generateBaseballBet(matches, 5_000, 1000, { guaranteeOneCount: "auto" });
    const large = generateBaseballBet(matches, 100_000, 1000, { guaranteeOneCount: "auto" });
    expect(large.oneCoveredCount).toBeGreaterThan(small.oneCoveredCount);
    expect(large.totalCostWon).toBeLessThanOrEqual(100_000);
  });

  it("'1'을 덮으려면 대개 삼복식이 필요해 10만원으로도 몇 경기 못 덮는다", () => {
    // 조합수가 경기당 3배로 뛰므로 100구좌면 3^4=81까지, 즉 4경기가 한계다.
    // 이건 생성기의 한계가 아니라 상품 구조라서 테스트로 고정해 둔다.
    const plan = generateBaseballBet(matches, 100_000, 1000, { guaranteeOneCount: "auto" });
    expect(plan.oneCoveredCount).toBeLessThanOrEqual(5);
    expect(plan.totalCostWon).toBeLessThanOrEqual(100_000);
    for (const p of plan.picks) {
      // 덮인 경기는 "1"이 실제로 픽에 들어가 있어야 한다
      if (p.oneForced) expect(p.picks).toContain("1");
    }
  });

  it("예산이 한 구좌도 안 되면 조합 0으로 돌려준다", () => {
    const plan = generateBaseballBet(matches, 500);
    expect(plan.totalCombinations).toBe(0);
    expect(plan.totalCostWon).toBe(0);
  });
});
