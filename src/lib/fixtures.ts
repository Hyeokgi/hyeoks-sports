// 경기별 분석 페이지(docs/specs/002-match-pages.md) 1단계: 지원 리그의 앞으로 7일 경기를 모아
// 경기마다 예측을 저장한다. 화면은 2단계에서 붙인다.
//
// 왜 회차 예측(round_predictions)과 따로 두나
//   회차는 wisetoto가 정한 14경기뿐이다. 경기 페이지는 지원 리그의 모든 경기가 대상이라
//   회차와 상관없이 FotMob 일정에서 직접 경기를 만든다.
//
// 킥오프 전 예측 보존
//   회차는 prediction_snapshots로 킥오프 전 값을 따로 남긴다. 경기 페이지는 배당을 섞지 않아
//   예측이 바뀌는 계기가 결과 반영(Elo 재계산)뿐이므로, 확률까지 계산해 저장하고 킥오프가
//   지나면 다시 쓰지 않는 것으로 스냅샷을 대신한다(fixture_predictions의 upsert 조건 참고).
//   그래서 모델 가중치가 나중에 바뀌어도 끝난 경기의 "그때 확률"은 변하지 않는다.
import { LEAGUE_IDS, fetchLeagueFixtures, fetchTeamXG, type FotmobFixture, type TeamXG } from "./fotmob";
import { computeEloAndHistory, recentForm, h2hDiff as computeH2hDiff } from "./elo";
import { getAllMatches, getLeagueDrawRate, getK2MatchesWithCorners } from "./db";
import { buildCornersHistory, recentCornersDiff } from "./cornersHistory";
import { predictMatch, DEFAULT_TOGGLES, marketWeightForLeague, FALLBACK_DRAW_RATE } from "./prediction";
import { NATIONAL_MIN_MATCHES } from "./nationalEloStore";
import { nationalKrOf } from "./nationalNames";
import { confidenceTier } from "./calibration";
import { TEAM_ENTRIES } from "./nameMap";
import { missingDisplayNames } from "./teamNames";
import type { Env } from "../types";

/** 킥오프까지 이 기간 안에 든 경기만 만든다(명세 2장: 경기 7일 전부터). */
export const FIXTURE_WINDOW_DAYS = 7;
// D1 batch 한 번에 보낼 문장 수. 경기 하나에 문장이 2개라 한 묶음에 25경기.
const BATCH_CHUNK = 50;

/** FotMob 영문 팀명 → 주소용 조각. 악센트는 떼고(Atlético → atletico) 영문·숫자 밖은 하이픈. */
export function slugifyTeam(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "team";
}

