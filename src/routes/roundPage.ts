// GET /round/:no           - 검색 노출용 회차 분석 페이지(HTML)
// GET /round/:no/draft     - 블로그 초안(검색 제외, 복사 버튼)
// GET /sitemap.xml, /robots.txt
import { getRoundResults, getLatestVoteShare } from "../lib/db";
import { buildRoundPredictions } from "../lib/predictRound";
import { reportCacheKey } from "../lib/reportCache";
import {
  buildRoundArticle,
  renderRoundPage,
  renderDraftPage,
  type ArticleMatch,
  type RecentRecord,
  type RoundArticle,
} from "../lib/roundArticle";
import { getPredictionSnapshots } from "../lib/predictionSnapshot";
import type { Env, RoundRow } from "../types";

const RESULT_LABEL = { H: "홈승", D: "무승부", A: "원정승" } as const;
// 페이지는 배당이 2시간마다 바뀌는 정도라 10분 캐시면 충분하다(D1 조회를 매 요청마다 하지 않게).
const PAGE_CACHE_SECONDS = 600;
const RECENT_ROUNDS = 5;

async function findRoundByNo(env: Env, roundNo: number): Promise<RoundRow | null> {
  return env.DB.prepare(
    "SELECT * FROM rounds WHERE round_no = ? AND round_no_confirmed = 1 ORDER BY id DESC LIMIT 1",
  )
    .bind(roundNo)
    .first<RoundRow>();
}

async function loadMatches(env: Env, roundId: number): Promise<ArticleMatch[]> {
  const preds = await buildRoundPredictions(env, roundId);
  const ids = preds.map((p) => p.match.id);
  const [results, votes, snaps] = await Promise.all([
    getRoundResults(env, ids),
    getLatestVoteShare(env, ids),
    getPredictionSnapshots(env, ids),
  ]);
  return preds.map((p) => {
    const r = results.get(p.match.id);
    const v = votes.get(p.match.id);
    // 끝난 경기는 킥오프 전에 공개했던 예측(스냅샷)으로 보여주고 채점한다.
    const snap = r ? snaps.get(p.match.id) : undefined;
    const pred = snap?.prediction ?? p.prediction;
    return {
      seq: p.match.seq,
      league: p.match.league,
      home: p.match.home_kr,
      away: p.match.away_kr,
      kickoffAt: p.match.kickoff_at,
      pHome: pred.pHome,
      pDraw: pred.pDraw,
      pAway: pred.pAway,
      pick: pred.rankedPicks[0],
      confidenceGap: pred.confidenceGap,
      basis: pred.basis,
      tier: (snap?.tier as string | undefined) ?? p.calibration.tier,
      nBookmakers: p.raw.market?.nBookmakers ?? null,
      vote: v ? { home: v.vote_home, draw: v.vote_draw, away: v.vote_away } : null,
      result: r ? { actual: r.actual, hg: r.hg, ag: r.ag } : null,
      predictedAfterKickoff: p.predictedAfterKickoff,
    };
  });
}

/** 이 회차 이전의 정산 회차 성적. 사후 등록 경기는 예측이 아니므로 뺀다. */
async function loadRecent(env: Env, beforeId: number): Promise<RecentRecord[]> {
  const { results: rounds } = await env.DB.prepare(
    `SELECT id, round_no FROM rounds WHERE id < ? AND round_no IS NOT NULL
      AND EXISTS (SELECT 1 FROM round_results rr JOIN round_matches rm ON rm.id = rr.round_match_id WHERE rm.round_id = rounds.id)
      ORDER BY id DESC LIMIT ?`,
  )
    .bind(beforeId, RECENT_ROUNDS + 3) // 사후 등록뿐인 회차(n=0)는 걸러지므로 여유 있게
    .all<{ id: number; round_no: number }>();
  // 회차별 조회를 동시에 보낸다. 순서대로 보내면 첫 로딩이 5초쯤 걸렸다(실측).
  const loaded = await Promise.all((rounds ?? []).map(async (r) => ({ r, ms: await loadMatches(env, r.id) })));
  const out: RecentRecord[] = [];
  for (const { r, ms } of loaded) {
    const scored = ms.filter((m) => m.result && !m.predictedAfterKickoff);
    if (scored.length === 0) continue;
    out.push({
      roundNo: r.round_no,
      n: scored.length,
      hits: scored.filter((m) => m.pick === RESULT_LABEL[m.result!.actual]).length,
    });
    if (out.length >= RECENT_ROUNDS) break;
  }
  return out;
}

