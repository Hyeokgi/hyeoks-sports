// 프로토 승부식(G101)의 야구 배당과 결과를 모아 seed/proto_baseball_odds.json에 저장한다.
//
// 왜 필요한가
//   야구토토 승1패는 파리뮤추얼이라 배당이 없는데, 프로토가 같은 경기 전부에 배당을 붙인다
//   (probe_baseball_overlap.ts 실측: 182경기 중 182개, 100%). 그러면 축구에서 하던
//   '배당 단독 vs 우리 모델' 비교(절제 사다리 A vs E)를 야구에도 할 수 있다. 지금까지 낸
//   KBO 4/4, MLB 4/4는 '무조건 홈' 대비일 뿐이고, 축구에서는 배당이 우리 모델을 이겼다.
//
// 모으는 것
//   betId 2   야구 승패   승/패 2택   winAllot / loseAllot
//   betId 108 야구 승1패  승/1/패 3택 winAllot / drawAllot / loseAllot
//   그리고 mchScore - 지난 회차 행에는 실제 스코어가 남아 있어 결과를 따로 안 긁어도 된다.
//
// 회차 범위를 가정하지 않는다. 현재 회차에서 뒤로 내려가며 야구 행이 연속으로 안 나오면
// 멈춘다. '몇 회차가 있다'를 내가 정하면 있는 데이터를 놓치거나 없는 회차를 헛돌게 된다.
//
// 실행: npx tsx scripts/fetch_proto_baseball_odds.ts [시작gmTs] [최대회차수]  (러너 전용)
import { writeFileSync } from "node:fs";

const START = Number(process.argv[2] ?? 260103);
const MAX_ROUNDS = Number(process.argv[3] ?? 60);
const MISS_STOP = 6; // 야구 행이 이만큼 연속으로 안 나오면 더 내려가지 않는다
const OUT = "seed/proto_baseball_odds.json";
const BASE = "https://www.betman.co.kr";

interface Odds {
  gmTs: number;
  gameKey: string;      // "뉴욕양키:휴스애스" - 토토 쪽 home:away와 맞는 키다(실측 100%)
  date: string;         // KST 기준 경기일
  league: string;       // MLB / KBO / NPB
  home: string;
  away: string;
  score: string | null; // "1:5" - 끝난 경기만
  winAllot: number;     // 승패 2택
  loseAllot: number;
  s1WinAllot: number;   // 승1패 3택
  s1DrawAllot: number;
  s1LoseAllot: number;
}

