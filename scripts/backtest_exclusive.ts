// 독식 지향 픽의 소급 검증 (npx tsx scripts/backtest_exclusive.ts)
//
// 1~41회차의 betman 실측 투표율 + 실제결과(seed/history_*.json, hyeoks-sports-engine에서 이관)로
// "대중이 덜 산 자리로 뒤집으면 당첨 시 독식 가능성이 오르는가"를 실제 배포 코드
// (src/lib/exclusivePick.ts)로 검증한다. 재구현이 아니라 shipping 코드를 그대로 호출한다.
//
// 모델확률 대체재: 이 시기엔 우리 모델이 없었으므로(회고 재구성분은 63건뿐), 투표율을
// "구간별 실측 발생률"로 편향보정한 값을 모델확률 자리에 넣는다. 따라서 이 백테스트가 검증하는
// 것은 Elo 모델의 품질이 아니라 "독식 최적화 레이어" 자체다.
//
// 과적합 방지: 편향보정 곡선은 매 회차마다 "그 회차를 제외한 나머지 회차"로만 적합한다
// (leave-one-round-out). 같은 데이터로 보정하고 같은 데이터로 평가하면 수치가 부풀려진다.
import { readFileSync } from "node:fs";
import { generateExclusivePick, type ExclusiveMatchInput } from "../src/lib/exclusivePick";
import type { MatchPrediction } from "../src/lib/prediction";

type Outcome = "H" | "D" | "A";
const LABEL: Record<Outcome, "홈승" | "무승부" | "원정승"> = { H: "홈승", D: "무승부", A: "원정승" };
const RESULT_OF: Record<string, Outcome> = { "승": "H", "무": "D", "패": "A" };

interface Game { round: number; seq: string; home: string; away: string; actual: Outcome; v: Record<Outcome, number> }

function load(): Map<number, Game[]> {
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
      // 팀명 교차확인 - seq 정렬이 어긋난 회차를 조용히 섞지 않기 위한 안전장치
      if (vm.home !== g.home || vm.away !== g.away) continue;
      games.push({
        round: no, seq: g.seq, home: g.home, away: g.away, actual,
        v: { H: vm.voteWin / 100, D: vm.voteDraw / 100, A: vm.voteLose / 100 },
      });
    }
    if (games.length === 14) out.set(no, games);
  }
  return out;
}

