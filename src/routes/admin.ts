// 관리자 라우트: 회차번호 수동 보정, 수동 동기화/알림 트리거, AI 리포트 저장
import { json, requireAdmin, safeJson } from "../lib/http";
import { refreshHistory } from "../cron/refreshHistory";
import { detectNewRound } from "../cron/detectNewRound";
import { sendTelegramMessage } from "../lib/telegram";
import { getRound, getRoundMatches } from "../lib/db";
import { reportCacheKey, REPORT_CACHE_TTL_SECONDS } from "../lib/reportCache";
import type { Env } from "../types";

export async function handleSync(env: Env, request: Request): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const result = await refreshHistory(env);
  return json({ ok: true, ...result });
}

export async function handleDetectRound(env: Env, request: Request): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const result = await detectNewRound(env);
  return json({ ok: true, ...result });
}

export async function handleNotifyTest(env: Env, request: Request): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const sent = await sendTelegramMessage(env, "⚽ 텔레그램 알림 테스트입니다.");
  return json({ ok: true, sent });
}

// GitHub Actions(scripts/generate_report.mjs)가 Gemini로 생성한 리포트를 KV에 저장한다.
export async function handleWriteReport(env: Env, roundId: number, request: Request): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const body = await safeJson(request);
  const report = body?.report;
  if (typeof report !== "string" || report.trim().length === 0) {
    return json({ error: "report(string)가 필요합니다" }, 400);
  }

  await env.KV.put(reportCacheKey(roundId), report.trim(), { expirationTtl: REPORT_CACHE_TTL_SECONDS });
  return json({ ok: true, round_id: roundId });
}

// GitHub Actions(scripts/fetch_market_odds.mjs)가 wisetoto에서 수집한 해외 배당 암시확률을
// seq(경기 순번) 기준으로 매칭해 저장한다.
export async function handleWriteMarketOdds(env: Env, roundId: number, request: Request): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const body = await safeJson(request);
  const odds = body?.odds;
  if (!Array.isArray(odds)) {
    return json({ error: "odds(array)가 필요합니다" }, 400);
  }

  const matches = await getRoundMatches(env, roundId);
  const bySeq = new Map(matches.map((m) => [m.seq, m.id]));

  const now = new Date().toISOString();
  let written = 0;
  const stmts = [];
  for (const o of odds) {
    const roundMatchId = bySeq.get(o.seq);
    if (!roundMatchId) continue;
    if (
      typeof o.pHome !== "number" ||
      typeof o.pDraw !== "number" ||
      typeof o.pAway !== "number" ||
      typeof o.nBookmakers !== "number"
    ) {
      continue;
    }
    stmts.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO market_odds (round_match_id, p_home, p_draw, p_away, n_bookmakers, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(roundMatchId, o.pHome, o.pDraw, o.pAway, o.nBookmakers, now),
    );
    written++;
  }
  if (stmts.length > 0) await env.DB.batch(stmts);

  return json({ ok: true, round_id: roundId, written });
}

// GitHub Actions(scripts/fetch_vote_share.mjs)가 betman에서 수집한 회차 투표(득표)율을
// seq(경기 순번) 기준으로 매칭해 저장한다.
export async function handleWriteVoteShare(env: Env, roundId: number, request: Request): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const body = await safeJson(request);
  const votes = body?.votes;
  if (!Array.isArray(votes)) {
    return json({ error: "votes(array)가 필요합니다" }, 400);
  }

  const matches = await getRoundMatches(env, roundId);
  const bySeq = new Map(matches.map((m) => [m.seq, m.id]));

  const now = new Date().toISOString();
  let written = 0;
  const stmts = [];
  for (const v of votes) {
    const roundMatchId = bySeq.get(v.seq);
    if (!roundMatchId) continue;
    if (typeof v.voteHome !== "number" || typeof v.voteDraw !== "number" || typeof v.voteAway !== "number") {
      continue;
    }
    stmts.push(
      env.DB.prepare(
        "INSERT INTO round_vote_share (round_match_id, vote_home, vote_draw, vote_away, snapshot_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(roundMatchId, v.voteHome, v.voteDraw, v.voteAway, now),
    );
    written++;
  }
  if (stmts.length > 0) await env.DB.batch(stmts);

  return json({ ok: true, round_id: roundId, written });
}

export async function handleCorrectRoundNo(env: Env, roundId: number, request: Request): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const body = await safeJson(request);
  const roundNo = body?.round_no;
  if (typeof roundNo !== "number") {
    return json({ error: "round_no(number)가 필요합니다" }, 400);
  }

  await env.DB.prepare("UPDATE rounds SET round_no = ?, round_no_confirmed = 1 WHERE id = ?")
    .bind(roundNo, roundId)
    .run();

  return json({ ok: true, round_id: roundId, round_no: roundNo });
}
