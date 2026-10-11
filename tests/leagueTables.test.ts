import { describe, it, expect } from "vitest";
import {
  computeStandings,
  compareStanding,
  rankElo,
  rankNationalElo,
  eloChangeSince,
  expectedScore,
  compareRanks,
  tablesMeaningful,
  isCrossYearLeague,
  seasonLabel,
  latestSeason,
  STANDINGS_LABEL,
  FORM_LENGTH,
  type ResultRow,
  type Standings,
  type StandingRow,
} from "../src/lib/leagueTables";
import type { LeagueTablesView, RatingsOverview } from "../src/lib/leagueTablesStore";
import { renderLeaguePage, leagueIndexable } from "../src/lib/matchPage";
import { renderRatingsPage, ratingsIndexable } from "../src/lib/ratingsPage";
import { navSection, siteHeader } from "../src/lib/publicSite";
import { USAGE_EVENTS } from "../src/lib/usage";
import { leagueInfo } from "../src/lib/teamNames";
import { DISCLAIMER } from "../src/lib/roundArticle";

const r = (date: string, home: string, away: string, hg: number, ag: number): ResultRow => ({ date, home, away, hg, ag });

// 순위·Elo 화면도 경기 페이지와 같은 금지어를 지킨다(고지 문구는 제외하고 검사).
const FORBIDDEN = ["단식", "복식", "조합", "베팅", "추천", "투표율", "픽을", "강추"];
const body = (html: string) => html.replace(DISCLAIMER.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!), "");

describe("시즌 경계", () => {
  it("교차연도 리그는 7월 경계, 역년 리그는 연도 그대로(elo.ts seasonOf와 같은 판정)", () => {
    expect(isCrossYearLeague("EPL")).toBe(true);
    expect(isCrossYearLeague("라리가")).toBe(true);
    expect(isCrossYearLeague("K리그1")).toBe(false);
    expect(isCrossYearLeague("MLS")).toBe(false);
    expect(seasonLabel("EPL", 2025)).toBe("2025-26");
    expect(seasonLabel("세리에A", 2099)).toBe("2099-00");
    expect(seasonLabel("K리그1", 2026)).toBe("2026");
  });

  it("가장 최근 경기의 시즌만 집계한다(EPL: 8월~이듬해 1월은 같은 시즌, 5월은 이전 시즌)", () => {
    const rows = [r("2025-05-20", "A", "B", 1, 0), r("2025-08-16", "A", "B", 2, 2), r("2026-01-10", "B", "A", 1, 0)];
    expect(latestSeason("EPL", rows)).toBe(2025);
    const s = computeStandings("EPL", rows)!;
    expect(s.season).toBe(2025);
    expect(s.seasonLabel).toBe("2025-26");
    expect(s.matches).toBe(2);
    expect(s.firstDate).toBe("2025-08-16");
    expect(s.lastDate).toBe("2026-01-10");
  });

  it("역년 리그는 11월 경기와 이듬해 3월 경기를 다른 시즌으로 본다", () => {
    const rows = [r("2025-11-30", "C", "A", 5, 0), r("2026-03-01", "A", "B", 2, 0)];
    const s = computeStandings("K리그1", rows)!;
    expect(s.season).toBe(2026);
    expect(s.matches).toBe(1);
    expect(s.rows.map((x) => x.team)).toEqual(["A", "B"]);
    // 시즌을 직접 지정할 수도 있다.
    expect(computeStandings("K리그1", rows, 2025)!.rows[0].team).toBe("C");
  });
});

