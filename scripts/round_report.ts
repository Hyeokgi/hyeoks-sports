// 정산된 회차의 사후 분석(post-mortem). "왜 틀렸는가"를 유형별로 분류한다.
//
// 단순히 몇 개 맞췄는지가 아니라, 빗나간 경기를 원인별로 나누는 게 목적이다:
//   - 모델이 확신했는데 틀림   -> 진짜 모델 실패. 쌓이면 캘리브레이션을 의심해야 한다.
//   - 모델도 반반인데 틀림     -> 예상된 노이즈. 고칠 게 없다.
//   - 독식픽이 뒤집어서 틀림   -> 우리 이변 로직이 비용을 치른 경우
//   - 시장과 불일치했는데 틀림 -> 배당을 더 신뢰해야 한다는 신호
// 유형을 구분하지 않으면 "5개 틀렸다"에서 아무 교훈도 못 얻는다.
//
// 실행: npx tsx scripts/round_report.ts [회차번호]
//   회차번호를 안 주면 가장 최근 정산 회차를 쓴다.
//   샌드박스는 Worker가 막혀 있어 러너에서 실행한다(task=round-report).
import fs from "node:fs";
import path from "node:path";
import { predictMatch, DEFAULT_TOGGLES } from "../src/lib/prediction";
import { generateExclusivePick, type ExclusiveMatchInput } from "../src/lib/exclusivePick";
import { confidenceTier, findCalibrationBucket } from "../src/lib/calibration";

