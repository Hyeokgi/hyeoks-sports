// 공개 읽기 화면의 공통 틀. 앱·오류 화면에 광고가 자동 삽입되지 않도록 광고 로더는 넣지 않는다.
// 메뉴는 이 파일 한 곳에서만 만든다. 정적 HTML·경기 페이지·회차 페이지·앱도 여기서 만든 머리말·꼬리말을 쓴다
// (예전에는 화면 종류마다 메뉴가 4가지로 달라 같은 사이트로 보이지 않았다).
import { LEAGUE_INFO } from "./teamNames";
export const PUBLIC_ORIGIN = "https://hyeoks.com";
export const PUBLIC_PAGES = ["/", "/matches", "/methodology", "/performance", "/guide/", "/about", "/sources", "/editorial", "/responsible", "/contact", "/privacy"];
export function escapeText(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
export function fullKst(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "확인할 수 없음";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) + " KST";
}
export const basisNames: Record<string, string> = { model: "클럽 통계 모델(배당 혼합 가능)", market: "해외 배당 암시확률", national: "국가대표 Elo", none: "근거 미확인" };
export type NavSection = "home" | "matches" | "performance" | "guide" | "tool" | "about" | "other";

/** 주소로 지금 어느 메뉴에 있는지 정한다. 경기·리그 상세도 '경기 분석' 아래로, 계산 방법·출처는 '가이드' 아래로 묶는다. */
export function navSection(path: string): NavSection {
  const p = path.split("?")[0] || "/";
  if (p === "/") return "home";
  if (p.startsWith("/matches") || p.startsWith("/league/") || p.startsWith("/match/") || p === "/ratings" || p === "/insights/draw-rates" || p === "/insights/rank-gap") return "matches";
  if (p.startsWith("/performance") || p === "/insights/probability-audit") return "performance";
  if (p.startsWith("/guide") || p === "/methodology" || p === "/sources") return "guide";
  if (p.startsWith("/app") || p.startsWith("/round/")) return "tool";
  if (["/about", "/editorial", "/responsible", "/contact", "/privacy"].includes(p)) return "about";
  return "other";
}

// 주 메뉴는 사용자가 하는 일 기준 5개로 고정한다: 둘러보기(홈) · 경기 보기 · 결과 확인 · 배우기 · 도구 쓰기.
const PRIMARY: { href: string; label: string; section: NavSection; tool?: boolean }[] = [
  { href: "/", label: "홈", section: "home" },
  { href: "/matches", label: "경기 분석", section: "matches" },
  { href: "/performance", label: "예측 기록", section: "performance" },
  { href: "/guide/", label: "가이드", section: "guide" },
  { href: "/app", label: "승무패 도구", section: "tool", tool: true },
];

function subnavItems(section: NavSection): { href: string; label: string }[] {
  // 전력 순위(/ratings)·무승부 비율(/insights/draw-rates)은 리그 공통 비교 페이지라 '이번 주 전체' 바로 뒤에 둔다.
  if (section === "matches") return [{ href: "/matches", label: "이번 주 전체" }, { href: "/ratings", label: "전력 순위" }, { href: "/insights/draw-rates", label: "무승부 비율" }, { href: "/insights/rank-gap", label: "순위와 전력" }, ...Object.values(LEAGUE_INFO).map((l) => ({ href: `/league/${l.slug}`, label: l.name }))];
  if (section === "performance") return [{ href: "/performance", label: "전체 예측 기록" }, { href: "/insights/probability-audit", label: "확률 성적표" }];
  if (section === "guide") return [
    { href: "/guide/", label: "전체 가이드" },
    { href: "/guide/probability-reading", label: "확률 읽는 법" },
    { href: "/guide/elo-rating", label: "Elo 레이팅" },
    { href: "/methodology", label: "계산 방법" },
    { href: "/sources", label: "출처·데이터 주의사항" },
  ];
  if (section === "about") return [
    { href: "/about", label: "소개" },
    { href: "/editorial", label: "편집 원칙" },
    { href: "/responsible", label: "건전 이용 안내" },
    { href: "/contact", label: "문의·오류 제보" },
    { href: "/privacy", label: "개인정보처리방침" },
  ];
  return [];
}

export function siteHeader(path = "/"): string {
  const section = navSection(path);
  const clean = path.split("?")[0] || "/";
  const primary = PRIMARY.map((i) => `<a href="${i.href}"${i.tool ? ' class="site-nav-tool"' : ""}${i.section === section ? ' aria-current="page"' : ""}>${i.label}</a>`).join("");
  const sub = subnavItems(section);
  // 하위 메뉴는 현재 위치를 정확히 표시한다. 경기 상세는 소속 리그를 알 수 없으므로 표시하지 않는다.
  const subHtml = sub.length
    ? `<nav class="site-subnav" aria-label="${section === "matches" ? "리그 선택" : "이 메뉴의 하위 페이지"}">${sub.map((s) => `<a href="${s.href}"${s.href === clean || (s.href === "/guide/" && clean === "/guide") ? ' aria-current="page"' : ""}>${escapeText(s.label)}</a>`).join("")}</nav>`
    : "";
  return `<a class="skip-link" href="#content">본문으로 건너뛰기</a><header class="site-header"><div class="site-header-row"><a class="site-brand" href="/" aria-label="HYEOKS 풋볼 데이터 홈">HYEOKS <span>풋볼 데이터</span></a><nav class="site-nav" aria-label="주 메뉴">${primary}</nav></div>${subHtml}</header>`;
}

