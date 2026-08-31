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

  // 실제 엔드포인트 이름을 알았으니(getLeagueData/) 호출부 주변 코드를 그대로 찍어
  // 어떤 파라미터를 보내는지 본다. 파라미터를 추측해서 두드리면 404를 신호로 오해한다.
  const i = js.body.indexOf("getLeagueData/");
  if (i >= 0) {
    console.log(`  --- getLeagueData/ 호출부 주변 ---`);
    console.log(js.body.slice(Math.max(0, i - 700), i + 700));
    console.log(`  --- 끝 ---`);
  }

  // 파라미터 없이 한 번, 그리고 리그/시즌을 넣어 한 번 POST해 본다.
  for (const [label, body] of [
    ["빈 body", ""],
    ["league+season", "league=EPL&season=2024"],
  ] as [string, string][]) {
    try {
      const res = await fetch("https://understat.com/getLeagueData/", {
        method: "POST",
        headers: { ...UA, "x-requested-with": "XMLHttpRequest", "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const t = await res.text();
      console.log(`  POST getLeagueData/ [${label}]: HTTP ${res.status}, ${t.length}B`);
      console.log(`    앞 400자: ${t.slice(0, 400).replace(/\s+/g, " ")}`);
    } catch (e) {
      console.log(`  POST getLeagueData/ [${label}]: ERROR ${(e as Error).message}`);
    }
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
  // 앞선 시도는 __NEXT_DATA__에서 아무 7자리 "id"나 긁어서 전부 404였다(팀/선수 ID였다).
  // 페이지의 실제 경기 링크(/match/<id>/ 또는 matchId 필드)에서만 뽑는다.
  const linkIds = [...new Set([...lg.body.matchAll(/\/match(?:es)?\/(\d{6,8})/g)].map((x) => Number(x[1])))];
  const fieldIds = [...new Set([...lg.body.matchAll(/"matchId":\s*"?(\d{6,8})"?/g)].map((x) => Number(x[1])))];
  const ids = [...new Set([...linkIds, ...fieldIds])].slice(0, 3);
  console.log(`  경기 링크에서 ${linkIds.length}개, matchId 필드에서 ${fieldIds.length}개 -> 시도: ${ids.join(", ") || "(없음)"}`);
  if (ids.length === 0) {
    console.log("  경기 ID를 못 찾았다. FotMob 경로는 여기서 확인 불가.");
    return;
  }
  for (const id of ids) {
    const r = await get(`https://www.fotmob.com/match/${id}`);
    // 404 페이지에도 i18n 라벨로 "Expected goals" 문자열이 들어 있어서, 문자열 존재만으로는
    // 판단하면 안 된다(1차 조사에서 실제로 이 함정에 빠졌다). HTTP 상태를 먼저 본다.
    console.log(`  match ${id}: HTTP ${r.status}, ${r.body.length}B`);
    if (r.status !== 200) {
      console.log("    404/에러 - 이 ID는 유효한 경기가 아니다.");
      continue;
    }
    const stat = r.body.match(/"expected_goals"\s*:\s*\{[^}]{0,300}/)?.[0]
      ?? r.body.match(/.{0,60}xG.{0,200}/)?.[0];
    console.log(`    xG 관련 데이터: ${stat ? stat.replace(/\s+/g, " ") : "(없음)"}`);
  }
}

async function main() {
  await probeUnderstat();
  await probeFotmob();
  console.log("\n※ 위 출력은 조사 결과일 뿐이다. 어느 쪽도 뚫리지 않았으면 xG 유럽 확장은 보류다.");
}

main();
