// 공개 적중 기록(/performance)용 집계.
//
// 왜 따로 만드는가: 공개 성적표는 "그때 실제로 공개했던 예측"으로만 매겨야 한다(AGENTS.md).
// /api/settlement는 스냅샷이 없던 시절 경기를 현재 코드로 다시 계산한 값으로 메우는데, 공개
// 페이지에서 그렇게 하면 모델을 바꿀 때마다 과거 성적이 소급해서 바뀐다. 그래서 여기서는
//   - prediction_snapshots(킥오프 전 보존본)만 쓰고, 예측을 절대 다시 계산하지 않는다.
//   - 조금이라도 의심스러운 행(시각 누락·파싱 실패·킥오프 이후 캡처·근거 없음·확률/픽 이상·
//     미정산·결과 불일치·중복 경기)은 세지 않고, 왜 뺐는지를 사유별로 그대로 드러낸다.
// 집계 함수(summarizePublicPerformance)는 순수 함수라 테스트로 고정하고, D1 조회
// (loadPublicPerformance)는 상한이 있는 쿼리 한 번만 한다.
import type { Env } from "../types";

/** 조회 상한. 워커 한 번 호출에서 D1이 읽는 행 수를 묶어 두기 위한 값이다(무제한 스캔 방지). */
export const PERFORMANCE_ROW_CEILING = 5000;
/** 화면에 그대로 보여줄 최근 경기 수. SSR 페이지 크기를 일정하게 유지하려고 자른다. */
export const RECENT_ROWS_LIMIT = 100;
/** 제외 사례 표본 수. 사유 개수는 전부 세되, 상세 목록은 페이지가 커지지 않게 자른다. */
export const EXCLUDED_SAMPLES_LIMIT = 100;
/** 확률 합 허용 오차. 저장 시 부동소수 반올림은 넘기되, 정규화 안 된 값은 걸러낸다. */
export const PROB_SUM_TOLERANCE = 1e-4;
/** 로그손실에서 log(0) 폭주를 막는 하한. 확률 0에 결과가 나오면 -ln(1e-15) ≈ 34.54로 센다. */
export const LOG_LOSS_EPSILON = 1e-15;
/** 픽이 최고 확률과 같은지 볼 때 허용하는 부동소수 오차(동률 픽 허용). */
const ARGMAX_TOLERANCE = 1e-9;

export type OutcomeCode = "H" | "D" | "A";
export type PickLabel = "홈승" | "무승부" | "원정승";
/** 집계에 들어갈 수 있는 근거. none(대칭 확률, 예측 아님)은 성적에 넣지 않는다. */
export type CountedBasis = "model" | "market" | "national";

const PICK_TO_CODE: Record<PickLabel, OutcomeCode> = { 홈승: "H", 무승부: "D", 원정승: "A" };
const COUNTED_BASES: readonly CountedBasis[] = ["model", "market", "national"];

/**
 * 단일 쿼리의 결과 행. 컬럼 이름은 migrations(0001 round_matches·rounds, 0005 round_results,
 * 0010 prediction_snapshots)의 실제 이름을 별칭 없이 따른다. 스냅샷·결과는 LEFT JOIN이라
 * 없으면 null이다(없는 것 자체가 제외 사유이므로 행을 버리지 않고 받아 온다).
 */
export interface PublicPerformanceDbRow {
  round_match_id: number;
  round_id: number;
  round_no: number | null;
  round_no_confirmed: number | null;
  seq: number;
  league: string;
  home_kr: string;
  away_kr: string;
  kickoff_at: string | null;
  // prediction_snapshots (LEFT JOIN)
  snapshot_round_match_id: number | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  pick: string | null;
  basis: string | null;
  confidence_gap: number | null;
  tier: string | null;
  n_bookmakers: number | null;
  captured_at: string | null;
  // round_results (LEFT JOIN)
  result_round_match_id: number | null;
  actual: string | null;
  hg: number | null;
  ag: number | null;
  settled_at: string | null;
}

