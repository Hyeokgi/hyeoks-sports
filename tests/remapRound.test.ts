import { describe, it, expect } from "vitest";
import { selectRemappable, type RemapCandidateRow } from "../src/lib/remapRound";
import { NAME_MAP } from "../src/lib/nameMap";

const NOW = Date.parse("2026-10-02T06:00:00Z");
const row = (o: Partial<RemapCandidateRow>): RemapCandidateRow => ({
  round_match_id: 1,
  league: "라리가",
  home_kr: "엘체",
  away_kr: "셀타비고",
  kickoff_at: "2026-10-10T14:00:00Z",
  ...o,
});

describe("selectRemappable (등록 뒤 고쳐진 팀 이름 재계산 대상)", () => {
  it("59회차 새 약칭 3팀은 이름표에 별칭으로 있다", () => {
    expect(NAME_MAP["셀타비고"]).toBe("Celta Vigo");
    expect(NAME_MAP["데포아코"]).toBe("Deportivo A Coruña");
    expect(NAME_MAP["라싱산탄"]).toBe("Racing Santander");
  });

  it("킥오프 전이고 두 팀 모두 이름표에 있으면 고른다", () => {
    const out = selectRemappable([row({})], NAME_MAP, NOW);
    expect(out).toEqual([{ roundMatchId: 1, league: "라리가", homeEn: "Elche", awayEn: "Celta Vigo" }]);
  });

  it("킥오프가 지났거나 시각을 모르면 고르지 않는다(사후 예측 방지)", () => {
    expect(selectRemappable([row({ kickoff_at: "2026-10-01T14:00:00Z" })], NAME_MAP, NOW)).toEqual([]);
    expect(selectRemappable([row({ kickoff_at: null })], NAME_MAP, NOW)).toEqual([]);
  });

  it("한 팀이라도 이름표에 없으면 고르지 않는다", () => {
    expect(selectRemappable([row({ away_kr: "없는팀" })], NAME_MAP, NOW)).toEqual([]);
  });

  it("모델 미지원 대회는 고르지 않는다", () => {
    expect(selectRemappable([row({ league: "UCL", home_kr: "미지팀A", away_kr: "미지팀B" })], { 미지팀A: "A", 미지팀B: "B" }, NOW)).toEqual([]);
  });
});
