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
    slug: "korea-qatar-20-shots-one-goal", title: "슈팅 20대2, 스코어 1대0: 한국전의 두 얼굴",
    summary: "한국은 카타르전에서 20번 슈팅하고 한 골을 넣었습니다. 슈팅의 격차와 스코어의 격차가 달랐던 경기를 두 개의 비율로 읽습니다.",
    category: "최근 경기 · 숫자 한 장", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: korea.scope, readingMinutes: 3, kind: "match-report", eventDate: "2026-11-17",
    featureStat: { value: "20:2", label: "한국·카타르 총슈팅" }, topic: "대한민국 · 슈팅", sources: korea.sources,
    body: `<section><h2>스무 번 두드린 경기, 승부는 한 골</h2><p>한국은 11월 17일 카타르를 1대0으로 이겼다. 한국시간 밤 11시에 시작한 경기에서 43분 오세훈이 송민규의 도움을 받아 넣은 골이 최종 점수가 됐다. 결과만 보면 한 골 차 승부지만, 슈팅 기록을 펼치면 다른 풍경이 나온다. 한국은 20회, 카타르는 2회였다. 같은 경기를 설명하는 숫자인데 간격은 사뭇 다르다.</p></section>
<section><h2>열 배의 슈팅이 열 골 차는 아닌 이유</h2><p>한국의 관측 득점 전환 비율은 1골÷20슛×100=5%다. 유효슈팅 비율은 9회÷20회×100=45%다. 앞의 분자는 골, 뒤의 분자는 유효슈팅이다. 같은 20번을 나누더라도 무엇을 세느냐에 따라 읽는 장면이 달라진다. 5%는 이날 실제로 들어간 비율이지, 슈팅 한 번의 성공 가능성을 미리 계산한 값이 아니다.</p>
<figure class="news-stat-figure"><figcaption>총슈팅과 유효슈팅 비교 · 한국 / 카타르</figcaption><div class="news-stat-row"><span>총슈팅</span><strong>20 / 2</strong></div><div class="news-stat-row"><span>유효슈팅</span><strong>9 / 0</strong></div><div class="news-stat-row"><span>득점</span><strong>1 / 0</strong></div></figure>
<p>스코어는 골문을 통과한 공만 남긴다. 슈팅 수는 그보다 앞선 시도까지 보여준다. 그래서 1대0과 20대2는 모순이 아니라 서로 다른 장면의 요약이다. 유효슈팅도 한국 9회, 카타르 0회로 벌어졌다. 점유율은 한국 57%, 카타르 43%였다. 공을 가진 시간의 차이보다 슈팅 수의 차이가 눈에 띄는 경기였다.</p></section>
<section><h2>이날의 기록에서 멈춰 읽기</h2><p>다만 이 숫자만으로 한국의 장기 결정력이 나쁘다거나 특정 선수에게 책임이 있다고 말할 수는 없다. 슈팅 위치와 수비 압박, 시도별 난도가 빠져 있기 때문이다. 여기서는 xG나 전술적 원인을 덧붙이지 않는다. 이날의 재미는 큰 시도 격차가 작은 점수 차와 함께 남았다는 데 있다.</p></section>
<section id="story-sources"><h2>직접 다시 셀 수 있는 기록</h2><p><a href="${FOTMOB}">FotMob 경기 기록</a>에서 종료 점수·득점자·경기 통계를 인용했고, 최종 점수는 <a href="https://hyeoks.com/performance/data.json">HYEOKS 결과 자료</a>와도 대조했다. 통계 원자료와 분자·분모는 <a href="/stories/korea-qatar-20-shots-one-goal/snapshot.json">고정 JSON 스냅샷</a>에 남겼다. 경기일은 11월 17일, 이 글의 발행일은 11월 20일로 서로 다르다.</p></section>`
  },
  {
    slug: "norway-denmark-comeback-clock", title: "14분 만에 0대2, 끝내 3대2: 노르웨이의 득점 시계",
    summary: "37분 추격, 83분 동점, 90+6분 역전. 덴마크전 다섯 골을 시간순으로 놓으면 최종 점수에 가려진 흐름이 보입니다.",
    category: "최근 경기 · 득점 시계", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: norway.scope, readingMinutes: 3, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "0:2→3:2", label: "노르웨이 기준 점수 변화" }, topic: "네이션스리그 · 역전", sources: norway.sources,
    body: `<section><h2>첫 두 골과 마지막 세 골의 주인이 달랐다</h2><p>덴마크는 11분 라스무스 호일룬, 14분 피에르에밀 호이비에르의 골로 2대0을 만들었다. 그러나 최종 승자는 노르웨이였다. 엘링 홀란이 37분 추격하고 마르틴 외데고르가 83분 동점을 만든 뒤, 홀란이 90+6분 페널티킥으로 3대2 역전을 완성했다. 한국시간 11월 18일 새벽 4시 45분 시작한 경기다. UEFA 기사에 적힌 현지 11월 17일과 날짜가 다른 이유는 시차다.</p></section>
<section><h2>득점 세 개 중 두 개는 83분부터</h2><p>노르웨이의 득점만 모으면 37분, 83분, 90+6분이다. 이 중 83분 이후의 두 골을 전체 세 골로 나누면 2÷3×100=66.7%다. 경기 막판에 기록된 득점이 이날 노르웨이 득점의 3분의 2를 차지했다는 뜻이다. 분모는 대회 경기 수도, 공격 횟수도 아닌 이 경기 노르웨이의 세 골이다.</p>
<figure class="news-stat-figure"><figcaption>다섯 번 바뀐 점수판 · 모든 점수는 덴마크:노르웨이 순서</figcaption><ol class="news-goal-events"><li><time>11분</time> <span>호일룬</span> <strong>1:0</strong></li><li><time>14분</time> <span>호이비에르</span> <strong>2:0</strong></li><li><time>37분</time> <span>홀란</span> <strong>2:1</strong></li><li><time>83분</time> <span>외데고르</span> <strong>2:2</strong></li><li><time>90+6분</time> <span>홀란(PK)</span> <strong>2:3</strong></li></ol></figure>
<p>노르웨이 기준 골 차는 −2에서 +1로 움직였다. 계산하면 1−(−2)=3골의 변화다. 처음부터 앞선 팀이 한 골을 더 넣은 3대2와, 두 골을 먼저 내주고 만든 3대2는 같은 최종 숫자라도 읽는 맛이 다르다. 시간순 기록은 점수판 한 줄이 지워버린 과정, 추격과 동점과 역전의 순서를 돌려준다.</p></section>
<section><h2>시계가 알려주지 않는 것도 있다</h2><p>이 득점표는 노르웨이가 내내 경기를 지배했다는 증거는 아니다. 공격 횟수나 슈팅의 질까지 확인한 분석이 아니므로 xG와 슈팅 수를 보태지 않는다. 90+6분도 원문의 추가시간 표기를 그대로 남겼으며 정확한 초 단위 간격으로 환산하지 않았다. 한 번의 극적인 결과로 두 점 차 역전의 확률이나 흔한 정도를 말하지 않는 것도 같은 이유다.</p></section>
<section id="story-sources"><h2>득점 순서와 날짜의 출처</h2><p><a href="${UEFA_REPORT}">UEFA 매치데이 6 공식 기사</a>와 <a href="${UEFA_RESULTS}">팀별 공식 결과</a>를 근거로 편집했다. 기사 발행은 11월 20일이며 경기 당일 보도가 아니다. 득점자·분 표기·누적 점수와 계산은 <a href="/stories/norway-denmark-comeback-clock/snapshot.json">고정 JSON 스냅샷</a>에서 확인할 수 있다.</p></section>`
  },
  {
    slug: "nations-league-eight-matches-23-goals", title: "하루 23골, 10골이 두 경기에 몰렸다",
    summary: "UEFA가 현지 11월 17일 묶음으로 발표한 8경기에서 23골이 나왔습니다. 두 번의 3대2가 전체 득점의 43.5%를 차지했습니다.",
    category: "최근 경기 · 골의 분포", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: concentration.scope, readingMinutes: 3, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "43.5%", label: "두 경기의 골 / 8경기 전체 골" }, topic: "네이션스리그 · 득점 분포", sources: concentration.sources,
    body: `<section><h2>두 번의 3대2가 만든 큰 몫</h2><p>노르웨이는 덴마크를, 포르투갈은 웨일스를 각각 3대2로 이겼다. 두 경기에서만 열 골이다. UEFA가 현지 11월 17일 Tuesday results로 묶은 네이션스리그 8경기를 모두 더하면 23골이 나온다. 한국시간으로는 11월 18일 새벽 4시 45분 시작한 경기들이다. 여기서 ‘하루’는 그 공식 편성 묶음만 뜻하며, 전 세계 A매치 전체를 센 것이 아니다.</p></section>
<section><h2>경기는 4분의 1, 골은 절반 가까이</h2><p>여덟 경기의 골 수를 차례로 적으면 5, 5, 2, 1, 2, 3, 3, 2다. 합계는 23이다. 다섯 골씩 나온 두 경기의 비중은 10골÷23골×100=43.5%로 계산된다. 경기 수로는 2÷8=25%인 묶음이 득점의 절반 가까이를 담은 셈이다. ‘골이 많았다’에서 한 걸음 더 나아가, 그 골들이 어디에 모였는지를 보는 방법이다.</p>
<figure class="news-stat-figure"><figcaption>공식 8경기의 23골을 두 묶음으로 나누기</figcaption><div class="news-stat-row"><span>덴마크–노르웨이·웨일스–포르투갈</span><strong>2경기 · 10골 · 43.5%</strong></div><div class="news-stat-row"><span>나머지 경기</span><strong>6경기 · 13골 · 56.5%</strong></div></figure>
<p>전체 평균은 23÷8=2.875골, 소수 둘째 자리로 반올림하면 2.88골이다. 두 경기를 빼면 나머지는 (23−10)÷(8−2)=13÷6, 약 2.17골이다. 어느 평균이 더 진짜인 것은 아니다. 포함한 경기 묶음이 다르기 때문이다. 2.88이라는 요약만 읽을 때보다 두 묶음을 나눠 보면 이날 점수판의 차이가 선명해진다.</p></section>
<section><h2>평균 아래에도 여러 점수판이 있다</h2><p>우크라이나는 조지아에 1대0, 아일랜드는 코소보에 3대0, 보스니아 헤르체고비나는 루마니아에 2대1로 이겼다. 헝가리–북아일랜드, 이스라엘–오스트리아, 폴란드–스웨덴은 모두 1대1이었다. 득점 없는 경기는 없었지만 모든 경기가 다득점 접전이었던 것도 아니다. 이 여덟 경기만으로 최근 대회 득점이 폭증했다는 장기 추세를 말할 수는 없다.</p></section>
<section id="story-sources"><h2>여덟 점수에서 다시 시작하기</h2><p><a href="${UEFA_REPORT}">UEFA 공식 기사의 Tuesday results</a>와 <a href="${UEFA_RESULTS}">팀별 공식 결과</a>가 출처다. <a href="/stories/nations-league-eight-matches-23-goals/snapshot.json">고정 JSON 스냅샷</a>에 여덟 대진과 점수, 합산 항목, 분자·분모를 공개했다. 11월 20일에 발행한 과거 경기 분석이며 새로운 결과가 나와도 이 23골의 범위는 바뀌지 않는다.</p></section>`
  }
];
