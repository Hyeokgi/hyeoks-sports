import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderDataHome } from "../src/lib/dataHome";
import { navSection, siteHeader, siteFooter } from "../src/lib/publicSite";
import { handleDataHome, legacyAppLocation } from "../src/routes/sitePage";
import { handleStoriesPage } from "../src/routes/storiesPage";
import { LEAGUE_EDITORIAL, leagueEditorialHtml } from "../src/lib/leagueEditorial";
import { LEAGUE_INFO } from "../src/lib/teamNames";
import { USAGE_EVENTS } from "../src/lib/usage";
import { STORIES, STORY_PATHS } from "../src/lib/stories";
const data = { generatedAt: "2026-11-20T14:00:00Z", matches: [], performance: null, performanceUnavailable: false, rounds: [] };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T14:00:00Z")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("이야기 중심 공개 화면", () => {
  it("기사와 원자료가 도구보다 먼저 나오며 도구를 숨기지 않는다", () => {
    const html = renderDataHome(data);
    expect(html).toContain("축구의 재미,");
    expect(html.match(/<h1(?:\s[^>]*)?>/g)).toHaveLength(1);
    expect(html.indexOf('id="h-stories"')).toBeLessThan(html.indexOf("더 살펴보기: 승무패"));
    for (const story of STORIES) expect(html).toContain('href="/stories/' + story.slug + '"');
    for (const url of ["/app", "/performance", "/matches", "/guide/", "/sources"]) expect(html).toContain('href="' + url + '"');
    expect(html).not.toContain("가장 가까운 경기");
    expect(html).not.toContain('src="https://pagead2.googlesyndication.com');
  });
  it("홈은 DB 장애와 무관하게 완성 글을 제공한다", async () => {
    const prepare = vi.fn(() => { throw new Error("DB unavailable"); });
    const response = await handleDataHome({ DB: { prepare } } as any);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(STORIES[0].title);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("공통 메뉴와 꼬리말에서 이야기를 찾고 기존 앱 링크도 보존한다", () => {
    expect(navSection("/stories")).toBe("stories");
    expect(navSection("/stories/laliga-draw-sample")).toBe("stories");
    expect(siteHeader("/stories")).toContain('href="/stories" aria-current="page"');
    expect(siteFooter()).toContain('href="/stories"');
    expect(legacyAppLocation(new URL("https://hyeoks.com/?round=70&utm_source=blog"))).toBe("https://hyeoks.com/app?round=70&utm_source=blog");
    expect(legacyAppLocation(new URL("https://hyeoks.com/?utm_source=blog"))).toBeNull();
    for (const event of ["stories_view", "story_view"]) expect(USAGE_EVENTS).toContain(event);
  });
  it("기사와 스냅샷의 응답·색인 정책을 구분하고 없는 글은 404다", async () => {
    for (const p of STORY_PATHS) {
      const response = handleStoriesPage(p)!;
      expect(response.status).toBe(200);
      expect(response.headers.get("x-robots-tag")).toBeNull();
      expect(await response.text()).not.toContain('content="noindex');
    }
    const snapshot = handleStoriesPage("/stories/laliga-draw-sample/snapshot.json")!;
    expect(snapshot.headers.get("x-robots-tag")).toBe("noindex");
    expect(await snapshot.json()).toMatchObject({matches: 1260, draws: 329});
    const missing = handleStoriesPage("/stories/not-published")!;
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-robots-tag")).toBe("noindex");
    expect(handleStoriesPage("/matches")).toBeNull();
  });
  it("지원 리그마다 고유한 해설이 있으며 알 수 없는 리그에 복제 글을 만들지 않는다", () => {
    for (const league of Object.keys(LEAGUE_INFO)) {
      const item = LEAGUE_EDITORIAL[league];
      expect(item).toBeTruthy();
      expect(leagueEditorialHtml(league)).toContain(item.title);
      expect(item.paragraphs.length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(Object.values(LEAGUE_EDITORIAL).map(i => i.title)).size).toBe(Object.keys(LEAGUE_INFO).length);
    expect(leagueEditorialHtml("없는 리그")).toBe("");
    expect(leagueEditorialHtml("J1리그")).toContain("보류");
    expect(leagueEditorialHtml("MLS")).toContain("콘퍼런스");
  });
  it("코드 전용 배포에는 DB 복구 단계가 섞이지 않는다", () => {
    const workflow = readFileSync(new URL("../.github/workflows/fetch_vote_share.yml", import.meta.url), "utf8");
    const job = workflow.slice(workflow.indexOf("\n  deploy-code-only:"), workflow.indexOf("\n  deploy:"));
    expect(job).toContain("npm ci");
    expect(job).toContain("npm run deploy");
    expect(job).not.toMatch(/wrangler d1|admin\/sync|recompute=|backfill_leagues|secret put/);
    expect(job).toContain("contents: read");
  });
});
