// 경기 시작 전 마지막 예측 보존(migration 0010).
//
// 예측은 조회할 때마다 현재 코드로 다시 계산된다. 모델 가중치를 바꾸면 이미 끝난 경기의
// "그때 냈던 픽"까지 바뀌므로, 실제 기록(정산·회차 글·앱 적중 배지)은 이 스냅샷을 쓴다.
// 킥오프 전까지는 배당이 들어올 때마다 덮어쓰고, 킥오프가 지나면 다시 쓰지 않는다.
//
// 엄격 규칙(2026-10 감사 반영):
//   - 킥오프 시각을 모르거나 못 읽으면 쓰지 않는다. 예전엔 "모르면 계속 갱신"이라 킥오프 뒤에
//     찍힌 값이 기록으로 남을 수 있었다(킥오프 전 예측임을 증명할 수 없다).
//   - 저장 시각은 예측을 다 만든 "뒤"의 실제 시각이다. 조립이 오래 걸려 킥오프를 넘기면 늦은 값이
//     킥오프 전 값처럼 기록되기 때문이다. SQL에서도 julianday(저장 시각) < julianday(킥오프)를
//     원자적으로 다시 확인해, 판단과 쓰기 사이에 킥오프가 지나거나 바뀌어도 늦은 값이 덮이지 않게 한다.
//   - 근거 없음(basis=none, 대칭 임시 확률)과 확률·픽이 이상한 값은 쓰지 않는다(예측이 아니다).
//   - 읽는 쪽은 isVerifiedSnapshot으로 "저장 시각 < 유효한 킥오프 + 근거 있음 + 확률 정상"을 확인한 값만
//     실제 기록으로 센다. 그 밖의 행(옛 규칙으로 쓰인 행 포함)은 보여줄 수는 있어도 채점하지 않는다.
import { buildRoundPredictions } from "./predictRound";
import { appendPredictionHistory } from "./predictionHistory";
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

/**
 * 끝난 경기 기록의 출처.
 *  - verified      : 킥오프 전에 저장된 스냅샷(저장 시각 < 유효한 킥오프, 근거 있음, 확률 정상). 채점 대상.
 *  - reconstructed : 당시 스냅샷이 없어(2026-09-26 이전 등) 현재 코드로 다시 계산한 값. 참고용, 채점 제외.
 *  - no_prediction : 근거 없음(basis=none). 표시 확률은 임시값이라 예측이 아니다. 채점 제외.
 *  - unverified    : 스냅샷은 있지만 킥오프 전 저장을 증명할 수 없거나(시각 누락·파싱 실패·킥오프 이후 저장)
 *                    값이 이상하거나, 예측 성분이 킥오프 이후에 계산된 경기(사후 등록). 채점 제외.
 */
export type RecordProvenance = "verified" | "reconstructed" | "no_prediction" | "unverified";

/** 확률 합 허용 오차. publicPerformance.ts PROB_SUM_TOLERANCE와 같은 값이어야 두 집계가 같은 행을 인정한다. */
export const SNAPSHOT_PROB_SUM_TOLERANCE = 1e-4;
// 픽이 최고 확률인지 볼 때의 부동소수 오차(동률 픽 허용).
const ARGMAX_TOLERANCE = 1e-9;
const GROUNDED_BASES: readonly PredictionBasis[] = ["model", "market", "national"];
const PICK_LABELS = ["홈승", "무승부", "원정승"] as const;

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

// ───────────────────────── 시각 파싱 ─────────────────────────
// ISO(…Z, +09:00 오프셋)와 SQLite(2026-09-27 10:00:00) 표기를 받는다. Date.parse는 엔진마다 관대해서
// 2월 30일을 다음 달로 넘기거나 공백 표기를 로컬시각으로 읽는다. 기록 판정(저장 < 킥오프)이 여기에
// 달려 있어 직접 검증한다. publicPerformance.ts parseTimestamp와 같은 규칙이다(그 파일은 다른 작업
// 범위라 의존하지 않고 같은 규칙을 둔다 - 바꾸면 양쪽을 같이 고친다).
const TS_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 타임스탬프 → epoch ms. 형식·달력이 잘못됐거나 날짜만 있으면 null. 시간대 표기가 없으면 UTC로 본다. */
export function parseSnapshotTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = TS_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] != null ? Number(m[6]) : 0;
  const ms = m[7] != null ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  // 서비스 기간 밖의 연도는 오타·기본값(0000, 1970 등)일 가능성이 커서 받지 않는다.
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMin = 0;
  const zone = m[8];
  if (zone && zone !== "Z" && zone !== "z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (oh > 14 || om > 59) return null;
    offsetMin = sign * (oh * 60 + om);
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMin * 60_000;
  return Number.isFinite(utc) ? utc : null;
}

