// 경기 확률 원천 선택(selectProbability)·콘텐츠 준비 판정·공용 일괄 선택기(resolveMatches) 검증.
// 왜: 회차 확률로 덮어쓸 때 basis·시각이 fixture 값으로 남거나, 킥오프 뒤 저장된 스냅샷을 '사전 기록'처럼
// 보여주는 일을 막기 위해서다(docs/specs/004 6장).
import { describe, it, expect } from "vitest";
import {
  selectProbability, isGroundedProbability, matchContentReadiness, resolveMatches,
  type ProbabilityCandidate, type MatchRow,
} from "../src/lib/matchPage";

const KICK = "2026-10-10T12:00:00.000Z";
const BEFORE = "2026-10-10T09:00:00.000Z";
const AFTER = "2026-10-10T12:30:00.000Z";
const NOW_PRE = Date.parse("2026-10-10T08:00:00.000Z");
const NOW_POST = Date.parse("2026-10-10T15:00:00.000Z");

const cand = (over: Partial<ProbabilityCandidate> = {}): ProbabilityCandidate => ({
  pHome: 0.5, pDraw: 0.3, pAway: 0.2, pick: "홈승", confidenceGap: 0.2, basis: "model", withMarket: false, nBookmakers: null, asOf: BEFORE, ...over,
});

