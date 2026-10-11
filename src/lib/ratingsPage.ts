// /ratings: 리그별 Elo 전력 상위 팀과 자체 집계 순위표 순위를 한 화면에 모은 공개 페이지(SSR, 색인 대상).
//
// 왜 만들었나: 리그 페이지마다 흩어진 순위 자료를 한 번에 비교할 입구가 없었고, "순위표 순위와 Elo 순위가 왜
// 다른가"는 독자가 실제로 묻는 질문이다. 설명의 숫자(일치도·가장 큰 차이)는 모두 지금 DB 자료로 계산한다.
// 확률·구매와 관련된 표현은 쓰지 않는다. 광고 스크립트도 넣지 않는다(renderSitePage는 광고 로더가 없다).
import { renderSitePage, escapeText as e, fullKst } from "./publicSite";
import { leagueInfo } from "./teamNames";
import { NATIONAL_LEAGUE } from "./fixtures";
import { K_FACTOR, SEASON_REGRESSION, HOME_ADV } from "./elo";
import { MIN_PLAYED_FOR_COMPARISON, MIN_ELO_TEAMS, type RankGap } from "./leagueTables";
import { tableTeamName, type RatingsOverview, type LeagueOverview } from "./leagueTablesStore";

const TOP = 5;

/** 색인 여부: 리그 하나라도 순위 자료가 충분하거나 국가대표 순위가 있으면 색인한다. */
export function ratingsIndexable(ov: RatingsOverview): boolean {
  return ov.leagues.some((l) => l.meaningful) || (ov.national?.length ?? 0) >= MIN_ELO_TEAMS;
}

