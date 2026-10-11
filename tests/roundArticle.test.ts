import { describe, it, expect } from "vitest";
import {
  buildRoundArticle,
  renderArticleBodyHtml,
  renderArticlePlainText,
  renderRoundPage,
  renderDraftPage,
  DISCLAIMER,
  AI_REPORT_NOTICE,
  METHOD_TEXT,
  RECENT_NOTE,
  isScoredRecord,
  type ArticleMatch,
} from "../src/lib/roundArticle";

const m = (seq: number, over: Partial<ArticleMatch> = {}): ArticleMatch => ({
  seq,
  league: "U네이션",
  home: `홈${seq}`,
  away: `원정${seq}`,
  kickoffAt: `2026-09-27T1${seq % 10}:00:00Z`,
  pHome: 0.5,
  pDraw: 0.28,
  pAway: 0.22,
  pick: "홈승",
  confidenceGap: 0.22,
  basis: "market",
  tier: "근거없음",
  nBookmakers: 7,
  vote: null,
  result: null,
  predictedAfterKickoff: false,
  ...over,
});

const base = {
  roundNo: 56,
  report: "리포트 첫 문단.\n둘째 문단.",
  recent: [
    { roundNo: 55, hits: 7, n: 14 },
    { roundNo: 54, hits: 0, n: 0 },
  ],
  origin: "https://example.dev",
  appRoundId: 17,
};

describe("buildRoundArticle", () => {
  const matches = [
    m(1, { confidenceGap: 0.5 }),
    m(2, { confidenceGap: 0.02, pHome: 0.35, pDraw: 0.3, pAway: 0.35 }),
    m(3, { confidenceGap: 0.4, basis: "national" }),
    m(4, { confidenceGap: 0, basis: "none" }), // 근거 없음 - 상위/하위 어디에도 넣지 않는다
    m(5, { confidenceGap: 0.1, vote: { home: 20, draw: 30, away: 50 } }), // 투표 1위(원정) ≠ 우리 픽(홈)
    m(6, { confidenceGap: 0.3, vote: { home: 60, draw: 25, away: 15 } }),
  ];
  const a = buildRoundArticle({ ...base, matches });

  it("제목·설명에 회차와 대회가 들어간다", () => {
    expect(a.title).toContain("56회차");
    expect(a.title).toContain("U네이션");
    expect(a.description).toContain("6경기");
  });
  it("근거 없는 경기는 확신도 상위·복식 후보에서 빠진다", () => {
    expect(a.top.map((x) => x.seq)).toEqual([1, 3, 6]);
    expect(a.hedges.map((x) => x.seq)).toEqual([2, 5, 6, 3]);
    expect([...a.top, ...a.hedges].some((x) => x.seq === 4)).toBe(false);
  });
  it("대중 투표 1위와 우리 픽이 다른 경기만 고른다", () => {
    expect(a.crowdSplits.map((x) => x.seq)).toEqual([5]);
  });
  it("표본 0인 최근 회차(사후 등록뿐)는 성적에서 뺀다", () => {
    expect(a.recent).toEqual([{ roundNo: 55, hits: 7, n: 14 }]);
  });
  it("링크는 공개 페이지·초안·앱(?round=)", () => {
    expect(a.pageUrl).toBe("https://example.dev/round/56");
    expect(a.draftUrl).toBe("https://example.dev/round/56/draft");
    expect(a.appUrl).toBe("https://example.dev/app?round=56");
  });
});

