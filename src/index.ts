// Worker 엔트리: API 라우팅 + 정적 자산 서빙 + Cron 디스패치
import { handleListRounds, handleGetRound } from "./routes/rounds";
import { handlePredict } from "./routes/predict";
import { handleCombinations } from "./routes/combinations";
import { handleExclusivePick } from "./routes/exclusivePick";
import { handleReport } from "./routes/report";
import { handleSettlement } from "./routes/settlement";
import { handleRoundPage, handleRoundData, handleSitemap, handleRobots } from "./routes/roundPage";
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

const ROUND_ID_RE = /^\/api\/rounds\/(\d+)(?:\/(predict|combinations|report|exclusive-pick))?$/;
// 회차 분석 페이지(공개)와 블로그 초안. 정적 자산에 없는 경로라 워커로 넘어온다.
const ROUND_PAGE_RE = /^\/round\/(\d+)(\/draft)?\/?$/;
const ROUND_DATA_RE = /^\/round\/(\d+)\/data\.json$/;
const CANONICAL_ORIGIN = "https://hyeoks.com";
const ADMIN_ROUND_RE = /^\/api\/admin\/rounds\/(\d+)$/;
const ADMIN_ROUND_REPORT_RE = /^\/api\/admin\/rounds\/(\d+)\/report$/;
const ADMIN_ROUND_MARKET_ODDS_RE = /^\/api\/admin\/rounds\/(\d+)\/market-odds$/;
const ADMIN_ROUND_VOTE_SHARE_RE = /^\/api\/admin\/rounds\/(\d+)\/vote-share$/;
const ADMIN_ROUND_SALE_WINDOW_RE = /^\/api\/admin\/rounds\/(\d+)\/sale-window$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      if (pathname === "/sitemap.xml") return await handleSitemap(env, request);
      if (pathname === "/robots.txt") return handleRobots(request);

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error", message: (err as Error).message }, 500);
    }
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
