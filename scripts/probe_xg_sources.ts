// 경기별 xG를 어디서 받을 수 있는지 조사. 결론을 내리지 말고 증거만 남긴다.
//
// 배경: measure_xg_europe.ts 1차 실행에서 understat 리그 페이지가 18KB 껍데기로 바뀐 것을
// 확인했다(제목은 정상, JSON.parse 주입 변수 0개, #preloader/#table-preloader만 있고
// 데이터는 js/league.min.js가 AJAX로 불러옴). 예전엔 datesData가 HTML에 인라인이었다.
//
// 두 갈래를 한 번에 본다.
//   A) understat league.min.js 안의 AJAX 엔드포인트 - 뚫리면 4리그 4시즌을 싸게 받는다.
//   B) FotMob 경기 상세의 xG - 우리 레포에 이미 fetchNextData/fetchMatchCorners 배관이 있다.
//      대신 경기별로 1요청이라 4,300경기면 비싸다. 먼저 "과거 경기에 xG가 실제로 있는가"만 본다.
//
// 실행: npx tsx scripts/probe_xg_sources.ts
const UA = { "user-agent": "Mozilla/5.0", "accept-language": "en" };

async function get(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: `FETCH ERROR: ${(e as Error).message}` };
  }
}

async function probeUnderstat() {
  console.log("═══ A) understat league.min.js 엔드포인트 ═══");
  const js = await get("https://understat.com/js/league.min.js");
  console.log(`league.min.js: HTTP ${js.status}, ${js.body.length}B`);
  if (!js.ok) {
    console.log("  받지 못했다. 여기서 A안은 확인 불가.");
    return;
  }
  // 코드 안의 경로 문자열을 전부 뽑는다(난독화돼 있어도 URL 리터럴은 대개 남는다).
  const paths = [...new Set([...js.body.matchAll(/["'](\/[a-zA-Z0-9_\-/]{3,}?)["']/g)].map((m) => m[1]))];
  console.log(`  코드 내 경로 리터럴 ${paths.length}개: ${paths.slice(0, 40).join(" | ")}`);
  const urlish = [...new Set([...js.body.matchAll(/url\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]))];
  console.log(`  ajax url: 리터럴: ${urlish.length ? urlish.join(" | ") : "(없음)"}`);

  // 후보 엔드포인트를 실제로 두드려 본다. 응답을 보고 판단하려는 것이지, 되리라 가정하지 않는다.
  for (const p of ["/main/getLeagueMatches/", "/main/getLeagueChemp/", "/main/getDatesData/"]) {
    const r = await get(`https://understat.com${p}`, {
      "x-requested-with": "XMLHttpRequest",
      "content-type": "application/x-www-form-urlencoded",
    });
    console.log(`  POST후보 GET ${p}: HTTP ${r.status}, ${r.body.length}B, 앞120자: ${r.body.slice(0, 120).replace(/\s+/g, " ")}`);
  }
}

async function probeFotmob() {
  console.log("\n═══ B) FotMob 경기 상세 xG ═══");
  // 먼저 EPL 리그 페이지에서 지난 경기 ID를 하나 얻는다(하드코딩한 ID를 찍지 않기 위해).
  const lg = await get("https://www.fotmob.com/ko/leagues/47/matches/premier-league");
  console.log(`EPL matches 페이지: HTTP ${lg.status}, ${lg.body.length}B`);
  const m = lg.body.match(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    console.log("  __NEXT_DATA__ 없음. FotMob도 구조가 바뀌었을 수 있다.");
    return;
  }
  let ids: number[] = [];
  try {
    const json = JSON.parse(m[1]);
    const s = JSON.stringify(json);
    ids = [...new Set([...s.matchAll(/"id":"?(\d{7})"?/g)].map((x) => Number(x[1])))].slice(0, 3);
  } catch (e) {
    console.log(`  __NEXT_DATA__ 파싱 실패: ${(e as Error).message}`);
    return;
  }
  console.log(`  후보 matchId: ${ids.join(", ")}`);
  for (const id of ids) {
    const r = await get(`https://www.fotmob.com/match/${id}`);
    const has = /expected goals|Expected goals|xG/i.test(r.body);
    console.log(`  match ${id}: HTTP ${r.status}, ${r.body.length}B, xG 문자열 ${has ? "있음" : "없음"}`);
    if (has) {
      const ctx = r.body.match(/.{0,80}[Ee]xpected goals.{0,160}/)?.[0];
      console.log(`    주변: ${ctx?.replace(/\s+/g, " ")}`);
    }
  }
}

async function main() {
  await probeUnderstat();
  await probeFotmob();
  console.log("\n※ 위 출력은 조사 결과일 뿐이다. 어느 쪽도 뚫리지 않았으면 xG 유럽 확장은 보류다.");
}

main();