describe("렌더링", () => {
  const a = buildRoundArticle({
    ...base,
    matches: [m(1, { home: "<script>x</script>", result: { actual: "D", hg: 1, ag: 1 } }), m(2, { basis: "none" })],
  });
  it("본문·텍스트 모두 고지 문구를 포함한다", () => {
    expect(renderArticleBodyHtml(a)).toContain("공식 판매처(베트맨)");
    expect(renderArticlePlainText(a)).toContain(DISCLAIMER);
  });
  it("팀명 등 외부 문자열은 이스케이프한다", () => {
    const html = renderRoundPage(a);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("근거 없는 경기는 추천 칸을 비우고 안내를 붙인다", () => {
    expect(renderArticleBodyHtml(a)).toContain("임시값");
  });
  it("결과가 나온 경기는 스코어를 표시한다", () => {
    expect(renderArticleBodyHtml(a)).toContain("결과 무승부 1:1");
  });
  it("출처 없는 끝난 경기(옛 호출자)는 결과만 보여주고 채점하지 않는다", () => {
    const html = renderArticleBodyHtml(a);
    expect(html).toContain("기록 출처 미확인(채점 제외)");
    expect(html).not.toContain("· 적중");
    expect(html).not.toContain("· 미적중");
  });
  it("AI 리포트는 자동 생성·전문가 독립 검토 아님을 밝힌다", () => {
    expect(a.reportNotice).toBe(AI_REPORT_NOTICE);
    expect(renderArticleBodyHtml(a)).toContain("자동 생성");
    expect(renderArticlePlainText(a)).toContain(AI_REPORT_NOTICE);
    expect(buildRoundArticle({ ...base, report: null, matches: [m(1)] }).reportNotice).toBeNull();
  });
  it("분석 방법은 백테스트를 실제 기록처럼 쓰지 않는다", () => {
    expect(METHOD_TEXT).not.toContain("교차검증에서");
    expect(METHOD_TEXT).toContain("잠정치");
    expect(METHOD_TEXT).toContain("재구성값");
  });
  it("공개 페이지는 canonical·설명 메타가, 초안은 noindex가 있다", () => {
    expect(renderRoundPage(a)).toContain('rel="canonical" href="https://example.dev/round/56"');
    expect(renderRoundPage(a)).toContain('name="description"');
    expect(renderDraftPage(a)).toContain('content="noindex,nofollow"');
  });
});

describe("기록 출처(recordProvenance)", () => {
  const done = (seq: number, over: Partial<ArticleMatch>) =>
    m(seq, { result: { actual: "H", hg: 2, ag: 0 }, ...over });
  const matches = [
    done(1, { recordProvenance: "verified", capturedAt: "2026-09-27T09:00:00Z" }), // 홈승 픽 → 적중
    done(2, { recordProvenance: "verified", pick: "원정승", pHome: 0.2, pAway: 0.5 }), // 미적중
    done(3, { recordProvenance: "reconstructed" }),
    done(4, { recordProvenance: "unverified" }),
    done(5, { recordProvenance: "no_prediction", basis: "none" }),
    m(6), // 진행 전 경기
  ];
  const a = buildRoundArticle({ ...base, matches });
  const html = renderArticleBodyHtml(a);
  const text = renderArticlePlainText(a);

  it("검증된 기록만 채점 대상이다", () => {
    expect(matches.filter(isScoredRecord).map((x) => x.seq)).toEqual([1, 2]);
    // 검증됐어도 사후 등록·근거 없음·결과 없음은 채점하지 않는다
    expect(isScoredRecord(done(7, { recordProvenance: "verified", predictedAfterKickoff: true }))).toBe(false);
    expect(isScoredRecord(done(8, { recordProvenance: "verified", basis: "none" }))).toBe(false);
    expect(isScoredRecord(m(9, { recordProvenance: "verified" }))).toBe(false);
  });
  it("실제 결과는 모두 보여주되 적중 표시는 검증된 기록에만 붙는다", () => {
    expect((html.match(/결과 홈승 2:0/g) ?? []).length).toBe(5);
    expect((html.match(/· 적중/g) ?? []).length).toBe(1);
    expect((html.match(/· 미적중/g) ?? []).length).toBe(1);
    expect(text).toContain("결과 홈승 2:0 · 적중");
  });
  it("재구성·미검증·예측 없음을 분명히 표시한다", () => {
    expect(html).toContain("재구성값(당시 저장 기록 없음, 채점 제외)");
    expect(html).toContain("킥오프 전 저장 미검증(채점 제외)");
    expect(html).toContain("예측 없음(근거 없음, 채점 제외)");
    expect(html).toContain("현재 모델로 다시 계산한 참고값");
    expect(text).toContain("[재구성값(당시 저장 기록 없음, 채점 제외)]");
  });
  it("출처·저장 시각은 선택 필드로 그대로 나간다(schema 1 호환)", () => {
    expect(a.matches[0].recordProvenance).toBe("verified");
    expect(a.matches[0].capturedAt).toBe("2026-09-27T09:00:00Z");
    expect(a.matches[5].recordProvenance).toBeUndefined();
    // 기존 필드는 그대로
    expect(a.matches[0].pick).toBe("홈승");
    expect(a.matches[0].result).toEqual({ actual: "H", hg: 2, ag: 0 });
  });
  it("최근 성적은 킥오프 전 저장 기준 안내와 제외 수를 보여준다", () => {
    const b = buildRoundArticle({ ...base, matches: [m(1)], recent: [{ roundNo: 55, hits: 5, n: 9, excluded: 5 }] });
    const h = renderArticleBodyHtml(b);
    expect(h).toContain("55회차: 5/9 적중");
    expect(h).toContain("채점 제외 5경기");
    expect(h).toContain("저장 시각이 킥오프보다 이른 기록");
    expect(h).not.toContain("공개한 예측 그대로");
    expect(renderArticlePlainText(b)).toContain(RECENT_NOTE);
  });
});