/** 집계에 실제로 들어간 경기 한 건. */
export interface PerformanceRow {
  roundMatchId: number;
  roundId: number;
  roundNo: number | null;
  seq: number;
  league: string;
  home: string;
  away: string;
  /** 정규화한 UTC ISO(원문 표기와 무관하게 비교 가능하도록). */
  kickoffAt: string;
  capturedAt: string;
  basis: CountedBasis;
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: PickLabel;
  pickCode: OutcomeCode;
  /** 픽의 확률 = 세 확률 중 최고값(검증으로 보장). 구간표의 기준값이다. */
  pickProbability: number;
  tier: string | null;
  nBookmakers: number | null;
  actual: OutcomeCode;
  hg: number | null;
  ag: number | null;
  hit: boolean;
  /** 다항 Brier(세 결과 제곱오차 합, 0~2). */
  brier: number;
  /** 자연로그 손실(-ln p_actual, 하한 1e-15). */
  logLoss: number;
}

export type ExclusionReason =
  | "missing_kickoff"
  | "invalid_kickoff"
  | "not_started"
  | "missing_snapshot"
  | "invalid_captured_at"
  | "captured_at_or_after_kickoff"
  | "basis_none"
  | "invalid_basis"
  | "invalid_probabilities"
  | "invalid_pick"
  | "pick_not_argmax"
  | "unsettled"
  | "invalid_result"
  | "duplicate";

/** 판정 순서. 한 행은 처음 걸린 사유 하나로만 센다(사유별 합 = 제외 총수). */
export const EXCLUSION_REASONS: readonly ExclusionReason[] = [
  "missing_kickoff",
  "invalid_kickoff",
  "not_started",
  "missing_snapshot",
  "invalid_captured_at",
  "captured_at_or_after_kickoff",
  "basis_none",
  "invalid_basis",
  "invalid_probabilities",
  "invalid_pick",
  "pick_not_argmax",
  "unsettled",
  "invalid_result",
  "duplicate",
];

/** 화면용 사유 설명. 공개 페이지가 "왜 이 경기를 안 셌는지"를 그대로 보여주게 한다. */
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  missing_kickoff: "킥오프 시각이 없어 킥오프 전 예측인지 확인할 수 없음",
  invalid_kickoff: "킥오프 시각 형식이 잘못돼 확인할 수 없음",
  not_started: "아직 킥오프 전(집계 대상 아님)",
  missing_snapshot: "킥오프 전 예측 기록(스냅샷)이 없음 - 다시 계산해 채우지 않음",
  invalid_captured_at: "예측 기록 시각 형식이 잘못됨",
  captured_at_or_after_kickoff: "예측 기록 시각이 킥오프와 같거나 이후(사후 기록)",
  basis_none: "근거 없음(none) - 대칭 확률이라 예측이 아님",
  invalid_basis: "알 수 없는 예측 근거",
  invalid_probabilities: "확률 값이 비정상(유한하지 않음·범위 밖·합이 1이 아님)",
  invalid_pick: "픽 표기가 비정상",
  pick_not_argmax: "픽이 최고 확률 결과와 다름",
  unsettled: "결과 미확정",
  invalid_result: "결과 기록이 비정상(코드·점수 불일치, 정산 시각 이상)",
  duplicate: "다른 회차에 같은 경기가 있어 가장 최근 킥오프 전 예측 하나만 셈",
};

export interface MetricSummary {
  n: number;
  hits: number;
  /** n=0이면 null(0%로 보이면 오해를 부른다). */
  accuracy: number | null;
  /** 같은 경기들에서 "항상 홈승"을 골랐을 때의 적중. 모델이 의미 있는지 비교하는 기준선. */
  homeBaseline: { hits: number; accuracy: number | null };
  /** 평균 다항 Brier(0~2, 낮을수록 좋음). */
  brier: number | null;
  /** 평균 자연로그 손실(낮을수록 좋음, 균등확률 기준 ln3 ≈ 1.0986). */
  logLoss: number | null;
}

