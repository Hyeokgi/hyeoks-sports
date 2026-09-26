// 회차 분석 글: 검색에 노출되는 회차 페이지(/round/:no)와 블로그 초안(/round/:no/draft)이
// 같은 내용을 쓰도록 한 곳에서 만든다. 네트워크·DB를 타지 않는 순수 함수라 테스트로 고정한다.
//
// 원칙(앱과 동일): 확률의 출처(모델/배당/국가대표 Elo/근거없음)를 경기마다 밝히고,
// 적중을 약속하는 표현을 쓰지 않으며, 구매는 공식 판매처에서만 가능하다는 고지를 항상 붙인다.
import type { PredictionBasis } from "./prediction";
import { analyzeMatch, who as whoOf, type MatchAnalysis, type MatchDetail } from "./matchAnalysis";

export interface ArticleMatch {
  seq: number;
  league: string;
  home: string;
  away: string;
  kickoffAt: string | null;
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: "홈승" | "무승부" | "원정승";
  confidenceGap: number;
  basis: PredictionBasis;
  tier: string; // 확신픽/보통/불확실/근거없음(모델 경기만 의미 있음)
  nBookmakers: number | null;
  vote: { home: number; draw: number; away: number } | null;
  result: { actual: "H" | "D" | "A"; hg: number | null; ag: number | null } | null;
  predictedAfterKickoff: boolean;
  // 근거 원자료(배당·흐름·Elo·폼·맞대결·국가대표 Elo·과거 적중률). 끝난 경기엔 없어도 된다.
  detail?: MatchDetail | null;
  // buildRoundArticle이 채운다: 근거·위험·권장 커버(끝나지 않은 경기만).
  analysis?: MatchAnalysis | null;
}

export interface RecentRecord {
  roundNo: number;
  hits: number;
  n: number;
}

export interface ArticleInput {
  roundNo: number;
  matches: ArticleMatch[];
  report: string | null;
  recent: RecentRecord[];
  origin: string; // https://... (링크 생성용)
  appRoundId: number;
  // 데이터 기준 시각(가장 최근 배당 갱신 시각, ISO). 페이지·초안·블로그 이미지가 같은 시점의
  // 데이터인지 확인할 수 있게 모든 산출물에 같이 찍는다.
  asOf?: string | null;
  // betman 발매 마감(UTC ISO, rounds.sale_end_at). 첫 경기와 다르므로 따로 받는다. 수집 전이면 null.
  saleEndAt?: string | null;
  now?: number;
}

export interface RoundArticle {
  roundNo: number;
  title: string;
  description: string;
  leagues: string[];
  deadline: string | null; // 첫 경기 KST 표기
  // betman 발매 마감. 블로그 자동 갱신(마감 12·6·3·1시간 전)이 이 값을 기준으로 돈다. 수집 전이면 null.
  saleEndAt: string | null; // UTC ISO
  saleDeadline: string | null; // KST 표기
  matches: ArticleMatch[];
  report: string | null;
  top: ArticleMatch[]; // 확신도 상위(근거 있는 경기만)
  hedges: ArticleMatch[]; // 확신도 하위(복식 후보)
  crowdSplits: ArticleMatch[]; // 대중 투표 1위와 우리 픽이 다른 경기
  keyMatches: number[]; // 심층 분석할 경기 seq(중요도 순)
  highlights: string[]; // 한눈에 보기 요점
  basisSummary: string; // 근거 구성(배당 N · 모델 N · 국가대표 Elo N …)
  strategy: string | null; // 구매 전략 요약
  recent: RecentRecord[];
  tags: string[];
  pageUrl: string;
  draftUrl: string;
  appUrl: string;
  dataUrl: string;
  asOf: string | null;
  asOfKst: string | null;
}