describe("selectProbability", () => {
  it("킥오프 전: 회차 현재 계산을 쓰고 회차의 basis·시각을 유지한다", () => {
    const s = selectProbability({
      now: NOW_PRE, kickoffAt: KICK, fixture: cand({ basis: "model", asOf: "2026-10-09T00:00:00.000Z" }),
      roundCurrent: cand({ basis: "market", withMarket: true, nBookmakers: 5, asOf: "2026-10-10T07:00:00.000Z", pHome: 0.4, pDraw: 0.3, pAway: 0.3 }),
    });
    expect(s.provenance).toEqual({ kind: "current_estimate", source: "round", capturedAt: "2026-10-10T07:00:00.000Z" });
    expect(s.probability?.basis).toBe("market");
    expect(s.probability?.pHome).toBe(0.4);
  });

  it("킥오프 전: 회차가 basis none이면 fixture 현재 계산", () => {
    const s = selectProbability({ now: NOW_PRE, kickoffAt: KICK, fixture: cand(), roundCurrent: cand({ basis: "none" }) });
    expect(s.provenance.kind).toBe("current_estimate");
    expect(s.provenance.source).toBe("fixture");
  });

  it("킥오프 후: 킥오프 전에 저장된 스냅샷만 쓴다", () => {
    const ok = selectProbability({
      now: NOW_POST, kickoffAt: KICK, fixture: cand(),
      roundSnapshot: { ...cand({ basis: "national", asOf: BEFORE }), rawComputedAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(ok.provenance).toEqual({ kind: "pre_kickoff_snapshot", source: "round", capturedAt: BEFORE });
    expect(ok.probability?.basis).toBe("national");
    expect((ok.probability as any).rawComputedAt).toBeUndefined();
  });

  it("킥오프 후: 스냅샷이 킥오프 뒤 저장됐거나 원본 성분이 킥오프 뒤면 fixture 사전값으로 내려간다", () => {
    const late = selectProbability({ now: NOW_POST, kickoffAt: KICK, fixture: cand(), roundSnapshot: { ...cand({ asOf: AFTER }), rawComputedAt: null } });
    expect(late.provenance.kind).toBe("pre_kickoff_fixture");
    const rawLate = selectProbability({ now: NOW_POST, kickoffAt: KICK, fixture: cand(), roundSnapshot: { ...cand(), rawComputedAt: AFTER } });
    expect(rawLate.provenance.kind).toBe("pre_kickoff_fixture");
  });

  it("회차 킥오프가 더 이르면 그 시각을 기준으로 검증한다", () => {
    const s = selectProbability({
      now: NOW_POST, kickoffAt: KICK, roundKickoffAt: "2026-10-10T08:30:00.000Z", fixture: null,
      roundSnapshot: { ...cand({ asOf: BEFORE }), rawComputedAt: null },
    });
    expect(s.provenance.kind).toBe("unavailable");
  });

  it("킥오프 후 fixture 계산이 킥오프 뒤면 없음(0%가 아니라 표시 안 함)", () => {
    const s = selectProbability({ now: NOW_POST, kickoffAt: KICK, fixture: cand({ asOf: AFTER }) });
    expect(s.probability).toBeNull();
    expect(s.provenance).toEqual({ kind: "unavailable", source: null, capturedAt: null });
  });

  it("근거 있는 확률 판정", () => {
    expect(isGroundedProbability(cand())).toBe(true);
    expect(isGroundedProbability(cand({ basis: "none" }))).toBe(false);
    expect(isGroundedProbability(cand({ pHome: NaN }))).toBe(false);
    expect(isGroundedProbability(cand({ pHome: 0.6 }))).toBe(false);
    expect(isGroundedProbability(null)).toBe(false);
  });
});

describe("matchContentReadiness", () => {
  const base = {
    home: "아스널", away: "첼시", kickoffAt: KICK, status: "scheduled", result: null,
    probability: cand(), provenanceKind: "current_estimate" as const, explanationCount: 2,
  };
  it("모두 갖추면 준비됨", () => expect(matchContentReadiness(base)).toEqual({ ready: true, gaps: [] }));
  it("빠진 항목을 알려준다", () => {
    expect(matchContentReadiness({ ...base, away: "미정" }).gaps).toContain("teams");
    expect(matchContentReadiness({ ...base, kickoffAt: "x" }).gaps).toContain("kickoff");
    expect(matchContentReadiness({ ...base, status: "cancelled" }).gaps).toContain("cancelled");
    expect(matchContentReadiness({ ...base, probability: null, provenanceKind: "unavailable" }).gaps).toEqual(["probability", "provenance"]);
    expect(matchContentReadiness({ ...base, explanationCount: 0 }).gaps).toEqual(["content"]);
  });
  it("끝난 경기는 스코어 + 사전 확률이면 근거 문장 없이도 유용한 기록", () => {
    expect(matchContentReadiness({ ...base, status: "finished", result: { hg: 1, ag: 0 }, provenanceKind: "pre_kickoff_snapshot", explanationCount: 0 }).ready).toBe(true);
    expect(matchContentReadiness({ ...base, status: "finished", result: null }).gaps).toContain("content");
  });
});

// ---------- resolveMatches: 가짜 D1 ----------
function fakeEnv(handlers: { links: any[]; meta: any[]; snaps: any[] }) {
  const calls: string[] = [];
  const DB = {
    prepare(sql: string) {
      const stmt = {
        bind: (..._args: unknown[]) => stmt,
        async all() {
          calls.push(sql);
          if (sql.includes("FROM prediction_snapshots")) return { results: handlers.snaps };
          if (sql.includes("LEFT JOIN round_predictions")) return { results: handlers.meta };
          if (sql.includes("FROM round_matches rm JOIN rounds r")) return { results: handlers.links };
          throw new Error(`예상하지 못한 쿼리: ${sql}`);
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  };
  return { env: { DB } as any, calls };
}

const row = (over: Partial<MatchRow>): MatchRow => ({
  id: 1, league: "EPL", fotmob_id: 1, kickoff_at: KICK, home_en: "Foo FC", away_en: "Bar FC", home_kr: "포우", away_kr: "바르",
  competition: null, slug: "2026-10-10-foo-fc-bar-fc", status: "finished", hg: 1, ag: 0, updated_at: AFTER,
  elo_diff: 80, form_diff: 0.5, h2h_diff: 0, n_h2h: 0, league_draw_rate: 0.25,
  p_home: 0.5, p_draw: 0.27, p_away: 0.23, pick: "홈승", basis: "model", confidence_gap: 0.23, tier: null, computed_at: BEFORE,
  ...over,
});

describe("resolveMatches(공용 일괄 선택기)", () => {
  it("스냅샷 basis·저장 시각을 유지하고, fixture 성분은 맥락으로만 붙인다", async () => {
    const { env } = fakeEnv({
      links: [
        { roundId: 9, roundNo: 60, matchId: 101, seq: 3, league: "EPL", hk: "포우", ak: "바르", kickoffAt: KICK },
        { roundId: 9, roundNo: 60, matchId: 102, seq: 4, league: "EPL", hk: "큐", ak: "제드", kickoffAt: KICK },
      ],
      meta: [{ id: 101, computedAt: "2026-10-01T00:00:00.000Z", marketAt: BEFORE }, { id: 102, computedAt: "2026-10-01T00:00:00.000Z", marketAt: null }],
      snaps: [
        { round_match_id: 101, p_home: 0.4, p_draw: 0.3, p_away: 0.3, pick: "홈승", basis: "market", confidence_gap: 0.1, tier: null, n_bookmakers: 6, captured_at: BEFORE },
        { round_match_id: 102, p_home: 0.4, p_draw: 0.3, p_away: 0.3, pick: "홈승", basis: "market", confidence_gap: 0.1, tier: null, n_bookmakers: 6, captured_at: AFTER },
      ],
    });
    const rows = [
      row({ id: 1 }),
      row({ id: 2, slug: "b", home_en: "Q FC", away_en: "Z FC", home_kr: "큐", away_kr: "제드" }),
      row({ id: 3, slug: "c", home_en: "X FC", away_en: "Y FC", home_kr: "엑스", away_kr: "와이", p_home: null, p_draw: null, p_away: null, pick: null, basis: null, computed_at: null }),
    ];
    const out = await resolveMatches(env, rows, NOW_POST);

    const a = out.get(1)!;
    expect(a.provenance).toEqual({ kind: "pre_kickoff_snapshot", source: "round", capturedAt: BEFORE });
    expect(a.probability?.basis).toBe("market");
    expect(a.probability?.withMarket).toBe(true);
    expect(a.round).toEqual({ roundNo: 60, seq: 3 });
    expect(a.reasons).toEqual([]); // 당시 입력이 없으니 근거를 꾸미지 않는다
    expect(a.explanationNote).toContain("근거를 복원하지 않습니다");
    expect(a.context?.basisLabel).toBe("통계 모델");
    expect(a.context?.lines.some((l) => l.includes("Elo"))).toBe(true);

    const b = out.get(2)!;
    expect(b.provenance.kind).toBe("pre_kickoff_fixture"); // 킥오프 뒤 저장된 스냅샷은 버린다
    expect(b.probability?.basis).toBe("model");
    expect(b.context).toBeNull();
    expect(b.reasons.length).toBeGreaterThan(0);

    const c = out.get(3)!;
    expect(c.probability).toBeNull();
    expect(c.provenance.kind).toBe("unavailable");
    expect(c.round).toBeNull();
  });

  it("회차 조회가 실패해도 fixture 확률로 표시한다", async () => {
    const env = { DB: { prepare: () => { throw new Error("D1 down"); } } } as any;
    const out = await resolveMatches(env, [row({ id: 7 })], NOW_POST);
    expect(out.get(7)!.provenance.kind).toBe("pre_kickoff_fixture");
  });
});
