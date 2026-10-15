// GET /insights/rank-gap. 국가대표 조회 결과는 쓰지 않으며 클럽 비교만 10분 공유 캐시한다.
import { loadRatingsOverview } from "../lib/leagueTablesStore";
import { computeRankGaps, renderRankGapPage } from "../lib/rankGapPage";
import { errorPage, publicHtml, PUBLIC_ORIGIN } from "../lib/publicSite";
import type { Env } from "../types";

const TTL = 600;
export async function handleRankGapPage(env: Env): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const key = new Request(PUBLIC_ORIGIN + "/insights/rank-gap", { method: "GET" });
  try {
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) return hit;
    const ov = computeRankGaps(await loadRatingsOverview(env));
    const res = publicHtml(renderRankGapPage(ov), 200, TTL);
    if (cache) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    console.error(`handleRankGapPage: ${(err as Error).message}`);
    return errorPage(503);
  }
}
