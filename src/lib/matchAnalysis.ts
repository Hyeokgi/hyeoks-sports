// 경기별 분석 노트: "왜 이 픽인가(근거)"와 "어떻게 되면 틀리는가(위험)"를 데이터로 쓴다.
//
// 블로그 글이 확률표만 나열해 근거가 보이지 않는다는 지적(2026-09-26)에 대한 답이다.
// 문장은 LLM이 아니라 규칙으로 만든다 - 숫자는 전부 우리가 가진 데이터에서 오고, 없는 사실을
// 지어내지 않는다. 근거가 없는 항목은 문장 자체를 만들지 않는다.
// 표현 원칙: 적중·수익을 약속하지 않고, 판단이 엇갈리거나 약한 신호는 위험으로 드러낸다.

type Outcome = "홈승" | "무승부" | "원정승";
export interface Probs {
  pHome: number;
  pDraw: number;
  pAway: number;
}

/** 분석에 쓰는 원자료. 없는 값은 null - 그 근거는 문장으로 만들지 않는다. */
export interface MatchDetail {
  eloDiff: number | null; // 클럽 Elo(홈-원정). 클럽 모델을 쓰지 않는 경기면 null
  formDiff: number | null; // 최근 5경기 경기당 승점 차(홈-원정, 0~3 척도)
  h2hDiff: number | null; // 최근 맞대결 성향(-1~+1, +면 홈 우세)
  nH2h: number;
  natEloDiff: number | null; // 국가대표 Elo 격차(홈-원정, 홈 이점 제외)
  natProbs: Probs | null; // 국가대표 Elo만으로 본 확률
  market: (Probs & { n: number }) | null; // 해외 배당 최신(마진 제거 평균)
  marketOpen: Probs | null; // 첫 수집 배당
  modelOnly: Probs | null; // 배당을 섞기 전 통계 모델 확률(클럽 모델 경기만)
  calib: { accuracy: number; n: number; minGap: number; maxGap: number } | null;
}

export interface AnalysisInput extends Probs {
  home: string;
  away: string;
  pick: Outcome;
  confidenceGap: number;
  basis: "model" | "market" | "national" | "none";
  vote: { home: number; draw: number; away: number } | null;
  detail: MatchDetail | null;
}

export interface MatchAnalysis {
  reasons: string[];
  risks: string[];
  stance: "단식" | "단식·여유 시 복식" | "복식" | "삼복식 고려" | "판단 보류";
  cover: Outcome[]; // 권장 커버(단식이면 1개, 복식이면 2개…)
  verdict: string; // 한 줄 결론
}

const OUT: Outcome[] = ["홈승", "무승부", "원정승"];
const pOf = (p: Probs, o: Outcome) => (o === "홈승" ? p.pHome : o === "무승부" ? p.pDraw : p.pAway);
export const argmax = (p: Probs): Outcome => (p.pHome >= p.pDraw && p.pHome >= p.pAway ? "홈승" : p.pDraw >= p.pAway ? "무승부" : "원정승");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pp = (x: number) => `${Math.abs(Math.round(x * 1000) / 10)}%p`;

export function who(o: Outcome, home: string, away: string): string {
  return o === "홈승" ? `${home} 승` : o === "원정승" ? `${away} 승` : "무승부";
}

/** 받침에 맞는 조사. josa("불가리아 승", "이", "가") → "불가리아 승이". 한글이 아니면 두 번째 형태. */
export function josa(word: string, withBatchim: string, without: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return word + without;
  return word + ((c - 0xac00) % 28 !== 0 ? withBatchim : without);
}

