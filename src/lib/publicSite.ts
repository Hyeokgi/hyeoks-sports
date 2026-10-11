// 공개 읽기 화면의 공통 틀. 앱·오류 화면에 광고가 자동 삽입되지 않도록 광고 로더는 넣지 않는다.
export const PUBLIC_ORIGIN = "https://hyeoks.com";
export const PUBLIC_PAGES = ["/", "/matches", "/methodology", "/performance", "/guide/", "/about", "/sources", "/editorial", "/contact", "/privacy"];
export function escapeText(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
export function fullKst(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "확인할 수 없음";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) + " KST";
}
export const basisNames: Record<string, string> = { model: "클럽 통계 모델(배당 혼합 가능)", market: "해외 배당 암시확률", national: "국가대표 Elo", none: "근거 미확인" };
export function siteHeader(active = ""): string {
  const items = [["/matches", "경기 분석"], ["/performance", "검증 기록"], ["/guide/", "가이드"], ["/app", "승무패 도구"]];
  return `<a class="skip-link" href="#content">본문으로 건너뛰기</a><header class="site-header"><a class="site-brand" href="/">HYEOKS <span>풋볼 데이터</span></a><nav class="site-nav" aria-label="주 메뉴">${items.map(([href, label]) => `<a href="${href}"${active === href ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav></header>`;
}
export function siteFooter(): string {
  return `<footer class="site-footer"><nav aria-label="서비스 정보">${[["/about", "소개"], ["/methodology", "계산 방법"], ["/sources", "출처·데이터 주의사항"], ["/editorial", "편집 원칙"], ["/contact", "문의·오류 제보"], ["/privacy", "개인정보처리방침"]].map(([h,l]) => `<a href="${h}">${l}</a>`).join("")}</nav><p>HYEOKS는 개인 운영 축구 데이터 서비스입니다. 자동 계산·집계이며 경기 결과나 수익을 보장하지 않습니다.</p><p>체육진흥투표권 구매는 만 19세 이상, 공식 판매처에서만 가능합니다. 도박 문제 상담: 국번 없이 1336.</p><p>문의: <a href="mailto:hyeoks.data@gmail.com">hyeoks.data@gmail.com</a></p></footer>`;
}
export function renderSitePage(options: { title: string; description: string; path: string; body: string; noindex?: boolean; event?: string }): string {
  const e = escapeText;
  const canonical = PUBLIC_ORIGIN + options.path;
  const metadata = JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: options.title, description: options.description, url: canonical, inLanguage: "ko", isPartOf: { "@type": "WebSite", name: "HYEOKS 풋볼 데이터", url: PUBLIC_ORIGIN } }).replace(/</g, "\\u003c");
  // 자동 측정은 일별 합계만 보낸다. 페이지가 서버에서 생성된 시각을 사용자 접속 수로 세지 않는다.
  const beacon = options.event ? `<script>(function(){try{if(new URLSearchParams(location.search).get('monitor')==='1')return;var p={e:${JSON.stringify(options.event)},u:new URLSearchParams(location.search).get('utm_source'),ref:document.referrer};navigator.sendBeacon('/api/e',new Blob([JSON.stringify(p)],{type:'application/json'}))}catch(e){}})();</script>` : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(options.title)} | HYEOKS</title><meta name="description" content="${e(options.description)}"><meta name="theme-color" content="#101624"><meta name="naver-site-verification" content="b965a69c20fada267ff870f44237f2959814660e"><meta name="google-adsense-account" content="ca-pub-8304230080973900"><link rel="canonical" href="${e(canonical)}">${options.noindex ? '<meta name="robots" content="noindex,follow">' : ""}<meta property="og:type" content="website"><meta property="og:title" content="${e(options.title)}"><meta property="og:description" content="${e(options.description)}"><meta property="og:url" content="${e(canonical)}"><link rel="stylesheet" href="/fonts/pretendard/pretendard.css"><link rel="stylesheet" href="/site.css"><script type="application/ld+json">${metadata}</script></head><body>${siteHeader(options.path)}<main id="content" class="site-shell">${options.body}</main>${siteFooter()}${beacon}</body></html>`;
}
export function publicHtml(body: string, status = 200, cacheSeconds = 600): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": status === 200 ? `public, max-age=${cacheSeconds}` : "no-store", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", ...(status !== 200 ? { "x-robots-tag": "noindex" } : {}) } });
}
export function errorPage(status: 404 | 503): Response {
  const missing = status === 404;
  return publicHtml(renderSitePage({ title: missing ? "페이지를 찾을 수 없습니다" : "지금 데이터를 불러올 수 없습니다", description: "서비스 복구 안내", path: "/", noindex: true, body: `<section class="site-panel"><h1>${missing ? "페이지를 찾을 수 없습니다" : "잠시 후 다시 확인해 주세요"}</h1><p>${missing ? "주소가 변경되었거나 아직 공개되지 않은 자료입니다." : "데이터 조회에 문제가 생겼습니다. 자료가 없는 상태와 구분해 안내합니다. 오류 내용이나 내부 정보는 공개하지 않습니다."}</p><div class="site-actions"><a class="site-button" href="/">데이터 홈</a><a href="/matches">경기 목록</a><a href="/guide/">가이드</a><a href="/contact">문제 제보</a></div></section>` }), status, 0);
}
