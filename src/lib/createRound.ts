// 회차 등록 공용 로직 (elo/폼/H2H/xG 계산 + rounds/round_matches/round_predictions INSERT).
// detectNewRound.ts(wisetoto 기반 자동감지)에서 사용. 리그 목록에 무관하게 동작한다.
import { LEAGUE_IDS, fetchTeamXG, type TeamXG } from "./fotmob";
import { computeEloAndHistory, recentForm, h2hDiff as computeH2hDiff } from "./elo";
import { getAllMatches, getLeagueDrawRate } from "./db";
import { sendTelegramMessage } from "./telegram";
import { predictMatch, DEFAULT_TOGGLES } from "./prediction";
import { calibrationNote } from "./calibration";
import type { Env, League } from "../types";

export interface RoundFixture {
  seq: number;
  league: League;
  homeKr: string;
  awayKr: string;
  homeEn: string;
  awayEn: string;
  kickoffAt: string | null;
}

export interface CreateRoundOptions {
  roundNo?: number;
  roundNoConfirmed?: boolean;
  notify?: boolean;
}

export async function createRoundFromFixtures(
  env: Env,
  fixtures: RoundFixture[],
  opts: CreateRoundOptions = {},
): Promise<{ roundId: number }> {
  const matches = await getAllMatches(env);
  const { elo, teamHistory, h2h } = computeEloAndHistory(matches);

  const leagues = [...new Set(fixtures.map((f) => f.league))];

  const drawRates: Record<string, number> = {};
  for (const league of leagues) drawRates[league] = await getLeagueDrawRate(env, league);

  // xG는 FotMob이 일부 리그(예: K리그2)에서 아예 제공하지 않으므로(실측 확인됨) 해당 리그는 빈 Map이 온다.
  const xgByLeague: Record<string, Map<string, TeamXG>> = {};
  for (const league of leagues) {
    const leagueId = LEAGUE_IDS[league];
    xgByLeague[league] = leagueId ? await fetchTeamXG(leagueId) : new Map();
  }

  function computeXgDiff(league: League, homeEn: string, awayEn: string): number | null {
    const home = xgByLeague[league]?.get(homeEn);
    const away = xgByLeague[league]?.get(awayEn);
    if (!home || !away || home.matchesPlayed === 0 || away.matchesPlayed === 0) return null;
    const homeNet = home.xgFor / home.matchesPlayed - home.xgAgainst / home.matchesPlayed;
    const awayNet = away.xgFor / away.matchesPlayed - away.xgAgainst / away.matchesPlayed;
    return homeNet - awayNet;
  }

  const insertedRound = await env.DB.prepare(
    "INSERT INTO rounds (round_no, round_no_confirmed, status, created_at) VALUES (?, ?, 'upcoming', ?) RETURNING id",
  )
    .bind(opts.roundNo ?? null, opts.roundNoConfirmed ? 1 : 0, new Date().toISOString())
    .first<{ id: number }>();
  const roundId = insertedRound!.id;

  const notifyLines: string[] = [];
  for (const f of fixtures) {
    const homeState = elo.get(`${f.league}|${f.homeEn}`);
    const awayState = elo.get(`${f.league}|${f.awayEn}`);
    const eloDiff = (homeState?.elo ?? 1500) - (awayState?.elo ?? 1500);
    const formHome = recentForm(teamHistory, f.league, f.homeEn);
    const formAway = recentForm(teamHistory, f.league, f.awayEn);
    const formDiff = formHome.avgPts - formAway.avgPts;
    const h2h_ = computeH2hDiff(h2h, f.league, f.homeEn, f.awayEn);
    const xgDiff = computeXgDiff(f.league, f.homeEn, f.awayEn);

    const insertedMatch = await env.DB.prepare(
      "INSERT INTO round_matches (round_id, seq, league, home_kr, away_kr, kickoff_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(roundId, f.seq, f.league, f.homeKr, f.awayKr, f.kickoffAt)
      .first<{ id: number }>();
    const roundMatchId = insertedMatch!.id;

    await env.DB.prepare(
      "INSERT INTO round_predictions (round_match_id, elo_diff, form_diff, h2h_diff, n_h2h, league_draw_rate, xg_diff, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(roundMatchId, eloDiff, formDiff, h2h_.diff, h2h_.n, drawRates[f.league], xgDiff, new Date().toISOString())
      .run();

    // 기본 토글(해외배당 없음, 등록 시점 xG만) 기준 요약 - 텔레그램은 나중에 배당이 붙기 전 스냅샷.
    const p = predictMatch(
      { eloDiff, formDiff, h2hDiff: h2h_.diff, leagueDrawRate: drawRates[f.league], marketOdds: null, xgDiff },
      DEFAULT_TOGGLES,
    );
    const note = calibrationNote(f.league, p.confidenceGap);
    notifyLines.push(
      `${f.seq}. ${f.homeKr} vs ${f.awayKr} (${f.league}) - 모델추천 ${p.rankedPicks[0]}, 확신도 ${(p.confidenceGap * 100).toFixed(1)}%p${note ? ` (${note})` : ""}`,
    );
  }

  if (opts.notify !== false) {
    const roundLabel = opts.roundNoConfirmed && opts.roundNo ? `${opts.roundNo}회차` : "신규 회차";
    await sendTelegramMessage(env, `⚽ <b>축구토토 승무패 ${roundLabel}가 등록되었습니다</b>\n\n${notifyLines.join("\n")}`);
    await env.DB.prepare("UPDATE rounds SET notified_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), roundId)
      .run();
  }

  return { roundId };
}
