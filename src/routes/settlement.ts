// GET /api/settlement - 정산된 회차들의 실전 성적(기본픽 vs 독식픽) 집계.
// "이 서비스가 실제로 가치가 있는가"를 판단할 유일한 실전 근거라 별도 엔드포인트로 노출한다.
import { listRounds, getRoundResults, getLatestVoteShare } from "../lib/db";
import { json } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import { computeRoundSettlement, summarize, type SettlementMatchInput, type RoundSettlement } from "../lib/settlementStats";
import type { Env } from "../types";

export async function handleSettlement(env: Env): Promise<Response> {
  const rounds = await listRounds(env);
  const out: RoundSettlement[] = [];

  for (const round of rounds) {
    // 정산이 하나도 안 된 회차(발매중)는 건너뛴다 - 성적 집계 대상이 아니다.
    if (round.status === "upcoming") continue;

    let predictions;
    try {
      predictions = await buildRoundPredictions(env, round.id);
    } catch {
      // 예측 원본이 없는 과거 회차는 조용히 스킵(정산 집계가 통째로 실패하지 않도록)
      continue;
    }
    const matchIds = predictions.map((p) => p.match.id);
    const [results, voteShare] = await Promise.all([
      getRoundResults(env, matchIds),
      getLatestVoteShare(env, matchIds),
    ]);

    const matches: SettlementMatchInput[] = predictions.map((p) => {
      const r = results.get(p.match.id);
      const v = voteShare.get(p.match.id);
      return {
        seq: p.match.seq,
        league: p.match.league,
        home: p.match.home_kr,
        away: p.match.away_kr,
        prediction: p.prediction,
        voteShare: v ? { home: v.vote_home, draw: v.vote_draw, away: v.vote_away } : null,
        actual: r ? r.actual : null,
      };
    });

    out.push(computeRoundSettlement(round.id, round.round_no, matches));
  }

  return json({ summary: summarize(out), rounds: out });
}
