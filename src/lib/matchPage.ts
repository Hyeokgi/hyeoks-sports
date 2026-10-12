// 경기별 분석 페이지(docs/specs/002-match-pages.md, 004 5·6·10장)
//   /match/{slug}, /match/{slug}/data.json, /league/{slug}, /matches, /api/matches, 사이트맵 항목
//
// 원칙
// - 베팅 추천 페이지가 아니다. 단식·복식·조합·배당 추천 같은 말을 쓰지 않는다(테스트로 막는다).
// - 표시 확률·basis·확률 기준 시각·원천(provenance)·근거 문장은 resolveMatches() 한 곳에서 함께 정한다.
//   상세·리그·허브·앱 목록(/api/matches)·data.json·사이트맵이 모두 이 함수를 쓴다. 예전에는 상세만 회차 확률로
//   덮어쓰고 허브는 fixture 확률을 그대로 보여 같은 경기가 화면마다 다른 숫자였다(004 2장 4번).
// - 회차 확률을 보여줄 때 fixture(경기 일정 모델) 성분으로 근거를 쓰지 않는다. 실제 계산에 쓰인 회차 입력으로만
//   근거를 만들고, fixture 성분은 '경기 데이터 맥락(참고)'으로 분리해 출처·시각을 따로 단다.
// - 킥오프가 지난 경기는 '킥오프 전에 저장됐음이 시각으로 검증된' 확률만 보여준다. 검증이 안 되면 확률을 숨긴다.
// - 입력이 부족한 페이지는 noindex로 두고 사이트맵에서도 뺀다. 판정은 matchContentReadiness 하나로 한다.
//   결과와 킥오프 전 저장 확률이 함께 있는 끝난 경기는 유용한 기록이라 색인을 유지한다(자동 페이지 일괄 noindex 금지).
// - 광고 스크립트·스폰서 모집 칸을 두지 않는다(004 10장: 광고 기본 꺼짐, 계약 없는 스폰서 자리는 숨김).
import { buildRoundPredictions, type MatchWithPrediction } from "./predictRound";
import { getPredictionSnapshots, type PredictionSnapshot } from "./predictionSnapshot";
import { analyzeMatch, type MatchDetail } from "./matchAnalysis";
import { TEAM_LOGOS } from "./teamLogos";
import { teamKr, NATIONAL_LEAGUE } from "./fixtures";
import { nationalProbs, NATIONAL_HOME_ADV } from "./nationalElo";
import { NATIONAL_FLAG_CODE, nationalTeamEn } from "./nationalNames";
import { displayTeamName, leagueInfo, leagueBySlug, LEAGUE_INFO, type LeagueInfo } from "./teamNames";
import { DISCLAIMER, escapeHtml as e } from "./roundArticle";
import { FALLBACK_DRAW_RATE, type PredictionBasis } from "./prediction";
import type { Env } from "../types";
import { siteHeader as publicHeader, siteFooter as publicFooter, fullKst } from "./publicSite";
import { K_FACTOR, SEASON_REGRESSION } from "./elo";
import { STANDINGS_LABEL, TIEBREAK_NOTE, tablesMeaningful, expectedScore, MIN_ELO_TEAMS, type FormMark } from "./leagueTables";
import {
  loadLeagueTables,
  loadRatingsOverview,
  tableTeamName,
  STANDINGS_LEAGUE_NOTES,
  NATIONAL_ACTIVE_DAYS,
  type LeagueTablesView,
} from "./leagueTablesStore";
import { NATIONAL_MIN_MATCHES } from "./nationalEloStore";

// 대표 주소는 요청 주소와 상관없이 고정한다(옛 workers.dev 주소로 들어와도 canonical·사이트맵은 hyeoks.com).
export const SITE = "https://hyeoks.com";
export const CONTACT_EMAIL = "hyeoks.data@gmail.com";
const OUT = ["홈승", "무승부", "원정승"] as const;
export type Outcome = (typeof OUT)[number];

/** 세 확률 합의 허용 오차. 저장값은 계산값 그대로라 부동소수 오차 수준이지만 반올림 저장까지 감안해 0.1%p로 둔다. */
export const PROB_SUM_TOLERANCE = 1e-3;
const GROUNDED_BASES: readonly PredictionBasis[] = ["model", "market", "national"];
// D1은 쿼리당 바인딩 변수 100개 제한이 있다. IN 목록은 이보다 작게 나눠 읽는다.
const ID_CHUNK = 90;

// fixtures LEFT JOIN fixture_predictions: 예측이 아직 없는 경기도 '확률 준비 중'으로 읽는다(004 5장).
export interface MatchRow {
  id: number;
  league: string;
  fotmob_id: number;
  kickoff_at: string;
  home_en: string;
  away_en: string;
  home_kr: string | null;
  away_kr: string | null;
  competition: string | null;
  slug: string;
  status: string;
  hg: number | null;
  ag: number | null;
  updated_at: string;
  elo_diff: number | null;
  form_diff: number | null;
  h2h_diff: number | null;
  n_h2h: number | null;
  league_draw_rate: number | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  pick: string | null;
  basis: string | null;
  confidence_gap: number | null;
  tier: string | null;
  computed_at: string | null;
}

/**
 * 확률 원천(004 6장 provenance.kind).
 * - pre_kickoff_snapshot: 회차 prediction_snapshots. captured_at(과 원본 computed_at)이 킥오프 전으로 검증됨
 * - pre_kickoff_fixture: fixture_predictions. computed_at이 킥오프 전으로 검증됨
 * - current_estimate: 킥오프 전 경기의 현재 계산(회차 또는 경기 일정 모델)
 * - unavailable: 없음 또는 시점 검증 불가. 0%가 아니라 '표시하지 않음'이다
 */
export type ProvenanceKind = "pre_kickoff_snapshot" | "pre_kickoff_fixture" | "current_estimate" | "unavailable";
export interface Provenance {
  kind: ProvenanceKind;
  source: "round" | "fixture" | null;
  /** 이 확률의 기준 시각(스냅샷 저장 시각, fixture 계산 시각, 회차 입력 최종 갱신 시각). */
  capturedAt: string | null;
}

export interface ProbabilityCandidate {
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: Outcome;
  confidenceGap: number;
  basis: PredictionBasis;
  /** 배당이 확률에 들어갔는가(model 혼합 또는 market). basis와 별개로 표시한다. */
  withMarket: boolean;
  nBookmakers: number | null;
  asOf: string | null;
}
export interface SnapshotCandidate extends ProbabilityCandidate {
  /** 회차 예측 원본 성분(round_predictions.computed_at). 있으면 이것도 킥오프 전이어야 한다. */
  rawComputedAt: string | null;
}

export interface SelectInput {
  now: number;
  kickoffAt: string;
  roundKickoffAt?: string | null;
  fixture: ProbabilityCandidate | null;
  roundCurrent?: ProbabilityCandidate | null;
  roundSnapshot?: SnapshotCandidate | null;
}
export interface Selection {
  probability: ProbabilityCandidate | null;
  provenance: Provenance;
}

/** 회차 확률을 보여줄 때 fixture 성분을 '계산 근거'로 쓰지 않고 따로 붙이는 참고 자료. */
export interface FixtureContext {
  asOf: string | null;
  pHome: number;
  pDraw: number;
  pAway: number;
  basisLabel: string;
  lines: string[];
}

export interface ResolvedMatch {
  fixtureId: number;
  probability: ProbabilityCandidate | null;
  provenance: Provenance;
  round: { roundNo: number; seq: number } | null;
  reasons: string[];
  risks: string[];
  explanationNote: string | null;
  context: FixtureContext | null;
  calib: { accuracy: number; n: number } | null;
}

export interface MatchView {
  slug: string;
  league: string;
  competition: string | null;
  leagueName: string;
  leagueSlug: string;
  kickoffAt: string;
  home: string;
  away: string;
  homeLogo: string | null;
  awayLogo: string | null;
  // 확률이 없으면(provenance.kind = unavailable) 아래 숫자는 0이고 basis는 null이다. 화면은 숫자를 숨긴다.
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: Outcome;
  confidenceGap: number;
  basis: PredictionBasis | null;
  basisLabel: string;
  withMarket: boolean;
  nBookmakers: number | null;
  source: "fixture" | "round" | null;
  provenance: Provenance;
  probabilityAsOf: string | null;
  round: { roundNo: number; seq: number } | null;
  status: string;
  result: { hg: number; ag: number; actual: Outcome } | null;
  reasons: string[];
  risks: string[];
  explanationNote: string | null;
  context: FixtureContext | null;
  calib: { accuracy: number; n: number } | null;
  siblings: SiblingView[];
}

export interface SiblingView {
  slug: string;
  league?: string;
  kickoffAt: string;
  home: string;
  away: string;
  // 확률이 없으면 null(킥오프 전 저장 확률 검증 실패 또는 계산 전).
  pHome: number | null;
  pDraw: number | null;
  pAway: number | null;
  pick: Outcome | null;
  status: string;
  hg: number | null;
  ag: number | null;
  basis?: PredictionBasis | null;
  basisLabel?: string;
  withMarket?: boolean;
  source?: "fixture" | "round" | null;
  provenance?: Provenance;
  /** = provenance.capturedAt. 홈 카드의 '확률 계산 시각' 표시용. */
  asOf?: string | null;
  round?: { roundNo: number; seq: number } | null;
  /** matchContentReadiness 결과. 리그·허브 색인 판단과 사이트맵에 쓴다. */
  ready?: boolean;
}

// ---------- 표기 ----------
const pct = (x: number) => `${Math.round(x * 100)}%`;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export function kstLabel(iso: string, withTime = true): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const k = new Date(t + 9 * 3600e3);
  const d = `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일(${DOW[k.getUTCDay()]})`;
  return withTime ? `${d} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}` : d;
}
const outcomeOf = (hg: number, ag: number): Outcome => (hg > ag ? "홈승" : hg === ag ? "무승부" : "원정승");
const whoWins = (o: Outcome, home: string, away: string) => (o === "홈승" ? `${home} 승` : o === "원정승" ? `${away} 승` : "무승부");
const ts = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);
function latestIso(...xs: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bt = -Infinity;
  for (const x of xs) {
    const t = ts(x);
    if (x && Number.isFinite(t) && t > bt) {
      best = x;
      bt = t;
    }
  }
  return best;
}

/** basis + 배당 혼합 여부 → 사람용 이름. 팀 종류로 추정하지 않고 실제 basis만 본다. */
export function basisLabelOf(basis: PredictionBasis | null | undefined, withMarket: boolean): string {
  if (basis === "model") return withMarket ? "통계 모델 + 해외 배당" : "통계 모델";
  if (basis === "market") return "해외 배당";
  if (basis === "national") return "국가대표 Elo";
  return "확률 없음";
}

/** 검색용 태그(페이지 하단 노출 + 메타 keywords). 사람들이 실제로 치는 형태 위주로 6~8개. */
export function matchTags(v: Pick<MatchView, "home" | "away" | "leagueName" | "league" | "kickoffAt">): string[] {
  const aliases = LEAGUE_INFO[v.league]?.aliases ?? [];
  const day = kstLabel(v.kickoffAt, false).replace(/\(.\)/, "");
  return [
    ...new Set([
      `${v.home} ${v.away} 승부예측`,
      `${v.home} vs ${v.away}`,
      `${v.home} ${v.away} 경기 분석`,
      `${v.leagueName} 승부예측`,
      `${v.leagueName} ${day} 경기`,
      `${v.home} 경기 일정`,
      `${v.away} 경기 일정`,
      ...aliases.slice(0, 1).map((a) => `${a} 경기 분석`),
    ]),
  ];
}