export async function loadRoundArticle(env: Env, roundNo: number, origin: string): Promise<RoundArticle | null> {
  const round = await findRoundByNo(env, roundNo);
  if (!round) return null;
  const [matches, report, recent, asOf] = await Promise.all([
    loadMatches(env, round.id),
    env.KV.get(reportCacheKey(round.id)),
    loadRecent(env, round.id),
    oddsAsOf(env, round.id),
  ]);
  if (matches.length === 0) return null;
  return buildRoundArticle({ roundNo, matches, report, recent, origin, appRoundId: round.id, asOf });
}

// 데이터 기준 시각 = 이 회차 배당이 마지막으로 갱신된 시각. 배당이 없으면 null.
async function oddsAsOf(env: Env, roundId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT MAX(mo.updated_at) AS t FROM market_odds mo JOIN round_matches rm ON rm.id = mo.round_match_id WHERE rm.round_id = ?`,
  )
    .bind(roundId)
    .first<{ t: string | null }>();
  return row?.t ?? null;
}

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } });
}

function notFound(): Response {
  return html(`<!doctype html><meta charset="utf-8"><title>회차를 찾을 수 없습니다</title><p>회차를 찾을 수 없습니다. <a href="/">홈으로</a></p>`, 404);
}

export async function handleRoundPage(env: Env, request: Request, roundNo: number, draft: boolean): Promise<Response> {
  const origin = new URL(request.url).origin;
  // 초안은 항상 최신(리포트가 방금 갱신됐을 수 있음). 공개 페이지만 엣지 캐시한다.
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const cacheKey = new Request(`${origin}/round/${roundNo}`, { method: "GET" });
  if (!draft && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const article = await loadRoundArticle(env, roundNo, origin);
  if (!article) return notFound();
  if (draft) return html(renderDraftPage(article), 200, { "cache-control": "no-store", "x-robots-tag": "noindex" });

  const res = html(renderRoundPage(article), 200, { "cache-control": `public, max-age=${PAGE_CACHE_SECONDS}` });
  if (cache) await cache.put(cacheKey, res.clone());
  return res;
}

/**
 * GET /round/:no/data.json - 회차 글의 원자료(JSON). 블로그 이미지·도표를 만드는 쪽(Codex 등)이
 * 페이지와 같은 데이터·같은 기준 시각(asOf)을 쓰도록 하는 공식 인터페이스다.
 * 형식을 바꾸면 docs/COLLAB.md의 스키마도 같이 고친다.
 */
export async function handleRoundData(env: Env, request: Request, roundNo: number): Promise<Response> {
  const origin = new URL(request.url).origin;
  const article = await loadRoundArticle(env, roundNo, origin);
  if (!article) {
    return new Response(JSON.stringify({ error: "round_not_found" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return new Response(JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), ...article }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

export async function handleSitemap(env: Env, request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const { results } = await env.DB.prepare(
    "SELECT round_no, created_at FROM rounds WHERE round_no IS NOT NULL AND round_no_confirmed = 1 ORDER BY id DESC LIMIT 200",
  ).all<{ round_no: number; created_at: string }>();
  const urls = [`<url><loc>${origin}/</loc></url>`].concat(
    (results ?? []).map((r) => `<url><loc>${origin}/round/${r.round_no}</loc><lastmod>${r.created_at.slice(0, 10)}</lastmod></url>`),
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
    { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } },
  );
}

export function handleRobots(request: Request): Response {
  const origin = new URL(request.url).origin;
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /round/*/draft\nSitemap: ${origin}/sitemap.xml\n`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
