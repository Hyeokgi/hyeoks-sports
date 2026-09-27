import { describe, it, expect } from "vitest";
import { slugifyTeam, kstDate, fixtureSlug, inFixtureWindow, resolveSlugs, teamKr } from "../src/lib/fixtures";

describe("경기 주소(slug)", () => {
  it("영문 팀명을 소문자·하이픈으로, 악센트는 뗀다", () => {
    expect(slugifyTeam("Tottenham Hotspur")).toBe("tottenham-hotspur");
    expect(slugifyTeam("Atlético Madrid")).toBe("atletico-madrid");
    expect(slugifyTeam("Brighton & Hove Albion")).toBe("brighton-and-hove-albion");
    expect(slugifyTeam("Bucheon FC 1995")).toBe("bucheon-fc-1995");
    expect(slugifyTeam("  ")).toBe("team");
  });

  it("날짜는 한국시간 기준이다(UTC 16시 = 다음날 01시)", () => {
    expect(kstDate("2026-10-03T16:00:00.000Z")).toBe("2026-10-04");
    expect(kstDate("2026-10-03T10:00:00.000Z")).toBe("2026-10-03");
    expect(kstDate("not-a-date")).toBeNull();
    expect(fixtureSlug("2026-10-04", "Croatia", "England")).toBe("2026-10-04-croatia-england");
  });

  it("같은 주소가 이미 다른 경기에 쓰였으면 FotMob 번호를 붙이고, 자기 자신이면 그대로 둔다", () => {
    const taken = new Map([["2026-10-04-a-b", 111]]);
    const out = resolveSlugs(
      [
        { fotmobId: 111, slug: "2026-10-04-a-b" },
        { fotmobId: 222, slug: "2026-10-04-a-b" },
        { fotmobId: 333, slug: "2026-10-04-c-d" },
        { fotmobId: 444, slug: "2026-10-04-c-d" },
      ],
      taken,
    );
    expect(out.get(111)).toBe("2026-10-04-a-b");
    expect(out.get(222)).toBe("2026-10-04-a-b-222");
    expect(out.get(333)).toBe("2026-10-04-c-d");
    expect(out.get(444)).toBe("2026-10-04-c-d-444");
  });
});

describe("예측을 만들 경기 범위", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const f = (utcKickoff: string | null, finished = false, cancelled = false) => ({ utcKickoff, finished, cancelled });

  it("킥오프가 지금 이후 7일 안인 예정 경기만", () => {
    expect(inFixtureWindow(f("2026-10-01T12:00:00Z"), now)).toBe(true);
    expect(inFixtureWindow(f("2026-10-07T23:00:00Z"), now)).toBe(true);
    expect(inFixtureWindow(f("2026-10-09T00:00:00Z"), now)).toBe(false);
  });

  it("이미 시작했거나 끝났거나 취소됐거나 시각을 모르면 제외(킥오프 전 예측 보존)", () => {
    expect(inFixtureWindow(f("2026-09-30T23:00:00Z"), now)).toBe(false);
    expect(inFixtureWindow(f("2026-10-02T00:00:00Z", true), now)).toBe(false);
    expect(inFixtureWindow(f("2026-10-02T00:00:00Z", false, true), now)).toBe(false);
    expect(inFixtureWindow(f(null), now)).toBe(false);
  });
});

describe("한글 팀명", () => {
  it("nameMap에 있는 팀은 한글, 없으면 null", () => {
    expect(teamKr("K리그1", "FC Seoul")).toBe("FC서울");
    expect(teamKr("K리그1", "없는 팀")).toBeNull();
  });
});
