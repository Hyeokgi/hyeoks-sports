// 기사 논증을 재현하도록 원자료와 산식을 고정한다. stories의 런타임 순환 참조는 만들지 않는다.
import type { Story } from "./stories";

const AS_OF = "2026-11-20T13:30:46.941Z";
const PUBLISHED = "2026-11-20";
const FOTMOB = "https://www.fotmob.com/matches/qatar-vs-south-korea/1jxi0j";
const UEFA_REPORT = "https://www.uefa.com/uefanationsleague/news/02ab-22146db70e40-12d581ab82a9-1000--uefa-nations-league-matchday-6-highlights-belgium-france/";
const UEFA_RESULTS = "https://www.uefa.com/uefanationsleague/news/02a2-1fea18abbcbc-456e846509e7-1000--2026-27-uefa-nations-league-league-phase-results-by-team/";

export type FootballNewsStory = Story & {
  kind: "match-report";
  eventDate: string;
  featureStat: { value: string; label: string };
  topic: string;
  sources: readonly string[];
};

const korea = {
  schema: 1, asOf: AS_OF,
  scope: "2026-11-17 카타르–대한민국 종료 1경기",
  sources: [FOTMOB, "https://hyeoks.com/performance/data.json"],
  kickoffAt: "2026-11-17T14:00:00Z", kickoffKst: "2026-11-17T23:00:00+09:00",
  match: { home: "카타르", away: "대한민국", status: "FT", homeGoals: 0, awayGoals: 1 },
  stats: { totalShots: { home: 2, away: 20 }, shotsOnTarget: { home: 0, away: 9 }, possessionPercent: { home: 43, away: 57 } },
  goals: [{ team: "대한민국", player: "오세훈", minute: "43", assist: "송민규" }],
  calculations: {
    observedConversionPercent: { numerator: 1, denominator: 20, formula: "1 / 20 * 100", value: 5 },
    shotsOnTargetPercent: { numerator: 9, denominator: 20, formula: "9 / 20 * 100", value: 45 }
  },
  sourceRoles: { matchStatistics: FOTMOB, finalScoreCrossCheckOnly: "https://hyeoks.com/performance/data.json" },
  limitations: ["단일 경기 관측값이며 장기 결정력이나 전술적 원인을 입증하지 않는다.", "xG 및 슈팅별 위치·난도는 이 스냅샷에 포함하지 않는다.", "출처 페이지는 갱신될 수 있지만 이 발췌 스냅샷은 자동 갱신하지 않는다."]
} as const;

const norway = {
  schema: 1, asOf: AS_OF,
  scope: "UEFA 현지 2026-11-17 덴마크–노르웨이 종료 1경기 (한국시간 11-18)",
  sources: [UEFA_REPORT, UEFA_RESULTS], sourceReportDate: "2026-11-17",
  kickoffAt: "2026-11-17T19:45:00Z", kickoffKst: "2026-11-18T04:45:00+09:00",
  match: { home: "덴마크", away: "노르웨이", status: "FT", homeGoals: 2, awayGoals: 3 },
  goals: [
    { minute: "11", team: "덴마크", player: "라스무스 호일룬", homeGoals: 1, awayGoals: 0 },
    { minute: "14", team: "덴마크", player: "피에르에밀 호이비에르", homeGoals: 2, awayGoals: 0 },
    { minute: "37", team: "노르웨이", player: "엘링 홀란", homeGoals: 2, awayGoals: 1 },
    { minute: "83", team: "노르웨이", player: "마르틴 외데고르", homeGoals: 2, awayGoals: 2 },
    { minute: "90+6", team: "노르웨이", player: "엘링 홀란", penalty: true, homeGoals: 2, awayGoals: 3 }
  ],
  calculations: {
    norwayLateGoalSharePercent: { numerator: 2, denominator: 3, formula: "2 / 3 * 100", value: 2 / 3 * 100, rounded: 66.7, definition: "이 경기 노르웨이의 3골 중 83분 이후 2골" },
    norwayGoalDifferenceSwing: { from: -2, to: 1, formula: "1 - (-2)", value: 3 }
  },
  limitations: ["득점 순서와 기록된 분 표기만 분석한다. 슈팅·xG·역전 빈도는 포함하지 않는다.", "90+6은 원문 추가시간 표기이며 정확한 초 단위 득점 간격으로 환산하지 않는다."]
} as const;

