// 6시간마다 실행: FotMob 예정 경기로 "다음 14경기 묶음"을 추정해 새 회차 등록 + 텔레그램 알림
// betman.co.kr 공식 회차 확인은 세션 게이트가 있어 Worker에서 직접 못 긁으므로, 실제 회차번호는
// /api/admin/rounds/:id PATCH로 사용자가 수동 보정한다(화면에 "회차 추정값" 고지).
import { fetchUpcomingMatches, LEAGUE_IDS } from "../lib/fotmob";
import { computeEloAndHistory, recentForm, h2hDiff as computeH2hDiff } from "../lib/elo";
import { getAllMatches, getLeagueDrawRate } from "../lib/db";
import { NAME_MAP, leagueOfKr } from "../lib/nameMap";
import { sendTelegramMessage } from "../lib/telegram";
import type { Env, League } from "../types";

const ROUND_SIZE = 14;

interface Candidate {
  league: League;
  homeKr: string;
  awayKr: string;
  homeEn: string;
  awayEn: string;
  kickoffAt: string | null;
  date: string;
}

function buildReverseMap(): Map<string, string> {
  const rev = new Map<string, string>();
  for (const [kr, en] of Object.entries(NAME_MAP)) rev.set(en, kr);
  return rev;
}

function signature(candidates: Candidate[]): string {
  return candidates
    .map((c) => `${c.homeEn}|${c.awayEn}`)
    .sort()
    .join(",");
}

export async function detectNewRound(env: Env): Promise<{ created: boolean; roundId?: number }> {
  const reverse = buildReverseMap();

  const allCandidates: Candidate[] = [];
  for (const leagueId of Object.values(LEAGUE_IDS)) {
    const upcoming = await fetchUpcomingMatches(leagueId);
    for (const m of upcoming) {
      const homeKr = reverse.get(m.home);
      const awayKr = reverse.get(m.away);
      if (!homeKr || !awayKr) continue; // NAME_MAP에 없는 팀(승격/신규팀)은 관리자 보정 전까지 제외
      allCandidates.push({
        league: leagueOfKr(homeKr),
        homeKr,
        awayKr,
        homeEn: m.home,
        awayEn: m.away,
        kickoffAt: m.utcKickoff,
        date: m.date,
      });
    }
  }

  allCandidates.sort((a, b) => (a.kickoffAt ?? a.date).localeCompare(b.kickoffAt ?? b.date));
  const next14 = allCandidates.slice(0, ROUND_SIZE);
  if (next14.length < ROUND_SIZE) return { created: false };

  const sig = signature(next14);
  const latest = await env.DB.prepare(
    "SELECT id FROM rounds WHERE status = 'upcoming' ORDER BY id DESC LIMIT 1",
  ).first<{ id: number }>();

  if (latest) {
    const existingMatches = await env.DB.prepare(
      "SELECT home_kr, away_kr FROM round_matches WHERE round_id = ?",
    )
      .bind(latest.id)
      .all<{ home_kr: string; away_kr: string }>();
    const existingSig = (existingMatches.results ?? [])
      .map((r) => `${NAME_MAP[r.home_kr]}|${NAME_MAP[r.away_kr]}`)
      .sort()
      .join(",");
    if (existingSig === sig) return { created: false };
  }

  const matches = await getAllMatches(env);
  const { elo, teamHistory, h2h } = computeEloAndHistory(matches);

  const drawRates: Record<string, number> = {
    "K리그1": await getLeagueDrawRate(env, "K리그1"),
    "K리그2": await getLeagueDrawRate(env, "K리그2"),
  };

  const insertedRound = await env.DB.prepare(
    "INSERT INTO rounds (round_no, round_no_confirmed, status, created_at) VALUES (NULL, 0, 'upcoming', ?) RETURNING id",
  )
    .bind(new Date().toISOString())
    .first<{ id: number }>();
  const roundId = insertedRound!.id;

  let seq = 1;
  for (const c of next14) {
    const homeState = elo.get(`${c.league}|${c.homeEn}`);
    const awayState = elo.get(`${c.league}|${c.awayEn}`);
    const eloDiff = (homeState?.elo ?? 1500) - (awayState?.elo ?? 1500);
    const formHome = recentForm(teamHistory, c.league, c.homeEn);
    const formAway = recentForm(teamHistory, c.league, c.awayEn);
    const formDiff = formHome.avgPts - formAway.avgPts;
    const h2h_ = computeH2hDiff(h2h, c.league, c.homeEn, c.awayEn);

    const insertedMatch = await env.DB.prepare(
      "INSERT INTO round_matches (round_id, seq, league, home_kr, away_kr, kickoff_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(roundId, seq, c.league, c.homeKr, c.awayKr, c.kickoffAt)
      .first<{ id: number }>();
    const roundMatchId = insertedMatch!.id;

    await env.DB.prepare(
      "INSERT INTO round_predictions (round_match_id, elo_diff, form_diff, h2h_diff, n_h2h, league_draw_rate, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(roundMatchId, eloDiff, formDiff, h2h_.diff, h2h_.n, drawRates[c.league], new Date().toISOString())
      .run();

    seq++;
  }

  const summary = next14.map((c, i) => `${i + 1}. ${c.homeKr} vs ${c.awayKr} (${c.league})`).join("\n");
  await sendTelegramMessage(
    env,
    `⚽ <b>새로운 K리그 승무패 회차가 등록되었습니다</b>\n(회차번호는 추정값 - betman.co.kr에서 확인 후 보정 필요)\n\n${summary}`,
  );
  await env.DB.prepare("UPDATE rounds SET notified_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), roundId)
    .run();

  return { created: true, roundId };
}
