// 야구토토 승1패(G024) 경기와 프로토 승부식(G101) 야구 행이 얼마나 겹치는지 센다.
//
// 왜 중요한가
//   야구토토 승1패는 파리뮤추얼이라 확정배당이 없다(winAllot 전부 0). 그런데 프로토
//   승부식에는 같은 경기에 배당이 붙고, 심지어 승1패 그대로의 3택 배당도 있다.
//     betId 2   야구 승패    일반 승패  승/패 2택      1.48 / 2.17
//     betId 108 야구 승1패   승N패      승/1/패 3택    2.00 / 3.35 / 2.85
//   즉 프로토를 승1패의 '시장 확률'로 쓸 수 있다. 축구 앱이 wisetoto 해외배당을 쓰는
//   것과 같은 구조이고, 그러면 야구에도 marketWeight 블렌딩과 절제 사다리 A(배당만) vs
//   E(모델) 비교를 그대로 옮길 수 있다.
//
//   단 그건 겹치는 경기가 충분할 때만 성립한다. 14경기 중 몇 개에 배당이 붙는지가
//   실제 제약이다. 그래서 '있다/없다'가 아니라 '몇 개'를 센다.
//
// 매칭 키를 추측하지 않는다
//   G024 행은 gameKey가 null이고 homeName이 '워싱내셔'처럼 4자 축약이다.
//   G101 행은 gameKey가 '뉴욕양키:휴스애스' 형태고 homeName은 '뉴욕 양키스' 전체 이름이다.
//   그래서 G024의 `home:away`가 G101의 gameKey와 맞을 것으로 보이지만, 이건 가설이다.
//   여러 후보 키로 각각 매칭률을 내고 무엇이 실제로 맞는지 데이터로 고른다.
//   (이 레포에서 키 형식을 추측했다가 틀린 전례가 여러 번 있었다.)
//
// 실행: npx tsx scripts/probe_baseball_overlap.ts   (러너 전용 - 샌드박스는 betman 차단)
import { writeFileSync } from "node:fs";

const OUT = "seed/baseball_overlap.txt";
const lines: string[] = [];
const say = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  lines.push(s);
  process.stdout.write(s + "\n");
};

const BASE = "https://www.betman.co.kr";
const TOTO_GM = "G024";   // 야구토토 승1패
const PROTO_GM = "G101";  // 프로토 승부식
const BET_SEUNG1PAE = "108"; // 야구 승1패 (승N패)
const BET_SEUNGPAE = "2";    // 야구 승패 (일반 승패)

interface Row { [k: string]: any }

