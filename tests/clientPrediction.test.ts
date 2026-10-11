// 브라우저 재계산(public/app.ts)과 서버(predictRound.ts)가 같은 규칙을 쓰는지 고정한다.
// 2026-10 점검에서 브라우저가 DEFAULT_TOGGLES의 marketWeight 0.4를 모든 리그에 넘겨, 유럽 4대리그
// (서버 0.8) 확률이 화면에서만 달랐다. 또 브라우저가 market_only를 리그 이름으로 다시 판단해,
// 지원 리그인데 배당 기반으로 등록된 경기를 "모델 예측"으로 뒤집을 수 있었다.
import { describe, expect, it } from "vitest";
import {
  predictMatch,
  DEFAULT_TOGGLES,
  DEFAULT_MARKET_WEIGHT,
  EUROPEAN_MARKET_WEIGHT,
  marketWeightForLeague,
  type PredictionToggles,
} from "../src/lib/prediction";
import {
  clientMarketOnly,
  normalizeMarketWeightOverride,
  togglesForLeague,
  toPredictionInputs,
  predictForClient,
  resolveMarketOnly,
  isCalibrationUnderReview,
  CALIBRATION_UNDER_REVIEW_LEAGUES,
  type ClientRawComponents,
} from "../src/lib/clientPrediction";
import { resolveMarketOnly as resolveMarketOnlyFromServer } from "../src/lib/predictRound";
import { MODEL_LEAGUES } from "../src/lib/nameMap";

const UNSUPPORTED = ["UCL", "UEL", "UECL", "U네이션", "A매치", "월드컵예선"];
const ALL_LEAGUES = [...MODEL_LEAGUES, ...UNSUPPORTED];

// 모델 확률(홈 우세)과 충분히 다른 배당을 써야 0.4/0.8 블렌딩 차이가 테스트에서 드러난다.
const MARKET = { pHome: 0.3, pDraw: 0.3, pAway: 0.4, nBookmakers: 6 };

function raw(over: Partial<ClientRawComponents> = {}): ClientRawComponents {
  return {
    eloDiff: 80,
    formDiff: 0.4,
    h2hDiff: 0.2,
    leagueDrawRate: 0.27,
    market: MARKET,
    xgDiff: null,
    cornersDiff: null,
    nationalEloDiff: null,
    ...over,
  };
}

// 서버 buildRoundPredictions가 토글 없이 호출될 때와 같은 계산을 손으로 재현한다(DB 없이).
function serverDefault(league: string, r: ClientRawComponents, storedMarketOnly: number | null) {
  return predictMatch(
    {
      eloDiff: r.eloDiff,
      formDiff: r.formDiff,
      h2hDiff: r.h2hDiff,
      leagueDrawRate: r.leagueDrawRate,
      marketOdds: r.market,
      xgDiff: r.xgDiff,
      cornersDiff: r.cornersDiff,
      league,
      marketOnly: resolveMarketOnlyFromServer(storedMarketOnly, league),
      nationalEloDiff: r.nationalEloDiff ?? null,
    },
    { ...DEFAULT_TOGGLES, marketWeight: marketWeightForLeague(league) },
  );
}

