// 경기 시작 전 마지막 예측 보존(migration 0010).
//
// 예측은 조회할 때마다 현재 코드로 다시 계산된다. 모델 가중치를 바꾸면 이미 끝난 경기의
// "그때 냈던 픽"까지 바뀌므로, 실제 기록(정산·회차 글·앱 적중 배지)은 이 스냅샷을 쓴다.
// 킥오프 전까지는 배당이 들어올 때마다 덮어쓰고, 킥오프가 지나면 다시 쓰지 않는다.
import { buildRoundPredictions } from "./predictRound";
import type { MatchPrediction, PredictionBasis } from "./prediction";
import type { Env } from "../types";

export interface SnapshotRow {
  round_match_id: number;
  p_home: number;
  p_draw: number;
  p_away: number;
  pick: string;
  basis: string;
  confidence_gap: number;
  tier: string | null;
  n_bookmakers: number | null;
  captured_at: string;
}

export interface PredictionSnapshot {
  prediction: MatchPrediction;
  tier: string | null;
  nBookmakers: number | null;
  capturedAt: string;
}

/** 스냅샷 행을 MatchPrediction 모양으로 되살린다(1·2·3위 순서와 확신도 차이 포함). */
export function snapshotToPrediction(row: SnapshotRow): MatchPrediction {
  const probs: [MatchPrediction["rankedPicks"][number], number][] = [
    ["홈승", row.p_home],
    ["무승부", row.p_draw],
    ["원정승", row.p_away],
  ];
  const ranked = [...probs].sort((a, b) => b[1] - a[1]);
  return {
    pHome: row.p_home,
    pDraw: row.p_draw,
    pAway: row.p_away,
    // 저장된 픽이 1위다(동률일 때 계산 순서가 달라져도 그때 낸 픽을 지킨다).
    rankedPicks: [row.pick as MatchPrediction["rankedPicks"][number], ...ranked.map((r) => r[0]).filter((l) => l !== row.pick)],
    confidenceGap: row.confidence_gap,
    basis: row.basis as PredictionBasis,
  };
}

export async function getPredictionSnapshots(env: Env, ids: number[]): Promise<Map<number, PredictionSnapshot>> {
  const out = new Map<number, PredictionSnapshot>();
  if (ids.length === 0) return out;
  const { results } = await env.DB.prepare(
    `SELECT * FROM prediction_snapshots WHERE round_match_id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<SnapshotRow>();
  for (const r of results ?? []) {
    out.set(r.round_match_id, {
      prediction: snapshotToPrediction(r),
      tier: r.tier,
      nBookmakers: r.n_bookmakers,
      capturedAt: r.captured_at,
    });
  }
  return out;
}

/** 이 경기를 지금 스냅샷해도 되는가: 킥오프 전이고, 사후 등록이 아니어야 한다. */
export function shouldSnapshot(kickoffAt: string | null, predictedAfterKickoff: boolean, now: number): boolean {
  if (predictedAfterKickoff) return false;
  if (!kickoffAt) return true; // 시각을 모르면 계속 갱신(킥오프 판단 불가 - 기존 동작과 같은 보수적 선택)
  const k = Date.parse(kickoffAt);
  return !Number.isFinite(k) || k > now;
}

/** 한 회차의 킥오프 전 경기 예측을 저장한다. 서버 기본 설정(리그별 가중치) 기준. */
export async function snapshotRound(env: Env, roundId: number, now = Date.now()): Promise<number> {
  const preds = await buildRoundPredictions(env, roundId);
  const at = new Date(now).toISOString();
  const stmts = preds
    .filter((p) => shouldSnapshot(p.match.kickoff_at, p.predictedAfterKickoff, now))
    .map((p) =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO prediction_snapshots
           (round_match_id, p_home, p_draw, p_away, pick, basis, confidence_gap, tier, n_bookmakers, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        p.match.id,
        p.prediction.pHome,
        p.prediction.pDraw,
        p.prediction.pAway,
        p.prediction.rankedPicks[0],
        p.prediction.basis,
        p.prediction.confidenceGap,
        p.calibration.tier,
        p.raw.market?.nBookmakers ?? null,
        at,
      ),
    );
  if (stmts.length > 0) await env.DB.batch(stmts);
  return stmts.length;
}

/** 진행중 회차 전부. refreshHistory(3시간)에서 부른다. */
export async function snapshotUpcomingRounds(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id FROM rounds WHERE status = 'upcoming'").all<{ id: number }>();
  let n = 0;
  for (const r of results ?? []) n += await snapshotRound(env, r.id);
  return n;
}
