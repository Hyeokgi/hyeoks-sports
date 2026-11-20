// 첫 화면은 빈 앱 껍데기가 아니라, 데이터·출처·검증 기록을 JS 없이 읽을 수 있게 만든다.
import type { SiblingView } from "./matchPage";
import type { PublicPerformanceReport } from "./publicPerformance";
import { escapeText as e, renderSitePage } from "./publicSite";
import { LEAGUE_INFO } from "./teamNames";
import { recentFootballStories, hasRecentFootballStories, readingStories, storyCards } from "./stories";
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
export function renderDataHome(d: HomeData): string {
  const recent = recentFootballStories(Date.parse(d.generatedAt));
  const lead = recent[0];
  const fresh = hasRecentFootballStories(Date.parse(d.generatedAt));
  const leadHtml = lead ? `<article class="news-lead"><div><span class="news-tag">${e(lead.topic ?? "최근 경기")}</span><h2><a href="/stories/${e(lead.slug)}">${e(lead.title)}</a></h2><p>${e(lead.summary)}</p><p class="news-date">발행 ${e(lead.publishedAt.slice(0,10))}${lead.eventDate ? " · 경기 " + e(lead.eventDate) + " (한국시간)" : ""}</p><a class="news-read-link" href="/stories/${e(lead.slug)}">이야기 읽기</a></div>${lead.featureStat ? `<div class="news-key-number"><span class="number-label">${e(lead.featureStat.label)}</span><strong>${e(lead.featureStat.value)}</strong><p class="number-note">같은 경기도 숫자로 한 번 더 보면 다른 장면이 보입니다.</p><span class="score-stamp">직접 계산 · 원자료 공개</span></div>` : ""}</article>` : "";
  return renderSitePage({ title: fresh ? "요즘 축구의 재미있는 숫자와 이야기" : "경기 통계로 다시 읽는 축구 이야기", description: "한국 축구와 해외 축구 경기에서 재미있는 숫자를 찾습니다. 경기 이야기와 직접 계산한 통계를 먼저 읽고, 확률·전력·승무패 도구는 필요한 만큼 따로 살펴보세요.", path: "/", event: "home_view", body: `<header class="magazine-intro"><p class="site-eyebrow">HYEOKS 풋볼 매거진</p><h1>축구의 재미,<br>숫자로 한 번 더</h1><p>한 골 차 승부 속 뜻밖의 기록부터 짜릿한 역전의 시간까지. ${fresh ? "요즘 축구의 흥밋거리를" : "기록으로 남은 축구의 장면을"} 숫자와 함께 읽습니다.</p></header>${leadHtml}
<section class="site-section" aria-labelledby="h-stories"><div class="site-section-heading"><h2 id="h-stories">${fresh ? "최근 경기에서 찾은 이야기" : "경기 이야기 다시 읽기"}</h2><a href="/stories">전체 이야기</a></div>${recent.length > 1 ? `<div class="news-secondary">${storyCards(recent.slice(1))}</div>` : ""}<p class="site-note">경기 날짜와 발행일은 각각 표시합니다. 통계의 출처와 직접 계산한 근거는 각 이야기 뒤에서 확인할 수 있습니다.</p></section>
<section class="site-section magazine-reading" aria-labelledby="h-reading"><h2 id="h-reading">통계가 더 재미있어지는 읽는 법</h2><p>경기 이야기가 재미있었다면, 그 숫자를 읽는 방법도 한 걸음 더.</p><div class="site-grid story-grid">${storyCards(readingStories(Date.parse(d.generatedAt)))}</div><p><a href="/guide/">기초 가이드 더 보기</a></p></section>
<section class="magazine-data" aria-labelledby="h-data"><h2 id="h-data">다음 경기의 숫자도 궁금하다면</h2><p>리그의 전력 지수, 경기별 확률과 출처, 경기 전 저장했던 예측 기록을 별도로 확인할 수 있습니다.</p><div class="site-actions"><a class="site-button" href="/matches">경기 데이터 보기</a><a href="/ratings">Elo 전력 순위</a><a href="/performance">사전 예측의 공개 기록</a></div><nav aria-label="리그별 데이터"><div class="site-actions">${Object.values(LEAGUE_INFO).map(l=>`<a class="site-pill" href="/league/${e(l.slug)}">${e(l.name)}</a>`).join("")}</div></nav></section>
<section class="site-section" aria-labelledby="h-insights"><h2 id="h-insights">HYEOKS 데이터 관찰실</h2><div class="magazine-links"><a href="/insights/rank-gap">순위와 Elo 비교</a><a href="/insights/draw-rates">리그별 결과 비율</a><a href="/insights/probability-audit">확률 성적표</a></div><p class="site-note">이 화면들의 숫자는 저장 자료에 따라 갱신됩니다. 기사에 고정한 시점의 통계와는 구분해 주세요.</p></section>
<aside class="site-panel editorial-tool"><h2>더 살펴보기: 승무패 확률과 도구</h2><p>축구 이야기를 먼저 즐긴 뒤, 회차별 확률·설정 변경 시뮬레이션·예산별 조합 계산이 필요할 때 이용하세요. 구매 권유나 적중·수익 보장이 아닙니다.</p><div class="magazine-links"><a href="/app">승무패 도구</a><a href="/methodology">확률 계산 방법</a><a href="/responsible">건전한 이용 안내</a></div><p class="site-note">체육진흥투표권은 만 19세 이상만 공식 판매처에서 구매할 수 있습니다. 도박 문제 상담 1336.</p></aside>
<section class="site-section"><div class="magazine-links"><a href="/about">HYEOKS 소개</a><a href="/sources">자료 출처</a><a href="/editorial">편집·정정 원칙</a><a href="/contact">오류 제보</a></div><p class="site-note">자체 제작한 통계 그래픽을 사용합니다. 실제 경기 사진·선수 사진을 재게시하지 않습니다. 확인한 기록과 해석을 구분하며, 기사에 없는 경기 내용이나 선수 상태를 추정해 채우지 않습니다.</p></section>` });
}
