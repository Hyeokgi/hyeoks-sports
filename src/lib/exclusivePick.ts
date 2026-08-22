// 독식(단독 당첨) 지향 픽 생성기.
//
// 승무패 토토는 파리뮤추얼이라 당첨금이 "당첨 조합을 산 사람 수"에 반비례한다.
// 경기별 픽이 독립이라고 근사하면 어떤 14픽 조합 c의 기대 배당가치는
//   EV(c) ∝ P(c) / Q(c) = ∏(모델확률_i / 투표율_i)
// (P=모델이 본 적중확률, Q=betman 투표율로 추정한 대중의 동일조합 구매비중).
// 순수 EV 최대화는 극단적 역배당 조합으로 폭주하므로, 여기서는 "모델 1픽(확률 최대) 조합"을
// 기준으로 삼고, 적중확률 손실이 작으면서 대중이 상대적으로 덜 찍은 결과로만 제한적으로
// 뒤집는다(이변 반영). 손실 하한(minProbRetention)과 뒤집기 개수(maxUpsets)로 폭주를 막는다.
//
// 정직성 원칙(이 저장소 공통): 이 픽은 "당첨됐을 때 나눠 갖는 사람을 줄이는" 최적화이지
// 당첨확률 자체를 높이는 게 아니다. 모델 top-pick 경기당 적중률은 실측 43~48% 수준이라
// 14경기 전부 적중 확률은 어떤 조합이든 극히 낮다 - UI/로그에서 항상 이 사실을 병기한다.
// 메인 모델픽(prediction.rankedPicks)은 절대 덮어쓰지 않고 별도 결과로만 제공한다.
import type { MatchPrediction } from "./prediction";

export type Outcome = "홈승" | "무승부" | "원정승";

// betman 투표율이 0%로 찍힌 결과에 나누기 폭주를 막는 하한(0.5%). 실제로 0%면 그 결과는
// 산 사람이 거의 없다는 뜻이라 가치비가 매우 커지는 게 맞지만, 스냅샷 노이즈일 수도 있어 캡을 둔다.
const VOTE_FLOOR = 0.005;

export interface ExclusiveMatchInput {
  seq: number;
  league: string;
  home: string;
  away: string;
  prediction: MatchPrediction;
  // betman 투표(매수)율 %, 미수집이면 null - null인 경기는 가치비 신호가 없어 절대 뒤집지 않는다.
  voteShare: { home: number; draw: number; away: number } | null;
}

export interface ExclusivePickOptions {
  // 이변(뒤집기) 허용 경기 수 상한
  maxUpsets?: number;
  // P(독식픽) / P(기본픽) 하한 - 이 비율 밑으로 적중확률을 깎는 뒤집기는 하지 않는다
  minProbRetention?: number;
  // 뒤집을 대상 결과의 최소 모델확률 - 이보다 낮은 확률의 결과로는 뒤집지 않는다(장거리 역배당 차단)
  minAltProb?: number;
  // (대안 가치비)/(기본픽 가치비) 최소 배수 - 이 배수 이상 유리할 때만 뒤집는다
  minValueGain?: number;
}

export const DEFAULT_EXCLUSIVE_OPTIONS: Required<ExclusivePickOptions> = {
  maxUpsets: 3,
  minProbRetention: 0.35,
  minAltProb: 0.2,
  minValueGain: 1.3,
};

export interface ExclusiveMatchPick {
  seq: number;
  league: string;
  home: string;
  away: string;
  pick: Outcome;
  basePick: Outcome; // 모델 1픽(항상 병기 - 메인픽을 덮어쓰지 않는다는 원칙의 표현)
  isUpset: boolean; // basePick과 다른 결과로 뒤집었는가
  modelProb: number; // pick의 모델확률
  votePct: number | null; // pick의 betman 투표율(%), 미수집이면 null
  valueRatio: number | null; // 모델확률/투표율(투표율 없으면 null) - 1보다 크면 대중이 저평가
  note: string;
}

export interface ExclusivePickResult {
  picks: ExclusiveMatchPick[];
  upsetCount: number;
  matchesWithVote: number; // 투표율이 있는 경기 수(없으면 기본픽과 동일해짐)
  // 모델 기준 적중확률(경기 독립 근사 곱). 둘 다 극히 작은 값이며 상대비교용이다.
  baseHitProb: number;
  pickHitProb: number;
  probRetention: number; // pickHitProb / baseHitProb
  // 투표율로 추정한 "대중이 이 조합을 살 비중"(∏투표율). 작을수록 당첨 시 독식 가능성↑.
  baseCrowdShare: number | null;
  pickCrowdShare: number | null;
  // (pickHitProb/pickCrowdShare) / (baseHitProb/baseCrowdShare) - 기본픽 대비 기대 배당가치 배수
  payoutEdge: number | null;
  note: string;
}

interface OutcomeView {
  outcome: Outcome;
  p: number;
  votePct: number | null;
  voteFrac: number | null; // VOTE_FLOOR 적용된 0~1 값
}

function outcomeViews(m: ExclusiveMatchInput): OutcomeView[] {
  const vs = m.voteShare;
  const mk = (outcome: Outcome, p: number, votePct: number | null): OutcomeView => ({
    outcome,
    p,
    votePct,
    voteFrac: votePct == null ? null : Math.max(votePct / 100, VOTE_FLOOR),
  });
  return [
    mk("홈승", m.prediction.pHome, vs ? vs.home : null),
    mk("무승부", m.prediction.pDraw, vs ? vs.draw : null),
    mk("원정승", m.prediction.pAway, vs ? vs.away : null),
  ];
}