const dayOf = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const squeeze = (s: unknown) => String(s ?? "").replace(/\s+/g, "");

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const byGame = new Map<string, Odds>();
  let rounds = 0, miss = 0;

  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    let cap: string[] = [];
    page.on("response", async (res) => {
      if (!res.url().includes("gameInfoInq.do")) return;
      try { cap.push(await res.text()); } catch { /* 본문 못 읽음 */ }
    });

    for (let gmTs = START; gmTs > START - MAX_ROUNDS; gmTs--) {
      cap = [];
      try {
        await page.goto(`${BASE}/main/mainPage/gamebuy/gameSlip.do?gmId=G101&year=2026&gmTs=${gmTs}`, {
          waitUntil: "networkidle", timeout: 45000,
        });
        await page.waitForTimeout(1000);
      } catch (e) {
        console.log(`  ! ${gmTs} 이동 실패: ${(e as Error).message}`);
        miss++;
        if (miss >= MISS_STOP) { console.log(`  연속 ${miss}회 실패 - 중단`); break; }
        continue;
      }

      let rows: any[] = [];
      for (const body of cap) {
        let j: any = null;
        try { j = JSON.parse(body); } catch { continue; }
        const raw = j?.compSchedules;
        const keys: string[] = Array.isArray(raw?.keys) ? raw.keys : [];
        const datas: any[][] = Array.isArray(raw?.datas) ? raw.datas : [];
        if (keys.length && datas.length) rows = datas.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
      }
      const bs = rows.filter((r) => String(r.itemCode) === "BS");
      if (!bs.length) {
        miss++;
        console.log(`  ${gmTs}: 야구 행 없음 (연속 ${miss})`);
        if (miss >= MISS_STOP) { console.log(`  연속 ${miss}회 비어 있음 - 중단`); break; }
        continue;
      }
      miss = 0;
      rounds++;

      // 한 경기에 베팅종류가 여러 행으로 나뉘어 온다. 경기 단위로 합친다.
      let added = 0;
      for (const r of bs) {
        const bet = String(r.betId);
        if (bet !== "2" && bet !== "108") continue;
        const date = dayOf(Number(r.gameDate));
        const key = `${date}|${squeeze(r.gameKey)}`;
        const cur = byGame.get(key) ?? {
          gmTs, gameKey: squeeze(r.gameKey), date,
          league: String(r.leagueName ?? ""),
          home: String(r.homeName ?? ""), away: String(r.awayName ?? ""),
          score: r.mchScore ? String(r.mchScore) : null,
          winAllot: 0, loseAllot: 0, s1WinAllot: 0, s1DrawAllot: 0, s1LoseAllot: 0,
        };
        if (!cur.score && r.mchScore) cur.score = String(r.mchScore);
        if (bet === "2") { cur.winAllot = Number(r.winAllot) || 0; cur.loseAllot = Number(r.loseAllot) || 0; }
        else {
          cur.s1WinAllot = Number(r.winAllot) || 0;
          cur.s1DrawAllot = Number(r.drawAllot) || 0;
          cur.s1LoseAllot = Number(r.loseAllot) || 0;
        }
        if (!byGame.has(key)) added++;
        byGame.set(key, cur);
      }
      console.log(`  ${gmTs}: 야구 행 ${bs.length} -> 신규 경기 ${added} (누적 ${byGame.size})`);
    }
  } finally {
    await browser.close();
  }

  const all = [...byGame.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  console.log(`\n회차 ${rounds}개에서 경기 ${all.length}건`);
  if (!all.length) { console.log("한 건도 못 받았다. 커밋하지 않는다."); process.exit(1); }

  // 검증: 배당·결과가 실제로 붙어 있는지. 없으면 비교에 못 쓴다.
  const byLeague = new Map<string, number>();
  for (const g of all) byLeague.set(g.league, (byLeague.get(g.league) ?? 0) + 1);
  console.log(`리그: ${[...byLeague.entries()].map(([k, n]) => `${k} ${n}`).join(" / ")}`);
  console.log(`기간: ${all[0].date} ~ ${all.at(-1)!.date}`);
  const withWL = all.filter((g) => g.winAllot > 0 && g.loseAllot > 0).length;
  const with1 = all.filter((g) => g.s1WinAllot > 0 && g.s1DrawAllot > 0 && g.s1LoseAllot > 0).length;
  const withScore = all.filter((g) => g.score && /^\d+:\d+$/.test(g.score)).length;
  console.log(`승패 배당 보유 ${withWL}/${all.length} / 승1패 배당 보유 ${with1}/${all.length} / 스코어 보유 ${withScore}/${all.length}`);
  console.log(`비교에 실제로 쓸 수 있는 건(배당+결과 둘 다): ${all.filter((g) => g.winAllot > 0 && g.score && /^\d+:\d+$/.test(g.score)).length}건`);

  // 오버라운드 - 배당이 제정신인지 보는 기본 점검. 1.0 근처거나 1.3을 넘으면 뭔가 잘못 읽은 것이다.
  const ors = all.filter((g) => g.winAllot > 0 && g.loseAllot > 0).map((g) => 1 / g.winAllot + 1 / g.loseAllot);
  if (ors.length) {
    ors.sort((a, b) => a - b);
    console.log(`승패 오버라운드: 중앙값 ${ors[Math.floor(ors.length / 2)].toFixed(4)} / 최소 ${ors[0].toFixed(4)} / 최대 ${ors.at(-1)!.toFixed(4)}`);
  }
  console.log(`샘플: ${JSON.stringify(all[0])}`);

  writeFileSync(OUT, JSON.stringify(all, null, 0));
  console.log(`\n${OUT}에 저장 (${all.length}건)`);
}

main();
