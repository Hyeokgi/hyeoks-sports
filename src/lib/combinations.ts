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
  // 확신도 낮은 경기 상위 N개는 무승부가 확률 3위라도 예산이 허락하는 한 강제로 포함시킨다(사용자 리스크 선호)
  guaranteeDrawCount?: number;
}

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

  const guaranteeDrawCount = options.guaranteeDrawCount ?? 0;
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
