import { describe, it, expect } from "vitest";
import { analyzeMatch, josa, type AnalysisInput, type MatchDetail } from "../src/lib/matchAnalysis";
import { nationalDisplayName } from "../src/lib/nationalNames";

const detail = (o: Partial<MatchDetail> = {}): MatchDetail => ({
  eloDiff: null,
  formDiff: null,
  h2hDiff: null,
  nH2h: 0,
  natEloDiff: null,
  natProbs: null,
  market: null,
  marketOpen: null,
  modelOnly: null,
  calib: null,
  ...o,
});
const base = (o: Partial<AnalysisInput> = {}): AnalysisInput => ({
  home: "울산",
  away: "전북",
  pHome: 0.5,
  pDraw: 0.27,
  pAway: 0.23,
  pick: "홈승",
  confidenceGap: 0.23,
  basis: "model",
  vote: null,
  detail: detail(),
  ...o,
});
const ctx = { avgDraw: 0.27 };

describe("josa", () => {
  it("받침에 맞춰 조사를 고른다", () => {
    expect(josa("울산 승", "이", "가")).toBe("울산 승이");
    expect(josa("무승부", "이", "가")).toBe("무승부가");
    expect(josa("슬로베니아", "이", "가")).toBe("슬로베니아가");
    expect(josa("전북 승", "과", "와")).toBe("전북 승과");
  });
});

describe("analyzeMatch", () => {
  it("근거가 없으면 판단을 보류하고 픽을 권하지 않는다", () => {
    const a = analyzeMatch(base({ basis: "none" }), ctx);
    expect(a.stance).toBe("판단 보류");
    expect(a.cover).toEqual([]);
  });

  it("클럽 모델: Elo·폼·맞대결·과거 적중률이 근거로 나온다", () => {
    const a = analyzeMatch(
      base({
        detail: detail({
          eloDiff: 120,
          formDiff: 0.8,
          h2hDiff: 0.6,
          nH2h: 4,
          calib: { accuracy: 0.61, n: 812, minGap: 0.2, maxGap: 0.3 },
        }),
      }),
      ctx,
    );
    const t = a.reasons.join("\n");
    expect(t).toContain("울산이 120점 앞섭니다");
    expect(t).toContain("경기당 승점은 울산이 0.8점");
    expect(t).toContain("맞대결 4경기에서는 울산이 우세");
    expect(t).toContain("과거 적중률은 61%");
    expect(a.stance).toBe("단식");
  });

  it("모델과 시장이 엇갈리면 근거와 위험에 모두 드러낸다", () => {
    const a = analyzeMatch(
      base({
        detail: detail({
          market: { pHome: 0.3, pDraw: 0.3, pAway: 0.4, n: 6 },
          modelOnly: { pHome: 0.55, pDraw: 0.25, pAway: 0.2 },
        }),
      }),
      ctx,
    );
    expect(a.reasons.join()).toContain("판단이 엇갈립니다");
    expect(a.risks).toContain("모델과 시장의 판단이 서로 다릅니다.");
    expect(a.stance).not.toBe("단식"); // 위험 신호가 있으면 단식 권장하지 않음
  });

  it("배당이 추천 반대로 움직이면 위험으로 적는다(3%p 경계 포함)", () => {
    const a = analyzeMatch(
      base({
        basis: "market",
        pHome: 0.45,
        detail: detail({ market: { pHome: 0.45, pDraw: 0.28, pAway: 0.27, n: 5 }, marketOpen: { pHome: 0.48, pDraw: 0.27, pAway: 0.25 } }),
      }),
      ctx,
    );
    expect(a.reasons.join()).toContain("48% → 45%로 내려");
    expect(a.risks.join()).toContain("반대 방향");
  });

  it("국가대표: 배당과 Elo가 같으면 교차 확인, 다르면 위험", () => {
    const same = analyzeMatch(
      base({
        basis: "market",
        home: "슬로베니아",
        away: "북마케도니아",
        detail: detail({ market: { pHome: 0.55, pDraw: 0.26, pAway: 0.19, n: 5 }, natEloDiff: 90, natProbs: { pHome: 0.6, pDraw: 0.24, pAway: 0.16 } }),
      }),
      ctx,
    );
    expect(same.reasons.join()).toContain("슬로베니아가 90점 높고");
    expect(same.reasons.join()).toContain("두 독립된 근거가 같은 방향");
    const diff = analyzeMatch(
      base({
        basis: "market",
        pick: "원정승",
        pHome: 0.28,
        pAway: 0.44,
        detail: detail({ market: { pHome: 0.28, pDraw: 0.28, pAway: 0.44, n: 5 }, natEloDiff: -20, natProbs: { pHome: 0.45, pDraw: 0.28, pAway: 0.27 } }),
      }),
      ctx,
    );
    expect(diff.risks.join()).toContain("판단이 다릅니다");
  });

  it("대중과 갈린 경기, 대중 과열 경기", () => {
    const split = analyzeMatch(base({ vote: { home: 20, draw: 20, away: 60 } }), ctx);
    expect(split.reasons.join()).toContain("우리 판단과 다릅니다");
    const hot = analyzeMatch(base({ vote: { home: 80, draw: 10, away: 10 } }), ctx);
    expect(hot.risks.join()).toContain("맞혀도 당첨금 몫은 작습니다");
  });

  it("박빙·무승부 고위험이면 삼복식을 고려한다", () => {
    const a = analyzeMatch(base({ basis: "market", pHome: 0.355, pDraw: 0.289, pAway: 0.356, pick: "원정승", confidenceGap: 0.001 }), ctx);
    expect(a.stance).toBe("삼복식 고려");
    expect(a.risks.join()).toContain("박빙");
  });
});

describe("nationalDisplayName", () => {
  it("잘린 국가명을 전체 이름으로, 클럽명은 그대로", () => {
    expect(nationalDisplayName("슬로베니")).toBe("슬로베니아");
    expect(nationalDisplayName("북마케도")).toBe("북마케도니아");
    expect(nationalDisplayName("울산")).toBe("울산");
  });
});
