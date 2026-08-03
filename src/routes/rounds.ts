// GET /api/rounds, GET /api/rounds/:id
import { getRound, listRounds } from "../lib/db";
import { json } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import type { Env } from "../types";

export async function handleListRounds(env: Env): Promise<Response> {
  const rounds = await listRounds(env);
  return json({ rounds });
}

export async function handleGetRound(env: Env, roundId: number): Promise<Response> {
  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const predictions = await buildRoundPredictions(env, roundId);
  return json({
    round,
    matches: predictions.map((p) => ({
      seq: p.match.seq,
      league: p.match.league,
      home: p.match.home_kr,
      away: p.match.away_kr,
      kickoff_at: p.match.kickoff_at,
      raw: p.raw,
      prediction: p.prediction,
      calibration: p.calibration,
    })),
  });
}
