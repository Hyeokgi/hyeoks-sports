// GET /round/:no           - 검색 노출용 회차 분석 페이지(HTML)
// GET /round/:no/draft     - 블로그 초안(검색 제외, 복사 버튼)
// GET /sitemap.xml, /robots.txt
import { getRoundResults, getLatestVoteShare, getMarketOddsHistory } from "../lib/db";
import { nationalProbs, NATIONAL_HOME_ADV } from "../lib/nationalElo";
import type { MatchDetail } from "../lib/matchAnalysis";
import { nationalDisplayName } from "../lib/nationalNames";
import { buildRoundPredictions } from "../lib/predictRound";
import { reportCacheKey } from "../lib/reportCache";
import {
  buildRoundArticle,
  renderRoundPage,
  renderDraftPage,
  isScoredRecord,
  type ArticleMatch,
  type RecentRecord,
  type RoundArticle,
} from "../lib/roundArticle";
import { classifyRecord, getPredictionSnapshots, hasValidProbabilities } from "../lib/predictionSnapshot";
import { sitemapEntries } from "../lib/matchPage";
import { isCalibrationUnderReview } from "../lib/clientPrediction";
import { PUBLIC_ORIGIN } from "../lib/publicSite";
import type { Env, RoundRow } from "../types";

const RESULT_LABEL = { H: "홈승", D: "무승부", A: "원정승" } as const;

// 선택 구간(리포트·최근 성적·기준 시각)은 실패해도 글 전체를 깨지 않고 그 구간만 비운다.
// 예전에는 Promise.all 하나라 KV 일시 오류나 옛 회차 하나의 예측 원본 누락만으로 페이지·초안·data.json이
// 통째로 500이 됐다. 현재 회차 경기(loadMatches)는 필수라 실패하면 그대로 오류를 올린다.
async function optional<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`roundArticle: ${label} 생략 - ${(e as Error)?.message ?? String(e)}`);
    return fallback;
  }
}
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

// withDetail: 경기별 근거 원자료까지 읽는다(이 회차 글용). 지난 회차 성적 집계에는 필요 없어 끈다.
async function loadMatches(env: Env, roundId: number, withDetail = false): Promise<ArticleMatch[]> {
  const preds = await buildRoundPredictions(env, roundId);
  const ids = preds.map((p) => p.match.id);
  const [results, votes, snaps, history, modelOnly] = await Promise.all([
    getRoundResults(env, ids),
    getLatestVoteShare(env, ids),
    getPredictionSnapshots(env, ids),
    withDetail ? getMarketOddsHistory(env, ids) : Promise.resolve(null),
    // 배당을 섞기 전 모델 확률 - "모델과 시장이 같은 판단인가"를 보여주기 위해
    withDetail ? buildRoundPredictions(env, roundId, { useMarketOdds: false }) : Promise.resolve(null),
  ]);
  const modelOnlyById = new Map((modelOnly ?? []).map((q) => [q.match.id, q.prediction]));
  return preds.map((p) => {
    const r = results.get(p.match.id);
    const v = votes.get(p.match.id);
    // 끝난 경기는 킥오프 전에 저장된 예측(스냅샷)으로 보여주고, 그것이 검증됐을 때만 채점한다.
    // 스냅샷이 없거나 검증되지 않으면 recordProvenance로 그 사실을 붙여 표시만 한다(채점 제외).
    const snap = r ? snaps.get(p.match.id) : undefined;
    const recordProvenance = r ? classifyRecord(snap, p.match.kickoff_at, p.prediction, p.predictedAfterKickoff) : undefined;
    // 확률이 깨진 스냅샷(NaN 등)은 표에도 쓰지 않는다. 그때는 재계산값을 보여주되 출처는 unverified로 남는다.
    const useSnap = snap != null && hasValidProbabilities(snap.prediction);
    const pred = useSnap ? snap.prediction : p.prediction;
    return {
      seq: p.match.seq,
      league: p.match.league,
      // 국가대표는 wisetoto의 4글자 절단을 글에서 되돌린다(클럽명은 원문 그대로).
      home: nationalDisplayName(p.match.home_kr),
      away: nationalDisplayName(p.match.away_kr),
      kickoffAt: p.match.kickoff_at,
      pHome: pred.pHome,
      pDraw: pred.pDraw,
      pAway: pred.pAway,
      pick: pred.rankedPicks[0],
      confidenceGap: pred.confidenceGap,
      basis: pred.basis,
      tier: (useSnap ? (snap.tier as string | null) : null) ?? p.calibration.tier,
      nBookmakers: useSnap ? (snap.nBookmakers ?? null) : (p.raw.market?.nBookmakers ?? null),
      vote: v ? { home: v.vote_home, draw: v.vote_draw, away: v.vote_away } : null,
      result: r ? { actual: r.actual, hg: r.hg, ag: r.ag } : null,
      predictedAfterKickoff: p.predictedAfterKickoff,
      ...(recordProvenance ? { recordProvenance, capturedAt: useSnap ? snap.capturedAt : null } : {}),
      detail: withDetail && !r ? buildDetail(p, history?.get(p.match.id) ?? [], modelOnlyById.get(p.match.id) ?? null) : null,
    };
  });
}

