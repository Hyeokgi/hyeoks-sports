// POST /api/rounds/:id/predict - 변수 토글을 반영해 확률을 재계산
import { getRound } from "../lib/db";
import { json, safeJson } from "../lib/http";
import { DEFAULT_TOGGLES } from "../lib/prediction";
import { buildRoundPredictions } from "../lib/predictRound";
import type { Env } from "../types";

export async function handlePredict(env: Env, roundId: number, request: Request): Promise<Response> {
  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const body = await safeJson(request);
  const toggles = body?.toggles ?? {};

  const predictions = await buildRoundPredictions(env, roundId, toggles);
  return json({
    round_id: roundId,
    toggles: { ...DEFAULT_TOGGLES, ...toggles },
    matches: predictions.map((p) => ({
      seq: p.match.seq,
      league: p.match.league,
      home: p.match.home_kr,
      away: p.match.away_kr,
      raw: p.raw,
      prediction: p.prediction,
    })),
  });
}
