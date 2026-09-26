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

// 이 확률이 어디서 나왔는지(prediction.basis)를 리포트에 그대로 전한다.
const BASIS_LABEL = { model: "모델추천", market: "배당기반추천", national: "국가대표Elo추천", none: "근거없음" };

export function buildPrompt(roundLabel, matches) {
  const lines = matches
    .map((m, i) => {
      const p = m.prediction;
      return (
        `${i + 1}. ${m.league} ${m.home} vs ${m.away} - ` +
        `홈${(p.pHome * 100).toFixed(0)}% 무${(p.pDraw * 100).toFixed(0)}% 원정${(p.pAway * 100).toFixed(0)}% ` +
        `(확신도 ${(p.confidenceGap * 100).toFixed(1)}%p, ${BASIS_LABEL[p.basis] ?? "배당기반추천"} ${p.rankedPicks[0]}${formatCalibrationNote(m.calibration?.bucket)})`
      );
    })
    .join("\n");

  const leagues = [...new Set(matches.map((m) => m.league))].join("/");
  // UCL/UEL처럼 모델이 없는 대회가 섞이면 리포트가 그 경기까지 "모델 분석"으로 서술하게 된다.
  // 근거가 다른 경기가 있다는 사실을 프롬프트에 명시해 그렇게 쓰지 않도록 한다.
  // 근거(basis)마다 설명이 다르다. 예전엔 모델이 아니면 전부 "배당 기반"이라고 적어서,
  // 배당 없이 국가대표 Elo로 예측한 경기(57회차 등)까지 배당 기준이라고 서술됐다.
  const leaguesOf = (ms) => [...new Set(ms.map((m) => m.league))].join("/");
  const byBasis = (b) => matches.filter((m) => m.prediction.basis === b);
  const market = byBasis("market");
  const national = byBasis("national");
  const none = byBasis("none");
  const marketNote =
    (market.length
      ? `\n\n참고: 위 ${market.length}경기(${leaguesOf(market)})는 우리 클럽 Elo(같은 리그 안에서만 의미가 있는 상대평가)를 쓸 수 없는 대회라, 통계 모델이 아니라 해외 북메이커 배당에서 마진을 제거한 확률을 그대로 사용했습니다. 이 경기들에 대해서는 "모델이 분석했다"고 쓰지 말고 배당 기준임을 밝히고, 과거 적중률 근거가 없다는 점도 언급하십시오.`
      : "") +
    (national.length
      ? `\n\n참고: 위 ${national.length}경기(${leaguesOf(national)})는 국가대표 경기로, 아직 해외 배당이 올라오지 않아 국가대표 Elo(1872년 이후 A매치 전체 결과 기반)로 예측했습니다. 과거 검증에서 공식전 적중률은 약 61%, 네이션스리그만 보면 53~58%였고, 확신도 구간별 적중률은 없습니다. 이 경기들은 "배당 기준"이라고 쓰지 말고 국가대표 Elo 기준임을 밝히며, 배당이 수집되면 예측이 바뀔 수 있다는 점을 언급하십시오.`
      : "") +
    (none.length
      ? `\n\n참고: 위 ${none.length}경기(${leaguesOf(none)})는 배당도 모델 근거도 아직 없어 표시된 확률이 평균 무승부율 기준 임시값일 뿐입니다. 이 경기들은 안전 픽이나 이변 후보로 꼽지 말고 근거가 아직 없다고만 쓰십시오.`
      : "");
  return `당신은 HYEOKS 스포츠 분석 센터의 축구 데이터 애널리스트입니다. 아래는 축구토토 승무패 ${roundLabel} ${matches.length}경기(${leagues})에 대한 통계 모델(Elo 전력차 + 최근 폼 + 상대전적 + 리그별 실측 무승부율) 예측 결과입니다.

${lines}${marketNote}

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
  // 가장 최근 등록 회차가 아니라 '마감이 가장 임박한 발매중 회차'의 리포트를 만든다.
  // betman은 여러 회차를 동시에 발매해서, 최신 회차만 보면 곧 마감인 회차에 리포트가 없다.
  // src/lib/roundPick.ts의 pickDefaultRound 1순위와 같은 규칙(이 스크립트는 node로 돌아 TS를 못 가져온다).
  const now = Date.now();
  const onSale = rounds
    .filter((r) => r.status === "upcoming" && r.first_kickoff_at && Date.parse(r.first_kickoff_at) > now)
    .sort((a, b) => Date.parse(a.first_kickoff_at) - Date.parse(b.first_kickoff_at));
  const round = onSale[0] ?? rounds[0];

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