export function generateExclusivePick(
  matches: ExclusiveMatchInput[],
  options: ExclusivePickOptions = {},
): ExclusivePickResult {
  const opts = { ...DEFAULT_EXCLUSIVE_OPTIONS, ...options };

  interface Candidate {
    idx: number;
    alt: OutcomeView;
    top: OutcomeView;
    valueGain: number; // (alt.p/alt.v) / (top.p/top.v)
    probCost: number; // top.p / alt.p (>1)
    score: number; // log(valueGain) / log(probCost) - 확률을 조금 깎아 가치를 많이 얻는 순
  }

  const views = matches.map(outcomeViews);
  const tops = matches.map((m, i) => views[i].find((v) => v.outcome === m.prediction.rankedPicks[0])!);

  const candidates: Candidate[] = [];
  matches.forEach((_m, i) => {
    const top = tops[i];
    if (top.voteFrac == null) return; // 투표율 없으면 신호 없음
    for (const alt of views[i]) {
      if (alt.outcome === top.outcome || alt.voteFrac == null) continue;
      if (alt.p < opts.minAltProb) continue;
      const valueGain = (alt.p / alt.voteFrac) / (top.p / top.voteFrac);
      if (valueGain < opts.minValueGain) continue;
      const probCost = top.p / alt.p;
      // probCost가 1 이하인 경우(확률 동률 수준)는 사실상 공짜 이득 - 점수를 크게 준다.
      const score = probCost <= 1 ? Number.POSITIVE_INFINITY : Math.log(valueGain) / Math.log(probCost);
      candidates.push({ idx: i, alt, top, valueGain, probCost, score });
    }
  });

  // 경기당 최고 후보 하나만 남기고, 점수 좋은 순으로 정렬
  const bestPerMatch = new Map<number, Candidate>();
  for (const c of candidates) {
    const cur = bestPerMatch.get(c.idx);
    if (!cur || c.score > cur.score) bestPerMatch.set(c.idx, c);
  }
  const sorted = [...bestPerMatch.values()].sort((a, b) => b.score - a.score);

  const chosen = new Map<number, Candidate>();
  let retention = 1;
  for (const c of sorted) {
    if (chosen.size >= opts.maxUpsets) break;
    const newRetention = retention / c.probCost;
    if (newRetention < opts.minProbRetention) continue;
    retention = newRetention;
    chosen.set(c.idx, c);
  }

  let baseHitProb = 1;
  let pickHitProb = 1;
  let baseCrowdShare: number | null = 1;
  let pickCrowdShare: number | null = 1;
  let matchesWithVote = 0;

  const picks: ExclusiveMatchPick[] = matches.map((m, i) => {
    const top = tops[i];
    const flip = chosen.get(i);
    const sel = flip ? flip.alt : top;
    if (top.voteFrac != null) matchesWithVote++;

    baseHitProb *= top.p;
    pickHitProb *= sel.p;
    // 투표율이 하나라도 없으면 조합 전체의 대중 구매비중 추정은 불가(null 전파)
    if (baseCrowdShare != null && top.voteFrac != null) baseCrowdShare *= top.voteFrac;
    else baseCrowdShare = null;
    if (pickCrowdShare != null && sel.voteFrac != null) pickCrowdShare *= sel.voteFrac;
    else pickCrowdShare = null;

    const valueRatio = sel.voteFrac != null ? sel.p / sel.voteFrac : null;
    const note = flip
      ? `이변픽: 모델 ${(sel.p * 100).toFixed(0)}% vs 투표 ${sel.votePct!.toFixed(1)}% (기본픽 대비 가치 ${flip.valueGain.toFixed(1)}배, 확률 ${(100 / flip.probCost - 100).toFixed(0)}%)`
      : sel.votePct != null
        ? `기본픽 유지: 모델 ${(sel.p * 100).toFixed(0)}% / 투표 ${sel.votePct.toFixed(1)}%`
        : "기본픽 유지: betman 투표율 미수집(신호 없음)";

    return {
      seq: m.seq,
      league: m.league,
      home: m.home,
      away: m.away,
      pick: sel.outcome,
      basePick: top.outcome,
      isUpset: Boolean(flip),
      modelProb: sel.p,
      votePct: sel.votePct,
      valueRatio,
      note,
    };
  });

  const payoutEdge =
    baseCrowdShare != null && pickCrowdShare != null && baseHitProb > 0 && baseCrowdShare > 0
      ? (pickHitProb / pickCrowdShare) / (baseHitProb / baseCrowdShare)
      : null;

  const upsetCount = chosen.size;
  const note =
    matchesWithVote === 0
      ? "betman 투표율이 아직 한 경기도 수집되지 않아 기본 모델픽과 동일합니다. 발매 시작 후 투표율이 쌓이면 다시 생성하세요."
      : `이변 ${upsetCount}경기 반영. 이 픽은 당첨확률을 높이는 게 아니라 "당첨됐을 때 나눠 갖는 사람"을 줄이는 최적화입니다(적중확률은 기본픽의 ${(retention * 100).toFixed(0)}% 수준). 14경기 전부 적중 확률 자체는 어떤 조합이든 극히 낮습니다.`;

  return {
    picks,
    upsetCount,
    matchesWithVote,
    baseHitProb,
    pickHitProb,
    probRetention: retention,
    baseCrowdShare,
    pickCrowdShare,
    payoutEdge,
    note,
  };
}
