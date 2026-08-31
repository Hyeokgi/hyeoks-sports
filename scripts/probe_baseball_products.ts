// 야구로 "조합"을 만들 수 있는 상품이 실제로 있는지 확인한다. (2차)
//
// 1차에서 확인된 것 (seed/baseball_products.txt)
//   현재 발매중: G101 프로토 승부식 / G102 프로토 기록식 / G024 야구토토 승1패 /
//               G060 골프토토 스페셜 / G011 축구토토 승무패
//   페이지 스크립트에 이런 줄이 있다:
//     var totoGameIdsFor8TypeBtn = ["G034", "G071"]; // 야구 매치
//   즉 '야구 매치'라는 별도 상품이 존재한다. 지금 발매중이 아니라 목록에 없었을 뿐이다.
//   프로토 승부식은 allotType "Proto" - 배당이 붙는 상품이다.
//
// 1차의 실패: 게임슬립을 gmId만 주고 열어서 gameInfoInq가 한 건도 안 잡혔다.
//   실제 링크는 gameSlip.do?gmId=G024&year=2026&gmTs=260063 형식이다(HTML에서 확인).
//   회차를 안 주면 빈 껍데기가 온다. 내 호출이 틀렸던 것이지 API가 없는 게 아니다.
//   이 레포에서 같은 종류의 오판이 반복됐다(understat 엔드포인트, FotMob 경기ID,
//   KBO 시즌당 10건). 그래서 이번엔 페이지가 스스로 내놓는 링크에서 회차를 얻는다.
//
// 이번에 답하려는 것
//   A 상품 카탈로그 전체 - gmId <-> 게임명, 종목코드(MCH_SPORT_CD), 지금 파는가
//   B 야구 승1패(G024)의 실제 구조 - 몇 경기, 몇 택, 선택지 라벨이 무엇인가
//   C 야구 매치(G034/G071)가 실제로 발매된 적이 있는가, 있다면 구조가 어떤가
//   D 프로토 승부식에 야구 경기와 배당이 붙는가  <- 배당 있는 조합의 유일한 후보
//
// 실행: npx tsx scripts/probe_baseball_products.ts   (러너 전용 - 샌드박스는 betman 차단)
import { writeFileSync } from "node:fs";

const OUT = "seed/baseball_products.txt";
const lines: string[] = [];
const say = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  lines.push(s);
  process.stdout.write(s + "\n");
};

