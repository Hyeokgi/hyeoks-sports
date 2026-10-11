// 리그 순위표(자체 집계)와 Elo 전력 순위 - 순수 계산 모듈(D1·화면 의존 없음).
//
// 왜 만들었나(2026-10 AdSense '가치 낮은 콘텐츠' 대응 2단계)
//   리그 페이지(/league/{slug})가 이번 주 경기 목록만 있어서, 휴식기에는 빈 페이지가 되고 시즌 중에도
//   다른 사이트 일정표와 다를 게 없었다. 우리 DB(matches·team_elo·national_elo)에 이미 있는 결과로
//   '시즌 순위표'와 'Elo 전력 순위'를 계산해 보여주면, 확률·베팅과 무관하게 읽을 가치가 있는 자료가 된다.
//
// 원칙
// - 순위표는 공식 순위가 아니다. 승점 3/1/0과 고정된 정렬 규칙으로 우리가 다시 센 값이라
//   승점 삭감·리그별 타이브레이커(상대 전적 등)·스플릿 라운드는 반영하지 않는다. 화면에 반드시 이 사실을 붙인다.
// - 시즌 경계는 elo.ts의 seasonOf를 그대로 쓴다. 따로 만들면 Elo의 시즌 회귀 시점과 순위표의 시즌이 어긋난다.
// - 계산할 수 없는 값(예: 30일 전 기록이 없는 팀의 변화량)은 null로 두고 화면에서 '없음'으로 보인다. 지어내지 않는다.
import { seasonOf, computeEloAndHistory } from "./elo";

/** 저장된 경기 결과 한 줄(matches 테이블의 date, home, away, hg, ag). 팀명은 FotMob 영문 키. */
export interface ResultRow {
  date: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
}

export type FormMark = "W" | "D" | "L";

export interface StandingRow {
  rank: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  /** 시즌 안 최근 경기 결과, 왼쪽이 오래된 경기·오른쪽이 가장 최근(최대 FORM_LENGTH개). */
  form: FormMark[];
}

export interface Standings {
  league: string;
  season: number;
  seasonLabel: string;
  rows: StandingRow[];
  /** 순위표에 반영한 경기 수(표본). */
  matches: number;
  firstDate: string;
  lastDate: string;
}

export const FORM_LENGTH = 5;
export const STANDINGS_LABEL = "HYEOKS 집계, 공식 순위와 다를 수 있음(승점 삭감·타이브레이커 미반영)";
export const TIEBREAK_NOTE =
  "정렬 순서: 승점 → 득실차 → 다득점 → 팀 영문명 알파벳 순. 마지막 기준은 표를 매번 같은 순서로 보여주기 위한 것이며 공식 타이브레이커(상대 전적 등)가 아닙니다.";

// 리그 페이지를 색인할 만큼 자료가 있는지 판단하는 기준. 시즌 초 1~2라운드(경기 수 몇 개)만으로는
// 순위표가 의미가 없어 10경기를 하한으로 둔다. Elo는 리그 팀 대부분(8팀 이상)이 있어야 '순위'라 부를 수 있다.
export const MIN_STANDINGS_MATCHES = 10;
export const MIN_ELO_TEAMS = 8;
// 순위표 순위와 Elo 순위를 비교할 때 모든 팀이 최소 이만큼은 치렀어야 한다(시즌 극초반 비교는 잡음).
export const MIN_PLAYED_FOR_COMPARISON = 5;

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isGoal = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** 집계에 쓸 수 있는 결과인가. D1에서 이상한 값이 와도 표 전체가 깨지지 않게 줄 단위로 거른다. */
export function isValidResult(r: ResultRow): boolean {
  return (
    typeof r.home === "string" && r.home !== "" &&
    typeof r.away === "string" && r.away !== "" &&
    r.home !== r.away &&
    isGoal(r.hg) && isGoal(r.ag) &&
    typeof r.date === "string" && Number.isFinite(Date.parse(r.date))
  );
}

/**
 * 교차연도(8월~이듬해 5월) 시즌 리그인가. elo.ts의 목록을 복사하지 않고 seasonOf 결과로 판정한다
 * (1월 경기가 전년도 시즌으로 잡히면 교차연도). 두 곳 목록이 어긋날 일이 없다.
 */
