// /insights/draw-rates: 리그·시즌별 홈승·무승부·원정승 비율(SSR, 조건부 색인).
//
// 왜 만들었나: "이 리그는 무승부가 많은가", "홈 이점이 얼마나 되나"는 독자가 실제로 묻는 질문이고,
// 우리 DB(matches)에 이미 있는 결과로 바로 답할 수 있다. 모델도 리그 무승부 비율을 입력으로 쓰므로
// 그 값이 어디서 오는지 보여주는 자료가 된다.
//
// 원칙
// - 계산은 순수 함수(computeDrawRates)로 하고 화면은 그 결과만 그린다. 설명 문장의 숫자는 모두 집계값에서 온다.
// - 시즌 경계는 elo.ts의 seasonOf를 그대로 쓴다(순위표·Elo와 같은 시즌 구분).
// - 원인은 지어내지 않는다. 리그 간 차이의 이유는 '가능성'으로만 적고 자료로 확인한 것처럼 쓰지 않는다.
// - 확률·구매 권유 표현을 쓰지 않는다. 광고 스크립트도 넣지 않는다(renderSitePage에는 광고 로더가 없다).
import { renderSitePage, escapeText as e, fullKst } from "./publicSite";
import { leagueInfo, LEAGUE_INFO } from "./teamNames";
import { NATIONAL_LEAGUE } from "./fixtures";
import { seasonOf, homeAdvForLeague, HOME_ADV, type MatchRow } from "./elo";
import { isValidResult, seasonLabel } from "./leagueTables";

/** 시즌 한 줄을 보여줄 최소 경기 수. 미만이면 비율 대신 '표본 부족'. */
export const MIN_SEASON_MATCHES = 30;
/** 현재 시즌과 함께 보여줄 지난 시즌 수. */
export const PREVIOUS_SEASONS = 3;
/** 색인 조건: 한 시즌에 이만큼 이상 쌓인 리그가 INDEX_MIN_LEAGUES개 이상. */
export const INDEX_MIN_SEASON_MATCHES = 100;
export const INDEX_MIN_LEAGUES = 4;
/** J1리그는 시즌 방식이 바뀌어 역년 구분이 공식 시즌과 다를 수 있다(leagueTablesStore STANDINGS_SUPPRESSED와 같은 사실). */
const CALENDAR_NOTE_LEAGUES = new Set(["J1리그"]);
export const J1_SEASON_NOTE =
  "J1리그는 2026-27 시즌부터 8월 개막 방식으로 바뀌었습니다. 이 표는 1~12월 역년 기준으로 묶기 때문에 공식 시즌 구분과 다를 수 있습니다.";

export interface OutcomeSplit {
  matches: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  /** 0~1 비율. 경기가 없으면 null. */
  homeRate: number | null;
  drawRate: number | null;
  awayRate: number | null;
  avgGoals: number | null;
  firstDate: string | null;
  lastDate: string | null;
}
export interface SeasonSplit extends OutcomeSplit {
  season: number;
  label: string;
  /** 오늘 날짜가 속한 시즌인가. */
  current: boolean;
  /** MIN_SEASON_MATCHES 이상인가. */
  enough: boolean;
}
export interface LeagueSplit {
  league: string;
  name: string;
  slug: string;
  /** 시즌을 역년(1~12월)으로 묶었고 공식 시즌과 다를 수 있다는 안내가 필요한가. */
  calendarNote: boolean;
  currentSeason: number;
  /** 현재 시즌부터 최신순. */
  seasons: SeasonSplit[];
  /** 최근 완료 시즌(현재 시즌 직전 PREVIOUS_SEASONS개) 합계. */
  summary: OutcomeSplit & { seasons: number[]; label: string; enough: boolean };
}
export interface DrawRatesOverview {
  generatedAt: string;
  leagues: LeagueSplit[];
  /** 표에 반영된(현재+지난 시즌) 경기 수 합계. */
  totalMatches: number;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 결과 목록의 홈승·무승부·원정승 집계. rows는 이미 유효성 검사를 통과한 것만 넘긴다. */
export function outcomeSplit(rows: readonly MatchRow[]): OutcomeSplit {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goals = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const r of rows) {
    if (r.hg > r.ag) homeWins++;
    else if (r.hg === r.ag) draws++;
    else awayWins++;
    goals += r.hg + r.ag;
    if (firstDate == null || r.date < firstDate) firstDate = r.date;
    if (lastDate == null || r.date > lastDate) lastDate = r.date;
  }
  const n = rows.length;
  return {
    matches: n,
    homeWins,
    draws,
    awayWins,
    homeRate: n ? homeWins / n : null,
    drawRate: n ? draws / n : null,
    awayRate: n ? awayWins / n : null,
    avgGoals: n ? goals / n : null,
    firstDate,
    lastDate,
  };
}

