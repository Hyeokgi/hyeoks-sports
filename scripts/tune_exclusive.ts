// 독식픽 기본값 튜닝 (npx tsx scripts/tune_exclusive.ts)
//
// 1~41회차 실측(투표율+결과)에 실제 exclusivePick 코드를 돌려 제약 파라미터를 스윕한다.
// 목적함수는 파리뮤추얼 기대값 지수 EV = P(적중확률) / Q(대중 구매비중) 이며, 회차별
// leave-one-round-out 보정으로 과적합을 막는다.
//
// 주의: EV는 "인기픽 대비 상대 배수"다. 환급률(약 50%대) 때문에 절대 기대값은 어떤 설정에서도
// 마이너스이며 이 튜닝이 그걸 뒤집지 못한다. 상대적으로 덜 나쁜 지점을 찾을 뿐이다.
import { generateExclusivePick, DEFAULT_EXCLUSIVE_OPTIONS, type ExclusiveMatchInput } from "../src/lib/exclusivePick";
import { loadHistory, fitCurve, toPrediction, actualCrowdShares, LABEL } from "./historyData";

const all = loadHistory();
const roundNos = [...all.keys()].sort((a, b) => a - b);
// 보정곡선은 회차마다 한 번만 적합해 재사용(스윕 조합마다 다시 적합하면 매우 느림)
const curves = new Map(roundNos.map((no) => [no, fitCurve(all, no)]));
const shares = actualCrowdShares(all);
const targetQ = shares[Math.floor(shares.length / 2)];

interface Params { maxUpsets: number; minProbRetention: number; minAltProb: number; minValueGain: number; forceDrawCount?: number }
interface Result { hits: number; P: number; Q: number; EV: number; medQ: number }

function evaluate(p: Params): Result {
  let hits = 0, pSum = 0, qSum = 0, evSum = 0;
  const qs: number[] = [];
  for (const no of roundNos) {
    const games = all.get(no)!;
    const corr = curves.get(no)!;
    const inputs: ExclusiveMatchInput[] = games.map((g, i) => ({
      seq: i + 1, league: "-", home: g.home, away: g.away,
      prediction: toPrediction(g, corr),
      voteShare: { home: g.v.H * 100, draw: g.v.D * 100, away: g.v.A * 100 },
    }));
    const r = generateExclusivePick(inputs, p);
    hits += r.picks.filter((pk, i) => pk.pick === LABEL[games[i].actual]).length;
    pSum += r.pickHitProb; qSum += r.pickCrowdShare!;
    evSum += r.pickHitProb / r.pickCrowdShare!;
    qs.push(r.pickCrowdShare!);
  }
  const n = roundNos.length;
  qs.sort((a, b) => a - b);
  return { hits: hits / n, P: pSum / n, Q: qSum / n, EV: evSum / n, medQ: qs[Math.floor(qs.length / 2)] };
}

const D = DEFAULT_EXCLUSIVE_OPTIONS;
const baseline = evaluate({ maxUpsets: D.maxUpsets, minProbRetention: D.minProbRetention, minAltProb: D.minAltProb, minValueGain: D.minValueGain });

function line(label: string, r: Result) {
  console.log(
    `${label.padEnd(22)} 적중 ${r.hits.toFixed(2).padStart(5)}/14  1/${(1 / r.P).toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(10)}  Q중앙 ${(r.medQ * 1e6).toFixed(3).padStart(9)}/백만  EV ${(r.EV / baseline.EV).toFixed(1).padStart(6)}배`,
  );
}

console.log(`분석: ${roundNos.length}개 회차 / 실제 당첨조합 대중비중 중앙값 = ${(targetQ * 1e6).toFixed(3)}/백만\n`);
console.log("=== 현재 기본값 ===");
line(`기본(이변${D.maxUpsets},유지${D.minProbRetention})`, baseline);

console.log("\n=== A) minProbRetention 스윕 (이변 상한 6으로 풀고 이 제약만 변화) ===");
for (const mr of [0.5, 0.35, 0.25, 0.2, 0.15, 0.1, 0.05, 0.02]) {
  line(`유지율하한 ${mr}`, evaluate({ maxUpsets: 6, minProbRetention: mr, minAltProb: D.minAltProb, minValueGain: D.minValueGain }));
}

console.log("\n=== B) minAltProb 스윕 (유지율하한 0.10 고정) ===");
for (const ma of [0.25, 0.2, 0.15, 0.12, 0.1]) {
  line(`대안확률하한 ${ma}`, evaluate({ maxUpsets: 6, minProbRetention: 0.1, minAltProb: ma, minValueGain: D.minValueGain }));
}

console.log("\n=== C) minValueGain 스윕 (유지율하한 0.10, 대안확률하한 0.15 고정) ===");
for (const mg of [2.0, 1.5, 1.3, 1.2, 1.1]) {
  line(`가치이득하한 ${mg}`, evaluate({ maxUpsets: 6, minProbRetention: 0.1, minAltProb: 0.15, minValueGain: mg }));
}

console.log("\n=== D) 무승부 강제 병용 (유지율하한 0.10, 대안확률하한 0.15, 가치이득 1.2) ===");
for (const fd of [0, 1, 2, 3, 4]) {
  line(`무승부강제 ${fd}`, evaluate({ maxUpsets: 6, minProbRetention: 0.1, minAltProb: 0.15, minValueGain: 1.2, forceDrawCount: fd }));
}

console.log("\n=== E) 전체 그리드 상위 8 (EV 기준) ===");
const grid: { p: Params; r: Result }[] = [];
for (const mu of [3, 4, 5, 6])
  for (const mr of [0.25, 0.15, 0.1, 0.05])
    for (const ma of [0.2, 0.15, 0.12])
      for (const mg of [1.5, 1.3, 1.2]) {
        const p = { maxUpsets: mu, minProbRetention: mr, minAltProb: ma, minValueGain: mg };
        grid.push({ p, r: evaluate(p) });
      }
grid.sort((a, b) => b.r.EV - a.r.EV);
for (const { p, r } of grid.slice(0, 8)) {
  line(`이변${p.maxUpsets}/유지${p.minProbRetention}/대안${p.minAltProb}/이득${p.minValueGain}`, r);
}

console.log("\n=== F) 후보 기본값 확정 비교 ===");
const candidates: { label: string; p: Params }[] = [
  { label: "현행", p: { maxUpsets: 3, minProbRetention: 0.35, minAltProb: 0.2, minValueGain: 1.3 } },
  { label: "보수(유지0.25)", p: { maxUpsets: 5, minProbRetention: 0.25, minAltProb: 0.15, minValueGain: 1.5 } },
  { label: "제안(유지0.15)", p: { maxUpsets: 5, minProbRetention: 0.15, minAltProb: 0.15, minValueGain: 1.5 } },
  { label: "공격(유지0.10)", p: { maxUpsets: 5, minProbRetention: 0.10, minAltProb: 0.15, minValueGain: 1.5 } },
  { label: "극단(유지0.05)", p: { maxUpsets: 6, minProbRetention: 0.05, minAltProb: 0.15, minValueGain: 1.5 } },
];
for (const c of candidates) {
  const r = evaluate(c.p);
  console.log(
    `${c.label.padEnd(16)} 적중 ${r.hits.toFixed(2)}/14  1/${(1 / r.P).toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(9)}  Q중앙 ${(r.medQ * 1e6).toFixed(3).padStart(8)}/백만 (실제당첨 대비 ${(r.medQ / targetQ).toFixed(1)}배 혼잡)  EV ${(r.EV / baseline.EV).toFixed(1).padStart(5)}배`,
  );
}
