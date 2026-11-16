// 첫 화면은 빈 앱 껍데기가 아니라, 데이터·출처·검증 기록을 JS 없이 읽을 수 있게 만든다.
import type { SiblingView } from "./matchPage";
import type { PublicPerformanceReport } from "./publicPerformance";
import { escapeText as e, renderSitePage } from "./publicSite";
import { LEAGUE_INFO } from "./teamNames";
import { storyCards } from "./stories";
export interface HomeData {
  generatedAt: string;
  matches: SiblingView[];
  performance: PublicPerformanceReport | null;
  performanceUnavailable: boolean;
  rounds: { round_no: number; status: string; sale_end_at: string | null }[];
}
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
export function renderDataHome(_d: HomeData): string {
  // 편집 콘텐츠는 실시간 경기 조회의 성공 여부와 분리한다. 없는 경기·성능 수치를 홈에 채워 넣지 않는다.
  return renderSitePage({ title: "축구 통계 이야기와 데이터 관찰", description: "HYEOKS는 저장된 축구 경기 자료에서 질문을 찾고, 계산 과정·출처·해석의 한계를 함께 설명합니다. 고정된 통계 이야기와 최신 경기 데이터를 구분해 읽어보세요.", path: "/", event: "home_view", body: `<header class="site-intro editorial-intro"><p class="site-eyebrow">HYEOKS · FOOTBALL DATA STORIES</p><h1>축구 숫자,<br>어디까지 말할 수 있을까</h1><p>승점표와 전력 지수는 왜 다를까요. 과거 무승부 비율을 다음 경기의 확률로 읽어도 될까요. 저장된 경기 자료에서 질문을 찾고, 계산 과정과 해석의 한계를 함께 살펴봅니다.</p><div class="site-actions"><a class="site-button" href="/stories">축구 통계 이야기 읽기</a><a href="/sources">무슨 자료를 쓰나요?</a></div><p class="site-note">개인이 운영하는 축구 데이터 사이트입니다. 통계 이야기는 기준 시각이 고정된 편집 글이며, 경기 데이터는 별도 화면에서 갱신합니다.</p></header>
<section class="site-section" aria-labelledby="h-stories"><div class="site-section-heading"><h2 id="h-stories">숫자에서 시작한 이야기</h2><a href="/stories">전체 이야기</a></div><p>질문에서 출발해 관찰·해석·한계·원자료 순서로 읽습니다. 실제 집계 사례와 방법론 글을 구분해 표시합니다.</p><div class="site-grid story-grid">${storyCards()}</div></section>
<section class="site-panel editorial-principle"><h2>숫자가 말하지 않는 것까지 씁니다</h2><p>한 번의 0:0도 분자와 분모를 바꿉니다. 하지만 그 비율만으로 리그의 경기 스타일이나 다음 경기의 결과를 설명할 수는 없습니다. HYEOKS는 확인한 사실과 계산한 값, 해석을 나누고 수집하지 않은 선수·전술 이야기를 추정해 채우지 않습니다.</p><div class="site-actions"><a href="/editorial">편집·정정 원칙</a><a href="/about">운영자와 사이트 소개</a><a href="/contact">오류 제보</a></div></section>
<section class="site-section" aria-labelledby="h-insights"><h2 id="h-insights">HYEOKS 데이터 관찰실</h2><p>이야기에서 만난 질문을 최신 저장 자료에서도 직접 확인하세요. 아래 화면은 자료 갱신에 따라 숫자가 바뀌므로 편집 글의 고정 스냅샷과는 구분합니다.</p><div class="site-grid"><article class="site-panel"><p class="site-eyebrow">성적과 전력</p><h3><a href="/insights/rank-gap">순위와 Elo는 얼마나 다를까?</a></h3><p>같은 시즌 저장 결과에 등장한 팀끼리 두 순서를 비교합니다. 차이만으로 저평가나 미래 반등을 주장하지 않습니다.</p></article><article class="site-panel"><p class="site-eyebrow">예측의 검증</p><h3><a href="/insights/probability-audit">예측한 확률과 실제 결과 비교</a></h3><p>경기 전 저장값만 평가합니다. 확률 구간별 표본 수와 불확실성, 포함·제외 기준을 함께 봅니다.</p></article><article class="site-panel"><p class="site-eyebrow">결과의 분포</p><h3><a href="/insights/draw-rates">리그별 홈승·무승부·원정승 비율</a></h3><p>어떤 시즌 구간의 몇 경기를 센 것인지 확인합니다. 저장 자료를 완전한 리그 전체 기록으로 표현하지 않습니다.</p></article></div></section>
<section class="site-panel"><h2>경기 데이터로 이어서 보기</h2><p>일정과 경기별 확률, 자체 집계 순위표는 별도 화면에서 제공합니다. 확률마다 통계 모델·해외 배당·국가대표 Elo의 출처와 기준 시각을 확인할 수 있습니다.</p><div class="site-actions"><a class="site-button secondary" href="/matches">이번 주 경기 데이터</a><a href="/ratings">Elo 전력 순위</a><a href="/performance">경기 전 예측의 공개 검증 기록</a></div><nav aria-label="리그별 데이터"><div class="site-actions">${Object.values(LEAGUE_INFO).map(l => `<a class="site-pill" href="/league/${e(l.slug)}">${e(l.name)}</a>`).join("")}</div></nav></section>
<section class="site-section"><h2>읽는 법과 출처</h2><div class="site-grid"><article class="site-panel"><h3><a href="/guide/">축구 데이터 가이드</a></h3><p>확률·Elo의 기초와 제도 정보를 출처·기준일과 함께 읽습니다. 스포츠토토 제도 정보도 포함합니다.</p></article><article class="site-panel"><h3><a href="/methodology">계산 방법과 한계</a></h3><p>모델이 사용하는 정보와 사용하지 않는 정보를 구분합니다. 경기 후 다시 만든 예측으로 과거 성적을 바꾸지 않습니다.</p></article><article class="site-panel"><h3><a href="/sources">출처·수집 범위</a></h3><p>외부 제공 자료와 HYEOKS 자체 집계를 구분하고, 자료 누락과 시즌 구분의 한계를 공개합니다.</p></article></div></section>
<aside class="site-panel editorial-tool"><h2>부가기능: 승무패 분석 도구</h2><p>회차별 확률 조회, 설정 변경 시뮬레이션, 예산별 조합 계산을 위한 도구도 제공합니다. 계산 결과는 구매 권유나 적중·수익 보장이 아닙니다.</p><div class="site-actions"><a href="/app">승무패 도구 열기</a><a href="/responsible">건전한 이용 안내</a></div><p class="site-note">체육진흥투표권은 만 19세 이상만 공식 판매처에서 구매할 수 있습니다. 도박 문제 상담 1336.</p></aside>` });
}
