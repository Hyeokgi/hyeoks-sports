// 공개 감사 화면은 10분 캐시. 조회 실패와 표본 0건을 구분한다.
import { loadProbabilityAudit, renderProbabilityAuditPage } from "../lib/probabilityAuditPage";
import { errorPage, publicHtml, PUBLIC_ORIGIN } from "../lib/publicSite";
import type { Env } from "../types";
export async function handleProbabilityAuditPage(env: Env): Promise<Response> {
  try {
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    const key = new Request(PUBLIC_ORIGIN + "/insights/probability-audit", { method: "GET" });
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) return hit;
    const response = publicHtml(renderProbabilityAuditPage(await loadProbabilityAudit(env)), 200, 600);
    if (cache) await cache.put(key, response.clone());
    return response;
  } catch (err) {
    console.error("handleProbabilityAuditPage: 데이터 조회 실패", err);
    return errorPage(503);
  }
}
