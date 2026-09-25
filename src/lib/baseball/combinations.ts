// 야구토토 승1패(G024) 조합 생성기. 14경기 고정 슬레이트, 승/1/패 3택, 파리뮤추얼.
//
// 축구 combinations.ts를 재사용하지 않는 이유는 Outcome 타입이 다른 것만이 아니다.
// "1"을 덮는 근거의 성격이 다르다.
//
//   축구 무승부  1~41회차 574경기에서 회차당 평균 3.76개 나오는데 우리 단식 픽은 거의
//                못 고른다. '드물게 1위가 된다'라서 실측 빈도를 근거로 강제했다.
//   야구 "1"     아예 1위가 될 수 없다. P(1)이 대략 0.21~0.27이고 나머지를 승/패로
//                나누면 큰 쪽이 항상 0.36 이상이라 구조적으로 "1"을 넘을 수 없다.
//                실측으로도 확인했다(scripts/compare_baseball_market.ts):
//                우리 모델은 물론 북메이커 배당을 그대로 써도 333/1,705경기에서
//                "1" 픽이 단 0건이다.
//
// 결과: 단식으로는 실제 발생하는 "1"을 100% 놓친다. 적중률 상한이 KBO 78.7% / MLB 73.4%로
// 묶인다(1 - P(1)). 그래서 조합에서 "1"을 덮는 건 리스크 취향이 아니라 상품 구조상 필수다.
import type { Seung1PaeOutcome } from "./types";
import type { Seung1PaePrediction } from "./prediction";

export const UNIT_PRICE_WON = 1000;
export const PERSONAL_LIMIT_WON = 100_000;
export const DEFAULT_BUDGET_TIERS = [5_000, 10_000, 30_000, 50_000, 100_000];

export interface BaseballComboMatch {
  seq: number;
  league: string;
  home: string;
  away: string;
  prediction: Seung1PaePrediction;
}

export interface BaseballMatchPick {
  seq: number;
  league: string;
  home: string;
  away: string;
  picks: Seung1PaeOutcome[]; // 확률 내림차순 1~3개
  confidenceGap: number;
  /** 이 경기에서 "1"이 강제로 포함됐는가. 화면에서 근거를 밝히기 위해 남긴다 */
  oneForced: boolean;
}

export interface BaseballBetPlan {
  budgetWon: number;
  unitPriceWon: number;
  totalCombinations: number;
  totalCostWon: number;
  /** 조합이 실제로 "1"을 덮은 경기 수 */
  oneCoveredCount: number;
  picks: BaseballMatchPick[];
}

export interface BaseballBetOptions {
  /**
   * "1"을 강제로 덮을 경기 수. "auto"면 기대 커버리지가 최대가 되도록 예산 안에서 고른다.
   *
   * 축구에서는 이 값을 실측 무승부 빈도(중앙값 4)로 정했다. 야구는 그럴 필요가 없다 -
   * P(1)이 리그 상수에 가까워서 어느 경기든 "1"이 나올 확률이 비슷하기 때문이다.
   * 그래서 '어느 경기를 덮을까'가 아니라 '몇 개나 덮을 수 있나'만 남고, 답은 예산이 정한다.
   */
  guaranteeOneCount?: number | "auto";
}

function toPick(m: BaseballComboMatch, factor: number, oneForced: boolean): BaseballMatchPick {
  return {
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    picks: m.prediction.rankedPicks.slice(0, factor),
    confidenceGap: m.prediction.confidenceGap,
    oneForced,
  };
}

