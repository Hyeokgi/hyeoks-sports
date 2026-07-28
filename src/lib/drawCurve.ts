// Elo 격차(팽팽함)에 따라 달라지는 무승부 확률 — K리그 2,563경기 실측 분석 결과를 반영
// (0~50: 29.5%, 50~100: 29.5%, 100~150: 27.9%, 150~200: 24.9%, 200~300: 21.5%, 전체평균 28.72%).
// 리그별 실측 무승부율(K1 28.49%, K2 28.93%)을 그대로 평균 수준으로 유지하면서, 격차가 클수록
// 무승부 확률이 낮아지는 실측 경향만 곡선 모양으로 반영한다(형태는 데이터, 수준은 리그값에 앵커링).
const POOLED_AVG_DRAW_RATE = 0.2872;

const DRAW_CURVE: [absDiff: number, rate: number][] = [
  [24.45, 0.2947],
  [73.01, 0.2951],
  [121.92, 0.2792],
  [170.19, 0.2486],
  [228.52, 0.2154],
];

const MIN_DRAW_RATE = 0.12;
const MAX_DRAW_RATE = 0.4;

function interpolateCurve(absDiff: number): number {
  if (absDiff <= DRAW_CURVE[0][0]) return DRAW_CURVE[0][1];

  for (let i = 0; i < DRAW_CURVE.length - 1; i++) {
    const [x0, y0] = DRAW_CURVE[i];
    const [x1, y1] = DRAW_CURVE[i + 1];
    if (absDiff <= x1) {
      const t = (absDiff - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }

  const [x0, y0] = DRAW_CURVE[DRAW_CURVE.length - 2];
  const [x1, y1] = DRAW_CURVE[DRAW_CURVE.length - 1];
  const slope = (y1 - y0) / (x1 - x0);
  return y1 + slope * (absDiff - x1);
}

export function closenessAdjustedDrawRate(baseDrawRate: number, absEloDiff: number): number {
  const scale = baseDrawRate / POOLED_AVG_DRAW_RATE;
  const raw = interpolateCurve(absEloDiff) * scale;
  return Math.min(MAX_DRAW_RATE, Math.max(MIN_DRAW_RATE, raw));
}