/** 한 줄 요약. 베팅 용어 없이 확률과 확률 차의 크기만 말한다. */
export function neutralSummary(v: Pick<MatchView, "home" | "away" | "pHome" | "pDraw" | "pAway" | "pick" | "confidenceGap">): string {
  const p = v.pick === "홈승" ? v.pHome : v.pick === "원정승" ? v.pAway : v.pDraw;
  const gap = v.confidenceGap * 100;
  const shape = gap >= 20 ? "한쪽으로 뚜렷한 편입니다" : gap >= 10 ? "다소 기운 편입니다" : gap >= 5 ? "비교적 팽팽합니다" : "세 결과가 모두 열려 있는 박빙입니다";
  return `${whoWins(v.pick, v.home, v.away)} 확률이 ${pct(p)}로 가장 높고, 1·2위 확률 차는 ${gap.toFixed(1)}%p로 ${shape}.`;
}

// ---------- 확률 원천 선택(순수 함수, 테스트 대상) ----------
/** 근거 있는 확률인가: basis가 model/market/national, 세 값이 0~1의 유한수이고 합이 1(허용 오차 안). */
export function isGroundedProbability(p: Pick<ProbabilityCandidate, "pHome" | "pDraw" | "pAway" | "basis"> | null | undefined): boolean {
  if (!p || !GROUNDED_BASES.includes(p.basis)) return false;
  const xs = [p.pHome, p.pDraw, p.pAway];
  if (!xs.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1)) return false;
  return Math.abs(xs[0] + xs[1] + xs[2] - 1) <= PROB_SUM_TOLERANCE;
}

const UNAVAILABLE: Selection = { probability: null, provenance: { kind: "unavailable", source: null, capturedAt: null } };
const plain = (c: ProbabilityCandidate): ProbabilityCandidate => ({
  pHome: c.pHome, pDraw: c.pDraw, pAway: c.pAway, pick: c.pick, confidenceGap: c.confidenceGap,
  basis: c.basis, withMarket: c.withMarket, nBookmakers: c.nBookmakers, asOf: c.asOf,
});

/**
 * 한 경기의 표시 확률을 고른다. 규칙(004 6장)
 * - 킥오프 전: 회차 현재 계산(basis none 제외) → fixture 현재 계산 → 없음. 원천의 basis·시각을 그대로 유지한다.
 * - 킥오프 후: 회차 스냅샷(저장 시각과 원본 computed_at이 모두 유효한 킥오프보다 앞설 때만)
 *   → fixture(계산 시각이 킥오프 전일 때만) → 없음. 현재 재계산값을 지난 경기 확률로 쓰지 않는다.
 * - '유효한 킥오프'는 fixture 시각과 회차 시각 중 이른 쪽(둘 다 파싱될 때). 연기 등으로 어긋나면 보수적으로 판단한다.
 */
export function selectProbability(x: SelectInput): Selection {
  const kick = ts(x.kickoffAt);
  const started = Number.isFinite(kick) && kick <= x.now;
  const fixture = x.fixture && isGroundedProbability(x.fixture) ? x.fixture : null;
  if (!started) {
    const rc = x.roundCurrent;
    if (rc && isGroundedProbability(rc)) return { probability: plain(rc), provenance: { kind: "current_estimate", source: "round", capturedAt: rc.asOf } };
    if (fixture) return { probability: plain(fixture), provenance: { kind: "current_estimate", source: "fixture", capturedAt: fixture.asOf } };
    return UNAVAILABLE;
  }
  const rk = ts(x.roundKickoffAt);
  const limit = Number.isFinite(rk) ? Math.min(kick, rk) : kick;
  const s = x.roundSnapshot;
  if (s && isGroundedProbability(s)) {
    const cap = ts(s.asOf);
    const rawOk = s.rawComputedAt == null || (Number.isFinite(ts(s.rawComputedAt)) && ts(s.rawComputedAt) < limit);
    if (Number.isFinite(cap) && cap < limit && rawOk) {
      return { probability: plain(s), provenance: { kind: "pre_kickoff_snapshot", source: "round", capturedAt: s.asOf } };
    }
  }
  if (fixture) {
    const c = ts(fixture.asOf);
    if (Number.isFinite(c) && c < kick) return { probability: plain(fixture), provenance: { kind: "pre_kickoff_fixture", source: "fixture", capturedAt: fixture.asOf } };
  }
  return UNAVAILABLE;
}

// ---------- 콘텐츠 준비 판정(색인·사이트맵 공용) ----------
export type ReadinessGap = "teams" | "kickoff" | "cancelled" | "probability" | "provenance" | "content";
export interface ReadinessInput {
  home: string;
  away: string;
  kickoffAt: string;
  status: string;
  result: { hg: number; ag: number } | null;
  probability: Pick<ProbabilityCandidate, "pHome" | "pDraw" | "pAway" | "basis"> | null;
  provenanceKind: ProvenanceKind;
  /** 근거 문장 + 경기 데이터 맥락 문장 수. 숫자만 있고 설명이 없는 예정 경기를 걸러낸다. */
  explanationCount: number;
}
export interface Readiness {
  ready: boolean;
  gaps: ReadinessGap[];
}
const PLACEHOLDER_TEAM = /^(?:tbd|tba|미정|추후\s*결정|\?+|-+)$/i;
const validTeam = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t.length > 0 && !PLACEHOLDER_TEAM.test(t);
};

/**
 * 경기 페이지를 검색에 내보낼 만한가. 하나라도 빠지면 noindex + 사이트맵 제외.
 * - 팀: 두 팀 이름이 있고 서로 다르며 '미정' 같은 자리표시가 아님
 * - 시각: 파싱 가능한 킥오프(2000~2100년)
 * - 취소 경기 아님
 * - 확률: 근거 있는 basis + 유한한 0~1 값 + 합 1, 그리고 원천 시점이 검증됨(unavailable 아님)
 * - 내용: 끝난 경기는 스코어가 있어야 하고, 그 외에는 근거·맥락 문장이 1개 이상
 */
export function matchContentReadiness(x: ReadinessInput): Readiness {
  const gaps: ReadinessGap[] = [];
  if (!validTeam(x.home) || !validTeam(x.away) || x.home.trim() === x.away.trim()) gaps.push("teams");
  const k = ts(x.kickoffAt);
  const y = Number.isFinite(k) ? new Date(k).getUTCFullYear() : NaN;
  if (!(y >= 2000 && y <= 2100)) gaps.push("kickoff");
  if (x.status === "cancelled") gaps.push("cancelled");
  if (!isGroundedProbability(x.probability)) gaps.push("probability");
  if (x.provenanceKind === "unavailable") gaps.push("provenance");
  const scoreOk = !!x.result && Number.isInteger(x.result.hg) && Number.isInteger(x.result.ag) && x.result.hg >= 0 && x.result.ag >= 0;
  if (x.status === "finished" ? !scoreOk : x.explanationCount <= 0) gaps.push("content");
  return { ready: gaps.length === 0, gaps };
}

export function matchReadiness(v: MatchView): Readiness {
  return matchContentReadiness({
    home: v.home, away: v.away, kickoffAt: v.kickoffAt, status: v.status, result: v.result,
    probability: v.provenance.kind === "unavailable" || !v.basis ? null : { pHome: v.pHome, pDraw: v.pDraw, pAway: v.pAway, basis: v.basis },
    provenanceKind: v.provenance.kind,
    explanationCount: v.reasons.length + (v.context?.lines.length ?? 0),
  });
}
export const matchIndexable = (v: MatchView): boolean => matchReadiness(v).ready;

// ---------- 불러오기 ----------
const MATCH_SELECT = `SELECT f.id, f.league, f.fotmob_id, f.kickoff_at, f.home_en, f.away_en, f.home_kr, f.away_kr, f.competition, f.slug, f.status, f.hg, f.ag, f.updated_at,
  p.elo_diff, p.form_diff, p.h2h_diff, p.n_h2h, p.league_draw_rate, p.p_home, p.p_draw, p.p_away, p.pick, p.basis,
  p.confidence_gap, p.tier, p.computed_at
  FROM fixtures f LEFT JOIN fixture_predictions p ON p.fixture_id = f.id`;

// 국가대표는 수집할 때 한글 국가명을 home_kr에 넣는다. 클럽의 home_kr은 토토 표기(잘림)라 쓰지 않는다.
const nameOf = (r: Pick<MatchRow, "league" | "home_en" | "away_en" | "home_kr" | "away_kr">, side: "home" | "away") =>
  r.league === NATIONAL_LEAGUE ? (side === "home" ? r.home_kr : r.away_kr) ?? (side === "home" ? r.home_en : r.away_en) : displayTeamName(side === "home" ? r.home_en : r.away_en);
const flagOf = (en: string) => (NATIONAL_FLAG_CODE[en] ? `/flags/${NATIONAL_FLAG_CODE[en]}.svg` : null);
const resultOf = (r: Pick<MatchRow, "status" | "hg" | "ag">) =>
  r.status === "finished" && r.hg != null && r.ag != null ? { hg: r.hg, ag: r.ag, actual: outcomeOf(r.hg, r.ag) } : null;
