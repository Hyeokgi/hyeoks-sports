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
  //
  // [2026-08-31 갱신] 유럽 4대리그는 marketWeight를 0.4 -> 0.8로 올리면서 재산출했다
  // (prediction.ts EUROPEAN_MARKET_WEIGHT). 확률 출처가 달라지면 "이 확신도면 과거에
  // 몇 % 맞았나"도 달라지므로 가중치만 바꾸고 이 표를 두면 화면이 검증되지 않은 등급을
  // 표시하게 된다. 프로토콜·구간 경계는 종전과 동일하게 유지했다(scripts/calibrate_market_blend.ts).
  //
  // 갱신 전후로 두 가지가 달라졌다.
  //   1) 등급이 실제로 순서대로 작동하게 됐다. 종전에는 라리가/분데스리가에서 5~15%p 구간이
  //      0~5%p 구간보다 적중률이 낮아 라벨이 뒤집혀 있었는데(아래 옛 주석 참고), 이제
  //      네 리그 모두 구간이 올라갈수록 적중률이 단조 증가한다.
  //   2) 최상위 구간이 훨씬 뾰족해졌다(EPL 0.581 -> 0.654, 라리가 0.657 -> 0.730).
  //      배당이 강하게 한쪽을 가리키는 경기가 그 구간에 더 많이 들어오기 때문이다.
  //   반대로 최하위 구간은 대체로 낮아졌다(EPL 0.458 -> 0.436). 확률이 뾰족해지면서
  //   "정말 팽팽한 경기"만 그 구간에 남은 결과다.
  "EPL": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.436, n: 94 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.461, n: 178 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.476, n: 267 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.654, n: 387 },
  ],
  "세리에A": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.370, n: 81 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.430, n: 244 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.540, n: 287 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.688, n: 317 },
  ],
  // 라리가/분데스리가 (2026-08-22 선제 편입, 2026-08-31 marketWeight 0.8 기준 재산출).
  // 종전 값에는 "두 리그 모두 5~15%p 구간이 0~5%p 구간보다 적중률이 낮아 라벨이 순서대로
  // 작동하지 않는다"는 주의가 붙어 있었다(라리가 40.6% vs 48.3%, 분데스 35.8% vs 46.4%).
  // 재산출 후에는 두 리그 모두 단조 증가로 정상화됐다.
  "라리가": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.347, n: 101 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.476, n: 231 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.483, n: 294 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.730, n: 293 },
  ],
  "분데스리가": [
    { minGap: 0, maxGap: 0.05, accuracy: 0.348, n: 92 },
    { minGap: 0.05, maxGap: 0.15, accuracy: 0.471, n: 136 },
    { minGap: 0.15, maxGap: 0.3, accuracy: 0.498, n: 225 },
    { minGap: 0.3, maxGap: 1.01, accuracy: 0.670, n: 285 },
  ],
};

export const CALIBRATION_OVERALL: Record<string, { accuracy: number; homeBaseline: number; n: number }> = {
  "K리그1": { accuracy: 0.428, homeBaseline: 0.389, n: 1814 },
  "K리그2": { accuracy: 0.428, homeBaseline: 0.389, n: 1814 },
  "J1리그": { accuracy: 0.434, homeBaseline: 0.402, n: 723 },
  "MLS": { accuracy: 0.475, homeBaseline: 0.456, n: 1102 },
  // 유럽 4대리그는 marketWeight 0.8 기준(2026-08-31). homeBaseline은 대진 자체의 성질이라
  // 가중치와 무관해 그대로 둔다.
  "EPL": { accuracy: 0.543, homeBaseline: 0.422, n: 926 },
  "세리에A": { accuracy: 0.547, homeBaseline: 0.398, n: 929 },
  "라리가": { accuracy: 0.545, homeBaseline: 0.460, n: 919 },
  "분데스리가": { accuracy: 0.541, homeBaseline: 0.407, n: 738 },
};

// 백테스트한 적 없는 대회(UCL/UEL 등)는 반드시 null을 돌려준다. 예전엔 모르는 리그를
// K리그1 버킷으로 대체했는데, 그러면 UCL 경기에 K리그 실측 적중률이 붙어 근거가 있는 것처럼
// 보인다 - 근거 없음은 없다고 말해야 한다.
export function findCalibrationBucket(league: string, confidenceGap: number): CalibrationBucket | null {
  const buckets = CALIBRATION[league];
  if (!buckets) return null;
  return buckets.find((b) => confidenceGap >= b.minGap && confidenceGap < b.maxGap) ?? null;
}

// 확신도 3단계 라벨 - 경계값은 CALIBRATION 버킷 정의를 그대로 재사용한다(하드코딩 금지).
// 🟢 확신픽(마지막 버킷, 실측 우위 뚜렷) / 🟡 보통(중간 버킷들) / 🔴 불확실(첫 버킷, 거의 랜덤)
// ⚪ 근거없음: 그 대회의 백테스트 자체가 없는 경우(확신도 수치는 배당에서 나왔을 뿐,
// "이 확신도면 과거에 몇 % 맞았다"를 말할 근거가 없다).
export type ConfidenceTier = "확신픽" | "보통" | "불확실" | "근거없음";
export const TIER_EMOJI: Record<ConfidenceTier, string> = {
  "확신픽": "🟢",
  "보통": "🟡",
  "불확실": "🔴",
  "근거없음": "⚪",
};

export function confidenceTier(league: string, confidenceGap: number): ConfidenceTier {
  const buckets = CALIBRATION[league];
  if (!buckets) return "근거없음";
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