/** 표시용 시즌 이름. J1리그는 역년 기준임을 붙인다. */
export function drawSeasonLabel(league: string, season: number): string {
  const base = seasonLabel(league, season);
  return CALENDAR_NOTE_LEAGUES.has(league) ? `${base} 역년 기준(1~12월)` : base;
}

/** 클럽 리그 목록(/ratings와 같은 순서·이름). */
export function drawRateLeagues(): string[] {
  return Object.keys(LEAGUE_INFO).filter((l) => l !== NATIONAL_LEAGUE);
}

/**
 * 리그별로 현재 시즌과 지난 PREVIOUS_SEASONS개 시즌의 비율을 계산한다.
 * rows는 getAllMatches(팀명 정규화·중복 제거 완료)의 결과를 그대로 넘긴다. 이상한 줄은 isValidResult로 거른다.
 */
export function computeDrawRates(rows: readonly MatchRow[], now = Date.now()): DrawRatesOverview {
  const today = isoDay(now);
  const byLeague = new Map<string, MatchRow[]>();
  for (const r of rows) {
    if (!isValidResult(r)) continue;
    const list = byLeague.get(r.league);
    if (list) list.push(r);
    else byLeague.set(r.league, [r]);
  }

  let totalMatches = 0;
  const leagues: LeagueSplit[] = [];
  for (const league of drawRateLeagues()) {
    const info = leagueInfo(league);
    const currentSeason = seasonOf(league, today);
    const bySeason = new Map<number, MatchRow[]>();
    for (const r of byLeague.get(league) ?? []) {
      const s = seasonOf(league, r.date);
      if (s > currentSeason || s < currentSeason - PREVIOUS_SEASONS) continue;
      const list = bySeason.get(s);
      if (list) list.push(r);
      else bySeason.set(s, [r]);
    }
    const seasons: SeasonSplit[] = [];
    for (let s = currentSeason; s >= currentSeason - PREVIOUS_SEASONS; s--) {
      const split = outcomeSplit(bySeason.get(s) ?? []);
      totalMatches += split.matches;
      seasons.push({ ...split, season: s, label: drawSeasonLabel(league, s), current: s === currentSeason, enough: split.matches >= MIN_SEASON_MATCHES });
    }
    const completed = seasons.filter((s) => !s.current);
    const summaryRows = completed.flatMap((s) => bySeason.get(s.season) ?? []);
    const withData = completed.filter((s) => s.matches > 0).map((s) => s.season);
    const summarySplit = outcomeSplit(summaryRows);
    const summaryLabel = withData.length
      ? withData.length === 1
        ? drawSeasonLabel(league, withData[0])
        : `${seasonLabel(league, Math.min(...withData))}~${seasonLabel(league, Math.max(...withData))}`
      : "-";
    leagues.push({
      league,
      name: info.name,
      slug: info.slug,
      calendarNote: CALENDAR_NOTE_LEAGUES.has(league),
      currentSeason,
      seasons,
      summary: { ...summarySplit, seasons: withData, label: summaryLabel, enough: summarySplit.matches >= MIN_SEASON_MATCHES },
    });
  }
  return { generatedAt: new Date(now).toISOString(), leagues, totalMatches };
}

