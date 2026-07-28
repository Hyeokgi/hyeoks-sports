// 관리자 라우트: 회차번호 수동 보정, 수동 동기화/알림 트리거, AI 리포트 저장
import { json, requireAdmin, safeJson } from "../lib/http";
import { refreshHistory } from "../cron/refreshHistory";
import { detectNewRound } from "../cron/detectNewRound";
import { sendTelegramMessage } from "../lib/telegram";
import { getRound } from "../lib/db";
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
