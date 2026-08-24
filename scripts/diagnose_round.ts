// 회차 감지가 안 될 때 원인을 가르는 진단 스크립트.
//
// detectNewRound는 wisetoto HTML을 정규식 하나로 긁는다:
//   /'toto','sc1','(\d+)','(\d+)','','','(\d+)',now_sports/
// 이게 안 맞으면 masterSeq=null -> "round_not_yet_open"으로 처리되는데,
// 이 결과는 두 경우에 똑같이 나온다:
//   (A) 해당 회차가 실제로 아직 발매 전
//   (B) wisetoto가 마크업을 바꿔 정규식이 깨짐
// (B)는 조용히 앱을 멈추게 하므로 반드시 구분해야 한다.
//
// 판별법: 이미 등록된 과거 회차를 대조군으로 같이 조회한다.
//   과거 회차는 매치되는데 다음 회차만 안 되면 -> (A) 발매 전
//   과거 회차까지 안 되면                     -> (B) 파서 파손
//
// 실행: npx tsx scripts/diagnose_round.ts [기준회차]
//   기준회차 생략 시 CURRENT_ROUND 상수를 쓴다. 앞뒤 2회차를 함께 조회한다.
const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };
const MASTER_SEQ_RE = /'toto','sc1','(\d+)','(\d+)','','','(\d+)',now_sports/;
const CURRENT_ROUND = 46; // D1에 등록된 최신 회차(대조군 기준점)

async function probe(gameYear: string, round: number) {
  const url = `https://www.wisetoto.com/index.htm?tab_type=toto&game_type=sc&game_category=sc1&game_year=${gameYear}&game_round=${round}`;
  let html = "";
  let status = 0;
  try {
    const res = await fetch(url, { headers: HEADERS });
    status = res.status;
    html = new TextDecoder("utf-8").decode(await res.arrayBuffer());
  } catch (e) {
    console.log(`  ${round}회차: 요청 실패 - ${(e as Error).message}`);
    return { round, ok: false, masterSeq: null as string | null };
  }

  const m = html.match(MASTER_SEQ_RE);
  const masterSeq = m?.[3] ?? null;
  console.log(
    `  ${round}회차: HTTP ${status}, HTML ${html.length.toLocaleString()}자, ` +
      `masterSeq ${masterSeq ?? "없음"}`,
  );

  // 매치 실패 시: 마크업이 바뀐 건지 보려고 주변 단서를 찍는다.
  if (!masterSeq) {
    const hints: string[] = [];
    if (html.includes("now_sports")) hints.push("now_sports 존재");
    if (html.includes("'toto','sc1'")) hints.push("'toto','sc1' 존재");
    const near = html.match(/.{0,90}now_sports.{0,40}/);
    if (near) hints.push(`주변: ${JSON.stringify(near[0].replace(/\s+/g, " ").slice(0, 130))}`);
    console.log(`      단서: ${hints.length ? hints.join(" | ") : "관련 토큰 자체가 없음"}`);
  }
  return { round, ok: !!masterSeq, masterSeq };
}

async function main() {
  const base = Number(process.argv[2]) || CURRENT_ROUND;
  const gameYear = String(new Date().getUTCFullYear());
  console.log(`기준 회차 ${base} / game_year ${gameYear}\n`);
  console.log("wisetoto 회차별 조회:");

  const results = [];
  for (const r of [base - 1, base, base + 1, base + 2]) {
    results.push(await probe(gameYear, r));
    await new Promise((res) => setTimeout(res, 700));
  }

  const past = results.filter((r) => r.round <= base);
  const future = results.filter((r) => r.round > base);
  const pastOk = past.some((r) => r.ok);
  const futureOk = future.some((r) => r.ok);

  console.log("\n=== 판정 ===");
  if (!pastOk) {
    console.log("  ✗ 이미 발매됐던 과거 회차조차 masterSeq를 못 찾았다.");
    console.log("    -> wisetoto 마크업 변경으로 파서가 깨졌을 가능성이 높다(위 '단서' 참고).");
    console.log("       src/lib/wisetoto.ts의 MASTER_SEQ 정규식을 실제 HTML에 맞춰 고쳐야 한다.");
    process.exitCode = 1;
  } else if (!futureOk) {
    console.log("  ○ 과거 회차는 정상 조회된다 -> 파서는 살아 있다.");
    console.log(`    다음 회차(${base + 1})가 아직 발매 전이라 감지되지 않는 것이다.`);
    console.log("    발매되면 Worker 크론(6시간)이 자동으로 등록한다.");
  } else {
    const hit = future.find((r) => r.ok)!;
    console.log(`  ● ${hit.round}회차가 이미 발매됐다(masterSeq=${hit.masterSeq}).`);
    console.log("    등록이 안 됐다면 발매 문제가 아니라 팀명 매핑(NAME_MAP) 누락일 수 있다.");
    console.log("    generate_round.yml을 실행해 detect-round 응답의 reason을 확인할 것.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
