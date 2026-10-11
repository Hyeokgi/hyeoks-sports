// 리그 순위표·Elo 순위를 D1에서 읽어 leagueTables.ts(순수 계산)로 넘기는 로더.
//
// 조회 원칙(요청 1회당 D1 요청 수를 작게, 결과 행 수는 LIMIT으로 묶는다)
// - 리그 페이지: matches 1회(그 리그 전체 기록, 리그당 약 1,100~1,500행) + team_elo 1회. 국가대표는 national_elo 1회.
// - /ratings·사이트맵: matches 1회(최근 450일, 전 리그) + team_elo 1회 + national_elo 1회.
// - 읽기 전용이라 batch가 필요 없다. 쓰기는 하지 않는다.
// 결과는 리그 페이지의 10분 엣지 캐시에 함께 담기므로 같은 계산을 방문마다 반복하지 않는다.
import type { Env } from "../types";
import {
  computeStandings,
  rankElo,
  rankNationalElo,
  eloChangeSince,
  compareRanks,
  tablesMeaningful,
  type ResultRow,
  type Standings,
  type EloRankRow,
  type EloInput,
  type RankComparison,
} from "./leagueTables";
import { homeAdvForLeague } from "./elo";
import { NATIONAL_LEAGUE } from "./fixtures";
import { NATIONAL_MIN_MATCHES } from "./nationalEloStore";
import { NATIONAL_HOME_ADV } from "./nationalElo";
import { nationalKrOf } from "./nationalNames";
import { displayTeamName, LEAGUE_INFO } from "./teamNames";

/** Elo 변화량을 보는 기간(일). */
export const CHANGE_DAYS = 30;
// 리그 하나의 전체 기록은 2021년 이후 리그당 1,100~1,500경기다(seed 기준). 한도에 닿으면 기록이 잘린 것이라
// 다시 계산한 변화량이 cron 값과 달라질 수 있어 변화량을 생략한다.
const HISTORY_LIMIT = 6000;
const ELO_LIMIT = 300;
// 전 리그 최근 경기. 교차연도 시즌의 시작(8월)부터 다음 시즌 직전(이듬해 8월)까지 약 400일이라 여유를 둔다.
const RECENT_DAYS = 450;
const RECENT_LIMIT = 12000;
const ALL_ELO_LIMIT = 4000;
const NATIONAL_LIMIT = 500;
export const NATIONAL_TOP = 30;
// 3년 안에 A매치가 없는 팀(해체된 나라·장기 활동 중단)은 '현재 순위'에서 뺀다.
export const NATIONAL_ACTIVE_DAYS = 3 * 365;

/**
 * 순위표를 보여주지 않는 리그와 이유.
 * J1리그는 2026-27 시즌부터 8월 개막(이듬해 봄 종료)으로 바뀌었는데, elo.ts의 seasonOf는 J1을 아직 역년(1~12월)
 * 시즌으로 자른다. 그대로 집계하면 서로 다른 대회·시즌 경기가 한 표에 섞인다. seasonOf를 바꾸면 Elo 시즌 회귀
 * 시점이 바뀌는 모델 변경(시간순 4분할 검증 대상)이라 여기서는 순위표만 숨기고 Elo 순위는 그대로 보여준다.
 */
export const STANDINGS_SUPPRESSED: Record<string, string> = {
  "J1리그": "J1리그는 2026-27 시즌부터 8월 개막 방식으로 바뀌었지만, 이 사이트의 시즌 구분은 아직 1~12월 기준이라 자체 집계 순위표가 실제 대회 구분과 맞지 않습니다. 시즌 구분을 고칠 때까지 순위표는 표시하지 않고 Elo 순위만 보여줍니다.",
};

