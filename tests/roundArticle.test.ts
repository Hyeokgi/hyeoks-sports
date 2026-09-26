import { describe, it, expect } from "vitest";
import {
  buildRoundArticle,
  renderArticleBodyHtml,
  renderArticlePlainText,
  renderRoundPage,
  renderDraftPage,
  DISCLAIMER,
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
    expect(a.appUrl).toBe("https://example.dev/?round=56");
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
  it("공개 페이지는 canonical·설명 메타가, 초안은 noindex가 있다", () => {
    expect(renderRoundPage(a)).toContain('rel="canonical" href="https://example.dev/round/56"');
    expect(renderRoundPage(a)).toContain('name="description"');
    expect(renderDraftPage(a)).toContain('content="noindex,nofollow"');
  });
});
