import { describe, it, expect } from "vitest";
import { classifySource, kstDay, USAGE_EVENTS } from "../src/lib/usage";
import {
  snapshotToPrediction,
  shouldSnapshot,
  isVerifiedSnapshot,
  isGroundedPrediction,
  isSnapshotWritable,
  classifyRecord,
  parseSnapshotTimestamp,
  SNAPSHOT_UPSERT_SQL,
  type PredictionSnapshot,
  type SnapshotRow,
} from "../src/lib/predictionSnapshot";
import type { MatchPrediction } from "../src/lib/prediction";
import { buildRoundArticle, renderDraftPage, renderRoundPage, withUtm } from "../src/lib/roundArticle";

describe("classifySource", () => {
  const host = "kleague-toto-predictor.hyeoks.workers.dev";
  it("우리가 단 utm_source가 우선", () => {
    expect(classifySource("blog", "https://m.blog.naver.com/x", host)).toBe("blog");
  });
  it("utm이 없으면 리퍼러로 분류", () => {
    expect(classifySource(null, "https://m.blog.naver.com/abc/123", host)).toBe("naver");
    expect(classifySource(null, "https://www.google.com/", host)).toBe("google");
    expect(classifySource(null, `https://${host}/round/56`, host)).toBe("internal");
    expect(classifySource(null, "", host)).toBe("direct");
    expect(classifySource(null, "https://example.com/", host)).toBe("referral");
  });
  it("이상한 utm 값은 받지 않는다(표 오염 방지)", () => {
    expect(classifySource("<script>", "", host)).toBe("direct");
    expect(classifySource("a".repeat(40), "", host)).toBe("direct");
  });
  it("KST 날짜 경계", () => {
    expect(kstDay(Date.parse("2026-09-26T14:59:00Z"))).toBe("2026-09-26");
    expect(kstDay(Date.parse("2026-09-26T15:00:00Z"))).toBe("2026-09-27");
  });
  it("앱이 보내는 탭 이벤트가 모두 허용 목록에 있다", () => {
    for (const t of ["matches", "settings", "ai", "bets", "calibration", "info"]) {
      expect(USAGE_EVENTS as readonly string[]).toContain(`tab_${t}`);
    }
  });
});

describe("prediction snapshot", () => {
  const row: SnapshotRow = {
    round_match_id: 1,
    p_home: 0.3,
    p_draw: 0.3,
    p_away: 0.4,
    pick: "원정승",
    basis: "market",
    confidence_gap: 0.1,
    tier: null,
    n_bookmakers: 7,
    captured_at: "2026-09-27T10:00:00Z",
  };
  it("저장된 픽이 1위로 복원된다", () => {
    const p = snapshotToPrediction(row);
    expect(p.rankedPicks).toEqual(["원정승", "홈승", "무승부"]);
    expect(p.basis).toBe("market");
    expect(p.confidenceGap).toBe(0.1);
  });
  it("동률이어도 그때 낸 픽을 지킨다", () => {
    const p = snapshotToPrediction({ ...row, p_home: 0.35, p_away: 0.35, pick: "원정승" });
    expect(p.rankedPicks[0]).toBe("원정승");
    expect(new Set(p.rankedPicks).size).toBe(3);
  });
  it("킥오프 전만, 사후 등록은 제외", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    expect(shouldSnapshot("2026-09-27T13:00:00Z", false, now)).toBe(true);
    expect(shouldSnapshot("2026-09-27T11:00:00Z", false, now)).toBe(false);
    expect(shouldSnapshot("2026-09-27T13:00:00Z", true, now)).toBe(false);
    // 킥오프와 같은 순간도 쓰지 않는다(엄격히 now < kickoff).
    expect(shouldSnapshot("2026-09-27T12:00:00Z", false, now)).toBe(false);
  });
  it("킥오프를 모르거나 못 읽으면 쓰지 않는다(킥오프 전 저장을 증명할 수 없다)", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    expect(shouldSnapshot(null, false, now)).toBe(false);
    expect(shouldSnapshot("", false, now)).toBe(false);
    expect(shouldSnapshot("내일", false, now)).toBe(false);
    expect(shouldSnapshot("2026-02-30T13:00:00Z", false, now)).toBe(false); // 없는 날짜
    expect(shouldSnapshot("2026-09-28", false, now)).toBe(false); // 날짜만 - 시각 모름
  });
  it("시각 파서: ISO·오프셋·SQLite 표기를 같은 순간으로 읽는다", () => {
    const t = Date.parse("2026-09-27T10:00:00Z");
    expect(parseSnapshotTimestamp("2026-09-27T10:00:00.000Z")).toBe(t);
    expect(parseSnapshotTimestamp("2026-09-27T19:00:00+09:00")).toBe(t);
    expect(parseSnapshotTimestamp("2026-09-27 10:00:00")).toBe(t);
    expect(parseSnapshotTimestamp(null)).toBeNull();
  });
});