// 분석 문장은 회차 글용이라 '이번 회차 평균'이라고 쓴다. 경기 페이지에서는 리그 평균(리그 무승부율)이다.
const fix = (s: string) => s.replace("이번 회차 평균", "리그 평균");
const argmaxOutcome = (h: number, d: number, a: number): Outcome => (h >= d && h >= a ? "홈승" : d >= a ? "무승부" : "원정승");
function chunks<T>(xs: T[], n = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function fixtureCandidate(r: MatchRow): ProbabilityCandidate | null {
  if (r.p_home == null || r.p_draw == null || r.p_away == null) return null;
  const pick = (OUT as readonly string[]).includes(r.pick ?? "") ? (r.pick as Outcome) : argmaxOutcome(r.p_home, r.p_draw, r.p_away);
  const sorted = [r.p_home, r.p_draw, r.p_away].sort((a, b) => b - a);
  return {
    pHome: r.p_home, pDraw: r.p_draw, pAway: r.p_away, pick,
    confidenceGap: r.confidence_gap ?? sorted[0] - sorted[1],
    basis: (r.basis ?? "none") as PredictionBasis, withMarket: false, nBookmakers: null, asOf: r.computed_at,
  };
}

function roundCandidate(p: MatchWithPrediction, meta: RoundMeta | undefined): ProbabilityCandidate {
  const q = p.prediction;
  return {
    pHome: q.pHome, pDraw: q.pDraw, pAway: q.pAway, pick: q.rankedPicks[0] as Outcome, confidenceGap: q.confidenceGap,
    basis: q.basis, withMarket: !!p.raw.market && q.basis !== "national", nBookmakers: p.raw.market?.nBookmakers ?? null,
    // 회차 확률은 요청 때 저장된 입력으로 다시 계산한다. 기준 시각 = 입력(성분·배당)의 최종 갱신 시각.
    asOf: latestIso(meta?.computedAt, meta?.marketAt),
  };
}

function snapshotCandidate(s: PredictionSnapshot, meta: RoundMeta | undefined): SnapshotCandidate {
  const q = s.prediction;
  return {
    pHome: q.pHome, pDraw: q.pDraw, pAway: q.pAway, pick: q.rankedPicks[0] as Outcome, confidenceGap: q.confidenceGap,
    basis: q.basis, withMarket: (s.nBookmakers ?? 0) > 0, nBookmakers: s.nBookmakers, asOf: s.capturedAt,
    rawComputedAt: meta?.computedAt ?? null,
  };
}

/** fixture 성분(경기 일정 모델). 국가대표는 elo_diff 자리에 국가대표 Elo 격차가 들어 있다. */
function fixtureDetail(r: MatchRow): MatchDetail {
  const elo = r.elo_diff;
  if (r.league === NATIONAL_LEAGUE) {
    return {
      eloDiff: null, formDiff: null, h2hDiff: null, nH2h: 0, natEloDiff: elo,
      natProbs: elo != null ? nationalProbs(elo + NATIONAL_HOME_ADV) : null, market: null, marketOpen: null, modelOnly: null, calib: null,
    };
  }
  return {
    eloDiff: elo, formDiff: r.form_diff, h2hDiff: r.h2h_diff, nH2h: r.n_h2h ?? 0,
    natEloDiff: null, natProbs: null, market: null, marketOpen: null, modelOnly: null, calib: null,
  };
}

/** 회차 계산에 실제로 쓰인 성분(round_predictions + market_odds). roundPage.buildDetail과 같은 기준. */
function roundDetail(p: MatchWithPrediction): MatchDetail {
  const isModel = p.prediction.basis === "model";
  const nat = p.raw.nationalEloDiff;
  return {
    eloDiff: isModel ? p.raw.eloDiff : null,
    formDiff: isModel ? p.raw.formDiff : null,
    h2hDiff: isModel ? p.raw.h2hDiff : null,
    nH2h: isModel ? p.raw.nH2h : 0,
    natEloDiff: nat,
    natProbs: nat != null ? nationalProbs(nat + NATIONAL_HOME_ADV) : null,
    market: p.raw.market ? { pHome: p.raw.market.pHome, pDraw: p.raw.market.pDraw, pAway: p.raw.market.pAway, n: p.raw.market.nBookmakers } : null,
    marketOpen: null,
    modelOnly: null,
    calib: null, // 과거 적중률은 요약 칸에 한 번만 쓴다(중복 방지)
  };
}

function analyze(names: { home: string; away: string }, p: ProbabilityCandidate, detail: MatchDetail | null, avgDraw: number) {
  const a = analyzeMatch(
    {
      home: names.home, away: names.away, pHome: p.pHome, pDraw: p.pDraw, pAway: p.pAway, pick: p.pick,
      confidenceGap: p.confidenceGap, basis: p.basis, vote: null, detail,
    },
    { avgDraw: Number.isFinite(avgDraw) ? avgDraw : FALLBACK_DRAW_RATE },
  );
  return { reasons: a.reasons.map(fix), risks: a.risks.map(fix) };
}

const SNAPSHOT_NOTE = "이 확률은 킥오프 전에 저장한 값만 남아 있습니다. 당시 세부 입력은 보존되지 않아 근거를 복원하지 않습니다.";
const UNAVAILABLE_NOTE = "킥오프 전에 저장됐음을 확인할 수 있는 확률이 없어 확률과 근거를 표시하지 않습니다.";

interface RoundRef {
  roundId: number;
  roundNo: number;
  matchId: number;
  seq: number;
  league: string;
  hk: string;
  ak: string;
  kickoffAt: string;
}
interface RoundMeta {
  computedAt: string | null;
  marketAt: string | null;
}

/** 경기 ↔ 승무패 회차 경기 연결(한 번의 범위 조회). 같은 경기가 여러 회차에 있으면 최신 회차를 쓴다. */
async function linkRounds(env: Env, rows: MatchRow[]): Promise<Map<number, RoundRef>> {
  const out = new Map<number, RoundRef>();
  const times = rows.map((r) => ts(r.kickoff_at)).filter((t) => Number.isFinite(t));
  if (times.length === 0) return out;
  const from = new Date(Math.min(...times) - 86400e3).toISOString();
  const to = new Date(Math.max(...times) + 86400e3).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT r.id AS roundId, r.round_no AS roundNo, rm.id AS matchId, rm.seq AS seq, rm.league AS league, rm.home_kr AS hk, rm.away_kr AS ak, rm.kickoff_at AS kickoffAt
       FROM round_matches rm JOIN rounds r ON r.id = rm.round_id
      WHERE r.round_no IS NOT NULL AND r.round_no_confirmed = 1 AND rm.kickoff_at >= ? AND rm.kickoff_at <= ?
      ORDER BY r.id ASC LIMIT 2000`,
  )
    .bind(from, to)
    .all<RoundRef>();
  // 클럽은 토토 표기(nameMap 역참조)로, 국가대표는 영문(결과 데이터셋 표기)으로 맞춘다. 뒤(최신 회차)가 앞을 덮는다.
  const byKey = new Map<string, RoundRef>();
  for (const x of results ?? []) {
    if (!x.kickoffAt) continue;
    const d = x.kickoffAt.slice(0, 10);
    byKey.set(`${x.league}|${x.hk}|${x.ak}|${d}`, x);
    const he = nationalTeamEn(x.hk);
    const ae = nationalTeamEn(x.ak);
    if (he && ae) byKey.set(`nat|${he}|${ae}|${d}`, x);
  }
  for (const r of rows) {
    const d = (r.kickoff_at ?? "").slice(0, 10);
    const key = r.league === NATIONAL_LEAGUE
      ? `nat|${r.home_en}|${r.away_en}|${d}`
      : `${r.league}|${teamKr(r.league, r.home_en) ?? r.home_kr}|${teamKr(r.league, r.away_en) ?? r.away_kr}|${d}`;
    const hit = byKey.get(key);
    if (hit) out.set(r.id, hit);
  }
  return out;
}

/**
 * 여러 경기의 표시 확률·원천·근거를 한 번에 정한다(상세·리그·허브·앱 목록·사이트맵 공용).
 * 조회: 회차 연결 1회 + (연결 경기 90개당) 성분/배당 시각 1회 + 스냅샷 1회 + 킥오프 전 회차마다 buildRoundPredictions 1회.
 * 회차 쪽 조회가 실패하면 경기 일정 모델 확률로 표시한다(원천은 그대로 공개된다).
 */
export async function resolveMatches(env: Env, rows: MatchRow[], now = Date.now()): Promise<Map<number, ResolvedMatch>> {
  const out = new Map<number, ResolvedMatch>();
  if (rows.length === 0) return out;
  let links = new Map<number, RoundRef>();
  const meta = new Map<number, RoundMeta>();
  const snaps = new Map<number, PredictionSnapshot>();
  const current = new Map<number, MatchWithPrediction>();
  try {
    links = await linkRounds(env, rows);
    const ids = [...new Set([...links.values()].map((l) => l.matchId))];
    for (const c of chunks(ids)) {
      const [m, s] = await Promise.all([
        env.DB.prepare(
          `SELECT rm.id AS id, rp.computed_at AS computedAt, mo.updated_at AS marketAt
             FROM round_matches rm LEFT JOIN round_predictions rp ON rp.round_match_id = rm.id LEFT JOIN market_odds mo ON mo.round_match_id = rm.id
            WHERE rm.id IN (${c.map(() => "?").join(",")})`,
        )
          .bind(...c)
          .all<{ id: number; computedAt: string | null; marketAt: string | null }>(),
        getPredictionSnapshots(env, c),
      ]);
      for (const x of m.results ?? []) meta.set(x.id, { computedAt: x.computedAt, marketAt: x.marketAt });
      for (const [id, v] of s) snaps.set(id, v);
    }
    // 킥오프 전 경기가 있는 회차만 현재 확률을 계산한다(회차당 1회).
    const roundIds = [...new Set(rows.filter((r) => links.has(r.id) && !(ts(r.kickoff_at) <= now)).map((r) => links.get(r.id)!.roundId))];
    for (const rid of roundIds) {
      try {
        for (const p of await buildRoundPredictions(env, rid)) current.set(p.match.id, p);
      } catch (err) {
        console.error(`resolveMatches: 회차 ${rid} 계산 실패(경기 일정 모델로 표시) - ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error(`resolveMatches: 회차 연결 실패(경기 일정 모델로 표시) - ${(err as Error).message}`);
  }

  for (const row of rows) {
    const link = links.get(row.id);
    const fixture = fixtureCandidate(row);
    const rp = link ? current.get(link.matchId) : undefined;
    const mt = link ? meta.get(link.matchId) : undefined;
    const snap = link ? snaps.get(link.matchId) : undefined;
    const sel = selectProbability({
      now, kickoffAt: row.kickoff_at, roundKickoffAt: link?.kickoffAt ?? null, fixture,
      roundCurrent: rp ? roundCandidate(rp, mt) : null,
      roundSnapshot: snap ? snapshotCandidate(snap, mt) : null,
    });
    out.set(row.id, explainSelection(row, sel, rp ?? null, fixture, link ? { roundNo: link.roundNo, seq: link.seq } : null, now));
  }
  return out;
}

/** 고른 원천과 같은 입력으로만 근거를 만든다. fixture 성분은 원천이 fixture가 아닐 때 '맥락'으로 분리한다. */
function explainSelection(
  row: MatchRow,
  sel: Selection,
  rp: MatchWithPrediction | null,
  fixture: ProbabilityCandidate | null,
  round: ResolvedMatch["round"],
  now: number,
): ResolvedMatch {
  const names = { home: nameOf(row, "home"), away: nameOf(row, "away") };
  const p = sel.probability;
  const avgFixture = row.league_draw_rate ?? FALLBACK_DRAW_RATE;
  let reasons: string[] = [];
  let risks: string[] = [];
  let note: string | null = null;
  if (p && sel.provenance.source === "fixture") {
    ({ reasons, risks } = analyze(names, p, fixtureDetail(row), avgFixture));
  } else if (p && sel.provenance.kind === "current_estimate" && rp) {
    ({ reasons, risks } = analyze(names, p, roundDetail(rp), rp.raw.leagueDrawRate));
  } else if (p) {
    // 회차 스냅샷: 확률만 저장돼 있다. 확률 모양에서 나오는 위험(박빙·무승부)만 쓴다.
    risks = analyze(names, p, null, avgFixture).risks;
    note = SNAPSHOT_NOTE;
  } else {
    note = UNAVAILABLE_NOTE;
  }

  let context: FixtureContext | null = null;
  if (sel.provenance.source !== "fixture" && fixture && isGroundedProbability(fixture)) {
    const k = ts(row.kickoff_at);
    const c = ts(fixture.asOf);
    const started = Number.isFinite(k) && k <= now;
    if (!started || (Number.isFinite(c) && c < k)) {
      context = {
        asOf: fixture.asOf, pHome: fixture.pHome, pDraw: fixture.pDraw, pAway: fixture.pAway,
        basisLabel: basisLabelOf(fixture.basis, false),
        lines: analyze(names, fixture, fixtureDetail(row), avgFixture).reasons,
      };
    }
  }
  // 과거 확신 구간 보정표(calibration.ts)는 평가 도구의 무승부 누수·척도 오류가 확인돼 재생성 전까지 검증값이 아니다.
  // 그래서 경기 페이지에 구간 적중률을 싣지 않는다(calib = null). 계수는 바꾸지 않는다.
  return { fixtureId: row.id, probability: p, provenance: sel.provenance, round, reasons, risks, explanationNote: note, context, calib: null };
}

const emptyResolution = (id: number): ResolvedMatch => ({
  fixtureId: id, probability: null, provenance: UNAVAILABLE.provenance, round: null, reasons: [], risks: [],
  explanationNote: UNAVAILABLE_NOTE, context: null, calib: null,
});

function readinessOf(row: MatchRow, r: ResolvedMatch): Readiness {
  return matchContentReadiness({
    home: nameOf(row, "home"), away: nameOf(row, "away"), kickoffAt: row.kickoff_at, status: row.status, result: resultOf(row),
    probability: r.probability, provenanceKind: r.provenance.kind,
    explanationCount: r.reasons.length + (r.context?.lines.length ?? 0),
  });
}