export function analyzeMatch(m: AnalysisInput, ctx: { avgDraw: number }): MatchAnalysis {
  const reasons: string[] = [];
  const risks: string[] = [];
  const d = m.detail;
  const W = (o: Outcome) => who(o, m.home, m.away);
  const ranked = [...OUT].sort((a, b) => pOf(m, b) - pOf(m, a));
  const second = ranked[0] === m.pick ? ranked[1] : ranked[0];

  if (m.basis === "none") {
    return {
      reasons: [],
      risks: ["배당도 통계 근거도 아직 없어 표시된 확률은 임시값입니다."],
      stance: "판단 보류",
      cover: [],
      verdict: "근거가 들어오기 전까지 판단을 보류합니다.",
    };
  }

  // 1) 시장(해외 배당)
  if (d?.market) {
    const mk = d.market;
    reasons.push(
      `해외 북메이커 ${mk.n}곳의 평균 배당을 확률로 환산(마진 제거)하면 ${m.home} ${pct(mk.pHome)} · 무 ${pct(mk.pDraw)} · ${m.away} ${pct(mk.pAway)}입니다.`,
    );
    if (mk.n <= 2) risks.push(`배당을 낸 북메이커가 ${mk.n}곳뿐이라 시장 신호가 약합니다.`);
    if (m.basis === "model" && d.modelOnly) {
      const a = argmax(d.modelOnly);
      const b = argmax(mk);
      if (a === b) reasons.push(`배당을 섞기 전 통계 모델도 ${W(a)}(${pct(pOf(d.modelOnly, a))})를 가리켜, 모델과 시장의 판단이 일치합니다.`);
      else {
        reasons.push(`통계 모델은 ${W(a)}(${pct(pOf(d.modelOnly, a))}), 시장은 ${W(b)}(${pct(pOf(mk, b))}) 쪽으로 판단이 엇갈립니다.`);
        risks.push("모델과 시장의 판단이 서로 다릅니다.");
      }
    }
    if (d.marketOpen) {
      const delta = pOf(mk, m.pick) - pOf(d.marketOpen, m.pick);
      // 반올림한 표시값 기준으로 판단한다(45%→48%가 부동소수 오차로 빠지지 않게).
      if (Math.abs(Math.round(delta * 1000)) >= 30) {
        reasons.push(
          `첫 수집 이후 ${W(m.pick)} 확률이 ${pct(pOf(d.marketOpen, m.pick))} → ${pct(pOf(mk, m.pick))}로 ${delta > 0 ? "올라" : "내려"} 시장이 ${delta > 0 ? "이쪽으로 움직였습니다" : "이쪽에서 멀어졌습니다"}.`,
        );
        if (delta < 0) risks.push(`배당이 추천과 반대 방향으로 ${pp(delta)} 움직였습니다.`);
      }
    }
  }

  // 2) 클럽 전력(Elo·폼·맞대결) - 클럽 모델 경기만
  if (m.basis === "model" && d) {
    if (d.eloDiff != null) {
      const a = Math.abs(Math.round(d.eloDiff));
      reasons.push(
        a < 25
          ? `Elo 전력 지수는 ${a}점 차로 사실상 대등합니다(홈 이점은 별도 반영).`
          : `Elo 전력 지수는 ${josa(d.eloDiff > 0 ? m.home : m.away, "이", "가")} ${a}점 앞섭니다(홈 이점은 별도 반영).`,
      );
    }
    if (d.formDiff != null) {
      const f = d.formDiff;
      reasons.push(
        Math.abs(f) >= 0.4
          ? `최근 5경기 경기당 승점은 ${josa(f > 0 ? m.home : m.away, "이", "가")} ${Math.abs(f).toFixed(1)}점 높습니다.`
          : `최근 5경기 흐름은 비슷합니다(경기당 승점 차 ${Math.abs(f).toFixed(1)}).`,
      );
    }
    if (d.h2hDiff != null && d.nH2h >= 2 && Math.abs(d.h2hDiff) >= 0.3) {
      reasons.push(`최근 맞대결 ${d.nH2h}경기에서는 ${josa(d.h2hDiff > 0 ? m.home : m.away, "이", "가")} 우세했습니다.`);
    }
  }

  // 3) 국가대표 Elo - 배당과 교차 확인
  if (d?.natProbs) {
    const n = argmax(d.natProbs);
    const lead =
      d.natEloDiff != null && Math.abs(d.natEloDiff) >= 1
        ? `${josa(d.natEloDiff > 0 ? m.home : m.away, "이", "가")} ${Math.abs(Math.round(d.natEloDiff))}점 높고, 홈 이점까지 반영하면 `
        : "";
    reasons.push(`국가대표 Elo(1872년 이후 A매치 기반)는 ${lead}${W(n)} ${pct(pOf(d.natProbs, n))}입니다.`);
    if (d.market) {
      if (n === argmax(d.market)) reasons.push("배당과 국가대표 Elo, 두 독립된 근거가 같은 방향입니다.");
      else risks.push(`배당(${W(argmax(d.market))})과 국가대표 Elo(${W(n)})의 판단이 다릅니다.`);
    }
  }

  // 4) 대중(베트맨 투표) - 당첨금 가치 관점
  if (m.vote) {
    const v = m.vote;
    const vp = (o: Outcome) => (o === "홈승" ? v.home : o === "무승부" ? v.draw : v.away) / 100;
    const fav = argmax({ pHome: v.home, pDraw: v.draw, pAway: v.away });
    if (fav === m.pick) {
      const over = vp(m.pick) - pOf(m, m.pick);
      reasons.push(`베트맨 구매자의 ${pct(vp(m.pick))}도 같은 선택을 했습니다.`);
      if (over >= 0.15) risks.push(`대중 쏠림(${pct(vp(m.pick))})이 확률(${pct(pOf(m, m.pick))})보다 커서, 맞혀도 당첨금 몫은 작습니다.`);
    } else {
      reasons.push(`베트맨 구매자는 ${W(fav)}에 ${pct(vp(fav))} 몰려 있어 우리 판단과 다릅니다. 맞으면 당첨자가 적어 가치가 큰 경기입니다.`);
    }
  }

  // 5) 과거 같은 확신 구간의 실제 적중률(검증된 수치만)
  if (m.basis === "model" && d?.calib) {
    const c = d.calib;
    reasons.push(
      `같은 확신도 구간(${Math.round(c.minGap * 100)}~${Math.round(c.maxGap * 100)}%p)의 과거 적중률은 ${pct(c.accuracy)}입니다(검증 ${c.n.toLocaleString("ko-KR")}경기).`,
    );
  } else if (m.basis === "national") {
    reasons.push("국가대표 Elo의 과거 공식전 적중률은 약 61%입니다(2010년 이후 1만여 경기 검증). 배당이 올라오면 배당 기준으로 바뀝니다.");
  }

  // 위험: 박빙·무승부
  if (m.confidenceGap < 0.05) risks.push(`1·2위 확률 차가 ${pp(m.confidenceGap)}에 불과한 박빙입니다.`);
  if (m.pDraw >= Math.max(0.29, ctx.avgDraw + 0.02)) {
    risks.push(`무승부 확률이 ${pct(m.pDraw)}로 이번 회차 평균(${pct(ctx.avgDraw)})보다 높습니다.`);
  }

  // 권장 커버: 확률 차이와 위험 신호로 정한다(적중을 약속하지 않는 표현).
  let stance: MatchAnalysis["stance"];
  let cover: Outcome[];
  if (m.confidenceGap >= 0.2 && risks.length === 0) {
    stance = "단식";
    cover = [m.pick];
  } else if (m.confidenceGap >= 0.1) {
    stance = "단식·여유 시 복식";
    cover = [m.pick, second];
  } else if (m.confidenceGap < 0.03 && m.pDraw >= 0.28) {
    stance = "삼복식 고려";
    cover = [...OUT];
  } else {
    stance = "복식";
    cover = [m.pick, second];
  }
  const verdict =
    stance === "단식"
      ? `${josa(W(m.pick), "이", "가")} 가장 유력하고(${pct(pOf(m, m.pick))}) 반대 신호가 없어, 상대적으로 단식에 적합한 경기입니다.`
      : stance === "단식·여유 시 복식"
        ? `${josa(W(m.pick), "이", "가")} 우세하지만(${pct(pOf(m, m.pick))}), 예산에 여유가 있으면 ${W(second)}까지 덮는 것을 고려할 만합니다.`
        : stance === "삼복식 고려"
          ? `세 결과가 모두 열려 있어 삼복식을 고려할 만한 경기입니다.`
          : `${josa(W(m.pick), "과", "와")} ${josa(W(second), "을", "를")} 함께 덮는 복식이 적합한 경기입니다.`;

  return { reasons, risks, stance, cover, verdict };
}
