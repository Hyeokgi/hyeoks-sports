// round_predictions에 저장된 원본 diff 성분을 읽어 토글이 반영된 확률로 재계산
import { getRoundMatches, getRoundPredictions } from "./db";
import { predictMatch, DEFAULT_TOGGLES, type PredictionToggles, type MatchPrediction } from "./prediction";
import type { Env, RoundMatchRow } from "../types";

export interface MatchWithPrediction {
  match: RoundMatchRow;
  prediction: MatchPrediction;
  raw: {
    eloDiff: number;
    formDiff: number;
    h2hDiff: number;
    nH2h: number;
    leagueDrawRate: number;
  };
}

export async function buildRoundPredictions(
  env: Env,
  roundId: number,
  toggles?: Partial<PredictionToggles>,
): Promise<MatchWithPrediction[]> {
  const matches = await getRoundMatches(env, roundId);
  const predRows = await getRoundPredictions(
    env,
    matches.map((m) => m.id),
  );
  const merged: PredictionToggles = { ...DEFAULT_TOGGLES, ...toggles };

  return matches.map((m: RoundMatchRow) => {
    const raw = predRows.get(m.id);
    if (!raw) {
      throw new Error(`round_match ${m.id}에 대한 예측 원본 데이터가 없습니다`);
    }
    const prediction = predictMatch(
      {
        eloDiff: raw.elo_diff,
        formDiff: raw.form_diff,
        h2hDiff: raw.h2h_diff,
        leagueDrawRate: raw.league_draw_rate,
      },
      merged,
    );
    return {
      match: m,
      prediction,
      raw: {
        eloDiff: raw.elo_diff,
        formDiff: raw.form_diff,
        h2hDiff: raw.h2h_diff,
        nH2h: raw.n_h2h,
        leagueDrawRate: raw.league_draw_rate,
      },
    };
  });
}