function toSibling(r: MatchRow, res: ResolvedMatch | undefined): SiblingView {
  const x = res ?? emptyResolution(r.id);
  const p = x.probability;
  return {
    slug: r.slug, league: r.league, kickoffAt: r.kickoff_at, home: nameOf(r, "home"), away: nameOf(r, "away"),
    pHome: p?.pHome ?? null, pDraw: p?.pDraw ?? null, pAway: p?.pAway ?? null, pick: p?.pick ?? null,
    status: r.status, hg: r.hg, ag: r.ag,
    basis: p?.basis ?? null, basisLabel: basisLabelOf(p?.basis, p?.withMarket ?? false), withMarket: p?.withMarket ?? false,
    source: x.provenance.source, provenance: x.provenance, asOf: x.provenance.capturedAt, round: x.round,
    ready: readinessOf(r, x).ready,
  };
}

export async function loadMatchView(env: Env, slug: string, now = Date.now()): Promise<MatchView | null> {
  const row = await env.DB.prepare(`${MATCH_SELECT} WHERE f.slug = ?`).bind(slug).first<MatchRow>();
  if (!row) return null;
  const isNat = row.league === NATIONAL_LEAGUE;
  const { results: sib } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.league = ? AND f.id != ? AND f.kickoff_at >= ? AND f.kickoff_at <= ? AND f.status != 'cancelled' ORDER BY f.kickoff_at ASC, f.id ASC LIMIT 12`,
  )
    .bind(row.league, row.id, new Date(now - 2 * 86400e3).toISOString(), new Date(now + 8 * 86400e3).toISOString())
    .all<MatchRow>();
  const sibs = sib ?? [];
  // 본 경기와 같은 리그 경기를 같은 선택 함수로 한 번에 정한다(카드 숫자 = 각 경기 페이지 숫자).
  const resolved = await resolveMatches(env, [row, ...sibs], now);
  const r = resolved.get(row.id) ?? emptyResolution(row.id);
  const p = r.probability;
  const hk = isNat ? null : teamKr(row.league, row.home_en);
  const ak = isNat ? null : teamKr(row.league, row.away_en);
  const li = leagueInfo(row.league);
  return {
    slug: row.slug, league: row.league, competition: row.competition, leagueName: isNat ? row.competition ?? li.name : li.name, leagueSlug: li.slug,
    kickoffAt: row.kickoff_at, home: nameOf(row, "home"), away: nameOf(row, "away"),
    homeLogo: isNat ? flagOf(row.home_en) : hk ? TEAM_LOGOS[hk] ?? null : null,
    awayLogo: isNat ? flagOf(row.away_en) : ak ? TEAM_LOGOS[ak] ?? null : null,
    pHome: p?.pHome ?? 0, pDraw: p?.pDraw ?? 0, pAway: p?.pAway ?? 0, pick: p?.pick ?? "홈승", confidenceGap: p?.confidenceGap ?? 0,
    basis: p?.basis ?? null, basisLabel: basisLabelOf(p?.basis, p?.withMarket ?? false), withMarket: p?.withMarket ?? false,
    nBookmakers: p?.nBookmakers ?? null,
    source: r.provenance.source, provenance: r.provenance, probabilityAsOf: r.provenance.capturedAt,
    round: r.round, status: row.status, result: resultOf(row),
    reasons: r.reasons, risks: r.risks, explanationNote: r.explanationNote, context: r.context, calib: r.calib,
    siblings: sibs.map((s) => toSibling(s, resolved.get(s.id))),
  };
}

export interface LeagueView {
  league: string;
  info: LeagueInfo;
  upcoming: SiblingView[];
  recent: SiblingView[];
  /**
   * 시즌 순위표(자체 집계)·Elo 순위. undefined = 읽지 않음(이전 호출 호환), null = 읽기 실패(섹션 대신 안내 문장).
   * 이 조회가 실패해도 리그 페이지 자체는 그대로 보여준다.
   */
  tables?: LeagueTablesView | null;
}

export async function loadLeagueView(env: Env, leagueSlug: string, now = Date.now()): Promise<LeagueView | null> {
  const league = leagueBySlug(leagueSlug);
  if (!league) return null;
  const { results: upcoming } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.league = ? AND f.kickoff_at >= ? AND f.status = 'scheduled' ORDER BY f.kickoff_at ASC, f.id ASC LIMIT 60`,
  )
    .bind(league, new Date(now - 3 * 3600e3).toISOString())
    .all<MatchRow>();
  const { results: recent } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.league = ? AND f.status = 'finished' AND f.kickoff_at >= ? ORDER BY f.kickoff_at DESC, f.id DESC LIMIT 30`,
  )
    .bind(league, new Date(now - 21 * 86400e3).toISOString())
    .all<MatchRow>();
  const up = upcoming ?? [];
  const rc = recent ?? [];
  const resolved = await resolveMatches(env, [...up, ...rc], now);
  // 순위표·Elo는 부가 섹션이다. 실패하면 null로 두고(화면에 안내 문장) 경기 목록은 그대로 보여준다.
  let tables: LeagueTablesView | null = null;
  try {
    tables = await loadLeagueTables(env, league, now);
  } catch (err) {
    console.error(`loadLeagueView: 순위 자료 생략 - ${(err as Error).message}`);
  }
  return {
    league, info: leagueInfo(league),
    upcoming: up.map((r) => toSibling(r, resolved.get(r.id))),
    recent: rc.map((r) => toSibling(r, resolved.get(r.id))),
    tables,
  };
}
/**
 * 리그 페이지 색인 여부: 준비된 경기(예정 또는 최근 결과)가 하나라도 있거나, 순위표·Elo 순위에 읽을 만한 자료가
 * 있어야 한다(leagueTables.tablesMeaningful). 휴식기에도 실제 시즌 기록이 있는 리그 페이지는 빈 페이지가 아니다.
 */
export const leagueIndexable = (d: Pick<LeagueView, "upcoming" | "recent" | "tables">): boolean =>
  [...d.upcoming, ...d.recent].some((s) => s.ready === true) || tablesMeaningful(d.tables);

export interface HubView {
  byLeague: Map<string, SiblingView[]>;
}
export async function loadHubView(env: Env, now = Date.now()): Promise<HubView> {
  const { results } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.status = 'scheduled' AND f.kickoff_at >= ? AND f.kickoff_at <= ? ORDER BY f.kickoff_at ASC, f.id ASC LIMIT 200`,
  )
    .bind(new Date(now - 3 * 3600e3).toISOString(), new Date(now + 8 * 86400e3).toISOString())
    .all<MatchRow>();
  const rows = results ?? [];
  const resolved = await resolveMatches(env, rows, now);
  const byLeague = new Map<string, SiblingView[]>();
  for (const r of rows) byLeague.set(r.league, [...(byLeague.get(r.league) ?? []), toSibling(r, resolved.get(r.id))]);
  return { byLeague };
}
export const hubIndexable = (d: HubView): boolean => [...d.byLeague.values()].some((l) => l.some((s) => s.ready === true));

