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
      forceDrawCount: 0,
    });
  });
});

describe("generateExclusivePick forceDrawCount", () => {
  it("가치비가 가장 좋은 무승부 슬롯부터 N개를 강제로 채운다", () => {
    // 1번: 무승부 크게 저평가(모델 25% vs 투표 10%), 2번: 무승부 과대베팅(29% vs 40%)
    const undervalued = match(1, [0.55, 0.25, 0.2], [80, 10, 10]);
    const overbet = match(2, [0.41, 0.29, 0.3], [35, 40, 25]);
    const result = generateExclusivePick([undervalued, overbet], { forceDrawCount: 1, maxUpsets: 0 });
    expect(result.forcedDrawCount).toBe(1);
    expect(result.picks[0].pick).toBe("무승부");
    expect(result.picks[1].pick).toBe("홈승");
  });

  it("강제 무승부는 minProbRetention 하한을 우회하지만 retention에는 반영된다", () => {
    const m = match(1, [0.6, 0.2, 0.2], [80, 10, 10]);
    const result = generateExclusivePick([m], { forceDrawCount: 1, minProbRetention: 0.9 });
    expect(result.picks[0].pick).toBe("무승부");
    expect(result.probRetention).toBeCloseTo(0.2 / 0.6, 10);
  });

  it("drawBias는 선정 순서만 바꾸고 확률 집계는 원본 그대로다", () => {
    // 가치비는 1번이 근소하게 우세하지만 2번의 최근 시즌 무승부 성향이 훨씬 높음
    const a = { ...match(1, [0.5, 0.26, 0.24], [60, 20, 20]), drawBias: 1.0 };
    const b = { ...match(2, [0.5, 0.25, 0.25], [60, 20, 20]), drawBias: 1.5 };
    const result = generateExclusivePick([a, b], { forceDrawCount: 1, maxUpsets: 0 });
    expect(result.picks[1].pick).toBe("무승부");
    expect(result.picks[1].modelProb).toBeCloseTo(0.25, 10); // bias가 확률을 덮어쓰지 않음
  });

  it("일반 이변은 강제 무승부로 줄어든 retention 위에서 하한을 지킨다", () => {
    const forcedTarget = match(1, [0.6, 0.2, 0.2], [85, 5, 10]); // 무승부 강제 (비용 3배, 무 가치비 4.0)
    const flippable = match(2, [0.45, 0.25, 0.3], [70, 20, 10]); // 원정승 이변 후보(가치 4.7배)
    const result = generateExclusivePick([forcedTarget, flippable], {
      forceDrawCount: 1,
      minProbRetention: 0.3, // 강제 후 retention 0.333 - 추가 이변(÷1.5 → 0.222)은 하한 미달로 차단
    });
    expect(result.forcedDrawCount).toBe(1);
    expect(result.picks[0].pick).toBe("무승부");
    expect(result.upsetCount).toBe(0);
    expect(result.picks[1].pick).toBe("홈승");
  });
});