describe("togglesForLeague - 리그별 marketWeight", () => {
  it("명시값이 없으면 모든 리그에서 서버와 같은 리그 기본값을 쓴다", () => {
    for (const lg of ALL_LEAGUES) {
      expect(togglesForLeague(DEFAULT_TOGGLES, lg, null).marketWeight).toBe(marketWeightForLeague(lg));
      expect(togglesForLeague(DEFAULT_TOGGLES, lg).marketWeight).toBe(marketWeightForLeague(lg));
    }
  });

  it("DEFAULT_TOGGLES의 0.4가 유럽 4대리그로 새지 않는다(회귀)", () => {
    for (const lg of ["EPL", "라리가", "세리에A", "분데스리가"]) {
      expect(togglesForLeague(DEFAULT_TOGGLES, lg, null).marketWeight).toBe(EUROPEAN_MARKET_WEIGHT);
    }
    // base에 다른 값이 들어 있어도 무시된다
    const odd: PredictionToggles = { ...DEFAULT_TOGGLES, marketWeight: 0.123 };
    expect(togglesForLeague(odd, "J1리그", null).marketWeight).toBe(DEFAULT_MARKET_WEIGHT);
  });

  it("명시값은 모든 리그에서 이기고, 0도 유효한 명시값이다", () => {
    for (const lg of ALL_LEAGUES) {
      expect(togglesForLeague(DEFAULT_TOGGLES, lg, 0.6).marketWeight).toBe(0.6);
      expect(togglesForLeague(DEFAULT_TOGGLES, lg, 0).marketWeight).toBe(0);
      // 명시적으로 0.4를 고른 것은 유럽 리그에서도 0.4로 남는다(리그 기본값과 구분)
      expect(togglesForLeague(DEFAULT_TOGGLES, lg, 0.4).marketWeight).toBe(0.4);
    }
  });

  it("명시값을 지우면(null) 리그 기본값으로 돌아간다", () => {
    expect(togglesForLeague(DEFAULT_TOGGLES, "EPL", 0.2).marketWeight).toBe(0.2);
    expect(togglesForLeague(DEFAULT_TOGGLES, "EPL", null).marketWeight).toBe(EUROPEAN_MARKET_WEIGHT);
  });

  it("다른 토글 값은 그대로 둔다", () => {
    const base: PredictionToggles = { ...DEFAULT_TOGGLES, useForm: false, useH2H: false };
    const t = togglesForLeague(base, "EPL", null);
    expect(t.useForm).toBe(false);
    expect(t.useH2H).toBe(false);
    expect(t.xgWeight).toBe(base.xgWeight);
  });
});

describe("normalizeMarketWeightOverride", () => {
  it("빈 값·숫자가 아님·범위 밖은 명시값 없음(null)", () => {
    for (const v of [null, undefined, "", "abc", NaN, -0.1, 1.01, Infinity]) {
      expect(normalizeMarketWeightOverride(v)).toBeNull();
    }
  });
  it("0~1 숫자(문자열 포함)는 그대로", () => {
    expect(normalizeMarketWeightOverride(0)).toBe(0);
    expect(normalizeMarketWeightOverride("0")).toBe(0);
    expect(normalizeMarketWeightOverride("0.8")).toBe(0.8);
    expect(normalizeMarketWeightOverride(1)).toBe(1);
  });
});

describe("clientMarketOnly - 서버 확정값 우선, 없을 때만 리그 폴백", () => {
  it("resolveMarketOnly는 서버 경로(predictRound)와 같은 함수다", () => {
    expect(resolveMarketOnlyFromServer).toBe(resolveMarketOnly);
  });

  it("필드가 없으면(구버전 API) 리그 기준으로 폴백 = 서버의 stored NULL 규칙", () => {
    for (const lg of ALL_LEAGUES) {
      expect(clientMarketOnly(undefined, lg)).toBe(resolveMarketOnly(null, lg));
      expect(clientMarketOnly(null, lg)).toBe(resolveMarketOnly(null, lg));
    }
  });

  it("서버가 준 값이 있으면 리그와 무관하게 그 값(false 포함)을 따른다", () => {
    for (const lg of ALL_LEAGUES) {
      expect(clientMarketOnly(true, lg)).toBe(true);
      expect(clientMarketOnly(false, lg)).toBe(false);
    }
  });
});

