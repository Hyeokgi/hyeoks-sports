// 새 관측만 저장한다. 과거 예측 복원이나 모델 재검증이 아니다.
import type { MatchWithPrediction } from "./predictRound";
import { DEFAULT_TOGGLES } from "./prediction";
import { togglesForLeague } from "./clientPrediction";
import type { Env } from "../types";

// 배포 해시나 검증된 모델 버전이 아니라 이 계측의 시작점을 식별한다.
// 예측 코드/기본 설정이 바뀌면 함께 올려야 한다. 과거 행의 값은 바꾸지 않는다.
export const PREDICTION_HISTORY_MODEL_REVISION = "history-instrumentation-v1";
export const HISTORY_INPUT_MAX_LENGTH = 4096;

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** 허용 목록만 직렬화한다. 요청·환경·토큰·임의 raw 속성은 저장하지 않는다. */
export function predictionHistoryInputs(p: MatchWithPrediction): string {
  const r = p.raw;
  const context = JSON.stringify({
    schema: 1,
    league: p.match.league.slice(0, 100),
    eloDiff: finite(r.eloDiff), formDiff: finite(r.formDiff),
    h2hDiff: finite(r.h2hDiff), nH2h: finite(r.nH2h),
    leagueDrawRate: finite(r.leagueDrawRate),
    xgDiff: finite(r.xgDiff), cornersDiff: finite(r.cornersDiff),
    nationalEloDiff: finite(r.nationalEloDiff),
    resolvedMarketOnly: typeof r.resolvedMarketOnly === "boolean" ? r.resolvedMarketOnly : null,
    market: r.market ? {
      pHome: finite(r.market.pHome), pDraw: finite(r.market.pDraw),
      pAway: finite(r.market.pAway), nBookmakers: finite(r.market.nBookmakers),
    } : null,
    // snapshotRound는 사용자 토글이 아닌 서버 기본 설정으로만 계산한다.
    toggles: togglesForLeague(DEFAULT_TOGGLES, p.match.league),
  });
  if (context.length > HISTORY_INPUT_MAX_LENGTH) throw new Error("prediction_history input context exceeds limit");
  return context;
}

// 조회 후 INSERT를 나누면 동시 요청이 중복 변화를 만들 수 있어 최신 비교까지 한 문장으로 한다.
// 시각 역전(오래 걸린 이전 요청)은 버리고 같은 확률이라도 A→B→A는 보존한다.
export const PREDICTION_HISTORY_INSERT_SQL = `WITH candidate AS (
  SELECT ? AS round_match_id, ? AS p_home, ? AS p_draw, ? AS p_away,
         ? AS pick, ? AS basis, ? AS captured_at, ? AS prediction_kickoff_at,
         ? AS model_revision, ? AS input_context
), latest AS (
  SELECT h.* FROM prediction_history h
   WHERE h.round_match_id = (SELECT round_match_id FROM candidate)
   ORDER BY h.captured_at DESC, h.id DESC LIMIT 1
)
INSERT INTO prediction_history
  (round_match_id, round_id, p_home, p_draw, p_away, pick, basis, captured_at,
   kickoff_at, prediction_kickoff_at, model_revision, input_context)
SELECT c.round_match_id, rm.round_id, c.p_home, c.p_draw, c.p_away, c.pick, c.basis,
       c.captured_at, rm.kickoff_at, c.prediction_kickoff_at, c.model_revision, c.input_context
  FROM candidate c JOIN round_matches rm ON rm.id = c.round_match_id
 WHERE rm.kickoff_at IS NOT NULL
   AND julianday(rm.kickoff_at) IS NOT NULL
   AND julianday(c.captured_at) IS NOT NULL
   AND julianday(c.captured_at) < julianday(rm.kickoff_at)
   AND julianday(c.captured_at) < julianday(c.prediction_kickoff_at)
   AND julianday('now') < julianday(rm.kickoff_at)
   AND NOT EXISTS (
     SELECT 1 FROM latest h WHERE h.p_home = c.p_home AND h.p_draw = c.p_draw
       AND h.p_away = c.p_away AND h.basis = c.basis
   )
   AND NOT EXISTS (
     SELECT 1 FROM latest h WHERE julianday(h.captured_at) >= julianday(c.captured_at)
   )
ON CONFLICT(round_match_id, captured_at) DO NOTHING`;

/** 기존의 엄격한 쓰기 판정을 통과한 예측만 받는다. 실패는 호출자가 명시적으로 기록한다. */
export async function appendPredictionHistory(
  env: Env, predictions: MatchWithPrediction[], capturedAt: string,
): Promise<void> {
  const statements = predictions.map((p) => env.DB.prepare(PREDICTION_HISTORY_INSERT_SQL).bind(
    p.match.id, p.prediction.pHome, p.prediction.pDraw, p.prediction.pAway,
    p.prediction.rankedPicks[0], p.prediction.basis, capturedAt, p.match.kickoff_at,
    PREDICTION_HISTORY_MODEL_REVISION, predictionHistoryInputs(p),
  ));
  if (statements.length) await env.DB.batch(statements);
}