describe("순위표 계산", () => {
  const rows = [
    r("2025-11-30", "C", "A", 5, 0), // 지난 시즌 - 빠져야 한다
    r("2026-03-01", "A", "B", 2, 0),
    r("2026-03-08", "B", "C", 1, 1),
    r("2026-03-15", "C", "A", 0, 3),
    r("2026-03-22", "A", "B", 1, 1),
  ];
  it("승점 3/1/0, 득실, 승무패, 경기 수", () => {
    const s = computeStandings("K리그1", rows)!;
    expect(s.matches).toBe(4);
    const [a, b, c] = s.rows;
    expect(a).toMatchObject({ rank: 1, team: "A", played: 3, won: 2, drawn: 1, lost: 0, gf: 6, ga: 1, gd: 5, points: 7 });
    expect(b).toMatchObject({ rank: 2, team: "B", played: 3, won: 0, drawn: 2, lost: 1, gf: 2, ga: 4, gd: -2, points: 2 });
    expect(c).toMatchObject({ rank: 3, team: "C", played: 2, won: 0, drawn: 1, lost: 1, gf: 1, ga: 4, gd: -3, points: 1 });
    expect(a.form).toEqual(["W", "W", "D"]);
    expect(b.form).toEqual(["L", "D", "D"]);
    // 모든 팀의 승점 합 = 승리 경기×3 + 무승부 경기×2
    expect(s.rows.reduce((t, x) => t + x.points, 0)).toBe(2 * 3 + 2 * 2);
  });

  it("동률 정렬: 승점 → 득실차 → 다득점 → 영문명", () => {
    const s = computeStandings("K리그1", [r("2026-04-01", "X", "Z", 3, 0), r("2026-04-02", "Y", "W", 1, 0)])!;
    expect(s.rows.slice(0, 2).map((x) => x.team)).toEqual(["X", "Y"]); // 둘 다 3점, 득실차 +3 > +1
    const base = { points: 10, gd: 5 };
    expect(compareStanding({ ...base, gf: 12, team: "B" }, { ...base, gf: 10, team: "A" })).toBeLessThan(0);
    expect(compareStanding({ ...base, gf: 10, team: "A" }, { ...base, gf: 10, team: "B" })).toBeLessThan(0);
    // 완전 동률이면 이름 순 - 입력 순서와 상관없이 같은 표가 나온다.
    const t1 = computeStandings("K리그1", [r("2026-04-01", "Bravo", "Alpha", 1, 1)])!;
    const t2 = computeStandings("K리그1", [r("2026-04-01", "Alpha", "Bravo", 1, 1)])!;
    expect(t1.rows.map((x) => x.team)).toEqual(["Alpha", "Bravo"]);
    expect(t2.rows.map((x) => x.team)).toEqual(["Alpha", "Bravo"]);
  });

  it("최근 5경기는 시간순 마지막 5개(왼쪽이 오래된 경기)", () => {
    const res: [number, number][] = [[1, 0], [2, 1], [0, 0], [0, 1], [3, 0], [2, 0], [1, 1]]; // W W D L W W D
    const rows2 = res.map(([hg, ag], i) => r(`2026-03-0${i + 1}`, "T", `O${i}`, hg, ag));
    const s = computeStandings("K리그1", [...rows2].reverse())!; // 입력 순서가 뒤집혀도 날짜로 정렬
    const t = s.rows.find((x) => x.team === "T")!;
    expect(t.form).toHaveLength(FORM_LENGTH);
    expect(t.form).toEqual(["D", "L", "W", "W", "D"]);
  });

  it("빈 입력·잘못된 행은 null(표를 지어내지 않는다)", () => {
    expect(computeStandings("EPL", [])).toBeNull();
    expect(latestSeason("EPL", [])).toBeNull();
    const bad = [r("2026-03-01", "A", "A", 1, 0), r("not-a-date", "A", "B", 1, 0), r("2026-03-01", "A", "B", -1, 0), r("2026-03-01", "A", "B", 1.5, 0)];
    expect(computeStandings("EPL", bad)).toBeNull();
    // 잘못된 행만 빠지고 나머지는 집계된다.
    expect(computeStandings("EPL", [...bad, r("2026-03-02", "A", "B", 1, 0)])!.matches).toBe(1);
  });
});

