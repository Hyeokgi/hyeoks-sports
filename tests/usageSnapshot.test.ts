import { describe, it, expect } from "vitest";
import { classifySource, kstDay, USAGE_EVENTS } from "../src/lib/usage";
import { snapshotToPrediction, shouldSnapshot, type SnapshotRow } from "../src/lib/predictionSnapshot";
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
    expect(shouldSnapshot(null, false, now)).toBe(true);
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
