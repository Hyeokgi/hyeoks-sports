// 등록 뒤 이름표(NAME_MAP)가 고쳐진 경기의 예측 성분을 킥오프 전에 다시 계산한다.
//
// 왜 필요한가: 예측 성분(Elo·폼·H2H)은 회차 등록 순간 한 번 계산해 round_predictions에 고정된다.
// 그때 베트맨 팀 약칭이 이름표에 없으면 그 경기는 market_only=1(배당 대기)로 저장되고, 배당이
// 들어오기 전까지 앱·블로그에 "근거가 들어오기 전까지 판단을 보류합니다"로 나간다.
// 2026-10-02 59회차에서 베트맨이 라리가 3팀 약칭을 바꿔(셀타비고·데포아코·라싱산탄) 3경기가
// 이렇게 됐고, 이름표를 고쳐도 이미 등록된 회차는 그대로였다.
//
// 규칙: 아직 킥오프 전이고, 모델 지원 리그이며, 지금은 두 팀 모두 이름표에 있는 경기만 다시 계산한다.
// 킥오프가 지난 경기는 결과가 Elo에 섞일 수 있어(사후 예측) 절대 건드리지 않는다.
// 다시 계산하는 성분은 createRound.ts와 같다(Elo·최근폼·H2H·리그 무승부율). xG(K리그1)·코너(K리그2)는
// 등록 때만 수집하는 값이라 비워 둔다(배당 대기로 떨어졌던 경기는 원래 비어 있었다).
import { computeEloAndHistory, recentForm, h2hDiff as computeH2hDiff } from "./elo";
import { getAllMatches, getLeagueDrawRate } from "./db";
import { NAME_MAP, leagueOfKr, isModelLeague } from "./nameMap";
import type { Env, League } from "../types";

export interface RemapCandidateRow {
  round_match_id: number;
  league: string;
  home_kr: string;
  away_kr: string;
  kickoff_at: string | null;
}

export interface RemapTarget {
  roundMatchId: number;
  league: League;
  homeEn: string;
  awayEn: string;
}

/** 배당 대기로 등록됐지만 지금은 두 팀 모두 이름표에 있고, 아직 킥오프 전인 경기만 고른다. */
export function selectRemappable(rows: RemapCandidateRow[], nameMap: Record<string, string>, now: number): RemapTarget[] {
  const out: RemapTarget[] = [];
  for (const r of rows) {
    const k = r.kickoff_at ? Date.parse(r.kickoff_at) : NaN;
    if (!Number.isFinite(k) || k <= now) continue;
    const league = leagueOfKr(r.home_kr, r.league as League);
    if (!isModelLeague(league)) continue;
    const homeEn = nameMap[r.home_kr];
    const awayEn = nameMap[r.away_kr];
    if (!homeEn || !awayEn) continue;
    out.push({ roundMatchId: r.round_match_id, league, homeEn, awayEn });
  }
  return out;
}

/** 진행 중 회차의 배당 대기 경기 중 다시 계산할 수 있는 것을 갱신한다. 갱신한 경기 수를 돌려준다. */
export async function remapUpcomingMarketOnly(env: Env, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT rm.id AS round_match_id, rm.league, rm.home_kr, rm.away_kr, rm.kickoff_at
       FROM round_matches rm
       JOIN round_predictions rp ON rp.round_match_id = rm.id
       JOIN rounds r ON r.id = rm.round_id
      WHERE r.status = 'upcoming' AND rp.market_only = 1`,
  ).all<RemapCandidateRow>();
  const targets = selectRemappable(results ?? [], NAME_MAP, now);
  if (targets.length === 0) return 0;

  const { elo, teamHistory, h2h } = computeEloAndHistory(await getAllMatches(env));
  const drawRates: Record<string, number> = {};
  const at = new Date(now).toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const t of targets) {
    if (drawRates[t.league] === undefined) drawRates[t.league] = await getLeagueDrawRate(env, t.league);
    const eloDiff = (elo.get(`${t.league}|${t.homeEn}`)?.elo ?? 1500) - (elo.get(`${t.league}|${t.awayEn}`)?.elo ?? 1500);
    const formDiff = recentForm(teamHistory, t.league, t.homeEn).avgPts - recentForm(teamHistory, t.league, t.awayEn).avgPts;
    const hh = computeH2hDiff(h2h, t.league, t.homeEn, t.awayEn);
    stmts.push(
      env.DB.prepare(
        "UPDATE round_predictions SET elo_diff = ?, form_diff = ?, h2h_diff = ?, n_h2h = ?, league_draw_rate = ?, xg_diff = NULL, corners_diff = NULL, market_only = 0, computed_at = ? WHERE round_match_id = ?",
      ).bind(eloDiff, formDiff, hh.diff, hh.n, drawRates[t.league], at, t.roundMatchId),
    );
  }
  await env.DB.batch(stmts);
  return stmts.length;
}
