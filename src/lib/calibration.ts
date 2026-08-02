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
};

export const CALIBRATION_OVERALL: Record<string, { accuracy: number; homeBaseline: number; n: number }> = {
  "K리그1": { accuracy: 0.428, homeBaseline: 0.389, n: 1814 },
  "K리그2": { accuracy: 0.428, homeBaseline: 0.389, n: 1814 },
  "J1리그": { accuracy: 0.434, homeBaseline: 0.402, n: 723 },
};

export function findCalibrationBucket(league: string, confidenceGap: number): CalibrationBucket | null {
  const buckets = CALIBRATION[league] ?? CALIBRATION["K리그1"];
  return buckets.find((b) => confidenceGap >= b.minGap && confidenceGap < b.maxGap) ?? null;
}
