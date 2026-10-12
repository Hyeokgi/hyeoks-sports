// GET /insights/draw-rates - 리그·시즌별 홈승·무승부·원정승 비율(SSR).
// 결과는 하루에 몇 번만 바뀌므로 1시간 공유 캐시를 쓴다. 조회가 실패하면 브랜드 503(내부 오류 문자열 노출 금지).
import { getAllMatches } from "../lib/db";
import { computeDrawRates, renderDrawRatesPage } from "../lib/drawRatesPage";
import { errorPage, publicHtml, PUBLIC_ORIGIN } from "../lib/publicSite";
import type { Env } from "../types";

const TTL = 3600;

export async function handleDrawRatesPage(env: Env): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const key = new Request(PUBLIC_ORIGIN + "/insights/draw-rates", { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  try {
    // getAllMatches는 팀명을 정식 키로 바꾸고 같은 경기의 중복 표기를 뺀 결과를 준다(teamAlias.ts).
    const ov = computeDrawRates(await getAllMatches(env));
    const res = publicHtml(renderDrawRatesPage(ov), 200, TTL);
    if (cache) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    console.error(`handleDrawRatesPage: ${(err as Error).message}`);
    return errorPage(503);
  }
}
