import { describe, it, expect, vi, afterEach } from "vitest";
import { parseResultDate, parseResultScore, isEligibleResult, isEligibleResultDate, resultUtcCutoff } from "../src/lib/resultEligibility";
import { parseFdDate, parseFdResult } from "../src/lib/footballDataResults";
import { fetchFinishedMatches, fetchLeagueFixtures } from "../src/lib/fotmob";
import { getAllMatches } from "../src/lib/db";
import { computeStandings, eloChangeSince, rankElo } from "../src/lib/leagueTables";
import { loadLeagueTables, loadRatingsOverview } from "../src/lib/leagueTablesStore";

const now = Date.parse("2026-11-16T12:00:00Z");
const good = { league: "EPL", date: "2026-11-16", home: "A", away: "B", hg: 0, ag: 0 };
const future = { ...good, date: "2026-12-09" };
afterEach(() => vi.unstubAllGlobals());
describe("결과 UTC 경계", () => {
  it("빈 점수는 0으로 만들지 않고 실제 0은 허용한다", () => {
    for (const x of ["", " ", null, undefined, false, -1, 1.2, NaN, Infinity, "1.5", "-1", "0x10"]) expect(parseResultScore(x)).toBeNull();
    for (const x of [0, "0", " 0 "]) expect(parseResultScore(x)).toBe(0);
  });
  it("실제 달력과 명시적 시간대만 허용한다", () => {
    for (const d of ["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-01-00", "11/16/2026", "2026-11-16T12:00:00", "2026-11-16T24:00:00Z", "2026-11-16T00:00:00+14:01", ""]) expect(parseResultDate(d)).toBeNull();
    expect(parseResultDate("2024-02-29")).not.toBeNull();
    expect(parseResultDate("2026-11-17T01:00:00+09:00")?.day).toBe("2026-11-16");
  });
  it("일 단위 오늘은 허용하되 시각이 있으면 현재까지로 제한한다", () => {
    expect(isEligibleResult(good, now)).toBe(true);
    expect(isEligibleResult(future, now)).toBe(false);
    expect(isEligibleResultDate("2026-11-16T12:00:00Z", now)).toBe(true);
    expect(isEligibleResultDate("2026-11-16T12:00:00.001Z", now)).toBe(false);
    expect(isEligibleResultDate("2026-11-16T21:00:00+09:00", now)).toBe(true);
    for (const bad of [NaN, Infinity, 1e20]) expect(() => resultUtcCutoff(bad)).toThrow();
  });
  it("백필은 잘못된 날짜·빈 스코어·미래 결과를 제외한다", () => {
    expect(parseFdDate("30/02/2026")).toBeNull();
    expect(parseFdDate("29/02/24")).toBe("2024-02-29");
    const row = { date: "16/11/2026", home: "A", away: "B", hg: "0", ag: "0" };
    expect(parseFdResult(row, now)?.hg).toBe(0);
    for (const hg of ["", " ", undefined]) expect(parseFdResult({ ...row, hg }, now)).toBeNull();
    expect(parseFdResult({ ...row, date: "09/12/2026" }, now)).toBeNull();
  });
  it("순위표와 변화량은 미래 결과를 사용하지 않는다", () => {
    expect(computeStandings("EPL", [good, future], undefined, now)?.matches).toBe(1);
    expect(eloChangeSince("EPL", [good, future], "2026-11-16", now)).toEqual(eloChangeSince("EPL", [good], "2026-11-16", now));
    expect(rankElo([{ team: "A", elo: 1700, lastMatchDate: future.date }], { teams: new Set(["A"]), now })).toEqual([]);
  });
  it("FotMob 결과만 제한하고 미래 예정 경기는 보존한다", async () => {
    const fixture = (id: number, date: string, scoreStr: string, finished = true) => ({ id, home: { name: "A" }, away: { name: "B" }, status: { utcTime: date, finished, scoreStr } });
    const data = { props: { pageProps: { fixtures: { allMatches: [fixture(1, "2026-11-16T10:00:00Z", "0 - 0"), fixture(2, "2026-12-09T10:00:00Z", "0 - 0"), fixture(3, "2026-11-16T13:00:00Z", "1 - 0"), fixture(4, "2026-11-15T10:00:00Z", " - "), fixture(5, "2026-12-09T10:00:00Z", "", false), fixture(6, "2026-02-30", "1 - 0")] } } } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + '</script>')));
    expect((await fetchFinishedMatches("47", now)).map((r) => r.id)).toEqual([1]);
    expect((await fetchLeagueFixtures("47", now)).map((r) => r.id)).toEqual([1, 5]);
  });
  it("SQL 이후에도 저장된 미래 행을 격리하고 조회 한도와 정렬을 유지한다", async () => {
    const queries: string[] = [];
    const bindings: unknown[][] = [];
    const env = { DB: { prepare: (sql: string) => {
      queries.push(sql);
      return { bind: (...args: unknown[]) => { bindings.push(args); return { all: async () => ({ results: sql.includes("FROM matches") ? [future, good] : sql.includes("FROM team_elo") ? [{ league: "EPL", team_en: "A", elo: 1700, last_match_date: future.date }] : [] }) }; } };
    } } } as any;
    expect(await getAllMatches(env, now)).toEqual([good]);
    const table = await loadLeagueTables(env, "EPL", now);
    expect(table.standings?.matches).toBe(1);
    expect(table.elo).toEqual([]);
    const overview = await loadRatingsOverview(env, now);
    expect(overview.leagues.find((r) => r.league === "EPL")?.elo).toEqual([]);
    expect(queries.every((q) => q.includes("julianday"))).toBe(true);
    expect(queries.filter((q) => !q.includes("ORDER BY league ASC, date ASC")).every((q) => q.includes("LIMIT ?"))).toBe(true);
    expect(bindings.every((args) => args.includes(new Date(now).toISOString()))).toBe(true);
  });
});