// ───────────────────────── 값 검증 ─────────────────────────

function isProb(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

/** 세 확률이 [0,1]의 유한수이고 합이 1(±1e-4)인가. 문자열·null은 거부한다(암묵 변환 금지). */
export function hasValidProbabilities(p: { pHome: unknown; pDraw: unknown; pAway: unknown }): boolean {
  const { pHome, pDraw, pAway } = p;
  if (!isProb(pHome) || !isProb(pDraw) || !isProb(pAway)) return false;
  return Math.abs(pHome + pDraw + pAway - 1) <= SNAPSHOT_PROB_SUM_TOLERANCE;
}

/**
 * 기록으로 쓸 수 있는 예측인가: 근거가 있고(model/market/national, none 거부),
 * 확률이 정상이며, 1픽이 올바른 라벨이고 최고 확률 결과다(동률 허용).
 */
export function isGroundedPrediction(p: MatchPrediction | null | undefined): p is MatchPrediction {
  if (!p) return false;
  if (!(GROUNDED_BASES as readonly string[]).includes(p.basis)) return false;
  if (!hasValidProbabilities(p)) return false;
  const pick = p.rankedPicks?.[0];
  if (!(PICK_LABELS as readonly string[]).includes(pick)) return false;
  const probOfPick = pick === "홈승" ? p.pHome : pick === "무승부" ? p.pDraw : p.pAway;
  return probOfPick >= Math.max(p.pHome, p.pDraw, p.pAway) - ARGMAX_TOLERANCE;
}

/**
 * 실제 기록으로 셀 수 있는 스냅샷인가.
 * 저장 시각과 킥오프 시각이 모두 유효하고 저장 < 킥오프(엄격)이며, 근거 있는 정상 예측이어야 한다.
 * 킥오프를 모르면 "킥오프 전 저장"을 증명할 수 없으므로 false다.
 * (사후 등록 여부는 이 함수가 모른다. 호출자가 predictedAfterKickoff와 함께 판단한다 - classifyRecord 참고.)
 */
export function isVerifiedSnapshot(
  snap: PredictionSnapshot | null | undefined,
  kickoffAt: string | null | undefined,
): snap is PredictionSnapshot {
  if (!snap) return false;
  const k = parseSnapshotTimestamp(kickoffAt);
  if (k == null) return false;
  const c = parseSnapshotTimestamp(snap.capturedAt);
  if (c == null || !(c < k)) return false;
  return isGroundedPrediction(snap.prediction);
}

/**
 * 끝난 경기 한 건의 기록 출처를 정한다. current는 현재 코드로 다시 계산한 예측(표시용 대체값).
 * 판정 순서: 검증된 스냅샷(사후 등록 아님) → 근거 없음 → (스냅샷이 있는데 검증 실패 또는 사후 등록) → 재구성.
 * 사후 등록 경기는 스냅샷이 있어도 채점하지 않는다(data.json 계약: predictedAfterKickoff면 채점 금지).
 */
export function classifyRecord(
  snap: PredictionSnapshot | null | undefined,
  kickoffAt: string | null | undefined,
  current: Pick<MatchPrediction, "basis">,
  predictedAfterKickoff: boolean,
): RecordProvenance {
  if (!predictedAfterKickoff && isVerifiedSnapshot(snap, kickoffAt)) return "verified";
  const shownBasis = snap ? snap.prediction.basis : current.basis;
  if (shownBasis === "none") return "no_prediction";
  if (snap || predictedAfterKickoff) return "unverified";
  return "reconstructed";
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

/**
 * 이 경기를 지금 스냅샷해도 되는가: 킥오프 시각이 유효하고 아직 지나지 않았으며(엄격히 now < kickoff),
 * 사후 등록이 아니어야 한다. 킥오프를 모르거나 못 읽으면 쓰지 않는다(킥오프 전임을 증명할 수 없다).
 */
export function shouldSnapshot(kickoffAt: string | null, predictedAfterKickoff: boolean, now: number): boolean {
  if (predictedAfterKickoff) return false;
  const k = parseSnapshotTimestamp(kickoffAt);
  if (k == null) return false;
  return Number.isFinite(now) && now < k;
}

/** 쓰기 판정 전체: 시각 조건(shouldSnapshot) + 근거 있는 정상 예측(isGroundedPrediction). */
export function isSnapshotWritable(
  input: { kickoffAt: string | null; predictedAfterKickoff: boolean; prediction: MatchPrediction },
  capturedAtMs: number,
): boolean {
  return shouldSnapshot(input.kickoffAt, input.predictedAfterKickoff, capturedAtMs) && isGroundedPrediction(input.prediction);
}

// 판단과 쓰기 사이에 킥오프가 지나거나 바뀌어도 늦은 값이 기록되지 않도록, 킥오프는 DB의 현재 값을
// 같은 문장 안에서 다시 읽어 비교한다. julianday가 못 읽는 킥오프는 NULL이 되어 비교가 거짓이라 쓰지 않는다.
// julianday('now')도 함께 확인한다 - 바인딩한 저장 시각보다 실제 쓰기가 늦어 킥오프를 넘긴 경우까지 막는다.
// 바인딩 순서: 저장할 10개 값, round_match_id, captured_at, captured_at.
export const SNAPSHOT_UPSERT_SQL = `INSERT OR REPLACE INTO prediction_snapshots
  (round_match_id, p_home, p_draw, p_away, pick, basis, confidence_gap, tier, n_bookmakers, captured_at)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  FROM round_matches rm
 WHERE rm.id = ?
   AND rm.kickoff_at IS NOT NULL
   AND julianday(rm.kickoff_at) IS NOT NULL
   AND julianday(?) IS NOT NULL
   AND julianday(?) < julianday(rm.kickoff_at)
   AND julianday('now') < julianday(rm.kickoff_at)`;

/**
 * 한 회차의 킥오프 전 경기 예측을 저장한다. 서버 기본 설정(리그별 가중치) 기준.
 * now는 하한일 뿐이다: 저장 시각은 예측 조립이 끝난 뒤의 실제 시각(둘 중 늦은 값)으로 다시 잡는다.
 * 반환값은 실제로 쓰인 행 수(SQL 가드에 걸린 행은 세지 않는다).
 */
export async function snapshotRound(env: Env, roundId: number, now?: number): Promise<number> {
  const preds = await buildRoundPredictions(env, roundId);
  // 조립(여러 D1 조회) 뒤의 실제 시각. 조립 중에 킥오프가 지난 경기는 여기서 걸러진다.
  const observedMs = Date.now();
  const capturedMs = Math.max(now ?? 0, observedMs);
  const at = new Date(capturedMs).toISOString();
  const writable = preds.filter((p) =>
    isSnapshotWritable(
      { kickoffAt: p.match.kickoff_at, predictedAfterKickoff: p.predictedAfterKickoff, prediction: p.prediction },
      capturedMs,
    ),
  );
  const stmts = writable.map((p) =>
    env.DB.prepare(SNAPSHOT_UPSERT_SQL).bind(
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
      p.match.id,
      at,
      at,
    ),
  );
  if (stmts.length === 0) return 0;
  const results = await env.DB.batch(stmts);
  // 별도 batch여야 새 계측 테이블 장애가 기존 실제 기록 저장을 롤백하지 않는다.
  // now 인자는 기존 스냅샷 의미를 유지하되, 이력 시각은 실제 관측 시각만 기록한다.
  try {
    await appendPredictionHistory(env, writable, new Date(observedMs).toISOString());
  } catch (error) {
    // 마이그레이션 누락도 포함해 운영 로그에 남긴다. 성공한 기존 저장의 반환값은 바꾸지 않는다.
    console.error("prediction_history append failed; existing snapshots preserved", { roundId, error });
  }
  return results.reduce((s, r) => s + (r?.meta?.changes ?? 0), 0);
}

/** 진행중 회차 전부. refreshHistory(3시간)에서 부른다. */
export async function snapshotUpcomingRounds(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id FROM rounds WHERE status = 'upcoming'").all<{ id: number }>();
  let n = 0;
  for (const r of results ?? []) n += await snapshotRound(env, r.id);
  return n;
}
