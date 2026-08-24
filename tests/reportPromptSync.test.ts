// scripts/generate_report.mjs의 buildPrompt는 GitHub Actions(별도 런타임)에서 돌리기 위해
// src/lib/gemini.ts의 buildPrompt를 부득이 복제한 것 — 둘이 벌어지지 않는지 회귀 검증
import { describe, expect, it } from "vitest";
import { buildPrompt as buildPromptWorker } from "../src/lib/gemini";
// @ts-expect-error - .mjs는 타입 선언이 없는 순수 JS 스크립트
import { buildPrompt as buildPromptAction } from "../scripts/generate_report.mjs";
import { predictMatch, DEFAULT_TOGGLES } from "../src/lib/prediction";
import { findCalibrationBucket } from "../src/lib/calibration";
import fixture from "./fixtures/round42_prediction_v2.json";

describe("generate_report.mjs buildPrompt matches src/lib/gemini.ts buildPrompt", () => {
  it("produces an identical prompt string", () => {
    const matches = (fixture as any[]).map((row) => {
      const prediction = predictMatch(
        { eloDiff: row.elo_diff, formDiff: row.form_diff, h2hDiff: row.h2h_diff, leagueDrawRate: 0.2849 },
        DEFAULT_TOGGLES,
      );
      return {
        league: row.league,
        home: row.home,
        away: row.away,
        prediction,
        calibration: { bucket: findCalibrationBucket(row.league, prediction.confidenceGap) },
      };
    });

    const a = buildPromptWorker("42회차", matches);
    const b = buildPromptAction("42회차", matches);
    expect(b).toBe(a);
  });

  // 배당 기반 경기(UCL/UEL)가 섞인 회차는 프롬프트에 별도 안내가 붙는다.
  // 복제본이 그 분기까지 같이 따라오는지 확인한다 - 여기가 벌어지면 리포트가 배당 기반
  // 경기를 "모델이 분석했다"고 서술하게 된다.
  it("배당 기반 경기가 섞여도 두 buildPrompt가 같은 문자열을 만든다", () => {
    const market = predictMatch(
      { eloDiff: 0, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.271, marketOdds: { pHome: 0.751, pDraw: 0.154, pAway: 0.095, nBookmakers: 7 }, marketOnly: true },
      DEFAULT_TOGGLES,
    );
    const model = predictMatch({ eloDiff: 120, formDiff: 0.4, h2hDiff: 0.2, leagueDrawRate: 0.271 }, DEFAULT_TOGGLES);
    const matches = [
      { league: "UEL", home: "잘츠부르", away: "미엘뷔", prediction: market, calibration: { bucket: null } },
      {
        league: "EPL",
        home: "에버턴",
        away: "크리스털",
        prediction: model,
        calibration: { bucket: findCalibrationBucket("EPL", model.confidenceGap) },
      },
    ];
    const a = buildPromptWorker("47회차", matches);
    expect(a).toContain("배당기반추천");
    expect(a).toContain("배당에서 마진을 제거한 확률");
    expect(buildPromptAction("47회차", matches)).toBe(a);
  });
});
