// 서버(predictRound.ts)와 브라우저(public/app.ts)가 "같은 입력이면 같은 확률"을 내도록 공유하는 규칙.
//
// 왜 따로 두는가: 앱은 서버 응답의 raw 성분으로 확률을 다시 계산한다(토글 시뮬레이션). 그런데
// 브라우저는 DEFAULT_TOGGLES를 그대로 넘겨 marketWeight 0.4를 모든 리그에 썼고, 서버는 유럽
// 4대리그에 0.8을 썼다. 같은 회차인데 화면과 API·회차 글의 확률이 달랐다. 또 브라우저는
// market_only를 리그 이름으로 다시 판단해, 지원 리그인데 배당 기반으로 등록된 경기를 "모델 예측"으로
// 뒤집었다. predictRound.ts는 D1을 읽어 번들에 넣을 수 없으므로, 판단 규칙만 이 파일에 모은다.
//
// 이 파일은 DB·Worker API를 import하지 않는다(esbuild로 브라우저 번들에 들어간다).
// 가중치 값 자체는 prediction.ts의 marketWeightForLeague가 유일한 출처다. 여기서 바꾸지 않는다.
import {
  predictMatch,
  marketWeightForLeague,
  type MarketOdds,
  type MatchPrediction,
  type PredictionInputs,
  type PredictionToggles,
} from "./prediction";
import { isModelLeague } from "./nameMap";

/**
 * 등록 시점에 고정된 market_only를 쓰되, 그 컬럼이 없던 시절(migration 0008 이전) 회차는
 * 리그 기준으로 폴백한다. 이 판단이 뒤집히면 elo_diff=0으로 저장된 경기가 "모델 예측"으로
 * 표시되므로(격차 0 + 홈어드밴티지라는 가짜 신호), 규칙을 한 곳에 두고 테스트로 고정한다.
 * (predictRound.ts가 같은 이름으로 다시 내보낸다 - 기존 import 경로 유지)
 */
export function resolveMarketOnly(storedMarketOnly: number | null | undefined, league: string): boolean {
  return storedMarketOnly == null ? !isModelLeague(league) : storedMarketOnly === 1;
}

/**
 * 브라우저 쪽 market-only 판정. 서버가 확정해 내려준 값(raw.resolvedMarketOnly)이 있으면 그대로 쓴다.
 * 필드가 아예 없을 때(구버전 API 응답이 캐시에 남은 경우)만 리그 기준으로 폴백한다.
 * false도 유효한 값이라 `??`가 아니라 boolean 여부로 가른다.
 */
export function clientMarketOnly(resolvedMarketOnly: boolean | null | undefined, league: string): boolean {
  return typeof resolvedMarketOnly === "boolean" ? resolvedMarketOnly : resolveMarketOnly(null, league);
}

/**
 * 사용자가 고른 배당 반영 비율을 정리한다. 숫자가 아니거나 0~1 밖이면 "명시값 없음"(null)으로 본다.
 * null은 "리그 기본값을 쓴다"는 뜻이다. 0은 유효한 명시값(배당을 섞지 않음)이므로 null과 구분한다.
 */
export function normalizeMarketWeightOverride(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

/**
 * 한 경기에 실제로 넘길 토글. marketWeight는 항상 여기서 정한다.
 *  - 명시값(override)이 있으면 그 값이 이긴다(시뮬레이터에서 사용자가 직접 고른 경우).
 *  - 없으면 리그 기본값(marketWeightForLeague: 유럽 4대리그 0.8, 그 밖 0.4).
 * base.marketWeight(DEFAULT_TOGGLES의 0.4)는 의도적으로 무시한다. 그 값이 그대로 흘러가서
 * 유럽 리그 확률이 서버와 달라진 것이 이 함수를 만든 이유다.
 */
export function togglesForLeague(
  base: PredictionToggles,
  league: string | undefined,
  marketWeightOverride?: number | null,
): PredictionToggles {
  const explicit = normalizeMarketWeightOverride(marketWeightOverride);
  return { ...base, marketWeight: explicit ?? marketWeightForLeague(league) };
}

/** 앱이 서버 응답에서 받아 두는 경기 성분(public/app.ts MatchData.raw와 같은 모양). */
export interface ClientRawComponents {
  eloDiff: number;
  formDiff: number;
  h2hDiff: number;
  leagueDrawRate: number;
  market: MarketOdds | null;
  xgDiff: number | null;
  cornersDiff: number | null;
  nationalEloDiff?: number | null;
  // 서버가 등록 시점 값(market_only)으로 확정한 판정. 구버전 API면 undefined.
  resolvedMarketOnly?: boolean | null;
}

/** raw 성분 → predictMatch 입력. 서버 buildRoundPredictions와 같은 필드를 같은 규칙으로 채운다. */
export function toPredictionInputs(league: string, raw: ClientRawComponents): PredictionInputs {
  return {
    eloDiff: raw.eloDiff,
    formDiff: raw.formDiff,
    h2hDiff: raw.h2hDiff,
    leagueDrawRate: raw.leagueDrawRate,
    marketOdds: raw.market,
    xgDiff: raw.xgDiff,
    cornersDiff: raw.cornersDiff,
    league,
    marketOnly: clientMarketOnly(raw.resolvedMarketOnly, league),
    nationalEloDiff: raw.nationalEloDiff ?? null,
  };
}

// 유럽 4대리그 확신도 보정표(calibration.ts)는 다시 만들 때까지 화면에서 근거로 내세우지 않는다.
// 평가 하니스 점검에서 무승부율을 전체 표본(테스트 구간 포함)으로 구한 누수와 폼 척도(/3) 불일치가
// 확인돼, 그 표의 구간별 적중률·등급(확신픽/보통/불확실)을 현재 모델의 실측 근거로 볼 수 없다.
// 계수·가중치는 그대로 두고(4분할 재검증 전에는 바꾸지 않는다) 표시만 낮춘다.
// 목록은 유럽 marketWeight(0.8)를 쓰는 리그와 같다 - 테스트가 둘이 갈리지 않는지 확인한다.
// 2026-10-12: 고친 하니스로 유럽 4개 리그 보정표를 재산출해 calibration.ts에 반영했다. 재검증 중인 리그 없음.
// 다시 문제가 생기면 이 목록에 리그를 넣으면 화면·글에서 구간 적중률 표시가 숨겨진다.
export const CALIBRATION_UNDER_REVIEW_LEAGUES: readonly string[] = ["K리그1", "MLS"]; // 2026-10-12 배당 비중 0.4→0.8, 보정표 재산출 전
export const CALIBRATION_REVIEW_LABEL = "과거 보정표 재검증 중";

/** 이 리그의 확신도 보정표(구간별 과거 적중률·등급)를 지금 화면에 근거로 보여주면 안 되는가. */
export function isCalibrationUnderReview(league: string | undefined): boolean {
  return league != null && CALIBRATION_UNDER_REVIEW_LEAGUES.includes(league);
}

/** 브라우저 재계산의 단일 진입점. 토글과 명시 marketWeight를 받아 리그별 규칙을 적용한다. */
export function predictForClient(
  league: string,
  raw: ClientRawComponents,
  base: PredictionToggles,
  marketWeightOverride?: number | null,
): MatchPrediction {
  return predictMatch(toPredictionInputs(league, raw), togglesForLeague(base, league, marketWeightOverride));
}
