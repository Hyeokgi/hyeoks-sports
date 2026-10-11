// GET /ratings - 리그별 Elo 전력 순위(SSR). 다른 공개 페이지와 같은 10분 공유 캐시를 쓴다.
// 클럽 자료 조회가 실패하면 브랜드 503(내부 오류 문자열 노출 금지), 국가대표만 실패하면 그 칸만 안내하고
// 1분만 캐시해 곧 다시 시도한다.
import { loadRatingsOverview } from "../lib/leagueTablesStore";
import { renderRatingsPage } from "../lib/ratingsPage";
import { errorPage, publicHtml, PUBLIC_ORIGIN } from "../lib/publicSite";
import type { Env } from "../types";

const TTL = 600;
const PARTIAL_TTL = 60;

export async function handleRatingsPage(env: Env): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const key = new Request(PUBLIC_ORIGIN + "/ratings", { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  try {
    const ov = await loadRatingsOverview(env);
    const res = publicHtml(renderRatingsPage(ov), 200, ov.national == null ? PARTIAL_TTL : TTL);
    if (cache) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    console.error(`handleRatingsPage: ${(err as Error).message}`);
    return errorPage(503);
  }
}
