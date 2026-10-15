// 강등 팀이 남은 Elo 전체 순위를 쓰면 차이가 부풀려지므로 현재 시즌 전 참가 팀 안에서 다시 매긴다.
import { seasonOf } from "./elo";
import { NATIONAL_LEAGUE } from "./fixtures";
import { compareRanks, compareStanding, rankElo, MIN_ELO_TEAMS, MIN_PLAYED_FOR_COMPARISON, MIN_STANDINGS_MATCHES, TIEBREAK_NOTE, type StandingRow } from "./leagueTables";
import { STANDINGS_SUPPRESSED, STANDINGS_LEAGUE_NOTES, tableTeamName, type RatingsOverview } from "./leagueTablesStore";
import { leagueInfo, LEAGUE_INFO } from "./teamNames";
import { renderSitePage, escapeText as e, fullKst } from "./publicSite";

export interface RankGapRow extends StandingRow {
  eloRank: number;
  elo: number;
  /** 순위표 순위 - 같은 참가 팀 안의 Elo 순위. 양수면 순위표 위치가 더 낮다. */
  gap: number;
}
export interface RankGapLeague {
  league: string;
  seasonLabel: string;
  matches: number;
  firstDate: string;
  lastDate: string;
  eloAsOf: string | null;
  rows: RankGapRow[];
  largest: RankGapRow[];
  minPlayed: number;
  maxPlayed: number;
}
export interface RankGapOverview {
  generatedAt: string;
  leagues: RankGapLeague[];
  excluded: { league: string; reason: string }[];
  truncated: boolean;
}
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const gapOrder = (a: RankGapRow, b: RankGapRow) => Math.abs(b.gap) - Math.abs(a.gap) || a.rank - b.rank || cmp(a.team, b.team);