// ---------- 화면 ----------
// 앱(public/style.css)과 같은 어두운 바탕·색 체계. 홈 초록·무 금색·원정 빨강은 앱 범례와 같다.
// 경기 분석 영역은 남보라(인디고)로, 승무패 회차 영역(금색)과 구분한다.
const CSS = `
:root{--bg0:#0a0c12;--bg1:#10131c;--card:rgba(255,255,255,.045);--line:rgba(255,255,255,.09);--ink:#f2f4f8;--muted:#a3abbd;--muted2:#8a93a6;
--gold:#f2a93b;--indigo:#9ea5ff;--indigo-soft:rgba(129,140,248,.14);--home:#22c55e;--draw:#f2a93b;--away:#ef4444;--hit:#22c55e;--miss:#ef4444}
*{box-sizing:border-box}html{background:var(--bg0)}
body{margin:0;color:var(--ink);font:16px/1.65 "Pretendard Variable","Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-feature-settings:"tnum" 1;
background:radial-gradient(900px 480px at 110% -5%,rgba(99,102,241,.16),transparent 60%),radial-gradient(900px 500px at -10% 0%,rgba(242,169,59,.08),transparent 60%),linear-gradient(180deg,var(--bg1),var(--bg0));background-attachment:fixed;-webkit-font-smoothing:antialiased}
a{color:var(--indigo);text-decoration:none}a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--indigo);outline-offset:2px;border-radius:6px}
.skip{position:absolute;left:-9999px;top:8px;z-index:20;background:var(--ink);color:var(--bg0);padding:8px 12px;border-radius:8px}.skip:focus{left:12px}
header.top{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px;padding:10px max(16px,calc((100% - 760px)/2));background:rgba(10,12,18,.86);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:9px;color:var(--ink);font-weight:800;font-size:.95rem;min-height:44px}.brand i{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#ffc766,#c9791a);display:inline-block;flex:none}
.brand small{display:block;font-size:.7rem;font-weight:600;color:var(--muted);line-height:1.3}
nav.primary{display:flex;flex-wrap:wrap;gap:4px}nav.primary a{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;border-radius:10px;color:var(--muted);font-weight:700;font-size:.85rem}
nav.primary a[aria-current]{background:var(--indigo-soft);color:var(--indigo)}
.howto{width:100%;margin:0;font-size:.75rem;color:var(--muted)}.howto a{color:var(--muted);text-decoration:underline}
main{max-width:760px;margin:0 auto;padding:14px 16px 32px}
.crumb{font-size:.82rem;color:var(--muted);margin:6px 0 2px}.crumb a{color:var(--muted)}
.eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:.75rem;font-weight:800;letter-spacing:.06em;color:var(--indigo);background:var(--indigo-soft);border-radius:999px;padding:3px 10px;margin-top:10px}
h1{font-size:1.5rem;line-height:1.3;margin:.35em 0 .15em;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:.9rem;margin:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin:14px 0;box-shadow:0 10px 28px rgba(0,0,0,.28)}
h2{font-size:1.02rem;margin:0 0 .6em;display:flex;align-items:center;gap:8px}h2:before{content:"";width:4px;height:16px;border-radius:2px;background:var(--indigo)}
.teams{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;text-align:center;gap:8px}
.team b{display:block;font-size:1.08rem;margin-top:8px;line-height:1.3;word-break:keep-all}.team small{color:var(--muted);font-size:.75rem}
.logo{width:64px;height:64px;border-radius:50%;margin:0 auto;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 0 0 3px rgba(255,255,255,.06)}
.logo img{width:52px;height:52px;object-fit:contain}.mono{background:linear-gradient(135deg,#2b3350,#1b2135);color:#cfd6ff;font-weight:800;font-size:1.2rem}
.mid{font-weight:900;color:var(--muted2);font-size:.95rem}.score{font-size:2rem;font-weight:900;color:var(--ink);letter-spacing:.02em}
.probs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:22px}
.prob{border-radius:14px;padding:11px 6px 10px;text-align:center;background:rgba(255,255,255,.035);border:1px solid var(--line);position:relative}
.prob span{display:block;font-size:.78rem;color:var(--muted);font-weight:700}.prob strong{font-size:1.55rem;font-weight:900;display:block;line-height:1.25}
.prob.top{border-color:rgba(129,140,248,.6);background:var(--indigo-soft)}.prob.top:after{content:"확률 1위";position:absolute;top:-10px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:.66rem;font-weight:800;line-height:1.5;background:var(--indigo);color:#0b0e1a;border-radius:999px;padding:1px 9px}
.prob.act{outline:2px solid var(--hit);outline-offset:-2px}.prob.act.miss{outline-color:var(--miss)}
.bar{display:flex;height:10px;border-radius:6px;overflow:hidden;margin-top:12px;background:rgba(255,255,255,.05)}.bar i{display:block}
.legend{display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:5px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.chip{font-size:.75rem;font-weight:700;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.chip.round{color:var(--gold);border-color:rgba(242,169,59,.45);background:rgba(242,169,59,.08)}
.summary{font-size:1.02rem;font-weight:700;line-height:1.6;margin:0}
ul.list{margin:0;padding-left:1.1em}ul.list li{margin:.35em 0;color:#dfe3ec}
.note{color:var(--muted);font-size:.85rem;margin:.6em 0 0}
dl.meta{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:.88rem}dl.meta dt{color:var(--muted)}dl.meta dd{margin:0}
.result{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tag-hit,.tag-miss{font-weight:800;border-radius:999px;padding:3px 12px;font-size:.85rem}
.tag-hit{background:rgba(34,197,94,.16);color:var(--hit)}.tag-miss{background:rgba(239,68,68,.16);color:var(--miss)}
.rows a.row{display:grid;grid-template-columns:86px 1fr 92px;gap:10px;align-items:center;padding:10px 4px;border-top:1px solid var(--line);color:var(--ink);min-height:44px}
.rows a.row:first-child{border-top:0}.rows .when{font-size:.78rem;color:var(--muted);line-height:1.35}.rows .vs{font-weight:700;font-size:.92rem;line-height:1.35;word-break:keep-all}
.rows .mini{font-size:.75rem;color:var(--muted);text-align:right}.rows .mini .b{display:flex;height:6px;border-radius:4px;overflow:hidden;margin-top:4px}
.tags{display:flex;flex-wrap:wrap;gap:6px}.tags span{font-size:.78rem;color:var(--muted);background:rgba(255,255,255,.04);border-radius:8px;padding:3px 9px}
.cta{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin-top:4px;padding:10px 16px;border-radius:12px;background:var(--indigo-soft);border:1px solid rgba(129,140,248,.45);color:var(--indigo);font-weight:800}
footer.site{max-width:760px;margin:0 auto;padding:18px 16px 48px;border-top:1px solid var(--line);color:var(--muted);font-size:.8rem;line-height:1.6}
footer.site nav{display:flex;flex-wrap:wrap;gap:2px 14px;margin-bottom:10px}footer.site nav a{color:var(--muted);display:inline-flex;align-items:center;min-height:32px}
footer.site p{margin:.5em 0}footer.site a{color:var(--muted);text-decoration:underline}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0;border:1px solid var(--line);border-radius:12px;max-width:100%}
table.tbl{border-collapse:collapse;width:100%;min-width:560px;font-size:.84rem}table.tbl.sm{min-width:420px}
table.tbl caption{text-align:left;font-weight:700;padding:10px 12px;color:var(--ink);font-size:.86rem}
table.tbl th,table.tbl td{padding:8px 10px;border-top:1px solid var(--line);text-align:right;white-space:nowrap}
table.tbl thead th{color:var(--muted);font-weight:700;background:rgba(255,255,255,.03)}
table.tbl td:first-child,table.tbl thead th:first-child{text-align:center}
table.tbl th[scope=row],table.tbl thead th:nth-child(2){text-align:left;white-space:normal;word-break:keep-all;font-weight:700}
.fm{display:inline-block;min-width:1.5em;text-align:center;font-weight:800;font-size:.75rem}.fm-w{color:var(--hit)}.fm-d{color:var(--draw)}.fm-l{color:var(--miss)}
@media (max-width:520px){nav.primary{display:grid;grid-template-columns:1fr 1fr;width:100%}}
@media (max-width:420px){h1{font-size:1.3rem}.logo{width:54px;height:54px}.logo img{width:44px;height:44px}.prob strong{font-size:1.35rem}.rows a.row{grid-template-columns:70px 1fr 78px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;

/** 공통 링크(004 4장). 앱 탭 뒤가 아니라 모든 페이지 바닥에 실제 앵커로 둔다. */
export const SITE_LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: "홈" },
  { href: "/matches", label: "경기 분석" },
  { href: "/guide/", label: "가이드" },
  { href: "/methodology", label: "방법론" },
  { href: "/performance", label: "기록" },
  { href: "/editorial", label: "편집 원칙" },
  { href: "/responsible", label: "건전 이용 안내" },
  { href: "/sources", label: "출처·데이터 주의사항" },
  { href: "/about", label: "소개" },
  { href: "/contact", label: "문의" },
  { href: "/app", label: "승무패 도구" },
  { href: "/privacy", label: "개인정보처리방침" },
];
// 머리말·꼬리말은 publicSite의 공통 메뉴를 쓴다(화면 종류마다 메뉴가 달라지지 않게).

const beacon = (event: string) => `<script>(function(){try{var q=new URLSearchParams(location.search);var d={e:${JSON.stringify(event)},u:q.get("utm_source"),ref:document.referrer};navigator.sendBeacon("/api/e",JSON.stringify(d))}catch(_){}})();</script>`;

interface ShellOpts {
  title: string;
  description: string;
  canonical: string | null;
  indexable: boolean;
  ogType?: "article" | "website";
  keywords?: string[];
  jsonLd?: unknown[];
  event?: string;
  active: string | null;
  body: string;
}
/** 경기 영역 공통 틀. 광고 스크립트는 넣지 않는다(004 10장 광고 기본 꺼짐). */
function pageShell(o: ShellOpts): string {
  const ld = o.jsonLd?.length ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, "\\u003c")}</script>\n` : "";
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(o.title)}</title>
<meta name="description" content="${e(o.description)}">
<meta name="robots" content="${o.indexable ? "index,follow" : "noindex,follow"}">
${o.keywords?.length ? `<meta name="keywords" content="${e(o.keywords.join(", "))}">\n` : ""}${o.canonical ? `<link rel="canonical" href="${e(o.canonical)}">
<meta property="og:type" content="${o.ogType ?? "website"}"><meta property="og:title" content="${e(o.title)}"><meta property="og:description" content="${e(o.description)}"><meta property="og:url" content="${e(o.canonical)}">\n` : ""}<meta name="theme-color" content="#0a0c12">
<link rel="stylesheet" href="/fonts/pretendard/pretendard.css">
${ld}<style>${CSS}</style><link rel="stylesheet" href="/nav.css"></head>
<body>${publicHeader(o.canonical ? new URL(o.canonical).pathname : o.active ?? "/matches")}
<main id="content">
${o.body}
</main>
${publicFooter(DISCLAIMER)}
${o.event ? beacon(o.event) : ""}
</body></html>`;
}

function logoHtml(name: string, src: string | null): string {
  if (src) return `<div class="logo"><img src="${e(src)}" alt="${e(name)} 엠블럼" width="52" height="52" loading="lazy"></div>`;
  const ini = name.replace(/\s|FC|SC|CF/g, "").slice(0, 2) || "?";
  return `<div class="logo mono" aria-hidden="true">${e(ini)}</div>`;
}
function barHtml(ph: number, pd: number, pa: number, h = 10, cls = "bar"): string {
  return `<div class="${cls}" style="height:${h}px" aria-hidden="true"><i style="width:${(ph * 100).toFixed(1)}%;background:var(--home)"></i><i style="width:${(pd * 100).toFixed(1)}%;background:var(--draw)"></i><i style="width:${(pa * 100).toFixed(1)}%;background:var(--away)"></i></div>`;
}
function rowHtml(s: SiblingView): string {
  const hasP = s.pHome != null && s.pDraw != null && s.pAway != null && s.pick != null;
  const pOfS = (o: Outcome) => (o === "홈승" ? s.pHome! : o === "원정승" ? s.pAway! : s.pDraw!);
  const right = s.status === "finished" && s.hg != null && s.ag != null
    ? `<b style="color:var(--ink);font-size:.95rem">${s.hg} : ${s.ag}</b>`
    : hasP ? `${s.pick === "무승부" ? "무" : s.pick} ${pct(pOfS(s.pick!))}` : "확률 없음";
  const bar = hasP ? barHtml(s.pHome!, s.pDraw!, s.pAway!, 6, "b") : "";
  return `<a class="row" href="/match/${e(s.slug)}"><span class="when">${e(kstLabel(s.kickoffAt, false))}<br>${e(kstLabel(s.kickoffAt).slice(-5))}</span><span class="vs">${e(s.home)}<br><span style="color:var(--muted);font-weight:600">vs</span> ${e(s.away)}</span><span class="mini">${right}${bar}</span></a>`;
}

export function matchTitle(v: Pick<MatchView, "home" | "away" | "leagueName" | "kickoffAt">): string {
  return `${v.home} vs ${v.away} 승부예측 · ${kstLabel(v.kickoffAt, false).replace(/\(.\)/, "")} ${v.leagueName} 확률 분석 | HYEOKS`;
}

/** 확률 원천을 사람 말로. 회차 확률·저장 확률·경기 일정 모델을 섞어 쓰지 않는다. */
export function provenanceText(v: Pick<MatchView, "provenance" | "round">): string {
  const at = v.provenance.capturedAt ? kstLabel(v.provenance.capturedAt) : "";
  const r = v.round ? `승무패 ${v.round.roundNo}회차` : "승무패 회차";
  switch (v.provenance.kind) {
    case "current_estimate":
      return v.provenance.source === "round"
        ? `${r} 확률을 그대로 보여줍니다(현재 계산${at ? `, 입력 기준 ${at}` : ""}). 킥오프 전까지 해외 배당 등 입력이 갱신되면 바뀝니다.`
        : `경기 일정 모델의 현재 계산입니다${at ? `(계산 ${at})` : ""}. 킥오프 전까지 결과가 반영되면 다시 계산됩니다.`;
    case "pre_kickoff_snapshot":
      return `${r}의 킥오프 전 저장 확률입니다${at ? `(저장 ${at})` : ""}. 저장한 값은 나중에 바꾸지 않습니다.`;
    case "pre_kickoff_fixture":
      return `경기 일정 모델의 킥오프 전 저장 확률입니다${at ? `(계산 ${at})` : ""}. 저장한 값은 나중에 바꾸지 않습니다.`;
    default:
      return UNAVAILABLE_NOTE;
  }
}

function methodText(v: MatchView): string {
  const tail = "새 요소는 과거 경기를 시간순으로 나눈 검증에서 나빠지지 않을 때만 반영합니다.";
  if (v.basis === "model")
    return `클럽 통계 모델: 리그별 Elo 전력 지수, 최근 5경기 흐름, 맞대결 기록, 리그 무승부율로 계산합니다.${v.withMarket ? " 이 경기는 해외 배당을 리그별 비중으로 함께 반영했습니다." : ""} ${tail}`;
  if (v.basis === "market") return `해외 북메이커 배당을 마진을 제거해 확률로 바꾼 값입니다${v.nBookmakers ? `(${v.nBookmakers}곳 평균)` : ""}. 클럽 Elo가 성립하지 않는 대회에서 씁니다. ${tail}`;
  if (v.basis === "national") return `1872년 이후 A매치 결과로 만든 국가대표 Elo를 확률로 바꾼 값입니다. ${tail}`;
  return "이 경기는 계산에 필요한 입력이 부족해 확률을 표시하지 않습니다.";
}

export function renderMatchPage(v: MatchView): string {
  const title = matchTitle(v);
  const hasP = v.provenance.kind !== "unavailable" && v.basis != null;
  const preKickoff = v.provenance.kind === "pre_kickoff_snapshot" || v.provenance.kind === "pre_kickoff_fixture";
  const top = v.pick;
  const pOf = (o: Outcome) => (o === "홈승" ? v.pHome : o === "원정승" ? v.pAway : v.pDraw);
  const desc = hasP
    ? `${kstLabel(v.kickoffAt)} ${v.leagueName} ${v.home} vs ${v.away}. ${whoWins(top, v.home, v.away)} ${pct(pOf(top))}, 무승부 ${pct(v.pDraw)}(${v.basisLabel}). 확률의 출처·시점·근거와 한계를 정리했습니다.`
    : `${kstLabel(v.kickoffAt)} ${v.leagueName} ${v.home} vs ${v.away} 경기 정보. 검증된 확률이 아직 없습니다.`;
  const url = `${SITE}/match/${v.slug}`;
  const tags = matchTags(v);
  const hit = v.result && hasP && preKickoff ? v.result.actual === top : null;
  const probBox = (o: Outcome, label: string) => {
    const cls = ["prob", o === top ? "top" : "", hit != null && v.result && v.result.actual === o ? `act${hit ? "" : " miss"}` : ""].filter(Boolean).join(" ");
    return `<div class="${cls}"><span>${e(label)}</span><strong>${pct(pOf(o))}</strong></div>`;
  };
  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "SportsEvent", name: `${v.home} vs ${v.away}`, sport: "Soccer",
      startDate: v.kickoffAt, eventStatus: v.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      homeTeam: { "@type": "SportsTeam", name: v.home }, awayTeam: { "@type": "SportsTeam", name: v.away },
      superEvent: { "@type": "SportsEvent", name: v.leagueName }, url,
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "HYEOKS 풋볼 데이터", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: `${v.leagueName} 경기 분석`, item: `${SITE}/league/${v.leagueSlug}` },
        { "@type": "ListItem", position: 3, name: `${v.home} vs ${v.away}`, item: url },
      ],
    },
  ];
  const limits = [
    ...v.risks,
    hasP && v.basis === "model" && !v.withMarket ? "해외 배당은 반영하지 않은 통계 모델 확률입니다." : "",
    hasP && v.basis === "national" ? "해외 배당은 반영하지 않은 국가대표 Elo 확률입니다." : "",
    v.league === NATIONAL_LEAGUE ? "중립 경기장 여부는 반영하지 않고 홈 이점을 적용했습니다." : "",
    v.provenance.kind === "current_estimate" ? "킥오프 전까지 입력이 갱신되면 확률이 바뀔 수 있습니다." : "",
    "선발 명단·부상·로테이션 같은 경기 직전 정보는 반영되지 않습니다.",
  ].filter(Boolean);
  const roundChip = v.round ? `<a class="chip round" href="/round/${v.round.roundNo}">승무패 ${v.round.roundNo}회차 ${v.round.seq}번 경기 →</a>` : "";
  const reasonsIntro = v.provenance.source === "round" && v.provenance.kind === "current_estimate"
    ? "아래 문장은 승무패 회차 확률 계산에 실제로 쓰인 입력에서 만들었습니다."
    : v.provenance.source === "fixture" ? "아래 문장은 이 확률 계산에 쓰인 경기 일정 모델 입력에서 만들었습니다." : "";

  const result = v.result
    ? `<section class="card" aria-labelledby="h-result"><h2 id="h-result">경기 결과</h2><div class="result"><b>${e(v.home)} ${v.result.hg} : ${v.result.ag} ${e(v.away)}</b>${hit != null ? `<span class="${hit ? "tag-hit" : "tag-miss"}">${hit ? "확률 1위 적중" : "확률 1위와 다른 결과"}</span>` : ""}</div>${
      hit != null
        ? `<p class="note">킥오프 전 저장 확률 1위는 ${e(whoWins(top, v.home, v.away))}(${pct(pOf(top))})였고, 실제 결과는 ${e(whoWins(v.result.actual, v.home, v.away))}였습니다. 킥오프 전에 저장한 확률은 바꾸지 않습니다. 한 경기 결과는 모델 성능을 말해주지 않습니다. 검증된 저장 기록 집계는 <a href="/performance">기록</a>에서 봅니다.</p>`
        : `<p class="note">킥오프 전에 저장된 확률이 확인되지 않아 결과만 표시합니다.</p>`
    }</section>`
    : v.status === "cancelled"
      ? `<section class="card"><h2>경기 취소·연기</h2><p class="note" style="margin:0">이 경기는 취소되거나 연기됐습니다.</p></section>`
      : Date.parse(v.kickoffAt) <= Date.now() && v.status === "scheduled"
        ? `<section class="card"><h2>경기 결과</h2><p class="note" style="margin:0">결과 확인 중입니다. 결과가 수집되면 이곳에 표시합니다.</p></section>`
        : "";

  const body = `<p class="crumb"><a href="/">HYEOKS</a> › <a href="/matches">경기 분석</a> › <a href="/league/${e(v.leagueSlug)}">${e(v.leagueName)}</a> › ${e(v.home)} vs ${e(v.away)}</p>