export interface GroupMetric extends MetricSummary {
  key: string;
}

export interface CalibrationBin {
  label: string;
  /** 최고 확률 구간 [lower, upper). 마지막 구간만 upper(1.0)를 포함한다. */
  lower: number;
  upper: number;
  n: number;
  /** 구간 안 경기들의 최고 확률 평균. */
  meanPredicted: number | null;
  /** 구간 안 경기들에서 그 최고 확률 결과(=픽)가 실제로 나온 비율. */
  observed: number | null;
}

export interface ExcludedSample {
  roundMatchId: number;
  roundNo: number | null;
  seq: number;
  league: string;
  home: string;
  away: string;
  kickoffAt: string | null;
  reason: ExclusionReason;
  detail: string;
}

export interface DuplicateExclusion {
  roundMatchId: number;
  roundNo: number | null;
  keptRoundMatchId: number;
  keptRoundNo: number | null;
  identity: string;
  /** 같은 경기인데 결과 기록이 서로 다르면 true. 데이터 점검이 필요하다는 신호다. */
  conflictingResult: boolean;
}

export interface PublicPerformanceSummary {
  generatedAt: string;
  /** 쿼리로 받아 검사한 경기 행 수. considered = overall.n + excluded.total 이 항상 성립한다. */
  considered: number;
  overall: MetricSummary;
  byBasis: GroupMetric[];
  byLeague: GroupMetric[];
  calibrationBins: CalibrationBin[];
  excluded: {
    total: number;
    byReason: Record<ExclusionReason, number>;
    /** not_started(아직 안 한 경기)는 오류가 아니라서 표본에서 뺀다. 개수는 byReason에 있다. */
    samples: ExcludedSample[];
    duplicates: DuplicateExclusion[];
  };
  /** 집계에 들어간 경기 기준 기간. 집계 경기가 없으면 null. */
  range: {
    earliestKickoffAt: string | null;
    latestKickoffAt: string | null;
    earliestCapturedAt: string | null;
    latestCapturedAt: string | null;
  };
  /** 킥오프 최신순 최대 RECENT_ROWS_LIMIT건. */
  recentRows: PerformanceRow[];
  recentRowsLimit: number;
}

export interface PublicPerformanceReport extends PublicPerformanceSummary {
  source: {
    rowCeiling: number;
    rowsFetched: number;
    isTruncated: boolean;
    /** 잘렸을 때 어떤 범위만 셌는지 사람이 읽을 설명. 안 잘렸으면 null. */
    truncation: string | null;
  };
}

// ───────────────────────── 시각 파싱 ─────────────────────────

// ISO(2026-09-27T10:00:00.000Z, +09:00 오프셋)와 SQLite(2026-09-27 10:00:00) 표기를 모두 받는다.
// Date.parse는 엔진마다 관대해서 2월 30일 같은 값을 다음 달로 넘기거나 공백 표기를 로컬시각으로
// 읽는다. 성적의 핵심 판정(캡처 < 킥오프)이 여기에 달려 있으므로 직접 검증한다.
const TS_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * 타임스탬프 → epoch ms. 형식·달력이 잘못됐으면 null.
 * 시간대 표기가 없으면 UTC로 본다: 이 저장소는 toISOString()(UTC)으로 쓰고, SQLite의
 * datetime('now')·CURRENT_TIMESTAMP도 UTC다. 날짜만 있는 값은 시각을 몰라 킥오프 전후를
 * 판단할 수 없으므로 거부한다.
 */
