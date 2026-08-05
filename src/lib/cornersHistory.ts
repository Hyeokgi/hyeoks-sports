// K리그2 한정 코너킥 최근 폼 계산 (2026-08-04 백테스트로 실증 검증된 피처 - train/test 4개
// 분할 전부에서 정확도+Brier 개선, 최적 가중치 약 30). elo.ts와 별개 모듈로 두는 이유는
// 다른 리그에서는 무효/역효과로 확인돼 K리그2 전용 부가 기능으로 격리하기 위함.
import type { K2CornersMatchRow } from "./db";

export function buildCornersHistory(rows: K2CornersMatchRow[]): Map<string, number[]> {
  const hist = new Map<string, number[]>();
  for (const r of rows) {
    if (!hist.has(r.home)) hist.set(r.home, []);
    if (!hist.has(r.away)) hist.set(r.away, []);
    hist.get(r.home)!.push(r.home_corners);
    hist.get(r.away)!.push(r.away_corners);
  }
  return hist;
}

export function recentCornersDiff(
  hist: Map<string, number[]>,
  home: string,
  away: string,
  n = 5,
): number | null {
  const h = (hist.get(home) ?? []).slice(-n);
  const a = (hist.get(away) ?? []).slice(-n);
  if (h.length === 0 || a.length === 0) return null;
  const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
  return avg(h) - avg(a);
}
