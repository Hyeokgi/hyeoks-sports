// GET /api/settlement - 정산된 회차들의 실전 성적(기본픽 vs 독식픽) 집계.
// "이 서비스가 실제로 가치가 있는가"를 판단할 유일한 실전 근거라 별도 엔드포인트로 노출한다.
//
// 채점 규칙(2026-10 엄격화): 기본 성적(basePickHits/settledMatches/basePickAccuracy)은 킥오프 전에
// 저장됐음이 검증된 근거 있는 스냅샷(isVerifiedSnapshot)만으로 센다. 예전엔 스냅샷이 없으면 현재 코드로
// 다시 계산한 p.prediction으로 메웠는데, 그러면 모델을 바꿀 때마다 과거 성적이 소급해서 바뀐다(AGENTS.md).
// 스냅샷이 없던 시절 경기는 "재구성(reconstructed)" 참고 수치로만 따로 내보내고 기본 성적에 합치지 않는다.
// 기존 화면 필드(summary.rounds/settledMatches/basePickAccuracy/drawRate, rounds[].basePickHits 등)의
// 이름과 형식은 그대로 두고, 뜻만 "검증된 기록 기준"으로 좁혔다.
//
// 독식픽: 정산 시점에 현재 라이브러리로 다시 생성한 조합이다. 당시 실제로 공개·발행한 독식픽이 아니므로
// exclusivePickProvenance="retrospective"로 표시한다(소급 계산, 실제 발행 기록 아님).
import { listRounds, getRoundResults, getLatestVoteShare } from "../lib/db";
import { json } from "../lib/http";
import { buildRoundPredictions } from "../lib/predictRound";
import { computeRoundSettlement, summarize, type SettlementMatchInput, type RoundSettlement } from "../lib/settlementStats";
import { classifyRecord, getPredictionSnapshots, type RecordProvenance } from "../lib/predictionSnapshot";
import type { Env } from "../types";

const LABEL = { H: "홈승", D: "무승부", A: "원정승" } as const;

/** 결과가 나온 경기의 출처별 개수. verified만 기본 성적에 들어간다. */
export interface ProvenanceCounts {
  verified: number;
  reconstructed: number;
  unverified: number;
  noPrediction: number;
}

/** 기존 RoundSettlement에 붙는 출처 정보(추가 필드만, 기존 필드 의미는 "검증된 기록 기준"). */
export interface RoundSettlementWithProvenance extends RoundSettlement {
  // 결과가 나온 경기 전체(출처 무관). 실제 결과 자체는 예측 출처와 상관없이 보여줄 수 있다.
  resultsSettled: number;
  resultsDraws: number;
  provenance: ProvenanceCounts;
  // 재구성(현재 코드로 다시 계산) 1픽의 참고 적중 수. 기본 성적과 합치지 않는다.
  reconstructedPickHits: number;
  exclusivePickProvenance: "retrospective";
}

const emptyCounts = (): ProvenanceCounts => ({ verified: 0, reconstructed: 0, unverified: 0, noPrediction: 0 });
const countKey: Record<RecordProvenance, keyof ProvenanceCounts> = {
  verified: "verified",
  reconstructed: "reconstructed",
  unverified: "unverified",
  no_prediction: "noPrediction",
};

export async function handleSettlement(env: Env): Promise<Response> {
  const rounds = await listRounds(env);
  const out: RoundSettlementWithProvenance[] = [];

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
    const [results, voteShare, snapshots] = await Promise.all([
      getRoundResults(env, matchIds),
      getLatestVoteShare(env, matchIds),
      getPredictionSnapshots(env, matchIds),
    ]);

    const provenance = emptyCounts();
    let reconstructedPickHits = 0;
    let resultsSettled = 0;
    let resultsDraws = 0;
    let allVerified = predictions.length > 0;

    const strict: SettlementMatchInput[] = [];
    const allResults: SettlementMatchInput[] = [];
    for (const p of predictions) {
      const r = results.get(p.match.id);
      const v = voteShare.get(p.match.id);
      const snap = snapshots.get(p.match.id);
      const kind = classifyRecord(snap, p.match.kickoff_at, p.prediction, p.predictedAfterKickoff);
      if (kind !== "verified") allVerified = false;
      const vote = v ? { home: v.vote_home, draw: v.vote_draw, away: v.vote_away } : null;
      // 검증된 스냅샷이 있으면 그 값, 없으면 (소급 독식픽 생성용으로만) 현재 계산값.
      // 현재 계산값은 actual을 null로 넘겨 기본 성적에 절대 들어가지 않게 한다.
      const prediction = kind === "verified" ? snap!.prediction : p.prediction;
      const base = { seq: p.match.seq, league: p.match.league, home: p.match.home_kr, away: p.match.away_kr, prediction, voteShare: vote };
      strict.push({ ...base, actual: r && kind === "verified" ? r.actual : null });
      // 실제 당첨조합의 대중 희소성은 결과·투표율만으로 정해진다(예측과 무관) - 결과 전체로 계산한다.
      allResults.push({ ...base, actual: r ? r.actual : null });

      if (!r) continue;
      resultsSettled++;
      if (r.actual === "D") resultsDraws++;
      provenance[countKey[kind]]++;
      if (kind === "reconstructed" && p.prediction.rankedPicks[0] === LABEL[r.actual]) reconstructedPickHits++;
    }

    const s = computeRoundSettlement(round.id, round.round_no, strict);
    const all = computeRoundSettlement(round.id, round.round_no, allResults);
    out.push({
      ...s,
      actualCrowdShare: all.actualCrowdShare,
      // 기본픽 조합 희소성은 14경기 모두 검증된 기록일 때만 의미가 있다(재구성 픽이 섞이면 당시 조합이 아니다).
      baseCrowdShare: allVerified ? s.baseCrowdShare : null,
      resultsSettled,
      resultsDraws,
      provenance,
      reconstructedPickHits,
      exclusivePickProvenance: "retrospective",
    });
  }

  const base = summarize(out);
  const totals = out.reduce((t, r) => {
    for (const k of Object.keys(t) as (keyof ProvenanceCounts)[]) t[k] += r.provenance[k];
    return t;
  }, emptyCounts());
  const reconstructedPickHits = out.reduce((s, r) => s + r.reconstructedPickHits, 0);
  return json({
    summary: {
      ...base,
      // 기본 수치는 검증된 킥오프 전 저장 기록만 센 값이다. 아래는 따로 보는 참고·제외 수치.
      scoringBasis: "verified_pre_kickoff_snapshot",
      provenance: totals,
      resultsSettled: out.reduce((s, r) => s + r.resultsSettled, 0),
      reconstructed: {
        settledMatches: totals.reconstructed,
        pickHits: reconstructedPickHits,
        pickAccuracy: totals.reconstructed > 0 ? reconstructedPickHits / totals.reconstructed : null,
        note: "당시 저장된 예측이 없어 현재 코드로 다시 계산한 참고값입니다. 실제 기록에 합치지 않습니다.",
      },
      exclusivePickProvenance: "retrospective",
      exclusivePickNote: "독식픽 적중은 정산 시점에 다시 생성한 조합으로 센 소급 계산이며, 당시 실제로 발행한 픽이 아닙니다.",
    },
    rounds: out,
  });
}
