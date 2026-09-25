// GitHub Actions 러너에서 wisetoto.com의 해외 북메이커 배당(오버라운드 제거 암시확률)을 수집해
// Cloudflare Worker의 관리자 API로 전송한다. 세션/로그인 없이 순수 GET으로 동작한다.
const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };
// get_toto_list.htm은 X-Requested-With가 없으면 403("잘못된 접근입니다.[code:gtoto_xrw]")이다.
// 2026-09-24 실측(seed/wisetoto_403_probe.txt). 엔드포인트로 갈라 붙인다 - index.htm에
// 붙이는 조합은 검증하지 않았다.
const AJAX_HEADERS = { ...HEADERS, "X-Requested-With": "XMLHttpRequest" };
const headersFor = (u) => (String(u).includes("/util/gameinfo/") ? AJAX_HEADERS : HEADERS);


async function fetchText(url) {
  const res = await fetch(url, { headers: headersFor(url) });
  if (!res.ok) throw new Error(`fetch 실패 ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

// 앱에 등록된 회차번호를 명시해 그 회차를 조회한다. game_round 없이 index.htm을 부르면
// wisetoto의 "기본 회차"가 나오는데, 이월(1등 미배출) 등의 사정으로 최신 발매회차보다
// 뒤처질 수 있음이 실측됐다(src/lib/wisetoto.ts 주석 참고). 그러면 팀명 대조가 전부
// 실패해 "매칭된 배당 없음"으로 조용히 끝나서, 배당이 없는 건지 엉뚱한 회차를 본 건지
// 구분되지 않는다. 그래서 우리가 아는 회차번호를 그대로 물어본다.
async function findRoundMasterSeq(gameYear, gameRound) {
  const url = `https://www.wisetoto.com/index.htm?tab_type=toto&game_type=sc&game_category=sc1&game_year=${gameYear}&game_round=${gameRound}`;
  const html = await fetchText(url);
  const m = html.match(/'toto','sc1','(\d+)','(\d+)','','','(\d+)',now_sports/);
  // 발매 전 회차는 master_seq가 "0"으로 온다. 문자열 "0"은 truthy라 따로 걸러야 한다.
  return m && m[3] && Number(m[3]) !== 0 ? m[3] : null;
}

// round_no를 모르는 회차(수동 생성 등)를 위한 폴백.
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

// 배당을 모을 회차를 고른다. 예전엔 rounds[0](가장 최근 등록 회차) 하나만 봤는데, betman은
// 여러 회차를 동시에 발매한다. 2026-09-24에 53~57회차가 한꺼번에 등록되자 57회차만 배당을
// 받고 실제 발매중이던 55·56회차는 전 경기가 배당 없이 '근거없음(36/27/36)'으로 남았다.
// 이제는 아직 킥오프 전 경기가 하나라도 남은 진행중 회차를 전부 돈다.
// 킥오프가 지난 경기는 건드리지 않는다 - 경기 전 배당이 경기 후 값으로 덮이면 사후 비교가 오염된다.
const KICKOFF_GRACE_MS = 5 * 60 * 1000;

function isBeforeKickoff(m, now) {
  if (!m.kickoff_at) return true; // 시각을 모르면 수집 대상에 넣는다(기존 동작)
  const k = Date.parse(m.kickoff_at);
  return !Number.isFinite(k) || k - KICKOFF_GRACE_MS > now;
}

async function collectRound(round) {
  const roundRes = await fetch(`${WORKER_BASE_URL}/api/rounds/${round.id}`);
  if (!roundRes.ok) throw new Error(`/api/rounds/${round.id} 조회 실패: ${roundRes.status}`);
  const { matches } = await roundRes.json();
  const now = Date.now();
  const open = matches.filter((m) => isBeforeKickoff(m, now));
  if (open.length === 0) return { skipped: "all_kicked_off" };

  let gameYear = String(new Date().getUTCFullYear());
  let gameRound = round.round_no != null ? String(round.round_no) : null;
  let masterSeq = gameRound ? await findRoundMasterSeq(gameYear, gameRound) : null;
  if (!masterSeq) {
    if (gameRound) {
      // 회차번호를 아는데 못 찾으면 폴백하지 않는다. 여러 회차를 도는 지금은 '현재 회차'로
      // 폴백하면 다른 회차 배당을 엉뚱한 회차에 넣을 수 있다(팀명 대조가 막아주긴 하지만).
      console.log(`  ${gameRound}회차를 wisetoto에서 찾지 못해 스킵`);
      return { skipped: "not_found" };
    }
    const cur = await discoverCurrentRound();
    ({ gameYear, gameRound, masterSeq } = cur);
    console.log(`  회차번호 없는 회차(id=${round.id}) - wisetoto 현재 회차 ${gameRound}로 폴백`);
  }
  console.log(`wisetoto ${gameRound}회차 조회 (${gameYear}년, master_seq=${masterSeq}, 킥오프 전 ${open.length}경기)`);

  const games = await fetchGameList(gameYear, gameRound, masterSeq);
  const bySig = new Map(open.map((m) => [`${normalizeTeamName(m.home)}|${normalizeTeamName(m.away)}`, m.seq]));

  const oddsPayload = [];
  for (const g of games) {
    const seq = bySig.get(`${normalizeTeamName(g.home)}|${normalizeTeamName(g.away)}`);
    if (!seq) continue; // 킥오프가 지났거나 회차 매치가 안 되는 경기
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
    console.log("  매칭된 배당 데이터가 없어 저장을 건너뜁니다.");
    return { written: 0 };
  }

  const writeRes = await fetch(`${WORKER_BASE_URL}/api/admin/rounds/${round.id}/market-odds`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ odds: oddsPayload }),
  });
  if (!writeRes.ok) throw new Error(`저장 실패: ${writeRes.status} ${await writeRes.text()}`);
  const result = await writeRes.json();
  console.log(`  round ${round.id}(${gameRound}회차): ${result.written}경기 배당 저장 완료`);
  return { written: result.written };
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN 환경변수가 필요합니다");

  const roundsRes = await fetch(`${WORKER_BASE_URL}/api/rounds`);
  if (!roundsRes.ok) throw new Error(`/api/rounds 조회 실패: ${roundsRes.status}`);
  const { rounds } = await roundsRes.json();
  if (!rounds || rounds.length === 0) throw new Error("등록된 회차가 없습니다");

  const targets = rounds.filter((r) => r.status === "upcoming");
  console.log(`진행중 회차 ${targets.length}개: ${targets.map((r) => r.round_no ?? `id${r.id}`).join(", ")}`);

  // 한 회차가 실패해도 나머지는 계속 모은다. 전부 끝난 뒤 실패가 있으면 잡을 실패로 표시한다.
  const failures = [];
  for (const round of targets) {
    try {
      await collectRound(round);
    } catch (e) {
      console.error(`  ${round.round_no}회차 실패: ${e.message}`);
      failures.push(round.round_no ?? round.id);
    }
  }
  if (failures.length > 0) throw new Error(`배당 수집 실패 회차: ${failures.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