const tableWrap = (id: string, caption: string, head: string[], rows: string, compact = false) =>
  `<div class="site-table-wrap" role="region" aria-labelledby="${id}" tabindex="0"><table${compact ? ' style="min-width:0"' : ""}><caption id="${id}">${e(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${e(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;

function leaguePanel(l: LeagueOverview): string {
  const info = leagueInfo(l.league);
  const tableRank = new Map<string, number>();
  for (const r of l.standings?.rows ?? []) tableRank.set(r.team, r.rank);
  const meta = l.standings
    ? `${l.standings.seasonLabel} 시즌 · 결과 ${l.standings.matches}경기 반영 · 마지막 반영 ${l.standings.lastDate}`
    : l.standingsNote
      ? "자체 집계 순위표는 시즌 구분 문제로 표시하지 않습니다(리그 페이지 안내 참고)."
      : "이번 시즌 저장된 결과가 없습니다.";
  const top = l.elo.slice(0, TOP);
  const body = top.length
    ? tableWrap(
        `r-${info.slug}`,
        `${info.name} Elo 상위 ${top.length}팀`,
        ["Elo 순위", "팀", "Elo", "순위표"],
        top
          .map((r) => `<tr><td>${r.rank}</td><th scope="row">${e(tableTeamName(l.league, r.team))}</th><td>${Math.round(r.elo)}</td><td>${tableRank.has(r.team) ? `${tableRank.get(r.team)}위` : "-"}</td></tr>`)
          .join(""),
        true,
      )
    : `<p class="site-note">표시할 Elo 자료가 없습니다.</p>`;
  return `<section class="site-panel" aria-labelledby="h-${info.slug}"><h2 id="h-${info.slug}">${e(info.name)}</h2><p class="site-note">${e(meta)}</p>${body}<p><a href="/league/${info.slug}">${e(info.name)} 순위표·Elo 전체 보기</a></p></section>`;
}

function nationalPanel(ov: RatingsOverview): string {
  const info = leagueInfo(NATIONAL_LEAGUE);
  if (ov.national == null) {
    return `<section class="site-panel"><h2>국가대표</h2><p class="site-note">국가대표 Elo를 지금 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.</p></section>`;
  }
  const top = ov.national.slice(0, TOP);
  const body = top.length
    ? tableWrap(
        "r-national",
        `국가대표 Elo 상위 ${top.length}개국`,
        ["순위", "국가", "Elo", "A매치"],
        top.map((r) => `<tr><td>${r.rank}</td><th scope="row">${e(tableTeamName(NATIONAL_LEAGUE, r.team))}</th><td>${Math.round(r.elo)}</td><td>${r.matches ?? "-"}</td></tr>`).join(""),
        true,
      )
    : `<p class="site-note">표시할 국가대표 Elo 자료가 없습니다.</p>`;
  return `<section class="site-panel" aria-labelledby="h-national"><h2 id="h-national">국가대표</h2><p class="site-note">레이팅 갱신 ${e(fullKst(ov.nationalAsOf))}</p>${body}<p><a href="/league/${info.slug}">국가대표 Elo 상위 30개국 보기</a></p></section>`;
}

function gapText(league: string, g: RankGap): string {
  const name = tableTeamName(league, g.team);
  if (g.gap > 0) return `${name}: 순위표 ${g.tableRank}위, Elo ${g.eloRank}위(Elo가 순위표보다 ${g.gap}계단 높게 평가)`;
  if (g.gap < 0) return `${name}: 순위표 ${g.tableRank}위, Elo ${g.eloRank}위(순위표가 Elo보다 ${-g.gap}계단 높음)`;
  return `${name}: 순위표와 Elo 모두 ${g.tableRank}위`;
}

// 홈 이점이 기본값과 다른 리그(elo.ts homeAdvForLeague)를 코드 값 그대로 적는다.
function homeAdvExceptions(ov: RatingsOverview): string {
  const xs = ov.leagues.filter((l) => l.homeAdv !== HOME_ADV).map((l) => `${leagueInfo(l.league).name} +${l.homeAdv}점`);
  return xs.length ? `, ${xs.join(", ")}` : "";
}

function comparisonSection(ov: RatingsOverview): string {
  const compared = ov.leagues.filter((l) => l.comparison != null);
  let best: { league: string; gap: RankGap } | null = null;
  for (const l of compared) {
    const g = l.comparison!.gaps[0];
    if (g && (!best || Math.abs(g.gap) > Math.abs(best.gap.gap))) best = { league: l.league, gap: g };
  }
  const rows = compared
    .map((l) => {
      const c = l.comparison!;
      const g = c.gaps[0];
      return `<tr><th scope="row">${e(leagueInfo(l.league).name)}</th><td>${c.n}</td><td>${c.spearman == null ? "-" : c.spearman.toFixed(2)}</td><td>${g && g.gap !== 0 ? e(gapText(l.league, g)) : "차이 없음"}</td></tr>`;
    })
    .join("");
  const data = compared.length
    ? `${tableWrap("r-compare", "리그별 순위표 순위와 Elo 순위 비교(같은 팀끼리 다시 순위를 매겨 비교)", ["리그", "비교 팀 수", "순위 일치도(스피어만)", "차이가 가장 큰 팀"], rows)}
${best && best.gap.gap !== 0 ? `<p>지금 자료에서 두 순위 차이가 가장 큰 팀은 ${e(leagueInfo(best.league).name)} ${e(tableTeamName(best.league, best.gap.team))}입니다. 순위표 ${best.gap.tableRank}위, Elo ${best.gap.eloRank}위이며 이번 시즌 ${best.gap.played}경기를 치렀습니다.</p>` : ""}`
    : `<p class="site-note">모든 팀이 ${MIN_PLAYED_FOR_COMPARISON}경기 이상 치른 리그가 아직 없어, 지금은 두 순위를 비교하지 않습니다. 시즌 초반에는 몇 경기 결과만으로 순위표가 크게 흔들려 비교가 의미 없기 때문입니다.</p>`;
  return `<section class="site-panel" aria-labelledby="h-why"><h2 id="h-why">순위표 순위와 Elo 순위가 다른 이유</h2>