export function isCrossYearLeague(league: string): boolean {
  return seasonOf(league, "2001-01-15") === 2000;
}

/** 시즌 표기: 교차연도 리그는 "2025-26", 역년 리그는 "2026". */
export function seasonLabel(league: string, season: number): string {
  return isCrossYearLeague(league) ? `${season}-${String((season + 1) % 100).padStart(2, "0")}` : String(season);
}

/** 가장 최근 저장 경기의 시즌. 휴식기에도 '마지막 시즌' 순위표를 보여주기 위해 오늘 날짜가 아니라 자료 기준으로 정한다. */
export function latestSeason(league: string, rows: readonly ResultRow[]): number | null {
  let best = -Infinity;
  let date: string | null = null;
  for (const r of rows) {
    if (!isValidResult(r)) continue;
    const t = Date.parse(r.date);
    if (t > best) {
      best = t;
      date = r.date;
    }
  }
  return date == null ? null : seasonOf(league, date);
}

/** 순위표 정렬 규칙(TIEBREAK_NOTE와 같은 순서). 테스트에서 직접 확인할 수 있게 내보낸다. */
export function compareStanding(
  a: Pick<StandingRow, "points" | "gd" | "gf" | "team">,
  b: Pick<StandingRow, "points" | "gd" | "gf" | "team">,
): number {
  return b.points - a.points || b.gd - a.gd || b.gf - a.gf || cmpStr(a.team, b.team);
}

interface Acc {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  form: FormMark[];
}

/**
 * 한 리그의 시즌 순위표. season을 주지 않으면 가장 최근 경기의 시즌을 쓴다.
 * rows는 그 리그 경기만 넘긴다(리그 구분은 호출 쪽 책임). 유효한 경기가 없으면 null.
 */
export function computeStandings(league: string, rows: readonly ResultRow[], season?: number): Standings | null {
  const valid = rows.filter(isValidResult);
  if (valid.length === 0) return null;
  const target = season ?? latestSeason(league, valid);
  if (target == null) return null;
  // 같은 날 경기의 순서는 최근 5경기 표시에만 영향이 있다. 결과가 매번 같도록 홈팀 이름으로 고정한다.
  const inSeason = valid
    .filter((r) => seasonOf(league, r.date) === target)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || cmpStr(a.home, b.home) || cmpStr(a.away, b.away));
  if (inSeason.length === 0) return null;

  const acc = new Map<string, Acc>();
  const get = (team: string): Acc => {
    let x = acc.get(team);
    if (!x) {
      x = { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, form: [] };
      acc.set(team, x);
    }
    return x;
  };
  for (const m of inSeason) {
    const h = get(m.home);
    const a = get(m.away);
    h.played += 1;
    a.played += 1;
    h.gf += m.hg;
    h.ga += m.ag;
    a.gf += m.ag;
    a.ga += m.hg;
    if (m.hg > m.ag) {
      h.won += 1;
      a.lost += 1;
      h.form.push("W");
      a.form.push("L");
    } else if (m.hg < m.ag) {
      h.lost += 1;
      a.won += 1;
      h.form.push("L");
      a.form.push("W");
    } else {
      h.drawn += 1;
      a.drawn += 1;
      h.form.push("D");
      a.form.push("D");
    }
  }
  const list = [...acc.values()].map((x) => ({
    team: x.team,
    played: x.played,
    won: x.won,
    drawn: x.drawn,
    lost: x.lost,
    gf: x.gf,
    ga: x.ga,
    gd: x.gf - x.ga,
    points: x.won * 3 + x.drawn,
    form: x.form.slice(-FORM_LENGTH),
  }));
  list.sort(compareStanding);
  return {
    league,
    season: target,
    seasonLabel: seasonLabel(league, target),
    rows: list.map((x, i) => ({ rank: i + 1, ...x })),
    matches: inSeason.length,
    firstDate: inSeason[0].date,
    lastDate: inSeason[inSeason.length - 1].date,
  };
}

// ---------- Elo ----------

/** team_elo 한 줄(클럽). */
export interface EloInput {
  team: string;
  elo: number;
  lastMatchDate: string | null;
}

export interface EloRankRow {
  rank: number;
  team: string;
  elo: number;
  /** 최근 changeDays일 동안의 변화. 비교 기준이 없으면 null(지어내지 않는다). */
  change: number | null;
  lastMatchDate: string | null;
  /** 국가대표만: 레이팅에 반영된 A매치 수. 클럽은 null. */
  matches: number | null;
}

