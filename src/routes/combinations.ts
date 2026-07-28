// POST /api/rounds/:id/combinations - 예산별(또는 단일 예산) 구매 조합 생성
import { getRound } from "../lib/db";
import { json, safeJson } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import {
  generateSystemBet,
  generateSystemBetTiers,
  DEFAULT_BUDGET_TIERS,
  type ComboMatch,
} from "../lib/combinations";
import type { Env } from "../types";

export async function handleCombinations(env: Env, roundId: number, request: Request): Promise<Response> {
  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const body = await safeJson(request);
  const toggles = body?.toggles ?? {};
  const budgetWon: number | undefined = body?.budgetWon;
  const tiers: number[] | undefined = body?.tiers;
  const guaranteeDrawCount: number = body?.guaranteeDrawCount ?? 0;

  const predictions = await buildRoundPredictions(env, roundId, toggles);
  const comboMatches: ComboMatch[] = predictions.map((p) => ({
    seq: p.match.seq,
    league: p.match.league,
    home: p.match.home_kr,
    away: p.match.away_kr,
    prediction: p.prediction,
  }));

  if (typeof budgetWon === "number") {
    const plan = generateSystemBet(comboMatches, budgetWon, undefined, { guaranteeDrawCount });
    return json({ round_id: roundId, plan });
  }

  const plans = generateSystemBetTiers(comboMatches, tiers ?? DEFAULT_BUDGET_TIERS, undefined, {
    guaranteeDrawCount,
  });
  return json({ round_id: roundId, plans });
}
