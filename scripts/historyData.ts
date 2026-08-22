// 1~41회차 실측 데이터(투표율+실제결과) 로딩 및 투표율 편향보정 - 백테스트/튜닝 스크립트 공용.
// backtest_exclusive.ts와 tune_exclusive.ts가 같은 전처리를 쓰도록 한 곳에 둔다(로직 중복 금지).
import { readFileSync } from "node:fs";
import type { MatchPrediction } from "../src/lib/prediction";

export type Outcome = "H" | "D" | "A";
export const LABEL: Record<Outcome, "홈승" | "무승부" | "원정승"> = { H: "홈승", D: "무승부", A: "원정승" };
const RESULT_OF: Record<string, Outcome> = { "승": "H", "무": "D", "패": "A" };

export interface Game {
  round: number; seq: string; home: string; away: string;
  actual: Outcome; v: Record<Outcome, number>;
}

// 14경기가 온전하고 투표율-결과 팀명이 교차확인되는 회차만 반환한다.
export function loadHistory(): Map<number, Game[]> {
  const rounds = JSON.parse(readFileSync("seed/history_rounds_1_41.json", "utf-8")) as any[];
  const votes = JSON.parse(readFileSync("seed/history_votes_1_41.json", "utf-8")) as Record<string, any>;
  const out = new Map<number, Game[]>();
  for (const r of rounds) {
    const m = /(\d+)회차/.exec(r.round);
    if (!m) continue;
    const no = Number(m[1]);
    const v = votes[String(no)];
    if (!v) continue;
    const bySeq = new Map<string, any>(v.matches.map((x: any) => [x.seq, x]));
    const games: Game[] = [];
    for (const g of r.matches) {
      const vm = bySeq.get(g.seq);
      if (!vm) continue;
      const actual = RESULT_OF[g.result];
      if (!actual) continue;
      if (vm.home !== g.home || vm.away !== g.away) continue; // seq 정렬 어긋남 방지
      games.push({
        round: no, seq: g.seq, home: g.home, away: g.away, actual,
        v: { H: vm.voteWin / 100, D: vm.voteDraw / 100, A: vm.voteLose / 100 },
      });
    }
    if (games.length === 14) out.set(no, games);
  }
  return out;
}

export const BINS: [number, number][] = [
  [0, 0.05], [0.05, 0.10], [0.10, 0.15], [0.15, 0.20], [0.20, 0.30],
  [0.30, 0.40], [0.40, 0.50], [0.50, 0.60], [0.60, 0.70], [0.70, 0.80], [0.80, 1.01],
];

// 투표율 -> 실측 발생률 보정곡선. exclude 회차는 적합에서 제외(leave-one-round-out).
export function fitCurve(all: Map<number, Game[]>, exclude: number): (p: number) => number {
  const stat = BINS.map(() => ({ n: 0, hit: 0 }));
  for (const [no, games] of all) {
    if (no === exclude) continue;
    for (const g of games) {
      for (const oc of ["H", "D", "A"] as Outcome[]) {
        const bi = BINS.findIndex(([lo, hi]) => g.v[oc] >= lo && g.v[oc] < hi);
        if (bi < 0) continue;
        stat[bi].n++;
        if (g.actual === oc) stat[bi].hit++;
      }
    }
  }
  return (p: number) => {
    const bi = BINS.findIndex(([lo, hi]) => p >= lo && p < hi);
    if (bi < 0 || stat[bi].n < 20) return p; // 표본 부족 구간은 보정하지 않음
    return stat[bi].hit / stat[bi].n;
  };
}

// 보정된 투표율을 모델확률 자리에 넣는다. 이 시기엔 우리 모델이 없었으므로(회고 재구성분 63건뿐)
// 이 백테스트가 검증하는 것은 Elo 모델 품질이 아니라 "독식 최적화 레이어" 자체다.
export function toPrediction(g: Game, corr: (p: number) => number): MatchPrediction {
  const raw = { H: corr(g.v.H), D: corr(g.v.D), A: corr(g.v.A) };
  const s = raw.H + raw.D + raw.A;
  const pHome = raw.H / s, pDraw = raw.D / s, pAway = raw.A / s;
  const ranked: [MatchPrediction["rankedPicks"][number], number][] = [
    ["홈승", pHome], ["무승부", pDraw], ["원정승", pAway],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return { pHome, pDraw, pAway, rankedPicks: ranked.map((r) => r[0]), confidenceGap: ranked[0][1] - ranked[1][1] };
}

// 실제 당첨조합의 대중 구매비중(∏투표율) - 우리 픽이 도달해야 할 목표 기준선
export function actualCrowdShares(all: Map<number, Game[]>): number[] {
  return [...all.values()].map((games) =>
    games.reduce((q, g) => q * Math.max(g.v[g.actual], 0.005), 1),
  ).sort((a, b) => a - b);
}
