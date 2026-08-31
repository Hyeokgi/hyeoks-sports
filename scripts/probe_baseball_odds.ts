// wisetoto가 야구토토에도 해외배당을 제공하는지 확인하는 탐색 스크립트.
//
// 축구 승무패는 game_category=sc1로 긁고 있는데(src/lib/wisetoto.ts), 야구는 카테고리 코드가
// 다르다. 코드를 추측해서 "없다"고 결론내면 안 되므로(47회차 때 자작 파싱이 '배당 0건'을
// '배당 없음'으로 오판할 뻔했다), index.htm이 실제로 노출하는 카테고리를 먼저 훑는다.
//
// 확인 순서
//   1) index.htm에서 game_category / 'toto','xxx' 토큰을 전부 수집 - 어떤 종목이 있나
//   2) 야구로 보이는 카테고리마다 회차(master_seq)를 찾을 수 있나
//   3) 회차가 있으면 경기목록에서 schedule_info_seq를 뽑을 수 있나
//   4) 그 seq로 배당표(tab05_01)가 나오나  <- 이게 최종 질문
// 각 단계에서 실패하면 무엇이 없어서 실패했는지 원문을 찍는다.
//
// 실행: npx tsx scripts/probe_baseball_odds.ts   (러너 전용 - 샌드박스는 wisetoto 차단)
const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };
const TIMEOUT = 20000;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
}

function uniq(xs: string[]): string[] { return [...new Set(xs)]; }

