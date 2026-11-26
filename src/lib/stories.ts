import { FOOTBALL_NEWS, FOOTBALL_NEWS_SNAPSHOTS } from "./footballNews";
import { DRAW_RANK_STORY, DRAW_RANK_SNAPSHOT } from "./drawRankStory";
// 편집 기사와 집계 스냅샷은 고정한다. 라이브 자료의 갱신으로 과거 논증을 바꾸지 않는다.
import { escapeText as e, fullKst, PUBLIC_ORIGIN, renderSitePage } from "./publicSite";

export interface Story {
  slug: string;
  title: string;
  summary: string;
  category: string;
  publishedAt: string;
  dataAsOf: string | null;
  scope: string;
  readingMinutes: number;
  body: string;
  kind?: "match-report" | "reading";
  eventDate?: string;
  featureStat?: { value: string; label: string };
  topic?: string;
  sources?: readonly string[];
}

const AUDIT_URL = "https://github.com/Hyeokgi/hyeoks-sports/actions/runs/43885621331";
const SNAPSHOT_PATH = "/stories/laliga-draw-sample/snapshot.json";
const PUBLISHED = "2026-11-17";

export const LALIGA_SNAPSHOT = {
  schema: 1,
  league: "라리가",
  asOf: "2026-11-16T14:26:05.537Z",
  matches: 1260,
  draws: 329,
  drawRate: 329 / 1260,
  rawComparison: { matches: 1261, draws: 330 },
  excluded: [{ id: 964046, date: "2026-12-09", home: "Rayo Vallecano", away: "Athletic Club", hg: 0, ag: 0, reason: "future_date_at_audit" }],
  period: { from: null, to: null, note: "집계 기간 미확인" },
  rules: [
    "2026-11-16 23:26 KST 읽기 전용 진단의 집계 스냅샷이며 전체 경기 원본 데이터가 아닙니다.",
    "진단 기준 시각보다 미래인 결과 1건을 제외하고 기존 팀명 별칭 정규화 중복 판정을 적용한 비교 표본입니다.",
    "무승부 비율은 무승부 경기 수를 포함 경기 수로 나누며 화면의 백분율은 소수 첫째 자리로 반올림합니다.",
    "원본 DB를 변경하거나 사전 예측을 소급 재작성하지 않은 순수 재계산입니다."
  ],
  limitations: [
    "특정 시즌 전체 또는 라리가 역대 전체 통계가 아닙니다. 집계 기간과 수집 완전성은 확인되지 않았습니다.",
    "미래 결과 행의 직접 유입원, 올바른 날짜와 실제 종료 여부는 미확정입니다.",
    "이 비율은 다음 경기의 무승부 확률이나 다른 리그와의 우열을 증명하지 않습니다.",
    "날짜 필터는 원본 자료의 영구 복구가 아닙니다. 이 스냅샷은 이후 날짜나 라이브 자료에 따라 자동 갱신하지 않습니다."
  ],
  auditUrl: AUDIT_URL
} as const;

