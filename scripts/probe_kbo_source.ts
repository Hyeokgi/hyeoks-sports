// KBO 경기 결과를 3시즌 이상 확보할 수 있는 소스를 찾는다.
//
// 배경: measure_baseball.ts에서 네이버 스포츠 스케줄 API를 썼는데 size 파라미터와 무관하게
// 시즌당 10건만 돌아와 3시즌 합쳐 25경기밖에 못 모았다. 그래서 야구 분석의 "한국" 절반은
// 현재 데이터가 아예 없는 상태다. MLB는 statsapi로 7,290경기가 확보돼 있다.
//
// 이 스크립트는 후보 소스를 하나씩 두드려 "무엇이 돌아왔는지"만 기록한다. 결론을 내지 않는다.
// 파싱을 자작해서 0건을 "데이터 없음"으로 오판할 뻔한 전례가 이 레포에 두 번 있었으므로
// (47회차 배당, FotMob 경기ID), 각 단계에서 응답 원문 일부와 구조를 그대로 찍는다.
//
// 확인해야 할 것
//   1) HTTP로 접근이 되는가 (러너 IP 기준)
//   2) 한 번에 몇 경기가 오는가 - 페이지네이션이 있으면 그 방법
//   3) 필요한 필드가 다 있는가: 날짜 / 홈팀 / 원정팀 / 홈점수 / 원정점수
//   4) 몇 시즌까지 거슬러 올라가는가
//
// 실행: npx tsx scripts/probe_kbo_source.ts   (러너 전용)
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};
const T = 25000;

