// 최신 회차의 독식 지향 픽을 러너 로그로 출력한다 (npx tsx scripts/print_exclusive_pick.ts).
// Worker의 /api/rounds/:id 응답(서버 기본 토글로 계산된 prediction + betman voteShare)을 그대로 쓰고,
// 픽 산출은 웹앱과 동일한 src/lib/exclusivePick.ts를 공유한다 - 로직 중복 금지.
import { generateExclusivePick, type ExclusiveMatchInput } from "../src/lib/exclusivePick";

const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";

async function main() {
  const roundsRes = await fetch(`${WORKER_BASE_URL}/api/rounds`);
  if (!roundsRes.ok) throw new Error(`/api/rounds 조회 실패: ${roundsRes.status}`);
  const { rounds } = (await roundsRes.json()) as { rounds: any[] };
  const round = process.env.ROUND_ID
    ? rounds.find((r) => r.id === Number(process.env.ROUND_ID))
    : rounds?.[0];
  if (!round) throw new Error("대상 회차를 찾지 못했습니다");

  const roundRes = await fetch(`${WORKER_BASE_URL}/api/rounds/${round.id}`);
  if (!roundRes.ok) throw new Error(`/api/rounds/${round.id} 조회 실패: ${roundRes.status}`);
  const { matches } = (await roundRes.json()) as { matches: any[] };

  const inputs: ExclusiveMatchInput[] = matches.map((m) => ({
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    prediction: m.prediction,
    voteShare: m.voteShare ?? null,
  }));

  const maxUpsets = process.env.MAX_UPSETS ? Number(process.env.MAX_UPSETS) : undefined;
  const result = generateExclusivePick(inputs, maxUpsets != null ? { maxUpsets } : {});

  console.log(`\n===== ${round.round_no ?? "?"}회차 독식 지향 픽 (round id=${round.id}) =====\n`);
  for (const p of result.picks) {
    const vote = p.votePct != null ? `투표 ${p.votePct.toFixed(1)}%` : "투표율 없음";
    const mark = p.isUpset ? ` ★이변 (기본픽 ${p.basePick})` : "";
    console.log(
      `${String(p.seq).padStart(2)}. [${p.league}] ${p.home} vs ${p.away} → ${p.pick} (모델 ${(p.modelProb * 100).toFixed(0)}%, ${vote})${mark}`,
    );
  }

  // 무승부 가치비 진단: 승무패에서 대중이 무승부를 과소베팅하는 경향이 있어(독식의 고전 루트),
  // 경기별 홈/무/원정 투표율 전체와 무승부 가치비(모델확률/투표율)를 병기해 판단 근거를 남긴다.
  console.log(`\n[무승부 진단] 모델 무승부확률 / 투표율 / 가치비(>1이면 대중이 저평가)`);
  for (const m of matches) {
    if (!m.voteShare) continue;
    const pDraw = m.prediction.pDraw as number;
    const vDraw = Math.max(m.voteShare.draw / 100, 0.005);
    console.log(
      `${String(m.seq).padStart(2)}. ${m.home} vs ${m.away}: 무 ${(pDraw * 100).toFixed(0)}% / 투표 ${m.voteShare.draw.toFixed(1)}% / 가치비 ${(pDraw / vDraw).toFixed(2)}` +
        ` (투표 홈${m.voteShare.home.toFixed(1)}·무${m.voteShare.draw.toFixed(1)}·원정${m.voteShare.away.toFixed(1)}%)`,
    );
  }
  console.log(`\n이변 반영: ${result.upsetCount}경기 / 투표율 수집: ${result.matchesWithVote}/${result.picks.length}경기`);
  console.log(`적중확률(모델, 독립 근사): 기본픽 대비 ${(result.probRetention * 100).toFixed(0)}% 유지`);
  if (result.payoutEdge != null && result.pickCrowdShare != null && result.baseCrowdShare != null) {
    console.log(
      `대중 동일조합 구매비중 추정: 기본픽 ${(result.baseCrowdShare * 1e6).toFixed(2)}/백만 → 독식픽 ${(result.pickCrowdShare * 1e6).toFixed(2)}/백만`,
    );
    console.log(`기대 배당가치(기본픽 대비): ${result.payoutEdge.toFixed(1)}배`);
  }
  console.log(`\n${result.note}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
