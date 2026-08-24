// 특정 회차의 실제 대진·배당·팀명 매핑 상태를 있는 그대로 찍어보는 조사 스크립트.
//
// 왜 필요한가: 47회차가 UCL/UEL 예선 회차로 확인됐는데, 우리 Elo는 리그 내 상대평가라
// 국가가 다른 클럽 간 경기를 다룰 수 없다. 대안(B안)은 배당 암시확률을 그대로 쓰는 것인데,
// 그게 성립하려면 wisetoto가 이 회차에도 해외배당을 제공해야 한다. 추측하지 말고 찍어본다.
//
// 실행: npx tsx scripts/probe_round.ts [회차번호]   (러너 전용 - 샌드박스는 wisetoto 차단)
import { discoverRoundMasterSeq, fetchRoundFixtures } from "../src/lib/wisetoto";
import { NAME_MAP } from "../src/lib/nameMap";

const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };

// fetch_market_odds.mjs와 동일한 경로/파싱(검증된 패턴)
async function fetchOdds(scheduleInfoSeq: string) {
  const url = new URL("https://www.wisetoto.com/util/gameinfo/get_detail_rate_info.htm");
  url.searchParams.set("schedule_info_seq", scheduleInfoSeq);
  url.searchParams.set("tab_type", "toto");
  for (const k of ["game_year", "game_round", "league_info_seq", "limit", "same_home_away"]) {
    url.searchParams.set(k, "");
  }
  url.searchParams.set("game_no", "1");
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) return { ok: false as const, reason: `HTTP ${res.status}` };
  const html = new TextDecoder("utf-8").decode(await res.arrayBuffer());

  const tableMatch = html.match(/id="tab05_01"[\s\S]*?<\/table>/);
  if (!tableMatch) return { ok: false as const, reason: "배당표(tab05_01) 없음" };
  const rows = tableMatch[0].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const oddsRows: number[][] = [];
  for (const row of rows) {
    const nums = [...row.matchAll(/class="dividend[^"]*">\s*([\d.]+)/g)].map((m) => Number(m[1]));
    if (nums.length === 3) oddsRows.push(nums);
  }
  if (oddsRows.length === 0) return { ok: false as const, reason: "배당 행 0개" };

  const avg = [0, 1, 2].map((i) => oddsRows.reduce((s, r) => s + r[i], 0) / oddsRows.length);
  const inv = avg.map((o) => 1 / o);
  const total = inv.reduce((s, x) => s + x, 0);
  return {
    ok: true as const,
    nBooks: oddsRows.length,
    odds: avg,
    p: { h: inv[0] / total, d: inv[1] / total, a: inv[2] / total },
  };
}

// 경기별 schedule_info_seq는 회차 목록 HTML에 들어 있다.
async function fetchScheduleSeqs(gameYear: string, gameRound: string, masterSeq: string) {
  const url = new URL("https://www.wisetoto.com/util/gameinfo/get_toto_list.htm");
  const params: Record<string, string> = {
    game_category: "sc1", game_year: gameYear, game_round: gameRound,
    game_month: "", game_day: "", game_info_master_seq: masterSeq,
    sports: "", sort: "", tab_type: "toto",
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: HEADERS });
  const html = new TextDecoder("utf-8").decode(await res.arrayBuffer());
  const seqs = new Map<number, string>();
  const re = /(\d+)경기[\s\S]{0,600}?schedule_info_seq['"]?[=:]\s*['"]?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const no = Number(m[1]);
    if (!seqs.has(no)) seqs.set(no, m[2]);
  }
  return seqs;
}

async function main() {
  const round = String(Number(process.argv[2]) || 47);
  const gameYear = String(new Date().getUTCFullYear());

  const masterSeq = await discoverRoundMasterSeq(gameYear, round);
  console.log(`${round}회차 masterSeq: ${masterSeq ?? "없음(미발매)"}`);
  if (!masterSeq) return;

  const fixtures = await fetchRoundFixtures(gameYear, round, masterSeq);
  console.log(`대진 ${fixtures.length}경기\n`);

  const seqs = await fetchScheduleSeqs(gameYear, round, masterSeq);
  console.log(`schedule_info_seq 추출: ${seqs.size}건\n`);

  let mapped = 0;
  let withOdds = 0;
  const leagues = new Map<string, number>();

  for (const f of fixtures) {
    leagues.set(f.league, (leagues.get(f.league) ?? 0) + 1);
    const hOk = !!NAME_MAP[f.homeKr];
    const aOk = !!NAME_MAP[f.awayKr];
    if (hOk && aOk) mapped++;

    const sseq = seqs.get(f.seq);
    let oddsText = "seq 없음";
    if (sseq) {
      const o = await fetchOdds(sseq);
      if (o.ok) {
        withOdds++;
        oddsText =
          `배당 ${o.odds.map((x) => x.toFixed(2)).join("/")} (${o.nBooks}개사) ` +
          `-> 홈 ${(o.p.h * 100).toFixed(1)}% 무 ${(o.p.d * 100).toFixed(1)}% 원정 ${(o.p.a * 100).toFixed(1)}%`;
      } else {
        oddsText = `배당 없음 (${o.reason})`;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(
      `${String(f.seq).padStart(2)}. [${f.league}] ${f.homeKr}${hOk ? "" : "✗"} vs ${f.awayKr}${aOk ? "" : "✗"}`,
    );
    console.log(`     ${oddsText}`);
  }

  console.log(`\n=== 요약 ===`);
  console.log(`  리그 구성: ${[...leagues].map(([l, n]) => `${l} ${n}경기`).join(", ")}`);
  console.log(`  NAME_MAP 매핑 완료: ${mapped}/${fixtures.length}경기 (✗는 미매핑 팀)`);
  console.log(`  배당 확보: ${withOdds}/${fixtures.length}경기`);
  console.log(
    withOdds === fixtures.length
      ? "  -> 전 경기 배당 확보. 배당 기반(B안) 예측이 성립한다."
      : withOdds > 0
        ? "  -> 일부만 배당이 있다. 누락 경기 처리 방침이 필요하다."
        : "  -> 배당이 전혀 없다. B안은 이 회차에 성립하지 않는다.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
