import { afterEach, describe, expect, it, vi } from "vitest";
import { PREDICTION_HISTORY_INSERT_SQL, predictionHistoryInputs, PREDICTION_HISTORY_MODEL_REVISION } from "../src/lib/predictionHistory";
import { snapshotRound, SNAPSHOT_UPSERT_SQL } from "../src/lib/predictionSnapshot";
import { buildRoundPredictions, type MatchWithPrediction } from "../src/lib/predictRound";
import type { Env } from "../src/types";

vi.mock("../src/lib/predictRound", () => ({ buildRoundPredictions: vi.fn() }));

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const KO = "2026-10-15T12:00:00.000Z";
function match(over: Partial<MatchWithPrediction> = {}): MatchWithPrediction {
  return {
    match: { id: 7, round_id: 3, league: "EPL", kickoff_at: KO },
    prediction: { pHome: 0.5, pDraw: 0.3, pAway: 0.2, basis: "model", rankedPicks: ["홈승", "무승부", "원정승"], confidenceGap: 0.2 },
    predictedAfterKickoff: false,
    calibration: { tier: "보통", bucket: null },
    raw: { eloDiff: 30, formDiff: 0.2, h2hDiff: 0.1, nH2h: 4, leagueDrawRate: 0.25,
      xgDiff: 0.2, cornersDiff: null, nationalEloDiff: null, resolvedMarketOnly: false,
      market: { pHome: 0.48, pDraw: 0.31, pAway: 0.21, nBookmakers: 5 } },
    ...over,
  } as MatchWithPrediction;
}
function database() {
  const prepare = vi.fn((sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }));
  const batch = vi.fn().mockResolvedValue([{ meta: { changes: 1 } }]);
  return { prepare, batch, env: { DB: { prepare, batch } } as unknown as Env };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("앞으로의 불변 예측 이력", () => {
  it("최신 한 행만 비교하며 A→B→A를 전체 중복으로 제거하지 않는다", () => {
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("ORDER BY h.captured_at DESC, h.id DESC LIMIT 1");
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("FROM latest h WHERE h.p_home = c.p_home");
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("h.p_away = c.p_away AND h.basis = c.basis");
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("julianday(h.captured_at) >= julianday(c.captured_at)");
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("ON CONFLICT(round_match_id, captured_at) DO NOTHING");
    expect(PREDICTION_HISTORY_INSERT_SQL).not.toMatch(/INSERT OR REPLACE|UPDATE|DELETE/);
  });
  it("현재 DB 킥오프와 실제 쓰기 시각을 원자적으로 검사한다", () => {
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("JOIN round_matches rm ON rm.id = c.round_match_id");
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("julianday(c.captured_at) < julianday(rm.kickoff_at)");
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("julianday(c.captured_at) < julianday(c.prediction_kickoff_at)");
    expect(PREDICTION_HISTORY_INSERT_SQL).toContain("julianday('now') < julianday(rm.kickoff_at)");
    expect(PREDICTION_HISTORY_INSERT_SQL.split("?").length - 1).toBe(10);
  });
  it("원자료는 제한된 허용 목록과 실제 서버 기본 토글만 담는다", () => {
    const p = match();
    Object.assign(p.raw, { token: "do-not-store", unrelated: "x".repeat(10000) });
    const json = predictionHistoryInputs(p);
    const context = JSON.parse(json);
    expect(json.length).toBeLessThanOrEqual(4096);
    expect(json).not.toContain("do-not-store");
    expect(context).toMatchObject({ schema: 1, eloDiff: 30, nH2h: 4, market: { nBookmakers: 5 }, toggles: { marketWeight: 0.8 } });
    expect(context).not.toHaveProperty("token");
    p.raw.formDiff = NaN;
    expect(JSON.parse(predictionHistoryInputs(p)).formDiff).toBeNull();
  });
  it("기존 스냅샷 batch가 먼저이며 반환 건수에 이력 쓰기는 더하지 않는다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    vi.mocked(buildRoundPredictions).mockResolvedValue([match()]);
    const db = database();
    db.batch.mockResolvedValueOnce([{ meta: { changes: 1 } }]).mockResolvedValueOnce([{ meta: { changes: 50 } }]);
    expect(await snapshotRound(db.env, 3)).toBe(1);
    expect(db.batch).toHaveBeenCalledTimes(2);
    const first = db.batch.mock.calls[0][0][0];
    const second = db.batch.mock.calls[1][0][0];
    expect(first.sql).toBe(SNAPSHOT_UPSERT_SQL);
    expect(first.values).toHaveLength(13);
    expect(second.sql).toBe(PREDICTION_HISTORY_INSERT_SQL);
    expect(second.values.slice(0, 9)).toEqual([7, 0.5, 0.3, 0.2, "홈승", "model", new Date(NOW).toISOString(), KO, PREDICTION_HISTORY_MODEL_REVISION]);
  });
  it("기존 엄격 판정에서 탈락한 예측은 어느 batch에도 쓰지 않는다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const p = match();
    vi.mocked(buildRoundPredictions).mockResolvedValue([
      match({ predictedAfterKickoff: true }),
      match({ match: { ...p.match, kickoff_at: null } }),
      match({ match: { ...p.match, kickoff_at: new Date(NOW).toISOString() } }),
      match({ prediction: { ...p.prediction, basis: "none" } }),
      match({ prediction: { ...p.prediction, pHome: NaN } }),
    ]);
    const db = database();
    expect(await snapshotRound(db.env, 3)).toBe(0);
    expect(db.batch).not.toHaveBeenCalled();
  });
  it("마이그레이션 누락은 로그로 드러내되 성공한 기존 저장을 깨지 않는다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    vi.mocked(buildRoundPredictions).mockResolvedValue([match()]);
    const db = database();
    const error = new Error("no such table: prediction_history");
    db.batch.mockResolvedValueOnce([{ meta: { changes: 1 } }]).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await snapshotRound(db.env, 3)).toBe(1);
    expect(log).toHaveBeenCalledWith("prediction_history append failed; existing snapshots preserved", { roundId: 3, error });
  });
  it("기존 저장 실패는 이력 저장 전에 호출자에게 전파한다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    vi.mocked(buildRoundPredictions).mockResolvedValue([match()]);
    const db = database();
    db.batch.mockRejectedValueOnce(new Error("snapshot unavailable"));
    await expect(snapshotRound(db.env, 3)).rejects.toThrow("snapshot unavailable");
    expect(db.batch).toHaveBeenCalledTimes(1);
  });
});
