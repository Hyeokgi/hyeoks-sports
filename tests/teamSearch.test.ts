import { describe, it, expect } from "vitest";
import { chosung, searchTeams, teamIndex, type SearchableMatch } from "../src/lib/teamSearch";

const m = (home: string, away: string, homeEn: string, awayEn: string, status = "scheduled"): SearchableMatch => ({
  league: "국가대표", kickoffAt: "2026-10-10T11:00:00Z", status, home, away, homeEn, awayEn, homeLogo: null, awayLogo: null,
});
const now = Date.parse("2026-10-01T00:00:00Z");
const idx = teamIndex([
  m("대한민국", "우루과이", "South Korea", "Uruguay"),
  m("대한민국", "베네수엘라", "South Korea", "Venezuela"),
  m("토트넘 홋스퍼", "아스널", "Tottenham Hotspur", "Arsenal"),
  m("맨체스터 유나이티드", "맨체스터 시티", "Manchester United", "Manchester City"),
  m("대만", "태국", "Taiwan", "Thailand", "finished"),
], now);
const first = (q: string) => searchTeams(idx, q)[0]?.name;

describe("팀·국가 검색", () => {
  it("초성", () => {
    expect(chosung("대한민국")).toBe("ㄷㅎㅁㄱ");
    expect(first("ㄷㅎ")).toBe("대한민국");
  });
  it("부분 일치·줄임말·영문", () => {
    expect(first("대한")).toBe("대한민국");
    expect(first("한국")).toBe("대한민국");
    expect(first("토트")).toBe("토트넘 홋스퍼");
    expect(first("맨유")).toBe("맨체스터 유나이티드");
    expect(first("아스날")).toBe("아스널");
    expect(first("korea")).toBe("대한민국");
    expect(first("manchester c")).toBe("맨체스터 시티");
  });
  it("없으면 빈 목록, 빈 검색어면 예정 경기가 많은 순", () => {
    expect(searchTeams(idx, "xyz")).toEqual([]);
    expect(searchTeams(idx, "")[0].name).toBe("대한민국");
    expect(idx.find((e) => e.name === "대만")?.upcoming).toBe(0);
  });
});
