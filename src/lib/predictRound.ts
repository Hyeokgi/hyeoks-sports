// round_predictions에 저장된 원본 diff 성분을 읽어 토글이 반영된 확률로 재계산
import { getRoundMatches, getRoundPredictions, getMarketOdds } from "./db";
import { predictMatch, DEFAULT_TOGGLES, type PredictionToggles, type MatchPrediction } from "./prediction";
import { findCalibrationBucket, confidenceTier, type CalibrationBucket, type ConfidenceTier } from "./calibration";
import { computeUpsetSignal, type UpsetSignal } from "./upsetSignal";
import { resolveMarketOnly, togglesForLeague } from "./clientPrediction";
import type { Env, RoundMatchRow } from "../types";

// 규칙 본체는 브라우저와 공유하는 clientPrediction.ts에 있다. 기존 import 경로(테스트 등)를 위해 다시 내보낸다.
export { resolveMarketOnly };

export interface MatchWithPrediction {
  match: RoundMatchRow;
  prediction: MatchPrediction;
  // predictMatch()가 낸 원본 확률은 절대 덮어쓰지 않는다 - 이 필드는 같은 확신도 구간에서
  // 과거 실제로 얼마나 맞았는지를 "참고용"으로 병기하기 위한 것 (작업1: 확률 표시의 정직성 개선).
  calibration: { bucket: CalibrationBucket | null; tier: ConfidenceTier };
  // 모델픽-시장픽 합의여부/조건부 역배당 신호(참고용, upsetSignal.ts 주석 참고).
  upsetSignal: UpsetSignal;
  // 예측 성분이 킥오프 이후에 계산됐는가. 그렇다면 Elo·폼에 그 경기 결과가 이미 들어 있어
  // 적중/실패를 매기면 안 된다(predictedAfterKickoff 주석 참고).
  predictedAfterKickoff: boolean;
  raw: {
    eloDiff: number;
    formDiff: number;
    h2hDiff: number;
    nH2h: number;
    leagueDrawRate: number;
    market: { pHome: number; pDraw: number; pAway: number; nBookmakers: number } | null;
    xgDiff: number | null;
    cornersDiff: number | null;
    nationalEloDiff: number | null;
    // 서버가 등록 시점 market_only(없으면 리그 기준 폴백)로 확정한 판정. 브라우저 재계산이
    // 이 값을 그대로 써야 화면과 API가 갈리지 않는다(public/app.ts loadRound 매핑 참고).
    // 리그 이름만으로 다시 판단하면, 지원 리그인데 팀명 매핑이 없어 배당 기반으로 등록된 경기가
    // 브라우저에서만 "모델 예측"(격차 0 + 홈어드밴티지)으로 뒤집힌다.
    resolvedMarketOnly: boolean;
  };
}

/**
 * 예측 성분(round_predictions.computed_at)이 킥오프 이후에 만들어졌는지.
 *
 * 성분은 회차 등록 시점의 Elo·폼·H2H로 한 번 고정된다. 보통은 발매 중에 등록되니 문제가
 * 없지만, 회차 감지가 멈췄다가 따라잡으면(2026-09-24: 52회차에서 4주 멈춘 뒤 53~57회차를
 * 한꺼번에 등록) 이미 끝난 경기를 그 결과가 반영된 Elo로 '예측'하게 된다. 그걸 적중으로
 * 세면 답을 보고 맞힌 걸 모델 성적으로 보여주는 셈이다. 화면과 시트에서 집계를 빼기 위한 판정.
 *
 * 킥오프 시각을 모르면(파싱 실패) 판단 근거가 없으니 기존처럼 집계에 넣는다.
 */
export function predictedAfterKickoff(computedAt: string | null | undefined, kickoffAt: string | null | undefined): boolean {
  if (!computedAt || !kickoffAt) return false;
  const c = Date.parse(computedAt);
  const k = Date.parse(kickoffAt);
  if (!Number.isFinite(c) || !Number.isFinite(k)) return false;
  return c >= k;
}

export async function buildRoundPredictions(
  env: Env,
  roundId: number,
  toggles?: Partial<PredictionToggles>,
): Promise<MatchWithPrediction[]> {
  const matches = await getRoundMatches(env, roundId);
  const matchIds = matches.map((m) => m.id);
  const [predRows, marketRows] = await Promise.all([
    getRoundPredictions(env, matchIds),
    getMarketOdds(env, matchIds),
  ]);
  const merged: PredictionToggles = { ...DEFAULT_TOGGLES, ...toggles };
  // marketWeight는 리그마다 다르다(유럽 4대리그만 큰 표본으로 검증됨 - prediction.ts 참고).
  // 호출자가 명시적으로 넘겼으면 그 값이 이긴다. 시뮬레이터가 슬라이더로 0.4를 고르는 것과
  // 아무것도 안 넘기는 것을 구분해야 해서 undefined 여부로 판단한다.
  // 리그별 기본값 적용 규칙은 브라우저와 같은 함수(togglesForLeague)로 한다.
  const explicitMarketWeight = toggles?.marketWeight;

  return matches.map((m: RoundMatchRow) => {
    const raw = predRows.get(m.id);
    if (!raw) {
      throw new Error(`round_match ${m.id}에 대한 예측 원본 데이터가 없습니다`);
    }
    const marketRow = marketRows.get(m.id);
    const market = marketRow
      ? { pHome: marketRow.p_home, pDraw: marketRow.p_draw, pAway: marketRow.p_away, nBookmakers: marketRow.n_bookmakers }
      : null;
    // 등록 시점에 고정된 값을 쓴다. 여기서 리그로 다시 판단하면, 나중에 NAME_MAP에
    // 팀명을 추가했을 때 성분이 0으로 저장된 경기가 "모델 예측"으로 뒤집힌다.
    // market_only 컬럼이 없던 시절(0008 이전) 회차는 NULL이라 리그 기준으로 폴백한다.
    const marketOnly = resolveMarketOnly(raw.market_only, m.league);

    const prediction = predictMatch(
      {
        eloDiff: raw.elo_diff,
        formDiff: raw.form_diff,
        h2hDiff: raw.h2h_diff,
        leagueDrawRate: raw.league_draw_rate,
        marketOdds: market,
        xgDiff: raw.xg_diff,
        cornersDiff: raw.corners_diff,
        league: m.league,
        marketOnly,
        nationalEloDiff: raw.nat_elo_diff ?? null,
      },
      togglesForLeague(merged, m.league, explicitMarketWeight),
    );
    const calibration = {
      bucket: findCalibrationBucket(m.league, prediction.confidenceGap),
      tier: confidenceTier(m.league, prediction.confidenceGap),
    };
    const upsetSignal = computeUpsetSignal(prediction, market, calibration.tier);
    return {
      match: m,
      prediction,
      calibration,
      upsetSignal,
      predictedAfterKickoff: predictedAfterKickoff(raw.computed_at, m.kickoff_at),
      raw: {
        eloDiff: raw.elo_diff,
        formDiff: raw.form_diff,
        h2hDiff: raw.h2h_diff,
        nH2h: raw.n_h2h,
        leagueDrawRate: raw.league_draw_rate,
        market,
        xgDiff: raw.xg_diff,
        cornersDiff: raw.corners_diff,
        nationalEloDiff: raw.nat_elo_diff ?? null,
        resolvedMarketOnly: marketOnly,
      },
    };
  });
}
