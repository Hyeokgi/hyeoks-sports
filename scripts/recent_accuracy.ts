// 최근 정산 회차의 적중률을 쪼개 본다: "왜 최근 적중률이 낮은가"에 답하기 위한 진단.
//
// 한 숫자(회차 적중률)만 보면 원인을 가를 수 없다. 같은 경기에서 여러 기준을 나란히 센다.
//   모델 1픽   : 앱이 실제로 낸 픽(서버 prediction)
//   배당 1위   : 그 경기 해외배당 암시확률 1위(배당이 있는 경기만)
//   투표 1위   : betman 대중 투표 1위(투표율이 있는 경기만)
//   항상 홈승  : 아무 분석 없는 기준선
// 그리고 배당이 있었는지, 실제 무승부가 몇 개였는지, 확신도 등급별로 얼마나 맞았는지를 같이 본다.
// 사후 등록 경기(predictedAfterKickoff)는 예측이 아니므로 뺀다.
//
// 실행(러너): npx tsx scripts/recent_accuracy.ts  → seed/recent_accuracy.json
import { writeFileSync } from "node:fs";

const BASE = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const LABEL: Record<string, string> = { H: "홈승", D: "무승부", A: "원정승" };

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function argmaxLabel(h: number, d: number, a: number): string {
  return h >= d && h >= a ? "홈승" : d >= a ? "무승부" : "원정승";
}

interface Tally {
  n: number;
  model: number;
  withOdds: number;
  market: number;
  modelOnOdds: number;
  withVote: number;
  vote: number;
  modelOnVote: number;
  home: number;
  draws: number;
  modelDrawPicks: number;
}
const empty = (): Tally => ({
  n: 0, model: 0, withOdds: 0, market: 0, modelOnOdds: 0, withVote: 0, vote: 0, modelOnVote: 0, home: 0, draws: 0, modelDrawPicks: 0,
});
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");

async function main() {
  const { rounds } = await getJson(`${BASE}/api/rounds`);
  const perRound: any[] = [];
  const all = empty();
  const byLeague = new Map<string, Tally>();
  const byTier = new Map<string, { n: number; hit: number }>();
  const byBasis = new Map<string, { n: number; hit: number }>();

  for (const r of [...rounds].reverse()) {
    const detail = await getJson(`${BASE}/api/rounds/${r.id}`);
    const t = empty();
    let late = 0;
    for (const m of detail.matches ?? []) {
      if (!m.result) continue;
      if (m.predictedAfterKickoff) {
        late++;
        continue;
      }
      const actual = LABEL[m.result.actual];
      const pick = m.prediction.rankedPicks[0];
      const hit = pick === actual;
      const lt = byLeague.get(m.league) ?? empty();
      for (const x of [t, all, lt]) {
        x.n++;
        if (hit) x.model++;
        if (actual === "홈승") x.home++;
        if (actual === "무승부") x.draws++;
        if (pick === "무승부") x.modelDrawPicks++;
        const mk = m.raw?.market;
        if (mk) {
          x.withOdds++;
          if (argmaxLabel(mk.pHome, mk.pDraw, mk.pAway) === actual) x.market++;
          if (hit) x.modelOnOdds++;
        }
        const v = m.voteShare;
        if (v) {
          x.withVote++;
          if (argmaxLabel(v.home, v.draw, v.away) === actual) x.vote++;
          if (hit) x.modelOnVote++;
        }
      }
      byLeague.set(m.league, lt);
      const tier = m.prediction.basis === "model" ? m.calibration?.tier ?? "?" : `(${m.prediction.basis})`;
      const bt = byTier.get(tier) ?? { n: 0, hit: 0 };
      bt.n++;
      if (hit) bt.hit++;
      byTier.set(tier, bt);
      const bb = byBasis.get(m.prediction.basis) ?? { n: 0, hit: 0 };
      bb.n++;
      if (hit) bb.hit++;
      byBasis.set(m.prediction.basis, bb);
    }
    if (t.n === 0 && late === 0) continue;
    perRound.push({ roundNo: r.round_no, status: r.status, ...t, late });
    console.log(
      `${String(r.round_no).padStart(3)}회차 정산 ${String(t.n).padStart(2)}경기` +
        `  모델 ${pct(t.model, t.n).padStart(6)}` +
        `  | 배당있음 ${String(t.withOdds).padStart(2)}: 모델 ${pct(t.modelOnOdds, t.withOdds).padStart(6)} vs 배당1위 ${pct(t.market, t.withOdds).padStart(6)}` +
        `  | 투표있음 ${String(t.withVote).padStart(2)}: 모델 ${pct(t.modelOnVote, t.withVote).padStart(6)} vs 투표1위 ${pct(t.vote, t.withVote).padStart(6)}` +
        `  | 홈승 ${pct(t.home, t.n).padStart(6)}  실제무 ${t.draws}  모델무픽 ${t.modelDrawPicks}` +
        (late ? `  (사후등록 ${late} 제외)` : ""),
    );
  }

  console.log(
    `\n전체 ${all.n}경기: 모델 ${pct(all.model, all.n)} | 배당있는 ${all.withOdds}경기 모델 ${pct(all.modelOnOdds, all.withOdds)} vs 배당1위 ${pct(all.market, all.withOdds)}` +
      ` | 투표있는 ${all.withVote}경기 모델 ${pct(all.modelOnVote, all.withVote)} vs 투표1위 ${pct(all.vote, all.withVote)}` +
      ` | 항상홈승 ${pct(all.home, all.n)} | 실제 무승부 ${pct(all.draws, all.n)} (모델 무승부픽 ${all.modelDrawPicks})`,
  );
  console.log("\n리그별:");
  for (const [lg, t] of [...byLeague].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${lg.padEnd(8)} ${String(t.n).padStart(3)}경기  모델 ${pct(t.model, t.n).padStart(6)}  배당1위 ${pct(t.market, t.withOdds).padStart(6)}(${t.withOdds})  투표1위 ${pct(t.vote, t.withVote).padStart(6)}(${t.withVote})  실제무 ${pct(t.draws, t.n)}`,
    );
  }
  console.log("\n확신도 등급별(모델 경기) / 근거별:");
  for (const [k, v] of byTier) console.log(`  ${k.padEnd(8)} ${String(v.n).padStart(3)}경기 적중 ${pct(v.hit, v.n)}`);
  for (const [k, v] of byBasis) console.log(`  basis=${k.padEnd(8)} ${String(v.n).padStart(3)}경기 적중 ${pct(v.hit, v.n)}`);

  writeFileSync(
    "seed/recent_accuracy.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        perRound,
        all,
        byLeague: Object.fromEntries(byLeague),
        byTier: Object.fromEntries(byTier),
        byBasis: Object.fromEntries(byBasis),
      },
      null,
      1,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
