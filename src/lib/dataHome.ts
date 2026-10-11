// 첫 화면은 빈 앱 껍데기가 아니라, 데이터·출처·검증 기록을 JS 없이 읽을 수 있게 만든다.
import type { SiblingView } from "./matchPage";
import type { PublicPerformanceReport } from "./publicPerformance";
import { metricCards } from "./performancePage";
import { escapeText as e, fullKst, renderSitePage } from "./publicSite";
import { LEAGUE_INFO } from "./teamNames";
export interface HomeData {
  generatedAt: string;
  matches: SiblingView[];
  performance: PublicPerformanceReport | null;
  performanceUnavailable: boolean;
  rounds: { round_no: number; status: string; sale_end_at: string | null }[];
}
const pct = (p: number) => `${Math.round(p * 100)}%`;
/** 확률이 모두 있는 카드. 확률이 없는 경기는 홈에서 임시값으로 채우지 않는다. */
export type ReadyCard = SiblingView & { pHome: number; pDraw: number; pAway: number };
function hasProbabilities(m: SiblingView): m is ReadyCard {
  const ps = [m.pHome, m.pDraw, m.pAway];
  if (!ps.every((p): p is number => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1)) return false;
  return Math.abs((m.pHome as number) + (m.pDraw as number) + (m.pAway as number) - 1) < 1e-3;
}
export function homeCandidates(matches: SiblingView[], now = Date.now()): ReadyCard[] {
  return matches
    .filter((m) => m.ready !== false && m.status === "scheduled" && m.home.trim() !== "" && m.away.trim() !== "")
    .filter((m) => { const k = Date.parse(m.kickoffAt); return Number.isFinite(k) && k >= now && k <= now + 7 * 86400e3; })
    .filter(hasProbabilities)
    .sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt) || a.slug.localeCompare(b.slug))
    .slice(0, 6);
}
export function renderDataHome(d: HomeData): string {
  const now = Date.parse(d.generatedAt);
  const next = homeCandidates(d.matches, now);
  const cards = next.map((m) => {
    const meta = m;
    const stale = !!meta.asOf && Number.isFinite(Date.parse(meta.asOf)) && now - Date.parse(meta.asOf) > 86400e3;
    return `<article class="site-match"><p class="site-note">${e(fullKst(m.kickoffAt))}</p><h3><a href="/match/${e(m.slug)}">${e(m.home)} <span>vs</span> ${e(m.away)}</a></h3><dl class="site-probabilities"><div><dt>홈승</dt><dd>${pct(m.pHome)}</dd></div><div><dt>무승부</dt><dd>${pct(m.pDraw)}</dd></div><div><dt>원정승</dt><dd>${pct(m.pAway)}</dd></div></dl><p class="site-note">${e(meta.basisLabel ?? "계산 근거는 경기 상세에서 확인")}${meta.asOf ? `<br>확률 기준: ${e(fullKst(meta.asOf))}` : ""}</p>${stale ? '<p class="site-callout">계산 후 24시간이 지났습니다. 최근 변화를 반영하지 못할 수 있습니다.</p>' : ""}<p class="site-note">부상·선발·로테이션은 반영하지 않습니다. <a href="/match/${e(m.slug)}">이 경기의 근거와 한계</a></p></article>`;
  }).join("");
  const performance = d.performance;
  const recent = performance?.recentRows.slice(0,3).map((m) => `<article class="site-match"><p class="site-note">${e(fullKst(m.kickoffAt))} · ${e(m.league)}</p><h3>${e(m.home)} vs ${e(m.away)}</h3><p class="site-score">${m.hg == null || m.ag == null ? e({H:"홈승",D:"무승부",A:"원정승"}[m.actual]) : `${m.hg} : ${m.ag}`}</p><p>사전 확률: 홈 ${pct(m.pHome)} / 무 ${pct(m.pDraw)} / 원정 ${pct(m.pAway)}</p><p>당시 1순위: ${e(m.pick)} · <strong>${m.hit ? "실제 결과와 일치" : "실제 결과와 불일치"}</strong></p><p class="site-note">저장 ${e(fullKst(m.capturedAt))}</p><a href="/performance">전체 기록과 제외 기준</a></article>`).join("");
  const roundLinks = d.rounds.map((r) => `<a class="site-pill" href="/round/${r.round_no}">${r.round_no}회차 분석</a>`).join("");
  return renderSitePage({ title: "축구 경기 확률·계산 근거·공개 검증 기록", description: "K리그와 해외 축구의 경기 확률을 계산 근거·한계와 함께 읽고, 경기 전 저장 예측을 실제 결과와 비교하는 HYEOKS 풋볼 데이터입니다.", path: "/", event: "home_view", body: `<header class="site-intro"><p class="site-eyebrow">FOOTBALL DATA · 확률과 근거</p><h1>이번 주 축구,<br>숫자 뒤의 근거까지</h1><p>경기 확률을 보고, 계산 방법을 확인하고, 실제 결과와 비교합니다. 숫자가 높아도 확정된 결과는 아닙니다.</p><div class="site-actions"><a class="site-button" href="/matches">전체 경기 분석</a><a href="/guide/probability-reading">확률을 읽는 법</a><a href="/methodology">계산 방법</a></div><p class="site-note">페이지 집계 시각: ${e(fullKst(d.generatedAt))}. 경기별 확률 기준 시각은 각각 표시합니다.</p></header>
<nav class="site-section" aria-labelledby="h-leagues"><h2 id="h-leagues">리그별로 보기</h2><div class="site-actions">${Object.values(LEAGUE_INFO).map((l) => `<a class="site-pill" href="/league/${l.slug}">${e(l.name)}</a>`).join("")}</div></nav>
<section class="site-section"><div class="site-section-heading"><h2>가장 가까운 경기</h2><a href="/matches">전체 보기</a></div><p class="site-note">앞으로 7일 내 확인된 예정 경기 중 킥오프가 가까운 순서로 최대 6개를 표시합니다. 승률이나 적중 여부로 골라내지 않습니다.</p>${cards ? `<div class="site-grid">${cards}</div>` : '<div class="site-panel"><p>현재 표시 조건을 충족하는 예정 경기가 없습니다. 휴식기·수집 범위·계산 상태를 확인하려면 전체 경기 목록을 보세요.</p><a href="/matches">일정·데이터 상태 확인</a></div>'}</section>
<section class="site-section"><div class="site-section-heading"><h2>최근 결과로 다시 보기</h2><a href="/performance">예측 기록 전체</a></div><p class="site-note">회차 사전 저장 기록 중 종료된 최신 3경기입니다. 적중한 경기만 골라내지 않습니다.</p>${recent ? `<div class="site-grid">${recent}</div>` : `<div class="site-panel"><p>${d.performanceUnavailable ? "검증 기록을 지금 불러오지 못했습니다. ‘기록이 없다’는 뜻은 아닙니다." : "현재 검증 기준을 충족하는 종료 경기 기록이 없습니다. 저장본이 없는 경기는 재계산값으로 복기하지 않습니다."}</p><a href="/performance">기록 범위와 기준 확인</a></div>`}</section>
<section class="site-panel"><h2>예측이 얼마나 맞았는지, 직접 확인하세요</h2><p>킥오프 전 저장 시각과 실제 결과가 확인되는 회차 경기만 셉니다. 앱의 사용자 설정 시뮬레이션이나 과거 백테스트와 구분합니다.</p>${performance && performance.overall.n ? `${metricCards(performance.overall)}<p class="site-note">기간 ${e(fullKst(performance.range.earliestKickoffAt))} ~ ${e(fullKst(performance.range.latestKickoffAt))}. 조회 ${performance.considered}건 중 ${performance.overall.n}건 평가, ${performance.excluded.total}건은 예정·미정산·기록 누락 등으로 집계하지 않았습니다.</p>` : '<p class="site-note">검증 가능한 표본이 없거나 조회되지 않으면 성능 수치를 대신 만들어 표시하지 않습니다.</p>'}<a href="/performance">근거별 성적·확률 구간·전체 제외 사유</a></section>
<section class="site-section"><h2>숫자를 이해하는 읽을거리</h2><div class="site-grid"><article class="site-panel"><p class="site-eyebrow">데이터 읽기</p><h3><a href="/guide/probability-reading">확률·확신도·적중률은 어떻게 다른가요</a></h3><p>60%가 뜻하는 것, 확률 차와 실제 적중률의 차이를 직접 계산한 예시로 설명합니다.</p></article><article class="site-panel"><p class="site-eyebrow">모델 기초</p><h3><a href="/guide/elo-rating">Elo 점수와 승리 확률은 같은 숫자가 아닙니다</a></h3><p>무승부를 반 점으로 세는 기대 점수와 축구의 세 결과 확률을 구분합니다.</p></article><article class="site-panel"><p class="site-eyebrow">리그 제도</p><h3><a href="/guide/k-league-promotion">K리그 승강제를 공식 자료로 읽기</a></h3><p>리그 제도와 시즌별 예외를 출처와 기준일을 확인하며 살펴봅니다.</p></article></div><p><a href="/guide/">전체 가이드 · 스포츠토토 제도 정보 포함</a></p></section>
<section class="site-panel"><h2>데이터가 만들어지는 과정</h2><ol class="site-process"><li><strong>수집</strong><p>경기 일정·결과, 해외 배당과 공식 회차 정보를 구분해 수집합니다. <a href="/sources">출처와 수집 범위</a></p></li><li><strong>계산·보존</strong><p>클럽 모델·국가대표 Elo·시장 확률 중 실제 근거를 표시합니다. 경기 전 예측은 저장합니다. <a href="/methodology">계산 방법과 한계</a></p></li><li><strong>비교·수정</strong><p>확정 결과와 당시 저장값을 비교하고 오류를 수정합니다. <a href="/editorial">편집·오류 수정 원칙</a></p></li></ol><p class="site-note">일정·확률·기록은 자동 집계입니다. 자동 문장은 독립 전문가의 경기 검토가 아니며, 수집하지 않은 선수·전술 정보를 추정해 채우지 않습니다.</p></section>
<section class="site-panel"><h2>기존 승무패 도구도 그대로 사용할 수 있어요</h2><p>회차 14경기 보기, 변수 변경에 따른 시뮬레이션, 예산별 조합 계산 기능입니다. 조합은 입력 확률과 가정에 따른 계산 결과이며 구매 권유나 수익 보장이 아닙니다.</p><div class="site-actions"><a class="site-button secondary" href="/app">승무패 분석 도구 열기</a>${roundLinks}</div><p class="site-note">체육진흥투표권 구매는 만 19세 이상이며 공식 판매처에서만 가능합니다. 도박 문제 상담 1336.</p></section>` });
}
