import { describe, expect, beforeEach, afterEach, vi, it } from "vitest";
import { LALIGA_SNAPSHOT, STORIES, STORY_PATHS, storyCards, renderStoriesIndex, renderStory } from "../src/lib/stories";

function jsonLd(html: string): Record<string, any>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-22T09:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("고정 편집 기사와 집계 자료", () => {
  it("고정 시점의 분자·분모·제외 조건을 유지한다", () => {
    expect(LALIGA_SNAPSHOT.schema).toBe(1);
    expect(LALIGA_SNAPSHOT.asOf).toBe("2026-11-16T14:26:05.537Z");
    expect(LALIGA_SNAPSHOT.matches).toBe(1260);
    expect(LALIGA_SNAPSHOT.draws).toBe(329);
    expect(LALIGA_SNAPSHOT.drawRate).toBe(329 / 1260);
    expect((LALIGA_SNAPSHOT.drawRate * 100).toFixed(1)).toBe("26.1");
    expect(LALIGA_SNAPSHOT.rawComparison).toEqual({ matches: 1261, draws: 330 });
    expect(LALIGA_SNAPSHOT.excluded).toEqual([{ id: 964046, date: "2026-12-09", home: "Rayo Vallecano", away: "Athletic Club", hg: 0, ag: 0, reason: "future_date_at_audit" }]);
    expect(LALIGA_SNAPSHOT.period).toEqual({ from: null, to: null, note: "집계 기간 미확인" });
    expect(LALIGA_SNAPSHOT.rules.join(" ")).toContain("집계 스냅샷");
    expect(LALIGA_SNAPSHOT.limitations.join(" ")).toContain("직접 유입원");
  });

  it("중복 없는 경기 기사와 읽을거리의 공개 경로를 반환한다", () => {
    expect(STORIES.filter(story => story.kind !== "match-report").map(story => story.slug)).toEqual(["laliga-draw-sample", "points-and-elo", "probability-and-accuracy"]);
    expect(new Set(STORIES.map((story) => story.slug)).size).toBe(6);
    expect(STORY_PATHS).toEqual(["/stories", ...STORIES.map((story) => `/stories/${story.slug}`)]);
    expect(STORY_PATHS.some((path) => path.endsWith(".json"))).toBe(false);
    expect(storyCards().match(/<article /g)).toHaveLength(6);
    for (const story of STORIES) expect(story.body.match(/<h2>/g)!.length).toBeGreaterThanOrEqual(story.kind === "match-report" ? 3 : 5);
  });

  it.each(STORIES)("$slug 의미 구조·출처·안전한 JSON-LD", (story) => {
    const html = renderStory(story.slug)!;
    expect(html.match(/<h1(?:\s[^>]*)?>/g)).toHaveLength(1);
    expect(html).toContain('<article class="site-prose story-article">');
    expect(html).toContain(`<link rel="canonical" href="https://hyeoks.com/stories/${story.slug}">`);
    expect(html).toContain("작성: HYEOKS");
    expect(html).toContain("AI 편집 보조");
    expect(html).toContain('id="story-sources"');
    expect(html).toContain('href="#story-sources"');
    expect(html).toContain("정정 원칙");
    expect(html).toContain("story_view");
    expect(html).not.toContain('content="noindex');
    const article = jsonLd(html).find((entry) => entry["@type"] === "Article")!;
    expect(article.author).toMatchObject({ "@type": "Organization", name: "HYEOKS" });
    expect(Number.isFinite(Date.parse(article.datePublished))).toBe(true);
    expect(article.dateModified).toBe(article.datePublished);
    expect(article.citation.length).toBeGreaterThan(0);
    expect(article.url).toBe(`https://hyeoks.com/stories/${story.slug}`);
    expect(html).not.toMatch(/<script[^>]+src=["'][^"']*(?:adsbygoogle|googlesyndication|doubleclick)/i);
    expect(html).not.toMatch(/adsbygoogle\s*[.[]/i);
  });

  it("숫자 기사는 집계 스냅샷과 진단을 공개하고 전체 시즌으로 오인시키지 않는다", () => {
    const html = renderStory("laliga-draw-sample")!;
    expect(html).toContain("/stories/laliga-draw-sample/snapshot.json");
    expect(html).toContain(LALIGA_SNAPSHOT.auditUrl);
    expect(html).toContain("집계 기간");
    expect(html).toContain("라리가 역대 전체도, 특정 시즌 전체도 아니다");
    expect(html).toContain("직접 유입원");
    expect(html).toContain("전체 경기 원본 목록이 아닌 집계 스냅샷");
    expect(html).toContain("자동으로 덮어쓰지 않는다");
    const article = jsonLd(html).find((entry) => entry["@type"] === "Article")!;
    expect(article.isBasedOn.url).toBe("https://hyeoks.com/stories/laliga-draw-sample/snapshot.json");
    expect(article.citation).toContain(LALIGA_SNAPSHOT.auditUrl);
    expect(article.isBasedOn.dateCreated).toBe(LALIGA_SNAPSHOT.asOf);
  });

  it("알 수 없는 슬러그를 HTML에 넣지 않는다", () => {
    expect(renderStory("missing")).toBeNull();
    expect(renderStory('</script><script>alert(1)</script>')).toBeNull();
  });

  it("아카이브도 단일 H1과 canonical을 갖는다", () => {
    const html = renderStoriesIndex();
    expect(html.match(/<h1(?:\s[^>]*)?>/g)).toHaveLength(1);
    expect(html).toContain('<link rel="canonical" href="https://hyeoks.com/stories">');
    expect(html).toContain("stories_view");
    expect(html).not.toContain('content="noindex');
    expect(html).not.toMatch(/<script[^>]+src=["'][^"']*(?:adsbygoogle|googlesyndication|doubleclick)/i);
  });
});
