// 배당 기반 여부는 회차 등록 시점에 고정된다. 이 판단이 나중에 뒤집히면 elo_diff=0으로
// 저장된 경기가 "모델 예측"으로 표시되면서 격차 0 + 홈어드밴티지라는 가짜 신호에
// 확신도 등급까지 붙는다(48회차 인테르/AC몬차가 실제로 이 상황을 만들었다).
import { describe, expect, it } from "vitest";
import { resolveMarketOnly, predictedAfterKickoff } from "../src/lib/predictRound";

describe("resolveMarketOnly", () => {
  it("저장된 값이 있으면 리그와 무관하게 그 값을 따른다", () => {
    // 지원 리그인데 팀명 매핑이 없어 배당 기반으로 등록된 경기.
    // 나중에 NAME_MAP에 그 팀을 추가해도 이 경기는 배당 기반으로 남아야 한다.
    expect(resolveMarketOnly(1, "세리에A")).toBe(true);
    expect(resolveMarketOnly(0, "UEL")).toBe(false);
  });

  it("저장된 값이 없으면(0008 이전 회차) 리그로 판단한다", () => {
    expect(resolveMarketOnly(null, "세리에A")).toBe(false);
    expect(resolveMarketOnly(null, "EPL")).toBe(false);
    expect(resolveMarketOnly(null, "UCL")).toBe(true);
    expect(resolveMarketOnly(undefined, "UEL")).toBe(true);
  });
});

describe("predictedAfterKickoff", () => {
  it("킥오프 전에 계산된 예측은 정상 집계", () => {
    expect(predictedAfterKickoff("2026-09-20T03:00:00.000Z", "2026-09-20T10:00:00.000Z")).toBe(false);
  });
  it("킥오프 이후 계산(사후 등록)은 집계 제외", () => {
    // 53회차 사례: 경기는 9월 초에 끝났고 회차는 9월 24일에 등록됐다
    expect(predictedAfterKickoff("2026-09-24T12:40:00.000Z", "2026-09-06T10:00:00.000Z")).toBe(true);
  });
  it("킥오프 시각 자체에 계산됐어도 사후로 본다", () => {
    expect(predictedAfterKickoff("2026-09-20T10:00:00.000Z", "2026-09-20T10:00:00.000Z")).toBe(true);
  });
  it("시각을 모르거나 파싱이 안 되면 기존처럼 집계", () => {
    expect(predictedAfterKickoff("2026-09-24T12:40:00.000Z", null)).toBe(false);
    expect(predictedAfterKickoff(null, "2026-09-06T10:00:00.000Z")).toBe(false);
    expect(predictedAfterKickoff("garbage", "2026-09-06T10:00:00.000Z")).toBe(false);
  });
});