export function generateBaseballBet(
  matches: BaseballComboMatch[],
  budgetWon: number,
  unitPriceWon: number = UNIT_PRICE_WON,
  options: BaseballBetOptions = {},
): BaseballBetPlan {
  const maxCombos = Math.floor(Math.min(budgetWon, PERSONAL_LIMIT_WON) / unitPriceWon);
  const factors = matches.map(() => 1);
  const forced = matches.map(() => false);
  let total = 1;

  if (maxCombos < 1 || matches.length === 0) {
    return {
      budgetWon,
      unitPriceWon,
      totalCombinations: 0,
      totalCostWon: 0,
      oneCoveredCount: 0,
      picks: matches.map((m) => toPick(m, 1, false)),
    };
  }

  // 확신도가 낮은 경기부터 넓힌다. 픽이 뒤집힐 가능성이 큰 쪽에 예산을 쓰는 게 낫다.
  const byConfidenceAsc = [...matches.keys()].sort(
    (a, b) => matches[a].prediction.confidenceGap - matches[b].prediction.confidenceGap,
  );

  // "1"을 덮는 데 몇 픽이 필요한지는 경기마다 다르다. 처음엔 '항상 2위'라고 적었는데
  // 실측으로 틀렸다. P(1)이 상수라서 양팀 전력이 비슷할수록 승/패가 둘 다 "1"보다 커지고,
  // 그러면 "1"이 최하위가 되어 삼복식(3픽)이라야 덮인다.
  //   "1"이 2위가 되는 경계  KBO |eloDiff+HA| > 146점 / MLB > 78점
  //   실제 경기에서의 비율    KBO 0.1%만 2위(중앙 |eloDiff| 27, 최대 148)
  //                          MLB 16.7%가 2위(중앙 33, 최대 216)
  // 즉 대부분의 경기에서 "1"을 덮으려면 한 경기당 조합수가 3배가 된다. 아래 예산 검사가
  // 이걸 그대로 반영하므로, 10만원(100구좌)이라도 4경기까지밖에 못 덮는다(3^4=81).
  const onePos = (i: number) => matches[i].prediction.rankedPicks.indexOf("1");

  const want = options.guaranteeOneCount === "auto"
    ? matches.length // 예산이 허락하는 만큼 최대한. 아래 예산 검사가 실제 한도를 정한다
    : options.guaranteeOneCount ?? 0;

  let covered = 0;
  if (want > 0) {
    for (const i of byConfidenceAsc) {
      if (covered >= want) break;
      const need = onePos(i) + 1; // "1"을 포함하려면 이만큼의 픽이 필요하다
      if (need <= factors[i]) { covered++; continue; }
      const newTotal = (total / factors[i]) * need;
      // 예산을 넘는 경기는 조용히 건너뛴다. 앞쪽(확신도 낮은 쪽)부터 채워진다.
      if (newTotal <= maxCombos) {
        total = newTotal;
        factors[i] = need;
        forced[i] = true;
        covered++;
      }
    }
  }

  // 남은 예산으로 단식->복식->삼복식 순으로 넓힌다.
  for (;;) {
    const c1 = byConfidenceAsc.find((i) => factors[i] === 1);
    const c2 = byConfidenceAsc.find((i) => factors[i] === 2);
    if (c1 !== undefined && total * 2 <= maxCombos) {
      factors[c1] = 2;
      total *= 2;
      continue;
    }
    if (c2 !== undefined && total * 1.5 <= maxCombos) {
      factors[c2] = 3;
      total = Math.round(total * 1.5);
      continue;
    }
    break;
  }

  const picks = matches.map((m, i) => toPick(m, factors[i], forced[i]));
  return {
    budgetWon,
    unitPriceWon,
    totalCombinations: total,
    totalCostWon: total * unitPriceWon,
    oneCoveredCount: picks.filter((p) => p.picks.includes("1")).length,
    picks,
  };
}

export function generateBaseballBetTiers(
  matches: BaseballComboMatch[],
  tiers: number[] = DEFAULT_BUDGET_TIERS,
  unitPriceWon: number = UNIT_PRICE_WON,
  options: BaseballBetOptions = {},
): BaseballBetPlan[] {
  return tiers.map((t) => generateBaseballBet(matches, t, unitPriceWon, options));
}