const eightMatches = [
  { home: "덴마크", away: "노르웨이", homeGoals: 2, awayGoals: 3 },
  { home: "웨일스", away: "포르투갈", homeGoals: 2, awayGoals: 3 },
  { home: "헝가리", away: "북아일랜드", homeGoals: 1, awayGoals: 1 },
  { home: "우크라이나", away: "조지아", homeGoals: 1, awayGoals: 0 },
  { home: "이스라엘", away: "오스트리아", homeGoals: 1, awayGoals: 1 },
  { home: "아일랜드", away: "코소보", homeGoals: 3, awayGoals: 0 },
  { home: "보스니아 헤르체고비나", away: "루마니아", homeGoals: 2, awayGoals: 1 },
  { home: "폴란드", away: "스웨덴", homeGoals: 1, awayGoals: 1 }
] as const;
const concentration = {
  schema: 1, asOf: AS_OF,
  scope: "UEFA 공식 Tuesday results 현지 2026-11-17 편성 8경기만 (한국시간 11-18 새벽)",
  sources: [UEFA_REPORT, UEFA_RESULTS], sourceReportDate: "2026-11-17", eventLocalDate: "2026-11-17",
  kickoffAt: "2026-11-17T19:45:00Z", kickoffKst: "2026-11-18T04:45:00+09:00",
  matches: eightMatches,
  calculations: {
    totalGoals: { terms: [5, 5, 2, 1, 2, 3, 3, 2], formula: "5 + 5 + 2 + 1 + 2 + 3 + 3 + 2", value: 23 },
    topTwoSharePercent: { numerator: 10, denominator: 23, formula: "10 / 23 * 100", value: 10 / 23 * 100, rounded: 43.5 },
    remainingAverage: { numerator: 13, denominator: 6, formula: "(23 - 10) / (8 - 2)", value: 13 / 6, rounded: 2.17 },
    overallAverage: { numerator: 23, denominator: 8, formula: "23 / 8", value: 2.875, rounded: 2.88 }
  },
  limitations: ["대회 전체나 이날의 모든 A매치가 아니라 명시한 공식 결과 8경기의 집계다.", "득점 집중도는 이 묶음의 분포이며 최근 득점 증가 추세를 입증하지 않는다."]
} as const;

export const FOOTBALL_NEWS_SNAPSHOTS: Readonly<Record<string, unknown>> = {
  "korea-qatar-20-shots-one-goal": korea,
  "norway-denmark-comeback-clock": norway,
  "nations-league-eight-matches-23-goals": concentration
};