// 유입 측정용 링크 꼬리표. 블로그 글에서 온 방문과 회차 페이지에서 온 방문을 구분한다.
export type LinkSource = "blog" | "round_page";
export function withUtm(url: string, source: LinkSource, roundNo: number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=${source}&utm_campaign=r${roundNo}`;
}

export const DISCLAIMER =
  "본 글은 통계 모델과 해외 배당을 바탕으로 한 참고 자료이며 적중이나 수익을 보장하지 않습니다. " +
  "체육진흥투표권(스포츠토토)은 공식 판매처(베트맨)에서만 구매할 수 있고, 만 19세 미만은 구매할 수 없습니다.";

const BASIS_TEXT: Record<PredictionBasis, string> = {
  model: "모델",
  market: "배당",
  national: "국가대표 Elo",
  none: "근거 없음",
};

const KST = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatKst(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : KST.format(d);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// 분석 방법 설명. 과장 없이, 실제로 하는 것만 쓴다(검증 기준·예측 보존은 사실).
export const METHOD_TEXT =
  "확률은 ① 해외 북메이커 여러 곳의 평균 배당(마진 제거) ② 전력 지수(리그별 Elo, 국가대표는 1872년 이후 A매치 기반 Elo) " +
  "③ 최근 5경기 흐름과 맞대결 ④ 리그별 무승부율을 근거로 계산합니다. 새 요소는 과거 경기를 시간순으로 나눈 교차검증에서 " +
  "적중률과 확률 정확도가 모두 나빠지지 않을 때만 반영하고, 경기 시작 전에 공개한 예측은 기록으로 보존해 사후에 고치지 않습니다.";
const RESULT_LABEL = { H: "홈승", D: "무승부", A: "원정승" } as const;

export function buildRoundArticle(input: ArticleInput): RoundArticle {
  const { roundNo, matches, origin } = input;
  const leagues = [...new Set(matches.map((m) => m.league))];
  const kicks = matches.map((m) => (m.kickoffAt ? Date.parse(m.kickoffAt) : NaN)).filter(Number.isFinite);
  const first = kicks.length ? new Date(Math.min(...kicks)).toISOString() : null;
  const deadline = formatKst(first);
  const saleEndAt = input.saleEndAt ?? null;
  const saleDeadline = formatKst(saleEndAt);

  // 근거 없는 경기(배당도 모델도 없음)는 상위·하위 어디에도 넣지 않는다 - 확률이 임시값이다.
  const grounded = matches.filter((m) => m.basis !== "none" && !m.result);
  const byGap = [...grounded].sort((a, b) => b.confidenceGap - a.confidenceGap);
  const top = byGap.slice(0, 3);
  const hedges = [...grounded].sort((a, b) => a.confidenceGap - b.confidenceGap).slice(0, 4);
  const crowdSplits = grounded.filter((m) => {
    if (!m.vote) return false;
    const v = m.vote;
    const fav = v.home >= v.draw && v.home >= v.away ? "홈승" : v.draw >= v.away ? "무승부" : "원정승";
    return fav !== m.pick;
  });

  // 경기별 근거·위험 분석(끝나지 않은 경기만). 회차 평균 무승부 확률을 기준선으로 쓴다.
  const open = matches.filter((m) => !m.result);
  const avgDraw = open.length ? open.reduce((s, m) => s + m.pDraw, 0) / open.length : 0.27;
  const analyzed = matches.map((m) =>
    m.result ? { ...m, analysis: null } : { ...m, analysis: analyzeMatch({ ...m, detail: m.detail ?? null }, { avgDraw }) },
  );
  const A = (seq: number) => analyzed.find((m) => m.seq === seq)!;

  // 심층 분석 대상: 확신도 상위 2 → 대중과 갈린 경기 2 → 가장 박빙 2 (중복 제외, 최대 6)
  const keyMatches: number[] = [];
  const addKey = (ms: ArticleMatch[], n: number) => {
    for (const m of ms) {
      if (n <= 0 || keyMatches.length >= 6) break;
      if (!keyMatches.includes(m.seq)) {
        keyMatches.push(m.seq);
        n--;
      }
    }
  };
  addKey(top, 2);
  addKey(crowdSplits, 2);
  addKey(hedges, 2);

  const counts = { model: 0, market: 0, national: 0, none: 0 } as Record<PredictionBasis, number>;
  for (const m of matches) counts[m.basis]++;
  const basisSummary = (Object.keys(counts) as PredictionBasis[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${BASIS_TEXT[k]} ${counts[k]}경기`)
    .join(" · ");

  const highlights: string[] = [];
  if (top[0]) highlights.push(`가장 뚜렷한 경기: ${top[0].seq}번 ${top[0].home} vs ${top[0].away} → ${whoOf(top[0].pick, top[0].home, top[0].away)}`);
  if (hedges[0]) highlights.push(`가장 박빙인 경기: ${hedges[0].seq}번 ${hedges[0].home} vs ${hedges[0].away} (1·2위 차 ${(hedges[0].confidenceGap * 100).toFixed(1)}%p)`);
  const drawy = [...open].filter((m) => m.basis !== "none").sort((x, y) => y.pDraw - x.pDraw)[0];
  if (drawy) highlights.push(`무승부 경계: ${drawy.seq}번 ${drawy.home} vs ${drawy.away} (무승부 ${pct(drawy.pDraw)})`);
  if (crowdSplits.length) highlights.push(`대중과 판단이 갈린 경기 ${crowdSplits.length}개 - 맞으면 당첨금 가치가 큰 경기입니다.`);

  const stances = analyzed.filter((m) => m.analysis && m.analysis.stance !== "판단 보류");
  const singles = stances.filter((m) => m.analysis!.stance === "단식").map((m) => m.seq);
  const doubles = stances.filter((m) => m.analysis!.stance === "복식").map((m) => m.seq);
  const triples = stances.filter((m) => m.analysis!.stance === "삼복식 고려").map((m) => m.seq);
  const soft = stances.filter((m) => m.analysis!.stance === "단식·여유 시 복식").map((m) => m.seq);
  const strategy = stances.length
    ? [
        singles.length ? `단식 권장 ${singles.length}경기(${singles.join("·")}번)` : null,
        soft.length ? `단식 가능·여유 시 복식 ${soft.length}경기(${soft.join("·")}번)` : null,
        doubles.length ? `복식 권장 ${doubles.length}경기(${doubles.join("·")}번)` : null,
        triples.length ? `삼복식 고려 ${triples.length}경기(${triples.join("·")}번)` : null,
      ]
        .filter(Boolean)
        .join(", ") +
      "." +
      // 복식·삼복식을 모두 덮으면 조합 수가 곱으로 늘어난다(삼복식 4경기만으로 81배). 예산 안내를 붙인다.
      (doubles.length + triples.length * 2 + soft.length >= 4
        ? ` 표시된 경기를 모두 덮으면 조합 수가 ${2 ** (doubles.length + soft.length) * 3 ** triples.length}배로 늘어나므로, 확률 차이가 가장 작은 경기부터 예산에 맞춰 일부만 덮는 것이 현실적입니다(앱의 예산별 조합 기능 참고).`
        : "")
    : null;

  const lg = leagues.join("·");
  const title = `${roundNo}회차 축구토토 승무패 분석 리포트 | ${lg} ${matches.length}경기 근거·복식 전략`;
  const description =
    `${roundNo}회차 승무패 ${matches.length}경기(${lg}) 경기별 확률과 판단 근거(배당·배당 흐름·전력 지수·대중 투표), ` +
    `변수와 위험, 단식·복식 전략, 지난 회차 실제 성적을 정리한 분석 리포트입니다.` +
    (saleDeadline ? ` 발매 마감 ${saleDeadline}(KST).` : "") +
    (deadline ? ` 첫 경기 ${deadline}(KST).` : "");
  const tags = ["축구토토", "승무패", `승무패${roundNo}회차`, `${roundNo}회차`, "토토분석", "스포츠토토", ...leagues];

  return {
    roundNo,
    title,
    description,
    leagues,
    deadline,
    saleEndAt,
    saleDeadline,
    matches: analyzed,
    report: input.report,
    top: top.map((m) => A(m.seq)),
    hedges: hedges.map((m) => A(m.seq)),
    crowdSplits: crowdSplits.map((m) => A(m.seq)),
    keyMatches,
    highlights,
    basisSummary,
    strategy,
    recent: input.recent.filter((r) => r.n > 0),
    tags: [...new Set(tags)],
    pageUrl: `${origin}/round/${roundNo}`,
    draftUrl: `${origin}/round/${roundNo}/draft`,
    appUrl: `${origin}/?round=${roundNo}`,
    dataUrl: `${origin}/round/${roundNo}/data.json`,
    asOf: input.asOf ?? null,
    asOfKst: formatKst(input.asOf ?? null),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function matchLine(m: ArticleMatch): string {
  return `${m.seq}. ${m.home} vs ${m.away}`;
}

const who = (m: ArticleMatch, o: ArticleMatch["pick"]) => whoOf(o, m.home, m.away);
const ADVANCED = "근거가 둘 이상 같은 방향이고 확률 차이가 큰 경기부터 싱글로, 박빙인 경기는 복식으로 덮는 것이 기본 전략입니다.";

/** 경기 한 개의 심층 분석 블록(HTML). 근거 → 위험 → 판단 순서. */
function analysisBlockHtml(m: ArticleMatch): string {
  const e = escapeHtml;
  const an = m.analysis!;
  const head =
    `<h3>${e(matchLine(m))} <small>${e(m.league)}${m.kickoffAt ? ` · ${e(formatKst(m.kickoffAt) ?? "")}` : ""}</small></h3>` +
    `<p><b>판단: ${e(who(m, m.pick))} ${pct(m.pick === "홈승" ? m.pHome : m.pick === "무승부" ? m.pDraw : m.pAway)}</b> · ${e(an.stance)} ` +
    `<small>(홈 ${pct(m.pHome)} / 무 ${pct(m.pDraw)} / 원정 ${pct(m.pAway)}, 근거: ${e(BASIS_TEXT[m.basis])})</small></p>`;
  const reasons = an.reasons.length ? `<p><b>근거</b></p><ul>${an.reasons.map((r) => `<li>${e(r)}</li>`).join("")}</ul>` : "";
  const risks = an.risks.length
    ? `<p><b>변수·위험</b></p><ul>${an.risks.map((r) => `<li>${e(r)}</li>`).join("")}</ul>`
    : `<p><b>변수·위험</b>: 뚜렷한 반대 신호는 없습니다. 다만 단일 경기는 언제든 뒤집힐 수 있습니다.</p>`;
  return head + reasons + risks + `<p>→ ${e(an.verdict)}</p>`;
}

/** 페이지와 블로그 초안이 공유하는 본문 HTML. 블로그 편집기에 붙여넣을 수 있게 단순한 태그만 쓴다. */
export function renderArticleBodyHtml(a: RoundArticle, source: LinkSource = "round_page"): string {
  const e = escapeHtml;
  const parts: string[] = [];
  const appLink = withUtm(a.appUrl, source, a.roundNo);

  // 1. 한눈에 보기
  parts.push(`<h2>이번 회차 한눈에 보기</h2>`);
  parts.push(
    `<p>${e(`${a.roundNo}회차 축구토토 승무패는 ${a.leagues.join("·")} ${a.matches.length}경기로 구성됩니다.`)}` +
      (a.saleDeadline
        ? ` ${e(`발매 마감은 ${a.saleDeadline}${a.deadline ? `, 첫 경기는 ${a.deadline}` : ""}(한국시간)입니다.`)}`
        : a.deadline
          ? ` ${e(`첫 경기는 ${a.deadline}(한국시간)이며, 발매는 그 전에 마감됩니다.`)}`
          : "") +
      `</p>`,
  );
  parts.push(
    `<p><small>${e(a.asOfKst ? `데이터 기준: ${a.asOfKst} (해외 배당 최종 갱신 시각, 한국시간)` : "데이터 기준: 배당 수집 전")}</small></p>`,
  );
  if (a.highlights.length) parts.push(`<ul>${a.highlights.map((h) => `<li>${e(h)}</li>`).join("")}</ul>`);

  // 2. 분석 방법(신뢰의 근거)
  parts.push(`<h2>분석 방법</h2>`);
  parts.push(`<p>${e(METHOD_TEXT)}</p>`);
  parts.push(`<p><small>${e(`이번 회차 근거 구성: ${a.basisSummary}`)}</small></p>`);

  if (a.report) {
    parts.push(`<h2>애널리스트 코멘트</h2>`);
    for (const para of a.report.split(/\n+/).filter(Boolean)) parts.push(`<p>${e(para)}</p>`);
  }

  // 3. 핵심 경기 심층 분석
  const keys = a.keyMatches.map((seq) => a.matches.find((m) => m.seq === seq)!).filter((m) => m?.analysis);
  if (keys.length) {
    parts.push(`<h2>핵심 경기 심층 분석</h2>`);
    parts.push(`<p><small>확신도가 가장 높은 경기, 대중과 판단이 갈린 경기, 가장 박빙인 경기를 골랐습니다.</small></p>`);
    for (const m of keys) parts.push(analysisBlockHtml(m));
  }

  // 4. 전체 경기 확률표 + 한 줄 코멘트
  parts.push(`<h2>전체 경기 확률표</h2>`);
  parts.push(
    `<table><thead><tr><th>번호</th><th>경기</th><th>홈</th><th>무</th><th>원정</th><th>판단</th><th>근거</th></tr></thead><tbody>` +
      a.matches
        .map((m) => {
          const basis =
            m.basis === "model" ? `모델(${m.tier})` : m.basis === "market" && m.nBookmakers ? `배당 ${m.nBookmakers}개사` : BASIS_TEXT[m.basis];
          const res = m.result
            ? ` → 결과 ${RESULT_LABEL[m.result.actual]}${m.result.hg != null && m.result.ag != null ? ` ${m.result.hg}:${m.result.ag}` : ""}`
            : "";
          const call = m.basis === "none" ? "-" : m.analysis && !m.result ? `${m.pick}<br><small>${e(m.analysis.stance)}</small>` : m.pick;
          return (
            `<tr><td>${m.seq}</td><td>${e(`${m.home} vs ${m.away}`)}<br><small>${e(m.league)}${m.kickoffAt ? ` · ${e(formatKst(m.kickoffAt) ?? "")}` : ""}</small></td>` +
            `<td>${pct(m.pHome)}</td><td>${pct(m.pDraw)}</td><td>${pct(m.pAway)}</td>` +
            `<td><b>${call}</b>${e(res)}</td><td>${e(basis)}</td></tr>`
          );
        })
        .join("") +
      `</tbody></table>`,
  );
  if (a.matches.some((m) => m.basis === "none")) {
    parts.push(`<p><small>근거 없음: 배당이 아직 올라오지 않은 경기로, 표시된 확률은 평균 무승부율 기준 임시값입니다.</small></p>`);
  }
  const rest = a.matches.filter((m) => m.analysis && !m.result && !a.keyMatches.includes(m.seq));
  if (rest.length) {
    parts.push(`<h2>나머지 경기 코멘트</h2><ul>`);
    for (const m of rest) {
      const why = m.analysis!.reasons[0] ?? "";
      const risk = m.analysis!.risks[0] ? ` 주의: ${m.analysis!.risks[0]}` : "";
      parts.push(`<li><b>${e(matchLine(m))}</b> — ${e(m.analysis!.verdict)} ${e(why)}${e(risk)}</li>`);
    }
    parts.push(`</ul>`);
  }

  // 5. 구매 전략
  if (a.strategy) {
    parts.push(`<h2>구매 전략</h2>`);
    parts.push(`<p>${e(a.strategy)}</p><p><small>${e(ADVANCED)}</small></p>`);
  }
  if (a.crowdSplits.length) {
    parts.push(`<h2>대중과 다른 선택</h2>`);
    parts.push(`<p>베트맨 투표율 1위와 우리 판단이 다른 경기입니다. 맞으면 당첨자가 적어 배당 가치가 커집니다.</p><ul>`);
    for (const m of a.crowdSplits) {
      const v = m.vote!;
      parts.push(`<li>${e(matchLine(m))} — 판단 <b>${m.pick}</b> / 투표율 홈 ${v.home.toFixed(0)}% · 무 ${v.draw.toFixed(0)}% · 원정 ${v.away.toFixed(0)}%</li>`);
    }
    parts.push(`</ul>`);
  }

  // 6. 지난 회차 복기(실제 기록)
  if (a.recent.length) {
    parts.push(`<h2>지난 회차 실제 성적</h2><ul>`);
    for (const r of a.recent) {
      parts.push(`<li>${r.roundNo}회차: ${r.hits}/${r.n} 적중 (${((r.hits / r.n) * 100).toFixed(1)}%)</li>`);
    }
    parts.push(
      `</ul><p><small>경기 시작 전에 공개한 예측 그대로 채점했고, 경기가 끝난 뒤 등록된 경기는 뺐습니다. 좋은 회차만 골라 보여주지 않습니다.</small></p>`,
    );
  }
  parts.push(`<p>경기별 근거를 직접 조절해 조합을 짜보려면: <a href="${e(appLink)}">${e(a.appUrl)}</a></p>`);
  parts.push(`<p><small>${e(DISCLAIMER)}</small></p>`);
  return parts.join("\n");
}

/** 블로그에 서식 없이 붙여넣을 때 쓰는 일반 텍스트 버전. */
export function renderArticlePlainText(a: RoundArticle, source: LinkSource = "blog"): string {
  const L: string[] = [];
  L.push("■ 이번 회차 한눈에 보기");
  L.push(`${a.roundNo}회차 축구토토 승무패는 ${a.leagues.join("·")} ${a.matches.length}경기로 구성됩니다.` + (a.saleDeadline ? ` 발매 마감은 ${a.saleDeadline}(한국시간)입니다.` : "") + (a.deadline ? ` 첫 경기는 ${a.deadline}(한국시간)입니다.` : ""));
  L.push(a.asOfKst ? `데이터 기준: ${a.asOfKst} (한국시간)` : "데이터 기준: 배당 수집 전");
  for (const h of a.highlights) L.push(`- ${h}`);
  L.push("", "■ 분석 방법", METHOD_TEXT, `이번 회차 근거 구성: ${a.basisSummary}`);
  if (a.report) L.push("", "■ 애널리스트 코멘트", a.report);
  const keys = a.keyMatches.map((seq) => a.matches.find((m) => m.seq === seq)!).filter((m) => m?.analysis);
  if (keys.length) {
    L.push("", "■ 핵심 경기 심층 분석");
    for (const m of keys) {
      const an = m.analysis!;
      L.push("", `▶ ${matchLine(m)} (${m.league})`, `판단: ${who(m, m.pick)} · ${an.stance} (홈 ${pct(m.pHome)} / 무 ${pct(m.pDraw)} / 원정 ${pct(m.pAway)})`);
      if (an.reasons.length) L.push("근거", ...an.reasons.map((r) => `- ${r}`));
      L.push("변수·위험", ...(an.risks.length ? an.risks.map((r) => `- ${r}`) : ["- 뚜렷한 반대 신호는 없습니다."]));
      L.push(`→ ${an.verdict}`);
    }
  }
  L.push("", "■ 전체 경기 (홈/무/원정 · 판단 · 근거)");
  for (const m of a.matches) {
    L.push(
      `${m.seq}. ${m.home} vs ${m.away} (${m.league}) ${pct(m.pHome)}/${pct(m.pDraw)}/${pct(m.pAway)} · ${m.basis === "none" ? "-" : m.pick}${m.analysis && !m.result ? ` (${m.analysis.stance})` : ""} · ${BASIS_TEXT[m.basis]}`,
    );
  }
  if (a.strategy) L.push("", "■ 구매 전략", a.strategy, ADVANCED);
  if (a.recent.length) {
    L.push("", "■ 지난 회차 실제 성적 (경기 전 공개 예측 기준)");
    for (const r of a.recent) L.push(`- ${r.roundNo}회차: ${r.hits}/${r.n} 적중`);
  }
  L.push("", `경기별 근거를 직접 조절해 조합 짜보기: ${withUtm(a.appUrl, source, a.roundNo)}`, "", DISCLAIMER);
  return L.join("\n");
}

const PAGE_CSS = `
:root{--bg:#0f1420;--card:#171e2d;--ink:#e8edf6;--muted:#9aa6bb;--line:#26314a;--accent:#f2a93b}
@media (prefers-color-scheme: light){:root{--bg:#f6f7fb;--card:#fff;--ink:#141a26;--muted:#5b6475;--line:#e3e7ef}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 56px}h1{font-size:1.45rem;line-height:1.35;margin:.2em 0 .6em}
h2{font-size:1.1rem;margin:1.8em 0 .6em;padding-top:.4em;border-top:1px solid var(--line)}
h3{font-size:1rem;margin:1.6em 0 .3em;padding:.5em .7em;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent);border-radius:6px}h3 small{font-weight:400;color:var(--muted)}ul{padding-left:1.2em}li{margin:.25em 0}
p,li{color:var(--ink)}small{color:var(--muted)}a{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle}
td:nth-child(2){text-align:left}th{color:var(--muted);font-weight:600;white-space:nowrap}td b{white-space:nowrap}
@media (max-width:520px){table{font-size:.84rem}th,td{padding:7px 3px}}
.table-wrap{overflow-x:auto}.cta{display:inline-block;margin:10px 0;padding:10px 16px;border-radius:10px;background:var(--accent);color:#141a26;font-weight:700;text-decoration:none}
.meta{color:var(--muted);font-size:.9rem}button{font:inherit;padding:8px 14px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
textarea{width:100%;min-height:220px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px;font:13px/1.5 ui-monospace,monospace}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.ok{color:#3ecf8e;font-size:.9rem}
`;

/** 검색 노출용 회차 분석 페이지. */
export function renderRoundPage(a: RoundArticle): string {
  const e = escapeHtml;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    inLanguage: "ko-KR",
    mainEntityOfPage: a.pageUrl,
  };
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(a.title)}</title>
<meta name="description" content="${e(a.description)}">
<link rel="canonical" href="${e(a.pageUrl)}">
<meta property="og:type" content="article"><meta property="og:title" content="${e(a.title)}">
<meta property="og:description" content="${e(a.description)}"><meta property="og:url" content="${e(a.pageUrl)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
<style>${PAGE_CSS}</style></head>
<body><main>
<p class="meta"><a href="/">HYEOKS 승무패 분석</a> · ${a.roundNo}회차</p>
<h1>${e(a.title)}</h1>
<a class="cta" id="cta-app" href="${e(withUtm(a.appUrl, "round_page", a.roundNo))}">앱에서 조합 직접 짜보기 →</a>
<div class="card table-wrap">
${renderArticleBodyHtml(a, "round_page")}
</div>
</main>
<script>
(function(){try{var q=new URLSearchParams(location.search);var d={r:${a.roundNo},u:q.get("utm_source"),ref:document.referrer};
function send(e){try{d.e=e;navigator.sendBeacon("/api/e",JSON.stringify(d))}catch(_){}}
send("round_page_view");var c=document.getElementById("cta-app");if(c)c.addEventListener("click",function(){send("round_page_cta")})}catch(_){}})();
</script>
</body></html>`;
}

/** 블로그 초안 페이지(검색 제외). 제목·본문(서식)·본문(텍스트)·태그를 각각 복사할 수 있다. */
export function renderDraftPage(a: RoundArticle): string {
  const e = escapeHtml;
  // 초안은 블로그에 붙여넣는 글이라 링크에 blog 꼬리표를 단다(블로그 유입 측정).
  const body = renderArticleBodyHtml(a, "blog");
  const plain = renderArticlePlainText(a, "blog");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>[초안] ${e(a.roundNo + "회차")} 블로그 글</title>
<style>${PAGE_CSS}</style></head>
<body><main>
<p class="meta">블로그 초안 · 검색에 노출되지 않는 페이지입니다 · <a href="${e(a.pageUrl)}">공개 분석 페이지</a></p>
<h1>${a.roundNo}회차 블로그 초안</h1>
<p class="meta">올리기 전에 한 번 읽어보세요. 고지 문구(맨 아래)는 지우지 마세요.</p>

<h2>1. 제목</h2>
<div class="row"><input id="title" value="${e(a.title)}" style="flex:1;min-width:0;padding:9px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink)" readonly>
<button data-copy="title">제목 복사</button></div>

<h2>2. 본문</h2>
<div class="row"><button id="copy-rich">본문 복사 (서식 포함)</button><button data-copy="plain">본문 복사 (텍스트만)</button><span id="msg" class="ok"></span></div>
<p class="meta">블로그 편집기에 서식 포함으로 붙여넣으면 표·제목이 유지됩니다. 표가 깨지면 텍스트만 복사를 쓰세요.</p>
<div class="card table-wrap" id="rich">${body}</div>
<textarea id="plain" readonly>${e(plain)}</textarea>

<h2>3. 태그</h2>
<div class="row"><input id="tags" value="${e(a.tags.join(", "))}" style="flex:1;min-width:0;padding:9px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink)" readonly>
<button data-copy="tags">태그 복사</button></div>
</main>
<script>
const msg=(t)=>{const m=document.getElementById("msg");m.textContent=t;setTimeout(()=>m.textContent="",2500)};
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch{const x=document.createElement("textarea");x.value=t;document.body.appendChild(x);x.select();const ok=document.execCommand("copy");x.remove();return ok}}
document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",async()=>{const el=document.getElementById(b.dataset.copy);msg(await copyText(el.value)?"복사했습니다":"복사 실패 - 직접 선택해 복사하세요")}));
document.getElementById("copy-rich").addEventListener("click",async()=>{const el=document.getElementById("rich");const html=el.innerHTML,text=document.getElementById("plain").value;
try{await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([text],{type:"text/plain"})})]);msg("서식 포함으로 복사했습니다")}
catch{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);const ok=document.execCommand("copy");s.removeAllRanges();msg(ok?"복사했습니다":"복사 실패 - 직접 선택해 복사하세요")}});
</script>
</body></html>`;
}