/** 색인 여부: 한 시즌에 INDEX_MIN_SEASON_MATCHES경기 이상 쌓인 리그가 INDEX_MIN_LEAGUES개 이상일 때만. */
export function drawRatesIndexable(ov: DrawRatesOverview): boolean {
  return ov.leagues.filter((l) => l.seasons.some((s) => s.matches >= INDEX_MIN_SEASON_MATCHES)).length >= INDEX_MIN_LEAGUES;
}

// ---------- 화면 ----------

const pct = (x: number | null) => (x == null ? "-" : `${(x * 100).toFixed(1)}%`);
const fmtGoals = (x: number | null) => (x == null ? "-" : x.toFixed(2));

const tableWrap = (id: string, caption: string, head: string[], rows: string) =>
  `<div class="site-table-wrap" role="region" aria-labelledby="${id}" tabindex="0"><table><caption id="${id}">${e(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${e(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;

function seasonRow(s: SeasonSplit): string {
  const status = s.current ? (s.matches > 0 ? "진행 중" : "시작 전") : "완료";
  const head = `<th scope="row">${e(s.label)}</th><td>${status}</td><td>${s.matches}</td>`;
  if (!s.enough) return `<tr>${head}<td colspan="5">표본 부족(${MIN_SEASON_MATCHES}경기 미만)</td></tr>`;
  return `<tr>${head}<td>${pct(s.homeRate)}</td><td>${pct(s.drawRate)}</td><td>${pct(s.awayRate)}</td><td>${fmtGoals(s.avgGoals)}</td><td>${e(s.firstDate ?? "-")} ~ ${e(s.lastDate ?? "-")}</td></tr>`;
}

function leaguePanel(l: LeagueSplit): string {
  const id = `d-${l.slug}`;
  const table = tableWrap(
    id,
    `${l.name} 시즌별 홈승·무승부·원정승 비율`,
    ["시즌", "상태", "경기 수", "홈승", "무승부", "원정승", "경기당 골", "기간(UTC 날짜)"],
    l.seasons.map(seasonRow).join(""),
  );
  const note = l.calendarNote ? `<p class="site-note">${e(J1_SEASON_NOTE)}</p>` : "";
  return `<section class="site-panel" aria-labelledby="h-${l.slug}"><h2 id="h-${l.slug}">${e(l.name)}</h2>${note}${table}<p><a href="/league/${l.slug}">${e(l.name)} 경기·순위표 보기</a></p></section>`;
}

function summarySection(ov: DrawRatesOverview): string {
  const rows = ov.leagues
    .map((l) => {
      const s = l.summary;
      const head = `<th scope="row">${e(l.name)}</th><td>${e(s.label)}</td><td>${s.matches}</td>`;
      if (!s.enough) return `<tr>${head}<td colspan="4">표본 부족(${MIN_SEASON_MATCHES}경기 미만)</td></tr>`;
      return `<tr>${head}<td>${pct(s.homeRate)}</td><td>${pct(s.drawRate)}</td><td>${pct(s.awayRate)}</td><td>${fmtGoals(s.avgGoals)}</td></tr>`;
    })
    .join("");
  return `<section class="site-panel" aria-labelledby="h-summary"><h2 id="h-summary">최근 완료 시즌 합계</h2><p class="site-note">리그마다 현재 시즌 직전 ${PREVIOUS_SEASONS}개 시즌(진행 중인 시즌 제외)을 합친 값입니다.</p>${tableWrap("d-summary", `리그별 최근 완료 ${PREVIOUS_SEASONS}시즌 합계`, ["리그", "시즌", "경기 수", "홈승", "무승부", "원정승", "경기당 골"], rows)}${highlights(ov)}</section>`;
}

/** 요약 표에서 바로 읽을 수 있는 사실만 문장으로 만든다(숫자는 모두 집계값). */
export function highlights(ov: DrawRatesOverview): string {
  const ok = ov.leagues.filter((l) => l.summary.enough);
  if (ok.length === 0) return `<p>최근 완료 시즌 자료가 충분히 쌓인 리그가 아직 없어 리그 간 비교 문장은 생략합니다.</p>`;
  const parts: string[] = [];
  const pooled = outcomeTotals(ok.map((l) => l.summary));
  parts.push(
    `표본이 충분한 ${ok.length}개 리그의 최근 완료 시즌 ${pooled.matches}경기를 합치면 홈승 ${pct(pooled.homeRate)}, 무승부 ${pct(pooled.drawRate)}, 원정승 ${pct(pooled.awayRate)}입니다.`,
  );
  const homeAhead = ok.filter((l) => (l.summary.homeRate ?? 0) > (l.summary.awayRate ?? 0)).length;
  parts.push(`${ok.length}개 리그 중 ${homeAhead}개 리그에서 홈승 비율이 원정승 비율보다 높았습니다.`);
  if (ok.length >= 2) {
    const byDraw = ok.slice().sort((a, b) => (b.summary.drawRate ?? 0) - (a.summary.drawRate ?? 0));
    const hi = byDraw[0];
    const lo = byDraw[byDraw.length - 1];
    parts.push(
      `무승부 비율이 가장 높은 리그는 ${e(hi.name)}(${pct(hi.summary.drawRate)}), 가장 낮은 리그는 ${e(lo.name)}(${pct(lo.summary.drawRate)})로 두 리그의 차이는 ${(((hi.summary.drawRate ?? 0) - (lo.summary.drawRate ?? 0)) * 100).toFixed(1)}%p입니다.`,
    );
  }
  return `<p>${parts.join(" ")}</p>`;
}

function outcomeTotals(xs: readonly OutcomeSplit[]): { matches: number; homeRate: number | null; drawRate: number | null; awayRate: number | null } {
  const n = xs.reduce((s, x) => s + x.matches, 0);
  const h = xs.reduce((s, x) => s + x.homeWins, 0);
  const d = xs.reduce((s, x) => s + x.draws, 0);
  const a = xs.reduce((s, x) => s + x.awayWins, 0);
  return { matches: n, homeRate: n ? h / n : null, drawRate: n ? d / n : null, awayRate: n ? a / n : null };
}

// 홈 이점이 기본값과 다른 리그(elo.ts homeAdvForLeague)를 코드 값 그대로 적는다.
function homeAdvExceptions(ov: DrawRatesOverview): string {
  const xs = ov.leagues.filter((l) => homeAdvForLeague(l.league) !== HOME_ADV).map((l) => `${l.name} +${homeAdvForLeague(l.league)}점`);
  return xs.length ? `, ${xs.join(", ")}` : "";
}

function explainSection(ov: DrawRatesOverview): string {
  return `<section class="site-panel site-prose" aria-labelledby="h-explain"><h2 id="h-explain">이 숫자를 읽는 법</h2>