/** UTC ISO → 한국시간 날짜(YYYY-MM-DD). 주소의 날짜는 한국 독자 기준이다. */
export function kstDate(utcIso: string): string | null {
  const t = Date.parse(utcIso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
}

export function fixtureSlug(kstDay: string, homeEn: string, awayEn: string): string {
  return `${kstDay}-${slugifyTeam(homeEn)}-${slugifyTeam(awayEn)}`;
}

/** 이번에 예측을 만들 경기인가: 끝나지도 취소되지도 않았고, 킥오프가 지금 이후 ~ 창 안. */
export function inFixtureWindow(
  f: Pick<FotmobFixture, "utcKickoff" | "finished" | "cancelled">,
  now: number,
  days = FIXTURE_WINDOW_DAYS,
): boolean {
  if (f.finished || f.cancelled || !f.utcKickoff) return false;
  const k = Date.parse(f.utcKickoff);
  return Number.isFinite(k) && k > now && k <= now + days * 86400e3;
}

// 한글 표기는 wisetoto 기준 표(nameMap)를 거꾸로 읽는다. 없으면 null(화면에서 영문명으로 대체).
const KR_BY_EN = new Map<string, string>();
for (const e of TEAM_ENTRIES) {
  const k = `${e.league}|${e.nameEn}`;
  if (!KR_BY_EN.has(k)) KR_BY_EN.set(k, e.nameKr);
}
export function teamKr(league: string, nameEn: string): string | null {
  return KR_BY_EN.get(`${league}|${nameEn}`) ?? null;
}

/**
 * 주소 충돌 해소. 같은 날 같은 대진이 두 번(재경기 등) 나오면 두 번째부터 FotMob 경기 번호를 붙인다.
 * taken: 이미 DB에 있는 (slug → fotmob_id). 같은 fotmob_id면 충돌이 아니다(자기 자신).
 */
export function resolveSlugs(
  wanted: { fotmobId: number; slug: string }[],
  taken: Map<string, number>,
): Map<number, string> {
  const out = new Map<number, string>();
  const used = new Map(taken);
  for (const w of wanted) {
    const owner = used.get(w.slug);
    const slug = owner === undefined || owner === w.fotmobId ? w.slug : `${w.slug}-${w.fotmobId}`;
    used.set(slug, w.fotmobId);
    out.set(w.fotmobId, slug);
  }
  return out;
}

export interface SyncFixturesResult {
  leagues: Record<string, { fetched: number; upcoming: number; finished: number }>;
  statements: number;
  // 경기 페이지에 영문으로 보일 팀(teamNames.ts에 한글 표시명이 없음). 사람이 채워 넣는다.
  missingNames: string[];
}

export async function syncFixtures(env: Env, now = Date.now()): Promise<SyncFixturesResult> {
  const nowIso = new Date(now).toISOString();
  // 회차 등록(createRound.ts)과 같은 방식으로 성분을 계산한다. 두 곳의 계산이 어긋나면 같은
  // 경기가 회차 화면과 경기 페이지에서 다른 확률로 보인다. 계산식을 바꾸면 양쪽을 함께 고친다.
  const history = await getAllMatches(env);
  const { elo, teamHistory, h2h } = computeEloAndHistory(history);
  let cornersHistory: Map<string, number[]> | null = null;
  let k1Xg: Map<string, TeamXG> | null = null;

  const result: SyncFixturesResult = { leagues: {}, statements: 0, missingNames: [] };
  for (const [league, leagueId] of Object.entries(LEAGUE_IDS)) {
    let list: FotmobFixture[] = [];
    try {
      list = await fetchLeagueFixtures(leagueId);
    } catch (e) {
      console.error(`syncFixtures: ${league} 일정 조회 실패(스킵) - ${(e as Error).message}`);
    }
    const upcoming = list.filter((f) => f.id != null && inFixtureWindow(f, now));
    const stmts: D1PreparedStatement[] = [];

    if (upcoming.length > 0) {
      const drawRate = await getLeagueDrawRate(env, league);
      // xG는 K리그1, 코너킥은 K리그2에서만 검증된 성분이다(createRound.ts 주석). 그 리그 경기가 있을 때만 읽는다.
      if (league === "K리그1" && !k1Xg) k1Xg = await fetchTeamXG(leagueId);
      if (league === "K리그2" && !cornersHistory) cornersHistory = buildCornersHistory(await getK2MatchesWithCorners(env));

      const wanted = upcoming.map((f) => ({ fotmobId: f.id as number, slug: fixtureSlug(kstDate(f.utcKickoff as string) as string, f.home, f.away) }));
      const { results: takenRows } = await env.DB.prepare(
        `SELECT slug, fotmob_id FROM fixtures WHERE slug IN (${wanted.map(() => "?").join(",")})`,
      )
        .bind(...wanted.map((w) => w.slug))
        .all<{ slug: string; fotmob_id: number }>();
      const slugs = resolveSlugs(wanted, new Map((takenRows ?? []).map((r) => [r.slug, r.fotmob_id])));

      for (const f of upcoming) {
        const id = f.id as number;
        const homeState = elo.get(`${league}|${f.home}`);
        const awayState = elo.get(`${league}|${f.away}`);
        const eloDiff = (homeState?.elo ?? 1500) - (awayState?.elo ?? 1500);
        const formDiff = recentForm(teamHistory, league, f.home).avgPts - recentForm(teamHistory, league, f.away).avgPts;
        const h = computeH2hDiff(h2h, league, f.home, f.away);
        let xgDiff: number | null = null;
        const hx = league === "K리그1" ? k1Xg?.get(f.home) : undefined;
        const ax = league === "K리그1" ? k1Xg?.get(f.away) : undefined;
        if (hx && ax && hx.matchesPlayed > 0 && ax.matchesPlayed > 0) {
          xgDiff = (hx.xgFor - hx.xgAgainst) / hx.matchesPlayed - (ax.xgFor - ax.xgAgainst) / ax.matchesPlayed;
        }
        const cornersDiff = league === "K리그2" && cornersHistory ? recentCornersDiff(cornersHistory, f.home, f.away) : null;

        const p = predictMatch(
          { eloDiff, formDiff, h2hDiff: h.diff, leagueDrawRate: drawRate, marketOdds: null, xgDiff, cornersDiff, league, marketOnly: false },
          { ...DEFAULT_TOGGLES, marketWeight: marketWeightForLeague(league) },
        );
        const tier = confidenceTier(league, p.confidenceGap);

        stmts.push(
          env.DB.prepare(
            `INSERT INTO fixtures (league, fotmob_id, kickoff_at, home_en, away_en, home_kr, away_kr, slug, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
             ON CONFLICT(fotmob_id) DO UPDATE SET kickoff_at = excluded.kickoff_at, home_kr = excluded.home_kr,
               away_kr = excluded.away_kr, updated_at = excluded.updated_at
             WHERE fixtures.status = 'scheduled'`,
          ).bind(league, id, f.utcKickoff, f.home, f.away, teamKr(league, f.home), teamKr(league, f.away), slugs.get(id) ?? wanted.find((w) => w.fotmobId === id)!.slug, nowIso, nowIso),
        );
        // 킥오프가 지난 경기는 WHERE에서 빠져 다시 쓰지 않는다(킥오프 전 예측 보존).
        stmts.push(
          env.DB.prepare(
            `INSERT INTO fixture_predictions
               (fixture_id, elo_diff, form_diff, h2h_diff, n_h2h, league_draw_rate, xg_diff, corners_diff,
                p_home, p_draw, p_away, pick, basis, confidence_gap, tier, computed_at)
             SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM fixtures WHERE fotmob_id = ? AND kickoff_at > ?
             ON CONFLICT(fixture_id) DO UPDATE SET elo_diff = excluded.elo_diff, form_diff = excluded.form_diff,
               h2h_diff = excluded.h2h_diff, n_h2h = excluded.n_h2h, league_draw_rate = excluded.league_draw_rate,
               xg_diff = excluded.xg_diff, corners_diff = excluded.corners_diff, p_home = excluded.p_home,
               p_draw = excluded.p_draw, p_away = excluded.p_away, pick = excluded.pick, basis = excluded.basis,
               confidence_gap = excluded.confidence_gap, tier = excluded.tier, computed_at = excluded.computed_at`,
          ).bind(
            eloDiff, formDiff, h.diff, h.n, drawRate, xgDiff, cornersDiff,
            p.pHome, p.pDraw, p.pAway, p.rankedPicks[0], p.basis, p.confidenceGap, tier, nowIso,
            id, nowIso,
          ),
        );
      }
    }

    // 결과: 우리 표에 '예정'으로 남아 있고 킥오프가 지난 경기만 채운다(시즌 전체를 매번 쓰지 않게).
    const { results: pending } = await env.DB.prepare(
      "SELECT fotmob_id FROM fixtures WHERE league = ? AND status = 'scheduled' AND kickoff_at <= ?",
    )
      .bind(league, nowIso)
      .all<{ fotmob_id: number }>();
    const pendingIds = new Set((pending ?? []).map((r) => r.fotmob_id));
    const finished = list.filter((f) => f.id != null && pendingIds.has(f.id) && (f.finished || f.cancelled));
    for (const f of finished) {
      stmts.push(
        env.DB.prepare("UPDATE fixtures SET status = ?, hg = ?, ag = ?, updated_at = ? WHERE fotmob_id = ?").bind(
          f.finished ? "finished" : "cancelled",
          f.hg,
          f.ag,
          nowIso,
          f.id,
        ),
      );
    }

    for (let i = 0; i < stmts.length; i += BATCH_CHUNK) await env.DB.batch(stmts.slice(i, i + BATCH_CHUNK));
    result.statements += stmts.length;
    result.leagues[league] = { fetched: list.length, upcoming: upcoming.length, finished: finished.length };
    result.missingNames.push(...missingDisplayNames(upcoming.flatMap((f) => [f.home, f.away])));
  }
  // 국가대표는 부가 기능이다. 실패해도 클럽 리그 결과는 그대로 남긴다.
  try {
    await syncNationalFixtures(env, now, result);
  } catch (e) {
    console.error(`syncFixtures: 국가대표 수집 실패 - ${(e as Error).message}`);
  }
  return result;
}

// ---------- 국가대표 ----------
// 휴식기(A매치 기간)에도 경기 분석이 비지 않게, 국가대표 경기를 같은 표에 넣는다(league = "국가대표").
// 확률은 승무패 회차의 국가대표 경기와 같은 경로(predictMatch의 marketOnly + nationalEloDiff)로 계산한다.
export const NATIONAL_LEAGUE = "국가대표";
// FotMob 대회 번호 → 한글 대회명. 2026-09-27 실측으로 이번 주 경기가 있는 대회만 넣었다.
export const NATIONAL_COMPETITIONS: Record<string, string> = {
  "9806": "UEFA 네이션스리그 A",
  "9807": "UEFA 네이션스리그 B",
  "9808": "UEFA 네이션스리그 C",
  "9809": "UEFA 네이션스리그 D",
  "9821": "CONCACAF 네이션스리그",
  "114": "A매치 친선",
};
// FotMob 영문 국가명 → 국가대표 Elo 원자료(martj42/international_results) 표기. 나머지는 같은 이름.
const FOTMOB_TO_RESULTS: Record<string, string> = {
  Turkiye: "Turkey",
  "Türkiye": "Turkey",
  Ireland: "Republic of Ireland",
  Czechia: "Czech Republic",
  USA: "United States",
  "Korea Republic": "South Korea",
  "Korea DPR": "North Korea",
  "Côte d'Ivoire": "Ivory Coast",
  "IR Iran": "Iran",
  "China PR": "China",
};
export function nationalResultsName(fotmobName: string): string {
  return FOTMOB_TO_RESULTS[fotmobName] ?? fotmobName;
}

async function syncNationalFixtures(env: Env, now: number, result: SyncFixturesResult): Promise<void> {
  const nowIso = new Date(now).toISOString();
  type Cand = { f: FotmobFixture; comp: string; he: string; ae: string; hk: string; ak: string };
  const cands: Cand[] = [];
  const lists: FotmobFixture[] = [];
  let fetched = 0;
  for (const [compId, compName] of Object.entries(NATIONAL_COMPETITIONS)) {
    let list: FotmobFixture[] = [];
    try {
      list = await fetchLeagueFixtures(compId);
    } catch (e) {
      console.error(`syncFixtures: ${compName} 일정 조회 실패(스킵) - ${(e as Error).message}`);
    }
    fetched += list.length;
    lists.push(...list);
    for (const f of list) {
      if (f.id == null || !inFixtureWindow(f, now)) continue;
      const he = nationalResultsName(f.home);
      const ae = nationalResultsName(f.away);
      const hk = nationalKrOf(he);
      const ak = nationalKrOf(ae);
      // 한글 이름이 없는 나라(주로 소국)는 검색 수요도 작고 이름을 추측할 수 없어 만들지 않는다.
      if (!hk || !ak) continue;
      cands.push({ f, comp: compName, he, ae, hk, ak });
    }
  }

  const stmts: D1PreparedStatement[] = [];
  let made = 0;
  if (cands.length > 0) {
    const names = [...new Set(cands.flatMap((c) => [c.he, c.ae]))];
    const { results: eloRows } = await env.DB.prepare(
      `SELECT team_en, elo, n_matches FROM national_elo WHERE team_en IN (${names.map(() => "?").join(",")})`,
    )
      .bind(...names)
      .all<{ team_en: string; elo: number; n_matches: number }>();
    // 레이팅이 자리 잡지 않은 팀(경기 수 적음)은 쓰지 않는다(회차와 같은 기준).
    const elo = new Map((eloRows ?? []).filter((r) => r.n_matches >= NATIONAL_MIN_MATCHES).map((r) => [r.team_en, r.elo]));
    const ready = cands.filter((c) => elo.has(c.he) && elo.has(c.ae));
    if (ready.length > 0) {
      const wanted = ready.map((c) => ({ fotmobId: c.f.id as number, slug: fixtureSlug(kstDate(c.f.utcKickoff as string) as string, c.he, c.ae) }));
      const { results: takenRows } = await env.DB.prepare(
        `SELECT slug, fotmob_id FROM fixtures WHERE slug IN (${wanted.map(() => "?").join(",")})`,
      )
        .bind(...wanted.map((w) => w.slug))
        .all<{ slug: string; fotmob_id: number }>();
      const slugs = resolveSlugs(wanted, new Map((takenRows ?? []).map((r) => [r.slug, r.fotmob_id])));
      for (const c of ready) {
        const id = c.f.id as number;
        const diff = (elo.get(c.he) as number) - (elo.get(c.ae) as number);
        const p = predictMatch(
          { eloDiff: 0, formDiff: 0, h2hDiff: 0, leagueDrawRate: FALLBACK_DRAW_RATE, marketOdds: null, league: "U네이션", marketOnly: true, nationalEloDiff: diff },
          DEFAULT_TOGGLES,
        );
        stmts.push(
          env.DB.prepare(
            `INSERT INTO fixtures (league, competition, fotmob_id, kickoff_at, home_en, away_en, home_kr, away_kr, slug, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
             ON CONFLICT(fotmob_id) DO UPDATE SET kickoff_at = excluded.kickoff_at, competition = excluded.competition,
               home_kr = excluded.home_kr, away_kr = excluded.away_kr, updated_at = excluded.updated_at
             WHERE fixtures.status = 'scheduled'`,
          ).bind(NATIONAL_LEAGUE, c.comp, id, c.f.utcKickoff, c.he, c.ae, c.hk, c.ak, slugs.get(id) as string, nowIso, nowIso),
        );
        // elo_diff에는 국가대표 Elo 격차(홈 이점 제외)를 넣는다. 폼·맞대결은 쓰지 않는다.
        stmts.push(
          env.DB.prepare(
            `INSERT INTO fixture_predictions
               (fixture_id, elo_diff, form_diff, h2h_diff, n_h2h, league_draw_rate, xg_diff, corners_diff,
                p_home, p_draw, p_away, pick, basis, confidence_gap, tier, computed_at)
             SELECT id, ?, 0, 0, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, ? FROM fixtures WHERE fotmob_id = ? AND kickoff_at > ?
             ON CONFLICT(fixture_id) DO UPDATE SET elo_diff = excluded.elo_diff, p_home = excluded.p_home, p_draw = excluded.p_draw,
               p_away = excluded.p_away, pick = excluded.pick, basis = excluded.basis, confidence_gap = excluded.confidence_gap,
               computed_at = excluded.computed_at`,
          ).bind(diff, FALLBACK_DRAW_RATE, p.pHome, p.pDraw, p.pAway, p.rankedPicks[0], p.basis, p.confidenceGap, nowIso, id, nowIso),
        );
        made++;
      }
    }
  }

  const { results: pending } = await env.DB.prepare(
    "SELECT fotmob_id FROM fixtures WHERE league = ? AND status = 'scheduled' AND kickoff_at <= ?",
  )
    .bind(NATIONAL_LEAGUE, nowIso)
    .all<{ fotmob_id: number }>();
  const pendingIds = new Set((pending ?? []).map((r) => r.fotmob_id));
  const finished = lists.filter((f) => f.id != null && pendingIds.has(f.id) && (f.finished || f.cancelled));
  for (const f of finished) {
    stmts.push(
      env.DB.prepare("UPDATE fixtures SET status = ?, hg = ?, ag = ?, updated_at = ? WHERE fotmob_id = ?").bind(
        f.finished ? "finished" : "cancelled", f.hg, f.ag, nowIso, f.id,
      ),
    );
  }
  for (let i = 0; i < stmts.length; i += BATCH_CHUNK) await env.DB.batch(stmts.slice(i, i + BATCH_CHUNK));
  result.statements += stmts.length;
  result.leagues[NATIONAL_LEAGUE] = { fetched, upcoming: made, finished: finished.length };
}

export interface FixtureListRow {
  id: number;
  league: string;
  competition: string | null;
  kickoff_at: string;
  home_en: string;
  away_en: string;
  home_kr: string | null;
  away_kr: string | null;
  slug: string;
  status: string;
  hg: number | null;
  ag: number | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  pick: string | null;
  basis: string | null;
  confidence_gap: number | null;
  tier: string | null;
  computed_at: string | null;
}

/** 확인용 목록(관리자 API). 2단계 화면도 이 모양을 쓴다. */
export async function listFixtures(env: Env, fromIso: string, toIso: string): Promise<FixtureListRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.league, f.competition, f.kickoff_at, f.home_en, f.away_en, f.home_kr, f.away_kr, f.slug, f.status, f.hg, f.ag,
            p.p_home, p.p_draw, p.p_away, p.pick, p.basis, p.confidence_gap, p.tier, p.computed_at
       FROM fixtures f LEFT JOIN fixture_predictions p ON p.fixture_id = f.id
      WHERE f.kickoff_at >= ? AND f.kickoff_at <= ?
      ORDER BY f.kickoff_at ASC, f.id ASC`,
  )
    .bind(fromIso, toIso)
    .all<FixtureListRow>();
  return results ?? [];
}