export const STORIES: readonly Story[] = [
  ...FOOTBALL_NEWS,
  DRAW_RANK_STORY,
  {
    slug: "laliga-draw-sample",
    title: "무승부 26.1%, 다음 경기의 확률일까?",
    summary: "라리가 저장 표본 1,260경기 중 329경기가 무승부였습니다. 그렇다고 다음 경기도 26.1%일까요? 지난 기록과 다음 경기 확률이 왜 다른지 살펴봐요.",
    category: "자료 관찰",
    publishedAt: PUBLISHED,
    dataAsOf: LALIGA_SNAPSHOT.asOf,
    scope: "HYEOKS 라리가 저장 자료의 진단 비교 표본 · 집계 기간 미확인",
    readingMinutes: 3,
    body: `<section><h2>질문: 네 경기 중 한 경기는 비긴다고 볼 수 있을까?</h2><p>축구에서 무승부는 승리도 패배도 아닌 별도의 결과다. 과거 무승부 비율을 알면 경기 결과의 분포를 이해하는 출발점은 얻는다. 하지만 ‘라리가 저장 표본의 26.1%가 무승부’와 ‘다음 경기의 무승부 확률이 26.1%’는 같은 문장이 아니다. 첫 문장은 지나간 표본의 집계이고, 둘째는 특정 미래 경기에 관한 추정이다.</p></section>
<section><h2>관찰: 329경기를 1,260경기로 나눈 값</h2><p>2026년 11월 16일 23:26 KST 읽기 전용 진단에서, 당시보다 미래인 12월 9일 Rayo Vallecano–Athletic Club 경기가 0:0 결과로 저장돼 있었다. 이 한 건을 제외하고 팀명 별칭 중복을 정리한 라리가 비교 표본은 1,260경기, 무승부는 329경기였다. 329÷1,260×100을 소수 첫째 자리로 반올림하면 26.1%다.</p><p>이는 운영 DB를 수정한 값이 아니라 별도 조건으로 재계산한 값이다. 0:0이라는 점수만으로 종료 경기임을 인정하지 않고, 기준 시각과 결과의 자격을 함께 살폈다.</p></section>
<section><h2>해석: 리그의 평균과 경기의 조건은 다르다</h2><p>저장 표본은 서로 다른 상대와 시점의 경기를 한데 묶는다. 다음 경기의 두 팀이 그 표본과 같은 조건인지 이 집계만으로 알 수 없다. 팀 전력이나 경기 조건을 고려한 확률 추정에는 별도의 모델과 검증이 필요하다. 26.1%는 무승부를 얼마나 관측했는지 설명할 뿐, 특정 대진의 예측값을 대신하지 않는다. 일정한 간격으로 무승부가 돌아온다는 뜻도 아니다.</p></section>
<section><h2>한계: 기간을 모르면 비교도 좁혀야 한다</h2><p>1,260경기는 라리가 역대 전체도, 특정 시즌 전체도 아니다. 집계 기간과 수집 누락 정도는 확인되지 않았다. 따라서 다른 리그보다 무승부가 많다는 비교나 현재 라리가의 성향이라는 결론까지 나아가지 않는다. 의심 행의 직접 유입원·올바른 날짜·실제 종료 여부도 미확정이다. 오늘의 날짜 필터가 원본 오류를 영구히 해결한 것은 아니다.</p></section>
<section id="story-sources"><h2>원자료: 숫자와 조건을 함께 보관하기</h2><p><a href="${SNAPSHOT_PATH}">고정 집계 스냅샷(JSON)</a>에 분자·분모·제외 행·기준 시각과 한계를 담았다. 전체 경기 원본 목록이 아닌 집계 스냅샷이다. 근거는 <a href="${AUDIT_URL}">HYEOKS 읽기 전용 진단 원문</a>이며, 외부 제공자의 공식 리그 통계로 소개하지 않는다. 숫자는 라이브 자료에 따라 자동으로 덮어쓰지 않는다. 독자가 이 비율에서 가져갈 것은 다음 경기의 정답보다, 분모와 범위를 먼저 확인하는 읽기 방식이다.</p></section>`
  },
  {
    slug: "points-and-elo",
    title: "승점 순위보다 Elo 순위가 높으면, 저평가된 팀일까?",
    summary: "리그 순위는 낮은데 전력 순위는 높은 팀이 있어요. 두 표가 무엇을 보고 순서를 매기는지 살펴봐요.",
    category: "표 읽는 방법",
    publishedAt: PUBLISHED,
    dataAsOf: null,
    scope: "HYEOKS 자체 집계 순위표와 Elo 비교 화면의 읽기 원칙 · 최신 팀별 순위 인용 없음",
    readingMinutes: 3,
    body: `<section><h2>질문: 순위 차이는 숨은 실력을 보여줄까?</h2><p>HYEOKS의 ‘순위와 전력’ 화면에는 성적 순위와 Elo 순위가 나란히 놓인다. Elo 순위가 더 높은 팀을 곧바로 저평가됐다고 읽기 쉽다. 그러나 차이가 있다는 관찰과 그 원인을 설명하는 일은 다르다. 두 표가 다른 질문에 답한다는 사실부터 확인해야 한다.</p></section>
<section><h2>관찰: 같은 경기 결과도 집계 방식이 다르다</h2><p>자체 집계 승점 표는 저장된 시즌 경기 결과에 승리 3점·무승부 1점·패배 0점을 준다. 동률일 때 승점, 득실차, 다득점, 영문명 순으로 정렬하므로 공식 대회의 동률 규칙과 다를 수 있다. Elo는 상대 전력과 결과를 반영해 갱신하는 모델 점수다. 시즌 승점을 더한 값이 아니며, Elo 점수 자체도 승리 확률이 아니다.</p></section>
<section><h2>반례: 경기력이 같아도 표시 순서는 달라질 수 있다</h2><p>승점·득실차·다득점까지 같은 경우 HYEOKS 표의 마지막 정렬 기준은 영문명이다. 이 순서에서 앞선다는 사실은 추가로 얻은 승점이나 더 높은 전력을 뜻하지 않는다. 또 비교 대상 팀 집합이 달라지면 Elo 점수 변화 없이도 순번은 달라질 수 있다. 따라서 순위 차이의 모든 한 칸을 전력 차이의 동일한 단위로 취급할 수 없다. 이는 특정 팀에 대한 가상 사례가 아니라 표의 정렬 규칙에서 나오는 한계다.</p></section>
<section><h2>검증 조건: 두 표의 분모부터 맞추기</h2><p>비교 전에 시즌 범위, 저장 결과에 등장한 팀 집합, 경기 수와 Elo 기준 시각을 확인한다. HYEOKS 비교 화면은 같은 비교 집합 안에서 Elo 순위를 다시 매기지만, 그 집합이 리그 전체 참가 팀을 빠짐없이 담았다는 보장은 아니다. 자체 집계 표와 공식 순위표가 다르면 어느 쪽이 틀렸다고 단정하기 전에 누락 경기와 동률 규칙을 살펴야 한다.</p></section>
<section><h2>해석의 한계: 반등은 별도의 주장이다</h2><p>차이를 발견해도 운이 나빴다거나 앞으로 순위가 수렴한다고 결론 내리지 않는다. 그런 주장을 하려면 과거 시점에 고정한 두 순위와 이후 결과를 모아 별도로 검증해야 한다. 현재 표를 과거에도 알고 있었다고 가정하면 검증의 시간 순서가 뒤집힌다. 이 글은 최신 팀별 수치나 미래 성적을 제시하지 않고, 표에서 질문을 만드는 방법만 설명한다.</p></section>
<section id="story-sources"><h2>원자료와 읽는 순서</h2><p><a href="/insights/rank-gap">순위와 전력 비교</a>에서 비교 범위와 경고를 먼저 읽고, <a href="/ratings">Elo 전력 순위</a>와 리그별 자체 집계 표를 확인한다. 계산의 정의는 <a href="/methodology">계산 방법</a>, 수집 범위는 <a href="/sources">출처·데이터 주의사항</a>에서 확인할 수 있다. 연결된 표는 갱신되는 데이터 화면이며 이 글에 고정된 최신 성적 수치는 없다. <a href="https://github.com/Hyeokgi/hyeoks-sports/blob/main/src/lib/leagueTables.ts">자체 집계 구현</a>은 현재 코드이므로 이후 변경될 수 있다.</p></section>`
  },
  {
    slug: "probability-and-accuracy",
    title: "적중률이 같으면, 확률 예측도 같은 실력일까?",
    summary: "둘 다 열 번 중 여섯 번 맞혔다고 해 볼까요? 매번 60%라고 한 예측과 90%라고 한 예측은 같은 걸까요?",
    category: "검증 읽는 방법",
    publishedAt: PUBLISHED,
    dataAsOf: null,
    scope: "사전 저장 예측의 평가 방법 · 실제 성과 수치나 모델 간 우수성 주장 없음",
    readingMinutes: 3,
    body: `<section><h2>질문: 맞힌 결과만 세면 충분할까?</h2><p>축구 예측은 홈승·무승부·원정승에 각각 확률을 붙인다. 적중률은 그중 1순위로 고른 결과가 실제 결과와 같았는지 센다. 간단하고 유용하지만, 선택 뒤에 있는 확률 세 개가 얼마나 타당했는지는 별개의 문제다. HYEOKS의 예측 기록과 확률 성적표를 함께 읽어야 하는 이유다.</p></section>
<section><h2>반례: 1순위를 유지하면 적중률은 확률 변화에 반응하지 않는다</h2><p>동일한 경기 집합에서 1순위 결과를 바꾸지 않고 그 결과에 부여한 확률만 높여도 적중 여부는 그대로다. 결과가 틀렸을 때 얼마나 강하게 확신했는지 적중률만으로는 드러나지 않는다. 이는 가상의 경기 성적을 만든 예가 아니라 적중률의 정의에서 바로 나오는 성질이다. 그러므로 같은 적중률이 같은 확률 품질을 뜻하지 않는다.</p></section>
<section><h2>관찰할 것: 확률 구간과 실제 빈도</h2><p>확률 성적표에서는 비슷한 확률을 제시한 기록을 모아 실제 결과의 빈도와 비교한다. 구간에 포함된 경기 수, 집계 범위, 불확실성 구간을 함께 읽어야 한다. 표본이 적으면 빈도가 크게 흔들릴 수 있고, 구간 전체가 비슷해 보여도 서로 다른 출처의 예측이 섞여 차이를 가릴 수 있다. 클럽 모델, 해외 배당 암시확률, 국가대표 Elo를 구별하는 이유다.</p></section>
<section><h2>검증 조건: 경기 전에 무엇을 알았는가</h2><p>평가에는 킥오프 전 저장된 확률과 확정 결과가 필요하다. 경기가 끝난 뒤 현재 코드로 다시 계산한 값을 당시 예측처럼 쓰면 안 된다. HYEOKS 확률 성적표는 입력 계산 시각도 검사하므로 예측 기록 페이지와 경기 수가 다를 수 있다. 두 화면의 수치가 다르면 먼저 포함·제외 기준을 비교한다. 기록이 없는 경기를 잘 맞힌 것으로 채우거나 실패한 사례만 빼지 않는다.</p></section>
<section><h2>추가 지표와 한계: 한 숫자로 끝내지 않기</h2><p>로그손실은 실제 발생한 결과에 부여한 확률 p에 대해 −ln(p)를 계산해 평균한다. 실제 결과의 확률을 매우 낮게 준 예측은 큰 손실을 받는다. Brier 점수는 세 결과 각각의 예측 확률과 실제 결과 표시값(발생 1, 나머지 0)의 차이를 제곱해 합한 뒤 경기별로 평균하는 방식으로 정의할 수 있다. 두 지표 모두 낮을수록 해당 평가 집합에서의 오차가 작지만, Brier의 정규화 관례가 다르면 값도 달라진다.</p><p>모델 비교에는 같은 경기 집합·시점·확률 출처·계산 규칙이 필요하다. 이 글은 실제 지표 값을 제시하지 않으며 어느 모델이 더 우수하다고 주장하지 않는다. 확률 검증이 좋아 보여도 수익을 보장하는 것은 아니다.</p></section>
<section id="story-sources"><h2>원자료: 기록과 평가 조건을 함께 열기</h2><p><a href="/performance">예측 기록</a>의 포함·제외 기준을 읽은 뒤 <a href="/insights/probability-audit">확률 성적표</a>의 표본 수와 불확실성을 확인한다. <a href="/performance/data.json">공개 예측 기록 JSON</a>은 갱신되는 자료이며 이 글의 고정 성과 스냅샷이 아니다. <a href="/methodology">계산 방법</a>과 <a href="/editorial">편집 원칙</a>에서도 사전 기록과 사후 재계산을 구별한다. 숫자를 인용하는 후속 기사는 그때의 집계 스냅샷을 별도로 보존해야 한다.</p></section>`
  }
];

