// KBO 정규시즌만 남기려면 "이 경기가 시범경기/정규/포스트시즌 중 무엇인가"를 알아야 한다.
//
// 1차 수집에서 드러난 사실(fetch_kbo_history.ts 실행 로그):
//   게임 객체 키 = gameId, categoryId, gameDate, gameDateTime, homeTeamCode, homeTeamName,
//     homeTeamScore, awayTeamCode, awayTeamName, awayTeamScore, winner, statusCode,
//     statusInfo, cancel, suspended, reversedHomeAway, homeTeamEmblemUrl, awayTeamEmblemUrl, widgetEnable
//   -> 시리즈를 가리키는 필드가 하나도 없다. seriesId/seriesName은 존재하지 않는다(?|? 2643건).
//
// 그래서 후보를 다섯 갈래로 두드려 "무엇이 돌아왔는지"만 찍는다. 결론을 내지 않는다.
// 날짜로 자르는 건 최후 수단이다 - 연도마다 개막/종료일이 다르고, 그 경계를 내가 기억으로
// 적어 넣으면 조용히 틀릴 수 있다. 경계를 데이터에서 얻을 수 있는 길을 먼저 찾는다.
//
//   A result 최상위 - games 말고 무엇이 더 오는가(메타에 시즌 구분이 있을 수 있다)
//   B categoryId 목록 - 시범경기/포스트시즌이 별도 카테고리인가
//   C gameId 형식 - 경계(3월 초 / 10~11월) 경기들의 ID를 나란히 놓고 규칙이 보이는지
//   D 경기 상세 API - 상세에는 시리즈 필드가 있을 수 있다. 시범/정규/한국시리즈 3건을 비교
//   E 날짜별 경기 수 분포 - 정규시즌은 하루 5경기가 규칙적, 포스트시즌은 1~2경기
//
// 실행: npx tsx scripts/probe_kbo_series.ts   (러너 전용 - 샌드박스는 네이버 차단)

import { writeFileSync } from "node:fs";

// 출력을 파일로도 남긴다. 조사 결과는 Actions 로그 스크롤백이 아니라 레포에 남아야
// 나중에 "그때 뭐가 나왔더라"를 다시 돌리지 않는다.
const OUT = "seed/kbo_series_probe.txt";
const lines: string[] = [];
const say = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  lines.push(s);
  say(s);
};

const UA = { "User-Agent": "Mozilla/5.0", Referer: "https://m.sports.naver.com/" };

async function get(url: string): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: `ERR ${(e as Error).message}` };
  }
}

function j(body: string): any {
  try { return JSON.parse(body); } catch { return null; }
}

async function schedule(from: string, to: string, page = 1, size = 100) {
  const url =
    `https://api-gw.sports.naver.com/schedule/games?upperCategoryId=kbaseball&categoryId=kbo` +
    `&fromDate=${from}&toDate=${to}&page=${page}&size=${size}`;
  const r = await get(url);
  return { url, ...r, json: j(r.body) };
}

