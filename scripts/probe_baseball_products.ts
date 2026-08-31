// 야구로 "조합"을 만들 수 있는 상품이 실제로 있는지 확인한다.
//
// 지금까지 확인된 것은 야구토토 승1패뿐이다(승/1점차/패 3택, 파리뮤추얼 - 배당 없음).
// 승패 2택 조합을 만들려면 그런 상품이 실제로 발매되는지부터 알아야 하고, 배당이 붙는
// 프로토 승부식에 야구가 있는지도 별개 문제다. 이 둘을 추측으로 답하면 안 된다.
//
// 묻는 것
//   1) betman이 지금 파는 게임 목록에 야구가 몇 종류인가 (gmId <-> 게임명)
//   2) 그 중 승패 2택 상품이 있는가, 몇 경기 묶음인가
//   3) 프로토 승부식에 야구가 있는가 (있으면 배당이 붙는다)
//
// 방법: 축구 승무패는 gmId=G011로 긁고 있다(offline_round_pick.ts). 야구 코드를
// 추측해서 "없다"고 결론내지 않기 위해, betman이 스스로 노출하는 목록 API 응답을
// Playwright로 가로채 원문을 그대로 찍는다. 이 레포에서 자작 파싱이 0건을
// "데이터 없음"으로 오판할 뻔한 전례가 세 번 있었다(47회차 배당, FotMob 경기ID,
// KBO 시즌당 10건).
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

interface Captured { url: string; method: string; status: number; body: string }

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const captured: Captured[] = [];

  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    page.on("response", async (res) => {
      const u = res.url();
      if (!u.includes("betman.co.kr")) return;
      const ct = res.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      try {
        captured.push({ url: u, method: res.request().method(), status: res.status(), body: await res.text() });
      } catch {
        // 본문을 못 읽는 응답(리다이렉트 등)은 넘긴다
      }
    });

    say("=".repeat(70));
    say("1) betman 발매 게임 목록 - 어떤 XHR이 오는지 원문 그대로");
    say("=".repeat(70));
    for (const url of [
      "https://www.betman.co.kr/main/mainPage/gamebuy/buyableGameList.do",
      "https://www.betman.co.kr/",
    ]) {
      captured.length = 0;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(2500);
      } catch (e) {
        say(`\n${url}\n  이동 실패: ${(e as Error).message}`);
        continue;
      }
      say(`\n${url}  -> XHR ${captured.length}건`);
      for (const c of captured) {
        say(`  [${c.method} ${c.status}] ${c.url}`);
        say(`    ${c.body.slice(0, 1200)}`);
      }
    }

    say("\n" + "=".repeat(70));
    say("2) 페이지 본문에서 gmId와 게임명 - 목록 API를 못 찾았을 때의 보조 증거");
    say("=".repeat(70));
    const html = await page.content();
    const ids = [...new Set([...html.matchAll(/gmId=([A-Z0-9]+)/g)].map((m) => m[1]))];
    say(`  gmId 토큰: ${ids.join(", ") || "(없음)"}`);
    for (const kw of ["야구", "승1패", "프로토", "승부식", "매치"]) {
      const hits = [...html.matchAll(new RegExp(`.{0,120}${kw}.{0,120}`, "g"))].slice(0, 3);
      say(`\n  "${kw}" 주변 ${hits.length}건:`);
      for (const h of hits) say(`    ${h[0].replace(/\s+/g, " ").trim().slice(0, 220)}`);
    }

    say("\n" + "=".repeat(70));
    say("3) 발견된 gmId마다 게임슬립을 열어 구조 확인 (몇 경기 / 몇 택)");
    say("=".repeat(70));
    // 축구 승무패 G011이 어떤 응답을 주는지 아는 상태이므로, 같은 API가 야구에서
    // 어떻게 다른지를 본다. gmTs(회차)는 모르므로 회차 없이 열어 기본 회차를 받는다.
    for (const gmId of ids.length ? ids : ["G011"]) {
      captured.length = 0;
      try {
        await page.goto(`https://www.betman.co.kr/main/mainPage/gamebuy/gameSlip.do?gmId=${gmId}`, {
          waitUntil: "networkidle",
          timeout: 45000,
        });
        await page.waitForTimeout(2000);
      } catch (e) {
        say(`\n${gmId}: 이동 실패 ${(e as Error).message}`);
        continue;
      }
      const info = captured.filter((c) => c.url.includes("gameInfoInq.do"));
      say(`\n${gmId}: XHR ${captured.length}건, gameInfoInq ${info.length}건`);
      for (const c of info) {
        let parsed: any = null;
        try { parsed = JSON.parse(c.body); } catch { /* JSON이 아니면 원문으로 본다 */ }
        if (parsed) {
          const s = parsed.schedulesList ?? [];
          say(`  gmTs=${parsed.gmTs} 최상위키=${Object.keys(parsed).join(",").slice(0, 300)}`);
          say(`  경기수=${s.length}  첫경기=${JSON.stringify(s[0] ?? null).slice(0, 400)}`);
        } else {
          say(`  (JSON 아님) ${c.body.slice(0, 400)}`);
        }
      }
      if (!info.length) {
        const t = await page.title();
        say(`  gameInfoInq 없음. title="${t}" 본문앞부분=${(await page.content()).slice(0, 300).replace(/\s+/g, " ")}`);
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
