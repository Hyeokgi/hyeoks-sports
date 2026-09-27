// GET /matches, /league/:slug, /match/:slug, /match/:slug/data.json (docs/specs/002-match-pages.md)
import {
  loadMatchView,
  renderMatchPage,
  matchData,
  loadLeagueView,
  renderLeaguePage,
  loadHubView,
  renderHubPage,
  listMatchCards,
} from "../lib/matchPage";
import type { Env } from "../types";

// 경기 예측은 6시간마다 바뀐다. 10분 캐시면 D1 조회를 매 요청마다 하지 않으면서 결과 반영도 늦지 않다.
const CACHE_SECONDS = 600;

function html(body: string, status = 200, cacheSeconds = CACHE_SECONDS): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": status === 200 ? `public, max-age=${cacheSeconds}` : "no-store" },
  });
}

function notFoundPage(): Response {
  return html(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>경기를 찾을 수 없습니다 | HYEOKS</title></head>
<body style="margin:0;background:#0a0c12;color:#f2f4f8;font:16px/1.7 -apple-system,'Apple SD Gothic Neo',sans-serif"><main style="max-width:560px;margin:0 auto;padding:48px 20px;text-align:center">
<h1 style="font-size:1.3rem">경기를 찾을 수 없습니다</h1><p style="color:#8b93a5">주소가 바뀌었거나 아직 분석이 만들어지지 않은 경기입니다.</p>
<p><a style="color:#8b93ff" href="/matches">이번 주 경기 분석 보기 →</a></p></main></body></html>`,
    404,
  );
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
  return cached(request, `/match/${slug}`, async () => {
    const v = await loadMatchView(env, slug);
    return v ? html(renderMatchPage(v)) : notFoundPage();
  });
}

export async function handleMatchData(env: Env, slug: string): Promise<Response> {
  const v = await loadMatchView(env, slug);
  return new Response(JSON.stringify(v ? matchData(v) : { error: "match_not_found" }), {
    status: v ? 200 : 404,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

export async function handleLeaguePage(env: Env, request: Request, leagueSlug: string): Promise<Response> {
  return cached(request, `/league/${leagueSlug}`, async () => {
    const d = await loadLeagueView(env, leagueSlug);
    return d ? html(renderLeaguePage(d)) : notFoundPage();
  });
}

export async function handleHubPage(env: Env, request: Request): Promise<Response> {
  return cached(request, "/matches", async () => html(renderHubPage(await loadHubView(env))));
}

// GET /api/matches - 앱의 '경기 분석' 목록(지난 14일 ~ 앞으로 8일). 5분 엣지 캐시.
export async function handleMatchList(env: Env, request: Request): Promise<Response> {
  return cached(request, "/api/matches", async () =>
    new Response(JSON.stringify({ generatedAt: new Date().toISOString(), matches: await listMatchCards(env) }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
    }),
  );
}