const dayOf = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 기준 날짜
const squeeze = (s: unknown) => String(s ?? "").replace(/\s+/g, "");

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    let cap: Array<{ url: string; body: string }> = [];
    page.on("response", async (res) => {
      if (!res.url().includes("gameInfoInq.do")) return;
      try { cap.push({ url: res.url(), body: await res.text() }); } catch { /* 본문 못 읽음 */ }
    });

    const slip = async (gmId: string, gmTs: number): Promise<any | null> => {
      cap = [];
      try {
        await page.goto(`${BASE}/main/mainPage/gamebuy/gameSlip.do?gmId=${gmId}&year=2026&gmTs=${gmTs}`, {
          waitUntil: "networkidle", timeout: 45000,
        });
        await page.waitForTimeout(1200);
      } catch { return null; }
      for (const c of cap) {
        try { const j = JSON.parse(c.body); if (j?.rsMsg) return j; } catch { /* JSON 아님 */ }
      }
      return null;
    };

    // ---- 프로토 승부식: 야구 행을 모은다 (여러 회차를 합쳐 날짜 범위를 넓힌다)
    const protoRows: Row[] = [];
    const protoRounds: number[] = [];
    for (let gmTs = 260103; gmTs >= 260085; gmTs--) {
      const j = await slip(PROTO_GM, gmTs);
      const raw = j?.compSchedules;
      const keys: string[] = Array.isArray(raw?.keys) ? raw.keys : [];
      const datas: any[][] = Array.isArray(raw?.datas) ? raw.datas : [];
      if (!keys.length || !datas.length) continue;
      const rows = datas.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
      const bs = rows.filter((r) => String(r.itemCode) === "BS");
      if (!bs.length) continue;
      protoRounds.push(gmTs);
      protoRows.push(...bs);
    }
    say("=".repeat(72));
    say(`프로토 승부식 회차 ${protoRounds.length}개 (${protoRounds.at(-1)}~${protoRounds[0]}), 야구 행 ${protoRows.length}건`);
    say("=".repeat(72));
    const byBet = new Map<string, number>();
    for (const r of protoRows) byBet.set(`${r.betId} ${r.betNm} / ${r.betTypNm}`, (byBet.get(`${r.betId} ${r.betNm} / ${r.betTypNm}`) ?? 0) + 1);
    for (const [k, n] of [...byBet.entries()].sort((a, b) => b[1] - a[1])) say(`  ${k}  ${n}건`);

    const leagues = new Map<string, number>();
    for (const r of protoRows) leagues.set(String(r.leagueName), (leagues.get(String(r.leagueName)) ?? 0) + 1);
    say(`  리그: ${[...leagues.entries()].map(([k, n]) => `${k} ${n}`).join(" / ")}`);
    const days = [...new Set(protoRows.map((r) => dayOf(Number(r.gameDate))))].sort();
    say(`  경기일 범위: ${days[0]} ~ ${days.at(-1)} (${days.length}일)`);

    // 승1패/승패 배당을 경기 단위로 색인. 후보 키를 여러 개 만들어 둔다.
    const idx = new Map<string, Row[]>();
    const addKey = (k: string, r: Row) => { if (!k) return; const a = idx.get(k) ?? []; a.push(r); idx.set(k, a); };
    for (const r of protoRows) {
      const d = dayOf(Number(r.gameDate));
      addKey(`GK|${d}|${squeeze(r.gameKey)}`, r);
      addKey(`NM|${d}|${squeeze(r.homeName)}:${squeeze(r.awayName)}`, r);
      addKey(`SEQ|${r.matchSeq}`, r);
    }

    // ---- 야구토토 승1패 회차들
    say("\n" + "=".repeat(72));
    say("야구토토 승1패 회차별 - 14경기 중 프로토에 배당이 붙은 경기 수");
    say("=".repeat(72));
    let totGames = 0, totGK = 0, totNM = 0, totWith1 = 0, totWithWL = 0;
    for (let gmTs = 260064; gmTs >= 260052; gmTs--) {
      const j = await slip(TOTO_GM, gmTs);
      const games: Row[] = j?.schedulesList ?? [];
      if (!games.length) continue;
      let gk = 0, nm = 0, w1 = 0, wl = 0;
      const misses: string[] = [];
      for (const g of games) {
        const d = dayOf(Number(g.gameDate));
        const kGK = `GK|${d}|${squeeze(g.homeName)}:${squeeze(g.awayName)}`;
        const kNM = `NM|${d}|${squeeze(g.homeName)}:${squeeze(g.awayName)}`;
        const hitGK = idx.get(kGK) ?? [];
        const hitNM = idx.get(kNM) ?? [];
        const hit = hitGK.length ? hitGK : hitNM;
        if (hitGK.length) gk++;
        if (hitNM.length) nm++;
        if (hit.some((r) => String(r.betId) === BET_SEUNG1PAE)) w1++;
        if (hit.some((r) => String(r.betId) === BET_SEUNGPAE)) wl++;
        if (!hit.length) misses.push(`${d} ${squeeze(g.awayName)}@${squeeze(g.homeName)}(${g.leagueName})`);
      }
      totGames += games.length; totGK += gk; totNM += nm; totWith1 += w1; totWithWL += wl;
      say(`  ${gmTs}: ${games.length}경기  gameKey매칭 ${gk} / 이름매칭 ${nm}  -> 승1패배당 ${w1} / 승패배당 ${wl}`);
      if (misses.length) say(`    미매칭 ${misses.length}건: ${misses.slice(0, 6).join(" , ")}${misses.length > 6 ? " ..." : ""}`);
    }

    say("\n" + "-".repeat(72));
    if (totGames) {
      const pct = (n: number) => `${((n / totGames) * 100).toFixed(1)}%`;
      say(`합계 ${totGames}경기 중`);
      say(`  프로토에 존재(gameKey 기준) ${totGK}  ${pct(totGK)}`);
      say(`  프로토에 존재(이름 기준)    ${totNM}  ${pct(totNM)}`);
      say(`  승1패 배당 보유             ${totWith1}  ${pct(totWith1)}`);
      say(`  승패 배당 보유              ${totWithWL}  ${pct(totWithWL)}`);
      say(`\n두 매칭 방식의 결과가 크게 다르면 키 가설이 틀린 것이다 - 그때는 미매칭 샘플을 보고 고친다.`);
    } else {
      say(`야구토토 승1패 회차를 하나도 못 받았다. 매칭률을 판정할 수 없다(회차 범위 확인 필요).`);
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
