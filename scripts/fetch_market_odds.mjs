// GitHub Actions 러너에서 wisetoto.com의 해외 북메이커 배당(오버라운드 제거 암시확률)을 수집해
// Cloudflare Worker의 관리자 API로 전송한다. 세션/로그인 없이 순수 GET으로 동작한다.
const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`fetch 실패 ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

// game_round 파라미터 없이 요청하면 현재 발매중인 회차로 자동 응답한다.
async function discoverCurrentRound() {
  const url = "https://www.wisetoto.com/index.htm?tab_type=toto&game_type=sc&game_category=sc1";
  const html = await fetchText(url);
  const m = html.match(/'toto','sc1','(\d+)','(\d+)','','','(\d+)',now_sports/);
  if (!m) throw new Error("game_round/game_info_master_seq를 index.htm에서 찾지 못함");
  return { gameYear: m[1], gameRound: m[2], masterSeq: m[3] };
}

async function fetchGameList(gameYear, gameRound, masterSeq) {
  const url = new URL("https://www.wisetoto.com/util/gameinfo/get_toto_list.htm");
  url.searchParams.set("game_category", "sc1");
  url.searchParams.set("game_year", gameYear);
  url.searchParams.set("game_round", gameRound);
  url.searchParams.set("game_month", "");
  url.searchParams.set("game_day", "");
  url.searchParams.set("game_info_master_seq", masterSeq);
  url.searchParams.set("sports", "");
  url.searchParams.set("sort", "");
  url.searchParams.set("tab_type", "toto");
  const html = await fetchText(url.toString());

  const games = [];
  const blockRe =
    /<div class="sub1_1">(\d+)<\/div>[\s\S]*?class="stu">([^<]+)<\/a>[\s\S]*?class="stu">([^<]+)<\/a>[\s\S]*?get_gameinfo_detail\('(\d+)','\d+','sc1'/g;
  let m;
  while ((m = blockRe.exec(html))) {
    games.push({ gameNo: Number(m[1]), home: m[2].trim(), away: m[3].trim(), scheduleInfoSeq: m[4] });
  }
  return games;
}

async function fetchOdds(scheduleInfoSeq) {
  const url = new URL("https://www.wisetoto.com/util/gameinfo/get_detail_rate_info.htm");
  url.searchParams.set("schedule_info_seq", scheduleInfoSeq);
  url.searchParams.set("tab_type", "toto");
  url.searchParams.set("game_year", "");
  url.searchParams.set("game_round", "");
  url.searchParams.set("game_no", "1");
  url.searchParams.set("league_info_seq", "");
  url.searchParams.set("limit", "");
  url.searchParams.set("same_home_away", "");
  const html = await fetchText(url.toString());

  const tableMatch = html.match(/id="tab05_01"[\s\S]*?<\/table>/);
  if (!tableMatch) return null;
  const rows = tableMatch[0].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const oddsRows = [];
  for (const row of rows) {
    const nums = [...row.matchAll(/class="dividend[^"]*">\s*([\d.]+)/g)].map((m) => Number(m[1]));
    if (nums.length === 3) oddsRows.push(nums);
  }
  if (oddsRows.length === 0) return null;

  const avg = [0, 1, 2].map((i) => oddsRows.reduce((s, r) => s + r[i], 0) / oddsRows.length);
  const inv = avg.map((o) => 1 / o);
  const total = inv.reduce((s, x) => s + x, 0);
  return { pHome: inv[0] / total, pDraw: inv[1] / total, pAway: inv[2] / total, nBookmakers: oddsRows.length };
}

function normalizeTeamName(name) {
  return name.replace(/\s+/g, "").replace(/FC$|FC1995$|2008$/i, "");
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN 환경변수가 필요합니다");

  const { gameYear, gameRound, masterSeq } = await discoverCurrentRound();
  console.log(`wisetoto 현재 회차: ${gameRound} (${gameYear}년, master_seq=${masterSeq})`);

  const games = await fetchGameList(gameYear, gameRound, masterSeq);
  console.log(`${games.length}경기 발견`);

  const roundsRes = await fetch(`${WORKER_BASE_URL}/api/rounds`);
  if (!roundsRes.ok) throw new Error(`/api/rounds 조회 실패: ${roundsRes.status}`);
  const { rounds } = await roundsRes.json();
  if (!rounds || rounds.length === 0) throw new Error("등록된 회차가 없습니다");
  const round = rounds[0];

  const roundRes = await fetch(`${WORKER_BASE_URL}/api/rounds/${round.id}`);
  if (!roundRes.ok) throw new Error(`/api/rounds/${round.id} 조회 실패: ${roundRes.status}`);
  const { matches } = await roundRes.json();

  const bySig = new Map(matches.map((m) => [`${normalizeTeamName(m.home)}|${normalizeTeamName(m.away)}`, m.seq]));

  const oddsPayload = [];
  for (const g of games) {
    const seq = bySig.get(`${normalizeTeamName(g.home)}|${normalizeTeamName(g.away)}`);
    if (!seq) {
      console.log(`  스킵(회차 매치 안됨): ${g.home} vs ${g.away}`);
      continue;
    }
    const odds = await fetchOdds(g.scheduleInfoSeq);
    if (!odds) {
      console.log(`  배당 없음: ${g.home} vs ${g.away}`);
      continue;
    }
    oddsPayload.push({ seq, ...odds });
    console.log(
      `  ${seq}. ${g.home} vs ${g.away}: 홈${(odds.pHome * 100).toFixed(1)}% 무${(odds.pDraw * 100).toFixed(1)}% 원정${(odds.pAway * 100).toFixed(1)}% (${odds.nBookmakers}개사)`,
    );
    await new Promise((r) => setTimeout(r, 400));
  }

  if (oddsPayload.length === 0) {
    console.log("매칭된 배당 데이터가 없어 저장을 건너뜁니다.");
    return;
  }

  const writeRes = await fetch(`${WORKER_BASE_URL}/api/admin/rounds/${round.id}/market-odds`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ odds: oddsPayload }),
  });
  if (!writeRes.ok) throw new Error(`저장 실패: ${writeRes.status} ${await writeRes.text()}`);
  const result = await writeRes.json();
  console.log(`round ${round.id}: ${result.written}경기 배당 저장 완료`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
