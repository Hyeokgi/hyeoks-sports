// 발매중 회차를 Worker 배포/D1 백필 없이 러너에서 직접 분석해 독식 지향 픽을 출력한다.
// (npx tsx scripts/offline_round_pick.ts, GitHub Actions offline-pick job에서 실행)
//
// 46회차(EPL/세리에A)처럼 "코드에는 리그가 편입됐지만 아직 배포/백필 전"인 회차를 위해:
// - 히스토리: seed/backfill_epl_seriea.json (backfill 워크플로우가 커밋한 산출물)
// - 경기목록/배당: wisetoto (src/lib/wisetoto + fetch_market_odds.mjs와 동일 파싱)
// - 투표율: betman (fetch_vote_share.mjs와 동일 Playwright 가로채기)
// - 모델/픽: src/lib prediction/exclusivePick 공유 (웹앱과 동일 로직, 중복 구현 금지)
import { readFileSync } from "node:fs";
import { discoverRoundMasterSeq, fetchRoundFixtures } from "../src/lib/wisetoto";
import { NAME_MAP, leagueOfKr } from "../src/lib/nameMap";
import { computeEloAndHistory, recentForm, h2hDiff as computeH2hDiff, leagueDrawRate, type MatchRow } from "../src/lib/elo";
import { predictMatch, DEFAULT_TOGGLES, FALLBACK_DRAW_RATE } from "../src/lib/prediction";
import { generateExclusivePick, type ExclusiveMatchInput } from "../src/lib/exclusivePick";

const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`fetch 실패 ${res.status}: ${url}`);
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
}

// fetch_market_odds.mjs discoverCurrentRound와 동일 - 발매중 회차 자동 감지(ROUND_NO로 재정의 가능)
async function discoverCurrentRound(): Promise<{ gameYear: string; gameRound: string }> {
  const html = await fetchText("https://www.wisetoto.com/index.htm?tab_type=toto&game_type=sc&game_category=sc1");
  const m = html.match(/'toto','sc1','(\d+)','(\d+)','','','(\d+)',now_sports/);
  if (!m) throw new Error("현재 회차를 index.htm에서 찾지 못함");
  return { gameYear: m[1], gameRound: m[2] };
}

