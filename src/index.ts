// Worker 엔트리: API 라우팅 + 정적 자산 서빙 + Cron 디스패치
import { handleListRounds, handleGetRound } from "./routes/rounds";
import { handlePredict } from "./routes/predict";
import { handleCombinations } from "./routes/combinations";
import { handleExclusivePick } from "./routes/exclusivePick";
import { handleReport } from "./routes/report";
import {
  handleCorrectRoundNo,
  handleSync,
  handleDetectRound,
  handleNotifyTest,
  handleWriteReport,
  handleWriteMarketOdds,
  handleWriteVoteShare,
} from "./routes/admin";
import { refreshHistory } from "./cron/refreshHistory";
import { detectNewRound } from "./cron/detectNewRound";
import { json } from "./lib/http";
import type { Env } from "./types";

const ROUND_ID_RE = /^\/api\/rounds\/(\d+)(?:\/(predict|combinations|report|exclusive-pick))?$/;
const ADMIN_ROUND_RE = /^\/api\/admin\/rounds\/(\d+)$/;
const ADMIN_ROUND_REPORT_RE = /^\/api\/admin\/rounds\/(\d+)\/report$/;
const ADMIN_ROUND_MARKET_ODDS_RE = /^\/api\/admin\/rounds\/(\d+)\/market-odds$/;
const ADMIN_ROUND_VOTE_SHARE_RE = /^\/api\/admin\/rounds\/(\d+)\/vote-share$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/api/rounds" && request.method === "GET") {
        return await handleListRounds(env);
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

      const adminMatch = pathname.match(ADMIN_ROUND_RE);
      if (adminMatch && request.method === "PATCH") {
        return await handleCorrectRoundNo(env, Number(adminMatch[1]), request);
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

      if (pathname.startsWith("/api/")) {
        return json({ error: "not_found" }, 404);
      }

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
    }
  },
} satisfies ExportedHandler<Env>;
