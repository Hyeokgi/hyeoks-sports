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

export interface MarketOddsRow {
  round_match_id: number;
  p_home: number;
  p_draw: number;
  p_away: number;
  n_bookmakers: number;
  updated_at: string;
}

export async function getMarketOdds(
  env: Env,
  roundMatchIds: number[],
): Promise<Map<number, MarketOddsRow>> {
  if (roundMatchIds.length === 0) return new Map();
  const placeholders = roundMatchIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM market_odds WHERE round_match_id IN (${placeholders})`,
  )
    .bind(...roundMatchIds)
    .all<MarketOddsRow>();
  const map = new Map<number, MarketOddsRow>();
  for (const row of results ?? []) map.set(row.round_match_id, row);
  return map;
}

export interface MarketOddsHistoryRow {
  round_match_id: number;
  p_home: number;
  p_draw: number;
  p_away: number;
  n_bookmakers: number;
  snapshot_at: string;
}

// 라인무브먼트(오프닝->최신 배당 변화) 확인용 - 회차당 여러 스냅샷이 시간순으로 쌓인다.
export async function getMarketOddsHistory(
  env: Env,
  roundMatchIds: number[],
): Promise<Map<number, MarketOddsHistoryRow[]>> {
  if (roundMatchIds.length === 0) return new Map();
  const placeholders = roundMatchIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT round_match_id, p_home, p_draw, p_away, n_bookmakers, snapshot_at FROM market_odds_history
     WHERE round_match_id IN (${placeholders}) ORDER BY snapshot_at ASC`,
  )
    .bind(...roundMatchIds)
    .all<MarketOddsHistoryRow>();
  const map = new Map<number, MarketOddsHistoryRow[]>();
  for (const row of results ?? []) {
    const list = map.get(row.round_match_id) ?? [];
    list.push(row);
    map.set(row.round_match_id, list);
  }
  return map;
}

export interface K2CornersMatchRow {
  date: string;
  home: string;
  away: string;
  home_corners: number;
  away_corners: number;
}

// K리그2 한정 실증 검증된 피처(2026-08-04 백테스트) - 코너킥 기록 있는 경기만, 날짜순.
export async function getK2MatchesWithCorners(env: Env): Promise<K2CornersMatchRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT date, home, away, home_corners, away_corners FROM matches WHERE league = 'K리그2' AND home_corners IS NOT NULL ORDER BY date ASC",
  ).all<K2CornersMatchRow>();
  return results ?? [];
}

export interface RoundResultRow {
  round_match_id: number;
  actual: "H" | "D" | "A";
  hg: number | null;
  ag: number | null;
  settled_at: string;
}

export async function getRoundResults(
  env: Env,
  roundMatchIds: number[],
): Promise<Map<number, RoundResultRow>> {
  if (roundMatchIds.length === 0) return new Map();
  const placeholders = roundMatchIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM round_results WHERE round_match_id IN (${placeholders})`,
  )
    .bind(...roundMatchIds)
    .all<RoundResultRow>();
  const map = new Map<number, RoundResultRow>();
  for (const row of results ?? []) map.set(row.round_match_id, row);
  return map;
}

export interface VoteShareRow {
  round_match_id: number;
  vote_home: number;
  vote_draw: number;
  vote_away: number;
  snapshot_at: string;
}

// 회차 진행 중 여러 스냅샷이 쌓일 수 있어(round_vote_share는 append-only) 매치당 가장 최근 것만 사용.
export async function getLatestVoteShare(
  env: Env,
  roundMatchIds: number[],
): Promise<Map<number, VoteShareRow>> {
  if (roundMatchIds.length === 0) return new Map();
  const placeholders = roundMatchIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT round_match_id, vote_home, vote_draw, vote_away, snapshot_at FROM round_vote_share
     WHERE round_match_id IN (${placeholders})
     AND id IN (SELECT MAX(id) FROM round_vote_share WHERE round_match_id IN (${placeholders}) GROUP BY round_match_id)`,
  )
    .bind(...roundMatchIds, ...roundMatchIds)
    .all<VoteShareRow>();
  const map = new Map<number, VoteShareRow>();
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