<span class="eyebrow">경기 분석 · ${e(v.leagueName)}</span>
<h1>${e(v.home)} vs ${e(v.away)} 승부예측</h1>
<p class="sub">${e(kstLabel(v.kickoffAt))} KST${v.probabilityAsOf ? ` · 확률 기준 ${e(kstLabel(v.probabilityAsOf))}` : ""}</p>

<section class="card" aria-labelledby="h-prob"><h2 id="h-prob">확률</h2>
<div class="teams">
<div class="team">${logoHtml(v.home, v.homeLogo)}<b>${e(v.home)}</b><small>홈</small></div>
${v.result ? `<div class="score">${v.result.hg} : ${v.result.ag}</div>` : `<div class="mid">VS</div>`}
<div class="team">${logoHtml(v.away, v.awayLogo)}<b>${e(v.away)}</b><small>원정</small></div>
</div>
${hasP ? `<div class="probs">${probBox("홈승", "홈승")}${probBox("무승부", "무승부")}${probBox("원정승", "원정승")}</div>
${barHtml(v.pHome, v.pDraw, v.pAway)}
<div class="legend"><span>홈승</span><span>무승부</span><span>원정승</span></div>
<div class="chips"><span class="chip">확률 출처 · ${e(v.basisLabel)}</span><span class="chip">1·2위 차 ${(v.confidenceGap * 100).toFixed(1)}%p</span>${roundChip}</div>
<p class="note">${e(provenanceText(v))}</p>
<p class="note">확률은 반올림하여 합계가 100%와 다를 수 있습니다. 확률 1위는 가능성이 가장 높은 결과일 뿐 확정이 아닙니다.</p>`
  : `<p class="note">${e(v.explanationNote ?? UNAVAILABLE_NOTE)}</p>${roundChip ? `<div class="chips">${roundChip}</div>` : ""}`}
</section>

${result}

${hasP ? `<section class="card" aria-labelledby="h-sum"><h2 id="h-sum">한 줄 요약</h2><p class="summary">${e(neutralSummary(v))}</p>${v.basis === "model" ? `<p class="note">경기 페이지에는 과거 백테스트 구간 적중률을 싣지 않습니다(같은 숫자를 실제 기록처럼 읽지 않게). 킥오프 전 저장 기록은 <a href="/performance">기록</a>에서 봅니다.</p>` : ""}</section>` : ""}

<section class="card" aria-labelledby="h-why"><h2 id="h-why">이 확률의 근거</h2>${reasonsIntro && v.reasons.length ? `<p class="note" style="margin:0 0 6px">${e(reasonsIntro)}</p>` : ""}${
    v.reasons.length
      ? `<ul class="list">${v.reasons.map((r) => `<li>${e(r)}</li>`).join("")}</ul>`
      : `<p class="note" style="margin:0">${e(v.explanationNote ?? "확률 차를 설명할 뚜렷한 근거 신호가 없습니다.")}</p>`
  }</section>

<section class="card" aria-labelledby="h-lim"><h2 id="h-lim">변수와 한계</h2><ul class="list">${limits.map((r) => `<li>${e(r)}</li>`).join("")}</ul></section>

${v.context ? `<section class="card" aria-labelledby="h-ctx"><h2 id="h-ctx">경기 데이터 맥락(참고)</h2><p class="note" style="margin:0 0 8px">아래는 경기 일정을 수집할 때 따로 계산한 ${e(v.context.basisLabel)} 값${v.context.asOf ? `(${e(kstLabel(v.context.asOf))} 계산)` : ""}입니다. 위 확률의 계산 근거가 아니라 비교용 참고 자료입니다.</p><p style="margin:0 0 6px;font-size:.9rem">홈승 ${pct(v.context.pHome)} · 무승부 ${pct(v.context.pDraw)} · 원정승 ${pct(v.context.pAway)}</p>${v.context.lines.length ? `<ul class="list">${v.context.lines.map((r) => `<li>${e(r)}</li>`).join("")}</ul>` : ""}</section>` : ""}

<section class="card" aria-labelledby="h-src"><h2 id="h-src">출처와 시점</h2><dl class="meta">
<dt>확률 출처</dt><dd>${e(hasP ? v.basisLabel : "없음")}</dd>
<dt>원천</dt><dd>${e(v.provenance.source === "round" ? (v.round ? `승무패 ${v.round.roundNo}회차 ${v.round.seq}번 경기` : "승무패 회차") : v.provenance.source === "fixture" ? "경기 일정 모델" : "확인되지 않음")}</dd>
<dt>기준 시각</dt><dd>${e(v.probabilityAsOf ? `${kstLabel(v.probabilityAsOf)} KST` : "없음")}</dd>
<dt>일정·결과</dt><dd>FotMob 공개 일정·결과 수집 자료</dd>
</dl>
<p class="note">${e(methodText(v))}</p>
<p class="note"><a href="/methodology">계산 방법</a> · <a href="/sources">데이터 출처</a> · <a href="/performance">킥오프 전 저장 기록</a></p></section>

${v.siblings.length ? `<section class="card" aria-labelledby="h-sib"><h2 id="h-sib">${e(v.leagueName)} 다른 경기</h2><div class="rows">${v.siblings.map(rowHtml).join("")}</div><p class="note"><a href="/league/${e(v.leagueSlug)}">${e(v.leagueName)} 경기 전체 보기 →</a></p></section>` : ""}

