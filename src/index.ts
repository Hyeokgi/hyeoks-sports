// Worker 엔트리: API 라우팅 + 정적 자산 서빙 + Cron 디스패치
import { handleListRounds, handleGetRound } from "./routes/rounds";
import { handlePredict } from "./routes/predict";
import { handleCombinations } from "./routes/combinations";
import { handleExclusivePick } from "./routes/exclusivePick";
import { handleReport } from "./routes/report";
import { handleSettlement } from "./routes/settlement";
import { handleRoundPage, handleRoundData, handleSitemap, handleRobots } from "./routes/roundPage";
import { handleMatchPage, handleMatchData, handleLeaguePage, handleHubPage, handleMatchList } from "./routes/matchPage";
import { recordUsage, usageSince } from "./lib/usage";
import { requireAdmin } from "./lib/http";
import {
  handleCorrectRoundNo,
  handleSync,
  handleDetectRound,
  handleNotifyTest,
  handleWriteReport,
  handleWriteMarketOdds,
  handleWriteVoteShare,
  handleWriteSaleWindow,
  handleSyncFixtures,
  handleListFixtures,
} from "./routes/admin";
import { refreshHistory } from "./cron/refreshHistory";
import { detectNewRound } from "./cron/detectNewRound";
import { runDeadlineTrigger } from "./cron/deadlineTrigger";
import { syncFixtures } from "./lib/fixtures";
import { json } from "./lib/http";
import type { Env } from "./types";
import { handleDataHome, handlePerformancePage, handlePerformanceData, legacyAppLocation } from "./routes/sitePage";
import { handleRatingsPage } from "./routes/ratingsPage";
import { handleDrawRatesPage } from "./routes/drawRatesPage";
import { handleRankGapPage } from "./routes/rankGapPage";
import { handleProbabilityAuditPage } from "./routes/probabilityAuditPage";
import { errorPage, siteHeader, siteFooter } from "./lib/publicSite";

/**
 * 정적 HTML(가이드·안내 페이지·앱)의 머리말·꼬리말을 공통 메뉴로 바꾼다.
 * 파일마다 메뉴를 복사해 두면 메뉴를 고칠 때 14개 파일을 모두 고쳐야 하고, 하나만 빠져도 화면마다 메뉴가 달라진다.
 */