// fetch_market_odds.mjs fetchGameList/fetchOdds와 동일 파싱
async function fetchGameList(gameYear: string, gameRound: string, masterSeq: string) {
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
  const games: { gameNo: number; home: string; away: string; scheduleInfoSeq: string }[] = [];
  const blockRe =
    /<div class="sub1_1">(\d+)<\/div>[\s\S]*?class="stu">([^<]+)<\/a>[\s\S]*?class="stu">([^<]+)<\/a>[\s\S]*?get_gameinfo_detail\('(\d+)','\d+','sc1'/g;
  let m;
  while ((m = blockRe.exec(html))) {
    games.push({ gameNo: Number(m[1]), home: m[2].trim(), away: m[3].trim(), scheduleInfoSeq: m[4] });
  }
  return games;
}

async function fetchOdds(scheduleInfoSeq: string) {
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
  const oddsRows: number[][] = [];
  for (const row of rows) {
    const nums = [...row.matchAll(/class="dividend[^"]*">\s*([\d.]+)/g)].map((x) => Number(x[1]));
    if (nums.length === 3) oddsRows.push(nums);
  }
  if (oddsRows.length === 0) return null;
  const avg = [0, 1, 2].map((i) => oddsRows.reduce((s, r) => s + r[i], 0) / oddsRows.length);
  const inv = avg.map((o) => 1 / o);
  const total = inv.reduce((s, x) => s + x, 0);
  return { pHome: inv[0] / total, pDraw: inv[1] / total, pAway: inv[2] / total, nBookmakers: oddsRows.length };
}

function normalizeTeamName(name: string): string {
  return (name ?? "").replace(/\s+/g, "").replace(/FC$|FC1995$|2008$/i, "");
}

// fetch_vote_share.mjs와 동일: betman gameInfoInq 응답을 Playwright로 가로채 투표(매수)율 추출
async function fetchBetmanVotes(roundNo: number): Promise<Map<string, { home: number; draw: number; away: number }>> {
  const result = new Map<string, { home: number; draw: number; away: number }>();
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("(playwright 미설치 - betman 투표율 수집 스킵)");
    return result;
  }
  const gmTs = Number(`26${String(roundNo).padStart(4, "0")}`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    let gameInfo: any = null;
    page.on("response", async (res) => {
      if (res.url().includes("/buyPsblGame/gameInfoInq.do") && res.request().method() === "POST") {
        try {
          const json = await res.json();
          if (json?.gmTs === gmTs) gameInfo = json;
        } catch {
          // JSON이 아닌 응답(에러 페이지 등)은 무시
        }
      }
    });
    await page.goto(`https://www.betman.co.kr/main/mainPage/gamebuy/gameSlip.do?gmId=G011&gmTs=${gmTs}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(1500);

    const schedules = gameInfo?.schedulesList ?? [];
    const voteStatusList = gameInfo?.voteStatus?.homeVoteStatusList ?? [];
    schedules.forEach((s: any, i: number) => {
      const counts = voteStatusList[i]?.awayVoteStatusList?.map((v: any) => v.voteCount) ?? [];
      if (counts.length !== 3) return;
      const total = counts[0] + counts[1] + counts[2];
      if (total <= 0) return;
      result.set(`${normalizeTeamName(s.homeName)}|${normalizeTeamName(s.awayName)}`, {
        home: (counts[0] / total) * 100,
        draw: (counts[1] / total) * 100,
        away: (counts[2] / total) * 100,
      });
    });
  } catch (err) {
    console.log(`(betman 투표율 수집 실패 - ${(err as Error).message})`);
  } finally {
    await browser.close();
  }
  return result;
}

async function main() {
  const history: MatchRow[] = JSON.parse(readFileSync("seed/backfill_epl_seriea.json", "utf-8"));
  const { elo, teamHistory, h2h } = computeEloAndHistory(history);
  const drawRates = new Map<string, number>();
  for (const lg of new Set(history.map((m) => m.league))) drawRates.set(lg, leagueDrawRate(history, lg));

  const { gameYear, gameRound } = process.env.ROUND_NO
    ? { gameYear: String(new Date().getUTCFullYear()), gameRound: process.env.ROUND_NO }
    : await discoverCurrentRound();
  const masterSeq = await discoverRoundMasterSeq(gameYear, gameRound);
  if (!masterSeq) throw new Error(`${gameRound}회차가 wisetoto에 아직 없습니다`);

  const fixtures = await fetchRoundFixtures(gameYear, gameRound, masterSeq);
  if (fixtures.length === 0) throw new Error("경기목록을 가져오지 못했습니다");
  console.log(`${gameRound}회차 ${fixtures.length}경기 (wisetoto master_seq=${masterSeq})`);

  const games = await fetchGameList(gameYear, gameRound, masterSeq);
  const oddsBySig = new Map<string, NonNullable<Awaited<ReturnType<typeof fetchOdds>>>>();
  for (const g of games) {
    const odds = await fetchOdds(g.scheduleInfoSeq);
    if (odds) oddsBySig.set(`${normalizeTeamName(g.home)}|${normalizeTeamName(g.away)}`, odds);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`해외배당 수집: ${oddsBySig.size}/${fixtures.length}경기`);

  const votesBySig = await fetchBetmanVotes(Number(gameRound));
  console.log(`betman 투표율 수집: ${votesBySig.size}/${fixtures.length}경기`);

  const inputs: ExclusiveMatchInput[] = [];
  const evidence: string[] = [];
  for (const f of fixtures) {
    const homeEn = NAME_MAP[f.homeKr];
    const awayEn = NAME_MAP[f.awayKr];
    const league = leagueOfKr(f.homeKr);
    if (!homeEn || !awayEn) {
      console.log(`  스킵(NAME_MAP 없음): ${f.seq}. ${f.homeKr} vs ${f.awayKr}`);
      continue;
    }
    const sig = `${normalizeTeamName(f.homeKr)}|${normalizeTeamName(f.awayKr)}`;
    const homeState = elo.get(`${league}|${homeEn}`);
    const awayState = elo.get(`${league}|${awayEn}`);
    const eloDiff = (homeState?.elo ?? 1500) - (awayState?.elo ?? 1500);
    const formHome = recentForm(teamHistory, league, homeEn);
    const formAway = recentForm(teamHistory, league, awayEn);
    const h2h_ = computeH2hDiff(h2h, league, homeEn, awayEn);
    const nHome = (teamHistory.get(`${league}|${homeEn}`) ?? []).length;
    const nAway = (teamHistory.get(`${league}|${awayEn}`) ?? []).length;

    const market = oddsBySig.get(sig) ?? null;
    const prediction = predictMatch(
      {
        eloDiff,
        formDiff: formHome.avgPts - formAway.avgPts,
        h2hDiff: h2h_.diff,
        leagueDrawRate: drawRates.get(league) ?? FALLBACK_DRAW_RATE,
        marketOdds: market,
        xgDiff: null,
        cornersDiff: null,
        league,
      },
      DEFAULT_TOGGLES,
    );
    const vote = votesBySig.get(sig) ?? null;
    inputs.push({ seq: f.seq, league, home: f.homeKr, away: f.awayKr, prediction, voteShare: vote });
    evidence.push(
      `${String(f.seq).padStart(2)}. Elo차 ${eloDiff.toFixed(0)} / 폼차 ${(formHome.avgPts - formAway.avgPts).toFixed(2)} / H2H ${h2h_.diff.toFixed(2)}(n=${h2h_.n}) / 히스토리 ${nHome}·${nAway}경기` +
        (market ? ` / 배당(${market.nBookmakers}개사) ${(market.pHome * 100).toFixed(0)}-${(market.pDraw * 100).toFixed(0)}-${(market.pAway * 100).toFixed(0)}` : " / 배당 없음"),
    );
  }

  const maxUpsets = process.env.MAX_UPSETS ? Number(process.env.MAX_UPSETS) : undefined;
  const result = generateExclusivePick(inputs, maxUpsets != null ? { maxUpsets } : {});

  console.log(`\n===== ${gameRound}회차 독식 지향 픽 (오프라인 분석) =====\n`);
  for (const p of result.picks) {
    const probs = inputs.find((i) => i.seq === p.seq)!.prediction;
    const vote = p.votePct != null ? `투표 ${p.votePct.toFixed(1)}%` : "투표율 없음";
    const mark = p.isUpset ? ` ★이변 (기본픽 ${p.basePick})` : "";
    console.log(
      `${String(p.seq).padStart(2)}. [${p.league}] ${p.home} vs ${p.away} → ${p.pick}${mark}\n` +
        `    모델 홈${(probs.pHome * 100).toFixed(0)}/무${(probs.pDraw * 100).toFixed(0)}/원정${(probs.pAway * 100).toFixed(0)}% · 픽확률 ${(p.modelProb * 100).toFixed(0)}% · ${vote}`,
    );
  }
  console.log(`\n[근거]`);
  for (const e of evidence) console.log(e);
  console.log(`\n이변 반영: ${result.upsetCount}경기 / 투표율 수집: ${result.matchesWithVote}/${result.picks.length}경기`);
  console.log(`적중확률(모델, 독립 근사): 기본픽 대비 ${(result.probRetention * 100).toFixed(0)}% 유지`);
  if (result.payoutEdge != null && result.pickCrowdShare != null && result.baseCrowdShare != null) {
    console.log(
      `대중 동일조합 구매비중 추정: 기본픽 ${(result.baseCrowdShare * 1e6).toFixed(2)}/백만 → 독식픽 ${(result.pickCrowdShare * 1e6).toFixed(2)}/백만`,
    );
    console.log(`기대 배당가치(기본픽 대비): ${result.payoutEdge.toFixed(1)}배`);
  }
  console.log(`\n${result.note}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
