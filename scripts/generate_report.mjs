// GitHub Actions 러너(Google이 차단하지 않는 IP)에서 Gemini를 호출해 최신 회차 AI 리포트를 생성하고,
// 결과를 Cloudflare Worker의 관리자 API로 전송해 KV에 저장한다.
// Cloudflare Workers 자체에서 Gemini를 호출하면 "User location is not supported"로 항상 실패하기 때문에
// (Google이 Cloudflare의 공용 아웃바운드 IP대역을 차단) 이 우회 경로가 필요하다.
//
// buildPrompt()는 src/lib/gemini.ts의 buildPrompt()와 동일하게 유지해야 한다(수정 시 양쪽 동기화 필요).
import { pathToFileURL } from "node:url";

const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const MODEL = "gemini-2.5-pro";

// "이 확신도 구간(15~30%p) 실측 적중률 42.5%(n=831)" - src/lib/gemini.ts와 동일 유지
// (원본 CALIBRATION 표는 calibration.ts 한 곳에만 있고, /api/rounds/:id 응답의 calibration.bucket을
// 그대로 받아 포맷만 하므로 여기서 표를 복제하지 않는다).
function formatCalibrationNote(bucket) {
  if (!bucket) return "";
  return `, 이 확신도 구간(${(bucket.minGap * 100).toFixed(0)}~${(bucket.maxGap * 100).toFixed(0)}%p) 실측 적중률 ${(bucket.accuracy * 100).toFixed(1)}%(n=${bucket.n})`;
}

export function buildPrompt(roundLabel, matches) {
  const lines = matches
    .map((m, i) => {
      const p = m.prediction;
      return (
        `${i + 1}. ${m.league} ${m.home} vs ${m.away} - ` +
        `홈${(p.pHome * 100).toFixed(0)}% 무${(p.pDraw * 100).toFixed(0)}% 원정${(p.pAway * 100).toFixed(0)}% ` +
        `(확신도 ${(p.confidenceGap * 100).toFixed(1)}%p, 모델추천 ${p.rankedPicks[0]}${formatCalibrationNote(m.calibration?.bucket)})`
      );
    })
    .join("\n");

  const leagues = [...new Set(matches.map((m) => m.league))].join("/");
  return `당신은 HYEOKS 스포츠 분석 센터의 축구 데이터 애널리스트입니다. 아래는 축구토토 승무패 ${roundLabel} ${matches.length}경기(${leagues})에 대한 통계 모델(Elo 전력차 + 최근 폼 + 상대전적 + 리그별 실측 무승부율) 예측 결과입니다.

${lines}

이 데이터를 바탕으로 5~7문장 이내의 짧은 리포트를 작성하십시오. 확신도가 높은 "안전 픽" 경기, 확신도가 낮아 이변 가능성이 있는 경기, 무승부 비중이 높아 보이는 경기를 각각 짚어주고, 이 예측은 통계적 참고용일 뿐 배당 대비 확실한 수익을 보장하지 않는다는 점을 마지막에 자연스럽게 덧붙이세요. 문어체, 존댓말로 작성하고 문장을 콜론(:)으로 끝내지 마세요.`;
}

async function callGeminiApi(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    throw new Error(`gemini 호출 실패: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error(`gemini 응답 형식 이상: ${JSON.stringify(data)}`);
  return text.trim();
}

async function main() {
  const roundsRes = await fetch(`${WORKER_BASE_URL}/api/rounds`);
  if (!roundsRes.ok) throw new Error(`/api/rounds 조회 실패: ${roundsRes.status}`);
  const { rounds } = await roundsRes.json();
  if (!rounds || rounds.length === 0) {
    console.log("등록된 회차가 없어 리포트를 생성하지 않습니다.");
    return;
  }
  const round = rounds[0]; // listRounds는 id DESC 정렬 -> 최신 회차

  const roundRes = await fetch(`${WORKER_BASE_URL}/api/rounds/${round.id}`);
  if (!roundRes.ok) throw new Error(`/api/rounds/${round.id} 조회 실패: ${roundRes.status}`);
  const { matches } = await roundRes.json();

  const roundLabel = round.round_no_confirmed ? `${round.round_no}회차` : `${round.round_no ?? "추정"}회차(미확정)`;
  const prompt = buildPrompt(roundLabel, matches);
  const report = await callGeminiApi(prompt);

  const writeRes = await fetch(`${WORKER_BASE_URL}/api/admin/rounds/${round.id}/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ report }),
  });
  if (!writeRes.ok) throw new Error(`리포트 저장 실패: ${writeRes.status} ${await writeRes.text()}`);

  console.log(`round ${round.id}(${roundLabel}) 리포트 저장 완료`);
  console.log(report);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 환경변수가 필요합니다");
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN 환경변수가 필요합니다");
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
