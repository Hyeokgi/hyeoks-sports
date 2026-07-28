// scripts/generate_report.mjs의 buildPrompt는 GitHub Actions(별도 런타임)에서 돌리기 위해
// src/lib/gemini.ts의 buildPrompt를 부득이 복제한 것 — 둘이 벌어지지 않는지 회귀 검증
import { describe, expect, it } from "vitest";
import { buildPrompt as buildPromptWorker } from "../src/lib/gemini";
// @ts-expect-error - .mjs는 타입 선언이 없는 순수 JS 스크립트
import { buildPrompt as buildPromptAction } from "../scripts/generate_report.mjs";
import { predictMatch, DEFAULT_TOGGLES } from "../src/lib/prediction";
import fixture from "./fixtures/round42_prediction_v2.json";

describe("generate_report.mjs buildPrompt matches src/lib/gemini.ts buildPrompt", () => {
  it("produces an identical prompt string", () => {
    const matches = (fixture as any[]).map((row) => ({
      league: row.league,
      home: row.home,
      away: row.away,
      prediction: predictMatch(
        { eloDiff: row.elo_diff, formDiff: row.form_diff, h2hDiff: row.h2h_diff, leagueDrawRate: 0.2849 },
        DEFAULT_TOGGLES,
      ),
    }));

    const a = buildPromptWorker("42회차", matches);
    const b = buildPromptAction("42회차", matches);
    expect(b).toBe(a);
  });
});
