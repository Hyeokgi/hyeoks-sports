// GET /api/rounds, GET /api/rounds/:id
import { getRound, listRounds, getRoundResults, getLatestVoteShare, getMarketOddsHistory } from "../lib/db";
import { json } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import { getPredictionSnapshots } from "../lib/predictionSnapshot";
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
  const [results, voteShare, oddsHistory, snapshots] = await Promise.all([
    getRoundResults(env, matchIds),
    getLatestVoteShare(env, matchIds),
    getMarketOddsHistory(env, matchIds),
    getPredictionSnapshots(env, matchIds),
  ]);

  return json({
    round,
    matches: predictions.map((p) => {
      const result = results.get(p.match.id) ?? null;
      const vote = voteShare.get(p.match.id) ?? null;
      const history = oddsHistory.get(p.match.id) ?? [];
      return {
        seq: p.match.seq,
        league: p.match.league,
        home: p.match.home_kr,
        away: p.match.away_kr,
        kickoff_at: p.match.kickoff_at,
        raw: p.raw,
        prediction: p.prediction,
        calibration: p.calibration,
        upsetSignal: p.upsetSignal,
        // true면 이미 끝난 경기를 결과가 반영된 데이터로 사후 등록한 것 - 적중 집계에서 뺀다.
        predictedAfterKickoff: p.predictedAfterKickoff,
        // 킥오프 전 마지막으로 공개한 예측. 실제 기록(적중 여부)은 이걸로 매긴다 - 현재 코드로
        // 다시 계산한 prediction은 모델이 바뀌면 소급해서 달라지기 때문이다. 없으면 null.
        snapshot: (() => {
          const s = snapshots.get(p.match.id);
          return s
            ? { pick: s.prediction.rankedPicks[0], pHome: s.prediction.pHome, pDraw: s.prediction.pDraw, pAway: s.prediction.pAway, basis: s.prediction.basis, capturedAt: s.capturedAt }
            : null;
        })(),
        // 회차가 정산되면 채워짐(round_results). 진행중이면 null.
        result: result ? { actual: result.actual, hg: result.hg, ag: result.ag } : null,
        // betman 투표율 최신 스냅샷. 아직 발매 전/미수집이면 null.
        voteShare: vote ? { home: vote.vote_home, draw: vote.vote_draw, away: vote.vote_away } : null,
        // 배당 라인무브먼트(오프닝->최신) 스냅샷 목록. 아직 검증 전 원본 데이터라 예측에는
        // 반영하지 않고 참고용으로만 노출한다(표본 축적 후 별도 백테스트 예정).
        marketOddsHistory: history.map((h) => ({
          pHome: h.p_home,
          pDraw: h.p_draw,
          pAway: h.p_away,
          nBookmakers: h.n_bookmakers,
          snapshotAt: h.snapshot_at,
        })),
      };
    }),
  });
}
