import { describe, it, expect } from "vitest";
import { canonicalTeamName, dedupeResults, isAliasTeamName, ALIAS_TEAM_NAMES, TEAM_ALIAS_ENTRIES } from "../src/lib/teamAlias";
import { TEAM_ENTRIES } from "../src/lib/nameMap";
import { TEAM_DISPLAY_KR, displayTeamName, missingDisplayNames } from "../src/lib/teamNames";
import { teamKr } from "../src/lib/fixtures";
import { computeStandings } from "../src/lib/leagueTables";

const m = (league: string, date: string, home: string, away: string, hg: number, ag: number) => ({ league, date, home, away, hg, ag });

describe("팀 별칭 → 정식 키", () => {
  it("악센트 표기를 과거 백필 표기로 바꾼다", () => {
    expect(canonicalTeamName("Atlético Madrid")).toBe("Atletico Madrid");
    expect(canonicalTeamName("Atlético de Madrid")).toBe("Atletico Madrid");
    expect(canonicalTeamName("Deportivo Alavés")).toBe("Deportivo Alaves");
    expect(canonicalTeamName("Alavés")).toBe("Deportivo Alaves");
    expect(canonicalTeamName("Málaga")).toBe("Malaga");
    expect(canonicalTeamName("CF Montréal")).toBe("CF Montreal");
    expect(canonicalTeamName("Cádiz")).toBe("Cadiz");
    expect(canonicalTeamName("Leganés")).toBe("Leganes");
    // 조합형(NFD)으로 들어와도 같은 키
    expect(canonicalTeamName("Atlético Madrid".normalize("NFD"))).toBe("Atletico Madrid");
    expect(isAliasTeamName("Atlético Madrid")).toBe(true);
    expect(isAliasTeamName("Atletico Madrid")).toBe(false);
  });

  it("악센트가 정식 표기인 팀은 건드리지 않는다", () => {
    for (const n of ["Bayern München", "Borussia Mönchengladbach", "1. FC Köln", "Deportivo A Coruña", "Arsenal", "FC Seoul"]) {
      expect(canonicalTeamName(n), n).toBe(n);
      expect(isAliasTeamName(n), n).toBe(false);
    }
  });

  it("nameMap·표시명 표의 이름은 모두 정식 키이고, 별칭은 정식 키로만 간다", () => {
    for (const e of TEAM_ENTRIES) expect(canonicalTeamName(e.nameEn), e.nameEn).toBe(e.nameEn);
    for (const n of Object.keys(TEAM_DISPLAY_KR)) expect(canonicalTeamName(n), n).toBe(n);
    for (const [alias, target] of TEAM_ALIAS_ENTRIES) {
      expect(target in TEAM_DISPLAY_KR, `${alias} → ${target}`).toBe(true);
      expect(canonicalTeamName(target)).toBe(target);
    }
    expect(ALIAS_TEAM_NAMES).toContain("Atlético Madrid");
    expect(ALIAS_TEAM_NAMES).not.toContain("Atletico Madrid");
  });

  it("표시명·한글 역조회도 별칭을 정식 키로 찾는다", () => {
    expect(displayTeamName("Atlético Madrid")).toBe("아틀레티코 마드리드");
    expect(displayTeamName("Cadiz")).toBe("카디스");
    expect(displayTeamName("Leganés")).toBe("레가네스");
    expect(missingDisplayNames(["Atlético Madrid", "CF Montréal"])).toEqual([]);
    expect(teamKr("라리가", "Atlético Madrid")).toBe(teamKr("라리가", "Atletico Madrid"));
    expect(teamKr("라리가", "Atletico Madrid")).not.toBeNull();
  });
});

describe("dedupeResults", () => {
  it("정규화 뒤 같은 경기(리그·날짜·홈·원정)는 처음 줄만 남긴다", () => {
    const rows = [
      m("라리가", "2026-09-20", "Atletico Madrid", "Real Madrid", 2, 1),
      m("라리가", "2026-09-20", "Atlético Madrid", "Real Madrid", 2, 1),
      m("라리가", "2026-09-27", "Deportivo Alavés", "Atlético Madrid", 0, 0),
    ];
    const out = dedupeResults(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(rows[0]); // 바뀐 게 없으면 같은 객체
    expect(out[1]).toEqual(m("라리가", "2026-09-27", "Deportivo Alaves", "Atletico Madrid", 0, 0));
    expect(rows[2].home).toBe("Deportivo Alavés"); // 입력은 바꾸지 않는다
  });

  it("점수가 달라도 예외 없이 처음 줄을 쓴다", () => {
    const out = dedupeResults([m("MLS", "2026-05-01", "CF Montréal", "Toronto FC", 1, 0), m("MLS", "2026-05-01", "CF Montreal", "Toronto FC", 2, 2)]);
    expect(out).toEqual([m("MLS", "2026-05-01", "CF Montreal", "Toronto FC", 1, 0)]);
  });

  it("다른 경기(날짜·리그·홈원정 순서가 다름)는 모두 남긴다", () => {
    const rows = [
      m("라리가", "2026-09-20", "Atletico Madrid", "Real Madrid", 2, 1),
      m("라리가", "2026-09-21", "Atletico Madrid", "Real Madrid", 2, 1),
      m("라리가", "2026-09-20", "Real Madrid", "Atletico Madrid", 0, 1),
      m("EPL", "2026-09-20", "Atletico Madrid", "Real Madrid", 2, 1),
    ];
    expect(dedupeResults(rows)).toHaveLength(4);
  });

  it("순위표: 'Atlético Madrid'와 'Atletico Madrid' 줄이 한 팀으로 합쳐진다", () => {
    const rows = dedupeResults([
      m("라리가", "2025-08-20", "Atletico Madrid", "Sevilla", 2, 0),
      m("라리가", "2025-08-20", "Atlético Madrid", "Sevilla", 2, 0), // 같은 경기의 다른 표기
      m("라리가", "2025-08-27", "Valencia", "Atlético Madrid", 1, 1),
      m("라리가", "2025-09-03", "Atlético Madrid", "Valencia", 3, 1),
    ]);
    const st = computeStandings("라리가", rows)!;
    expect(st).not.toBeNull();
    const atm = st.rows.filter((r) => r.team.startsWith("Atl"));
    expect(atm).toHaveLength(1);
    expect(atm[0].team).toBe("Atletico Madrid");
    expect(atm[0].played).toBe(3);
    expect(atm[0].points).toBe(7);
    expect(st.matches).toBe(3);
  });
});