/** 리그별로 덧붙이는 순위표 주의(사실 확인된 대회 방식 차이만). */
export const STANDINGS_LEAGUE_NOTES: Record<string, string> = {
  "K리그1": "K리그1은 정규 라운드 뒤 상·하위 그룹으로 나뉘는 파이널 라운드가 있어, 공식 순위에서는 하위 그룹 팀이 승점과 관계없이 상위 그룹 팀보다 위로 갈 수 없습니다. 이 표는 그룹 구분 없이 승점으로만 정렬합니다.",
  "MLS": "MLS 공식 순위는 동부·서부 콘퍼런스별로 나뉩니다. 이 표는 콘퍼런스 구분 없이 전체 팀을 한 표로 정렬했습니다.",
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 표시용 팀명. 클럽은 teamNames의 한글 이름(없으면 영문), 국가대표는 한글 국가명(없으면 영문). */
export function tableTeamName(league: string, team: string): string {
  return league === NATIONAL_LEAGUE ? nationalKrOf(team) ?? team : displayTeamName(team);
}

export interface LeagueTablesView {
  kind: "club" | "national";
  league: string;
  /** 이 자료를 계산한 시각(UTC ISO). */
  generatedAt: string;
  standings: Standings | null;
  /** 순위표를 숨긴 이유(STANDINGS_SUPPRESSED). */
  standingsNote: string | null;
  elo: EloRankRow[];
  /** 클럽: Elo 계산에 들어간 이 리그 경기 수(표본). 국가대표: 순위 후보 팀 수. */
  eloSample: number;
  /** 클럽: 기록의 첫 경기일. 국가대표: null. */
  eloSampleFrom: string | null;
  /** 클럽: 가장 최근 반영 경기일. 국가대표: 레이팅 갱신 시각(updated_at). */
  eloAsOf: string | null;
  /** 변화량 기간(일). 계산하지 못했으면 null. */
  changeDays: number | null;
  homeAdv: number;
}

interface TeamEloRow {
  league?: string;
  team_en: string;
  elo: number;
  last_match_date: string | null;
}
interface NationalRow {
  team_en: string;
  elo: number;
  n_matches: number;
  last_match_date: string | null;
  updated_at: string | null;
}

const toEloInput = (r: TeamEloRow): EloInput => ({ team: r.team_en, elo: r.elo, lastMatchDate: r.last_match_date });
const maxStr = (xs: (string | null | undefined)[]): string | null =>
  xs.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null);

function nationalRanking(rows: readonly NationalRow[], now: number): EloRankRow[] {
  return rankNationalElo(
    rows.map((r) => ({ team: r.team_en, elo: r.elo, nMatches: r.n_matches, lastMatchDate: r.last_match_date })),
    now,
    { minMatches: NATIONAL_MIN_MATCHES, activeDays: NATIONAL_ACTIVE_DAYS, limit: NATIONAL_TOP },
  );
}

async function readNational(env: Env): Promise<NationalRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT team_en, elo, n_matches, last_match_date, updated_at FROM national_elo WHERE n_matches >= ? ORDER BY elo DESC LIMIT ?",
  )
    .bind(NATIONAL_MIN_MATCHES, NATIONAL_LIMIT)
    .all<NationalRow>();
  return results ?? [];
}

/** 리그 페이지용. 실패하면 예외를 던진다(호출 쪽에서 섹션만 숨긴다). */
export async function loadLeagueTables(env: Env, league: string, now = Date.now()): Promise<LeagueTablesView> {
  const generatedAt = new Date(now).toISOString();
  if (league === NATIONAL_LEAGUE) {
    const rows = await readNational(env);
    const elo = nationalRanking(rows, now);
    return {
      kind: "national", league, generatedAt, standings: null, standingsNote: null, elo,
      eloSample: rows.length, eloSampleFrom: null, eloAsOf: maxStr(rows.map((r) => r.updated_at)),
      changeDays: null, homeAdv: NATIONAL_HOME_ADV,
    };
  }

  // 최신 경기부터 읽어 한도에 닿아도 이번 시즌은 빠지지 않게 하고, 계산 전에 시간순으로 되돌린다.
  const { results: hist } = await env.DB.prepare(
    "SELECT date, home, away, hg, ag FROM matches WHERE league = ? ORDER BY date DESC LIMIT ?",
  )
    .bind(league, HISTORY_LIMIT)
    .all<ResultRow>();
  const rows = (hist ?? []).slice().reverse();
  const truncated = rows.length >= HISTORY_LIMIT;
  const { results: eloRows } = await env.DB.prepare(
    "SELECT team_en, elo, last_match_date FROM team_elo WHERE league = ? ORDER BY elo DESC LIMIT ?",
  )
    .bind(league, ELO_LIMIT)
    .all<TeamEloRow>();

  const standings = computeStandings(league, rows);
  // team_elo에는 강등·이탈한 팀도 남아 있다. 이번(마지막) 시즌 순위표에 있는 팀만 Elo 순위에 넣는다.
  const teams = standings ? new Set(standings.rows.map((r) => r.team)) : null;
  const changes = truncated || rows.length === 0 ? null : eloChangeSince(league, rows, isoDay(now - CHANGE_DAYS * 86400e3));
  const elo = rankElo((eloRows ?? []).map(toEloInput), { teams, changes, activeSince: isoDay(now - RECENT_DAYS * 86400e3) });
  const suppressed = STANDINGS_SUPPRESSED[league] ?? null;
  return {
    kind: "club", league, generatedAt,
    standings: suppressed ? null : standings,
    standingsNote: suppressed,
    elo,
    eloSample: rows.length,
    eloSampleFrom: rows.length ? rows[0].date : null,
    eloAsOf: rows.length ? rows[rows.length - 1].date : null,
    changeDays: changes ? CHANGE_DAYS : null,
    homeAdv: homeAdvForLeague(league),
  };
}