<h3>홈 이점과 무승부 비율</h3>
<p>홈승 비율이 원정승 비율보다 높다면 그 리그에서는 홈팀이 결과상 유리했다는 뜻입니다. 이를 흔히 홈 이점이라고 부릅니다. 무승부 비율은 전체 경기 가운데 같은 점수로 끝난 경기의 비중입니다. 세 비율은 같은 경기들을 나눈 것이라 합치면 100%가 됩니다(반올림 때문에 0.1%p 정도 어긋날 수 있습니다).</p>
<h3>리그마다 다른 이유</h3>
<p>원정 이동 거리, 경기장 분위기, 팀 간 전력 차이, 경기 일정의 빡빡함 같은 요인이 차이를 만들 수 있습니다. 다만 이 페이지의 자료는 결과만 담고 있어 어떤 요인이 얼마나 작용했는지는 가릴 수 없습니다. 한 시즌 수백 경기 규모에서는 우연에 따른 흔들림도 작지 않으므로, 한 시즌의 차이보다 여러 시즌에 걸쳐 같은 방향이 유지되는지를 보는 편이 안전합니다.</p>
<h3>HYEOKS 모델과의 관계</h3>
<p>HYEOKS 확률 모델은 리그마다 저장된 전체 경기의 무승부 비율을 무승부 확률의 기준값으로 씁니다. 두 팀의 Elo 차이가 클수록 이 기준값을 낮추는 보정을 거친 뒤, 남은 확률을 Elo 차이와 홈 이점(기본 +${HOME_ADV}점${homeAdvExceptions(ov)})에 따라 홈승과 원정승으로 나눕니다. 리그 무승부 비율은 새 경기 결과가 저장될 때 다시 계산합니다. 모델이 쓰는 값은 시즌을 나누지 않은 전체 기록 기준이라 위 시즌별 표의 숫자와 다를 수 있습니다. 해외 배당 정보가 있는 경기는 배당에서 계산한 확률과 섞어 최종 확률을 냅니다. 자세한 내용은 <a href="/methodology">계산 방법</a>에 있습니다.</p>
<h3>한계</h3>
<ul>
<li>HYEOKS에 저장된 결과만 집계합니다. 수집 과정에서 빠진 경기가 있을 수 있으며 공식 통계가 아닙니다.</li>
<li>날짜는 UTC 기준입니다. 한국 시간과 하루 차이가 날 수 있고, 시즌 경계 부근 경기는 다른 시즌으로 묶일 수 있습니다.</li>
<li>EPL·세리에A·라리가·분데스리가는 7월 1일을 경계로, 나머지 리그는 1~12월 역년으로 시즌을 나눕니다(Elo 계산과 같은 기준).</li>
<li>같은 경기가 팀명 표기 차이로 두 번 저장된 경우에는 한 번만 셉니다.</li>
<li>현재 시즌은 오늘 날짜로 정하므로, 시즌이 끝난 뒤 다음 시즌이 시작되기 전까지도 '진행 중'으로 표시될 수 있습니다.</li>
</ul>
</section>`;
}

export function renderDrawRatesPage(ov: DrawRatesOverview): string {
  const body = `<section class="site-intro">