function buildDetail(
  p: Awaited<ReturnType<typeof buildRoundPredictions>>[number],
  hist: { p_home: number; p_draw: number; p_away: number }[],
  modelOnly: { pHome: number; pDraw: number; pAway: number; basis: string } | null,
): MatchDetail {
  const isModel = p.prediction.basis === "model";
  const nat = p.raw.nationalEloDiff;
  const open = hist.length >= 2 ? hist[0] : null; // 스냅샷이 하나뿐이면 흐름을 말할 수 없다
  const b = p.calibration.bucket;
  return {
    eloDiff: isModel ? p.raw.eloDiff : null,
    formDiff: isModel ? p.raw.formDiff : null,
    h2hDiff: isModel ? p.raw.h2hDiff : null,
    nH2h: isModel ? p.raw.nH2h : 0,
    natEloDiff: nat,
    natProbs: nat != null ? nationalProbs(nat + NATIONAL_HOME_ADV) : null,
    market: p.raw.market
      ? { pHome: p.raw.market.pHome, pDraw: p.raw.market.pDraw, pAway: p.raw.market.pAway, n: p.raw.market.nBookmakers }
      : null,
    marketOpen: open ? { pHome: open.p_home, pDraw: open.p_draw, pAway: open.p_away } : null,
    modelOnly: isModel && modelOnly && modelOnly.basis === "model" ? { pHome: modelOnly.pHome, pDraw: modelOnly.pDraw, pAway: modelOnly.pAway } : null,
    // 유럽 4개 리그 보정표는 검증 스크립트 결함(미래 무승부율 혼입·폼 단위) 때문에 재검증 전까지 적중률 근거로 쓰지 않는다.
    calib: isModel && b && !isCalibrationUnderReview(p.match.league) ? { accuracy: b.accuracy, n: b.n, minGap: b.minGap, maxGap: b.maxGap } : null,
  };
}

/**
 * 이 회차 이전의 정산 회차 성적. 검증된 킥오프 전 저장 기록(isScoredRecord)만 채점한다.
 * 재구성·미검증·근거 없음·사후 등록 경기는 excluded로만 센다. 한 회차를 못 읽으면 그 회차만 건너뛴다.
 */