/** 꼬리말은 목적별 세 묶음으로 나눈다. note는 화면별 추가 고지(예: 경기 페이지의 면책 문구). */
export function siteFooter(note?: string): string {
  const group = (title: string, links: [string, string][]) => `<div><h2>${title}</h2><ul>${links.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join("")}</ul></div>`;
  return `<footer class="site-footer"><div class="site-footer-groups">${group("둘러보기", [["/", "홈"], ["/matches", "경기 분석"], ["/performance", "예측 기록"], ["/app", "승무패 도구"]])}${group("알아보기", [["/guide/", "가이드"], ["/guide/probability-reading", "확률 읽는 법"], ["/methodology", "계산 방법"], ["/sources", "출처·데이터 주의사항"], ["/insights/draw-rates", "리그별 무승부 비율"], ["/insights/rank-gap", "순위와 전력의 차이"], ["/insights/probability-audit", "확률 성적표"]])}${group("운영 정보", [["/about", "소개"], ["/editorial", "편집 원칙"], ["/responsible", "건전 이용 안내"], ["/contact", "문의·오류 제보"], ["/privacy", "개인정보처리방침"]])}</div>${note ? `<p>${escapeText(note)}</p>` : ""}<p>HYEOKS는 개인이 운영하는 축구 데이터 서비스입니다. 확률과 기록은 자동 계산·집계이며 경기 결과나 수익을 보장하지 않습니다.</p><p id="responsible-use">체육진흥투표권은 만 19세 이상만, 공식 판매처에서만 구매할 수 있습니다. 도박 문제 상담: 한국도박문제예방치유원 <a href="tel:1336">1336</a> · <a href="/responsible">건전한 이용 안내</a></p><p>문의: <a href="mailto:hyeoks.data@gmail.com">hyeoks.data@gmail.com</a></p></footer>`;
}
export function renderSitePage(options: { title: string; description: string; path: string; body: string; noindex?: boolean; event?: string }): string {
  const e = escapeText;
  const canonical = PUBLIC_ORIGIN + options.path;
  const metadata = JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: options.title, description: options.description, url: canonical, inLanguage: "ko", isPartOf: { "@type": "WebSite", name: "HYEOKS 풋볼 데이터", url: PUBLIC_ORIGIN } }).replace(/</g, "\\u003c");
  // 자동 측정은 일별 합계만 보낸다. 페이지가 서버에서 생성된 시각을 사용자 접속 수로 세지 않는다.
  const beacon = options.event ? `<script>(function(){try{if(new URLSearchParams(location.search).get('monitor')==='1')return;var p={e:${JSON.stringify(options.event)},u:new URLSearchParams(location.search).get('utm_source'),ref:document.referrer};navigator.sendBeacon('/api/e',new Blob([JSON.stringify(p)],{type:'application/json'}))}catch(e){}})();</script>` : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(options.title)} | HYEOKS</title><meta name="description" content="${e(options.description)}"><meta name="theme-color" content="#101624"><meta name="naver-site-verification" content="b965a69c20fada267ff870f44237f2959814660e"><meta name="google-adsense-account" content="ca-pub-8304230080973900"><link rel="canonical" href="${e(canonical)}">${options.noindex ? '<meta name="robots" content="noindex,follow">' : ""}<meta property="og:type" content="website"><meta property="og:title" content="${e(options.title)}"><meta property="og:description" content="${e(options.description)}"><meta property="og:url" content="${e(canonical)}"><link rel="stylesheet" href="/fonts/pretendard/pretendard.css"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/nav.css"><script type="application/ld+json">${metadata}</script></head><body>${siteHeader(options.path)}<main id="content" class="site-shell">${options.body}</main>${siteFooter()}${beacon}</body></html>`;
}
export function publicHtml(body: string, status = 200, cacheSeconds = 600): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": status === 200 ? `public, max-age=${cacheSeconds}` : "no-store", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", ...(status !== 200 ? { "x-robots-tag": "noindex" } : {}) } });
}
export function errorPage(status: 404 | 503): Response {
  const missing = status === 404;
  return publicHtml(renderSitePage({ title: missing ? "페이지를 찾을 수 없습니다" : "지금 데이터를 불러올 수 없습니다", description: "서비스 복구 안내", path: "/", noindex: true, body: `<section class="site-panel"><h1>${missing ? "페이지를 찾을 수 없습니다" : "잠시 후 다시 확인해 주세요"}</h1><p>${missing ? "주소가 변경되었거나 아직 공개되지 않은 자료입니다." : "데이터 조회에 문제가 생겼습니다. 자료가 없는 상태와 구분해 안내합니다. 오류 내용이나 내부 정보는 공개하지 않습니다."}</p><div class="site-actions"><a class="site-button" href="/">데이터 홈</a><a href="/matches">경기 목록</a><a href="/guide/">가이드</a><a href="/contact">문제 제보</a></div></section>` }), status, 0);
}
