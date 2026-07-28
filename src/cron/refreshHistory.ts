// 3시간마다 실행: FotMob 종료 경기 결과 갱신 + Elo/무승부율 전체 재계산
import { fetchFinishedMatches, LEAGUE_IDS } from "../lib/fotmob";
import { computeEloAndHistory } from "../lib/elo";
import { getAllMatches } from "../lib/db";
import type { Env } from "../types";

export async function refreshHistory(env: Env): Promise<{ inserted: number; leagues: string[] }> {
  let inserted = 0;

  for (const [leagueName, leagueId] of Object.entries(LEAGUE_IDS)) {
    const finished = await fetchFinishedMatches(leagueId);
    for (const m of finished) {
      const result = await env.DB.prepare(
        "INSERT OR IGNORE INTO matches (league, date, home, away, hg, ag) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(leagueName, m.date, m.home, m.away, m.hg, m.ag)
        .run();
      if (result.meta.changes > 0) inserted++;
    }
  }

  if (inserted > 0) {
    await recomputeEloAndDrawRates(env);
  }

  return { inserted, leagues: Object.keys(LEAGUE_IDS) };
}

// 매치 수(~수천 건) 대비 재계산 비용이 낮아, 증분 델타 추적 대신 매번 전체 재계산한다
// (파이썬 원본과 동일 로직을 유지해 드리프트를 없애기 위한 선택).
export async function recomputeEloAndDrawRates(env: Env): Promise<void> {
  const matches = await getAllMatches(env);
  if (matches.length === 0) return;

  const { elo } = computeEloAndHistory(matches);

  const lastMatchDate = new Map<string, string>();
  for (const m of matches) {
    lastMatchDate.set(`${m.league}|${m.home}`, m.date);
    lastMatchDate.set(`${m.league}|${m.away}`, m.date);
  }

  const stmts = [];
  for (const [k, state] of elo) {
    const sep = k.indexOf("|");
    const league = k.slice(0, sep);
    const team = k.slice(sep + 1);
    stmts.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO team_elo (league, team_en, elo, last_season, last_match_date) VALUES (?, ?, ?, ?, ?)",
      ).bind(league, team, state.elo, state.lastSeason, lastMatchDate.get(k) ?? null),
    );
  }

  for (const league of Object.keys(LEAGUE_IDS)) {
    const d = matches.filter((m) => m.league === league);
    if (d.length === 0) continue;
    const draws = d.filter((m) => m.hg === m.ag).length;
    stmts.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO league_draw_rates (league, draw_rate, sample_size, updated_at) VALUES (?, ?, ?, ?)",
      ).bind(league, draws / d.length, d.length, new Date().toISOString()),
    );
  }

  if (stmts.length > 0) await env.DB.batch(stmts);
}