<p class="site-eyebrow">리그 데이터</p>
<h1>리그별 홈승·무승부·원정승 비율</h1>
<p>HYEOKS가 저장한 경기 결과 ${ov.totalMatches}경기를 리그와 시즌별로 나눠 홈팀 승리, 무승부, 원정팀 승리 비율과 경기당 평균 골을 계산했습니다. 시즌별 경기가 ${MIN_SEASON_MATCHES}경기 미만이면 비율 대신 '표본 부족'으로 표시합니다.</p>
<p class="site-note">집계 시각 ${e(fullKst(ov.generatedAt))} · <a href="/ratings">리그별 Elo 전력 순위</a> · <a href="/methodology">계산 방법</a> · <a href="/performance">예측 기록</a></p>
</section>
${summarySection(ov)}
${ov.leagues.map(leaguePanel).join("")}
${explainSection(ov)}`;
  return renderSitePage({
    title: "리그별 홈승·무승부·원정승 비율",
    description: "K리그·J리그·MLS·EPL·세리에A·라리가·분데스리가의 시즌별 홈승·무승부·원정승 비율과 경기당 평균 골을 HYEOKS 저장 결과로 집계하고, 숫자를 읽는 법과 한계를 설명합니다.",
    path: "/insights/draw-rates",
    body,
    noindex: !drawRatesIndexable(ov),
    event: "draw_rates_view",
  });
}
