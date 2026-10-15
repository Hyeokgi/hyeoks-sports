import { describe, it, expect, vi, afterEach } from "vitest";
import { computeStandings, rankElo, type ResultRow } from "../src/lib/leagueTables";
import { computeRankGaps, rankGapIndexable, renderRankGapPage } from "../src/lib/rankGapPage";
import { loadRatingsOverview, type LeagueOverview, type RatingsOverview } from "../src/lib/leagueTablesStore";
import { handleRankGapPage } from "../src/routes/rankGapPage";
import type { Env } from "../src/types";

vi.mock("../src/lib/leagueTablesStore", async (original) => ({
  ...await original<typeof import("../src/lib/leagueTablesStore")>(),
  loadRatingsOverview: vi.fn(),
}));
const DATE = "2026-10-13T00:00:00Z";
// 8팀이 서로 한 번씩 1:1 무승부. 전 팀 7경기·7승점·득실차 0이며 영문명으로 순서가 정해진다.
function league(name = "EPL", season = 2026): LeagueOverview {
  const results: ResultRow[] = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    results.push({ date: `${season}-09-${String(results.length + 1).padStart(2, "0")}`, home: `Team${a}`, away: `Team${b}`, hg: 1, ag: 1 });
  }
  const standings = computeStandings(name, results)!;
  const elo = rankElo(standings.rows.map((r, i) => ({ team: r.team, elo: 1400 + i * 10, lastMatchDate: `${season}-09-28` })));
  return { league: name, standings, standingsNote: null, elo, comparison: null, meaningful: true, homeAdv: 60 };
}
function input(leagues: LeagueOverview[] = [league()]): RatingsOverview {
  return { generatedAt: DATE, leagues, national: null, nationalAsOf: null, truncated: false };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("같은 현재 시즌 팀 안의 순위 차이", () => {
  it("강등 팀 Elo와 저장 순위를 무시하고 양쪽 분모를 같은 8팀으로 맞춘다", () => {
    const l = league();
    l.elo.unshift({ rank: 1, team: "Relegated", elo: 9999, change: null, lastMatchDate: "2025-06-01", matches: null });
    l.elo.forEach((r) => { r.rank += 99; });
    const before = JSON.stringify(l);
    const result = computeRankGaps(input([l])).leagues[0];
    expect(result.rows).toHaveLength(8);
    expect(result.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...result.rows.map((r) => r.eloRank)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.rows.some((r) => r.team === "Relegated")).toBe(false);
    expect(result.rows[0]).toMatchObject({ team: "Team0", rank: 1, eloRank: 8, gap: -7 });
    expect(result.rows[7]).toMatchObject({ team: "Team7", rank: 8, eloRank: 1, gap: 7 });
    expect(result.rows.reduce((sum, r) => sum + r.gap, 0)).toBe(0);
    expect(JSON.stringify(l)).toBe(before);
  });
  it("동률은 영문명으로 결정하고 입력 배열 순서와 저장 rank에 의존하지 않는다", () => {
    const l = league();
    l.elo.forEach((r) => { r.elo = 1500; });
    l.elo.reverse();
    l.standings!.rows.reverse();
    l.standings!.rows.forEach((r) => { r.rank = 99; });
    const result = computeRankGaps(input([l])).leagues[0];
    expect(result.rows.every((r) => r.gap === 0)).toBe(true);
    expect(result.largest).toEqual([]);
    expect(result.rows[0].team).toBe("Team0");
    expect(renderRankGapPage(computeRankGaps(input([l])))).toContain("두 순위가 모든 팀에서 같습니다.");
  });
  it("차이가 같은 팀의 요약도 순위표 순서로 고정한다", () => {
    const r = computeRankGaps(input()).leagues[0];
    expect(r.largest.map((x) => x.team)).toEqual(["Team0", "Team7", "Team1"]);
    expect(r.minPlayed).toBe(7);
    expect(r.maxPlayed).toBe(7);
  });
  it("한 팀이라도 5경기 미만이면 리그 전체를 보류하고 정확히 5경기는 허용한다", () => {
    const l = league();
    l.standings!.rows.forEach((r) => { r.played = 5; });
    expect(computeRankGaps(input([l])).leagues).toHaveLength(1);
    l.standings!.rows[0].played = 4;
    expect(computeRankGaps(input([l])).leagues).toHaveLength(0);
  });
  it("8팀 미만·경기 표본 부족·빠진 Elo·비유한 Elo·중복 팀을 비교하지 않는다", () => {
    const few = league(); few.standings!.rows.pop();
    const small = league(); small.standings!.matches = 9;
    const missing = league(); missing.elo.pop();
    const invalid = league(); invalid.elo[0].elo = NaN;
    const duplicate = league(); duplicate.standings!.rows[0].team = duplicate.standings!.rows[1].team;
    for (const l of [few, small, missing, invalid, duplicate]) expect(computeRankGaps(input([l])).leagues).toHaveLength(0);
  });
  it("지난 시즌을 현재로 둔갑시키지 않고 J1·국가대표·조회 잘림도 제외한다", () => {
    expect(computeRankGaps(input([league("EPL", 2025)])).leagues).toHaveLength(0);
    const j1 = league("J1리그");
    expect(computeRankGaps(input([j1])).leagues).toHaveLength(0);
    const national = { ...league(), league: "국가대표" };
    expect(computeRankGaps(input([national])).leagues).toHaveLength(0);
    expect(computeRankGaps({ ...input(), truncated: true }).leagues).toHaveLength(0);
    const suppressed = league(); suppressed.standingsNote = "중단";
    expect(computeRankGaps(input([suppressed])).leagues).toHaveLength(0);
  });
});

describe("웹 고유 해설과 표시", () => {
  it("입력에 있는 숫자로만 실제 발견을 설명하고 전체 표·출처·링크를 제공한다", () => {
    const ov = computeRankGaps(input([league(), league("K리그1"), league("MLS")]));
    const h = renderRankGapPage(ov);
    expect(h).toContain("8팀, 저장 결과 28경기");
    expect(h).toContain("Team0: 순위표 1위, 같은 참가 팀 안 Elo 8위, 차이 -7계단 · 7경기 7승점, 득실차 0");
    expect(h).toContain("Team7: 순위표 8위, 같은 참가 팀 안 Elo 1위, 차이 +7계단");
    expect(h).toContain("자체 집계(공식 순위 아님)");
    expect(h).toContain("동부·서부 콘퍼런스");
    expect(h).toContain("상·하위 그룹");
    expect(h).toContain("Elo 순위는 예상 최종 순위가 아닙니다.");
    expect(h).toContain("수렴한다는 증거가 아닙니다");
    expect(h).toContain("KST");
    expect(h).toContain('role="region"');
    expect(h).toContain('scope="row"');
    expect(h).toContain('<link rel="canonical" href="https://hyeoks.com/insights/rank-gap">');
    expect(h).toContain('"rank_gap_view"');
    for (const href of ["/ratings", "/league/epl", "/methodology", "/performance", "/insights/draw-rates", "/sources"]) expect(h).toContain(`href="${href}"`);
    for (const phrase of ["저평가", "행운", "운이", "adsbygoogle"]) expect(h).not.toContain(phrase);
  });
  it("이름·시즌 표기·기간·제외 사유를 HTML 이스케이프한다", () => {
    const l = league();
    const bad = '<img src=x onerror="alert(1)">';
    l.standings!.rows[0].team = bad;
    l.elo.find((r) => r.team === "Team0")!.team = bad;
    l.standings!.seasonLabel = '<b>season</b>';
    l.standings!.lastDate = '<svg onload="x">';
    const blocked = league("MLS"); blocked.standingsNote = '<script>bad()</script>';
    const h = renderRankGapPage(computeRankGaps(input([l, blocked])));
    expect(h).toContain("&lt;img src=x onerror=&quot;");
    expect(h).toContain("&lt;b&gt;season&lt;/b&gt;");
    expect(h).toContain("&lt;svg onload=&quot;");
    expect(h).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(h).not.toContain(bad);
    expect(h).not.toContain("<script>bad()");
  });
  it("조건 충족 리그 2개부터 색인하고 빈 화면에 추정 순위를 만들지 않는다", () => {
    const empty = computeRankGaps(input([]));
    const one = computeRankGaps(input());
    const two = computeRankGaps(input([league(), league("K리그1")]));
    expect(rankGapIndexable(empty)).toBe(false);
    expect(rankGapIndexable(one)).toBe(false);
    expect(rankGapIndexable(two)).toBe(true);
    const h = renderRankGapPage(empty);
    expect(h).toContain("비교 자료를 기다리고 있습니다");
    expect(h).toContain('<meta name="robots" content="noindex,follow">');
    expect(h).not.toContain("<tbody>");
    expect(h).not.toContain("NaN");
    expect(renderRankGapPage(two)).not.toContain('<meta name="robots"');
  });
});

describe("SSR 응답", () => {
  it("600초 캐시와 빈 자료 noindex", async () => {
    vi.stubGlobal("caches", undefined);
    vi.mocked(loadRatingsOverview).mockResolvedValueOnce(input([]));
    const res = await handleRankGapPage({} as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
    expect(await res.text()).toContain('content="noindex,follow"');
  });
  it("조회 오류는 브랜드 503이고 내부 문자열을 노출하지 않는다", async () => {
    vi.stubGlobal("caches", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadRatingsOverview).mockRejectedValueOnce(new Error("private-db-token"));
    const res = await handleRankGapPage({} as Env);
    const h = await res.text();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h).toContain("HYEOKS");
    expect(h).not.toContain("private-db-token");
  });
});
