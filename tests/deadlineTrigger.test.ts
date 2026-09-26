import { describe, it, expect, vi, afterEach } from "vitest";
import { dueCheckpoints, runDeadlineTrigger, doneKey, LEAD_MS, type RoundForTrigger } from "../src/cron/deadlineTrigger";
import type { Env } from "../src/types";

// 56회차 실측: 발매 마감 9/28(월) 23:00 KST = 14:00Z (첫 경기 9/29 01:00 KST와 다르다)
const END = "2026-09-28T14:00:00.000Z";
const endMs = Date.parse(END);
const H = 60 * 60 * 1000;
const round = (over: Partial<RoundForTrigger> = {}): RoundForTrigger => ({
  id: 17,
  round_no: 56,
  status: "upcoming",
  sale_end_at: END,
  ...over,
});

function fakeEnv(token?: string) {
  const kv = new Map<string, string>();
  const env = {
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => {
        kv.set(k, v);
      },
    },
    GH_DISPATCH_TOKEN: token,
  } as unknown as Env;
  return { env, kv };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dueCheckpoints", () => {
  it("체크포인트 25분 전부터 직전까지만 해당한다", () => {
    const cp12 = endMs - 12 * H;
    expect(dueCheckpoints([round()], cp12 - LEAD_MS - 1)).toHaveLength(0);
    expect(dueCheckpoints([round()], cp12 - LEAD_MS).map((d) => d.hours)).toEqual([12]);
    expect(dueCheckpoints([round()], cp12 - 60_000).map((d) => d.hours)).toEqual([12]);
    expect(dueCheckpoints([round()], cp12)).toHaveLength(0);
  });
  it("12·6·3·1시간 전 네 번 모두 잡힌다", () => {
    const hits = [12, 6, 3, 1].map((h) => dueCheckpoints([round()], endMs - h * H - 10 * 60_000));
    expect(hits.map((x) => x.map((d) => d.hours))).toEqual([[12], [6], [3], [1]]);
  });
  it("마감을 모르거나 이미 지났거나 진행중이 아니면 제외", () => {
    const t = endMs - H - 60_000;
    expect(dueCheckpoints([round({ sale_end_at: null })], t)).toHaveLength(0);
    expect(dueCheckpoints([round({ status: "settled" })], t)).toHaveLength(0);
    expect(dueCheckpoints([round()], endMs + 1)).toHaveLength(0);
  });
});

describe("runDeadlineTrigger", () => {
  const now = endMs - 6 * H - 10 * 60_000;
  const load = async () => [round()];

  it("토큰이 없으면 호출하지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env } = fakeEnv();
    const r = await runDeadlineTrigger(env, now, load);
    expect(r).toMatchObject({ due: 1, dispatched: false, reason: "no_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pipeline 태스크를 main으로 한 번 호출하고, 같은 체크포인트는 다시 부르지 않는다", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { env, kv } = fakeEnv("t");
    const first = await runDeadlineTrigger(env, now, load);
    expect(first).toMatchObject({ dispatched: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/actions/workflows/fetch_vote_share.yml/dispatches");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main", inputs: { task: "pipeline" } });
    expect(kv.has(doneKey({ roundId: 17, roundNo: 56, hours: 6, checkpointAt: "" }))).toBe(true);

    // 10분 뒤 크론(아직 같은 호출 창 안): now는 체크포인트 10분 전이므로 5분 뒤로 본다
    const second = await runDeadlineTrigger(env, now + 5 * 60_000, load);
    expect(second).toMatchObject({ dispatched: false, reason: "already_done" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("호출이 실패하면 완료로 표시하지 않아 다음 크론에서 다시 시도한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 401 })));
    const { env, kv } = fakeEnv("t");
    const r = await runDeadlineTrigger(env, now, load);
    expect(r).toMatchObject({ dispatched: false, reason: "dispatch_failed" });
    expect(kv.has(doneKey({ roundId: 17, roundNo: 56, hours: 6, checkpointAt: "" }))).toBe(false);
  });
});