const BASE = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const LABEL = { H: "홈승", D: "무승부", A: "원정승" } as const;
const VOTE_FLOOR = 0.005;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const want = process.argv[2] ? Number(process.argv[2]) : null;
  const roundsData = await getJson(`${BASE}/api/rounds`);
  const rounds: any[] = roundsData.rounds ?? [];

  let target: any = null;
  if (want != null) {
    target = rounds.find((r) => r.round_no === want);
    if (!target) throw new Error(`${want}회차를 찾을 수 없습니다. 조회된 회차: ${rounds.map((r) => r.round_no).join(", ")}`);
  }

  // 회차 지정이 없으면 결과가 하나라도 있는 가장 최근 회차
  const candidates = target ? [target] : rounds;
  let data: any = null;
  for (const r of candidates) {
    const d = await getJson(`${BASE}/api/rounds/${r.id}`);
    if ((d.matches ?? []).some((m: any) => m.result)) { target = r; data = d; break; }
  }
  if (!data) { console.log("정산된 회차가 없습니다."); return; }

  const matches: any[] = data.matches ?? [];
  const settled = matches.filter((m) => m.result);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${target.round_no}회차 사후 분석  (전체 ${matches.length}경기 / 정산 ${settled.length}경기)`);
  console.log("=".repeat(72));

  // 독식픽도 같은 회차 데이터로 재현한다(웹앱과 동일 라이브러리)
  const exInputs: ExclusiveMatchInput[] = matches.map((m) => ({
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    prediction: predictMatch(
      {
        eloDiff: m.raw.eloDiff, formDiff: m.raw.formDiff, h2hDiff: m.raw.h2hDiff,
        leagueDrawRate: m.raw.leagueDrawRate, marketOdds: m.raw.market ?? null,
        xgDiff: m.raw.xgDiff ?? null, cornersDiff: m.raw.cornersDiff ?? null, league: m.league,
      },
      DEFAULT_TOGGLES,
    ),
    voteShare: m.voteShare ? { home: m.voteShare.home, draw: m.voteShare.draw, away: m.voteShare.away } : null,
  }));
  const ex = generateExclusivePick(exInputs);
  const exBySeq = new Map(ex.picks.map((p) => [p.seq, p]));

  let baseHit = 0, exHit = 0;
  const misses: any[] = [];
  const rows: string[] = [];

  for (const m of settled) {
    const pred = predictMatch(
      {
        eloDiff: m.raw.eloDiff, formDiff: m.raw.formDiff, h2hDiff: m.raw.h2hDiff,
        leagueDrawRate: m.raw.leagueDrawRate, marketOdds: m.raw.market ?? null,
        xgDiff: m.raw.xgDiff ?? null, cornersDiff: m.raw.cornersDiff ?? null, league: m.league,
      },
      DEFAULT_TOGGLES,
    );
    const actual = LABEL[m.result.actual as "H" | "D" | "A"];
    const basePick = pred.rankedPicks[0];
    const exPick = exBySeq.get(m.seq)?.pick ?? basePick;
    const isUpset = exBySeq.get(m.seq)?.isUpset ?? false;
    const okBase = basePick === actual;
    const okEx = exPick === actual;
    if (okBase) baseHit++;
    if (okEx) exHit++;

    const gap = pred.confidenceGap;
    const tier = confidenceTier(m.league, gap);
    const probOf = (p: string) => (p === "홈승" ? pred.pHome : p === "무승부" ? pred.pDraw : pred.pAway);
    const marketTop = m.raw.market
      ? (["홈승", "무승부", "원정승"] as const)[
          [m.raw.market.pHome, m.raw.market.pDraw, m.raw.market.pAway].indexOf(
            Math.max(m.raw.market.pHome, m.raw.market.pDraw, m.raw.market.pAway),
          )
        ]
      : null;

    rows.push(
      `  ${String(m.seq).padStart(2)}. ${m.league.padEnd(6)} ${m.home} vs ${m.away}\n` +
        `      실제 ${actual} (${m.result.hg}:${m.result.ag})  |  기본픽 ${basePick} ${okBase ? "O" : "X"}` +
        `  독식픽 ${exPick}${isUpset ? "(이변)" : ""} ${okEx ? "O" : "X"}\n` +
        `      모델 홈${pct(pred.pHome)}/무${pct(pred.pDraw)}/원${pct(pred.pAway)}  확신도 ${(gap * 100).toFixed(1)}%p(${tier})` +
        (m.raw.market ? `  시장픽 ${marketTop}` : "  시장배당 없음") +
        (m.voteShare ? `  투표 홈${m.voteShare.home.toFixed(0)}/무${m.voteShare.draw.toFixed(0)}/원${m.voteShare.away.toFixed(0)}` : ""),
    );

    if (!okEx) {
      // 실패 유형 분류
      const kinds: string[] = [];
      if (isUpset) kinds.push("독식 이변이 빗나감");
      if (okBase && !okEx) kinds.push("기본픽은 맞았는데 이변으로 놓침");
      if (tier === "확신픽") kinds.push("모델 확신픽이 빗나감");
      else if (tier === "불확실") kinds.push("모델도 불확실(예상된 노이즈)");
      if (marketTop && marketTop !== basePick) kinds.push("시장과 불일치한 픽이 빗나감");
      if (marketTop && marketTop === actual && basePick !== actual) kinds.push("시장이 맞고 우리가 틀림");
      const bucket = findCalibrationBucket(m.league, gap);
      misses.push({
        seq: m.seq, league: m.league, home: m.home, away: m.away, actual,
        basePick, exPick, isUpset, tier, gap,
        modelProbOfActual: probOf(actual),
        bucketAccuracy: bucket?.accuracy ?? null,
        kinds,
      });
    }
  }

  console.log(`\n--- 경기별 ---`);
  console.log(rows.join("\n"));

  console.log(`\n--- 요약 ---`);
  console.log(`  기본픽 적중 ${baseHit}/${settled.length} (${pct(baseHit / settled.length)})`);
  console.log(`  독식픽 적중 ${exHit}/${settled.length} (${pct(exHit / settled.length)})`);
  console.log(`  이변 반영 ${ex.upsetCount}경기 / 적중확률 유지율 ${pct(ex.probRetention)}`);
  if (ex.baseCrowdShare != null && ex.pickCrowdShare != null) {
    console.log(`  대중 구매비중  기본픽 ${(ex.baseCrowdShare * 1e6).toFixed(2)}/백만  독식픽 ${(ex.pickCrowdShare * 1e6).toFixed(2)}/백만`);
    console.log(`  (1~41회차 실제 당첨조합 중앙값 0.17/백만 - 낮을수록 독식 가능성 큼)`);
  }

  // 실제 당첨조합의 대중 구매비중 - 우리 픽이 얼마나 혼잡했는지의 기준점
  let winnerShare: number | null = 1;
  for (const m of matches) {
    if (!m.result || !m.voteShare) { winnerShare = null; break; }
    const v = m.result.actual === "H" ? m.voteShare.home : m.result.actual === "D" ? m.voteShare.draw : m.voteShare.away;
    winnerShare! *= Math.max(v / 100, VOTE_FLOOR);
  }
  if (winnerShare != null) {
    console.log(`  실제 당첨조합의 대중 구매비중 ${(winnerShare * 1e6).toFixed(2)}/백만`);
  }

  console.log(`\n--- 빗나간 ${misses.length}경기 원인 분류 ---`);
  for (const x of misses) {
    console.log(`  ${String(x.seq).padStart(2)}. ${x.home} vs ${x.away} -> 실제 ${x.actual}`);
    console.log(`      우리 픽 ${x.exPick}${x.isUpset ? "(이변)" : ""} | 확신도 ${(x.gap * 100).toFixed(1)}%p(${x.tier})` +
      ` | 모델이 실제결과에 준 확률 ${pct(x.modelProbOfActual)}` +
      (x.bucketAccuracy != null ? ` | 이 구간 실측 적중률 ${pct(x.bucketAccuracy)}` : ""));
    console.log(`      -> ${x.kinds.length ? x.kinds.join(" / ") : "특이사항 없음(평범한 실패)"}`);
  }

  const tally: Record<string, number> = {};
  for (const x of misses) for (const k of x.kinds) tally[k] = (tally[k] ?? 0) + 1;
  console.log(`\n--- 실패 유형 집계 ---`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}건`);
  if (Object.keys(tally).length === 0) console.log("  (없음)");

  console.log(
    `\n※ 한 회차 14경기는 표본이 아니다. 확신픽 실패가 여러 회차에 걸쳐 반복될 때만\n` +
      `  캘리브레이션 조정을 검토한다. 단일 회차 결과로 파라미터를 바꾸면 과적합이다.`,
  );

  const out = {
    generatedAt: new Date().toISOString(),
    roundNo: target.round_no,
    settled: settled.length,
    baseHit, exHit,
    upsetCount: ex.upsetCount,
    probRetention: ex.probRetention,
    baseCrowdShare: ex.baseCrowdShare,
    pickCrowdShare: ex.pickCrowdShare,
    winnerCrowdShare: winnerShare,
    misses,
    missKindTally: tally,
  };
  fs.writeFileSync(path.join(process.cwd(), "seed", `round_report_${target.round_no}.json`), JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n저장: seed/round_report_${target.round_no}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
