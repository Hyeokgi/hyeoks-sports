// round_predictions에 저장된 원본 diff 성분을 읽어 토글이 반영된 확률로 재계산
import { getRoundMatches, getRoundPredictions, getMarketOdds } from "./db";
import { predictMatch, DEFAULT_TOGGLES, type PredictionToggles, type MatchPrediction } from "./prediction";
import { findCalibrationBucket, confidenceTier, type CalibrationBucket, type ConfidenceTier } from "./calibration";
import { computeUpsetSignal, type UpsetSignal } from "./upsetSignal";
import { isModelLeague } from "./nameMap";
import type { Env, RoundMatchRow } from "../types";

export interface MatchWithPrediction {
  match: RoundMatchRow;
  prediction: MatchPrediction;
  // predictMatch()가 낸 원본 확률은 절대 덮어쓰지 않는다 - 이 필드는 같은 확신도 구간에서
  // 과거 실제로 얼마나 맞았는지를 "참고용"으로 병기하기 위한 것 (작업1: 확률 표시의 정직성 개선).
  calibration: { bucket: CalibrationBucket | null; tier: ConfidenceTier };
  // 모델픽-시장픽 합의여부/조건부 역배당 신호(참고용, upsetSignal.ts 주석 참고).
  upsetSignal: UpsetSignal;
  raw: {
    eloDiff: number;
    formDiff: number;
    h2hDiff: number;
    nH2h: number;
    leagueDrawRate: number;
    market: { pHome: number; pDraw: number; pAway: number; nBookmakers: number } | null;
    xgDiff: number | null;
    cornersDiff: number | null;
  };
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

  return matches.map((m: RoundMatchRow) => {
    const raw = predRows.get(m.id);
    if (!raw) {
      throw new Error(`round_match ${m.id}에 대한 예측 원본 데이터가 없습니다`);
    }
    const marketRow = marketRows.get(m.id);
    const market = marketRow
      ? { pHome: marketRow.p_home, pDraw: marketRow.p_draw, pAway: marketRow.p_away, nBookmakers: marketRow.n_bookmakers }
      : null;

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
        // 모델(Elo/폼/H2H)이 검증된 리그가 아니면 배당만 쓴다. round_predictions에 저장된
        // 성분은 이 경우 전부 0이라, 섞으면 가짜 신호가 배당을 희석시킨다.
        marketOnly: !isModelLeague(m.league),
      },
      merged,
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
      raw: {
        eloDiff: raw.elo_diff,
        formDiff: raw.form_diff,
        h2hDiff: raw.h2h_diff,
        nH2h: raw.n_h2h,
        leagueDrawRate: raw.league_draw_rate,
        market,
        xgDiff: raw.xg_diff,
        cornersDiff: raw.corners_diff,
      },
    };
  });
}
