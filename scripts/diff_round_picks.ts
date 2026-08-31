// marketWeight 변경이 실제 회차 픽을 어떻게 바꿨는지 대조한다.
//
// predictRound는 round_predictions에 저장된 원본 성분(eloDiff/formDiff/h2hDiff/배당)에서
// 매 요청마다 확률을 재계산한다. 따라서 가중치를 바꾸면 이미 등록된 회차의 픽도 재등록 없이
// 바뀐다 - 그게 실제로 어떻게 바뀌었는지 경기 단위로 보여준다.
//
// 앱 API가 주는 raw 성분으로 종전 가중치(0.4)와 신규 가중치를 각각 계산해 나란히 놓는다.
// 실행: npx tsx scripts/diff_round_picks.ts [회차번호]   (러너 전용 - 샌드박스는 워커 차단)
import { predictMatch, DEFAULT_TOGGLES, DEFAULT_MARKET_WEIGHT, marketWeightForLeague } from "../src/lib/prediction";
import { confidenceTier } from "../src/lib/calibration";

const BASE = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const WANT = process.argv[2] ? Number(process.argv[2]) : null;
const OLD_WEIGHT = 0.4;

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function calc(m: any, weight: number) {
  const p = predictMatch(
    {
      eloDiff: m.raw.eloDiff,
      formDiff: m.raw.formDiff,
      h2hDiff: m.raw.h2hDiff,
      leagueDrawRate: m.raw.leagueDrawRate,
      marketOdds: m.raw.market,
      xgDiff: m.raw.xgDiff ?? null,
      cornersDiff: m.raw.cornersDiff ?? null,
      league: m.league,
      marketOnly: m.prediction?.basis !== "model",
    },
    { ...DEFAULT_TOGGLES, marketWeight: weight },
  );
  // confidenceTier는 (리그, 확신도격차)를 받는다. 처음에 bucket을 넘겼다가 등급이 전부
  // "근거없음"으로 찍혔다 - 앱은 정상이었고 이 스크립트의 표시만 틀렸던 것이다.
  return { p, tier: p.basis === "model" ? confidenceTier(m.league, p.confidenceGap) : "근거없음" };
}

async function main() {
  const rounds = (await getJson(`${BASE}/api/rounds`)).rounds ?? [];
  const target = WANT ? rounds.find((r: any) => r.round_no === WANT) : rounds[0];
  if (!target) {
    console.log(`회차를 찾지 못했다. 조회된 회차: ${rounds.map((r: any) => r.round_no).join(", ")}`);
    process.exit(1);
  }
  const data = await getJson(`${BASE}/api/rounds/${target.id}`);
  const matches = data.matches ?? [];
  console.log(`${target.round_no}회차 (id=${target.id}, ${matches.length}경기, status=${target.status})`);
  // 앱이 실제로 무엇을 내놓고 있는지 먼저 찍는다 - 내 재계산이 앱과 어긋나면 여기서 드러난다.
  const b = new Map<string, number>();
  for (const m of matches) b.set(m.prediction?.basis ?? "(없음)", (b.get(m.prediction?.basis ?? "(없음)") ?? 0) + 1);
  console.log(`앱이 낸 basis 분포: ${[...b].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const s0 = matches[0];
  console.log(`샘플(1번): basis=${s0?.prediction?.basis} tier=${s0?.calibration?.tier} 1픽=${s0?.prediction?.rankedPicks?.[0]} gap=${s0?.prediction?.confidenceGap?.toFixed?.(4)}`);
  console.log(`종전 marketWeight ${OLD_WEIGHT} vs 신규 리그별 가중치\n`);

  const P = ["홈승", "무승부", "원정승"];
  let flipped = 0, tierChanged = 0, noMarket = 0;
  console.log("연번 리그        경기                         가중치      종전 픽/확률/등급        ->  신규 픽/확률/등급");
  console.log("-".repeat(118));
  for (const m of matches) {
    if (!m.raw?.market) {
      noMarket++;
      console.log(`${String(m.seq).padStart(3)}  ${m.league.padEnd(10)} ${(m.home + " vs " + m.away).padEnd(28)} (배당 없음 - 변화 없음)`);
      continue;
    }
    const w = marketWeightForLeague(m.league);
    const a = calc(m, OLD_WEIGHT);
    const b = calc(m, w);
    const pickA = a.p.rankedPicks[0], pickB = b.p.rankedPicks[0];
    const topA = Math.max(a.p.pHome, a.p.pDraw, a.p.pAway);
    const topB = Math.max(b.p.pHome, b.p.pDraw, b.p.pAway);
    const flip = pickA !== pickB;
    const tchg = a.tier !== b.tier;
    if (flip) flipped++;
    if (tchg) tierChanged++;
    const mark = flip ? " ** 픽 변경" : tchg ? " * 등급 변경" : "";
    console.log(
      `${String(m.seq).padStart(3)}  ${m.league.padEnd(10)} ${(m.home + " vs " + m.away).padEnd(28)} ` +
        `${OLD_WEIGHT}->${w}   ` +
        `${pickA} ${(topA * 100).toFixed(1)}% ${a.tier.padEnd(5)}  ->  ${pickB} ${(topB * 100).toFixed(1)}% ${b.tier.padEnd(5)}${mark}`,
    );
  }
  console.log("-".repeat(118));
  console.log(`픽이 바뀐 경기 ${flipped} / 등급만 바뀐 경기 ${tierChanged} / 배당 없어 무변화 ${noMarket} (전체 ${matches.length})`);

  if (flipped > 0) {
    console.log("\n픽이 바뀐 경기 상세 (확률 3개 전부):");
    for (const m of matches) {
      if (!m.raw?.market) continue;
      const a = calc(m, OLD_WEIGHT), b = calc(m, marketWeightForLeague(m.league));
      if (a.p.rankedPicks[0] === b.p.rankedPicks[0]) continue;
      const f = (p: any) => `홈 ${(p.pHome * 100).toFixed(1)}% / 무 ${(p.pDraw * 100).toFixed(1)}% / 원 ${(p.pAway * 100).toFixed(1)}%`;
      console.log(`\n  ${m.seq}. ${m.home} vs ${m.away} (${m.league})`);
      console.log(`     배당 암시확률  ${f(m.raw.market)}`);
      console.log(`     종전(w=${OLD_WEIGHT})   ${f(a.p)}  -> ${a.p.rankedPicks[0]}`);
      console.log(`     신규(w=${marketWeightForLeague(m.league)})   ${f(b.p)}  -> ${b.p.rankedPicks[0]}`);
      if (m.result) {
        console.log(`     실제 결과      ${P[m.result.actual === "H" ? 0 : m.result.actual === "D" ? 1 : 2]} (${m.result.hg}:${m.result.ag})`);
      }
    }
  }
}

main();