/** 로더의 comparison/rank를 그대로 쓰지 않고 현재 시즌·전 참가 팀 일치를 확인해 다시 계산한다. */
export function computeRankGaps(input: RatingsOverview): RankGapOverview {
  const out: RankGapOverview = { generatedAt: input.generatedAt, leagues: [], excluded: [], truncated: input.truncated };
  const now = Date.parse(input.generatedAt);
  for (const l of input.leagues) {
    if (l.league === NATIONAL_LEAGUE || !Object.prototype.hasOwnProperty.call(LEAGUE_INFO, l.league)) continue;
    const s = l.standings;
    let reason: string | null = null;
    if (STANDINGS_SUPPRESSED[l.league] || l.standingsNote) reason = STANDINGS_SUPPRESSED[l.league] ?? l.standingsNote;
    else if (input.truncated) reason = "결과 자료가 조회 한도에 도달하여 비교를 중단했습니다.";
    else if (!s) reason = "현재 시즌의 순위표 자료가 없습니다.";
    else if (!Number.isFinite(now) || s.league !== l.league || s.season !== seasonOf(l.league, input.generatedAt)) reason = "현재 시즌 자료가 아니어서 비교에서 제외했습니다.";
    else if (s.rows.length < MIN_ELO_TEAMS || s.matches < MIN_STANDINGS_MATCHES) reason = "비교에 필요한 팀 수 또는 저장 경기 수가 부족합니다.";
    else if (new Set(s.rows.map((r) => r.team)).size !== s.rows.length || s.rows.some((r) => !r.team || !Number.isInteger(r.played) || r.played < MIN_PLAYED_FOR_COMPARISON || ![r.points, r.gd, r.gf].every(Number.isFinite))) reason = "모든 팀이 최소 경기 수를 채운 유효한 현재 시즌 자료가 필요합니다.";
    if (reason || !s) { out.excluded.push({ league: l.league, reason: reason ?? "자료 부족" }); continue; }
    const ordered = [...s.rows].sort(compareStanding).map((r, i) => ({ ...r, rank: i + 1 }));
    const cohort = new Set(ordered.map((r) => r.team));
    const elo = rankElo(l.elo, { teams: cohort });
    // 일부 팀만으로 다시 매긴 순위를 전체 순위표처럼 표시하지 않는다.
    if (elo.length !== ordered.length) {
      out.excluded.push({ league: l.league, reason: "현재 시즌 참가 팀 전체의 Elo가 없어 비교를 보류합니다." });
      continue;
    }
    const comparison = compareRanks({ ...s, rows: ordered }, elo);
    if (!comparison || comparison.n !== ordered.length) continue;
    const gapOf = new Map(comparison.gaps.map((g) => [g.team, g]));
    const eloOf = new Map(elo.map((r) => [r.team, r]));
    const rows = ordered.map((r): RankGapRow => ({ ...r, eloRank: gapOf.get(r.team)!.eloRank, gap: gapOf.get(r.team)!.gap, elo: eloOf.get(r.team)!.elo }));
    const dates = elo.map((r) => r.lastMatchDate).filter((d): d is string => d != null && Number.isFinite(Date.parse(d))).sort((a, b) => Date.parse(a) - Date.parse(b));
    out.leagues.push({ league: l.league, seasonLabel: s.seasonLabel, matches: s.matches, firstDate: s.firstDate, lastDate: s.lastDate, eloAsOf: dates.length ? dates[dates.length - 1] : null, rows, largest: [...rows].sort(gapOrder).filter((r) => r.gap !== 0).slice(0, 3), minPlayed: Math.min(...rows.map((r) => r.played)), maxPlayed: Math.max(...rows.map((r) => r.played)) });
  }
  return out;
}
export function rankGapIndexable(ov: RankGapOverview): boolean { return ov.leagues.length >= 2; }
const signed = (n: number) => n > 0 ? "+" + n : String(n);
function finding(l: RankGapLeague, r: RankGapRow): string {
  return e(tableTeamName(l.league, r.team)) + ": 순위표 " + r.rank + "위, 같은 참가 팀 안 Elo " + r.eloRank + "위, 차이 " + signed(r.gap) + "계단 · " + r.played + "경기 " + r.points + "승점, 득실차 " + signed(r.gd);
}
function panel(l: RankGapLeague, index: number): string {
  const info = leagueInfo(l.league);
  const id = "rank-gap-" + index;
  const matched = l.rows.filter((r) => r.gap === 0).length;
  const largest = l.largest[0];
  const summary = largest ? "가장 큰 절대 차이는 " + Math.abs(largest.gap) + "계단입니다. 아래에는 차이가 큰 순서로 최대 세 팀을 표시합니다. 동률이면 순위표 순서를 따릅니다." : "두 순위가 모든 팀에서 같습니다.";
  const rows = l.rows.map((r) => '<tr><th scope="row">' + e(tableTeamName(l.league, r.team)) + '</th><td>' + r.played + '</td><td>' + r.points + '</td><td>' + signed(r.gd) + '</td><td>' + r.rank + '</td><td>' + r.eloRank + '</td><td>' + signed(r.gap) + '</td></tr>').join("");
  return '<section class="site-panel" aria-labelledby="' + id + '-heading"><h2 id="' + id + '-heading">' + e(info.name) + ' · ' + e(l.seasonLabel) + '</h2><p>' + l.rows.length + '팀, 저장 결과 ' + l.matches + '경기를 비교했습니다. 팀별 경기 수는 ' + l.minPlayed + '~' + l.maxPlayed + '경기이며 두 순위가 같은 팀은 ' + matched + '팀입니다. ' + summary + '</p>' + (l.largest.length ? '<ul>' + l.largest.map((r) => '<li>' + finding(l, r) + '</li>').join("") + '</ul>' : '') + (STANDINGS_LEAGUE_NOTES[l.league] ? '<p class="site-callout">' + e(STANDINGS_LEAGUE_NOTES[l.league]) + '</p>' : '') + '<div class="site-table-wrap" role="region" aria-labelledby="' + id + '-caption" tabindex="0"><table><caption id="' + id + '-caption">' + e(info.name) + ' 현재 시즌 참가 팀 전체 비교 · 자체 집계(공식 순위 아님)</caption><thead><tr>' + ["팀", "경기", "승점", "득실차", "순위표 순위", "동일 팀 Elo 순위", "차이(순위표−Elo)"].map((h) => '<th scope="col">' + e(h) + '</th>').join("") + '</tr></thead><tbody>' + rows + '</tbody></table></div><p class="site-note">결과 반영 기간 ' + e(l.firstDate) + ' ~ ' + e(l.lastDate) + ' · 참가 팀 Elo의 가장 최근 반영 경기 ' + e(fullKst(l.eloAsOf)) + '. 팀마다 마지막 경기 시점은 다를 수 있습니다.</p><p><a href="/league/' + e(info.slug) + '">' + e(info.name) + ' 원자료 표와 경기 보기</a></p></section>';
}

