// wisetoto 경기목록 엔드포인트가 403을 주는 원인을 가른다.
//
// 증상 (2026-09-24, 워커 실측)
//   index.htm                      200  -> masterSeq 탐색은 정상(53~56회차 전부 찾힌다)
//   util/gameinfo/get_toto_list.htm 403  -> 경기목록만 막힌다
// 그래서 53회차 등록이 실패하고, detectNewRound가 MAX+1만 시도하므로 그 뒤로 영구히
// 멈춰 있었다(앱 52 / 발매 56).
//
// 두 원인이 섞여 있을 수 있어 갈라서 본다.
//   (A) 엔드포인트가 헤더를 더 깐깐하게 본다 - 러너에서도 403이면 헤더/쿠키 문제
//   (B) 워커(Cloudflare) 출구 IP만 막혔다 - 러너에서 200이면 IP 문제이고 헤더로는 안 풀린다
// 헤더 조합을 하나씩 바꿔 무엇이 200을 만드는지 찍는다. 결론을 추측하지 않는다.
//
// 실행: npx tsx scripts/probe_wisetoto_fixtures.ts [회차]
import { writeFileSync } from "node:fs";

const ROUND = process.argv[2] ?? "53";
const YEAR = String(new Date().getUTCFullYear());
const OUT = "seed/wisetoto_403_probe.txt";
const lines: string[] = [];
const say = (...a: unknown[]) => { const s = a.map(String).join(" "); lines.push(s); process.stdout.write(s + "\n"); };

const UA_FULL =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const indexUrl = (round: string) =>
  `https://www.wisetoto.com/index.htm?tab_type=toto&game_type=sc&game_category=sc1&game_year=${YEAR}&game_round=${round}`;

function listUrl(round: string, masterSeq: string) {
  const u = new URL("https://www.wisetoto.com/util/gameinfo/get_toto_list.htm");
  u.searchParams.set("game_category", "sc1");
  u.searchParams.set("game_year", YEAR);
  u.searchParams.set("game_round", round);
  u.searchParams.set("game_month", "");
  u.searchParams.set("game_day", "");
  u.searchParams.set("game_info_master_seq", masterSeq);
  u.searchParams.set("sports", "");
  u.searchParams.set("sort", "");
  u.searchParams.set("tab_type", "toto");
  return u.toString();
}

async function hit(label: string, url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
    const body = await res.text();
    const hasFixture = /경기|home|away|team/i.test(body);
    say(`  ${label.padEnd(34)} HTTP ${res.status}  ${String(body.length).padStart(7)}자  ${hasFixture ? "경기 관련 토큰 있음" : "토큰 없음"}`);
    if (res.status !== 200) say(`      본문 앞부분: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
    return { status: res.status, body, setCookie: res.headers.get("set-cookie") };
  } catch (e) {
    say(`  ${label.padEnd(34)} 요청 실패 ${(e as Error).message}`);
    return { status: 0, body: "", setCookie: null };
  }
}

async function main() {
  say(`wisetoto 403 원인 조사 - ${ROUND}회차 / game_year ${YEAR}`);
  say("=".repeat(78));

  // 1) masterSeq를 먼저 얻는다(그리고 쿠키도 받아둔다)
  say("\n1) index.htm - masterSeq 탐색 + 쿠키 확보");
  const idx = await hit("현행 헤더", indexUrl(ROUND), {
    "User-Agent": "Mozilla/5.0",
    Referer: "https://www.wisetoto.com/index.htm",
  });
  const m = idx.body.match(/'toto','sc1','(\d+)','(\d+)','','','(\d+)',now_sports/);
  const masterSeq = m?.[3];
  say(`   masterSeq: ${masterSeq ?? "없음"}  / set-cookie: ${idx.setCookie ? "있음" : "없음"}`);
  if (!masterSeq) { say("masterSeq를 못 얻어 이후 조사를 진행할 수 없다."); return; }
  const cookie = (idx.setCookie ?? "").split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");

  const url = listUrl(ROUND, masterSeq);
  say(`\n2) get_toto_list.htm 헤더 조합별 응답`);
  say(`   ${url}`);

  // 현행 워커와 동일한 헤더 - 여기서 403이면 러너에서도 막힌다는 뜻(헤더/쿠키 문제)
  await hit("a. 현행(워커와 동일)", url, {
    "User-Agent": "Mozilla/5.0",
    Referer: "https://www.wisetoto.com/index.htm",
  });
  // 브라우저처럼 완전한 UA
  await hit("b. 실제 브라우저 UA", url, { "User-Agent": UA_FULL, Referer: "https://www.wisetoto.com/index.htm" });
  // AJAX 엔드포인트이므로 XHR 표식
  await hit("c. b + X-Requested-With", url, {
    "User-Agent": UA_FULL,
    Referer: "https://www.wisetoto.com/index.htm",
    "X-Requested-With": "XMLHttpRequest",
  });
  // Referer를 실제 탭 주소로
  await hit("d. c + Referer를 탭 주소로", url, {
    "User-Agent": UA_FULL,
    Referer: indexUrl(ROUND),
    "X-Requested-With": "XMLHttpRequest",
  });
  // 쿠키까지
  await hit("e. d + 쿠키", url, {
    "User-Agent": UA_FULL,
    Referer: indexUrl(ROUND),
    "X-Requested-With": "XMLHttpRequest",
    ...(cookie ? { Cookie: cookie } : {}),
  });
  // 브라우저가 보내는 부수 헤더까지
  await hit("f. e + Accept/Language", url, {
    "User-Agent": UA_FULL,
    Referer: indexUrl(ROUND),
    "X-Requested-With": "XMLHttpRequest",
    Accept: "text/html, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    ...(cookie ? { Cookie: cookie } : {}),
  });

  say(`\n=== 판정 ===`);
  say(`  a가 403이고 다른 조합이 200이면 -> 헤더/쿠키 문제다. src/lib/wisetoto.ts의 HEADERS를`);
  say(`     200을 만든 조합으로 고치면 워커에서도 풀릴 가능성이 높다.`);
  say(`  전부 403이면 -> 엔드포인트가 이 경로를 아예 막았거나 우리 쪽 파라미터가 틀렸다.`);
  say(`     index.htm HTML에서 경기목록을 직접 파싱하는 경로를 찾아야 한다.`);
  say(`  a가 200이면 -> 러너에서는 되고 워커에서만 막힌 것이다. Cloudflare 출구 IP 차단이므로`);
  say(`     헤더로는 안 풀린다. 수집을 러너로 옮기고 워커는 D1에 쓰는 역할만 맡는 구조가 필요하다.`);
}

main().then(() => {
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.stdout.write(`\n${OUT}에 저장\n`);
}).catch((e) => {
  lines.push(`\n!! 실패: ${(e as Error).stack}`);
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.exitCode = 1;
});