async function loadRecent(env: Env, beforeId: number): Promise<RecentRecord[]> {
  const { results: rounds } = await env.DB.prepare(
    `SELECT id, round_no FROM rounds WHERE id < ? AND round_no IS NOT NULL
      AND EXISTS (SELECT 1 FROM round_results rr JOIN round_matches rm ON rm.id = rr.round_match_id WHERE rm.round_id = rounds.id)
      ORDER BY id DESC LIMIT ?`,
  )
    // 검증된 기록이 없는 회차(n=0: 스냅샷 이전·사후 등록뿐)는 걸러지므로 여유 있게 읽는다.
    // 그래도 5회차가 안 차면 덜 보여준다(재구성 회차로 채우지 않는다).
    .bind(beforeId, RECENT_ROUNDS + 3)
    .all<{ id: number; round_no: number }>();
  // 회차별 조회를 동시에 보낸다. 순서대로 보내면 첫 로딩이 5초쯤 걸렸다(실측).
  const loaded = await Promise.all(
    (rounds ?? []).map(async (r) => ({ r, ms: await optional<ArticleMatch[] | null>(`recent ${r.round_no}회차`, () => loadMatches(env, r.id), null) })),
  );
  const out: RecentRecord[] = [];
  for (const { r, ms } of loaded) {
    if (!ms) continue;
    const finished = ms.filter((m) => m.result);
    const scored = finished.filter(isScoredRecord);
    if (scored.length === 0) continue;
    const excluded = finished.length - scored.length;
    out.push({
      roundNo: r.round_no,
      n: scored.length,
      hits: scored.filter((m) => m.pick === RESULT_LABEL[m.result!.actual]).length,
      ...(excluded > 0 ? { excluded } : {}),
    });
    if (out.length >= RECENT_ROUNDS) break;
  }
  return out;
}

export async function loadRoundArticle(env: Env, roundNo: number, origin: string): Promise<RoundArticle | null> {
  const round = await findRoundByNo(env, roundNo);
  if (!round) return null;
  const [matches, report, recent, asOf] = await Promise.all([
    loadMatches(env, round.id, true), // 필수: 실패하면 오류를 그대로 올린다
    optional<string | null>("report", () => env.KV.get(reportCacheKey(round.id)), null),
    optional<RecentRecord[]>("recent", () => loadRecent(env, round.id), []),
    optional<string | null>("asOf", () => oddsAsOf(env, round.id), null),
  ]);
  if (matches.length === 0) return null;
  return buildRoundArticle({
    roundNo,
    matches,
    report,
    recent,
    origin,
    appRoundId: round.id,
    asOf,
    saleEndAt: round.sale_end_at ?? null,
  });
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

// 가이드 페이지(public/guide/*.html 정적 파일). 새 가이드를 올리면 여기에도 추가해야 사이트맵에 나간다.
export const GUIDE_PATHS = [
  "/guide/",
  "/guide/elo-rating",
  "/guide/k-league-promotion",
  "/guide/proto-check",
  "/guide/toto-refund",
  "/guide/toto-tax",
  "/guide/probability-reading",
];
// 운영·신뢰 정보 페이지. 도구(/app)는 검색 대상이 아니라 제외한다.
export const SITE_PATHS = ["/", "/matches", "/ratings", "/performance", "/methodology", "/sources", "/editorial", "/about", "/contact", "/privacy"];

/**
 * 사이트맵에는 사람이 읽을 가치가 큰 페이지만 넣는다(2026-10-12).
 * - 경기 상세(/match/*)와 회차 페이지(/round/*)는 noindex라 넣지 않는다. 페이지는 그대로 열린다.
 * - 리그 페이지는 내용 준비 여부(sitemapEntries의 판정)를 따른다.
 * - 같은 주소가 두 번 나가지 않게 중복을 없앤다(예전에 /matches가 두 번 들어갔다).
 */
export async function handleSitemap(env: Env, request: Request): Promise<Response> {
  void request;
  const origin = PUBLIC_ORIGIN;
  const seen = new Set<string>();
  const urls: string[] = [];
  const add = (entry: string) => {
    const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc || seen.has(loc)) return;
    const p = new URL(loc).pathname;
    if (p.startsWith("/match/") || p.startsWith("/round/")) return;
    seen.add(loc);
    urls.push(entry);
  };
  for (const p of [...SITE_PATHS, ...GUIDE_PATHS]) add(`<url><loc>${origin}${p}</loc></url>`);
  // 리그 페이지. 표가 없거나 조회가 실패해도 고정 페이지 사이트맵은 내보낸다.
  try {
    for (const entry of await sitemapEntries(env, origin)) add(entry);
  } catch (e) {
    console.error(`sitemap: 리그 페이지 항목 생략 - ${(e as Error).message}`);
  }
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
    { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } },
  );
}

export function handleRobots(request: Request): Response {
  void request;
  const origin = PUBLIC_ORIGIN;
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /round/*/draft\nSitemap: ${origin}/sitemap.xml\n`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
