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
          all: async () => ({ results: sql.includes("FROM rounds") ? [{ id: 1, round_no: 70 }] : sql.includes("FROM round_matches") ? [{ id: 2, seq: 1, league: "라리가", home_kr: "라요", away_kr: "빌바오", kickoff_at: "2026-12-09T12:00:00Z" }] : sql.includes("FROM matches") ? [{ hg: 0, ag: 0, date: suspect.date }] : [] }) };
        return stmt;
      }, batch: async (stmts: unknown[]) => { writes.push(...stmts); return []; },
    } } as any;
    expect(await settleRounds(env)).toEqual({ settled: 0, matchesUpdated: 0 });
    expect(writes).toEqual([]);
  });
});

function settlementFixture(kickoff: string | null, candidates: { hg:number;ag:number;date:string }[]) {
  const writes: {sql:string;values:unknown[]}[] = [];
  const queries: string[] = [];
  const env = { DB: {
    prepare: (sql: string) => {
      queries.push(sql);
      const stmt = { sql, values: [] as unknown[], bind: (...values: unknown[]) => {stmt.values=values;return stmt;},
        all: async () => ({ results: sql.includes("FROM rounds") ? [{id:1,round_no:70}] : sql.includes("FROM round_matches") ? [{id:2,seq:1,league:"라리가",home_kr:"라요",away_kr:"빌바오",kickoff_at:kickoff}] : sql.includes("FROM matches") ? candidates : [] }) };
      return stmt;
    }, batch: async (stmts: {sql:string;values:unknown[]}[]) => {writes.push(...stmts);return [];},
  } } as any;
  return {env,writes,queries};
}
describe("정산 전에 종료 가능 시각과 유효 후보 확인",()=>{
  it.each(["2026-11-16T20:00:00Z",null,"invalid-date","2026-11-16"])("킥오프 이전·시각 미확인(%s)은 날짜만 같은 점수로 정산하지 않는다",async(kickoff)=>{
    vi.spyOn(Date,"now").mockReturnValue(Date.parse("2026-11-16T12:00:00Z"));
    const f=settlementFixture(kickoff,[{date:"2026-11-16",hg:1,ag:0}]);
    expect(await settleRounds(f.env)).toEqual({settled:0,matchesUpdated:0});
    expect(f.writes).toEqual([]);
    expect(f.queries.some(q=>q.includes("FROM matches"))).toBe(false);
  });
  it("최신 격리 후보가 있어도 날짜 창 안의 유효한 다음 후보를 확인한다",async()=>{
    vi.spyOn(Date,"now").mockReturnValue(now);
    const f=settlementFixture("2026-12-08T12:00:00Z",[{date:suspect.date,hg:0,ag:0},{date:"2026-12-08",hg:2,ag:1}]);
    expect(await settleRounds(f.env)).toEqual({settled:1,matchesUpdated:1});
    const result=f.writes.find(s=>s.sql.includes("INSERT OR REPLACE INTO round_results"));
    expect(result?.values.slice(0,4)).toEqual([2,"H",2,1]);
    expect(f.queries.find(q=>q.includes("FROM matches"))).toContain("LIMIT 5");
  });
});
