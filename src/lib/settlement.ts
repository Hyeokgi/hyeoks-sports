// upcoming 라운드의 round_matches를 matches 테이블의 실제 결과와 대조해 정산(round_results 채움)
import { NAME_MAP } from "./nameMap";
import type { Env } from "../types";

export async function settleRounds(env: Env): Promise<{ settled: number; matchesUpdated: number }> {
  const { results: upcomingRounds } = await env.DB.prepare(
    "SELECT id FROM rounds WHERE status = 'upcoming'",
  ).all<{ id: number }>();
  if (!upcomingRounds || upcomingRounds.length === 0) return { settled: 0, matchesUpdated: 0 };

  let matchesUpdated = 0;
  let roundsSettled = 0;

  for (const round of upcomingRounds) {
    const { results: roundMatches } = await env.DB.prepare(
      "SELECT rm.id, rm.league, rm.home_kr, rm.away_kr, rm.kickoff_at FROM round_matches rm WHERE rm.round_id = ?",
    )
      .bind(round.id)
      .all<{ id: number; league: string; home_kr: string; away_kr: string; kickoff_at: string | null }>();
    if (!roundMatches || roundMatches.length === 0) continue;

    const { results: alreadySettled } = await env.DB.prepare(
      `SELECT round_match_id FROM round_results WHERE round_match_id IN (${roundMatches.map(() => "?").join(",")})`,
    )
      .bind(...roundMatches.map((m) => m.id))
      .all<{ round_match_id: number }>();
    const settledIds = new Set((alreadySettled ?? []).map((r) => r.round_match_id));

    for (const rm of roundMatches) {
      if (settledIds.has(rm.id)) continue;
      const homeEn = NAME_MAP[rm.home_kr];
      const awayEn = NAME_MAP[rm.away_kr];
      if (!homeEn || !awayEn) continue;

      // kickoff_at은 정확한 UTC 시각, matches.date는 날짜 단위라 하루 오차를 허용해 대조한다.
      const kickoffDate = rm.kickoff_at ? rm.kickoff_at.slice(0, 10) : null;
      const match = await env.DB.prepare(
        `SELECT hg, ag, date FROM matches WHERE league = ? AND home = ? AND away = ?
         ${kickoffDate ? "AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')" : ""}
         ORDER BY date DESC LIMIT 1`,
      )
        .bind(...(kickoffDate ? [rm.league, homeEn, awayEn, kickoffDate, kickoffDate] : [rm.league, homeEn, awayEn]))
        .first<{ hg: number; ag: number; date: string }>();
      if (!match) continue;

      const actual = match.hg > match.ag ? "H" : match.hg === match.ag ? "D" : "A";
      await env.DB.prepare(
        "INSERT OR REPLACE INTO round_results (round_match_id, actual, hg, ag, settled_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(rm.id, actual, match.hg, match.ag, new Date().toISOString())
        .run();
      settledIds.add(rm.id);
      matchesUpdated++;
    }

    if (settledIds.size === roundMatches.length) {
      await env.DB.prepare("UPDATE rounds SET status = 'settled' WHERE id = ?").bind(round.id).run();
      roundsSettled++;
    }
  }

  return { settled: roundsSettled, matchesUpdated };
}
