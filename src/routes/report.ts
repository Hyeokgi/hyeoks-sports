// GET /api/rounds/:id/report - AI 리포트 조회 (KV 캐시만 서빙)
// Cloudflare Workers의 아웃바운드 IP를 Google이 차단해 Worker에서 직접 Gemini를 호출하면
// "User location is not supported"로 항상 실패한다. 실제 생성은 GitHub Actions에서 하고
// (scripts/generate_report.mjs) POST /api/admin/rounds/:id/report로 KV에 채워 넣는다.
import { getRound } from "../lib/db";
import { json } from "../lib/http";
import { reportCacheKey } from "../lib/reportCache";
import type { Env } from "../types";

export async function handleReport(env: Env, roundId: number): Promise<Response> {
  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const cached = await env.KV.get(reportCacheKey(roundId));
  if (cached) return json({ round_id: roundId, report: cached, cached: true });

  return json({
    round_id: roundId,
    error: "아직 이번 회차 리포트가 생성되지 않았습니다. 잠시 후 다시 시도해주세요",
  });
}