<section class="card" aria-labelledby="h-app"><h2 id="h-app">승무패 도구</h2><p class="note" style="margin:0">${v.round ? `이 경기가 포함된 승무패 ${v.round.roundNo}회차 14경기를 도구에서 함께 볼 수 있습니다.` : "승무패 회차별 경기 확률은 별도 도구에서 볼 수 있습니다."} 도구의 사용자 설정 재계산은 공식 저장 기록과 다릅니다.</p>
<p style="margin:12px 0 0"><a class="cta" href="/app?${v.round ? `round=${v.round.roundNo}&amp;` : ""}utm_source=match_page">승무패 도구 열기 →</a></p></section>`;

  return pageShell({
    title, description: desc, canonical: url, indexable: MATCH_PAGES_INDEXED && matchIndexable(v), ogType: "article", keywords: tags, jsonLd,
    event: "match_view", active: "/matches", body,
  });
}

/**
 * 경기 상세 페이지는 검색 색인에 넣지 않는다(2026-10-12). 템플릿으로 만든 경기 페이지가 사이트맵의
 * 85%(311개 중 265개)를 차지해 '검토 없이 대량 생성한 페이지'로 보일 위험이 있었다. 페이지와 링크는
 * 그대로 두고, 색인은 리그·가이드·기록처럼 사람이 읽을 가치가 큰 페이지에 집중한다.
 * matchIndexable은 '내용이 준비됐는가' 판정으로 남겨 둔다(data.json의 indexable·readinessGaps).
 */
export const MATCH_PAGES_INDEXED = false;

// ---------- 리그 순위표·Elo 순위 섹션 ----------
// 표는 caption·th scope를 달고, 좁은 화면(360px)에서는 이름 붙은 가로 스크롤 영역(키보드 초점 가능)으로 보여준다(004 9장).
const FORM_KR: Record<FormMark, string> = { W: "승", D: "무", L: "패" };
const signedInt = (x: number): string => {
  const r = Math.round(x);
  return r > 0 ? `+${r}` : String(r);
};
const scoreText = (x: number) => x.toFixed(2);

function formHtml(form: readonly FormMark[]): string {
  if (!form.length) return "-";
  return form.map((f) => `<span class="fm fm-${f.toLowerCase()}">${FORM_KR[f]}</span>`).join("");
}

function standingsSection(t: LeagueTablesView, leagueName: string): string {
  const head = `<section class="card" aria-labelledby="standings-h"><h2 id="standings-h">시즌 순위표(자체 집계)</h2>`;
  if (t.standingsNote) return `${head}<p class="note" style="margin:0">${e(t.standingsNote)}</p></section>`;
  const s = t.standings;
  if (!s) return `${head}<p class="note" style="margin:0">이 리그의 저장된 경기 결과가 아직 없어 순위표를 만들지 않았습니다.</p></section>`;
  const leagueNote = STANDINGS_LEAGUE_NOTES[t.league];
  const rows = s.rows
    .map((r) => `<tr><td>${r.rank}</td><th scope="row">${e(tableTeamName(t.league, r.team))}</th><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gf}</td><td>${r.ga}</td><td>${signedInt(r.gd)}</td><td><b>${r.points}</b></td><td>${formHtml(r.form)}</td></tr>`)
    .join("");
  return `${head}
<p class="note" style="margin-top:0"><strong>${e(STANDINGS_LABEL)}</strong></p>
<p class="note">${e(s.seasonLabel)} 시즌 · 저장된 결과 ${s.matches}경기 반영(${e(s.firstDate)} ~ ${e(s.lastDate)}) · 집계 시각 ${e(fullKst(t.generatedAt))}</p>
<div class="tbl-wrap" role="region" aria-labelledby="standings-cap" tabindex="0"><table class="tbl"><caption id="standings-cap">${e(leagueName)} ${e(s.seasonLabel)} 시즌 순위(HYEOKS 자체 집계, 승리 3점·무승부 1점·패배 0점)</caption>
<thead><tr><th scope="col">순위</th><th scope="col">팀</th><th scope="col">경기</th><th scope="col">승</th><th scope="col">무</th><th scope="col">패</th><th scope="col">득점</th><th scope="col">실점</th><th scope="col">득실차</th><th scope="col">승점</th><th scope="col">최근 5경기</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="note">${e(TIEBREAK_NOTE)} 최근 5경기는 이번 시즌 기록만 쓰며 왼쪽이 오래된 경기, 오른쪽이 가장 최근 경기입니다.${leagueNote ? ` ${e(leagueNote)}` : ""}</p>
<p class="note">남은 경기 일정은 앞으로 7일 치만 수집하므로 시즌 최종 순위 전망은 계산하지 않습니다. 결과가 아직 수집되지 않은 경기는 빠져 있을 수 있습니다.</p>
</section>`;
}

function eloSection(t: LeagueTablesView, leagueName: string): string {
  const national = t.kind === "national";
  const head = `<section class="card" aria-labelledby="elo-h"><h2 id="elo-h">Elo 전력 순위</h2>`;
  if (t.elo.length === 0) return `${head}<p class="note" style="margin:0">표시할 Elo 자료가 아직 없습니다.</p></section>`;
  const withChange = t.changeDays != null;
  const cols = ["순위", national ? "국가" : "팀", "Elo", ...(withChange ? [`최근 ${t.changeDays}일 변화`] : []), ...(national ? ["반영 A매치"] : []), "마지막 경기일"];
  const rows = t.elo
    .map((r) => {
      const cells = [
        `<td>${r.rank}</td>`,
        `<th scope="row">${e(tableTeamName(t.league, r.team))}</th>`,
        `<td><b>${Math.round(r.elo)}</b></td>`,
        ...(withChange ? [`<td>${r.change == null ? "없음" : signedInt(r.change)}</td>`] : []),
        ...(national ? [`<td>${r.matches ?? "-"}</td>`] : []),
        `<td>${e((r.lastMatchDate ?? "-").slice(0, 10))}</td>`,
      ];
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  const caption = national
    ? `국가대표 Elo 상위 ${t.elo.length}개국(HYEOKS 계산)`
    : `${leagueName} 팀별 Elo(HYEOKS 계산, 가장 최근 시즌 참가 팀)`;
  const method = national
    ? `국가대표 Elo는 공개 자료(martj42/international_results)의 A매치 결과로 계산합니다. 대회 중요도에 따라 갱신 폭을 달리하고 득실차가 클수록 더 크게 반영하며, 중립 경기가 아니면 홈팀에 +${t.homeAdv}점을 더해 기대치를 잡습니다. A매치 ${NATIONAL_MIN_MATCHES}경기 이상인 팀 ${t.eloSample}개 가운데 최근 ${Math.round(NATIONAL_ACTIVE_DAYS / 365)}년 안에 경기한 팀만 순위에 넣었습니다. 레이팅 갱신 ${fullKst(t.eloAsOf)}. FIFA 랭킹과는 계산 방식이 달라 순위가 다를 수 있습니다.`
    : `Elo는 경기 결과만으로 갱신하는 상대 전력 지수입니다. 이 리그의 저장된 결과 ${t.eloSample}경기(${e(t.eloSampleFrom ?? "-")} ~ ${e(t.eloAsOf ?? "-")})로 계산하며, 한 경기에 최대 ${K_FACTOR}점이 오가고 홈팀에는 +${t.homeAdv}점의 홈 이점을 더해 기대치를 잡습니다. 새 시즌 첫 경기 때 1500점 쪽으로 ${Math.round(SEASON_REGRESSION * 100)}% 되돌리고, 이 리그 기록이 없는 팀(새로 올라온 팀 등)은 1500점에서 시작합니다. 가장 최근 시즌 경기에 나온 팀만 표시합니다.${withChange ? ` 최근 ${t.changeDays}일 변화는 같은 기록으로 ${t.changeDays}일 전까지의 Elo를 다시 계산해 지금 값에서 뺀 것이며(시즌 전환 때의 되돌림 포함), 그 전 기록이 없는 팀은 '없음'입니다.` : ""}`;
  // 읽는 법: 실제 1위와 마지막 순위 팀의 점수 차로 기대 점수를 계산해 보여준다(설명용 가상 숫자가 아니다).
  let example = "";
  if (t.elo.length >= 2) {
    const a = t.elo[0];
    const b = t.elo[t.elo.length - 1];
    const diff = a.elo - b.elo;
    const an = tableTeamName(t.league, a.team);
    const bn = tableTeamName(t.league, b.team);
    example = `<p class="note">읽는 법: 표의 1위 ${e(an)}(Elo ${Math.round(a.elo)})·${b.rank}위 ${e(bn)}(Elo ${Math.round(b.elo)})의 점수 차는 ${Math.round(diff)}점입니다. 중립 경기장이라면 1위 팀의 기대 점수는 ${scoreText(expectedScore(diff))}, 1위 팀이 홈이면 홈 이점 ${t.homeAdv}점이 더해져 ${scoreText(expectedScore(diff + t.homeAdv))}입니다. 기대 점수는 승리를 1점, 무승부를 0.5점으로 셀 때의 평균 점수이며 승리 확률과는 다릅니다. <a href="/guide/elo-rating">Elo 레이팅 가이드</a> · <a href="/ratings">리그별 전력 순위</a></p>`;
  }
  return `${head}
<p class="note" style="margin-top:0">집계 시각 ${e(fullKst(t.generatedAt))}${national ? "" : ` · 마지막 반영 경기 ${e(t.eloAsOf ?? "-")}`}</p>
<div class="tbl-wrap" role="region" aria-labelledby="elo-cap" tabindex="0"><table class="tbl sm"><caption id="elo-cap">${e(caption)}</caption>
<thead><tr>${cols.map((c) => `<th scope="col">${e(c)}</th>`).join("")}</tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="note">${method}</p>
${example}
</section>`;
}

/** 리그 페이지의 순위 섹션. undefined면 아무것도, null(조회 실패)이면 안내 문장만 내보낸다. */
export function leagueTablesHtml(t: LeagueTablesView | null | undefined, leagueName: string): string {
  if (t === undefined) return "";
  if (t === null) {
    return `<section class="card"><h2>순위 자료</h2><p class="note" style="margin:0">시즌 순위표와 Elo 전력 순위를 지금 불러오지 못했습니다. 경기 일정과 결과는 이 페이지에서 그대로 볼 수 있습니다. <a href="/ratings">리그별 전력 순위</a></p></section>`;
  }
  return `${t.kind === "club" ? standingsSection(t, leagueName) : ""}${eloSection(t, leagueName)}`;
}

export function renderLeaguePage(d: LeagueView): string {
  const n = d.info.name;
  const title = `${n} 승부예측 · 이번 주 경기 확률 분석 | HYEOKS`;
  const url = `${SITE}/league/${d.info.slug}`;
  const hasTables = d.tables != null;
  const desc = hasTables
    ? `${n} 이번 주 경기별 홈승·무승부·원정승 확률과 출처·계산 시각, 최근 경기 결과, 자체 집계 순위표와 Elo 전력 순위를 한곳에 모았습니다.`
    : `${n} 이번 주 경기별 홈승·무승부·원정승 확률과 출처·계산 시각, 최근 경기 결과를 한곳에 모았습니다.`;
  const tags = [...new Set([`${n} 승부예측`, `${n} 경기 분석`, `${n} 일정`, `${n} 경기 결과`, ...d.info.aliases.map((a) => `${a} 승부예측`)])];
  const byDay = new Map<string, SiblingView[]>();
  for (const s of d.upcoming) {
    const k = kstLabel(s.kickoffAt, false);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  // 지난 경기 '확률 1위 적중 수'는 싣지 않는다. fixture 확률은 검증된 사전 공개 기록이 아니므로
  // 리그별 성적처럼 보이게 집계하지 않고, 검증 기록은 /performance로 보낸다.
  const body = `<p class="crumb"><a href="/">HYEOKS</a> › <a href="/matches">경기 분석</a> › ${e(n)}</p>