async function main() {
  say("=".repeat(70));
  say("A. schedule 응답의 result 최상위 구조");
  say("=".repeat(70));
  {
    const r = await schedule("2023-03-01", "2023-11-30", 1, 5);
    say(`HTTP ${r.status}`);
    const top = r.json ? Object.keys(r.json) : [];
    say(`최상위 키: ${top.join(", ")}`);
    const result = r.json?.result;
    if (result) {
      say(`result 키: ${Object.keys(result).join(", ")}`);
      // games를 뺀 나머지를 통째로 찍는다. 시즌 구분 메타가 있으면 여기 있다.
      const { games, ...rest } = result;
      say(`result(games 제외): ${JSON.stringify(rest).slice(0, 1500)}`);
    } else {
      say(`result 없음. 원문 앞부분: ${r.body.slice(0, 600)}`);
    }
  }

  say("\n" + "=".repeat(70));
  say("B. 카테고리 목록 - 시범경기/포스트시즌이 별도 categoryId인가");
  say("=".repeat(70));
  for (const url of [
    "https://api-gw.sports.naver.com/schedule/categories?upperCategoryId=kbaseball",
    "https://api-gw.sports.naver.com/schedule/category/kbaseball",
    "https://api-gw.sports.naver.com/schedule/leagues?upperCategoryId=kbaseball",
  ]) {
    const r = await get(url);
    say(`\n${url}\n  HTTP ${r.status}  ${r.body.length}B  ${r.body.slice(0, 400)}`);
  }

  say("\n" + "=".repeat(70));
  say("C. 경계 구간 gameId 형식 (시범 / 정규 / 포스트시즌)");
  say("=".repeat(70));
  const windows: Array<[string, string, string]> = [
    ["시범경기 의심", "2023-03-01", "2023-03-25"],
    ["정규 한복판", "2023-06-01", "2023-06-05"],
    ["정규 끝~포스트", "2023-10-10", "2023-11-30"],
  ];
  const samples: Record<string, any[]> = {};
  for (const [label, from, to] of windows) {
    const r = await schedule(from, to, 1, 100);
    const games: any[] = r.json?.result?.games ?? [];
    samples[label] = games;
    say(`\n[${label}] ${from}~${to}  ${games.length}건`);
    for (const g of games.slice(0, 8)) {
      say(`  ${g.gameDate} ${g.gameId}  ${g.awayTeamName}@${g.homeTeamName} ${g.awayTeamScore}:${g.homeTeamScore}  status=${g.statusCode}/${g.statusInfo}`);
    }
    if (games.length > 8) {
      say(`  ...`);
      for (const g of games.slice(-6)) {
        say(`  ${g.gameDate} ${g.gameId}  ${g.awayTeamName}@${g.homeTeamName} ${g.awayTeamScore}:${g.homeTeamScore}  status=${g.statusCode}/${g.statusInfo}`);
      }
    }
  }

  say("\n" + "=".repeat(70));
  say("D. 경기 상세 API에 시리즈 필드가 있는가");
  say("=".repeat(70));
  const probeIds = [
    samples["시범경기 의심"]?.[0]?.gameId,
    samples["정규 한복판"]?.[0]?.gameId,
    samples["정규 끝~포스트"]?.at(-1)?.gameId,
  ].filter(Boolean);
  say(`대상 gameId: ${probeIds.join(", ")}`);
  for (const id of probeIds) {
    for (const tmpl of [
      `https://api-gw.sports.naver.com/sports/games/${id}`,
      `https://api-gw.sports.naver.com/schedule/games/${id}`,
      `https://api-gw.sports.naver.com/sports/games/${id}/preview`,
    ]) {
      const r = await get(tmpl);
      const data = j(r.body);
      const keys = data?.result ? Object.keys(data.result) : data ? Object.keys(data) : [];
      say(`\n${tmpl}\n  HTTP ${r.status}  ${r.body.length}B  키: ${keys.join(", ").slice(0, 300)}`);
      // 시리즈처럼 보이는 키/값만 골라 찍는다
      const flat = r.body.toLowerCase();
      for (const kw of ["series", "seasontype", "gametype", "round", "시범", "포스트", "한국시리즈", "playoff"]) {
        const i = flat.indexOf(kw.toLowerCase());
        if (i >= 0) console.log(`  "${kw}" 발견 @${i}: ...${r.body.slice(Math.max(0, i - 80), i + 120)}...`);
      }
    }
  }

  say("\n" + "=".repeat(70));
  say("E. 날짜별 경기 수 (정규시즌은 하루 5경기가 규칙적)");
  say("=".repeat(70));
  for (const year of [2023, 2024, 2025]) {
    const perDate = new Map<string, number>();
    for (let page = 1; page <= 12; page++) {
      const r = await schedule(`${year}-03-01`, `${year}-11-30`, page, 100);
      const games: any[] = r.json?.result?.games ?? [];
      for (const g of games) perDate.set(g.gameDate, (perDate.get(g.gameDate) ?? 0) + 1);
      if (games.length < 100) break;
    }
    const dates = [...perDate.entries()].sort();
    say(`\n${year}: ${dates.length}일`);
    say(`  앞 20일: ${dates.slice(0, 20).map(([d, n]) => `${d.slice(5)}:${n}`).join(" ")}`);
    say(`  뒤 25일: ${dates.slice(-25).map(([d, n]) => `${d.slice(5)}:${n}`).join(" ")}`);
  }
}

main().then(() => {
  writeFileSync(OUT, lines.join("\n") + "\n");
  console.log(`\n${OUT}에 저장`);
});
