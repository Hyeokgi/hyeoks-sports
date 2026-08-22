// 확신도(1위-2위 확률차) 구간별 실측 적중률 - 워크포워드 백테스트로 산출한 상수(2026-08-03 기준).
// K리그: 2021~2026 1,814경기(팀당 30경기+ 워밍업 후). J1리그: 2024~2026 723경기(팀당 15경기+).
// 하드코딩이지만 값 자체가 "이 모델이 실제로 얼마나 맞았는가"라는 사후 검증 결과이므로,
// prediction.ts처럼 매 요청마다 재계산할 대상이 아니라 재백테스트 시에만 갱신하면 되는 스냅샷이다.
export interface CalibrationBucket {
  minGap: number;
  maxGap: number;
  accuracy: number;
  n: number;
}

export const CALIBRATION: Record<string, CalibrationBucket[]> = {
  "K리그1": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.378, n: 222 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.404, n: 513 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.425, n: 831 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.536, n: 248 },
  ],
  "K리그2": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.378, n: 222 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.404, n: 513 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.425, n: 831 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.536, n: 248 },
  ],
  "J1리그": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.361, n: 83 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.379, n: 174 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.449, n: 356 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.527, n: 110 },
  ],
  // MLS (2026-08-17, 2024~2026시즌 1,342경기, 팀당 15경기+ 워밍업 후 1,102경기 백테스트).
  // 추가 피처 없이 K리그/J1과 동일한 Elo+최근폼+H2H 기본모델 - train/test 4분할 44.8~47.6%로
  // 안정적이라 별도 피처 탐색 없이 기본모델 그대로 채택.
  "MLS": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.366, n: 134 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.441, n: 261 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.500, n: 394 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.521, n: 313 },
  ],
  // EPL/세리에A (2026-08-22, 46회차 편입 시 백필 2023-24~2026-27 시즌, 팀당 15경기+ 워밍업 후
  // 워크포워드 - scripts/backtest_league.ts, 데이터 seed/backfill_leagues.json).
  // 기본모델(Elo+최근폼+H2H) 그대로: HOME_ADV 그리드서치(30~105)에서 EPL 90이 60 대비
  // +0.4%p(4경기 수준, 노이즈 범위)라 MLS 때 같은 뚜렷한 근거가 없어 기본값 60 유지,
  // 세리에A는 60이 최적. 두 리그 모두 K리그보다 상위권 전력차가 커서 전체 적중률이 더 높다.
  "EPL": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.458, n: 83 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.423, n: 156 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.506, n: 237 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.581, n: 442 },
  ],
  "세리에A": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.442, n: 77 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.430, n: 223 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.510, n: 343 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.638, n: 276 },
  ],
  // 라리가/분데스리가 (2026-08-22 선제 편입, 같은 백필·같은 워크포워드 프로토콜).
  // 주의: 두 리그 모두 5~15%p 구간이 0~5%p 구간보다 실측 적중률이 낮다(라리가 40.6% vs 48.3%,
  // 분데스리가 35.8% vs 46.4%). 즉 확신도 라벨이 이 두 구간에서는 순서대로 작동하지 않는다 -
  // 표본이 작아서(69~180) 생긴 노이즈일 수 있으나 값을 매끄럽게 손보지 않고 실측 그대로 둔다.
  // 30%p+ 구간의 뚜렷한 우위(65.7%/60.2%)는 다른 리그와 동일하게 재현된다.
  "라리가": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.483, n: 89 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.406, n: 180 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.476, n: 351 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.657, n: 289 },
  ],
  "분데스리가": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.464, n: 69 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.358, n: 137 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.506, n: 233 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.602, n: 299 },
  ],
};

export const CALIBRATION_OVERALL: Record<string, { accuracy: number; homeBaseline: number; n: number }> = {
  "K리그1": { accuracy: 0.428, homeBaseline: 0.389, n: 1814 },
  "K리그2": { accuracy: 0.428, homeBaseline: 0.389, n: 1814 },
  "J1리그": { accuracy: 0.434, homeBaseline: 0.402, n: 723 },
  "MLS": { accuracy: 0.475, homeBaseline: 0.456, n: 1102 },
  "EPL": { accuracy: 0.524, homeBaseline: 0.422, n: 918 },
  "세리에A": { accuracy: 0.523, homeBaseline: 0.398, n: 919 },
  "라리가": { accuracy: 0.520, homeBaseline: 0.460, n: 909 },
  "분데스리가": { accuracy: 0.514, homeBaseline: 0.407, n: 738 },
};

export function findCalibrationBucket(league: string, confidenceGap: number): CalibrationBucket | null {
  const buckets = CALIBRATION[league] ?? CALIBRATION["K리그1"];
  return buckets.find((b) => confidenceGap >= b.minGap && confidenceGap < b.maxGap) ?? null;
}

// 확신도 3단계 라벨 - 경계값은 CALIBRATION 버킷 정의를 그대로 재사용한다(하드코딩 금지).
// 🟢 확신픽(마지막 버킷, 실측 우위 뚜렷) / 🟡 보통(중간 버킷들) / 🔴 불확실(첫 버킷, 거의 랜덤)
export type ConfidenceTier = "확신픽" | "보통" | "불확실";
export const TIER_EMOJI: Record<ConfidenceTier, string> = { "확신픽": "🟢", "보통": "🟡", "불확실": "🔴" };

export function confidenceTier(league: string, confidenceGap: number): ConfidenceTier {
  const buckets = CALIBRATION[league] ?? CALIBRATION["K리그1"];
  const idx = buckets.findIndex((b) => confidenceGap >= b.minGap && confidenceGap < b.maxGap);
  if (idx === buckets.length - 1) return "확신픽"; // 마지막 버킷(30%p+)
  if (idx <= 0) return "불확실"; // 첫 버킷(0~5%p) 또는 범위 밖(그 이하)
  return "보통";
}

// "모델 확률 82% (참고: 이 확신도 구간 실측 적중률 53.6%, n=248)" 형태의 공통 문구.
// 원본 확률을 덮어쓰지 않고 병기하기 위한 헬퍼 - 리포트/시트/텔레그램/UI에서 공용으로 쓴다.
export function calibrationNote(league: string, confidenceGap: number): string | null {
  const bucket = findCalibrationBucket(league, confidenceGap);
  if (!bucket) return null;
  return `이 확신도 구간(${(bucket.minGap * 100).toFixed(0)}~${(bucket.maxGap * 100).toFixed(0)}%p) 실측 적중률 ${(bucket.accuracy * 100).toFixed(1)}%(n=${bucket.n})`;
}
