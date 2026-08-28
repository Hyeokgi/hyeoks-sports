// 예산 내 최대한 많은 경우의 수를 만드는 복식/삼복식 조합 생성기 (신규 로직)
// 회차당 1인 구매한도(betman.co.kr 고지 기준 100,000원)를 넘지 않는 선에서,
// 확신도(1위-2위 확률차)가 가장 낮은 경기부터 순서대로 복식(2개 선택) -> 삼복식(3개 선택)으로 승급시킨다.
import type { MatchPrediction } from "./prediction";

export type Outcome = "홈승" | "무승부" | "원정승";

export const UNIT_PRICE_WON = 1000;
export const PERSONAL_LIMIT_WON = 100_000;
export const DEFAULT_BUDGET_TIERS = [5_000, 10_000, 30_000, 50_000, 100_000];

export interface ComboMatch {
  seq: number;
  league: string;
  home: string;
  away: string;
  prediction: MatchPrediction;
}

export interface MatchPick {
  seq: number;
  league: string;
  home: string;
  away: string;
  picks: Outcome[]; // 확률 내림차순 1~3개
  confidenceGap: number;
}

export interface SystemBetPlan {
  budgetWon: number;
  unitPriceWon: number;
  totalCombinations: number;
  totalCostWon: number;
  picks: MatchPick[];
}

export interface SystemBetOptions {
  // 확신도 낮은 경기 상위 N개는 무승부가 확률 3위라도 예산이 허락하는 한 강제로 포함시킨다(사용자 리스크 선호).
  // "auto"면 예산별로 기대 커버리지가 가장 높은 개수를 자동으로 고른다(pickDrawCountForBudget).
  guaranteeDrawCount?: number | "auto";
}

// 1~41회차 574경기 실측: 회차당 무승부 평균 3.76개, 중앙값 4개, 최소 1개.
// 무승부가 0개인 회차는 41회차 중 한 번도 없었다. 반면 단식 픽(확률 1위)은 무승부를 거의
// 못 고른다 - 무승부가 1위가 되려면 홈/원정이 둘 다 그보다 낮아야 하는데 그런 배당은 드물다
// (47회차 실측: 우리 픽 14개 중 무승부 0개, 실제 무승부 3개).
// 그래서 조합에서 무승부를 덮는 건 취향이 아니라 구조적 공백을 메우는 일이다.
export const HISTORICAL_DRAWS_PER_ROUND_MEDIAN = 4;

// "auto"의 상한. 예산 적응은 이 값이 아니라 아래 강제 루프의 예산 검사(newTotal <= maxCombos)가
// 한다 - 감당 못 하는 경기는 조용히 건너뛰므로, 상한만 실측 중앙값에 맞춰두면 예산이 커질수록
// 자연히 더 많이 덮인다(47회차 실측 클램프 결과: 5천원 1개 / 1만~2만원 2개 / 3만~5만원 3개 / 10만원 4개).
//
// 왜 "기대 커버리지가 최대인 개수"를 고르지 않는가: 그 계산은 배당 확률을 그대로 믿는 것이라
// 순환이다. 배당대로면 무승부를 3픽으로 넣는 것보다 다른 경기를 복식으로 만드는 게 늘 이득이라
// 항상 강제 0을 고르는데, 실제로는 그게 더 나빴다(47회차 5천원 실패 7 vs 6, 10만원 실패 5 vs 4).
// 무승부 강제의 근거는 배당이 아니라 574경기 실측 빈도다.
const AUTO_DRAW_COUNT_MAX = HISTORICAL_DRAWS_PER_ROUND_MEDIAN;

export function generateSystemBet(
  matches: ComboMatch[],
  budgetWon: number,
  unitPriceWon: number = UNIT_PRICE_WON,
  options: SystemBetOptions = {},
): SystemBetPlan {
  const maxCombos = Math.floor(Math.min(budgetWon, PERSONAL_LIMIT_WON) / unitPriceWon);
  const factors = matches.map(() => 1);
  let total = 1;

  if (maxCombos < 1) {
    return {
      budgetWon,
      unitPriceWon,
      totalCombinations: 0,
      totalCostWon: 0,
      picks: matches.map((m) => toMatchPick(m, 1)),
    };
  }

  const byConfidenceAsc = [...matches.keys()].sort(
    (a, b) => matches[a].prediction.confidenceGap - matches[b].prediction.confidenceGap,
  );

  const guaranteeDrawCount =
    options.guaranteeDrawCount === "auto" ? AUTO_DRAW_COUNT_MAX : options.guaranteeDrawCount ?? 0;
  if (guaranteeDrawCount > 0) {
    let forcedSuccess = 0;
    for (const i of byConfidenceAsc) {
      if (forcedSuccess >= guaranteeDrawCount) break;
      const drawPos = matches[i].prediction.rankedPicks.indexOf("무승부");
      const neededFactor = drawPos + 1;
      if (neededFactor <= factors[i]) {
        forcedSuccess++;
        continue;
      }
      const newTotal = (total / factors[i]) * neededFactor;
      if (newTotal <= maxCombos) {
        total = newTotal;
        factors[i] = neededFactor;
        forcedSuccess++;
      }
    }
  }

  while (true) {
    const candidate1 = byConfidenceAsc.find((i) => factors[i] === 1);
    const candidate2 = byConfidenceAsc.find((i) => factors[i] === 2);

    if (candidate1 !== undefined && total * 2 <= maxCombos) {
      factors[candidate1] = 2;
      total *= 2;
      continue;
    }
    if (candidate2 !== undefined && total * 1.5 <= maxCombos) {
      factors[candidate2] = 3;
      total = Math.round(total * 1.5);
      continue;
    }
    break;
  }

  return {
    budgetWon,
    unitPriceWon,
    totalCombinations: total,
    totalCostWon: total * unitPriceWon,
    picks: matches.map((m, i) => toMatchPick(m, factors[i])),
  };
}

export function generateSystemBetTiers(
  matches: ComboMatch[],
  tiers: number[] = DEFAULT_BUDGET_TIERS,
  unitPriceWon: number = UNIT_PRICE_WON,
  options: SystemBetOptions = {},
): SystemBetPlan[] {
  return tiers.map((budget) => generateSystemBet(matches, budget, unitPriceWon, options));
}

function toMatchPick(m: ComboMatch, factor: number): MatchPick {
  const picks = m.prediction.rankedPicks.slice(0, factor);
  return {
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    picks,
    confidenceGap: m.prediction.confidenceGap,
  };
}