async function get(url: string, init: RequestInit = {}) {
  try {
    const res = await fetch(url, { headers: { ...UA, ...(init.headers ?? {}) }, ...init, signal: AbortSignal.timeout(T) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, ctype: res.headers.get("content-type") ?? "" };
  } catch (e) {
    return { ok: false, status: 0, body: `ERROR: ${(e as Error).message}`, ctype: "" };
  }
}
const brief = (s: string, n = 240) => s.slice(0, n).replace(/\s+/g, " ");

// 응답에서 "경기 같아 보이는 것"이 몇 건인지 세는 공통 잣대.
// 구조를 모르는 상태에서 배열을 찾아야 하므로, 스코어처럼 보이는 키를 가진 객체를 센다.
function countGameLikeObjects(json: any): { count: number; sample: any | null; path: string } {
  let best = { count: 0, sample: null as any, path: "" };
  const scoreKeys = ["homeTeamScore", "awayTeamScore", "hScore", "aScore", "home_score", "away_score"];
  const walk = (node: any, path: string) => {
    if (Array.isArray(node)) {
      const hits = node.filter((x) => x && typeof x === "object" && scoreKeys.some((k) => k in x));
      if (hits.length > best.count) best = { count: hits.length, sample: hits[0], path };
      node.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(json, "");
  return best;
}

async function probeNaver() {
  console.log("\n" + "=".repeat(74));
  console.log("A. 네이버 스포츠 (기존에 10건만 받던 곳 - 페이지네이션을 찾는다)");
  console.log("=".repeat(74));
  const base = "https://api-gw.sports.naver.com/schedule/games";
  const variants: [string, string][] = [
    ["기존 방식(size=2000)", `${base}?upperCategoryId=kbaseball&categoryId=kbo&fromDate=2024-04-01&toDate=2024-04-30&size=2000`],
    ["size 없음", `${base}?upperCategoryId=kbaseball&categoryId=kbo&fromDate=2024-04-01&toDate=2024-04-30`],
    ["page+size", `${base}?upperCategoryId=kbaseball&categoryId=kbo&fromDate=2024-04-01&toDate=2024-04-30&page=1&size=100`],
    ["하루만", `${base}?upperCategoryId=kbaseball&categoryId=kbo&fromDate=2024-04-06&toDate=2024-04-06&size=100`],
    ["월별 엔드포인트", `https://api-gw.sports.naver.com/schedule/calendar?upperCategoryId=kbaseball&categoryId=kbo&yearMonth=2024-04`],
  ];
  for (const [label, url] of variants) {
    const r = await get(url, { headers: { Referer: "https://m.sports.naver.com/" } });
    if (!r.ok) {
      console.log(`  ${label.padEnd(18)} HTTP ${r.status}  ${brief(r.body, 100)}`);
      continue;
    }
    let json: any = null;
    try { json = JSON.parse(r.body); } catch { /* not json */ }
    if (!json) { console.log(`  ${label.padEnd(18)} HTTP 200이나 JSON 아님 (${r.body.length}B): ${brief(r.body, 100)}`); continue; }
    const found = countGameLikeObjects(json);
    console.log(`  ${label.padEnd(18)} HTTP 200  스코어키 보유 객체 ${found.count}건  경로=${found.path || "(없음)"}`);
    if (found.sample) console.log(`    샘플: ${JSON.stringify(found.sample).slice(0, 220)}`);
    else console.log(`    최상위 키: ${Object.keys(json).join(", ")}`);
  }
  // 한 달치가 되면 시즌 전체는 월 단위 반복으로 모을 수 있다. 그 가정이 맞는지 4월 전체로 확인.
  console.log("\n  -> 하루/한달 단위로 나눠 받으면 시즌 전체를 모을 수 있는지가 관건이다.");
}

async function probeKboOfficial() {
  console.log("\n" + "=".repeat(74));
  console.log("B. KBO 공식 (koreabaseball.com)");
  console.log("=".repeat(74));
  const urls: [string, string][] = [
    ["일정/결과 페이지", "https://www.koreabaseball.com/Schedule/Schedule.aspx"],
    ["게임센터 스코어", "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx"],
  ];
  for (const [label, url] of urls) {
    const r = await get(url);
    console.log(`  ${label.padEnd(18)} HTTP ${r.status}  ${r.body.length}B  ${r.ctype}`);
    if (r.ok) {
      // ASP.NET 페이지는 대개 __VIEWSTATE + 비동기 POST 구조다. 그 흔적을 확인한다.
      const hasVs = r.body.includes("__VIEWSTATE");
      const hasAjax = /ScriptResource|WebForm_DoPost|__doPostBack/.test(r.body);
      const scoreish = (r.body.match(/<td[^>]*>\s*\d+\s*<\/td>/g) ?? []).length;
      console.log(`    __VIEWSTATE ${hasVs ? "있음" : "없음"} / 비동기포스트 흔적 ${hasAjax ? "있음" : "없음"} / 숫자셀 ${scoreish}개`);
      const title = r.body.match(/<title[^>]*>([\s\S]{0,80}?)<\/title>/i)?.[1]?.trim();
      console.log(`    <title>: ${title ?? "(없음)"}`);
    }
  }
}

async function probeStatiz() {
  console.log("\n" + "=".repeat(74));
  console.log("C. 스탯티즈 (statiz.sporki.com)");
  console.log("=".repeat(74));
  const urls: [string, string][] = [
    ["일정 페이지", "https://statiz.sporki.com/schedule/?m=daily&date=20240406"],
    ["메인", "https://statiz.sporki.com/"],
  ];
  for (const [label, url] of urls) {
    const r = await get(url);
    console.log(`  ${label.padEnd(14)} HTTP ${r.status}  ${r.body.length}B  ${r.ctype}`);
    if (r.ok) {
      const title = r.body.match(/<title[^>]*>([\s\S]{0,80}?)<\/title>/i)?.[1]?.trim();
      console.log(`    <title>: ${title ?? "(없음)"}`);
      // 스코어가 들어있을 법한 흔적
      const vs = (r.body.match(/vs|:\s*\d+/g) ?? []).length;
      console.log(`    앞 300자: ${brief(r.body, 300)}`);
    }
  }
}

async function probeMisc() {
  console.log("\n" + "=".repeat(74));
  console.log("D. 기타 후보");
  console.log("=".repeat(74));
  const urls: [string, string][] = [
    ["다음 스포츠 API", "https://sports.daum.net/prx/hermes/api/game/schedule.json?leagueCode=kbo&fromDate=2024-04-01&toDate=2024-04-30"],
    ["MyKBOstats", "https://mykbostats.com/schedule/2024-04"],
    ["ESPN KBO", "https://site.api.espn.com/apis/site/v2/sports/baseball/kbo/scoreboard?dates=20240406"],
  ];
  for (const [label, url] of urls) {
    const r = await get(url);
    console.log(`  ${label.padEnd(16)} HTTP ${r.status}  ${r.body.length}B  ${r.ctype}`);
    if (!r.ok) { console.log(`    ${brief(r.body, 120)}`); continue; }
    let json: any = null;
    try { json = JSON.parse(r.body); } catch { /* html */ }
    if (json) {
      const found = countGameLikeObjects(json);
      console.log(`    JSON. 스코어키 객체 ${found.count}건. 최상위 키: ${Object.keys(json).join(", ").slice(0, 160)}`);
      if (found.sample) console.log(`    샘플: ${JSON.stringify(found.sample).slice(0, 200)}`);
      // ESPN 구조는 events[] 이므로 따로 본다
      if (Array.isArray(json.events)) console.log(`    events 배열 ${json.events.length}건`);
    } else {
      const title = r.body.match(/<title[^>]*>([\s\S]{0,80}?)<\/title>/i)?.[1]?.trim();
      console.log(`    HTML. <title>: ${title ?? "(없음)"}`);
      console.log(`    앞 200자: ${brief(r.body, 200)}`);
    }
  }
}

async function main() {
  console.log("KBO 경기 결과 소스 조사 - 각 후보가 실제로 무엇을 주는지만 기록한다.");
  console.log("필요 조건: 날짜/홈팀/원정팀/홈점수/원정점수, 3시즌 이상, 시즌당 720경기 수집 가능");
  await probeNaver();
  await probeKboOfficial();
  await probeStatiz();
  await probeMisc();
  console.log("\n" + "=".repeat(74));
  console.log("위는 조사 결과일 뿐이다. 어느 소스가 쓸 만한지는 이 출력을 보고 판단한다.");
  console.log("HTTP 200이어도 경기 배열을 못 찾으면 '없다'가 아니라 '구조를 아직 모른다'는 뜻이다.");
}
main();
