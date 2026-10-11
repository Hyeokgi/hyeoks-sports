// 공개 홈과 사전 예측 성적. 10분 캐시로 동일한 데이터 조회를 방문마다 반복하지 않는다.
import { loadHubView } from "../lib/matchPage";
import { loadPublicPerformance } from "../lib/publicPerformance";
import { renderDataHome } from "../lib/dataHome";
import { renderPerformancePage } from "../lib/performancePage";
import { errorPage, publicHtml, PUBLIC_ORIGIN } from "../lib/publicSite";
import type { Env } from "../types";
const TTL = 600;
async function cachedPage(path: string, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const key = new Request(PUBLIC_ORIGIN + path, { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const res = await make();
  if (cache && res.status === 200 && !res.headers.get("cache-control")?.includes("no-store")) await cache.put(key, res.clone());
  return res;
}
export async function handleDataHome(env: Env): Promise<Response> {
  return cachedPage("/", async () => {
    const now = Date.now();
    const [hub, performance, rounds] = await Promise.allSettled([
      loadHubView(env, now),
      loadPublicPerformance(env, now),
      env.DB.prepare(`SELECT DISTINCT r.round_no, r.status, r.sale_end_at FROM rounds r WHERE r.round_no_confirmed = 1 AND r.round_no IS NOT NULL AND EXISTS (SELECT 1 FROM round_matches rm JOIN round_predictions p ON p.round_match_id = rm.id WHERE rm.round_id = r.id) ORDER BY r.round_no DESC LIMIT 3`).all<{ round_no: number; status: string; sale_end_at: string | null }>(),
    ]);
    // 핵심 조회 실패와 휴식기의 빈 목록을 구분한다. 보조 조회 실패는 화면에 명시한다.
    if (hub.status === "rejected") { console.error("home: 경기 조회 실패",hub.reason); return errorPage(503); }
    const res = publicHtml(renderDataHome({ generatedAt: new Date(now).toISOString(), matches: [...hub.value.byLeague.values()].flat(), performance: performance.status === "fulfilled" ? performance.value : null, performanceUnavailable: performance.status === "rejected", rounds: rounds.status === "fulfilled" ? rounds.value.results ?? [] : [] }),200,TTL);
    if (performance.status === "rejected" || rounds.status === "rejected") res.headers.set("cache-control","no-store");
    return res;
  });
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