export const FOOTBALL_NEWS: readonly FootballNewsStory[] = [
  {
    slug: "korea-qatar-20-shots-one-goal", title: "슈팅 20대2, 한국은 몇 골 넣었을까?",
    summary: "스무 번이나 찼다면 세 골쯤 들어갔을까요? 카타르전 점수판을 열기 전에 한번 맞혀 보세요.",
    category: "최근 경기 · 숫자 한 장", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: korea.scope, readingMinutes: 3, kind: "match-report", eventDate: "2026-11-17",
    featureStat: { value: "20:2", label: "한국 vs 카타르 · 슛 횟수" }, topic: "대한민국 · 골 맞히기", sources: korea.sources,
    body: `<section><h2>스무 번 찼어요. 몇 골이었을까요?</h2><p>한국은 20번, 카타르는 2번 슛을 했어요. 슛만 놓고 보면 10배 차이죠. 이 숫자만 보고 점수를 맞힌다면 1대0, 2대0, 3대0 중 어느 쪽일까요?</p><details class="story-reading-notes"><summary>점수판 열기</summary><p><strong>한국이 1대0으로 이겼어요.</strong> 43분에 송민규의 도움을 받은 오세훈이 넣은 한 골이 끝까지 남았습니다.</p></details></section>
<section><h2>20번 중 9번은 골이 될 뻔했거나 실제로 들어갔어요</h2><p>골이 되거나, 막지 않았다면 골이 됐을 슛을 ‘유효슈팅’이라고 해요. 한국의 슛 20개 중 9개가 여기에 들어갔고, 그중 1개가 골이 됐어요. 20개 중 1개니까 5%예요. 다음 슛도 5%라는 뜻은 아니고, 이 경기에서 실제로 들어간 비율이에요.</p><figure class="news-stat-figure"><figcaption>한국 / 카타르, 숫자 세 줄로 다시 보기</figcaption><div class="news-stat-row"><span>전체 슛</span><strong>20 / 2</strong></div><div class="news-stat-row"><span>유효슈팅</span><strong>9 / 0</strong></div><div class="news-stat-row"><span>골</span><strong>1 / 0</strong></div></figure></section>
<section><h2>공을 가진 시간도 열 배였을까요?</h2><p>그건 아니었어요. 공을 얼마나 갖고 있었는지 보여주는 점유율은 한국 57%, 카타르 43%였어요. 공을 더 많이 갖는 것과 슛을 많이 하는 건 같은 얘기가 아니에요. 이 기록만으로 왜 한 골에 그쳤는지까지는 알 수 없어요.</p></section>
<section id="story-sources"><h2>어디서 확인했나요?</h2><p><a href="${FOTMOB}">FotMob 경기 기록</a>에서 슛과 득점자를, <a href="https://hyeoks.com/performance/data.json">HYEOKS 결과 자료</a>에서도 최종 점수를 확인했어요. <a href="/stories/korea-qatar-20-shots-one-goal/snapshot.json">사용한 숫자와 계산</a>도 볼 수 있어요.</p></section>`
  },
  {
    slug: "norway-denmark-comeback-clock", title: "14분에 0대2. 83분에 다시 시작된 경기",
    summary: "덴마크가 먼저 두 골을 넣었어요. 83분에 점수는 2대2. 그 뒤에 한 번 더 점수판이 바뀌었을까요?",
    category: "최근 경기 · 득점 시계", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: norway.scope, readingMinutes: 3, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "0:2→3:2", label: "노르웨이가 뒤집은 점수" }, topic: "네이션스리그 · 막판 반전", sources: norway.sources,
    body: `<section><h2>14분, 덴마크가 두 골 앞섰어요</h2><p>11분에 라스무스 호일룬, 14분에 피에르에밀 호이비에르가 넣었어요. 노르웨이는 시작한 지 14분 만에 0대2. 37분 홀란이 한 골을 따라붙었지만, 82분까지도 덴마크가 2대1로 앞섰어요.</p></section>
<section><h2>83분, 이제 2대2. 이대로 끝났을까요?</h2><p>외데고르가 동점골을 넣었어요. 노르웨이에겐 이제 한 골이면 역전. 마지막 점수판을 열어 보세요.</p><details class="story-reading-notes"><summary>추가시간에 무슨 일이 있었을까?</summary><p><strong>90+6분, 홀란이 페널티킥을 넣었어요.</strong> 두 골을 먼저 내준 노르웨이가 3대2로 이겼습니다.</p><figure class="news-stat-figure"><figcaption>다섯 골을 시간순으로 · 덴마크 : 노르웨이</figcaption><ol class="news-goal-events"><li><time>11분</time> <span>호일룬</span> <strong>1:0</strong></li><li><time>14분</time> <span>호이비에르</span> <strong>2:0</strong></li><li><time>37분</time> <span>홀란</span> <strong>2:1</strong></li><li><time>83분</time> <span>외데고르</span> <strong>2:2</strong></li><li><time>90+6분</time> <span>홀란</span> <strong>2:3</strong></li></ol></figure></details></section>
<section><h2>같은 3대2라도 이야기는 달라요</h2><p>먼저 앞서고 버틴 3대2도 있죠. 이 경기의 3대2는 노르웨이의 세 골 가운데 두 골이 83분부터 나왔어요. 점수판에 ‘3대2’만 남기면 사라지는 반전이에요. 다만 골이 들어간 시간만으로 어느 팀이 더 잘했는지까지는 알 수 없어요.</p></section>
<section id="story-sources"><h2>어디서 확인했나요?</h2><p><a href="${UEFA_REPORT}">UEFA 공식 경기 기사</a>와 <a href="${UEFA_RESULTS}">팀별 경기 결과</a>를 봤어요. <a href="/stories/norway-denmark-comeback-clock/snapshot.json">골을 넣은 선수와 시간, 계산에 쓴 숫자</a>도 남겼어요.</p></section>`
  },
  {
    slug: "nations-league-eight-matches-23-goals", title: "8경기에서 23골. 두 경기만 봤다면 몇 골?",
    summary: "한꺼번에 열린 여덟 경기 가운데 두 편만 골라 볼 수 있다면? 골이 가장 많이 나온 두 경기의 점수를 한번 맞혀 보세요.",
    category: "최근 경기 · 골의 분포", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: concentration.scope, readingMinutes: 3, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "43.5%", label: "두 경기에 나온 골의 비율" }, topic: "네이션스리그 · 골 많은 경기", sources: concentration.sources,
    body: `<section><h2>리모컨이 있고, 두 경기만 볼 수 있다면?</h2><p>네이션스리그 여덟 경기에서 23골이 나왔어요. 나중에 보니 골이 가장 많이 나온 두 경기의 최종 점수가 똑같았어요. 두 경기를 합쳐 6골, 8골, 10골 중 몇 골이었을까요?</p><details class="story-reading-notes"><summary>두 경기 점수 공개</summary><p><strong>10골이에요.</strong> 노르웨이가 덴마크를, 포르투갈이 웨일스를 각각 3대2로 이겼어요. 한 경기에서 다섯 골씩, 둘을 더하면 23골의 절반 가까이예요(약 43.5%).</p></details></section>
<section><h2>나머지 여섯 경기는 어땠을까요?</h2><p>우크라이나와 조지아 경기는 1대0, 헝가리와 북아일랜드 경기는 1대1이었어요. 두 3대2 경기를 빼고 나면 여섯 경기에서 13골, 한 경기당 약 2.2골이에요.</p><figure class="news-stat-figure"><figcaption>23골을 두 묶음으로 나눠 보면</figcaption><div class="news-stat-row"><span>3대2로 끝난 두 경기</span><strong>10골</strong></div><div class="news-stat-row"><span>나머지 여섯 경기</span><strong>13골</strong></div></figure></section>
<section><h2>평균 3골쯤? 실제로 3골이 나온 건 두 경기</h2><p>23골을 8경기로 나누면 경기당 약 2.9골이에요. 그런데 딱 세 골이 나온 경기는 아일랜드의 3대0과 보스니아 헤르체고비나의 2대1뿐이었어요. 평균은 전체를 한 줄로 보여주지만, 실제 점수는 한 골부터 다섯 골까지 달랐어요.</p></section>
<section id="story-sources"><h2>여덟 경기 점수도 볼 수 있나요?</h2><p>네. <a href="${UEFA_REPORT}">UEFA가 현지 11월 17일 결과로 올린 경기</a>와 <a href="${UEFA_RESULTS}">팀별 경기 결과</a>를 봤어요. 한국시간으로는 11월 18일 새벽 경기예요. <a href="/stories/nations-league-eight-matches-23-goals/snapshot.json">여덟 경기 점수와 계산</a>을 확인해 보세요. 다른 대회나 그날 열린 모든 대표팀 경기를 더한 숫자는 아니에요.</p></section>`
  }
];
