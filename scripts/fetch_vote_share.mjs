// betman.co.kr의 회차별 투표(득표)율을 수집해 Worker의 관리자 API로 전송한다.
// betman은 wisetoto와 달리 단순 fetch(쿠키/Referer/X-Requested-With 포함)로는 WAF성 "페이지 오류
// 안내"가 반환됨이 확인되어(2026-08-03), 실제 브라우저 세션이 필요해 Playwright로 페이지를 띄운 뒤
// 그 페이지가 자체적으로 호출하는 gameInfoInq.do 응답을 가로채는 방식을 쓴다.
import { chromium } from "playwright";

const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function normalizeTeamName(name) {
  return (name ?? "").replace(/\s+/g, "").replace(/FC$|FC1995$|2008$/i, "");
}

async function fetchGameInfo(gmTs) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    let gameInfo = null;
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
    return gameInfo;
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN 환경변수가 필요합니다");

  const roundsRes = await fetch(`${WORKER_BASE_URL}/api/rounds`);
  if (!roundsRes.ok) throw new Error(`/api/rounds 조회 실패: ${roundsRes.status}`);
  const { rounds } = await roundsRes.json();
  const round = (rounds ?? []).find((r) => r.status === "upcoming" && r.round_no_confirmed);
  if (!round) {
    console.log("발매중인 확정 회차가 없어 스킵합니다.");
    return;
  }

  const gmTs = Number(`26${String(round.round_no).padStart(4, "0")}`);
  console.log(`betman gmTs=${gmTs} (round_no=${round.round_no}) 조회 시도`);
  const gameInfo = await fetchGameInfo(gmTs);
  if (!gameInfo) {
    console.log("betman에서 유효한 gameInfoInq 응답을 받지 못했습니다(발매 전/마감/차단 등). 이번 회차는 스킵합니다.");
    return;
  }

  const schedules = gameInfo.schedulesList ?? [];
  if (schedules.length === 0) {
    console.log("schedulesList가 비어 있습니다.");
    return;
  }

  const roundRes = await fetch(`${WORKER_BASE_URL}/api/rounds/${round.id}`);
  if (!roundRes.ok) throw new Error(`/api/rounds/${round.id} 조회 실패: ${roundRes.status}`);
  const { matches } = await roundRes.json();
  const bySig = new Map(matches.map((m) => [`${normalizeTeamName(m.home)}|${normalizeTeamName(m.away)}`, m.seq]));

  const votePayload = [];
  for (const s of schedules) {
    const seq = bySig.get(`${normalizeTeamName(s.homeName)}|${normalizeTeamName(s.awayName)}`);
    if (!seq) continue;
    // winAllot/drawAllot/loseAllot이 파리뮤추얼 배당(=투표 쏠림의 역수) - 발매 전에는 0.0
    if (!s.winAllot || !s.drawAllot || !s.loseAllot) continue;
    const inv = [1 / s.winAllot, 1 / s.drawAllot, 1 / s.loseAllot];
    const total = inv[0] + inv[1] + inv[2];
    votePayload.push({
      seq,
      voteHome: (inv[0] / total) * 100,
      voteDraw: (inv[1] / total) * 100,
      voteAway: (inv[2] / total) * 100,
    });
  }

  if (votePayload.length === 0) {
    console.log("아직 투표(배당) 데이터가 반영되지 않았습니다(발매 전일 가능성). 저장을 건너뜁니다.");
    return;
  }

  const writeRes = await fetch(`${WORKER_BASE_URL}/api/admin/rounds/${round.id}/vote-share`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ votes: votePayload }),
  });
  if (!writeRes.ok) throw new Error(`저장 실패: ${writeRes.status} ${await writeRes.text()}`);
  const result = await writeRes.json();
  console.log(`round ${round.id}: ${result.written}경기 투표율 저장 완료`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
