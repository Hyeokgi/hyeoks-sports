// POST /api/rounds/:id/exclusive-pick - betman 투표율을 반영한 독식(단독 당첨) 지향 픽 생성.
// 프론트는 회차 데이터로 클라이언트에서 같은 라이브러리를 직접 돌리지만(다른 탭들과 동일 구조),
// GitHub Actions 러너/외부 도구가 쓸 수 있도록 서버 라우트도 같이 제공한다.
import { getRound, getLatestVoteShare } from "../lib/db";
import { json, safeJson } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import { generateExclusivePick, type ExclusiveMatchInput, type ExclusivePickOptions } from "../lib/exclusivePick";
import type { Env } from "../types";

export async function handleExclusivePick(env: Env, roundId: number, request: Request): Promise<Response> {
  const round = await getRound(env, roundId);
  if (!round) return json({ error: "round_not_found" }, 404);

  const body = await safeJson(request);
  const toggles = body?.toggles ?? {};
  const options: ExclusivePickOptions = body?.options ?? {};

  const predictions = await buildRoundPredictions(env, roundId, toggles);
  const voteShare = await getLatestVoteShare(
    env,
    predictions.map((p) => p.match.id),
  );

  const inputs: ExclusiveMatchInput[] = predictions.map((p) => {
    const vote = voteShare.get(p.match.id) ?? null;
    return {
      seq: p.match.seq,
      league: p.match.league,
      home: p.match.home_kr,
      away: p.match.away_kr,
      prediction: p.prediction,
      voteShare: vote ? { home: vote.vote_home, draw: vote.vote_draw, away: vote.vote_away } : null,
    };
  });

  const result = generateExclusivePick(inputs, options);
  return json({ round_id: roundId, result });
}
