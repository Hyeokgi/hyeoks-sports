import { describe, it, expect } from "vitest";
import { pickDefaultRound, roundPhase, phaseDetail, isOnSale } from "../src/lib/roundPick";

const NOW = Date.parse("2026-09-26T03:00:00Z");
const r = (id: number, status: string, first: string | null, last: string | null, extra: Record<string, string | null> = {}) => ({
  id,
  status,
  first_kickoff_at: first,
  last_kickoff_at: last,
  ...extra,
});

describe("pickDefaultRound", () => {
  it("발매중 회차가 여럿이면 마감(첫 킥오프)이 가장 임박한 회차 - 최신 등록 회차가 아니다", () => {
    // 2026-09-26 실제 상황: 57회차가 최신 등록이지만 56회차가 먼저 마감
    const rounds = [
      r(18, "upcoming", "2026-10-10T16:00:00Z", "2026-10-11T19:00:00Z"), // 57
      r(17, "upcoming", "2026-09-27T13:00:00Z", "2026-09-28T19:00:00Z"), // 56
      r(16, "upcoming", "2026-09-25T16:00:00Z", "2026-09-26T19:00:00Z"), // 55: 이미 첫 경기 시작
    ];
    expect(pickDefaultRound(rounds, NOW)!.id).toBe(17);
  });
  it("발매 중인 회차가 있으면, 마감이 더 이른 발매예정 회차보다 그 회차를 고른다", () => {
    const now = Date.parse("2026-10-02T05:00:00Z");
    const r57 = r(18, "upcoming", "2026-10-02T16:00:00Z", "2026-10-03T18:45:00Z", { sale_start_at: "2026-09-29T23:00:00Z", sale_end_at: "2026-10-02T14:00:00Z" });
    const r58 = r(19, "upcoming", "2026-10-05T16:00:00Z", "2026-10-06T18:45:00Z", { sale_start_at: "2026-10-03T23:00:00Z", sale_end_at: "2026-10-05T14:00:00Z" });
    expect(pickDefaultRound([r58, r57], now)!.id).toBe(18);
  });
  it("발매중이 없으면 경기 진행 중인 회차", () => {
    const rounds = [
      r(18, "settled", "2026-09-01T10:00:00Z", "2026-09-02T10:00:00Z"),
      r(17, "upcoming", "2026-09-25T16:00:00Z", "2026-09-26T19:00:00Z"),
    ];
    expect(pickDefaultRound(rounds, NOW)!.id).toBe(17);
  });
  it("킥오프 정보가 없으면 종전처럼 최신 회차", () => {
    const rounds = [r(18, "upcoming", null, null), r(17, "settled", null, null)];
    expect(pickDefaultRound(rounds, NOW)!.id).toBe(18);
  });
  it("빈 목록은 null", () => {
    expect(pickDefaultRound([], NOW)).toBeNull();
  });
});

describe("발매 마감(sale_end_at)", () => {
  it("마감이 첫 킥오프보다 이르면 마감 기준으로 고른다", () => {
    // 56회차 실측: 발매 9/27 08:00 KST, 마감 9/28 23:00 KST(14:00Z), 첫 경기 9/29 01:00 KST(16:00Z)
    const now = Date.parse("2026-09-28T15:00:00Z"); // 마감 뒤, 첫 경기 전
    const r56 = r(17, "upcoming", "2026-09-28T16:00:00Z", "2026-09-29T18:45:00Z", { sale_start_at: "2026-09-26T23:00:00Z", sale_end_at: "2026-09-28T14:00:00Z" });
    const r57 = r(18, "upcoming", "2026-10-02T16:00:00Z", "2026-10-03T18:45:00Z", { sale_start_at: "2026-09-29T23:00:00Z", sale_end_at: "2026-10-02T14:00:00Z" });
    expect(pickDefaultRound([r57, r56], now)!.id).toBe(18);
    expect(roundPhase(r56, now)).toBe("발매마감");
    expect(roundPhase(r56, Date.parse("2026-09-28T13:00:00Z"))).toBe("발매중");
  });
});

describe("roundPhase (betman 발매기간 기준)", () => {
  // 2026-10-02 실제 상황: 57회차만 발매중, 58·59회차는 대진만 나온 발매예정
  const now = Date.parse("2026-10-02T05:00:00Z");
  const r57 = r(18, "upcoming", "2026-10-02T16:00:00Z", "2026-10-03T18:45:00Z", { sale_start_at: "2026-09-29T23:00:00Z", sale_end_at: "2026-10-02T14:00:00Z" });
  const r58 = r(19, "upcoming", "2026-10-05T16:00:00Z", "2026-10-06T18:45:00Z", { sale_start_at: "2026-10-03T23:00:00Z", sale_end_at: "2026-10-05T14:00:00Z" });
  const r59 = r(20, "upcoming", "2026-10-10T14:00:00Z", "2026-10-11T19:00:00Z", { sale_start_at: "2026-10-07T23:00:00Z", sale_end_at: "2026-10-10T14:00:00Z" });

  it("발매 시작 전이면 발매예정, 시작했으면 발매중", () => {
    expect(roundPhase(r57, now)).toBe("발매중");
    expect(roundPhase(r58, now)).toBe("발매예정");
    expect(roundPhase(r59, now)).toBe("발매예정");
    expect(isOnSale(r58, now)).toBe(false);
  });
  it("발매 시작 시각을 모르면 발매중이라고 단정하지 않는다", () => {
    expect(roundPhase(r(1, "upcoming", "2026-09-27T13:00:00Z", "2026-09-28T19:00:00Z"), NOW)).toBe("발매예정");
  });
  it("마감 뒤 첫 경기 전은 발매마감, 경기 중, 결과 대기, 종료를 구분한다", () => {
    expect(roundPhase(r57, Date.parse("2026-10-02T15:00:00Z"))).toBe("발매마감");
    expect(roundPhase(r57, Date.parse("2026-10-03T12:00:00Z"))).toBe("경기중");
    expect(roundPhase(r57, Date.parse("2026-10-05T12:00:00Z"))).toBe("결과 집계 중");
    expect(roundPhase(r(3, "settled", "2026-09-01T10:00:00Z", "2026-09-02T10:00:00Z"), NOW)).toBe("종료");
  });
  it("선택창 설명은 발매 시작·마감 시각(KST)", () => {
    expect(phaseDetail(r58, now)).toBe("10/4(일) 08:00 발매");
    expect(phaseDetail(r57, now)).toBe("~10/2(금) 23:00 마감");
    expect(phaseDetail(r(1, "upcoming", "2026-10-27T13:00:00Z", null), now)).toBe("발매일 확인 중");
  });
});