/**
 * Elo 순위. 레이팅 내림차순, 같으면 영문명 순.
 * - teams: 이번 시즌 순위표에 있는 팀만 남긴다(team_elo에는 강등된 팀도 남아 있어서).
 * - teams가 비어 있으면 activeSince 이후에 경기한 팀만 남긴다.
 */
export function rankElo(
  rows: readonly EloInput[],
  opts: {
    teams?: ReadonlySet<string> | null;
    changes?: ReadonlyMap<string, number> | null;
    activeSince?: string | null;
    limit?: number;
  } = {},
): EloRankRow[] {
  const seen = new Set<string>();
  const since = opts.activeSince ? Date.parse(opts.activeSince) : NaN;
  const useTeams = opts.teams != null && opts.teams.size > 0;
  const picked: EloInput[] = [];
  for (const r of rows) {
    if (!r.team || seen.has(r.team) || typeof r.elo !== "number" || !Number.isFinite(r.elo)) continue;
    if (useTeams) {
      if (!opts.teams!.has(r.team)) continue;
    } else if (Number.isFinite(since)) {
      const t = r.lastMatchDate ? Date.parse(r.lastMatchDate) : NaN;
      if (!Number.isFinite(t) || t < since) continue;
    }
    seen.add(r.team);
    picked.push(r);
  }
  picked.sort((a, b) => b.elo - a.elo || cmpStr(a.team, b.team));
  const limited = opts.limit != null && opts.limit >= 0 ? picked.slice(0, opts.limit) : picked;
  return limited.map((r, i) => {
    const c = opts.changes?.get(r.team);
    return {
      rank: i + 1,
      team: r.team,
      elo: r.elo,
      change: typeof c === "number" && Number.isFinite(c) ? c : null,
      lastMatchDate: r.lastMatchDate,
      matches: null,
    };
  });
}

/**
 * 최근 변화량: 같은 경기 기록으로 '지금'과 'cutoffDate(포함)까지'의 Elo를 다시 계산해 뺀다.
 * team_elo는 현재 값만 저장해 과거 값이 없다. 리그별 Elo는 다른 리그와 섞이지 않으므로(키 = 리그|팀)
 * 그 리그 경기만으로 다시 계산해도 cron(recomputeEloAndDrawRates)과 같은 값이 나온다.
 * cutoff 전에 경기가 없던 팀(새로 올라온 팀 등)은 비교 기준이 없어 결과에서 빠진다.
 * 시즌이 바뀐 뒤 첫 경기에서 적용되는 회귀(1500 쪽으로 25%)도 변화량에 포함된다.
 */
export function eloChangeSince(league: string, rows: readonly ResultRow[], cutoffDate: string): Map<string, number> {
  const out = new Map<string, number>();
  const cutoff = Date.parse(cutoffDate);
  if (!Number.isFinite(cutoff)) return out;
  const valid = rows.filter(isValidResult).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const toMatch = (r: ResultRow) => ({ league, date: r.date, home: r.home, away: r.away, hg: r.hg, ag: r.ag });
  const now = computeEloAndHistory(valid.map(toMatch)).elo;
  const past = computeEloAndHistory(valid.filter((r) => Date.parse(r.date) <= cutoff).map(toMatch)).elo;
  const prefix = `${league}|`;
  for (const [k, s] of now) {
    const p = past.get(k);
    if (!p || !k.startsWith(prefix)) continue;
    out.set(k.slice(prefix.length), s.elo - p.elo);
  }
  return out;
}

/**
 * Elo 기대 점수(승 1점·무 0.5점 기준 평균 점수). 승리 확률이 아니다.
 * diff = 내 Elo(+홈 이점) - 상대 Elo. elo.ts의 갱신식과 같은 식이다.
 */
export function expectedScore(diff: number): number {
  return 1 / (1 + 10 ** (-diff / 400));
}

// ---------- 국가대표 ----------

export interface NationalEloInput {
  team: string;
  elo: number;
  nMatches: number;
  lastMatchDate: string | null;
}