<span class="eyebrow">경기 분석</span>
<h1>${e(n)} 승부예측</h1>
<p class="sub">${e(d.info.country)} · 이번 주 경기 확률과 최근 경기 결과</p>
<p class="note">범위: 킥오프 3시간 전 이후 예정 경기(최대 60경기)와 최근 3주 종료 경기(최대 30경기). 수집되지 않았거나 결과가 아직 확인되지 않은 경기는 빠질 수 있습니다. 확률이 없는 경기는 '확률 없음'으로 표시합니다.</p>
${byDay.size ? [...byDay.entries()].map(([day, list]) => `<section class="card"><h2>${e(day)}</h2><div class="rows">${list.map(rowHtml).join("")}</div></section>`).join("") : `<section class="card"><h2>예정 경기</h2><p class="note" style="margin:0">이 기간에 수집된 예정 경기가 없습니다.</p></section>`}
${d.recent.length ? `<section class="card"><h2>최근 경기 결과</h2><p class="note" style="margin:0 0 6px">스코어와 함께, 킥오프 전에 저장된 것이 확인된 확률만 막대로 표시합니다. 적중 여부의 집계는 검증된 저장 기록 기준으로 <a href="/performance">기록</a> 페이지에서 따로 공개합니다.</p><div class="rows">${d.recent.map(rowHtml).join("")}</div></section>` : ""}
${leagueTablesHtml(d.tables, n)}`;
  return pageShell({ title, description: desc, canonical: url, indexable: leagueIndexable(d), keywords: tags, event: "league_view", active: "/matches", body });
}

export function renderHubPage(d: HubView): string {
  const title = "이번 주 축구 승부예측 · 리그별 경기 확률 분석 | HYEOKS";
  const url = `${SITE}/matches`;
  const desc = "EPL·라리가·세리에A·분데스리가·K리그·J리그·MLS·A매치 이번 주 경기별 홈승·무승부·원정승 확률과 출처·계산 시각을 리그별로 모았습니다.";
  const tags = ["축구 승부예측", "이번 주 축구 경기 분석", "해외축구 승부예측", "K리그 승부예측", "EPL 승부예측", "축구 경기 확률"];
  const total = [...d.byLeague.values()].reduce((s, l) => s + l.length, 0);
  const order = Object.keys(LEAGUE_INFO);
  const sections = [...d.byLeague.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([lg, list]) => { const li = leagueInfo(lg); return `<section class="card"><h2>${e(li.name)} <span style="color:var(--muted);font-weight:600;font-size:.85rem">${list.length}경기</span></h2><div class="rows">${list.slice(0, 10).map(rowHtml).join("")}</div><p class="note"><a href="/league/${li.slug}">${e(li.name)} 전체 보기 →</a></p></section>`; })
    .join("");
  const body = `<span class="eyebrow">경기 분석</span>
<h1>이번 주 축구 승부예측</h1>
<p class="sub">지원 리그 킥오프 3시간 전 이후 ~ 앞으로 8일 예정 경기 ${total}개</p>
<p class="note">각 경기의 확률 출처(통계 모델·해외 배당·국가대표 Elo)와 계산 시각은 경기 페이지에 함께 적습니다. 승무패 회차에 포함된 경기는 회차와 같은 확률을 보여줍니다. <a href="/methodology">계산 방법</a> · <a href="/sources">데이터 출처</a></p>
${sections || `<section class="card"><h2>예정 경기</h2><p class="note" style="margin:0">이 기간에 수집된 예정 경기가 없습니다. 승무패 회차는 <a href="/app">승무패 도구</a>에서 볼 수 있습니다.</p></section>`}`;
  return pageShell({ title, description: desc, canonical: url, indexable: hubIndexable(d), keywords: tags, event: "hub_view", active: "/matches", body });
}

/** 없는 경기·리그. 검색 제외, 공통 틀 유지(가짜 성공 페이지를 만들지 않는다). */
export function renderNotFoundPage(): string {
  return pageShell({
    title: "페이지를 찾을 수 없습니다 | HYEOKS 풋볼 데이터",
    description: "주소가 바뀌었거나 아직 분석이 만들어지지 않은 페이지입니다.",
    canonical: null, indexable: false, active: null,
    body: `<h1>페이지를 찾을 수 없습니다</h1><p class="sub">주소가 바뀌었거나 아직 분석이 만들어지지 않은 경기·리그입니다.</p>
<section class="card"><ul class="list"><li><a href="/matches">이번 주 경기 분석 보기</a></li><li><a href="/guide/">가이드 읽기</a></li><li><a href="/">홈으로</a></li></ul></section>`,
  });
}

/** 데이터 조회 실패. 내부 오류 문자열은 노출하지 않는다. */
export function renderUnavailablePage(): string {
  return pageShell({
    title: "잠시 후 다시 시도해 주세요 | HYEOKS 풋볼 데이터",
    description: "데이터를 불러오지 못했습니다.",
    canonical: null, indexable: false, active: null,
    body: `<h1>데이터를 불러오지 못했습니다</h1><p class="sub">잠시 후 다시 시도해 주세요. 그동안 <a href="/guide/">가이드</a>는 볼 수 있습니다.</p>`,
  });
}

/**
 * /match/{slug}/data.json. 기존 필드는 유지하고(schema 1) 원천 정보를 더했다.
 * basis는 예전에 "model"로 고정돼 있었으나 이제 실제 원천의 basis(model/market/national, 없으면 null)다.
 * 확률이 없으면 pHome·pDraw·pAway·pick·confidenceGap은 null이다.
 */
export function matchData(v: MatchView) {
  const hasP = v.provenance.kind !== "unavailable" && v.basis != null;
  const readiness = matchReadiness(v);
  return {
    schema: 1, slug: v.slug, league: v.league, competition: v.competition, leagueName: v.leagueName, kickoffAt: v.kickoffAt, home: v.home, away: v.away,
    pHome: hasP ? v.pHome : null, pDraw: hasP ? v.pDraw : null, pAway: hasP ? v.pAway : null, pick: hasP ? v.pick : null,
    confidenceGap: hasP ? v.confidenceGap : null,
    basis: hasP ? v.basis : null, basisLabel: v.basisLabel, withMarket: v.withMarket, nBookmakers: v.nBookmakers,
    probabilitySource: v.source, provenance: v.provenance, probabilityAsOf: v.probabilityAsOf,
    asOf: v.probabilityAsOf, // 예전 필드 이름(= probabilityAsOf)
    round: v.round, status: v.status, result: v.result, reasons: v.reasons, risks: v.risks, explanationNote: v.explanationNote,
    fixtureContext: v.context, calib: v.calib,
    indexable: readiness.ready, readinessGaps: readiness.gaps,
    tags: matchTags(v), pageUrl: `${SITE}/match/${v.slug}`,
    links: { methodology: `${SITE}/methodology`, sources: `${SITE}/sources`, performance: `${SITE}/performance` },
  };
}

// ---------- 앱의 '경기 분석' 목록(GET /api/matches) ----------
export interface MatchCard {
  slug: string;
  league: string;
  leagueName: string;
  competition: string | null;
  kickoffAt: string;
  home: string;
  away: string;
  homeEn: string; // 검색용(FotMob 표기, 국가대표는 결과 데이터셋 표기)
  awayEn: string;
  homeLogo: string | null;
  awayLogo: string | null;
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: Outcome;
  basisLabel: string;
  status: string;
  hg: number | null;
  ag: number | null;
  round: { roundNo: number; seq: number } | null;
  // 추가(선택) 필드: 상세 페이지·data.json과 같은 원천 정보
  basis: PredictionBasis;
  withMarket: boolean;
  probabilityAsOf: string | null;
  provenance: Provenance;
  ready: boolean;
}

/**
 * 지난 14일 ~ 앞으로 8일 경기 카드. resolveMatches로 상세 페이지와 같은 확률·basis·시각을 쓴다.
 * 검증된 확률이 없는 경기는 앱 카드에서 뺀다(앱은 확률 숫자를 전제로 그린다).
 */
export async function listMatchCards(env: Env, now = Date.now()): Promise<MatchCard[]> {
  const from = new Date(now - 14 * 86400e3).toISOString();
  const to = new Date(now + 8 * 86400e3).toISOString();
  const { results } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.kickoff_at >= ? AND f.kickoff_at <= ? AND f.status != 'cancelled' ORDER BY f.kickoff_at ASC, f.id ASC LIMIT 500`,
  )
    .bind(from, to)
    .all<MatchRow>();
  const rows = results ?? [];
  const resolved = await resolveMatches(env, rows, now);
  const out: MatchCard[] = [];
  for (const r of rows) {
    const x = resolved.get(r.id);
    const p = x?.probability;
    if (!x || !p) continue;
    const isNat = r.league === NATIONAL_LEAGUE;
    const hk = isNat ? null : teamKr(r.league, r.home_en);
    const ak = isNat ? null : teamKr(r.league, r.away_en);
    const li = leagueInfo(r.league);
    out.push({
      slug: r.slug, league: r.league, leagueName: li.name, competition: r.competition, kickoffAt: r.kickoff_at,
      home: nameOf(r, "home"), away: nameOf(r, "away"), homeEn: r.home_en, awayEn: r.away_en,
      homeLogo: isNat ? flagOf(r.home_en) : hk ? TEAM_LOGOS[hk] ?? null : null,
      awayLogo: isNat ? flagOf(r.away_en) : ak ? TEAM_LOGOS[ak] ?? null : null,
      pHome: p.pHome, pDraw: p.pDraw, pAway: p.pAway, pick: p.pick, basisLabel: basisLabelOf(p.basis, p.withMarket),
      status: r.status, hg: r.hg, ag: r.ag, round: x.round,
      basis: p.basis, withMarket: p.withMarket, probabilityAsOf: x.provenance.capturedAt, provenance: x.provenance,
      ready: readinessOf(r, x).ready,
    });
  }
  return out;
}

/**
 * 사이트맵용 항목. 경기 페이지와 같은 선택·판정 함수로 '준비된' 페이지만 넣는다(noindex 페이지 제외).
 * - 경기: 지난 60일 ~ 예정, matchContentReadiness 통과
 * - 리그: 리그 페이지 범위(킥오프 3시간 전 이후 예정 / 최근 21일 종료) 안에 준비된 경기가 있거나,
 *   순위표·Elo 순위 자료가 충분할 때(tablesMeaningful, loadRatingsOverview로 판정)
 * - 허브(/matches): 허브 범위(킥오프 3시간 전 이후 ~ 8일 예정) 안에 준비된 경기가 있을 때
 * 주소는 요청 origin이 아니라 대표 주소(SITE)로 고정한다. 두 번째 인자는 호출 호환용으로만 남겼다.
 */
export async function sitemapEntries(env: Env, _origin?: string, now = Date.now()): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.kickoff_at >= ? AND f.status != 'cancelled' ORDER BY f.kickoff_at DESC, f.id DESC LIMIT 3000`,
  )
    .bind(new Date(now - 60 * 86400e3).toISOString())
    .all<MatchRow>();
  const rows = results ?? [];
  const resolved = await resolveMatches(env, rows, now);
  const readyLeagues = new Set<string>();
  let hubReady = false;
  const matches: string[] = [];
  for (const r of rows) {
    const x = resolved.get(r.id);
    if (!x || !readinessOf(r, x).ready) continue;
    const k = ts(r.kickoff_at);
    if (r.status === "scheduled" && k >= now - 3 * 3600e3) {
      readyLeagues.add(r.league);
      if (k <= now + 8 * 86400e3) hubReady = true;
    }
    if (r.status === "finished" && k >= now - 21 * 86400e3) readyLeagues.add(r.league);
    const last = latestIso(r.updated_at, x.provenance.capturedAt) ?? r.updated_at;
    const lastDay = Number.isFinite(ts(last)) ? new Date(ts(last)).toISOString().slice(0, 10) : null;
    matches.push(`<url><loc>${SITE}/match/${r.slug}</loc>${lastDay ? `<lastmod>${lastDay}</lastmod>` : ""}</url>`);
  }
  // 리그 페이지는 순위표·Elo 순위가 있어도 색인한다(leagueIndexable과 같은 기준). 조회가 실패하면 경기 기준만 쓴다.
  try {
    const ov = await loadRatingsOverview(env, now);
    for (const l of ov.leagues) if (l.meaningful) readyLeagues.add(l.league);
    if ((ov.national?.length ?? 0) >= MIN_ELO_TEAMS) readyLeagues.add(NATIONAL_LEAGUE);
  } catch (err) {
    console.error(`sitemapEntries: 순위 자료 기준 생략 - ${(err as Error).message}`);
  }
  const leagues = Object.entries(LEAGUE_INFO).filter(([k]) => readyLeagues.has(k)).map(([, v]) => `<url><loc>${SITE}/league/${v.slug}</loc></url>`);
  return [...(hubReady ? [`<url><loc>${SITE}/matches</loc></url>`] : []), ...leagues, ...matches];
}
