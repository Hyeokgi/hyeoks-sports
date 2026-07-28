// GET /api/rounds/:id/report - Gemini 리포트 (KV 6시간 캐시)
import { getRound } from "../lib/db";
import { json } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import { generateReport } from "../lib/gemini";
import type { Env } from "../types";

const CACHE_TTL_SECONDS = 60 * 60 * 6;

export async function handleReport(env: Env, roundId: number): Promise<Response> {
  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const cacheKey = `report:${roundId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return json({ round_id: roundId, report: cached, cached: true });

  const predictions = await buildRoundPredictions(env, roundId);
  const roundLabel = round.round_no_confirmed ? `${round.round_no}회차` : `${round.round_no ?? "추정"}회차(미확정)`;
  const report = await generateReport(env, roundLabel, predictions);

  if (!report) {
    return json({
      round_id: roundId,
      error: "GEMINI_API_KEY가 설정되지 않았거나 리포트 생성에 실패했습니다",
    });
  }

  await env.KV.put(cacheKey, report, { expirationTtl: CACHE_TTL_SECONDS });
  return json({ round_id: roundId, report, cached: false });
}
