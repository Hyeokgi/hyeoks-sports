// 공개 홈과 사전 예측 성적. 10분 캐시로 동일한 데이터 조회를 방문마다 반복하지 않는다.
import { loadPublicPerformance } from "../lib/publicPerformance";
import { renderDataHome } from "../lib/dataHome";
import { renderPerformancePage } from "../lib/performancePage";
import { publicHtml, PUBLIC_ORIGIN } from "../lib/publicSite";
import type { Env } from "../types";
const TTL = 600;
async function cachedPage(path: string, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const key = new Request(PUBLIC_ORIGIN + path + "?release=football-20261120", { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const res = await make();
  if (cache && res.status === 200 && !res.headers.get("cache-control")?.includes("no-store")) await cache.put(key, res.clone());
  return res;
}
export async function handleDataHome(_env: Env): Promise<Response> {
  // 기사 본문은 DB 장애와 함께 사라지지 않는다. 최신 데이터는 각 자료 페이지에서 조회한다.
  return cachedPage("/", async () => publicHtml(renderDataHome({ generatedAt: new Date().toISOString(), matches: [], performance: null, performanceUnavailable: false, rounds: [] }),200,TTL));
}
export async function handlePerformancePage(env: Env): Promise<Response> {
  return cachedPage("/performance", async () => publicHtml(renderPerformancePage(await loadPublicPerformance(env)),200,TTL));
}
export async function handlePerformanceData(env: Env): Promise<Response> {
  return new Response(JSON.stringify(await loadPublicPerformance(env)), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600", "x-robots-tag": "noindex", "access-control-allow-origin": "*" } });
}
/** 기존 블로그·앱 링크의 회차·보기·탭 지정은 도구로 보낸다. UTM만 있는 링크는 데이터 홈을 본다. */
export function legacyAppLocation(url: URL): string | null {
  if (url.pathname !== "/") return null;
  const keys = ["round", "view", "tab"];
  if (!keys.some((k) => url.searchParams.has(k))) return null;
  return PUBLIC_ORIGIN + "/app" + url.search;
}