// 투표율 -> 실측 발생률 보정곡선 (구간별). exclude 회차는 적합에서 제외(leave-one-round-out).
const BINS: [number, number][] = [
  [0, 0.05], [0.05, 0.10], [0.10, 0.15], [0.15, 0.20], [0.20, 0.30],
  [0.30, 0.40], [0.40, 0.50], [0.50, 0.60], [0.60, 0.70], [0.70, 0.80], [0.80, 1.01],
];
function fitCurve(all: Map<number, Game[]>, exclude: number) {
  const stat = BINS.map(() => ({ n: 0, hit: 0 }));
  for (const [no, games] of all) {
    if (no === exclude) continue;
    for (const g of games) {
      for (const oc of ["H", "D", "A"] as Outcome[]) {
        const p = g.v[oc];
        const bi = BINS.findIndex(([lo, hi]) => p >= lo && p < hi);
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

function toPrediction(g: Game, corr: (p: number) => number): MatchPrediction {
  const raw = { H: corr(g.v.H), D: corr(g.v.D), A: corr(g.v.A) };
  const s = raw.H + raw.D + raw.A;
  const pHome = raw.H / s, pDraw = raw.D / s, pAway = raw.A / s;
  const ranked: [MatchPrediction["rankedPicks"][number], number][] = [
    ["홈승", pHome], ["무승부", pDraw], ["원정승", pAway],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return { pHome, pDraw, pAway, rankedPicks: ranked.map((r) => r[0]), confidenceGap: ranked[0][1] - ranked[1][1] };
}

function main() {
  const all = load();
  const rounds = [...all.keys()].sort((a, b) => a - b);
  console.log(`분석 대상: ${rounds.length}개 회차 (14경기 완전 + 투표율/결과 교차확인 통과)\n`);

  // --- 1) 투표율 편향(favorite-longshot bias) ---
  console.log("=== 1) betman 투표율 편향 : 투표율 구간별 실제 발생률 ===");
  console.log("투표율구간      n    실제발생률   편향(실제-투표)");
  const stat = BINS.map(() => ({ n: 0, hit: 0, vsum: 0 }));
  for (const games of all.values())
    for (const g of games)
      for (const oc of ["H", "D", "A"] as Outcome[]) {
        const bi = BINS.findIndex(([lo, hi]) => g.v[oc] >= lo && g.v[oc] < hi);
        if (bi < 0) continue;
        stat[bi].n++; stat[bi].vsum += g.v[oc];
        if (g.actual === oc) stat[bi].hit++;
      }
  BINS.forEach(([lo, hi], i) => {
    const s = stat[i];
    if (s.n < 20) return;
    const act = s.hit / s.n, avg = s.vsum / s.n;
    console.log(`${(lo * 100).toFixed(0).padStart(3)}~${(hi * 100).toFixed(0).padStart(3)}%  ${String(s.n).padStart(5)}   ${(act * 100).toFixed(1).padStart(5)}%    ${((act - avg) * 100 >= 0 ? "+" : "")}${((act - avg) * 100).toFixed(1)}%p`);
  });

  // --- 2) 실제 당첨조합의 희소성 (목표 기준선) ---
  const shares = rounds.map((no) => {
    let q = 1;
    for (const g of all.get(no)!) q *= Math.max(g.v[g.actual], 0.005);
    return q;
  }).sort((a, b) => a - b);
  const med = shares[Math.floor(shares.length / 2)];
  console.log("\n=== 2) 실제 당첨조합은 얼마나 희소했나 (대중 구매비중 추정, 독립 근사) ===");
  console.log(`  최소 ${(shares[0] * 1e6).toFixed(3)} / 25% ${(shares[Math.floor(shares.length / 4)] * 1e6).toFixed(3)} / 중앙값 ${(med * 1e6).toFixed(3)} / 75% ${(shares[Math.floor(shares.length * 3 / 4)] * 1e6).toFixed(3)} / 최대 ${(shares[shares.length - 1] * 1e6).toFixed(1)}  (단위: /백만)`);

  // --- 3) 이변 개수별 성적 (실제 exclusivePick 호출, leave-one-round-out) ---
  console.log("\n=== 3) 이변 개수별 성적 (실제 exclusivePick 코드, leave-one-round-out 보정) ===");
  console.log("이변수  평균적중   P(14전탄)      Q(대중비중/백만)   EV지수  당첨조합 희소성 도달률");
  let baseEV = 0;
  for (let k = 0; k <= 5; k++) {
    let hits = 0, pSum = 0, qSum = 0, evSum = 0, reach = 0;
    for (const no of rounds) {
      const games = all.get(no)!;
      const corr = fitCurve(all, no); // 이 회차를 뺀 나머지로만 보정곡선 적합
      const inputs: ExclusiveMatchInput[] = games.map((g, i) => ({
        seq: i + 1, league: "-", home: g.home, away: g.away,
        prediction: toPrediction(g, corr),
        voteShare: { home: g.v.H * 100, draw: g.v.D * 100, away: g.v.A * 100 },
      }));
      const r = generateExclusivePick(inputs, { maxUpsets: k });
      hits += r.picks.filter((p, i) => p.pick === LABEL[games[i].actual]).length;
      pSum += r.pickHitProb; qSum += r.pickCrowdShare!;
      evSum += r.pickHitProb / r.pickCrowdShare!;
      if (r.pickCrowdShare! <= med) reach++; // 실제 당첨조합 중앙값만큼 희소해졌는가
    }
    const n = rounds.length;
    const ev = evSum / n;
    if (k === 0) baseEV = ev;
    console.log(
      `  ${k}    ${(hits / n).toFixed(2).padStart(5)}/14  1/${(1 / (pSum / n)).toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(9)}   ${((qSum / n) * 1e6).toFixed(2).padStart(8)}      ${(ev / baseEV).toFixed(1).padStart(5)}배   ${((reach / n) * 100).toFixed(0).padStart(3)}%`,
    );
  }

  console.log(`
[해석 주의]
- EV지수는 "인기픽 대비 상대 배수"다. 승무패 환급률(약 50%대) 때문에 절대 기대값은 어떤 설정에서도
  마이너스이며, 이 백테스트는 그것을 뒤집지 못한다. 상대 우위만 보여준다.
- Q(대중 구매비중)는 경기별 투표율의 곱, 즉 구매자들이 독립적으로 찍는다는 가정이다. 실제로는
  인기 조합에 구매가 몰리므로 인기픽의 실제 경쟁률은 이 추정보다 높고, 상대 우위는 과소평가일 수 있다.
- 반대로 P(모델확률)는 투표율 보정값이라 실제 우리 Elo 모델의 성능과는 다르다.`);
}

main();
