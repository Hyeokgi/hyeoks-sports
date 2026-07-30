// 3시간마다 실행: FotMob 종료 경기 결과 갱신 + Elo/무승부율 전체 재계산 + 진행중 회차 xG 갱신
import { fetchFinishedMatches, fetchTeamXG, LEAGUE_IDS, type TeamXG } from "../lib/fotmob";
import { computeEloAndHistory } from "../lib/elo";
import { getAllMatches } from "../lib/db";
import { NAME_MAP } from "../lib/nameMap";
import type { Env, League } from "../types";

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

  await refreshXgForActiveRounds(env);

  return { inserted, leagues: Object.keys(LEAGUE_IDS) };
}

// round_predictions.xg_diff는 회차 생성 시점에 한 번만 계산되므로, 시즌이 진행되며 팀 xG가
// 바뀌는 걸 반영하려면 진행중(upcoming) 회차에 대해 주기적으로 다시 계산해 넣어줘야 한다.
export async function refreshXgForActiveRounds(env: Env): Promise<void> {
  const rounds = await env.DB.prepare("SELECT id FROM rounds WHERE status = 'upcoming'").all<{ id: number }>();
  const roundIds = (rounds.results ?? []).map((r) => r.id);
  if (roundIds.length === 0) return;

  const xgByLeague: Record<string, Map<string, TeamXG>> = {
    "K리그1": await fetchTeamXG(LEAGUE_IDS["K리그1"]),
    "K리그2": await fetchTeamXG(LEAGUE_IDS["K리그2"]),
  };
  if (xgByLeague["K리그1"].size === 0 && xgByLeague["K리그2"].size === 0) return;

  const placeholders = roundIds.map(() => "?").join(",");
  const { results: roundMatches } = await env.DB.prepare(
    `SELECT id, league, home_kr, away_kr FROM round_matches WHERE round_id IN (${placeholders})`,
  )
    .bind(...roundIds)
    .all<{ id: number; league: League; home_kr: string; away_kr: string }>();

  const stmts = [];
  for (const rm of roundMatches ?? []) {
    const homeEn = NAME_MAP[rm.home_kr];
    const awayEn = NAME_MAP[rm.away_kr];
    const home = homeEn ? xgByLeague[rm.league]?.get(homeEn) : undefined;
    const away = awayEn ? xgByLeague[rm.league]?.get(awayEn) : undefined;
    if (!home || !away || home.matchesPlayed === 0 || away.matchesPlayed === 0) continue;
    const homeNet = home.xgFor / home.matchesPlayed - home.xgAgainst / home.matchesPlayed;
    const awayNet = away.xgFor / away.matchesPlayed - away.xgAgainst / away.matchesPlayed;
    stmts.push(
      env.DB.prepare("UPDATE round_predictions SET xg_diff = ? WHERE round_match_id = ?").bind(
        homeNet - awayNet,
        rm.id,
      ),
    );
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
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
