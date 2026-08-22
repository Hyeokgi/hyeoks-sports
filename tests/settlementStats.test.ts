// 정산 집계가 실제 결과를 과장 없이 그대로 세는지 검증
import { describe, expect, it } from "vitest";
import { computeRoundSettlement, summarize, type SettlementMatchInput } from "../src/lib/settlementStats";
import type { MatchPrediction } from "../src/lib/prediction";

function pred(pHome: number, pDraw: number, pAway: number): MatchPrediction {
  const ranked: [MatchPrediction["rankedPicks"][number], number][] = [
    ["홈승", pHome], ["무승부", pDraw], ["원정승", pAway],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return { pHome, pDraw, pAway, rankedPicks: ranked.map((r) => r[0]), confidenceGap: ranked[0][1] - ranked[1][1] };
}

function m(
  seq: number,
  probs: [number, number, number],
  vote: [number, number, number] | null,
  actual: "H" | "D" | "A" | null,
): SettlementMatchInput {
  return {
    seq, league: "EPL", home: `홈${seq}`, away: `원정${seq}`,
    prediction: pred(...probs),
    voteShare: vote ? { home: vote[0], draw: vote[1], away: vote[2] } : null,
    actual,
  };
}

describe("computeRoundSettlement", () => {
  it("기본픽 적중과 실제 무승부 수를 그대로 센다", () => {
    const r = computeRoundSettlement(1, 42, [
      m(1, [0.5, 0.3, 0.2], [50, 30, 20], "H"), // 기본픽 홈승 = 적중
      m(2, [0.5, 0.3, 0.2], [50, 30, 20], "D"), // 기본픽 홈승 ≠ 무승부
      m(3, [0.2, 0.3, 0.5], [20, 30, 50], "A"), // 기본픽 원정승 = 적중
    ], { maxUpsets: 0 });
    expect(r.basePickHits).toBe(2);
    expect(r.exclusivePickHits).toBe(2); // 이변 0이면 기본픽과 동일
    expect(r.drawsActual).toBe(1);
    expect(r.settledMatches).toBe(3);
    expect(r.roundNo).toBe(42);
  });

  it("미정산 경기는 집계에서 빠진다", () => {
    const r = computeRoundSettlement(1, 42, [
      m(1, [0.5, 0.3, 0.2], [50, 30, 20], "H"),
      m(2, [0.5, 0.3, 0.2], [50, 30, 20], null), // 진행중
    ], { maxUpsets: 0 });
    expect(r.settledMatches).toBe(1);
    expect(r.totalMatches).toBe(2);
    expect(r.basePickHits).toBe(1);
  });

  it("실제 당첨조합의 대중 구매비중은 투표율의 곱이다", () => {
    const r = computeRoundSettlement(1, 42, [
      m(1, [0.5, 0.3, 0.2], [50, 30, 20], "H"),
      m(2, [0.5, 0.3, 0.2], [40, 30, 30], "D"),
    ], { maxUpsets: 0 });
    expect(r.actualCrowdShare!).toBeCloseTo(0.5 * 0.3, 10);
  });

  it("투표율이 없는 경기가 하나라도 있으면 대중비중은 null(부분 곱 금지)", () => {
    const r = computeRoundSettlement(1, 42, [
      m(1, [0.5, 0.3, 0.2], [50, 30, 20], "H"),
      m(2, [0.5, 0.3, 0.2], null, "H"),
    ], { maxUpsets: 0 });
    expect(r.actualCrowdShare).toBeNull();
  });

  it("결과가 안 나온 경기가 있으면 실제 당첨조합 비중도 null", () => {
    const r = computeRoundSettlement(1, 42, [
      m(1, [0.5, 0.3, 0.2], [50, 30, 20], "H"),
      m(2, [0.5, 0.3, 0.2], [50, 30, 20], null),
    ], { maxUpsets: 0 });
    expect(r.actualCrowdShare).toBeNull();
  });
});

describe("summarize", () => {
  it("정산된 회차만 합산하고 적중률을 계산한다", () => {
    const a = computeRoundSettlement(1, 42, [
      m(1, [0.5, 0.3, 0.2], [50, 30, 20], "H"),
      m(2, [0.5, 0.3, 0.2], [50, 30, 20], "D"),
    ], { maxUpsets: 0 });
    const b = computeRoundSettlement(2, 43, [
      m(1, [0.5, 0.3, 0.2], [50, 30, 20], "H"),
      m(2, [0.5, 0.3, 0.2], [50, 30, 20], "H"),
    ], { maxUpsets: 0 });
    const empty = computeRoundSettlement(3, 44, [m(1, [0.5, 0.3, 0.2], [50, 30, 20], null)], { maxUpsets: 0 });
    const s = summarize([a, b, empty]);
    expect(s.rounds).toBe(2); // 미정산 회차 제외
    expect(s.settledMatches).toBe(4);
    expect(s.basePickHits).toBe(3);
    expect(s.basePickAccuracy).toBeCloseTo(0.75, 10);
    expect(s.drawRate).toBeCloseTo(0.25, 10);
  });

  it("정산 회차가 없으면 0으로 나누지 않는다", () => {
    const s = summarize([]);
    expect(s.rounds).toBe(0);
    expect(s.basePickAccuracy).toBe(0);
    expect(s.medianActualCrowdShare).toBeNull();
  });
});
