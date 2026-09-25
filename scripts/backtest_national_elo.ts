// 국가대표 Elo가 현재 폴백(배당 없을 때 36/27/36 대칭)보다 나은지 검증한다.
// 저장소 채택 기준 그대로: 시간순 4분할(0.5/0.6/0.7/0.8), 확률 변환 계수는 학습 구간에서만
// 적합하고 테스트 구간에서만 평가, 4분할 모두에서 적중률·로그손실이 나빠지지 않아야 채택.
//
// Elo 자체는 경기 직전 레이팅만 쓰므로(computeNationalElo의 onBeforeMatch) 누수가 없다.
// 규칙 상수(K, 홈 +100)는 eloratings.net 공개 방식 그대로이고 튜닝하지 않았다.
//
// 실행: npx tsx scripts/backtest_national_elo.ts  → seed/national_elo_backtest.json
import { writeFileSync } from "node:fs";
import {
  NATIONAL_RESULTS_URL,
  NATIONAL_HOME_ADV,
  parseNationalResultsCsv,
  computeNationalElo,
  nationalProbs,
  fitOrderedLogit,
  type NationalResult,
} from "../src/lib/nationalElo";

const EVAL_FROM = "2010-01-01";
// 레이팅이 자리 잡기 전 팀(표본 적은 신생/소국)은 평가에서 뺀다 - 앱에서도 같은 조건을 건다.
const MIN_MATCHES = 20;
const SYM_DRAW = 0.27; // 현재 폴백: (1-d)/2, d, (1-d)/2

interface Sample {
  date: string;
  tournament: string;
  x: number; // (eloDiff + 홈어드밴티지)/400
  y: 0 | 1 | 2; // 0=원정 1=무 2=홈
}

function evalSet(samples: Sample[], probsOf: (s: Sample) => [number, number, number]) {
  let hit = 0;
  let ll = 0;
  for (const s of samples) {
    const p = probsOf(s); // [원정, 무, 홈]
    // 동률이면 홈 > 무 > 원정 순(앱 rank()가 홈승부터 정렬하는 것과 같음)
    const pick = p[2] >= p[1] && p[2] >= p[0] ? 2 : p[1] >= p[0] ? 1 : 0;
    if (pick === s.y) hit++;
    ll -= Math.log(Math.max(p[s.y], 1e-12));
  }
  return { n: samples.length, acc: hit / samples.length, logloss: ll / samples.length };
}

async function main() {
  const res = await fetch(NATIONAL_RESULTS_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`results.csv ${res.status}`);
  const results: NationalResult[] = parseNationalResultsCsv(await res.text());
  console.log(`전체 A매치 ${results.length}경기 (마지막 ${results.map((r) => r.date).sort().at(-1)})`);

  const samples: Sample[] = [];
  computeNationalElo(results, (r, he, ae, hn, an) => {
    if (r.date < EVAL_FROM) return;
    if (r.tournament === "Friendly") return; // 토토 회차는 공식전 위주
    if (hn < MIN_MATCHES || an < MIN_MATCHES) return;
    const dr = he - ae + (r.neutral ? 0 : NATIONAL_HOME_ADV);
    samples.push({ date: r.date, tournament: r.tournament, x: dr / 400, y: r.hg > r.ag ? 2 : r.hg === r.ag ? 1 : 0 });
  });
  samples.sort((a, b) => (a.date < b.date ? -1 : 1));
  console.log(`평가 표본(2010~ 공식전, 양팀 ${MIN_MATCHES}경기 이상): ${samples.length}`);

  const sym = (): [number, number, number] => [(1 - SYM_DRAW) / 2, SYM_DRAW, (1 - SYM_DRAW) / 2];

  const splits = [];
  let allPass = true;
  for (const f of [0.5, 0.6, 0.7, 0.8]) {
    const cut = Math.floor(samples.length * f);
    const train = samples.slice(0, cut);
    const test = samples.slice(cut);
    const coef = fitOrderedLogit(train);
    const elo = evalSet(test, (s) => {
      const p = nationalProbs(s.x * 400, coef);
      return [p.pAway, p.pDraw, p.pHome];
    });
    const base = evalSet(test, sym);
    // 네이션스리그만 따로(이번 회차들이 전부 이 대회)
    const unl = test.filter((s) => s.tournament === "UEFA Nations League");
    const eloUnl = evalSet(unl, (s) => {
      const p = nationalProbs(s.x * 400, coef);
      return [p.pAway, p.pDraw, p.pHome];
    });
    const baseUnl = evalSet(unl, sym);
    const pass = elo.acc >= base.acc && elo.logloss <= base.logloss;
    allPass &&= pass;
    splits.push({ split: f, testFrom: test[0].date, coef, elo, symmetric: base, unl: { elo: eloUnl, symmetric: baseUnl }, pass });
    console.log(
      `split ${f}: test ${test.length} (${test[0].date}~)  Elo acc ${(elo.acc * 100).toFixed(2)}% ll ${elo.logloss.toFixed(4)}` +
        `  | 대칭 acc ${(base.acc * 100).toFixed(2)}% ll ${base.logloss.toFixed(4)}` +
        `  | UNL ${unl.length}: Elo ${(eloUnl.acc * 100).toFixed(1)}% vs 대칭 ${(baseUnl.acc * 100).toFixed(1)}%  ${pass ? "통과" : "실패"}`,
    );
  }

  const full = fitOrderedLogit(samples);
  console.log(`전체 표본 적합 계수: ${JSON.stringify(full)}`);
  console.log(allPass ? "채택: 4분할 모두 적중률·로그손실 개선" : "기각: 한 분할 이상에서 악화");

  writeFileSync(
    "seed/national_elo_backtest.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: NATIONAL_RESULTS_URL,
        evalFrom: EVAL_FROM,
        minMatches: MIN_MATCHES,
        samples: samples.length,
        splits,
        fullCoef: full,
        adopted: allPass,
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
