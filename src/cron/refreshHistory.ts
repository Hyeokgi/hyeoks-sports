// 3시간마다 실행: FotMob 종료 경기 결과 갱신 + Elo/무승부율 전체 재계산 + 진행중 회차 xG 갱신 + 정산
import { fetchFinishedMatches, fetchTeamXG, fetchMatchCorners, LEAGUE_IDS, type TeamXG } from "../lib/fotmob";
import { computeEloAndHistory } from "../lib/elo";
import { getAllMatches } from "../lib/db";
import { NAME_MAP } from "../lib/nameMap";
import { settleRounds } from "../lib/settlement";
import { refreshNationalElo, snapshotNationalEloDiffs } from "../lib/nationalEloStore";
import type { Env, League } from "../types";

// D1 batch 한 번에 넣을 문장 수. 너무 크면 한 트랜잭션이 길어지니 적당히 자른다.
const INSERT_CHUNK = 100;

// 코너 수집은 경기마다 FotMob 외부 요청이 하나씩 나간다. 오래 밀렸다가 한꺼번에 들어오면
// 외부 요청 한도를 넘길 수 있어 한 번에 이만큼만 처리한다. 나머지는 코너가 비어 남는다
// (피처가 없을 때의 기본값으로 처리되고, 이 경기들은 INSERT OR IGNORE라 다시 오지 않는다).
const MAX_CORNER_FETCHES = 20;

interface NewK2Match {
  fotmobId: number;
  date: string;
  home: string;
  away: string;
}

export async function refreshHistory(
  env: Env,
): Promise<{ inserted: number; leagues: string[]; national: Record<string, unknown> }> {
  let inserted = 0;
  const newK2Matches: NewK2Match[] = [];

  // FotMob 페이지는 시즌 전체 종료 경기를 돌려준다(8개 리그 합계 수천 건). 예전엔 경기마다
  // INSERT를 한 번씩 날렸는데, 워커는 호출 한 번에 D1 요청을 1,000회까지만 허용해서 시즌이
  // 쌓이자 "Too many API requests by single Worker invocation"으로 sync 전체가 500이 났다
  // (2026-09-24 확인, diagnose-sync 잡). 그러면 뒤에 오는 Elo 재계산·정산까지 통째로 멈춘다.
  // batch는 묶음 하나가 요청 1회로 계산되므로 청크로 나눠 보낸다. 결과 배열 순서가 입력과
  // 같아서 경기별 meta.changes로 '새로 들어간 경기'를 그대로 가려낼 수 있다.
  for (const [leagueName, leagueId] of Object.entries(LEAGUE_IDS)) {
    const finished = await fetchFinishedMatches(leagueId);
    for (let i = 0; i < finished.length; i += INSERT_CHUNK) {
      const chunk = finished.slice(i, i + INSERT_CHUNK);
      const results = await env.DB.batch(
        chunk.map((m) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO matches (league, date, home, away, hg, ag) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(leagueName, m.date, m.home, m.away, m.hg, m.ag),
        ),
      );
      chunk.forEach((m, j) => {
        if ((results[j]?.meta.changes ?? 0) === 0) return;
        inserted++;
        // 코너킥은 K리그2 한정 실증 검증된 피처(다른 리그는 백테스트 결과 무효/역효과) - 그 리그만 수집
        if (leagueName === "K리그2" && m.id) {
          newK2Matches.push({ fotmobId: m.id, date: m.date, home: m.home, away: m.away });
        }
      });
    }
  }

  if (inserted > 0) {
    await recomputeEloAndDrawRates(env);
  }

  await fetchAndStoreK2Corners(env, newK2Matches);
  await refreshXgForActiveRounds(env);
  // 국가대표 Elo는 부가 기능이다. 원본 CSV를 못 받아도 정산·Elo 갱신까지 막지 않는다.
  // 결과를 응답에 싣는다 - 실패를 삼키기만 하면 화면에 근거없음이 남아도 원인을 알 수 없다.
  let national: Record<string, unknown> = {};
  try {
    national = { ...(await refreshNationalElo(env)) };
    national.snapshotted = await snapshotNationalEloDiffs(env);
  } catch (e) {
    national.error = (e as Error).message.slice(0, 300);
    console.error(`refreshHistory: 국가대표 Elo 갱신 실패 - ${national.error}`);
  }
  await settleRounds(env);

  return { inserted, leagues: Object.keys(LEAGUE_IDS), national };
}

async function fetchAndStoreK2Corners(env: Env, matches: NewK2Match[]): Promise<void> {
  for (const m of matches.slice(-MAX_CORNER_FETCHES)) {
    const corners = await fetchMatchCorners(m.fotmobId);
    if (!corners) continue;
    await env.DB.prepare(
      "UPDATE matches SET home_corners = ?, away_corners = ? WHERE league = 'K리그2' AND date = ? AND home = ? AND away = ?",
    )
      .bind(corners.home, corners.away, m.date, m.home, m.away)
      .run();
  }
}

// round_predictions.xg_diff는 회차 생성 시점에 한 번만 계산되므로, 시즌이 진행되며 팀 xG가
// 바뀌는 걸 반영하려면 진행중(upcoming) 회차에 대해 주기적으로 다시 계산해 넣어줘야 한다.
export async function refreshXgForActiveRounds(env: Env): Promise<void> {
  const rounds = await env.DB.prepare("SELECT id FROM rounds WHERE status = 'upcoming'").all<{ id: number }>();
  const roundIds = (rounds.results ?? []).map((r) => r.id);
  if (roundIds.length === 0) return;

  // xG는 K리그1에서만 쓴다(createRound.ts의 XG_SUPPORTED_LEAGUES와 동일 결정 - K리그2는 FotMob에
  // 데이터가 없고, J1리그는 사전지표 검증 결과 무의미해서 사용자가 Elo+폼+H2H 기본 모델 유지를 결정함).
  const xgByLeague: Record<string, Map<string, TeamXG>> = {
    "K리그1": await fetchTeamXG(LEAGUE_IDS["K리그1"]),
  };
  if (xgByLeague["K리그1"].size === 0) return;

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