<p>순위표는 이번 시즌에 쌓은 승점만 셉니다. 누구를 상대로 이겼는지, 홈이었는지는 따지지 않습니다. Elo는 경기마다 '이 상대에게 기대되던 결과'와 실제 결과의 차이만큼 점수를 옮깁니다. 그래서 같은 1승이라도 강한 상대를 이기면 더 많이 오르고, 홈에서 이기면 홈 이점(기본 +${HOME_ADV}점${homeAdvExceptions(ov)})이 기대치에 이미 들어 있어 덜 오릅니다.</p>
<ul>
<li>시즌 초반: Elo는 지난 시즌 점수를 1500점 쪽으로 ${Math.round(SEASON_REGRESSION * 100)}%만 되돌린 상태에서 시작합니다. 그래서 초반 몇 경기 동안은 지난 시즌 전력이 Elo에 더 크게 남아 있습니다.</li>
<li>일정 차이: 강팀과 많이 붙은 팀은 승점이 덜 쌓여도 Elo는 덜 떨어집니다. 연기 경기로 치른 경기 수가 다르면 승점 차이도 생깁니다.</li>
<li>점수 단위: 한 경기에 오가는 Elo는 최대 ${K_FACTOR}점입니다. 승점은 이기면 3점이 고정이라, 접전 승리와 대승이 순위표에서는 득실차로만 갈립니다.</li>
<li>리그 사이 비교: Elo는 리그마다 따로 계산해 각 리그가 1500점 근처를 기준으로 합니다. 서로 다른 리그 팀의 Elo 숫자를 직접 비교하면 안 됩니다.</li>
</ul>
<h3>지금 데이터로 본 차이</h3>
${data}
<p class="site-note">순위 일치도는 스피어만 순위 상관계수입니다. 1이면 두 순위가 완전히 같고, 0에 가까울수록 관계가 약합니다. 모든 팀이 ${MIN_PLAYED_FOR_COMPARISON}경기 이상 치른 리그만 비교하고, 순위표와 Elo에 모두 있는 팀끼리 1위부터 다시 매겨 계산했습니다. 순위표는 HYEOKS 자체 집계라 공식 순위와 다를 수 있습니다(승점 삭감·타이브레이커 미반영).</p>
</section>`;
}

export function renderRatingsPage(ov: RatingsOverview): string {
  const panels = ov.leagues.map(leaguePanel).join("");
  const body = `<section class="site-intro">
<p class="site-eyebrow">전력 순위</p>
<h1>리그별 Elo 전력 순위</h1>
<p>HYEOKS가 저장한 경기 결과로 계산한 리그별 Elo 상위 팀과, 같은 결과로 다시 센 시즌 순위표 순위를 나란히 보여줍니다. Elo는 결과만으로 갱신하는 상대 전력 지수이며, 순위표와 다른 점은 아래에서 실제 수치로 설명합니다.</p>
<p class="site-note">집계 시각 ${e(fullKst(ov.generatedAt))} · 클럽 리그는 각 리그의 가장 최근 시즌 참가 팀만 표시 · <a href="/guide/elo-rating">Elo 레이팅 가이드</a> · <a href="/methodology">계산 방법</a></p>
${ov.truncated ? `<p class="site-callout">최근 경기 자료가 조회 한도를 넘어 이번에는 순위표 비교를 생략했습니다.</p>` : ""}
</section>
<div class="site-grid">${panels}${nationalPanel(ov)}</div>
${comparisonSection(ov)}`;
  return renderSitePage({
    title: "리그별 Elo 전력 순위와 순위표 비교",
    description: "EPL·라리가·세리에A·분데스리가·K리그·J리그·MLS·국가대표의 Elo 전력 상위 팀과 자체 집계 순위표 순위를 비교하고, 두 순위가 다른 이유를 실제 데이터로 설명합니다.",
    path: "/ratings",
    body,
    noindex: !ratingsIndexable(ov),
    event: "ratings_view",
  });
}