export interface LeagueOverview {
  league: string;
  standings: Standings | null;
  standingsNote: string | null;
  /** 이번 시즌 팀의 Elo 순위 전체(제한 없음). 화면에서 상위만 자른다. */
  elo: EloRankRow[];
  comparison: RankComparison | null;
  meaningful: boolean;
  homeAdv: number;
}
export interface RatingsOverview {
  generatedAt: string;
  leagues: LeagueOverview[];
  /** 국가대표 상위 NATIONAL_TOP. 조회 실패면 null. */
  national: EloRankRow[] | null;
  nationalAsOf: string | null;
  /** 전 리그 최근 경기 조회가 한도에 닿아 순위표를 만들지 않았는가(정상이면 false). */
  truncated: boolean;
}

/**
 * /ratings와 사이트맵용 전 리그 요약. 클럽 조회가 실패하면 예외(503), 국가대표만 실패하면 그 부분만 null.
 * 리그 페이지와 같은 함수(computeStandings·rankElo·tablesMeaningful)로 판정해 색인 여부가 어긋나지 않게 한다.
 */
export async function loadRatingsOverview(env: Env, now = Date.now()): Promise<RatingsOverview> {
  const [recentRes, eloRes, nationalRes] = await Promise.allSettled([
    env.DB.prepare("SELECT league, date, home, away, hg, ag FROM matches WHERE date >= ? ORDER BY date DESC LIMIT ?")
      .bind(isoDay(now - RECENT_DAYS * 86400e3), RECENT_LIMIT)
      .all<ResultRow & { league: string }>(),
    env.DB.prepare("SELECT league, team_en, elo, last_match_date FROM team_elo ORDER BY league ASC, elo DESC LIMIT ?")
      .bind(ALL_ELO_LIMIT)
      .all<TeamEloRow>(),
    readNational(env),
  ]);
  if (recentRes.status === "rejected") throw recentRes.reason;
  if (eloRes.status === "rejected") throw eloRes.reason;
  const recent = recentRes.value.results ?? [];
  const truncated = recent.length >= RECENT_LIMIT;
  if (truncated) console.error(`loadRatingsOverview: 최근 경기 ${recent.length}행이 한도에 닿아 순위표를 생략`);

  const byLeague = new Map<string, ResultRow[]>();
  for (const r of recent) byLeague.set(r.league, [...(byLeague.get(r.league) ?? []), r]);
  const eloByLeague = new Map<string, EloInput[]>();
  for (const r of eloRes.value.results ?? []) {
    const lg = r.league ?? "";
    eloByLeague.set(lg, [...(eloByLeague.get(lg) ?? []), toEloInput(r)]);
  }

  const leagues: LeagueOverview[] = [];
  for (const league of Object.keys(LEAGUE_INFO)) {
    if (league === NATIONAL_LEAGUE) continue;
    const rows = (byLeague.get(league) ?? []).slice().reverse();
    const full = truncated ? null : computeStandings(league, rows);
    const teams = full ? new Set(full.rows.map((r) => r.team)) : null;
    const eloInputs = eloByLeague.get(league) ?? [];
    const elo = rankElo(eloInputs, { teams, activeSince: isoDay(now - RECENT_DAYS * 86400e3) });
    const suppressed = STANDINGS_SUPPRESSED[league] ?? null;
    const standings = suppressed ? null : full;
    leagues.push({
      league,
      standings,
      standingsNote: suppressed,
      elo,
      comparison: standings ? compareRanks(standings, eloInputs) : null,
      meaningful: tablesMeaningful({ standings, elo }),
      homeAdv: homeAdvForLeague(league),
    });
  }

  const nat = nationalRes.status === "fulfilled" ? nationalRes.value : null;
  if (nationalRes.status === "rejected") console.error(`loadRatingsOverview: 국가대표 Elo 조회 실패 - ${(nationalRes.reason as Error)?.message}`);
  return {
    generatedAt: new Date(now).toISOString(),
    leagues,
    national: nat ? nationalRanking(nat, now) : null,
    nationalAsOf: nat ? maxStr(nat.map((r) => r.updated_at)) : null,
    truncated,
  };
}
