// 종료된 회차의 wisetoto 목록 HTML에 "실제 스코어"가 들어 있는지 확인하는 조사 스크립트.
//
// 왜 필요한가: settlement.ts는 NAME_MAP + matches 테이블(FotMob 백필)로만 정산한다.
// UCL/UEL 회차는 두 축이 모두 없어서 영원히 upcoming으로 남는다. 대안은 wisetoto가 제공하는
// 경기결과를 그대로 읽는 것인데, 그게 가능한지부터 실측한다(추측하지 않는다).
//
// 실행: npx tsx scripts/probe_results.ts [회차번호]   (러너 전용 - 샌드박스는 wisetoto 차단)
import { discoverRoundMasterSeq } from "../src/lib/wisetoto";

const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };

async function main() {
  const round = String(Number(process.argv[2]) || 46);
  const gameYear = String(new Date().getUTCFullYear());
  const masterSeq = await discoverRoundMasterSeq(gameYear, round);
  console.log(`${round}회차 masterSeq: ${masterSeq ?? "없음"}`);
  if (!masterSeq) return;

  const url = new URL("https://www.wisetoto.com/util/gameinfo/get_toto_list.htm");
  const params: Record<string, string> = {
    game_category: "sc1", game_year: gameYear, game_round: round,
    game_month: "", game_day: "", game_info_master_seq: masterSeq,
    sports: "", sort: "", tab_type: "toto",
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: HEADERS });
  const html = new TextDecoder("utf-8").decode(await res.arrayBuffer());
  console.log(`HTML ${html.length}자\n`);

  // 경기 블록을 sub1_1(경기번호) 기준으로 잘라 앞 3개를 원문 그대로 찍는다.
  // 어떤 클래스에 스코어가 들어있는지는 추측하지 말고 눈으로 본다.
  const parts = html.split(/<div class="sub1_1">/).slice(1, 4);
  parts.forEach((p, i) => {
    const block = p.slice(0, 2600).replace(/\s+/g, " ");
    console.log(`----- 경기블록 ${i + 1} -----`);
    console.log(block);
    console.log();
  });

  // 스코어로 보이는 토큰이 전체 HTML에 얼마나 있는지 개괄.
  for (const re of [/class="score[^"]*"/g, /class="[^"]*result[^"]*"/g, />\s*\d+\s*:\s*\d+\s*</g]) {
    const hits = html.match(re) ?? [];
    console.log(`${re} -> ${hits.length}건 ${hits.slice(0, 6).join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
