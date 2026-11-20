// 편집 콘텐츠와 고정 집계 스냅샷은 DB 조회·쓰기 없이 제공한다.
import { STORY_SNAPSHOTS, renderStoriesIndex, renderStory } from "../lib/stories";
import { errorPage, publicHtml } from "../lib/publicSite";
export function handleStoriesPage(pathname: string): Response | null {
  if (pathname === "/stories") return publicHtml(renderStoriesIndex());
  const snapshotSlug = /^\/stories\/([a-z0-9-]+)\/snapshot\.json$/.exec(pathname)?.[1];
  if (snapshotSlug && Object.prototype.hasOwnProperty.call(STORY_SNAPSHOTS, snapshotSlug)) {
    return new Response(JSON.stringify(STORY_SNAPSHOTS[snapshotSlug], null, 2), { headers: {
      "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400",
      "x-robots-tag": "noindex", "x-content-type-options": "nosniff",
    } });
  }
  if (!pathname.startsWith("/stories/")) return null;
  const slug = /^\/stories\/([a-z0-9-]+)$/.exec(pathname)?.[1];
  const html = slug ? renderStory(slug) : null;
  return html ? publicHtml(html) : errorPage(404);
}