export function renderRankGapPage(ov: RankGapOverview): string {
  const body = '<section class="site-intro"><p class="site-eyebrow">데이터로 읽는 축구</p><h1>순위와 전력은 왜 다를까?</h1><p>시즌 순위표와 Elo는 같은 경기 결과를 서로 다른 질문으로 읽습니다. 순위표는 이번 시즌에 쌓은 성적의 순서이고, Elo는 상대를 고려하며 이어 온 결과 기반 전력 지수의 순서입니다. 어느 한쪽이 진짜 순위라는 뜻은 아닙니다. 지금 저장된 결과에서 두 순서가 얼마나 다른지 직접 확인해 봅니다.</p><p class="site-note">집계 시각 ' + e(fullKst(ov.generatedAt)) + ' · HYEOKS 자체 집계 · 비교 가능 ' + ov.leagues.length + '개 클럽 리그</p></section>' +
  '<section class="site-panel" aria-labelledby="reading"><h2 id="reading">먼저, 비교 대상을 맞춥니다</h2><p>승격·강등이 있는 리그의 Elo 저장 목록에는 지난 시즌 참가 팀도 남을 수 있습니다. 그 목록의 순위를 현재 시즌 순위표 옆에 그대로 놓으면 서로 다른 분모를 비교하게 됩니다. 이 페이지는 집계 시각이 속한 시즌의 순위표 참가 팀만 남기고, 그 팀들 사이에서 Elo 순위를 다시 매깁니다. 국가대표와 지난 시즌 표는 제외합니다. 모든 참가 팀에 유효한 Elo가 있어야 하며, 일부 팀만 골라 빈자리를 채우지 않습니다.</p><p>비교를 시작하는 최소 조건은 ' + MIN_ELO_TEAMS + '팀 이상, 모든 팀이 이번 시즌 ' + MIN_PLAYED_FOR_COMPARISON + '경기 이상입니다. 이는 자료를 읽기 위한 하한선이지 전력 평가가 확정됐다는 기준은 아닙니다. 여기서 참가 팀은 저장된 현재 시즌 경기 결과에 등장한 팀을 뜻합니다. 아직 수집되지 않은 팀이나 결과가 있으면 시즌 전체를 완전하게 반영하지 못할 수 있습니다. J1리그는 기존 시즌 구분이 실제 대회 구분과 맞지 않아 비교에서 제외합니다.</p><h3>차이의 부호 읽기</h3><p><strong>차이 = 자체 집계 순위표 순위 − 같은 참가 팀 안의 Elo 순위</strong>입니다. 양수(+)는 Elo 순위보다 순위표의 위치가 낮다는 뜻이며, 음수(−)는 순위표의 위치가 더 높다는 뜻입니다. 0이면 두 위치가 같습니다. 이는 순위의 간격이지 Elo 점수 차이나 승점 차이가 아닙니다. 참가 팀 수가 다른 리그의 같은 간격도 같은 크기의 전력 차이를 뜻하지 않습니다.</p></section>' +
  (ov.leagues.length ? ov.leagues.map(panel).join("") : '<section class="site-panel"><h2>비교 자료를 기다리고 있습니다</h2><p>현재 시즌 참가 팀 전체가 비교 조건을 충족한 리그가 없습니다. 없는 순위나 차이는 추정해 채우지 않습니다. 아래 자료 범위 안내와 전력 순위 페이지를 확인해 주세요.</p></section>') +
  '<section class="site-panel" aria-labelledby="interpret"><h2 id="interpret">표에서 알 수 있는 것과 없는 것</h2><p>순위표는 승리·무승부·패배를 승점으로 바꾸고 이번 시즌 안에서 누적합니다. Elo는 한 경기의 상대와 결과를 바탕으로 갱신되고, 이전 시즌에서 이어지는 정보도 포함합니다. 따라서 같은 현재 성적을 가진 팀이라도 Elo의 출발점과 지나온 결과의 순서가 다를 수 있습니다. 다만 이 표만으로 특정 팀의 차이가 왜 생겼는지는 확인할 수 없습니다. 선수 부상, 경기 내용이나 일정의 영향을 개별 팀의 원인으로 단정하지 않습니다.</p><p>경기 수가 서로 다르면 같은 승점도 해석의 조건이 달라집니다. 그래서 차이가 큰 팀의 이름만 보지 않고 경기 수·승점·득실차를 함께 표시합니다. 순위표가 비슷해도 Elo 순위가 다를 수 있고 그 반대도 가능합니다. 표의 해설은 관측된 위치와 간격만 기술하며 원인이나 향후 결과를 덧붙이지 않습니다.</p><p><strong>Elo 순위는 예상 최종 순위가 아닙니다.</strong> 순위 차이가 있다는 사실은 이후 성적이 되돌아가거나 두 순위가 수렴한다는 증거가 아닙니다. 어느 팀의 다음 경기 승리나 시즌 최종 위치도 이 표로 보장할 수 없습니다. Elo가 실제 예측에서 어떻게 쓰이는지는 <a href="/methodology">계산 방법</a>에서, 경기 전에 저장된 예측의 관측 성적은 <a href="/performance">예측 기록</a>에서 별도로 확인해야 합니다.</p><h3>자체 집계의 한계</h3><p>' + e(TIEBREAK_NOTE) + ' 승점 삭감과 리그 고유 규정은 반영하지 않습니다. 따라서 이 페이지의 순위는 공식 순위가 아닙니다. 시즌 데이터는 수집 누락·지연으로 불완전할 수 있고, 표시된 마지막 경기일은 모든 결과가 빠짐없이 들어왔다는 보증이 아닙니다. Elo와 결과 저장 시점도 다를 수 있습니다.</p></section>' +
  '<section class="site-panel"><h2>출처와 자료 범위</h2><p>원자료는 사이트에 저장한 FotMob 경기 결과와 HYEOKS 클럽 Elo입니다. 승점·득실차·정렬은 저장 결과로 다시 계산합니다. 표의 결과 반영 기간과 집계 시각을 함께 확인해 주세요. <a href="/sources">데이터 출처와 주의사항</a>에서 수집 범위를 설명합니다.</p>' + (ov.truncated ? '<p class="site-callout">최근 경기 조회가 한도에 도달해 전체 비교를 중단했습니다.</p>' : '') + (ov.excluded.length ? '<h3>이번 비교에서 제외한 리그</h3><ul>' + ov.excluded.map((x) => '<li>' + e(leagueInfo(x.league).name) + ': ' + e(x.reason) + '</li>').join("") + '</ul>' : '') + '<p><a href="/ratings">리그별 전력 순위</a> · <a href="/insights/draw-rates">리그별 무승부 비율</a></p><p class="site-note">이 자료는 축구 통계 이해를 위한 정보이며 적중이나 수익을 보장하지 않습니다. 스포츠토토 구매는 만 19세 이상, 공식 판매처에서만 가능합니다. 도박 문제 상담 1336.</p></section>';
  return renderSitePage({ title: "순위와 전력은 왜 다를까?", description: "현재 시즌 같은 참가 팀 안에서 자체 집계 순위표와 Elo 순위를 비교합니다. 경기 수·승점·득실차와 순위 차이를 함께 읽고 해석의 한계를 설명합니다.", path: "/insights/rank-gap", body, noindex: !rankGapIndexable(ov), event: "rank_gap_view" });
}