describe("Elo 순위", () => {
  it("레이팅 내림차순, 동점은 영문명, 이번 시즌 팀만, NaN 제외, 변화량 연결", () => {
    const rows = [
      { team: "b", elo: 1600, lastMatchDate: "2026-09-01" },
      { team: "a", elo: 1600, lastMatchDate: "2026-09-01" },
      { team: "c", elo: 1700, lastMatchDate: "2026-09-01" },
      { team: "d", elo: Number.NaN, lastMatchDate: "2026-09-01" },
      { team: "e", elo: 1400, lastMatchDate: "2026-09-01" },
    ];
    const out = rankElo(rows, { teams: new Set(["a", "b", "c", "d"]), changes: new Map([["c", 12.4]]) });
    expect(out.map((x) => [x.rank, x.team])).toEqual([[1, "c"], [2, "a"], [3, "b"]]);
    expect(out[0].change).toBe(12.4);
    expect(out[1].change).toBeNull();
  });

  it("시즌 팀 목록이 없으면 최근 경기 날짜로 거른다", () => {
    const rows = [
      { team: "old", elo: 1800, lastMatchDate: "2023-05-01" },
      { team: "new", elo: 1500, lastMatchDate: "2026-09-01" },
      { team: "none", elo: 1600, lastMatchDate: null },
    ];
    expect(rankElo(rows, { activeSince: "2025-07-01" }).map((x) => x.team)).toEqual(["new"]);
    expect(rankElo(rows).map((x) => x.team)).toEqual(["old", "none", "new"]);
    expect(rankElo(rows, { limit: 1 })).toHaveLength(1);
    expect(rankElo([])).toEqual([]);
  });

  it("최근 변화량: 기준일 뒤 경기만큼 바뀌고, 기준일 전 기록이 없는 팀은 빠진다", () => {
    const rows = [r("2026-01-01", "A", "B", 1, 0), r("2026-02-01", "A", "C", 2, 0)];
    const ch = eloChangeSince("K리그1", rows, "2026-01-15");
    expect(ch.get("A")!).toBeGreaterThan(0);
    expect(ch.get("B")).toBe(0);
    expect(ch.has("C")).toBe(false);
    expect(eloChangeSince("K리그1", rows, "invalid").size).toBe(0);
  });

  it("기대 점수(승 1·무 0.5 평균)는 차이 0이면 0.5, 400점이면 10/11", () => {
    expect(expectedScore(0)).toBeCloseTo(0.5, 10);
    expect(expectedScore(400)).toBeCloseTo(10 / 11, 10);
    expect(expectedScore(-400)).toBeCloseTo(1 / 11, 10);
  });

  it("국가대표: 최소 경기 수·최근 활동으로 거르고 상위만", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const rows = [
      { team: "Spain", elo: 2100, nMatches: 600, lastMatchDate: "2026-09-08" },
      { team: "Soviet Union", elo: 2060, nMatches: 400, lastMatchDate: "1991-11-13" },
      { team: "Andorra", elo: 1000, nMatches: 10, lastMatchDate: "2026-09-08" },
      { team: "Brazil", elo: 2050, nMatches: 900, lastMatchDate: "2026-09-09" },
    ];
    const out = rankNationalElo(rows, now, { minMatches: 20, activeDays: 1095, limit: 30 });
    expect(out.map((x) => x.team)).toEqual(["Spain", "Brazil"]);
    expect(out[1]).toMatchObject({ rank: 2, matches: 900, change: null });
    expect(rankNationalElo(rows, now, { minMatches: 20, activeDays: 1095, limit: 1 })).toHaveLength(1);
  });
});

// 비교·화면 테스트용 순위표(played를 직접 정한다).
function mkStandings(league: string, teams: string[], played = 10): Standings {
  const rows: StandingRow[] = teams.map((team, i) => ({
    rank: i + 1, team, played, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 30 - i * 3, form: ["W", "D", "L"],
  }));
  return { league, season: 2026, seasonLabel: seasonLabel(league, 2026), rows, matches: (teams.length * played) / 2, firstDate: "2026-08-15", lastDate: "2026-09-28" };
}

describe("순위표 vs Elo 비교", () => {
  const elo = [
    { team: "T1", elo: 1500 },
    { team: "T2", elo: 1600 },
    { team: "T3", elo: 1400 },
    { team: "T4", elo: 1300 },
  ];
  it("같은 팀끼리 다시 순위를 매겨 스피어만·차이를 계산", () => {
    // T5는 Elo가 없어 비교에서 빠지고, 남은 팀끼리 1..4로 다시 매긴다.
    const c = compareRanks(mkStandings("EPL", ["T1", "T2", "T5", "T3", "T4"]), elo)!;
    expect(c.n).toBe(4);
    expect(c.spearman).toBeCloseTo(0.8, 10); // 1 - 6*2/(4*15)
    expect(c.gaps[0]).toMatchObject({ team: "T1", tableRank: 1, eloRank: 2, gap: -1 });
    expect(c.gaps[1]).toMatchObject({ team: "T2", tableRank: 2, eloRank: 1, gap: 1 });
  });
  it("시즌 초반(최소 경기 수 미달)이나 빈 표는 비교하지 않는다", () => {
    expect(compareRanks(mkStandings("EPL", ["T1", "T2", "T3", "T4"], 3), elo)).toBeNull();
    expect(compareRanks(mkStandings("EPL", []), elo)).toBeNull();
    expect(compareRanks(mkStandings("EPL", ["T1", "T2"]), elo)!.spearman).toBeNull(); // n<4
  });
});

