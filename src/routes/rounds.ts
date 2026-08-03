// GET /api/rounds, GET /api/rounds/:id
import { getRound, listRounds, getRoundResults, getLatestVoteShare } from "../lib/db";
import { json } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import type { Env } from "../types";

export async function handleListRounds(env: Env): Promise<Response> {
  const rounds = await listRounds(env);
  return json({ rounds });
}

export async function handleGetRound(env: Env, roundId: number): Promise<Response> {
  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const predictions = await buildRoundPredictions(env, roundId);
  const matchIds = predictions.map((p) => p.match.id);
  const [results, voteShare] = await Promise.all([
    getRoundResults(env, matchIds),
    getLatestVoteShare(env, matchIds),
  ]);

  return json({
    round,
    matches: predictions.map((p) => {
      const result = results.get(p.match.id) ?? null;
      const vote = voteShare.get(p.match.id) ?? null;
      return {
        seq: p.match.seq,
        league: p.match.league,
        home: p.match.home_kr,
        away: p.match.away_kr,
        kickoff_at: p.match.kickoff_at,
        raw: p.raw,
        prediction: p.prediction,
        calibration: p.calibration,
        // 회차가 정산되면 채워짐(round_results). 진행중이면 null.
        result: result ? { actual: result.actual, hg: result.hg, ag: result.ag } : null,
        // betman 투표율 최신 스냅샷. 아직 발매 전/미수집이면 null.
        voteShare: vote ? { home: vote.vote_home, draw: vote.vote_draw, away: vote.vote_away } : null,
      };
    }),
  });
}