const BASE = "https://www.betman.co.kr";
interface Cap { url: string; status: number; body: string }

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const cap: Cap[] = [];

  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    page.on("response", async (res) => {
      if (!res.url().includes("betman.co.kr")) return;
      if (!(res.headers()["content-type"] ?? "").includes("json")) return;
      try { cap.push({ url: res.url(), status: res.status(), body: await res.text() }); } catch { /* 본문 못 읽는 응답 */ }
    });

    const goto = async (url: string) => {
      cap.length = 0;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(2500);
        return true;
      } catch (e) {
        say(`  이동 실패 ${url}: ${(e as Error).message}`);
        return false;
      }
    };
    const grab = (frag: string) => cap.filter((c) => c.url.includes(frag));

    // ---------------------------------------------------------------- A
    say("=".repeat(70));
    say("A. 상품 카탈로그 - gmId <-> 게임명 <-> 종목코드");
    say("=".repeat(70));
    await goto(`${BASE}/`);
    const catalog = new Map<string, { name: string; sport: string; rounds: string[] }>();
    for (const c of grab("inqWinrstList.do")) {
      try {
        for (const r of JSON.parse(c.body)?.data ?? []) {
          const k = String(r.GM_ID);
          const e = catalog.get(k) ?? { name: String(r.GM_NM), sport: String(r.MCH_SPORT_CD), rounds: [] };
          if (e.rounds.length < 4) e.rounds.push(`${r.ROUND_YEAR}/${r.ROUND}(gmTs ${r.GM_TS})`);
          catalog.set(k, e);
        }
      } catch { /* JSON 아님 */ }
    }
    for (const c of grab("inqCacheBuyAbleGameInfoList.do")) {
      try {
        const j = JSON.parse(c.body);
        for (const key of ["protoGames", "totoGames", "games"]) {
          for (const g of j?.[key] ?? []) {
            const k = String(g.gmId);
            const e = catalog.get(k) ?? { name: String(g.gameMaster?.gameName ?? g.gameName), sport: "?", rounds: [] };
            e.name = String(g.gameMaster?.gameName ?? e.name);
            if (!e.rounds.some((x) => x.includes(String(g.gmTs)))) e.rounds.unshift(`발매중(gmTs ${g.gmTs}, year ${g.gmOsidTsYear})`);
            catalog.set(k, e);
          }
        }
      } catch { /* JSON 아님 */ }
    }
    for (const [id, e] of [...catalog.entries()].sort()) {
      say(`  ${id}  ${e.name}  종목=${e.sport}  회차: ${e.rounds.join(" / ")}`);
    }

    // 페이지가 내놓은 실제 슬립 링크. 회차를 추측하지 않고 여기서 얻는다.
    const html = await page.content();
    const slipLinks = [...new Set(
      [...html.matchAll(/gameSlip\.do\?gmId=(G\d+)(?:&(?:amp;)?year=(\d+))?(?:&(?:amp;)?gmTs=(\d+))?/g)]
        .filter((m) => m[2] && m[3])
        .map((m) => `${m[1]}|${m[2]}|${m[3]}`),
    )];
    say(`\n  페이지에 박힌 슬립 링크(회차 포함): ${slipLinks.join(", ") || "(없음)"}`);
    say(`  '야구 매치' 토큰: ${/totoGameIdsFor8TypeBtn\s*=\s*\[([^\]]*)\]/.exec(html)?.[1] ?? "(없음)"}`);

    // ---------------------------------------------------------------- B/C/D
    say("\n" + "=".repeat(70));
    say("B~D. 슬립을 회차와 함께 열어 실제 구조 확인 (몇 경기 / 몇 택 / 배당)");
    say("=".repeat(70));

    // 조사 대상: 페이지가 준 링크 + 야구 관련 gmId를 카탈로그의 회차로 조합
    const targets = new Set(slipLinks);
    for (const [id, e] of catalog) {
      const m = /gmTs (\d+)/.exec(e.rounds[0] ?? "");
      const y = /year (\d+)/.exec(e.rounds[0] ?? "")?.[1] ?? "2026";
      if (m) targets.add(`${id}|${y}|${m[1]}`);
    }
    // 야구 매치는 발매중이 아니라 회차를 모른다. 카탈로그에 없으면 회차 없이 열어
    // '무엇이 돌아오는지'만 본다(없다고 결론내지 않기 위해).
    for (const id of ["G034", "G071"]) if (![...targets].some((t) => t.startsWith(id))) targets.add(`${id}||`);

    for (const t of targets) {
      const [gmId, year, gmTs] = t.split("|");
      const url = gmTs
        ? `${BASE}/main/mainPage/gamebuy/gameSlip.do?gmId=${gmId}&year=${year}&gmTs=${gmTs}`
        : `${BASE}/main/mainPage/gamebuy/gameSlip.do?gmId=${gmId}`;
      if (!(await goto(url))) continue;
      const infos = grab("gameInfoInq.do");
      say(`\n${gmId} (year=${year || "-"} gmTs=${gmTs || "-"})  gameInfoInq ${infos.length}건`);
      if (!infos.length) { say(`  (응답 없음 - title="${await page.title()}")`); continue; }
      for (const c of infos) {
        let j: any = null;
        try { j = JSON.parse(c.body); } catch { /* JSON 아님 */ }
        if (!j) { say(`  (JSON 아님) ${c.body.slice(0, 300)}`); continue; }
        const s: any[] = j.schedulesList ?? [];
        say(`  gmTs=${j.gmTs} 최상위키=${Object.keys(j).join(",").slice(0, 240)}`);
        say(`  경기수=${s.length}`);
        if (s[0]) {
          say(`  첫경기 키=${Object.keys(s[0]).join(",").slice(0, 400)}`);
          say(`  첫경기=${JSON.stringify(s[0]).slice(0, 700)}`);
        }
        // 종목·배당이 붙는지: 야구 경기가 섞여 있는지와 배당 필드 유무를 센다
        const sports = new Map<string, number>();
        let withOdds = 0;
        for (const g of s) {
          const sp = String(g.sportCd ?? g.mchSportCd ?? g.sportsCd ?? "?");
          sports.set(sp, (sports.get(sp) ?? 0) + 1);
          if (g.allotRate1 ?? g.odds1 ?? g.allot1) withOdds++;
        }
        if (s.length) say(`  종목 분포=${[...sports.entries()].map(([k, n]) => `${k} ${n}`).join(" / ")}  배당필드 보유=${withOdds}/${s.length}`);
      }
    }
  } finally {
    await browser.close();
  }
}

function flush(err?: unknown) {
  if (err) lines.push(`\n!! 도중 실패: ${(err as Error).stack ?? String(err)}`);
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.stdout.write(`\n${OUT}에 저장 (${lines.length}줄)\n`);
}
main().then(() => flush()).catch((e) => { flush(e); process.exitCode = 1; });