describe("색인 판단", () => {
  it("순위표 10경기 이상 또는 Elo 8팀 이상이면 의미 있는 자료", () => {
    expect(tablesMeaningful(null)).toBe(false);
    expect(tablesMeaningful(undefined)).toBe(false);
    expect(tablesMeaningful({ standings: null, elo: [] })).toBe(false);
    expect(tablesMeaningful({ standings: mkStandings("EPL", ["a", "b"], 10), elo: [] })).toBe(true); // 10경기
    expect(tablesMeaningful({ standings: mkStandings("EPL", ["a", "b"], 9), elo: new Array(7).fill(0) })).toBe(false);
    expect(tablesMeaningful({ standings: null, elo: new Array(8).fill(0) })).toBe(true);
  });
});

// ---------- 화면 ----------
const eloRows = rankElo(
  ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"].map((team, i) => ({ team, elo: 1700 - i * 25, lastMatchDate: "2026-09-28" })),
  { changes: new Map([["T1", 8.6], ["T2", -3.2]]) },
);
const clubTables = (over: Partial<LeagueTablesView> = {}): LeagueTablesView => ({
  kind: "club", league: "EPL", generatedAt: "2026-10-01T00:00:00.000Z",
  standings: mkStandings("EPL", ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]), standingsNote: null,
  elo: eloRows, eloSample: 1200, eloSampleFrom: "2023-08-11", eloAsOf: "2026-09-28", changeDays: 30, homeAdv: 60, ...over,
});
const emptyLeague = { league: "EPL", info: leagueInfo("EPL"), upcoming: [], recent: [] };

