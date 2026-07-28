// Gemini REST API로 회차 예측에 대한 짧은 분석 리포트 생성 (hyeoks_analyst.py의 페르소나 프롬프트 패턴 이식)
// Workers 런타임에는 google-genai 파이썬 SDK가 없어 REST 엔드포인트를 직접 호출한다.
import type { Env } from "../types";
import type { MatchWithPrediction } from "./predictRound";

const MODEL = "gemini-2.5-pro";

function buildPrompt(roundLabel: string, matches: MatchWithPrediction[]): string {
  const lines = matches
    .map((m, i) => {
      const p = m.prediction;
      return (
        `${i + 1}. ${m.match.league} ${m.match.home_kr} vs ${m.match.away_kr} - ` +
        `홈${(p.pHome * 100).toFixed(0)}% 무${(p.pDraw * 100).toFixed(0)}% 원정${(p.pAway * 100).toFixed(0)}% ` +
        `(확신도 ${(p.confidenceGap * 100).toFixed(1)}%p, 모델추천 ${p.rankedPicks[0]})`
      );
    })
    .join("\n");

  return `당신은 HYEOKS 스포츠 분석 센터의 축구 데이터 애널리스트입니다. 아래는 K리그 승무패 ${roundLabel} 14경기에 대한 통계 모델(Elo 전력차 + 최근 폼 + 상대전적 + 리그별 실측 무승부율) 예측 결과입니다.

${lines}

이 데이터를 바탕으로 5~7문장 이내의 짧은 리포트를 작성하십시오. 확신도가 높은 "안전 픽" 경기, 확신도가 낮아 이변 가능성이 있는 경기, 무승부 비중이 높아 보이는 경기를 각각 짚어주고, 이 예측은 통계적 참고용일 뿐 배당 대비 확실한 수익을 보장하지 않는다는 점을 마지막에 자연스럽게 덧붙이세요. 문어체, 존댓말로 작성하고 문장을 콜론(:)으로 끝내지 마세요.`;
}

export async function generateReport(
  env: Env,
  roundLabel: string,
  matches: MatchWithPrediction[],
): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;

  const prompt = buildPrompt(roundLabel, matches);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
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
