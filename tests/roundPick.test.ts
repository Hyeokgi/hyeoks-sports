import { describe, it, expect } from "vitest";
import { pickDefaultRound, roundPhase } from "../src/lib/roundPick";

const NOW = Date.parse("2026-09-26T03:00:00Z");
const r = (id: number, status: string, first: string | null, last: string | null) => ({
  id,
  status,
  first_kickoff_at: first,
  last_kickoff_at: last,
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
    // 56회차 실측: 마감 9/28 23:00 KST(14:00Z), 첫 경기 9/29 01:00 KST(16:00Z)
    const now = Date.parse("2026-09-28T15:00:00Z"); // 마감 뒤, 첫 경기 전
    const r56 = { ...r(17, "upcoming", "2026-09-28T16:00:00Z", "2026-09-29T18:45:00Z"), sale_end_at: "2026-09-28T14:00:00Z" };
    const r57 = { ...r(18, "upcoming", "2026-10-02T16:00:00Z", "2026-10-03T18:45:00Z"), sale_end_at: "2026-10-02T14:00:00Z" };
    expect(pickDefaultRound([r57, r56], now)!.id).toBe(18);
    expect(roundPhase(r56, now)).not.toBe("발매중");
    expect(roundPhase(r56, Date.parse("2026-09-28T13:00:00Z"))).toBe("발매중");
  });
});

describe("roundPhase", () => {
  it("발매중/경기중/종료를 구분한다", () => {
    expect(roundPhase(r(1, "upcoming", "2026-09-27T13:00:00Z", "2026-09-28T19:00:00Z"), NOW)).toBe("발매중");
    expect(roundPhase(r(2, "upcoming", "2026-09-25T16:00:00Z", "2026-09-26T19:00:00Z"), NOW)).toBe("경기중");
    expect(roundPhase(r(3, "settled", "2026-09-01T10:00:00Z", "2026-09-02T10:00:00Z"), NOW)).toBe("종료");
  });
});
