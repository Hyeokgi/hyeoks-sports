// generateExclusivePick()가 투표율 신호가 있을 때만, 제한 내에서만 이변픽으로 뒤집는지 검증
import { describe, expect, it } from "vitest";
import {
  generateExclusivePick,
  DEFAULT_EXCLUSIVE_OPTIONS,
  type ExclusiveMatchInput,
} from "../src/lib/exclusivePick";
import type { MatchPrediction } from "../src/lib/prediction";

function pred(pHome: number, pDraw: number, pAway: number): MatchPrediction {
  const ranked: [MatchPrediction["rankedPicks"][number], number][] = [
    ["홈승", pHome],
    ["무승부", pDraw],
    ["원정승", pAway],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return {
    pHome,
    pDraw,
    pAway,
    rankedPicks: ranked.map((r) => r[0]),
    confidenceGap: ranked[0][1] - ranked[1][1],
  };
}

function match(
  seq: number,
  probs: [number, number, number],
  vote: [number, number, number] | null,
): ExclusiveMatchInput {
  return {
    seq,
    league: "K리그1",
    home: `홈${seq}`,
    away: `원정${seq}`,
    prediction: pred(...probs),
    voteShare: vote ? { home: vote[0], draw: vote[1], away: vote[2] } : null,
  };
}

describe("generateExclusivePick", () => {
  it("투표율이 전혀 없으면 기본 모델픽과 동일하다", () => {
    const matches = [match(1, [0.5, 0.3, 0.2], null), match(2, [0.2, 0.3, 0.5], null)];
    const result = generateExclusivePick(matches);
    expect(result.upsetCount).toBe(0);
    expect(result.matchesWithVote).toBe(0);
    expect(result.picks.map((p) => p.pick)).toEqual(result.picks.map((p) => p.basePick));
    expect(result.baseCrowdShare).toBeNull();
    expect(result.payoutEdge).toBeNull();
  });

  it("모델확률 비슷 + 대중이 덜 찍은 결과가 있으면 그쪽으로 뒤집는다", () => {
    // 홈승 42% vs 무승부 38%로 팽팽한데 대중은 홈승에 70% 쏠림, 무승부는 10%뿐
    const upsettable = match(1, [0.42, 0.38, 0.2], [70, 10, 20]);
    // 대중과 모델이 일치하는 평범한 경기
    const normal = match(2, [0.55, 0.25, 0.2], [55, 25, 20]);
    const result = generateExclusivePick([upsettable, normal]);
    expect(result.upsetCount).toBe(1);
    expect(result.picks[0].pick).toBe("무승부");
    expect(result.picks[0].basePick).toBe("홈승");
    expect(result.picks[0].isUpset).toBe(true);
    expect(result.picks[1].pick).toBe("홈승");
    expect(result.payoutEdge).toBeGreaterThan(1);
  });

  it("minAltProb보다 낮은 확률의 결과로는 절대 뒤집지 않는다(장거리 역배당 차단)", () => {
    // 원정승 10%는 대중이 2%만 찍어 가치비가 5배지만 확률이 너무 낮다
    const m = match(1, [0.7, 0.2, 0.1], [90, 8, 2]);
    const result = generateExclusivePick([m]);
    expect(result.picks[0].pick).toBe("홈승");
    expect(result.upsetCount).toBe(0);
  });

  it("maxUpsets 상한을 넘지 않는다", () => {
    const matches = [1, 2, 3, 4, 5].map((seq) => match(seq, [0.42, 0.38, 0.2], [70, 10, 20]));
    const result = generateExclusivePick(matches, { maxUpsets: 2 });
    expect(result.upsetCount).toBe(2);
  });

  it("minProbRetention 하한 밑으로 적중확률을 깎는 뒤집기는 하지 않는다", () => {
    // 뒤집기 1회당 확률이 절반이 되는 상황(0.5 -> 0.25): retention 0.5^2=0.25 < 0.35라 1회만 허용
    const matches = [1, 2, 3].map((seq) => match(seq, [0.5, 0.25, 0.25], [80, 5, 15]));
    const result = generateExclusivePick(matches, { minProbRetention: 0.35, minAltProb: 0.2 });
    expect(result.upsetCount).toBe(1);
    expect(result.probRetention).toBeGreaterThanOrEqual(0.35);
  });

  it("가치비 이득이 minValueGain 미만이면 뒤집지 않는다", () => {
    // 무승부가 약간 저평가지만(1.1배 수준) 기본 임계값 1.3배에 못 미침
    const m = match(1, [0.45, 0.35, 0.2], [50, 32, 18]);
    const result = generateExclusivePick(m ? [m] : []);
    expect(result.upsetCount).toBe(0);
  });

  it("확률/대중비중 요약이 곱으로 일관된다", () => {
    const matches = [match(1, [0.5, 0.3, 0.2], [60, 25, 15]), match(2, [0.4, 0.35, 0.25], [65, 15, 20])];
    const result = generateExclusivePick(matches);
    let p = 1;
    let q = 1;
    for (const pick of result.picks) {
      p *= pick.modelProb;
      q *= Math.max(pick.votePct! / 100, 0.005);
    }
    expect(result.pickHitProb).toBeCloseTo(p, 10);
    expect(result.pickCrowdShare!).toBeCloseTo(q, 10);
    expect(result.probRetention).toBeCloseTo(result.pickHitProb / result.baseHitProb, 10);
  });

  it("기본 옵션이 문서화된 값과 일치한다(가드)", () => {
    expect(DEFAULT_EXCLUSIVE_OPTIONS).toEqual({
      maxUpsets: 3,
      minProbRetention: 0.35,
      minAltProb: 0.2,
      minValueGain: 1.3,
    });
  });
});