export const STORY_PATHS: readonly string[] = ["/stories", ...STORIES.map((story) => `/stories/${story.slug}`)];


export const STORY_SNAPSHOTS: Readonly<Record<string, unknown>> = { "laliga-draw-sample": LALIGA_SNAPSHOT, ...FOOTBALL_NEWS_SNAPSHOTS, [DRAW_RANK_STORY.slug]: DRAW_RANK_SNAPSHOT };
/** 날짜만 쓴 발행일·경기일은 한국시간 날짜다. 자료 확인 시점보다 앞서 공개하지 않는다. */
function calendarMs(value: string): number { return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T00:00:00+09:00" : value); }
export function storyIsPublished(story: Story, now = Date.now()): boolean {
  const publication = calendarMs(story.publishedAt);
  const evidence = story.dataAsOf == null ? publication : Date.parse(story.dataAsOf);
  return Number.isFinite(now) && Number.isFinite(publication) && Number.isFinite(evidence) && Math.max(publication, evidence) <= now;
}
export function publishedStoryPaths(now = Date.now()): readonly string[] { return ["/stories", ...STORIES.filter(s=>storyIsPublished(s,now)).map(s=>"/stories/"+s.slug)]; }
export function recentFootballStories(now = Date.now()): readonly Story[] {
  return STORIES.filter(s => s.kind === "match-report" && storyIsPublished(s,now) && Number.isFinite(calendarMs(s.eventDate ?? "")) && calendarMs(s.eventDate!) <= now).sort((a,b) => calendarMs(b.publishedAt)-calendarMs(a.publishedAt));
}
export function hasRecentFootballStories(now = Date.now()): boolean {
  const latest = Math.max(...recentFootballStories(now).map(s=>calendarMs(s.eventDate!)));
  return Number.isFinite(latest) && now - latest <= 7 * 86400e3;
}
export function readingStories(now = Date.now()): readonly Story[] { return STORIES.filter(s => s.kind !== "match-report" && storyIsPublished(s,now)).sort((a,b) => calendarMs(b.publishedAt)-calendarMs(a.publishedAt)); }
function eventLabel(value: string): string { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + " (한국시간)" : fullKst(value); }
export function storyCard(story: Story): string {
  return `<article class="site-panel${story.kind === "match-report" ? " news-card" : ""}"><p class="site-eyebrow">${e(story.topic ?? story.category)}</p>${story.featureStat ? `<p class="news-card-number">${e(story.featureStat.value)}</p>` : ""}<h3><a href="/stories/${e(story.slug)}">${e(story.title)}</a></h3><p>${e(story.summary)}</p><p class="site-note story-meta">발행 ${e(story.publishedAt.slice(0, 10))} · 약 ${story.readingMinutes}분${story.eventDate ? `<br>경기 ${e(eventLabel(story.eventDate))}` : ""}</p></article>`;
}
export function storyCards(entries: readonly Story[] = STORIES): string { return entries.map(storyCard).join(""); }
export function renderStoriesIndex(now = Date.now()): string {
  return renderSitePage({ title: "축구 이야기 · 경기 속 재미있는 숫자", description: "축구 경기에서 발견한 숫자와 흥미로운 장면을 읽습니다. 경기 이야기 뒤에서 통계 읽는 법과 계산 근거도 확인할 수 있습니다.", path: "/stories", event: "stories_view", body: `<header class="site-intro magazine-intro"><p class="site-eyebrow">HYEOKS 축구 이야기</p><h1>축구, 숫자로 한 번 더</h1><p>슛은 스무 번, 골은 몇 개였을까요? 점수만 보면 놓치기 쉬운 이야기를 모았어요.</p></header><section aria-labelledby="recent-football"><h2 id="recent-football">${hasRecentFootballStories(now) ? "최근 경기에서 찾은 이야기" : "경기 이야기 아카이브"}</h2><div class="site-grid story-grid">${storyCards(recentFootballStories(now))}</div></section><section class="site-section magazine-reading"><h2>축구 숫자, 어렵지 않아요</h2><div class="site-grid story-grid">${storyCards(readingStories(now))}</div></section><p class="site-note">경기 날짜와 기사 발행일은 구분합니다. 모든 기사는 출처·계산 근거를 남기며 숫자를 자동으로 덮어쓰지 않습니다. <a href="/editorial">편집·정정 원칙</a> · <a href="/sources">자료 출처</a></p>` });
}
export function renderStory(slug: string, now = Date.now()): string | null {
  const story = STORIES.find(s => s.slug === slug);
  if (!story || !storyIsPublished(story, now)) return null;
  const storyPath = "/stories/" + story.slug;
  const snapshotPath = storyPath + "/snapshot.json";
  const hasSnapshot = Object.prototype.hasOwnProperty.call(STORY_SNAPSHOTS, story.slug);
  const citations = story.sources?.length ? [...story.sources] : story.dataAsOf ? [AUDIT_URL] : [PUBLIC_ORIGIN + "/methodology", PUBLIC_ORIGIN + "/sources"];
  if (hasSnapshot) citations.push(PUBLIC_ORIGIN + snapshotPath);
  const structured = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: story.title, description: story.summary, inLanguage: "ko", url: PUBLIC_ORIGIN + storyPath, mainEntityOfPage: PUBLIC_ORIGIN + storyPath, author: { "@type": "Organization", name: "HYEOKS", url: PUBLIC_ORIGIN + "/about" }, datePublished: story.publishedAt, dateModified: story.publishedAt, citation: citations, ...(hasSnapshot ? { isBasedOn: { "@type": "Dataset", name: story.title + " · 집계 스냅샷", url: PUBLIC_ORIGIN + snapshotPath, dateCreated: story.dataAsOf } } : {}) }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const related = STORIES.filter(s => s.slug !== slug && s.kind === story.kind && storyIsPublished(s,now)).slice(0,2).map(s => `<li><a href="/stories/${e(s.slug)}">${e(s.title)}</a></li>`).join("");
  return renderSitePage({ title: story.title, description: story.summary, path: storyPath, event: "story_view", body: `<article class="site-prose story-article"><header><p><a href="/stories">축구 이야기</a> / ${e(story.topic ?? story.category)}</p><h1>${e(story.title)}</h1><p class="story-lede">${e(story.summary)}</p><p class="news-date">HYEOKS · 발행 <time datetime="${e(story.publishedAt)}">${e(story.publishedAt.slice(0,10))}</time> · 약 ${story.readingMinutes}분${story.eventDate ? `<br>경기: ${e(eventLabel(story.eventDate))}` : ""}</p><details class="story-reading-notes"><summary>어떤 기록을 봤나요?</summary><p>${e(story.scope)}</p><p>${story.dataAsOf ? "자료 확인: " + e(fullKst(story.dataAsOf)) : "최신 성과 수치를 인용하지 않는 방법론·자료 읽기 글입니다."}</p><p>작성: HYEOKS. AI 편집 보조: 초안과 문장 정리에 AI를 활용했습니다. 독립 전문가의 심사나 현장 취재를 뜻하지 않습니다.</p></details></header>${story.body}<section id="story-evidence"><h2>출처와 직접 계산한 근거</h2><p><a href="#story-sources">본문의 원자료 설명</a>${hasSnapshot ? ` · <a href="${snapshotPath}">고정 집계 스냅샷 JSON</a>` : ""}</p><ul>${citations.filter(c=>c!==PUBLIC_ORIGIN+snapshotPath).map(c=>`<li><a href="${e(c)}">${e(new URL(c).hostname)} 원자료</a></li>`).join("")}</ul><p class="site-note">본문과 숫자는 자동 갱신하지 않습니다. 오류가 확인되면 수정일·이유·적용 범위를 남깁니다. 현재 정정 이력은 없습니다. <a href="/editorial">정정 원칙</a> · <a href="/contact">오류 제보</a></p></section>${related ? `<nav aria-label="관련 이야기"><h2>함께 읽을 이야기</h2><ul>${related}</ul></nav>` : ""}<aside class="story-next-steps"><h2>이제 확률도 궁금하다면</h2><p>경기 이야기를 읽은 뒤, 데이터와 확률을 별도 화면에서 살펴볼 수 있습니다. 확률은 경기 결과나 수익을 보장하지 않습니다.</p><div class="magazine-links"><a href="/matches">경기별 확률과 출처</a><a href="/performance">사전 예측의 검증 기록</a><a href="/app">승무패 도구</a></div></aside></article><script type="application/ld+json">${structured}</script>` });
}