describe("리그 페이지 순위 섹션", () => {
  it("순위표·Elo 표: caption, scope, 스크롤 영역, 집계 표시, 가이드 링크", () => {
    const d = { ...emptyLeague, tables: clubTables() };
    const h = renderLeaguePage(d);
    expect(h).toContain("시즌 순위표(자체 집계)");
    expect(h).toContain("Elo 전력 순위");
    expect(h).toContain(STANDINGS_LABEL.replace(/[&<>"']/g, ""));
    expect(h).toContain("<caption");
    expect(h).toContain('scope="col"');
    expect(h).toContain('scope="row"');
    expect(h).toMatch(/class="tbl-wrap" role="region" aria-labelledby="standings-cap" tabindex="0"/);
    expect(h).toContain("2026-27 시즌");
    expect(h).toContain("최근 30일 변화");
    expect(h).toContain("+9"); // 8.6 반올림
    expect(h).toContain('href="/guide/elo-rating"');
    expect(h).toContain("시즌 최종 순위 전망은 계산하지 않습니다");
    expect(h).toContain("승리 확률과는 다릅니다");
    for (const w of FORBIDDEN) expect(body(h), w).not.toContain(w);
    expect(h).not.toContain("adsbygoogle");
  });

  it("휴식기(예정·최근 경기 없음)에도 순위 자료가 있으면 색인한다", () => {
    const d = { ...emptyLeague, tables: clubTables() };
    expect(leagueIndexable(d)).toBe(true);
    expect(renderLeaguePage(d)).toContain('<meta name="robots" content="index,follow">');
  });

  it("순위 자료 조회 실패(null)는 안내 문장만, 페이지는 유지·색인 안 함", () => {
    const d = { ...emptyLeague, tables: null };
    const h = renderLeaguePage(d);
    expect(h).toContain("불러오지 못했습니다");
    expect(h).toContain("이 기간에 수집된 예정 경기가 없습니다");
    expect(leagueIndexable(d)).toBe(false);
    // 읽지 않은 경우(undefined)는 아무 섹션도 붙이지 않는다(이전 호출 호환).
    expect(renderLeaguePage(emptyLeague)).not.toContain("시즌 순위표");
  });

  it("순위표를 숨긴 리그는 이유만 적고 Elo는 보여준다", () => {
    const h = renderLeaguePage({ ...emptyLeague, tables: clubTables({ standings: null, standingsNote: "시즌 구분 확인 중이라 표시하지 않습니다." }) });
    expect(h).toContain("시즌 구분 확인 중이라 표시하지 않습니다.");
    expect(h).not.toContain('id="standings-cap"');
    expect(h).toContain('id="elo-cap"');
  });

  it("국가대표: 순위표 없이 Elo 상위 국가", () => {
    const nat: LeagueTablesView = {
      kind: "national", league: "국가대표", generatedAt: "2026-10-01T00:00:00.000Z", standings: null, standingsNote: null,
      elo: rankNationalElo(
        [{ team: "Spain", elo: 2100, nMatches: 600, lastMatchDate: "2026-09-08" }, { team: "Brazil", elo: 2050, nMatches: 900, lastMatchDate: "2026-09-09" }],
        Date.parse("2026-10-01T00:00:00Z"), { minMatches: 20, activeDays: 1095, limit: 30 },
      ),
      eloSample: 230, eloSampleFrom: null, eloAsOf: "2026-09-30T00:00:00.000Z", changeDays: null, homeAdv: 100,
    };
    const h = renderLeaguePage({ league: "국가대표", info: leagueInfo("국가대표"), upcoming: [], recent: [], tables: nat });
    expect(h).not.toContain("시즌 순위표(자체 집계)");
    expect(h).toContain("국가대표 Elo 상위 2개국");
    expect(h).toContain("반영 A매치");
    expect(h).not.toContain("최근 30일 변화");
  });
});

describe("/ratings", () => {
  const standings = mkStandings("EPL", ["T1", "T2", "T5", "T3", "T4"]);
  const elo = [
    { team: "T1", elo: 1500, lastMatchDate: "2026-09-28" },
    { team: "T2", elo: 1600, lastMatchDate: "2026-09-28" },
    { team: "T3", elo: 1400, lastMatchDate: "2026-09-28" },
    { team: "T4", elo: 1300, lastMatchDate: "2026-09-28" },
  ];
  const ov = (over: Partial<RatingsOverview> = {}): RatingsOverview => ({
    generatedAt: "2026-10-01T00:00:00.000Z",
    leagues: [
      { league: "EPL", standings, standingsNote: null, elo: rankElo(elo), comparison: compareRanks(standings, elo), meaningful: true, homeAdv: 60 },
      { league: "라리가", standings: null, standingsNote: null, elo: [], comparison: null, meaningful: false, homeAdv: 105 },
    ],
    national: rankNationalElo([{ team: "Spain", elo: 2100, nMatches: 600, lastMatchDate: "2026-09-08" }], Date.parse("2026-10-01T00:00:00Z"), { minMatches: 20, activeDays: 1095, limit: 30 }),
    nationalAsOf: "2026-09-30T00:00:00.000Z",
    truncated: false,
    ...over,
  });

  it("리그별 상위 Elo·리그 링크·계산된 비교 수치·측정 이벤트", () => {
    const h = renderRatingsPage(ov());
    expect(h).toContain("<h1>리그별 Elo 전력 순위</h1>");
    expect(h).toContain('href="/league/epl"');
    expect(h).toContain('href="/league/national-teams"');
    expect(h).toContain('<link rel="canonical" href="https://hyeoks.com/ratings">');
    expect(h).toContain("0.80"); // 스피어만
    expect(h).toContain("순위표 1위, Elo 2위");
    expect(h).toContain("라리가 +105점"); // 홈 이점 예외는 코드 값 그대로
    expect(h).toContain('"ratings_view"');
    expect(h).toContain("<caption");
    expect(h).not.toContain("noindex");
    expect(ratingsIndexable(ov())).toBe(true);
    for (const w of FORBIDDEN) expect(body(h), w).not.toContain(w);
  });

  it("자료가 없으면 noindex, 국가대표 실패는 그 칸만 안내", () => {
    const empty = ov({ leagues: [], national: null, nationalAsOf: null });
    expect(ratingsIndexable(empty)).toBe(false);
    const h = renderRatingsPage(empty);
    expect(h).toContain("noindex");
    expect(h).toContain("국가대표 Elo를 지금 불러오지 못했습니다");
  });

  it("메뉴: /ratings는 경기 분석 아래 '전력 순위', 이벤트 허용 목록", () => {
    expect(navSection("/ratings")).toBe("matches");
    const head = siteHeader("/ratings");
    expect(head).toContain('<a href="/ratings" aria-current="page">전력 순위</a>');
    expect(head.indexOf('href="/matches"')).toBeLessThan(head.indexOf('href="/ratings"'));
    expect(USAGE_EVENTS as readonly string[]).toContain("ratings_view");
  });
});