/**
 * 국가대표 Elo 순위. 원자료(1872년~)에는 소련·서독처럼 지금 없는 팀도 있어, activeDays 안에 경기한 팀만 남긴다.
 * minMatches 미만 팀은 레이팅이 자리 잡지 않아 뺀다(예측에 쓰는 기준 NATIONAL_MIN_MATCHES와 같게 호출한다).
 */
export function rankNationalElo(
  rows: readonly NationalEloInput[],
  nowMs: number,
  opts: { minMatches: number; activeDays: number; limit: number },
): EloRankRow[] {
  const since = nowMs - opts.activeDays * 86400e3;
  const seen = new Set<string>();
  const picked = rows.filter((r) => {
    if (!r.team || seen.has(r.team) || typeof r.elo !== "number" || !Number.isFinite(r.elo)) return false;
    if (!(r.nMatches >= opts.minMatches)) return false;
    const t = r.lastMatchDate ? Date.parse(r.lastMatchDate) : NaN;
    if (!Number.isFinite(t) || t < since) return false;
    seen.add(r.team);
    return true;
  });
  picked.sort((a, b) => b.elo - a.elo || cmpStr(a.team, b.team));
  return picked.slice(0, Math.max(0, opts.limit)).map((r, i) => ({
    rank: i + 1,
    team: r.team,
    elo: r.elo,
    change: null,
    lastMatchDate: r.lastMatchDate,
    matches: r.nMatches,
  }));
}

// ---------- 순위표 vs Elo ----------

export interface RankGap {
  team: string;
  tableRank: number;
  eloRank: number;
  /** tableRank - eloRank. 양수면 Elo가 보는 전력보다 순위표가 낮다(순위 숫자가 크다). */
  gap: number;
  played: number;
}

export interface RankComparison {
  /** 두 순위를 모두 가진 팀 수(둘 다 이 팀들 안에서 1..n으로 다시 매긴다). */
  n: number;
  /** 스피어만 순위 상관계수. 1이면 두 순위가 완전히 같다. n<4면 null. */
  spearman: number | null;
  /** |gap| 큰 순, 같으면 순위표 순. */
  gaps: RankGap[];
}

/**
 * 순위표 순위와 Elo 순위 비교. 두 순위를 같은 팀 집합 안에서 1..n으로 다시 매긴 뒤 비교한다
 * (한쪽에만 있는 팀이 있으면 순위 숫자가 밀려 차이가 부풀려지기 때문).
 * 시즌 초반(최소 경기 수 미달)에는 비교가 잡음이라 null.
 */
export function compareRanks(
  standings: Standings,
  elo: readonly Pick<EloInput, "team" | "elo">[],
  minPlayed = MIN_PLAYED_FOR_COMPARISON,
): RankComparison | null {
  if (standings.rows.length === 0 || standings.rows.some((r) => r.played < minPlayed)) return null;
  const eloOf = new Map<string, number>();
  for (const r of elo) if (typeof r.elo === "number" && Number.isFinite(r.elo) && !eloOf.has(r.team)) eloOf.set(r.team, r.elo);
  const table = standings.rows.filter((r) => eloOf.has(r.team)); // 이미 순위표 순서
  const n = table.length;
  if (n === 0) return null;
  const eloOrder = [...table].sort((a, b) => (eloOf.get(b.team) as number) - (eloOf.get(a.team) as number) || cmpStr(a.team, b.team));
  const eloRank = new Map<string, number>();
  eloOrder.forEach((r, i) => eloRank.set(r.team, i + 1));
  const gaps: RankGap[] = table.map((r, i) => {
    const er = eloRank.get(r.team) as number;
    return { team: r.team, tableRank: i + 1, eloRank: er, gap: i + 1 - er, played: r.played };
  });
  const d2 = gaps.reduce((s, g) => s + g.gap * g.gap, 0);
  const spearman = n >= 4 ? 1 - (6 * d2) / (n * (n * n - 1)) : null;
  gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.tableRank - b.tableRank);
  return { n, spearman, gaps };
}

/** 리그 페이지에 '읽을 만한' 순위 자료가 있는가(색인 판단에 쓴다). */
export function tablesMeaningful(x: { standings: Standings | null; elo: readonly unknown[] } | null | undefined): boolean {
  if (!x) return false;
  return (x.standings?.matches ?? 0) >= MIN_STANDINGS_MATCHES || x.elo.length >= MIN_ELO_TEAMS;
}
