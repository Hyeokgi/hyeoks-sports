// 회차 분석 글: 검색에 노출되는 회차 페이지(/round/:no)와 블로그 초안(/round/:no/draft)이
// 같은 내용을 쓰도록 한 곳에서 만든다. 네트워크·DB를 타지 않는 순수 함수라 테스트로 고정한다.
//
// 원칙(앱과 동일): 확률의 출처(모델/배당/국가대표 Elo/근거없음)를 경기마다 밝히고,
// 적중을 약속하는 표현을 쓰지 않으며, 구매는 공식 판매처에서만 가능하다는 고지를 항상 붙인다.
import type { PredictionBasis } from "./prediction";

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
  now?: number;
}

export interface RoundArticle {
  roundNo: number;
  title: string;
  description: string;
  leagues: string[];
  deadline: string | null; // KST 표기
  matches: ArticleMatch[];
  report: string | null;
  top: ArticleMatch[]; // 확신도 상위(근거 있는 경기만)
  hedges: ArticleMatch[]; // 확신도 하위(복식 후보)
  crowdSplits: ArticleMatch[]; // 대중 투표 1위와 우리 픽이 다른 경기
  recent: RecentRecord[];
  tags: string[];
  pageUrl: string;
  draftUrl: string;
  appUrl: string;
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
const RESULT_LABEL = { H: "홈승", D: "무승부", A: "원정승" } as const;

export function buildRoundArticle(input: ArticleInput): RoundArticle {
  const { roundNo, matches, origin } = input;
  const leagues = [...new Set(matches.map((m) => m.league))];
  const kicks = matches.map((m) => (m.kickoffAt ? Date.parse(m.kickoffAt) : NaN)).filter(Number.isFinite);
  const first = kicks.length ? new Date(Math.min(...kicks)).toISOString() : null;
  const deadline = formatKst(first);

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

  const lg = leagues.join("·");
  const title = `${roundNo}회차 축구토토 승무패 분석 | ${lg} ${matches.length}경기 확률·복식 후보`;
  const description =
    `${roundNo}회차 승무패 ${matches.length}경기(${lg}) 경기별 홈·무·원정 확률과 예측 근거, ` +
    `확신도 상위 경기, 복식 후보, 대중 투표 쏠림을 정리했습니다.` +
    (deadline ? ` 첫 경기 ${deadline}(KST).` : "");
  const tags = ["축구토토", "승무패", `승무패${roundNo}회차`, `${roundNo}회차`, "토토분석", "스포츠토토", ...leagues];

  return {
    roundNo,
    title,
    description,
    leagues,
    deadline,
    matches,
    report: input.report,
    top,
    hedges,
    crowdSplits,
    recent: input.recent.filter((r) => r.n > 0),
    tags: [...new Set(tags)],
    pageUrl: `${origin}/round/${roundNo}`,
    draftUrl: `${origin}/round/${roundNo}/draft`,
    appUrl: `${origin}/?round=${roundNo}`,
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function matchLine(m: ArticleMatch): string {
  return `${m.seq}. ${m.home} vs ${m.away}`;
}

/** 페이지와 블로그 초안이 공유하는 본문 HTML. 블로그 편집기에 붙여넣을 수 있게 단순한 태그만 쓴다. */
export function renderArticleBodyHtml(a: RoundArticle): string {
  const e = escapeHtml;
  const parts: string[] = [];
  parts.push(
    `<p>${e(`${a.roundNo}회차 축구토토 승무패는 ${a.leagues.join("·")} ${a.matches.length}경기로 구성됩니다.`)}` +
      (a.deadline ? ` ${e(`첫 경기는 ${a.deadline}(한국시간)이며, 발매는 그 직전에 마감됩니다.`)}` : "") +
      `</p>`,
  );
  if (a.report) {
    parts.push(`<h2>요약</h2>`);
    for (const para of a.report.split(/\n+/).filter(Boolean)) parts.push(`<p>${e(para)}</p>`);
  }

  parts.push(`<h2>경기별 확률</h2>`);
  parts.push(
    `<table><thead><tr><th>번호</th><th>경기</th><th>홈</th><th>무</th><th>원정</th><th>추천</th><th>근거</th></tr></thead><tbody>` +
      a.matches
        .map((m) => {
          const basis =
            m.basis === "model" ? `모델(${m.tier})` : m.basis === "market" && m.nBookmakers ? `배당 ${m.nBookmakers}개사` : BASIS_TEXT[m.basis];
          const res = m.result
            ? ` → 결과 ${RESULT_LABEL[m.result.actual]}${m.result.hg != null && m.result.ag != null ? ` ${m.result.hg}:${m.result.ag}` : ""}`
            : "";
          return (
            `<tr><td>${m.seq}</td><td>${e(`${m.home} vs ${m.away}`)}<br><small>${e(m.league)}${m.kickoffAt ? ` · ${e(formatKst(m.kickoffAt) ?? "")}` : ""}</small></td>` +
            `<td>${pct(m.pHome)}</td><td>${pct(m.pDraw)}</td><td>${pct(m.pAway)}</td>` +
            `<td><b>${m.basis === "none" ? "-" : m.pick}</b>${e(res)}</td><td>${e(basis)}</td></tr>`
          );
        })
        .join("") +
      `</tbody></table>`,
  );
  if (a.matches.some((m) => m.basis === "none")) {
    parts.push(`<p><small>근거 없음: 배당이 아직 올라오지 않은 경기로, 표시된 확률은 평균 무승부율 기준 임시값입니다.</small></p>`);
  }

  if (a.top.length) {
    parts.push(`<h2>확신도 상위 경기</h2><ul>`);
    for (const m of a.top) {
      parts.push(`<li>${e(matchLine(m))} — <b>${m.pick}</b> (1·2위 확률 차 ${(m.confidenceGap * 100).toFixed(1)}%p, ${e(BASIS_TEXT[m.basis])} 기준)</li>`);
    }
    parts.push(`</ul>`);
  }
  if (a.hedges.length) {
    parts.push(`<h2>복식 후보 (확신도 하위)</h2>`);
    parts.push(`<p>1·2위 확률 차이가 작아 결과를 가장 예측하기 어려운 경기입니다. 복식·삼복식을 쓴다면 이 경기부터 덮는 것이 확률상 유리합니다.</p><ul>`);
    for (const m of a.hedges) {
      parts.push(`<li>${e(matchLine(m))} — 홈 ${pct(m.pHome)} / 무 ${pct(m.pDraw)} / 원정 ${pct(m.pAway)}</li>`);
    }
    parts.push(`</ul>`);
  }
  if (a.crowdSplits.length) {
    parts.push(`<h2>대중과 다른 선택</h2>`);
    parts.push(`<p>베트맨 투표율 1위와 우리 추천이 다른 경기입니다. 맞으면 당첨자가 적어 배당 가치가 커집니다.</p><ul>`);
    for (const m of a.crowdSplits) {
      const v = m.vote!;
      parts.push(`<li>${e(matchLine(m))} — 추천 <b>${m.pick}</b> / 투표율 홈 ${v.home.toFixed(0)}% · 무 ${v.draw.toFixed(0)}% · 원정 ${v.away.toFixed(0)}%</li>`);
    }
    parts.push(`</ul>`);
  }
  if (a.recent.length) {
    parts.push(`<h2>최근 회차 실제 성적</h2><ul>`);
    for (const r of a.recent) {
      parts.push(`<li>${r.roundNo}회차: ${r.hits}/${r.n} 적중 (${((r.hits / r.n) * 100).toFixed(1)}%)</li>`);
    }
    parts.push(`</ul><p><small>경기가 끝난 뒤 등록된 경기는 집계에서 뺐습니다. 과장 없이 실제 결과 그대로입니다.</small></p>`);
  }
  parts.push(`<p>직접 조합을 짜보려면: <a href="${e(a.appUrl)}">${e(a.appUrl)}</a></p>`);
  parts.push(`<p><small>${e(DISCLAIMER)}</small></p>`);
  return parts.join("\n");
}

/** 블로그에 서식 없이 붙여넣을 때 쓰는 일반 텍스트 버전. */
export function renderArticlePlainText(a: RoundArticle): string {
  const lines: string[] = [];
  lines.push(`${a.roundNo}회차 축구토토 승무패는 ${a.leagues.join("·")} ${a.matches.length}경기로 구성됩니다.` + (a.deadline ? ` 첫 경기는 ${a.deadline}(한국시간)입니다.` : ""));
  if (a.report) lines.push("", "■ 요약", a.report);
  lines.push("", "■ 경기별 확률 (홈/무/원정 · 추천 · 근거)");
  for (const m of a.matches) {
    lines.push(
      `${m.seq}. ${m.home} vs ${m.away} (${m.league}) ${pct(m.pHome)}/${pct(m.pDraw)}/${pct(m.pAway)} · ${m.basis === "none" ? "-" : m.pick} · ${BASIS_TEXT[m.basis]}`,
    );
  }
  if (a.top.length) {
    lines.push("", "■ 확신도 상위 경기");
    for (const m of a.top) lines.push(`- ${matchLine(m)}: ${m.pick} (확률 차 ${(m.confidenceGap * 100).toFixed(1)}%p)`);
  }
  if (a.hedges.length) {
    lines.push("", "■ 복식 후보 (확신도 하위)");
    for (const m of a.hedges) lines.push(`- ${matchLine(m)}: 홈 ${pct(m.pHome)} / 무 ${pct(m.pDraw)} / 원정 ${pct(m.pAway)}`);
  }
  if (a.crowdSplits.length) {
    lines.push("", "■ 대중과 다른 선택");
    for (const m of a.crowdSplits) lines.push(`- ${matchLine(m)}: 추천 ${m.pick}`);
  }
  if (a.recent.length) {
    lines.push("", "■ 최근 회차 실제 성적");
    for (const r of a.recent) lines.push(`- ${r.roundNo}회차: ${r.hits}/${r.n} 적중`);
  }
  lines.push("", `직접 조합 짜보기: ${a.appUrl}`, "", DISCLAIMER);
  return lines.join("\n");
}

const PAGE_CSS = `
:root{--bg:#0f1420;--card:#171e2d;--ink:#e8edf6;--muted:#9aa6bb;--line:#26314a;--accent:#f2a93b}
@media (prefers-color-scheme: light){:root{--bg:#f6f7fb;--card:#fff;--ink:#141a26;--muted:#5b6475;--line:#e3e7ef}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 56px}h1{font-size:1.45rem;line-height:1.35;margin:.2em 0 .6em}
h2{font-size:1.1rem;margin:1.8em 0 .6em;padding-top:.4em;border-top:1px solid var(--line)}
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
<a class="cta" href="${e(a.appUrl)}">앱에서 조합 직접 짜보기 →</a>
<div class="card table-wrap">
${renderArticleBodyHtml(a)}
</div>
</main></body></html>`;
}

/** 블로그 초안 페이지(검색 제외). 제목·본문(서식)·본문(텍스트)·태그를 각각 복사할 수 있다. */
export function renderDraftPage(a: RoundArticle): string {
  const e = escapeHtml;
  const body = renderArticleBodyHtml(a);
  const plain = renderArticlePlainText(a);
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