function withSiteChrome(res: Response, path: string): Response {
  if (res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  let mainSeen = false;
  return new HTMLRewriter()
    .on("head", { element(el) { el.append('<link rel="stylesheet" href="/nav.css">', { html: true }); } })
    .on("a.skip-link", { element(el) { el.remove(); } })
    .on("header.site-header", { element(el) { el.replace(siteHeader(path), { html: true }); } })
    .on("nav.app-public-nav", { element(el) { el.replace(siteHeader(path), { html: true }); } })
    .on("footer.site-footer", { element(el) { el.replace(siteFooter(), { html: true }); } })
    .on("footer.app-public-footer", { element(el) { el.replace(`<div class="app-footer-wrap">${siteFooter("앱에서 바꾼 설정은 이 화면의 시뮬레이션에만 적용됩니다. 경기 전 저장 기록(예측 기록)과는 구분해 주세요.")}</div>`, { html: true }); } })
    .on("main", { element(el) { if (mainSeen) return; mainSeen = true; if (!el.getAttribute("id")) el.setAttribute("id", "content"); } })
    .transform(res);
}

const ROUND_ID_RE = /^\/api\/rounds\/(\d+)(?:\/(predict|combinations|report|exclusive-pick))?$/;
// 회차 분석 페이지(공개)와 블로그 초안. 정적 자산에 없는 경로라 워커로 넘어온다.
const ROUND_PAGE_RE = /^\/round\/(\d+)(\/draft)?\/?$/;
const ROUND_DATA_RE = /^\/round\/(\d+)\/data\.json$/;
// 경기별 분석 페이지(docs/specs/002). 주소 조각은 영문 소문자·숫자·하이픈만(fixtures.ts slugifyTeam).
const MATCH_PAGE_RE = /^\/match\/([a-z0-9-]{5,160})\/?$/;
const MATCH_DATA_RE = /^\/match\/([a-z0-9-]{5,160})\/data\.json$/;
const LEAGUE_PAGE_RE = /^\/league\/([a-z0-9-]{2,40})\/?$/;
const CANONICAL_ORIGIN = "https://hyeoks.com";
const ADMIN_ROUND_RE = /^\/api\/admin\/rounds\/(\d+)$/;
const ADMIN_ROUND_REPORT_RE = /^\/api\/admin\/rounds\/(\d+)\/report$/;
const ADMIN_ROUND_MARKET_ODDS_RE = /^\/api\/admin\/rounds\/(\d+)\/market-odds$/;
const ADMIN_ROUND_VOTE_SHARE_RE = /^\/api\/admin\/rounds\/(\d+)\/vote-share$/;
const ADMIN_ROUND_SALE_WINDOW_RE = /^\/api\/admin\/rounds\/(\d+)\/sale-window$/;

async function routeRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // 대표 주소(hyeoks.com)로 모은다(검색엔진 중복 방지). 자동 수집 작업이 쓰는 /api/*와
    // 블로그 스크립트가 읽는 /round/N/data.json은 옛 주소에서도 그대로 응답한다.
    // 정적 파일(첫 화면 등)은 워커를 거치지 않으므로 각 HTML의 스크립트가 같은 이동을 한다.
    if (
      (url.hostname.endsWith(".workers.dev") || url.hostname === "www.hyeoks.com") &&
      (request.method === "GET" || request.method === "HEAD") &&
      !pathname.startsWith("/api/") &&
      !ROUND_DATA_RE.test(pathname)
    ) {
      return Response.redirect(`${CANONICAL_ORIGIN}${pathname}${url.search}`, 301);
    }

    try {
      if (request.method === "GET" && !pathname.startsWith("/api/")) {
        const legacy = legacyAppLocation(url);
        if (legacy) return Response.redirect(legacy, 302);
        let clean = pathname;
        if (pathname === "/index.html") clean = "/";
        else if (pathname === "/guide" || pathname === "/guide/index.html") clean = "/guide/";
        else if (/^\/(app|about|privacy|methodology|sources|editorial|contact|responsible)\.html$/.test(pathname)) clean = pathname.replace(/\.html$/, "");
        else if (/^\/guide\/[^/]+\.html$/.test(pathname)) clean = pathname.replace(/\.html$/, "");
        else if (/^\/(app|matches|performance|ratings|about|privacy|methodology|sources|editorial|contact|responsible)\/$/.test(pathname)) clean = pathname.replace(/\/$/, "");
        else if (/^\/insights\/(draw-rates|rank-gap|probability-audit)\/$/.test(pathname)) clean = pathname.replace(/\/$/, "");
        else if (/^\/round\/\d+\/?$/.test(pathname)) clean = `/round/${Number(pathname.match(/\d+/)![0])}`;
        else if (/^\/(match|league)\/[^/]+\/$/.test(pathname)) clean = pathname.replace(/\/$/, "");
        if (clean !== pathname) return Response.redirect(`${CANONICAL_ORIGIN}${clean}${url.search}`, 301);
        if (pathname === "/") return await handleDataHome(env);
        if (pathname === "/performance") return await handlePerformancePage(env);
        if (pathname === "/performance/data.json") return await handlePerformanceData(env);
        // 리그별 Elo 전력 순위(자체 집계 순위표와 비교). 정적 자산이 아니라 워커가 그린다.
        if (pathname === "/ratings") return await handleRatingsPage(env);
        // 리그·시즌별 홈승·무승부·원정승 비율(저장 결과 집계). 워커가 그린다.
        if (pathname === "/insights/draw-rates") return await handleDrawRatesPage(env);
        if (pathname === "/insights/rank-gap") return await handleRankGapPage(env);
        if (pathname === "/insights/probability-audit") return await handleProbabilityAuditPage(env);
      }
      if (pathname === "/api/rounds" && request.method === "GET") {
        return await handleListRounds(env);
      }

      if (pathname === "/api/settlement" && request.method === "GET") {
        return await handleSettlement(env);
      }

      const roundMatch = pathname.match(ROUND_ID_RE);
      if (roundMatch) {
        const roundId = Number(roundMatch[1]);
        const sub = roundMatch[2];
        if (!sub && request.method === "GET") return await handleGetRound(env, roundId);
        if (sub === "predict" && request.method === "POST") return await handlePredict(env, roundId, request);
        if (sub === "combinations" && request.method === "POST")
          return await handleCombinations(env, roundId, request);
        if (sub === "exclusive-pick" && request.method === "POST")
          return await handleExclusivePick(env, roundId, request);
        if (sub === "report" && request.method === "GET") return await handleReport(env, roundId);
      }

      const adminReportMatch = pathname.match(ADMIN_ROUND_REPORT_RE);
      if (adminReportMatch && request.method === "POST") {
        return await handleWriteReport(env, Number(adminReportMatch[1]), request);
      }

      const adminMarketOddsMatch = pathname.match(ADMIN_ROUND_MARKET_ODDS_RE);
      if (adminMarketOddsMatch && request.method === "POST") {
        return await handleWriteMarketOdds(env, Number(adminMarketOddsMatch[1]), request);
      }

      const adminVoteShareMatch = pathname.match(ADMIN_ROUND_VOTE_SHARE_RE);
      if (adminVoteShareMatch && request.method === "POST") {
        return await handleWriteVoteShare(env, Number(adminVoteShareMatch[1]), request);
      }

      const adminSaleWindowMatch = pathname.match(ADMIN_ROUND_SALE_WINDOW_RE);
      if (adminSaleWindowMatch && request.method === "POST") {
        return await handleWriteSaleWindow(env, Number(adminSaleWindowMatch[1]), request);
      }

      const adminMatch = pathname.match(ADMIN_ROUND_RE);
      if (adminMatch && request.method === "PATCH") {
        return await handleCorrectRoundNo(env, Number(adminMatch[1]), request);
      }

      if (pathname === "/api/admin/sync-fixtures" && request.method === "POST") {
        return await handleSyncFixtures(env, request);
      }

      if (pathname === "/api/admin/fixtures" && request.method === "GET") {
        return await handleListFixtures(env, request);
      }

      if (pathname === "/api/admin/sync" && request.method === "POST") {
        return await handleSync(env, request);
      }

      if (pathname === "/api/admin/detect-round" && request.method === "POST") {
        return await handleDetectRound(env, request);
      }

      if (pathname === "/api/admin/notify-test" && request.method === "POST") {
        return await handleNotifyTest(env, request);
      }

      // 이용 측정 비콘. 실패해도 페이지에 영향이 없게 항상 204로 답한다.
      if (pathname === "/api/e" && request.method === "POST") {
        try {
          const body = JSON.parse(await request.text());
          await recordUsage(env, body ?? {}, request);
        } catch {
          // 형식이 틀린 요청은 무시
        }
        return new Response(null, { status: 204 });
      }

      if (pathname === "/api/admin/usage" && request.method === "GET") {
        const authError = requireAdmin(request, env);
        if (authError) return authError;
        const days = Number(url.searchParams.get("days") ?? 14) || 14;
        return json({ days, rows: await usageSince(env, days) });
      }

      if (pathname === "/api/matches" && request.method === "GET") {
        return await handleMatchList(env, request);
      }

      if (pathname.startsWith("/api/")) {
        return json({ error: "not_found" }, 404);
      }

      const roundData = pathname.match(ROUND_DATA_RE);
      if (roundData && request.method === "GET") {
        return await handleRoundData(env, request, Number(roundData[1]));
      }

      const roundPage = pathname.match(ROUND_PAGE_RE);
      if (roundPage && request.method === "GET") {
        return await handleRoundPage(env, request, Number(roundPage[1]), Boolean(roundPage[2]));
      }

      const mData = pathname.match(MATCH_DATA_RE);
      if (mData && request.method === "GET") return await handleMatchData(env, mData[1]);
      const mPage = pathname.match(MATCH_PAGE_RE);
      if (mPage && request.method === "GET") return await handleMatchPage(env, request, mPage[1]);
      const lPage = pathname.match(LEAGUE_PAGE_RE);
      if (lPage && request.method === "GET") return await handleLeaguePage(env, request, lPage[1]);
      if ((pathname === "/matches" || pathname === "/matches/") && request.method === "GET") return await handleHubPage(env, request);
      if (pathname === "/sitemap.xml") return await handleSitemap(env, request);
      if (pathname === "/robots.txt") return handleRobots(request);

      const asset = await env.ASSETS.fetch(request);
      if (asset.status === 404 && request.method === "GET" && !/\.[a-z0-9]+$/i.test(pathname)) return errorPage(404);
      return withSiteChrome(asset, pathname);
    } catch (err) {
      console.error(err);
      // 공개 화면에 데이터베이스 예외나 내부 상세를 노출하지 않는다.
      if (pathname.startsWith("/api/") || pathname.endsWith(".json")) return json({ error: "temporarily_unavailable" }, 503);
      return errorPage(503);
    }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // HEAD도 공개 GET과 같은 상태·헤더를 돌려준다(검색엔진·검수 도구가 HEAD로 확인하는 경우 대비).
    if (request.method === "HEAD") {
      const res = await routeRequest(new Request(request, { method: "GET" }), env);
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return routeRequest(request, env);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === "0 */3 * * *") {
      const result = await refreshHistory(env);
      console.log(`refreshHistory: ${JSON.stringify(result)}`);
    } else if (controller.cron === "0 */6 * * *") {
      const result = await detectNewRound(env);
      console.log(`detectNewRound: ${JSON.stringify(result)}`);
    } else if (controller.cron === "30 */6 * * *") {
      // 경기별 페이지용 지원 리그 7일 경기 수집·예측 저장(docs/specs/002). 회차 감지(0 */6)와
      // 같은 호출에 넣지 않은 이유: 워커 호출당 외부 요청 한도를 두 작업이 나눠 쓰지 않게 하려고.
      const result = await syncFixtures(env);
      console.log(`syncFixtures: ${JSON.stringify(result)}`);
    } else if (controller.cron === "*/10 * * * *") {
      // 마감 12·6·3·1시간 전 배당·투표율 수집 호출(토큰 없으면 건너뜀)
      const result = await runDeadlineTrigger(env);
      if (result.reason !== "none_due") console.log(`deadlineTrigger: ${JSON.stringify(result)}`);
    }
  },
} satisfies ExportedHandler<Env>;
