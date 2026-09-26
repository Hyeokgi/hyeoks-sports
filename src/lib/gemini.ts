// Gemini REST API로 회차 예측에 대한 짧은 분석 리포트 생성 (hyeoks_analyst.py의 페르소나 프롬프트 패턴 이식)
// Cloudflare Workers의 아웃바운드 IP대역을 Google이 차단해 "User location is not supported"
// 오류가 나므로, 실제 호출은 GitHub Actions 러너(scripts/generate_report.mjs)에서 하고
// 이 파일의 buildPrompt/callGeminiApi를 그대로 재사용한다. Worker 쪽 generateReport()는
// (차단이 풀리는 환경 등) 예비 경로로 남겨둔다.
import type { Env } from "../types";
import type { MatchWithPrediction } from "./predictRound";
import type { MatchPrediction } from "./prediction";
import type { CalibrationBucket } from "./calibration";

const MODEL = "gemini-2.5-pro";

export interface ReportMatch {
  league: string;
  home: string;
  away: string;
  prediction: MatchPrediction;
  calibration?: { bucket: CalibrationBucket | null } | null;
}

// "이 확신도 구간(15~30%p) 실측 적중률 42.5%(n=831)" - scripts/generate_report.mjs와 동일 유지
// (양쪽 다 이미 계산된 calibrationBucket을 입력받아 포맷만 하므로, CALIBRATION 원본 표는
// calibration.ts 한 곳에만 존재하고 여기선 복제하지 않는다).
function formatCalibrationNote(bucket: CalibrationBucket | null | undefined): string {
  if (!bucket) return "";
  return `, 이 확신도 구간(${(bucket.minGap * 100).toFixed(0)}~${(bucket.maxGap * 100).toFixed(0)}%p) 실측 적중률 ${(bucket.accuracy * 100).toFixed(1)}%(n=${bucket.n})`;
}

// 이 확률이 어디서 나왔는지(prediction.basis)를 리포트에 그대로 전한다.
const BASIS_LABEL: Record<string, string> = { model: "모델추천", market: "배당기반추천", national: "국가대표Elo추천", none: "근거없음" };

export function buildPrompt(roundLabel: string, matches: ReportMatch[]): string {
  const lines = matches
    .map((m, i) => {
      const p = m.prediction;
      // 모델 원본 확률은 그대로 두고(덮어쓰지 않고), 같은 확신도 구간의 과거 실측 적중률을 병기한다
      // (작업1: 확률 표시의 정직성 개선 - 82%라는 숫자만 보면 실제보다 신뢰도가 높아 보일 수 있어서).
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
  const leaguesOf = (ms: ReportMatch[]) => [...new Set(ms.map((m) => m.league))].join("/");
  const byBasis = (b: string) => matches.filter((m) => m.prediction.basis === b);
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

export async function callGeminiApi(apiKey: string, prompt: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    console.error(`gemini 호출 실패: ${res.status} ${await res.text()}`);
    return null;
  }
  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? text.trim() : null;
}

export async function generateReport(
  env: Env,
  roundLabel: string,
  matches: MatchWithPrediction[],
): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;
  const reportMatches: ReportMatch[] = matches.map((m) => ({
    league: m.match.league,
    home: m.match.home_kr,
    away: m.match.away_kr,
    prediction: m.prediction,
    calibration: m.calibration,
  }));
  return callGeminiApi(env.GEMINI_API_KEY, buildPrompt(roundLabel, reportMatches));
}
