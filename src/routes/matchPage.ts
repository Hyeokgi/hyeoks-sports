// GET /matches, /league/:slug, /match/:slug, /match/:slug/data.json, /api/matches (docs/specs/002, 004 9·10장)
//
// - 입력이 부족한 페이지(matchContentReadiness 미통과)는 200으로 보여주되 meta robots와 X-Robots-Tag 둘 다 noindex.
// - 기계용 JSON(data.json, /api/matches)은 검색 결과에 뜰 이유가 없어 항상 X-Robots-Tag: noindex.
// - 없는 경기·리그는 공통 틀의 404 HTML(noindex, no-store). 조회 실패는 503 HTML(Retry-After). 내부 오류 문자열은 숨긴다.
// - 광고 스크립트는 어떤 응답에도 넣지 않는다.
import {
  loadMatchView,
  renderMatchPage,
  matchData,
  matchIndexable,
  loadLeagueView,
  renderLeaguePage,
  leagueIndexable,
  loadHubView,
  renderHubPage,
  hubIndexable,
  listMatchCards,
  renderNotFoundPage,
  renderUnavailablePage,
} from "../lib/matchPage";
import type { Env } from "../types";

// 경기 예측은 6시간마다 바뀐다. 10분 캐시면 D1 조회를 매 요청마다 하지 않으면서 결과 반영도 늦지 않다.
const CACHE_SECONDS = 600;
const NOINDEX = "noindex";

function html(body: string, opts: { status?: number; noindex?: boolean; cacheSeconds?: number } = {}): Response {
  const status = opts.status ?? 200;
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": status === 200 ? `public, max-age=${opts.cacheSeconds ?? CACHE_SECONDS}` : "no-store",
  };
  if (opts.noindex || status !== 200) headers["x-robots-tag"] = NOINDEX;
  if (status === 503) headers["retry-after"] = "120";
  return new Response(body, { status, headers });
}

function json(body: unknown, status = 200, cache = "no-store", cors = false): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": cache, "x-robots-tag": NOINDEX };
  if (cors) headers["access-control-allow-origin"] = "*";
  return new Response(JSON.stringify(body), { status, headers });
}

const notFoundPage = () => html(renderNotFoundPage(), { status: 404 });

/** HTML 페이지 조회가 실패하면 브랜드 503으로 답한다(빈 성공 페이지·내부 오류 노출 금지). */
async function safePage(label: string, make: () => Promise<Response>): Promise<Response> {
  try {
    return await make();
  } catch (err) {
    console.error(`${label}: ${(err as Error).message}`);
    return html(renderUnavailablePage(), { status: 503 });
  }
}

async function cached(request: Request, key: string, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const cacheKey = new Request(`${new URL(request.url).origin}${key}`, { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const res = await make();
  if (cache && res.status === 200) await cache.put(cacheKey, res.clone());
  return res;
}

export async function handleMatchPage(env: Env, request: Request, slug: string): Promise<Response> {
  return cached(request, `/match/${slug}`, () =>
    safePage("handleMatchPage", async () => {
      const v = await loadMatchView(env, slug);
      return v ? html(renderMatchPage(v), { noindex: !matchIndexable(v) }) : notFoundPage();
    }),
  );
}

export async function handleMatchData(env: Env, slug: string): Promise<Response> {
  try {
    const v = await loadMatchView(env, slug);
    return v ? json(matchData(v), 200, "no-store", true) : json({ error: "match_not_found" }, 404, "no-store", true);
  } catch (err) {
    console.error(`handleMatchData: ${(err as Error).message}`);
    return json({ error: "unavailable" }, 503, "no-store", true);
  }
}

export async function handleLeaguePage(env: Env, request: Request, leagueSlug: string): Promise<Response> {
  return cached(request, `/league/${leagueSlug}`, () =>
    safePage("handleLeaguePage", async () => {
      const d = await loadLeagueView(env, leagueSlug);
      // 순위 자료만 실패한 페이지(tables === null)는 1분만 캐시해 곧 다시 시도하게 한다. 정상 페이지는 10분 그대로.
      return d ? html(renderLeaguePage(d), { noindex: !leagueIndexable(d), cacheSeconds: d.tables === null ? 60 : undefined }) : notFoundPage();
    }),
  );
}

export async function handleHubPage(env: Env, request: Request): Promise<Response> {
  return cached(request, "/matches", () =>
    safePage("handleHubPage", async () => {
      const d = await loadHubView(env);
      return html(renderHubPage(d), { noindex: !hubIndexable(d) });
    }),
  );
}

// GET /api/matches - 앱의 '경기 분석' 목록(지난 14일 ~ 앞으로 8일). 5분 엣지 캐시.
export async function handleMatchList(env: Env, request: Request): Promise<Response> {
  return cached(request, "/api/matches", async () =>
    json({ generatedAt: new Date().toISOString(), matches: await listMatchCards(env) }, 200, "public, max-age=300"),
  );
}