describe("predictForClient - 서버 기본 계산과 같은 확률", () => {
  it("모든 리그, 저장값 NULL/0/1 조합에서 서버 기본 계산과 같다", () => {
    for (const lg of ALL_LEAGUES) {
      for (const stored of [null, 0, 1] as const) {
        const r = raw({ resolvedMarketOnly: resolveMarketOnly(stored, lg) });
        const client = predictForClient(lg, r, DEFAULT_TOGGLES, null);
        const server = serverDefault(lg, r, stored);
        expect(client).toEqual(server);
      }
    }
  });

  it("유럽 리그 모델 경기 확률은 0.8 블렌딩 결과이고 0.4 결과와 다르다(회귀)", () => {
    const r = raw({ resolvedMarketOnly: false });
    const client = predictForClient("EPL", r, DEFAULT_TOGGLES, null);
    const at04 = predictMatch(toPredictionInputs("EPL", r), { ...DEFAULT_TOGGLES, marketWeight: 0.4 });
    const at08 = predictMatch(toPredictionInputs("EPL", r), { ...DEFAULT_TOGGLES, marketWeight: 0.8 });
    expect(client.pHome).toBeCloseTo(at08.pHome, 12);
    expect(client.pHome).not.toBeCloseTo(at04.pHome, 6);
  });

  it("지원 리그인데 배당 기반으로 등록된 경기(resolvedMarketOnly=true)는 market으로 남는다", () => {
    // 성분이 0으로 저장된 경기. 리그 이름으로 다시 판단하면 홈어드밴티지만 남은 가짜 모델 예측이 된다.
    const r = raw({ eloDiff: 0, formDiff: 0, h2hDiff: 0, resolvedMarketOnly: true });
    const p = predictForClient("세리에A", r, DEFAULT_TOGGLES, null);
    expect(p.basis).toBe("market");
    expect(p.pHome).toBe(MARKET.pHome);
    // 배당이 아직 없으면 예측이 아니라 none
    const none = predictForClient("세리에A", { ...r, market: null }, DEFAULT_TOGGLES, null);
    expect(none.basis).toBe("none");
  });

  it("미지원 대회는 필드가 없어도 배당 기반(구버전 폴백), 서버가 0으로 확정했으면 모델 경로", () => {
    expect(predictForClient("UCL", raw(), DEFAULT_TOGGLES, null).basis).toBe("market");
    expect(predictForClient("UEL", raw({ resolvedMarketOnly: false }), DEFAULT_TOGGLES, null).basis).toBe("model");
  });

  it("국가대표: 배당이 없으면 national, 배당이 생기면 market", () => {
    const r = raw({ eloDiff: 0, formDiff: 0, h2hDiff: 0, market: null, nationalEloDiff: 150, resolvedMarketOnly: true });
    expect(predictForClient("U네이션", r, DEFAULT_TOGGLES, null).basis).toBe("national");
    expect(predictForClient("U네이션", { ...r, market: MARKET }, DEFAULT_TOGGLES, null).basis).toBe("market");
    // 구버전 응답(필드 없음)도 리그 폴백으로 같은 결과
    const legacy = { ...r, resolvedMarketOnly: undefined };
    expect(predictForClient("U네이션", legacy, DEFAULT_TOGGLES, null).basis).toBe("national");
  });

  it("배당 기반 경기는 명시 marketWeight와 무관하다(배당을 그대로 쓴다)", () => {
    const r = raw({ resolvedMarketOnly: true });
    const a = predictForClient("UCL", r, DEFAULT_TOGGLES, 0);
    const b = predictForClient("UCL", r, DEFAULT_TOGGLES, 1);
    expect(a).toEqual(b);
  });
});

describe("보정표 재검증 표시", () => {
  // 2026-10-12: 유럽 4개 리그는 재산출 완료, K리그1·MLS는 배당 비중을 바꿔 보정표 재산출 전이다.
  it("재검증 중인 리그만 숨긴다", () => {
    expect([...CALIBRATION_UNDER_REVIEW_LEAGUES].sort()).toEqual(["K리그1", "MLS"].sort());
    for (const lg of ["K리그1", "MLS"]) expect(isCalibrationUnderReview(lg)).toBe(true);
    for (const lg of ["EPL", "라리가", "세리에A", "분데스리가", "K리그2", "J1리그"]) expect(isCalibrationUnderReview(lg)).toBe(false);
    expect(isCalibrationUnderReview(undefined)).toBe(false);
  });
});