export function parseTimestamp(value: unknown): number | null {
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

// ───────────────────────── 행 검증 ─────────────────────────

type Verdict =
  | { ok: true; row: PerformanceRow; kickoffMs: number; capturedMs: number }
  | { ok: false; reason: ExclusionReason; detail: string };

function isProb(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

function isScore(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

function outcomeOfScore(hg: number, ag: number): OutcomeCode {
  return hg > ag ? "H" : hg === ag ? "D" : "A";
}

function evaluate(r: PublicPerformanceDbRow, now: number): Verdict {
  const fail = (reason: ExclusionReason, detail: string): Verdict => ({ ok: false, reason, detail });

  // 1) 킥오프: 없거나 못 읽으면 "킥오프 전 예측"임을 증명할 수 없으니 센다는 선택지가 없다.
  if (r.kickoff_at == null || String(r.kickoff_at).trim() === "") return fail("missing_kickoff", "kickoff_at 없음");
  const kickoffMs = parseTimestamp(r.kickoff_at);
  if (kickoffMs == null) return fail("invalid_kickoff", `kickoff_at=${String(r.kickoff_at)}`);
  // 엄격히 kickoff < now. 같은 순간이면 아직 결과가 있을 수 없다.
  if (!(kickoffMs < now)) return fail("not_started", "킥오프 전");

  // 2) 스냅샷: 없으면 빈칸으로 둔다. 현재 코드로 다시 계산해 채우면 소급 성적이 된다.
  if (r.snapshot_round_match_id == null) return fail("missing_snapshot", "prediction_snapshots 행 없음");
  const capturedMs = parseTimestamp(r.captured_at);
  if (capturedMs == null) return fail("invalid_captured_at", `captured_at=${String(r.captured_at)}`);
  // 엄격히 captured < kickoff. 킥오프 시각에 찍힌 값도 경기 정보가 섞였을 수 있어 뺀다.
  if (!(capturedMs < kickoffMs)) {
    return fail("captured_at_or_after_kickoff", `captured_at=${String(r.captured_at)} ≥ kickoff_at=${String(r.kickoff_at)}`);
  }

  // 3) 근거: none은 대칭 확률(예측 아님)이라 성적에 넣으면 모델을 과소·과대평가한다.
  if (r.basis === "none") return fail("basis_none", "basis=none");
  if (r.basis == null || !(COUNTED_BASES as readonly string[]).includes(r.basis)) {
    return fail("invalid_basis", `basis=${String(r.basis)}`);
  }
  const basis = r.basis as CountedBasis;

  // 4) 확률: 셋 다 [0,1]의 유한수이고 합이 1(±1e-4). 문자열·null도 거부한다(암묵 변환 금지).
  const { p_home: pH, p_draw: pD, p_away: pA } = r;
  if (!isProb(pH) || !isProb(pD) || !isProb(pA)) {
    return fail("invalid_probabilities", `p=(${String(pH)}, ${String(pD)}, ${String(pA)})`);
  }
  const sum = pH + pD + pA;
  if (Math.abs(sum - 1) > PROB_SUM_TOLERANCE) return fail("invalid_probabilities", `확률 합=${sum}`);

  // 5) 픽: 저장 표기(rankedPicks[0], 한글 라벨)만 인정하고, 최고 확률 결과여야 한다(동률 허용).
  //    픽과 확률이 어긋나면 어느 쪽이 공개값이었는지 알 수 없어 적중·Brier 모두 믿을 수 없다.
  if (r.pick == null || !Object.prototype.hasOwnProperty.call(PICK_TO_CODE, r.pick)) {
    return fail("invalid_pick", `pick=${String(r.pick)}`);
  }
  const pick = r.pick as PickLabel;
  const pickCode = PICK_TO_CODE[pick];
  const probOf = (c: OutcomeCode) => (c === "H" ? pH : c === "D" ? pD : pA);
  const pMax = Math.max(pH, pD, pA);
  const pickProbability = probOf(pickCode);
  if (pickProbability < pMax - ARGMAX_TOLERANCE) {
    return fail("pick_not_argmax", `pick=${pick}(${pickProbability}) < 최고 ${pMax}`);
  }

  // 6) 결과: 정산 행이 있어야 하고 코드·점수·정산 시각이 서로 맞아야 한다.
  if (r.result_round_match_id == null) return fail("unsettled", "round_results 행 없음");
  if (r.actual !== "H" && r.actual !== "D" && r.actual !== "A") {
    return fail("invalid_result", `actual=${String(r.actual)}`);
  }
  const actual = r.actual;
  const hasH = r.hg != null;
  const hasA = r.ag != null;
  // 점수는 둘 다 없거나(결과 코드만 받은 경우) 둘 다 있어야 한다. 한쪽만 있으면 기록이 깨진 것이다.
  if (hasH !== hasA) return fail("invalid_result", `점수 한쪽만 있음 hg=${String(r.hg)} ag=${String(r.ag)}`);
  if (hasH && hasA) {
    if (!isScore(r.hg) || !isScore(r.ag)) return fail("invalid_result", `점수 비정상 hg=${String(r.hg)} ag=${String(r.ag)}`);
    if (outcomeOfScore(r.hg, r.ag) !== actual) {
      return fail("invalid_result", `점수 ${r.hg}:${r.ag}와 결과 ${actual} 불일치`);
    }
  }
  const settledMs = parseTimestamp(r.settled_at);
  if (settledMs == null) return fail("invalid_result", `settled_at=${String(r.settled_at)}`);
  // 킥오프 전에 정산됐다는 기록은 다른 경기 결과가 붙었거나 킥오프가 바뀐 것이다.
  if (settledMs < kickoffMs) return fail("invalid_result", `settled_at=${String(r.settled_at)} < kickoff`);

  // 지표 계산: 저장된 확률을 그대로 쓴다(재정규화하면 공개값이 아닌 숫자가 된다).
  const o = { H: actual === "H" ? 1 : 0, D: actual === "D" ? 1 : 0, A: actual === "A" ? 1 : 0 };
  const brier = (pH - o.H) ** 2 + (pD - o.D) ** 2 + (pA - o.A) ** 2;
  const logLoss = -Math.log(Math.max(probOf(actual), LOG_LOSS_EPSILON));

  return {
    ok: true,
    kickoffMs,
    capturedMs,
    row: {
      roundMatchId: r.round_match_id,
      roundId: r.round_id,
      roundNo: r.round_no,
      seq: r.seq,
      league: r.league,
      home: r.home_kr,
      away: r.away_kr,
      kickoffAt: new Date(kickoffMs).toISOString(),
      capturedAt: new Date(capturedMs).toISOString(),
      basis,
      pHome: pH,
      pDraw: pD,
      pAway: pA,
      pick,
      pickCode,
      pickProbability,
      tier: r.tier ?? null,
      nBookmakers: r.n_bookmakers ?? null,
      actual,
      hg: hasH ? (r.hg as number) : null,
      ag: hasA ? (r.ag as number) : null,
      hit: pickCode === actual,
      brier,
      logLoss,
    },
  };
}

/**
 * 같은 실제 경기를 가리키는 키. 회차가 다시 등록되거나 회차 간에 경기가 겹치면 같은 경기가
 * 두 번 세어져 표본이 부풀려진다. 리그·홈·원정(원문 표기 trim)과 정규화한 킥오프 시각으로 묶는다.
 */
export function gameIdentity(league: string, home: string, away: string, kickoffMs: number): string {
  return `${league.trim()}|${home.trim()}|${away.trim()}|${new Date(kickoffMs).toISOString()}`;
}

// ───────────────────────── 집계 ─────────────────────────

function metrics(rows: PerformanceRow[]): MetricSummary {
  const n = rows.length;
  let hits = 0;
  let homeHits = 0;
  let brier = 0;
  let logLoss = 0;
  for (const r of rows) {
    if (r.hit) hits++;
    if (r.actual === "H") homeHits++;
    brier += r.brier;
    logLoss += r.logLoss;
  }
  return {
    n,
    hits,
    accuracy: n > 0 ? hits / n : null,
    homeBaseline: { hits: homeHits, accuracy: n > 0 ? homeHits / n : null },
    brier: n > 0 ? brier / n : null,
    logLoss: n > 0 ? logLoss / n : null,
  };
}

function groupBy(rows: PerformanceRow[], keyOf: (r: PerformanceRow) => string): GroupMetric[] {
  const m = new Map<string, PerformanceRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  // 표본이 큰 묶음부터, 같으면 이름순 - 실행마다 순서가 흔들리지 않게 한다.
  return [...m.entries()]
    .map(([key, list]) => ({ key, ...metrics(list) }))
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// 확신도 차이(1위-2위)가 아니라 "최고 확률" 자체로 나눈다. 그래야 "60% 라고 한 경기가 실제로
// 60% 맞았나"를 바로 읽을 수 있다. 세 결과 확률의 최고값은 1/3 이상이라 첫 구간은 33~40%다.
const BIN_EDGES = [0, 0.4, 0.5, 0.6, 0.7, 1];
const BIN_LABELS = ["40% 미만", "40~50%", "50~60%", "60~70%", "70% 이상"];

function calibrationBins(rows: PerformanceRow[]): CalibrationBin[] {
  const acc = BIN_LABELS.map(() => ({ n: 0, sumP: 0, hits: 0 }));
  for (const r of rows) {
    let i = BIN_EDGES.length - 2;
    for (let b = 0; b < BIN_EDGES.length - 1; b++) {
      if (r.pickProbability < BIN_EDGES[b + 1]) {
        i = b;
        break;
      }
    }
    acc[i].n++;
    acc[i].sumP += r.pickProbability;
    if (r.hit) acc[i].hits++;
  }
  return acc.map((a, i) => ({
    label: BIN_LABELS[i],
    lower: BIN_EDGES[i],
    upper: BIN_EDGES[i + 1],
    n: a.n,
    meanPredicted: a.n > 0 ? a.sumP / a.n : null,
    observed: a.n > 0 ? a.hits / a.n : null,
  }));
}

function emptyReasonCounts(): Record<ExclusionReason, number> {
  const out = {} as Record<ExclusionReason, number>;
  for (const r of EXCLUSION_REASONS) out[r] = 0;
  return out;
}

function toNow(now: number | Date): number {
  const ms = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(ms)) throw new Error("publicPerformance: now가 유효한 시각이 아닙니다");
  return ms;
}

/**
 * 순수 집계. 같은 입력·같은 now면 항상 같은 결과다(정렬 기준을 모두 고정).
 * rows는 loadPublicPerformance의 쿼리 결과 모양 그대로 받는다.
 */
export function summarizePublicPerformance(
  rows: readonly PublicPerformanceDbRow[],
  now: number | Date,
): PublicPerformanceSummary {
  const nowMs = toNow(now);
  const byReason = emptyReasonCounts();
  const excludedList: ExcludedSample[] = [];
  const duplicates: DuplicateExclusion[] = [];

  const exclude = (r: PublicPerformanceDbRow, reason: ExclusionReason, detail: string) => {
    byReason[reason]++;
    excludedList.push({
      roundMatchId: r.round_match_id,
      roundNo: r.round_no,
      seq: r.seq,
      league: r.league,
      home: r.home_kr,
      away: r.away_kr,
      kickoffAt: r.kickoff_at,
      reason,
      detail,
    });
  };

  // 1단계: 행 단위 검증.
  const valid: { src: PublicPerformanceDbRow; row: PerformanceRow; kickoffMs: number; capturedMs: number }[] = [];
  for (const r of rows) {
    const v = evaluate(r, nowMs);
    if (v.ok) valid.push({ src: r, row: v.row, kickoffMs: v.kickoffMs, capturedMs: v.capturedMs });
    else exclude(r, v.reason, v.detail);
  }

  // 2단계: 같은 경기 중복 제거. 유효한 행끼리만 비교한다 - 무효 행 때문에 유효한 기록이
  // 밀려나면 안 되기 때문이다. 남기는 것은 킥오프 직전에 가장 가까운(가장 늦은) 캡처, 즉 실제로
  // 마지막에 공개했던 예측이다. 캡처 시각까지 같으면 나중에 등록된 행(id 큰 쪽)을 남겨 결정적으로 고른다.
  const groups = new Map<string, typeof valid>();
  for (const v of valid) {
    const key = gameIdentity(v.row.league, v.row.home, v.row.away, v.kickoffMs);
    const g = groups.get(key);
    if (g) g.push(v);
    else groups.set(key, [v]);
  }
  const counted: PerformanceRow[] = [];
  for (const [identity, g] of groups) {
    g.sort((a, b) => b.capturedMs - a.capturedMs || b.row.roundMatchId - a.row.roundMatchId);
    const kept = g[0];
    counted.push(kept.row);
    for (let i = 1; i < g.length; i++) {
      const d = g[i];
      const conflictingResult = d.row.actual !== kept.row.actual || d.row.hg !== kept.row.hg || d.row.ag !== kept.row.ag;
      duplicates.push({
        roundMatchId: d.row.roundMatchId,
        roundNo: d.row.roundNo,
        keptRoundMatchId: kept.row.roundMatchId,
        keptRoundNo: kept.row.roundNo,
        identity,
        conflictingResult,
      });
      exclude(
        d.src,
        "duplicate",
        `같은 경기(${identity})의 더 최근 킥오프 전 예측 #${kept.row.roundMatchId}을 셈${conflictingResult ? " · 결과 기록 불일치" : ""}`,
      );
    }
  }

  // 화면용 정렬: 킥오프 최신순, 같으면 id 큰 순.
  counted.sort((a, b) => (a.kickoffAt < b.kickoffAt ? 1 : a.kickoffAt > b.kickoffAt ? -1 : b.roundMatchId - a.roundMatchId));

  let earliestK: string | null = null;
  let latestK: string | null = null;
  let earliestC: string | null = null;
  let latestC: string | null = null;
  for (const r of counted) {
    // 정규화된 UTC ISO라 문자열 비교가 곧 시각 비교다.
    if (earliestK == null || r.kickoffAt < earliestK) earliestK = r.kickoffAt;
    if (latestK == null || r.kickoffAt > latestK) latestK = r.kickoffAt;
    if (earliestC == null || r.capturedAt < earliestC) earliestC = r.capturedAt;
    if (latestC == null || r.capturedAt > latestC) latestC = r.capturedAt;
  }

  const samples = excludedList
    .filter((e) => e.reason !== "not_started")
    .sort((a, b) => b.roundMatchId - a.roundMatchId)
    .slice(0, EXCLUDED_SAMPLES_LIMIT);
  duplicates.sort((a, b) => b.roundMatchId - a.roundMatchId);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    considered: rows.length,
    overall: metrics(counted),
    byBasis: groupBy(counted, (r) => r.basis),
    byLeague: groupBy(counted, (r) => r.league),
    calibrationBins: calibrationBins(counted),
    excluded: {
      total: excludedList.length,
      byReason,
      samples,
      duplicates: duplicates.slice(0, EXCLUDED_SAMPLES_LIMIT),
    },
    range: {
      earliestKickoffAt: earliestK,
      latestKickoffAt: latestK,
      earliestCapturedAt: earliestC,
      latestCapturedAt: latestC,
    },
    recentRows: counted.slice(0, RECENT_ROWS_LIMIT),
    recentRowsLimit: RECENT_ROWS_LIMIT,
  };
}

// ───────────────────────── D1 조회 ─────────────────────────

/**
 * 단일 쿼리. round_matches를 기준으로 스냅샷·결과를 LEFT JOIN해서 "스냅샷이 없는 경기",
 * "결과가 없는 경기"도 행으로 받아 제외 사유로 드러낸다(INNER JOIN이면 조용히 사라진다).
 * prediction_snapshots·round_results 모두 round_match_id가 PK라 JOIN으로 행이 불어나지 않는다.
 *
 * 왜 시각 조건(kickoff_at < now)을 SQL에 두지 않는가: kickoff_at은 TEXT라 ISO('T')와 SQLite
 * 공백 표기가 섞이면 문자열 비교가 틀리고, NULL 행은 아예 빠진다. 시각 판정은 JS에서 엄격히 한다.
 *
 * 왜 rm.id DESC인가: PK 순서라 정렬 비용 없이 상한을 걸 수 있고, kickoff_at이 NULL·이상한
 * 행도 순서에서 밀려나지 않는다. 상한에 걸리면 "가장 오래 전에 등록된 경기"부터 빠진다.
 *
 * 상한(PERFORMANCE_ROW_CEILING + 1행): 공개 페이지는 누구나 부를 수 있으므로 한 번 호출이 읽는
 * 행 수를 고정해 D1 사용량이 데이터 증가에 따라 무한정 늘지 않게 한다. 1행을 더 읽는 것은
 * 잘렸는지를 별도 COUNT 쿼리 없이 알기 위해서다.
 */
export const PUBLIC_PERFORMANCE_SQL = `SELECT
    rm.id AS round_match_id,
    rm.round_id AS round_id,
    r.round_no AS round_no,
    r.round_no_confirmed AS round_no_confirmed,
    rm.seq AS seq,
    rm.league AS league,
    rm.home_kr AS home_kr,
    rm.away_kr AS away_kr,
    rm.kickoff_at AS kickoff_at,
    ps.round_match_id AS snapshot_round_match_id,
    ps.p_home AS p_home,
    ps.p_draw AS p_draw,
    ps.p_away AS p_away,
    ps.pick AS pick,
    ps.basis AS basis,
    ps.confidence_gap AS confidence_gap,
    ps.tier AS tier,
    ps.n_bookmakers AS n_bookmakers,
    ps.captured_at AS captured_at,
    rr.round_match_id AS result_round_match_id,
    rr.actual AS actual,
    rr.hg AS hg,
    rr.ag AS ag,
    rr.settled_at AS settled_at
  FROM round_matches rm
  LEFT JOIN rounds r ON r.id = rm.round_id
  LEFT JOIN prediction_snapshots ps ON ps.round_match_id = rm.id
  LEFT JOIN round_results rr ON rr.round_match_id = rm.id
  ORDER BY rm.id DESC
  LIMIT ?`;

/** 읽기 전용. 쓰기·마이그레이션·예측 재계산을 하지 않는다. */
export async function loadPublicPerformance(env: Pick<Env, "DB">, now: number | Date = Date.now()): Promise<PublicPerformanceReport> {
  const nowMs = toNow(now);
  const { results } = await env.DB.prepare(PUBLIC_PERFORMANCE_SQL)
    .bind(PERFORMANCE_ROW_CEILING + 1)
    .all<PublicPerformanceDbRow>();
  const fetched = results ?? [];
  const isTruncated = fetched.length > PERFORMANCE_ROW_CEILING;
  const rows = isTruncated ? fetched.slice(0, PERFORMANCE_ROW_CEILING) : fetched;
  const summary = summarizePublicPerformance(rows, nowMs);
  return {
    ...summary,
    source: {
      rowCeiling: PERFORMANCE_ROW_CEILING,
      rowsFetched: rows.length,
      isTruncated,
      truncation: isTruncated
        ? `조회 상한 ${PERFORMANCE_ROW_CEILING.toLocaleString("en-US")}경기에 걸려, 가장 최근에 등록된 ${PERFORMANCE_ROW_CEILING.toLocaleString("en-US")}경기(round_matches.id 내림차순)만 검사했습니다. 그보다 먼저 등록된 경기는 이 집계에 없습니다.`
        : null,
    },
  };
}
