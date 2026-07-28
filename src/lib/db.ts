// D1 조회/저장 헬퍼
import type { Env, RoundMatchRow, RoundPredictionRow, RoundRow } from "../types";
import type { MatchRow } from "./elo";

export async function listRounds(env: Env): Promise<RoundRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM rounds ORDER BY id DESC LIMIT 20",
  ).all<RoundRow>();
  return results ?? [];
}

export async function getRound(env: Env, roundId: number): Promise<RoundRow | null> {
  return env.DB.prepare("SELECT * FROM rounds WHERE id = ?").bind(roundId).first<RoundRow>();
}

export async function getRoundMatches(env: Env, roundId: number): Promise<RoundMatchRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM round_matches WHERE round_id = ? ORDER BY seq ASC",
  )
    .bind(roundId)
    .all<RoundMatchRow>();
  return results ?? [];
}

export async function getRoundPredictions(
  env: Env,
  roundMatchIds: number[],
): Promise<Map<number, RoundPredictionRow>> {
  if (roundMatchIds.length === 0) return new Map();
  const placeholders = roundMatchIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM round_predictions WHERE round_match_id IN (${placeholders})`,
  )
    .bind(...roundMatchIds)
    .all<RoundPredictionRow>();
  const map = new Map<number, RoundPredictionRow>();
  for (const row of results ?? []) map.set(row.round_match_id, row);
  return map;
}

export async function getAllMatches(env: Env): Promise<MatchRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT league, date, home, away, hg, ag FROM matches ORDER BY league ASC, date ASC",
  ).all<MatchRow>();
  return results ?? [];
}

export async function getLeagueDrawRate(env: Env, league: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT draw_rate FROM league_draw_rates WHERE league = ?",
  )
    .bind(league)
    .first<{ draw_rate: number }>();
  return row?.draw_rate ?? 0.271;
}

export async function getNameMapEntry(
  env: Env,
  nameKr: string,
): Promise<{ name_en: string; league: string } | null> {
  return env.DB.prepare("SELECT name_en, league FROM team_name_map WHERE name_kr = ?")
    .bind(nameKr)
    .first<{ name_en: string; league: string }>();
}
