// 회차별 실전 정산 기록: 기본 모델픽과 독식픽이 실제로 얼마나 맞았는지, 그리고 실제 당첨조합이
// 얼마나 희소했는지를 집계한다.
//
// 이 파일의 존재 이유: 백테스트(scripts/backtest_exclusive.ts)는 과거 투표율로 "가설이 성립하는가"를
// 보지만, 그건 우리 모델이 없던 시절 데이터다. 실제로 우리가 낸 픽이 실전에서 어땠는지는 정산된
// 회차를 그대로 세는 수밖에 없다 - 상용화 여부를 판단할 유일한 근거이므로 과장 없이 그대로 센다.
import { generateExclusivePick, type ExclusiveMatchInput } from "./exclusivePick";
import type { MatchPrediction } from "./prediction";

export type ActualCode = "H" | "D" | "A";
const LABEL: Record<ActualCode, "홈승" | "무승부" | "원정승"> = { H: "홈승", D: "무승부", A: "원정승" };

// 투표율 0%에 나누기 폭주를 막는 하한 - exclusivePick.ts VOTE_FLOOR와 같은 값이어야 한다.
const VOTE_FLOOR = 0.005;

export interface SettlementMatchInput {
  seq: number;
  league: string;
  home: string;
  away: string;
  prediction: MatchPrediction;
  voteShare: { home: number; draw: number; away: number } | null;
  actual: ActualCode | null; // 미정산 경기는 null
}

export interface RoundSettlement {
  roundId: number;
  roundNo: number | null;
  settledMatches: number;
  totalMatches: number;
  basePickHits: number; // 모델 1픽 적중 수
  exclusivePickHits: number; // 독식픽 적중 수
  upsetCount: number;
  drawsActual: number; // 실제 무승부 경기 수
  // 대중 구매비중 추정(∏투표율). 전 경기 투표율이 있어야 계산되며 없으면 null.
  actualCrowdShare: number | null; // 실제 당첨조합이 얼마나 희소했나
  exclusiveCrowdShare: number | null; // 우리 독식픽이 얼마나 희소했나
  baseCrowdShare: number | null; // 기본 모델픽 조합의 희소성
}

export function computeRoundSettlement(
  roundId: number,
  roundNo: number | null,
  matches: SettlementMatchInput[],
  options?: { maxUpsets?: number; forceDrawCount?: number },
): RoundSettlement {
  const settled = matches.filter((m) => m.actual != null);

  const inputs: ExclusiveMatchInput[] = matches.map((m) => ({
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    prediction: m.prediction,
    voteShare: m.voteShare,
  }));
  const exclusive = generateExclusivePick(inputs, options ?? {});

  let basePickHits = 0;
  let exclusivePickHits = 0;
  let drawsActual = 0;
  for (const m of matches) {
    if (m.actual == null) continue;
    const actualLabel = LABEL[m.actual];
    if (m.prediction.rankedPicks[0] === actualLabel) basePickHits++;
    const pick = exclusive.picks.find((p) => p.seq === m.seq);
    if (pick && pick.pick === actualLabel) exclusivePickHits++;
    if (m.actual === "D") drawsActual++;
  }

  // 실제 당첨조합의 대중 구매비중 - 한 경기라도 투표율/결과가 없으면 회차 전체가 null(부분 곱은 무의미)
  let actualCrowdShare: number | null = 1;
  for (const m of matches) {
    if (m.actual == null || m.voteShare == null) {
      actualCrowdShare = null;
      break;
    }
    const pct = m.actual === "H" ? m.voteShare.home : m.actual === "D" ? m.voteShare.draw : m.voteShare.away;
    actualCrowdShare *= Math.max(pct / 100, VOTE_FLOOR);
  }

  return {
    roundId,
    roundNo,
    settledMatches: settled.length,
    totalMatches: matches.length,
    basePickHits,
    exclusivePickHits,
    upsetCount: exclusive.upsetCount + exclusive.forcedDrawCount,
    drawsActual,
    actualCrowdShare,
    exclusiveCrowdShare: exclusive.pickCrowdShare,
    baseCrowdShare: exclusive.baseCrowdShare,
  };
}

export interface SettlementSummary {
  rounds: number;
  settledMatches: number;
  basePickHits: number;
  exclusivePickHits: number;
  basePickAccuracy: number;
  exclusivePickAccuracy: number;
  drawsActual: number;
  drawRate: number;
  // 대중비중은 회차별 값이라 산술평균 대신 중앙값을 쓴다(회차 간 편차가 수십~수백 배).
  medianActualCrowdShare: number | null;
  medianExclusiveCrowdShare: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function summarize(rounds: RoundSettlement[]): SettlementSummary {
  const withData = rounds.filter((r) => r.settledMatches > 0);
  const settledMatches = withData.reduce((s, r) => s + r.settledMatches, 0);
  const basePickHits = withData.reduce((s, r) => s + r.basePickHits, 0);
  const exclusivePickHits = withData.reduce((s, r) => s + r.exclusivePickHits, 0);
  const drawsActual = withData.reduce((s, r) => s + r.drawsActual, 0);
  return {
    rounds: withData.length,
    settledMatches,
    basePickHits,
    exclusivePickHits,
    basePickAccuracy: settledMatches > 0 ? basePickHits / settledMatches : 0,
    exclusivePickAccuracy: settledMatches > 0 ? exclusivePickHits / settledMatches : 0,
    drawsActual,
    drawRate: settledMatches > 0 ? drawsActual / settledMatches : 0,
    medianActualCrowdShare: median(withData.map((r) => r.actualCrowdShare).filter((x): x is number => x != null)),
    medianExclusiveCrowdShare: median(withData.map((r) => r.exclusiveCrowdShare).filter((x): x is number => x != null)),
  };
}