describe("엄격 스냅샷 검증", () => {
  const pred = (over: Partial<MatchPrediction> = {}): MatchPrediction => ({
    pHome: 0.5,
    pDraw: 0.3,
    pAway: 0.2,
    rankedPicks: ["홈승", "무승부", "원정승"],
    confidenceGap: 0.2,
    basis: "market",
    ...over,
  });
  const snap = (over: Partial<PredictionSnapshot> = {}, p: Partial<MatchPrediction> = {}): PredictionSnapshot => ({
    prediction: pred(p),
    tier: null,
    nBookmakers: 5,
    capturedAt: "2026-09-27T10:00:00.000Z",
    ...over,
  });
  const KO = "2026-09-27T12:00:00Z";

  it("저장 < 유효한 킥오프 + 근거 있음 + 확률 정상이면 검증된 기록", () => {
    expect(isVerifiedSnapshot(snap(), KO)).toBe(true);
    expect(isVerifiedSnapshot(snap({}, { basis: "model" }), KO)).toBe(true);
    expect(isVerifiedSnapshot(snap({}, { basis: "national" }), KO)).toBe(true);
  });
  it("킥오프를 모르거나 못 읽으면 검증 실패", () => {
    expect(isVerifiedSnapshot(snap(), null)).toBe(false);
    expect(isVerifiedSnapshot(snap(), undefined)).toBe(false);
    expect(isVerifiedSnapshot(snap(), "오류")).toBe(false);
  });
  it("킥오프 시각 또는 그 이후 저장, 저장 시각 누락·오류는 검증 실패", () => {
    expect(isVerifiedSnapshot(snap({ capturedAt: KO }), KO)).toBe(false);
    expect(isVerifiedSnapshot(snap({ capturedAt: "2026-09-27T12:30:00Z" }), KO)).toBe(false);
    expect(isVerifiedSnapshot(snap({ capturedAt: "" }), KO)).toBe(false);
    expect(isVerifiedSnapshot(snap({ capturedAt: "garbage" }), KO)).toBe(false);
    expect(isVerifiedSnapshot(null, KO)).toBe(false);
  });
  it("근거 없음(none)·이상한 확률·잘못된 픽은 검증 실패", () => {
    expect(isVerifiedSnapshot(snap({}, { basis: "none" }), KO)).toBe(false);
    expect(isVerifiedSnapshot(snap({}, { pHome: NaN }), KO)).toBe(false);
    expect(isVerifiedSnapshot(snap({}, { pHome: 0.6 }), KO)).toBe(false); // 합 1.1
    expect(isVerifiedSnapshot(snap({}, { pHome: -0.1, pDraw: 0.6, pAway: 0.5 }), KO)).toBe(false);
    expect(isVerifiedSnapshot(snap({}, { rankedPicks: ["원정승", "홈승", "무승부"] }), KO)).toBe(false); // 최고 확률 아님
    expect(isGroundedPrediction(pred({ rankedPicks: ["무" as any, "홈승", "원정승"] }))).toBe(false);
    // 동률이면 어느 쪽 픽이든 인정한다.
    expect(isGroundedPrediction(pred({ pHome: 0.35, pDraw: 0.3, pAway: 0.35, rankedPicks: ["원정승", "홈승", "무승부"] }))).toBe(true);
  });
  it("쓰기 판정: 근거 없음·이상한 확률·킥오프 불명은 쓰지 않는다", () => {
    const now = Date.parse("2026-09-27T10:00:00Z");
    const ok = { kickoffAt: KO, predictedAfterKickoff: false, prediction: pred() };
    expect(isSnapshotWritable(ok, now)).toBe(true);
    expect(isSnapshotWritable({ ...ok, prediction: pred({ basis: "none" }) }, now)).toBe(false);
    expect(isSnapshotWritable({ ...ok, prediction: pred({ pDraw: Infinity }) }, now)).toBe(false);
    expect(isSnapshotWritable({ ...ok, kickoffAt: null }, now)).toBe(false);
    expect(isSnapshotWritable(ok, Date.parse(KO))).toBe(false);
  });
  it("SQL이 저장 시각 < 킥오프를 julianday로 원자적으로 다시 확인한다", () => {
    expect(SNAPSHOT_UPSERT_SQL).toContain("julianday(?) < julianday(rm.kickoff_at)");
    expect(SNAPSHOT_UPSERT_SQL).toContain("julianday('now') < julianday(rm.kickoff_at)");
    expect(SNAPSHOT_UPSERT_SQL).toContain("rm.kickoff_at IS NOT NULL");
    // 바인딩 13개: 값 10 + round_match_id + captured_at 2회
    expect(SNAPSHOT_UPSERT_SQL.split("?").length - 1).toBe(13);
  });
  it("기록 출처 분류: verified / no_prediction / unverified / reconstructed", () => {
    const market = { basis: "market" as const };
    expect(classifyRecord(snap(), KO, market, false)).toBe("verified");
    // 사후 등록 경기는 스냅샷이 있어도 채점하지 않는다
    expect(classifyRecord(snap(), KO, market, true)).toBe("unverified");
    expect(classifyRecord(snap({ capturedAt: "2026-09-27T13:00:00Z" }), KO, market, false)).toBe("unverified");
    expect(classifyRecord(snap(), null, market, false)).toBe("unverified");
    expect(classifyRecord(snap({}, { basis: "none" }), KO, market, false)).toBe("no_prediction");
    expect(classifyRecord(undefined, KO, { basis: "none" }, false)).toBe("no_prediction");
    // 스냅샷이 없던 시절: 현재 코드 재계산 = 재구성(채점 제외)
    expect(classifyRecord(undefined, KO, market, false)).toBe("reconstructed");
    expect(classifyRecord(undefined, KO, market, true)).toBe("unverified");
  });
});

describe("기준 시각·유입 꼬리표", () => {
  const a = buildRoundArticle({
    roundNo: 56,
    matches: [],
    report: null,
    recent: [],
    origin: "https://x.dev",
    appRoundId: 17,
    asOf: "2026-09-26T01:49:21Z",
  });
  it("withUtm", () => {
    expect(withUtm("https://x.dev/?round=56", "blog", 56)).toBe("https://x.dev/?round=56&utm_source=blog&utm_campaign=r56");
  });
  it("초안 링크는 blog, 공개 페이지 링크는 round_page 꼬리표", () => {
    expect(renderDraftPage(a)).toContain("utm_source=blog&amp;utm_campaign=r56");
    expect(renderRoundPage(a)).toContain("utm_source=round_page&amp;utm_campaign=r56");
  });
  it("데이터 기준 시각을 한국시간으로 표기한다", () => {
    expect(a.asOfKst).toContain("10:49");
    expect(renderRoundPage(a)).toContain("데이터 기준");
    expect(a.dataUrl).toBe("https://x.dev/round/56/data.json");
  });
});