async function main() {
  console.log("=== 1) wisetoto가 노출하는 종목/카테고리 훑기 ===");
  const idx = await fetchText("https://www.wisetoto.com/index.htm");
  console.log(`  index.htm ${idx.length.toLocaleString()}자`);

  const cats = uniq([...idx.matchAll(/game_category=([a-z0-9]+)/gi)].map((m) => m[1]));
  const types = uniq([...idx.matchAll(/game_type=([a-z0-9]+)/gi)].map((m) => m[1]));
  const totoTokens = uniq([...idx.matchAll(/'toto','([a-z0-9]+)'/gi)].map((m) => m[1]));
  console.log(`  game_type   : ${types.join(", ") || "(없음)"}`);
  console.log(`  game_category: ${cats.join(", ") || "(없음)"}`);
  console.log(`  'toto','xx' : ${totoTokens.join(", ") || "(없음)"}`);

  // 야구 관련 단어가 어떤 링크에 붙어 있는지 - 코드와 종목명을 잇는 단서
  for (const kw of ["야구", "승1패", "베이스", "MLB", "KBO"]) {
    const hits = [...idx.matchAll(new RegExp(`.{0,140}${kw}.{0,90}`, "g"))].slice(0, 2);
    console.log(`\n  "${kw}" 주변 (${hits.length}건):`);
    for (const h of hits) console.log(`    ${h[0].replace(/\s+/g, " ").trim().slice(0, 210)}`);
  }

  // 축구 sc1 외에 시도해볼 후보. index에서 발견된 것 + 관례적인 야구 코드.
  const candidates = uniq([...cats, ...totoTokens, "bs1", "bs2", "bb1", "ba1"]).filter((c) => c !== "sc1");
  console.log(`\n=== 2) 카테고리별 회차(master_seq) 탐색 - 후보 ${candidates.length}개 ===`);
  const year = String(new Date().getUTCFullYear());
  const found: { cat: string; round: string; master: string }[] = [];

  for (const cat of candidates) {
    let html: string;
    try {
      html = await fetchText(`https://www.wisetoto.com/index.htm?tab_type=toto&game_category=${cat}`);
    } catch (e) {
      console.log(`  ${cat.padEnd(5)}: 조회 실패 ${(e as Error).message}`);
      continue;
    }
    // 축구와 같은 패턴을 먼저 시도하고, 안 되면 카테고리를 넣은 일반형으로 재시도
    const m = html.match(new RegExp(`'toto','${cat}','(\\\\d+)','(\\\\d+)','','','(\\\\d+)',now_sports`))
      ?? html.match(/'toto','[a-z0-9]+','(\d+)','(\d+)','','','(\d+)',now_sports/);
    if (m) {
      console.log(`  ${cat.padEnd(5)}: ● ${m[2]}회차 master_seq=${m[3]}`);
      found.push({ cat, round: m[2], master: m[3] });
    } else {
      console.log(`  ${cat.padEnd(5)}: 회차 못 찾음 (now_sports 토큰 ${html.includes("now_sports") ? "있음" : "없음"}, ${html.length.toLocaleString()}자)`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (found.length === 0) {
    console.log("\n=== 판정 ===");
    console.log("  야구 카테고리에서 회차를 찾지 못했다. 배당 유무는 판정 불가(조회를 시도조차 못 함).");
    console.log("  위 1)의 카테고리 목록과 '야구' 주변 원문을 보고 코드/패턴을 고친 뒤 다시 실행할 것.");
    process.exitCode = 1;
    return;
  }

  console.log(`\n=== 3~4) 경기목록 + 배당표 확인 ===`);
  for (const f of found) {
    console.log(`\n--- ${f.cat} ${f.round}회차 ---`);
    const url = new URL("https://www.wisetoto.com/util/gameinfo/get_toto_list.htm");
    for (const [k, v] of Object.entries({
      game_category: f.cat, game_year: year, game_round: f.round, game_month: "", game_day: "",
      game_info_master_seq: f.master, sports: "", sort: "", tab_type: "toto",
    })) url.searchParams.set(k, v);
    let list: string;
    try { list = await fetchText(url.toString()); } catch (e) { console.log(`  목록 실패: ${(e as Error).message}`); continue; }
    console.log(`  목록 HTML ${list.length.toLocaleString()}자`);

    const seqs = [...list.matchAll(/get_gameinfo_detail\('(\d+)','(\d+)','([a-z0-9]+)'/g)];
    console.log(`  schedule_info_seq 추출: ${seqs.length}건${seqs.length ? ` (첫 건 ${seqs[0][1]}경기 seq=${seqs[0][1]})` : ""}`);
    if (seqs.length === 0) {
      const near = list.match(/.{0,120}get_gameinfo_detail.{0,90}/);
      console.log(`    get_gameinfo_detail 존재: ${list.includes("get_gameinfo_detail")}`);
      if (near) console.log(`    주변: ${JSON.stringify(near[0].replace(/\s+/g, " ").slice(0, 200))}`);
      console.log("    -> 배당 조회 불가(판정 불가)");
      continue;
    }
    // 경기 블록 원문 하나를 그대로 - 야구 목록 구조가 축구와 같은지 눈으로 본다
    const block = list.split('<div class="sub1_1">')[1];
    if (block) console.log(`  경기블록 원문(앞 700자): ${block.slice(0, 700).replace(/\s+/g, " ")}`);

    // 배당표
    const seq = seqs[0][1];
    const rate = new URL("https://www.wisetoto.com/util/gameinfo/get_detail_rate_info.htm");
    rate.searchParams.set("schedule_info_seq", seq);
    rate.searchParams.set("tab_type", "toto");
    for (const k of ["game_year", "game_round", "league_info_seq", "limit", "same_home_away"]) rate.searchParams.set(k, "");
    rate.searchParams.set("game_no", "1");
    let rateHtml: string;
    try { rateHtml = await fetchText(rate.toString()); } catch (e) { console.log(`  배당 조회 실패: ${(e as Error).message}`); continue; }
    console.log(`  배당 HTML ${rateHtml.length.toLocaleString()}자`);
    const table = rateHtml.match(/id="tab05_01"[\s\S]*?<\/table>/);
    const dividends = [...rateHtml.matchAll(/class="dividend[^"]*">\s*([\d.]+)/g)].map((m) => m[1]);
    console.log(`  tab05_01 배당표: ${table ? "있음" : "없음"} / dividend 값 ${dividends.length}개${dividends.length ? ` [${dividends.slice(0, 9).join(", ")}...]` : ""}`);
    if (!table && !dividends.length) {
      console.log(`    배당 HTML 앞 400자: ${rateHtml.slice(0, 400).replace(/\s+/g, " ")}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
