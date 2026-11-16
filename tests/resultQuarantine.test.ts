import { describe, it, expect, vi, afterEach } from "vitest";
import { isEligibleResult, isEligibleStoredResult, isQuarantinedResult, isQuarantinedStoredElo } from "../src/lib/resultEligibility";
import { getAllMatches } from "../src/lib/db";
import { computeStandings, eloChangeSince } from "../src/lib/leagueTables";
import { loadLeagueTables } from "../src/lib/leagueTablesStore";
import { auditResultHistory } from "../src/lib/resultIntegrityAudit";
import { settleRounds } from "../src/lib/settlement";
vi.mock("../src/lib/wisetoto", () => ({ discoverRoundMasterSeq: vi.fn(async () => null), fetchRoundResults: vi.fn(async () => []) }));
const now = Date.parse("2027-01-01T12:00:00Z");
const suspect = { league: "라리가", date: "2026-12-09", home: "Rayo Vallecano", away: "Athletic Club", hg: 0, ag: 0 };
const valid = { ...suspect, date: "2026-11-08", hg: 1 };
afterEach(() => vi.restoreAllMocks());
describe("원본 보존·명시적 읽기 격리", () => {
  it("날짜가 지나도 의심한 정확한 결과만 읽기에서 제외한다", () => {
    expect(isEligibleResult(suspect, now)).toBe(true);
    expect(isEligibleStoredResult(suspect, now)).toBe(false);
    expect(isQuarantinedResult(suspect)).toBe(true);
    for (const item of [valid, { ...suspect, hg: 1 }, { ...suspect, league: "EPL" }, { ...suspect, home: "Athletic Club", away: "Rayo Vallecano" }]) expect(isEligibleStoredResult(item, now)).toBe(true);
    expect(isQuarantinedStoredElo({ league: "라리가", team: suspect.home, lastMatchDate: suspect.date })).toBe(true);
    expect(isQuarantinedStoredElo({ league: "라리가", team: suspect.home, lastMatchDate: "2026-12-10" })).toBe(false);
  });
  it("순위표·변화량·진단에 동일한 읽기 자격을 적용한다", () => {
    const rows = [valid, suspect];
    const before = JSON.stringify(rows);
    expect(computeStandings("라리가", rows, undefined, now)?.matches).toBe(1);
    expect(eloChangeSince("라리가", rows, "2026-11-01", now)).toEqual(eloChangeSince("라리가", [valid], "2026-11-01", now));
    const report = auditResultHistory(rows, [], [], now);
    expect(report.excluded[0].reason).toBe("quarantined_result");
    expect(report.eligibleRows).toBe(1);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("리그 조회는 league 문맥을 붙여 격리하고 의심 날짜의 저장 Elo도 표시하지 않는다", async () => {
    const env = { DB: { prepare: (sql: string) => ({ bind: () => ({ all: async () => ({ results: sql.includes("FROM matches") ? [suspect, valid] : [{ team_en: suspect.home, elo: 1498, last_match_date: suspect.date }] }) }) }) } } as any;
    expect(await getAllMatches(env, now)).toEqual([valid]);
    const table = await loadLeagueTables(env, "라리가", now);
    expect(table.eloSample).toBe(1);
    expect(table.elo).toEqual([]);
  });
  it("격리한 DB 결과로 새 정산을 만들지 않고 원본과 기존 정산도 고치지 않는다", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const writes: unknown[] = [];
    const env = { DB: {
      prepare: (sql: string) => {
        const stmt = { sql, bind: (..._values: unknown[]) => stmt,
          all: async () => ({ results: sql.includes("FROM rounds") ? [{ id: 1, round_no: 70 }] : sql.includes("FROM round_matches") ? [{ id: 2, seq: 1, league: "라리가", home_kr: "라요", away_kr: "빌바오", kickoff_at: "2026-12-09T12:00:00Z" }] : [] }),
          first: async () => ({ hg: 0, ag: 0, date: suspect.date }) };
        return stmt;
      }, batch: async (stmts: unknown[]) => { writes.push(...stmts); return []; },
    } } as any;
    expect(await settleRounds(env)).toEqual({ settled: 0, matchesUpdated: 0 });
    expect(writes).toEqual([]);
  });
});
