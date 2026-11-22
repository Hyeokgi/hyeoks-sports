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

const KOREA_AS_OF = "2026-11-22T08:19:09.438Z";
const ELO_SOURCES = ["https://eloratings.net/South_Korea","https://eloratings.net/Qatar","https://eloratings.net/South_Korea.tsv","https://eloratings.net/Qatar.tsv"] as const;
const koreaComparison = [
  {
    "date": "2026-09-24",
    "opponent": "에콰도르",
    "goals": 3,
    "goalsAgainst": 0,
    "shots": 11,
    "onTarget": 5,
    "bigChances": 2,
    "shotsAgainst": 10,
    "onTargetAgainst": 3,
    "source": "https://www.fotmob.com/matches/ecuador-vs-south-korea/1qoxpg"
  },
  {
    "date": "2026-09-28",
    "opponent": "우루과이",
    "goals": 1,
    "goalsAgainst": 4,
    "shots": 14,
    "onTarget": 7,
    "bigChances": 2,
    "shotsAgainst": 9,
    "onTargetAgainst": 4,
    "source": "https://www.fotmob.com/matches/uruguay-vs-south-korea/1j2hak"
  },
  {
    "date": "2026-10-02",
    "opponent": "베네수엘라",
    "goals": 0,
    "goalsAgainst": 0,
    "shots": 7,
    "onTarget": 3,
    "bigChances": 2,
    "shotsAgainst": 12,
    "onTargetAgainst": 4,
    "source": "https://www.fotmob.com/matches/venezuela-vs-south-korea/1j3n9y"
  },
  {
    "date": "2026-10-06",
    "opponent": "우즈베키스탄",
    "goals": 2,
    "goalsAgainst": 0,
    "shots": 10,
    "onTarget": 6,
    "bigChances": 2,
    "shotsAgainst": 12,
    "onTargetAgainst": 4,
    "source": "https://www.fotmob.com/matches/south-korea-vs-uzbekistan/293eqg"
  },
  {
    "date": "2026-11-13",
    "opponent": "사우디아라비아",
    "goals": 2,
    "goalsAgainst": 3,
    "shots": 15,
    "onTarget": 6,
    "bigChances": 4,
    "shotsAgainst": 8,
    "onTargetAgainst": 5,
    "source": "https://www.fotmob.com/matches/saudi-arabia-vs-south-korea/20g0w4"
  }
] as const;
const comparisonKeys = ["goals", "shots", "onTarget", "bigChances", "shotsAgainst", "onTargetAgainst"] as const;
const comparisonSums = Object.fromEntries(comparisonKeys.map(key => [key, koreaComparison.reduce((sum, row) => sum + row[key], 0)])) as Record<typeof comparisonKeys[number], number>;
const comparisonAverages = Object.fromEntries(comparisonKeys.map(key => [key, comparisonSums[key] / koreaComparison.length])) as typeof comparisonSums;

const korea = {
  schema: 1, asOf: KOREA_AS_OF,
  scope: "카타르전 1경기와 한국 남자 A대표팀 직전 친선전 5경기, 킥오프 전 Elo",
  sources: [FOTMOB, "https://hyeoks.com/performance/data.json", ...koreaComparison.map(row => row.source), ...ELO_SOURCES],
  kickoffAt: "2026-11-17T14:00:00Z", kickoffKst: "2026-11-17T23:00:00+09:00",
  match: { home: "카타르", away: "대한민국", status: "FT", homeGoals: 0, awayGoals: 1 },
  stats: { totalShots: { home: 2, away: 20 }, shotsOnTarget: { home: 0, away: 9 }, possessionPercent: { home: 43, away: 57 }, bigChances: { home: 0, away: 8 }, bigChancesMissed: { home: 0, away: 7 }, firstHalfShots: { home: 0, away: 12 }, secondHalfShots: { home: 2, away: 8 } },
  goals: [{ team: "대한민국", player: "오세훈", minute: "43", assist: "송민규" }],
  comparison: { selection: "카타르전 이전 한국 남자 A대표팀의 직전 친선전 5경기 전부. 월드컵과 다른 공식 대회는 제외", matches: koreaComparison, sums: comparisonSums, averages: comparisonAverages, conversionPercent: comparisonSums.goals / comparisonSums.shots * 100, onTargetPercent: comparisonSums.onTarget / comparisonSums.shots * 100, onTargetConversionPercent: comparisonSums.goals / comparisonSums.onTarget * 100 },
  preMatchElo: { source: "World Football Elo Ratings", sources: ELO_SOURCES, korea: 1717, qatar: 1461, difference: 1717 - 1461, asOfMatches: "2026-11-13", sourceRows: { koreaPrior: "2026\t11\t13\tSA\tKR\t3\t2\tF\tQA\t13\t1652\t1717\t+1\t−7\t54\t41", qatarPrior: "2026\t11\t13\tQA\tAU\t0\t3\tF\t\t-8\t1461\t1794\t−2\t+3\t89\t24", headToHead: "2026\t11\t17\tQA\tKR\t0\t1\tF\t\t-6\t1455\t1723\t−1\t+3\t89\t36" }, method: "각 팀 직전 경기 종료 후 Elo를 사용. 경기장 효과를 더하지 않은 원점수 차이이며 HYEOKS 예측이나 예상 점수가 아님." },
  calculations: {
    observedConversionPercent: { numerator: 1, denominator: 20, formula: "1 / 20 * 100", value: 5 },
    shotsOnTargetPercent: { numerator: 9, denominator: 20, formula: "9 / 20 * 100", value: 45 }
  },
  sourceRoles: { matchStatistics: FOTMOB, comparisonStatistics: "FotMob", preMatchElo: "World Football Elo Ratings", finalScoreCrossCheckOnly: "https://hyeoks.com/performance/data.json" },
  limitations: ["친선전 5경기는 상대·경기 장소·선발이 일치하지 않는 작은 비교 표본이다. 단일 경기로 장기 결정력이나 전술적 원인을 입증하지 않는다.", "xG 및 슈팅별 위치·난도는 이 스냅샷에 포함하지 않는다.", "출처 페이지는 갱신될 수 있지만 이 발췌 스냅샷은 자동 갱신하지 않는다."]
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
    slug: "korea-qatar-20-shots-one-goal", title: "슈팅 20개에 1골. 한국은 카타르전에서 잘했을까?",
    summary: "카타르전 1대0 승리. 직전 친선전 5경기와 경기 전 Elo를 기준으로, 한국이 평소보다 잘한 부분과 아쉬웠던 부분을 나눠 봤습니다.",
    category: "경기 분석", publishedAt: PUBLISHED, dataAsOf: KOREA_AS_OF,
    scope: korea.scope, readingMinutes: 7, kind: "match-report", eventDate: "2026-11-17",
    featureStat: { value: "20:2", label: "한국 vs 카타르 · 슛 횟수" }, topic: "대한민국 · 경기 분석", sources: korea.sources,
    body: `<section><h2>43분에 멈춘 점수판</h2><p>전반 43분, 송민규의 도움을 받은 오세훈이 골을 넣었다. 한국이 넣은 첫 골이자 마지막 골이었다. 11월 17일 카타르를 상대로 거둔 1대0 승리. 그런데 점수판을 닫고 경기 기록을 펼치면 전혀 다른 숫자가 보인다. 슈팅 20대2, 유효슈팅 9대0. 한 골 차였지만, 두 팀이 골문을 위협한 횟수는 한 골 차가 아니었다.</p><details class="story-reading-notes"><summary>퀴즈: 한국은 직전 5경기에서 평균 몇 번 슛을 했을까?</summary><p><strong>11.4개.</strong> 카타르전의 20개는 평균보다 8.6개가 많다. 그런데 골은 오히려 평균보다 적었다.</p></details><p>한국이 못한 걸까, 아니면 이길 팀이 이긴 걸까. 답을 내려면 상대와의 전력 차이, 한국이 만든 기회, 그리고 그 기회를 골로 바꾼 결과를 나눠 봐야 한다.</p></section>
<section><h2>기회는 최근 친선전 중 가장 많이 만들었다</h2><p>비교 대상은 카타르전 직전 한국 남자 A대표팀이 치른 친선전 5경기다. 경기 유형을 맞추기 위해 월드컵은 넣지 않았다. 에콰도르, 우루과이, 베네수엘라, 우즈베키스탄, 사우디아라비아를 만난 경기를 빠짐없이 넣었고, 슈팅 통계는 모두 FotMob 기록을 썼다.</p><figure class="news-stat-figure"><figcaption>한국의 직전 친선전 5경기 평균 → 카타르전</figcaption><div class="news-stat-row"><span>한국 슈팅</span><strong>11.4 → 20</strong></div><div class="news-stat-row"><span>한국 유효슈팅</span><strong>5.4 → 9</strong></div><div class="news-stat-row"><span>한국의 큰 기회*</span><strong>2.4 → 8</strong></div><div class="news-stat-row"><span>한국 득점</span><strong>1.6 → 1</strong></div><div class="news-stat-row"><span>상대 슈팅</span><strong>10.2 → 2</strong></div><div class="news-stat-row"><span>상대 유효슈팅</span><strong>4.0 → 0</strong></div></figure><p>슈팅 20개는 직전 5경기 평균보다 약 75% 많았다. 그 5경기에서 가장 많이 찬 사우디전도 15개였다. 유효슈팅 역시 직전 최다였던 우루과이전의 7개를 넘어섰다. 단지 먼 곳에서 슛을 많이 때린 날로 보기 어려운 이유도 있다. FotMob이 득점 가능성이 높은 상황으로 분류한 ‘큰 기회’가 8번이었다. 직전 5경기 평균은 2.4번, 최다는 4번이었다. 다만 이 수치는 기록 업체가 분류한 횟수이지, 예상 득점(xG)이 아니다.</p></section>
<section><h2>골문에는 평소만큼 보냈다. 골이 덜 들어갔다</h2><p>카타르전에서 슛이 골문을 향한 비율은 45%(20개 중 9개)였다. 직전 5경기를 합한 47.4%(57개 중 27개)와 큰 차이가 없다. 적어도 유효슈팅 비율로 보면, 스무 번이나 찼는데 골문을 제대로 못 맞힌 경기는 아니었다.</p><p>차이는 그다음에 있었다. 직전 5경기에서는 유효슈팅 27개가 8골이 됐다(29.6%). 이번엔 9개가 1골이었다(11.1%). 전체 슛을 기준으로 봐도 14.0%에서 5.0%로 떨어졌다. FotMob 기록에서도 큰 기회 8번 중 7번이 득점으로 이어지지 않았다. 한 골이 적어 보이는 건 단순히 슛을 많이 했기 때문만은 아니다. <strong>골문을 향한 슛도, 득점에 가까웠다고 분류된 기회도 평소보다 많았는데 득점은 오히려 적었다.</strong></p><p>그렇다고 슛 20개면 반드시 두세 골을 넣어야 한다는 뜻은 아니다. 각 슛의 위치와 난도가 같지 않고, 이 자료로는 슛의 질이나 골키퍼의 선방이 각각 얼마나 영향을 줬는지 가를 수 없다. 이 경기의 마무리 결과가 낮았다는 것과 한국의 결정력이 나빠졌다는 것은 다른 주장이다.</p></section>
<section><h2>카타르는 후반에도 골문을 맞히지 못했다</h2><p>전반 슈팅은 12대0이었다. 한국이 앞선 채 들어간 후반에도 8대2였다. 카타르의 두 슛은 모두 후반에 나왔지만 유효슈팅은 하나도 없었다. 직전 5경기에서 한국은 상대에게 평균 10.2개의 슛과 4.0개의 유효슈팅을 내줬다. 이번 경기의 2개와 0개는 그보다 적었다.</p><p>그래서 이 1대0을 한국이 한 골을 넣고 내내 몰린 경기로 읽기는 어렵다. 다만 상대의 슈팅이 적었다는 사실만으로 수비 전술 하나가 성공했다거나, 어떤 상대를 만나도 같은 수비력을 보일 거라고 말할 수는 없다.</p></section>
<section><h2>경기 전 Elo, 한국이 256점 앞섰다</h2><p>World Football Elo Ratings에서 양 팀의 직전 경기인 11월 13일 경기 종료 뒤 점수를 확인했다. 한국은 사우디아라비아전 뒤 1,717점, 카타르는 호주전 뒤 1,461점이었다. 킥오프 전에 비교할 수 있는 원점수 차이는 256점이다. 카타르의 홈 이점을 따로 보정하지 않은 값이다.</p><p>Elo는 지난 경기 결과와 상대의 전력을 반영해 매긴 점수다. 이 기준에선 한국이 더 강한 팀이었고, 한국의 승리는 경기 전 전력 구도와 맞았다. 하지만 256점 차이가 몇 골 차로 이겨야 한다는 뜻은 아니다. 반대로 직전 5경기 평균도 상대의 수준이나 경기 장소를 같게 맞춘 수치가 아니다. Elo는 <strong>왜 한국이 우세한 쪽이었는지</strong> 설명하고, 슈팅과 득점 기록은 <strong>그 우세가 이날 어떻게 나타났는지</strong> 보여준다.</p></section>
<section><h2>결과는 예상과 맞았고, 과정은 평균 이상이었다</h2><p><strong>평소보다 잘한 건 기회를 만들고 상대 슛을 줄인 부분이다. 평소보다 못한 건 만든 기회를 골로 바꾼 결과다.</strong> 1대0은 전력상 앞서던 팀이 이겼다는 사실을 전한다. 20대2와 9대0은 왜 이 경기를 점수보다 크게 앞선 경기로 볼 수 있는지 설명한다. 1골은 그 차이를 점수판에 충분히 남기지는 못했다는 뜻이다.</p><p>다음 경기에서 볼 건 골 수 하나가 아니다. 슈팅과 유효슈팅이 계속 많이 나오는데 골만 적다면 마무리를 더 살펴볼 이유가 생긴다. 반대로 슈팅 자체가 줄면 먼저 기회를 만드는 과정부터 봐야 한다. 카타르전 한 경기로는 추세를 말할 수 없지만, 어디를 더 봐야 할지는 알 수 있다.</p></section>
<section id="story-sources"><h2>비교에 쓴 경기와 계산 근거</h2><p><a href="${FOTMOB}">FotMob 카타르전 기록</a>과 <a href="https://hyeoks.com/performance/data.json">HYEOKS 종료 경기 자료</a>에서 최종 점수를 대조했다. *‘큰 기회’는 FotMob의 Big Chances 항목이다. 아래 점수와 슈팅은 한국 기준이며, 비율은 경기별 비율을 평균 내지 않고 5경기 합계로 계산했다.</p><ul>${koreaComparison.map(row => `<li><a href="${row.source}">${row.date.slice(5)} ${row.opponent}전</a> ${row.goals}대${row.goalsAgainst} · 슛 ${row.shots}개 / 유효 ${row.onTarget}개</li>`).join("")}</ul><p>경기 전 Elo: <a href="${ELO_SOURCES[0]}">한국 경기별 기록</a>·<a href="${ELO_SOURCES[1]}">카타르 경기별 기록</a> (<a href="${ELO_SOURCES[2]}">한국 원자료</a>·<a href="${ELO_SOURCES[3]}">카타르 원자료</a>). <a href="/stories/korea-qatar-20-shots-one-goal/snapshot.json">비교에 사용한 원자료와 계산 내역(JSON)</a>.</p></section>`
  },
  {
    slug: "norway-denmark-comeback-clock", title: "14분에 0대2. 83분에 다시 시작된 경기",
    summary: "덴마크가 먼저 두 골을 넣었어요. 노르웨이가 한 골씩 따라붙을 때마다, 다음 골의 의미가 달라졌어요.",
    category: "최근 경기 · 득점 시계", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: norway.scope, readingMinutes: 4, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "0:2→3:2", label: "노르웨이가 뒤집은 점수" }, topic: "네이션스리그 · 막판 반전", sources: norway.sources,
    body: `<section><h2>14분, 덴마크가 두 골 앞섰어요</h2><p>11분에 라스무스 호일룬, 14분에 피에르에밀 호이비에르가 넣었어요. 노르웨이는 시작한 지 14분 만에 0대2. 37분 홀란이 한 골을 따라붙었지만, 82분까지도 덴마크가 2대1로 앞섰어요.</p></section>
<section><h2>83분, 이제 2대2. 이대로 끝났을까요?</h2><p>외데고르가 동점골을 넣었어요. 노르웨이에겐 이제 한 골이면 역전. 마지막 점수판을 열어 보세요.</p><details class="story-reading-notes"><summary>추가시간에 무슨 일이 있었을까?</summary><p><strong>90+6분, 홀란이 페널티킥을 넣었어요.</strong> 두 골을 먼저 내준 노르웨이가 3대2로 이겼습니다.</p><figure class="news-stat-figure"><figcaption>다섯 골을 시간순으로 · 덴마크 : 노르웨이</figcaption><ol class="news-goal-events"><li><time>11분</time> <span>호일룬</span> <strong>1:0</strong></li><li><time>14분</time> <span>호이비에르</span> <strong>2:0</strong></li><li><time>37분</time> <span>홀란</span> <strong>2:1</strong></li><li><time>83분</time> <span>외데고르</span> <strong>2:2</strong></li><li><time>90+6분</time> <span>홀란</span> <strong>2:3</strong></li></ol></figure></details></section>
<section><h2>같은 3대2라도 이야기는 달라요</h2><p>먼저 앞서고 버틴 3대2도 있죠. 이 경기의 3대2는 노르웨이의 세 골 가운데 두 골이 83분부터 나왔어요. 점수판에 ‘3대2’만 남기면 사라지는 반전이에요. 다만 골이 들어간 시간만으로 어느 팀이 더 잘했는지까지는 알 수 없어요.</p></section>
<section><h2>앞선 시간과 이긴 팀은 달랐어요</h2><p>기록에 적힌 분으로만 세면 덴마크는 첫 골을 넣은 11분부터 동점을 내준 83분까지 약 72분 동안 앞섰어요. 노르웨이는 90+6분 결승골 전까지 한 번도 앞서지 못했고요. 오래 앞선 팀과 마지막에 앞선 팀이 달랐던 거예요. 여기서 72분은 공식 골 시간의 분 표시를 뺀 값이라 초 단위까지 잰 시간은 아니에요.</p><p>중간에서 한 장면만 골라 볼까요? 37분 홀란의 첫 골 직후에는 여전히 덴마크가 이기고 있었어요. 그래도 다음 골 하나의 의미가 바뀌었죠. 0대2에서는 한 골을 넣어도 아직 뒤지지만, 1대2에서는 다음 골이 바로 동점이니까요. 83분의 동점골이 나오자 그다음 한 골은 승부를 뒤집는 골이 됐고요.</p></section><section><h2>이 역전은 마지막 골 하나로 설명되지 않아요</h2><p>기억에 남는 건 90+6분이지만, 앞의 두 골이 없었다면 그 페널티킥은 결승골이 아니었어요. <strong>37분에는 추격, 83분에는 동점, 추가시간에는 역전.</strong> 이 세 장면을 순서대로 봐야 3대2가 왜 특별했는지 드러나요. 다음에 역전 경기의 하이라이트를 본다면, 결승골만큼이나 뒤진 팀이 처음 한 골을 따라붙는 순간을 눈여겨보세요.</p></section>
<section id="story-sources"><h2>어디서 확인했나요?</h2><p><a href="${UEFA_REPORT}">UEFA 공식 경기 기사</a>와 <a href="${UEFA_RESULTS}">팀별 경기 결과</a>를 봤어요. <a href="/stories/norway-denmark-comeback-clock/snapshot.json">골을 넣은 선수와 시간, 계산에 쓴 숫자</a>도 남겼어요.</p></section>`
  },
  {
    slug: "nations-league-eight-matches-23-goals", title: "8경기에서 23골. 두 경기만 봤다면 몇 골?",
    summary: "같은 날 두 경기만 봤는데 한 사람은 네 골, 다른 사람은 열 골을 봤을 수도 있어요. 여덟 경기의 점수판을 펼쳐봤어요.",
    category: "최근 경기 · 골의 분포", publishedAt: PUBLISHED, dataAsOf: AS_OF,
    scope: concentration.scope, readingMinutes: 4, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "43.5%", label: "두 경기에 나온 골의 비율" }, topic: "네이션스리그 · 골 많은 경기", sources: concentration.sources,
    body: `<section><h2>두 경기만 챙겨 볼 수 있다면?</h2><p>네이션스리그 여덟 경기에서 23골이 나왔어요. 나중에 보니 골이 가장 많이 나온 두 경기의 최종 점수가 똑같았어요. 두 경기를 합쳐 6골, 8골, 10골 중 몇 골이었을까요?</p><details class="story-reading-notes"><summary>두 경기 점수 공개</summary><p><strong>10골이에요.</strong> 노르웨이가 덴마크를, 포르투갈이 웨일스를 각각 3대2로 이겼어요. 한 경기에서 다섯 골씩, 둘을 더하면 23골의 절반 가까이예요(약 43.5%).</p></details></section>
<section><h2>나머지 여섯 경기는 어땠을까요?</h2><p>우크라이나와 조지아 경기는 1대0, 헝가리와 북아일랜드 경기는 1대1이었어요. 두 3대2 경기를 빼고 나면 여섯 경기에서 13골, 한 경기당 약 2.2골이에요.</p><figure class="news-stat-figure"><figcaption>23골을 두 묶음으로 나눠 보면</figcaption><div class="news-stat-row"><span>3대2로 끝난 두 경기</span><strong>10골</strong></div><div class="news-stat-row"><span>나머지 여섯 경기</span><strong>13골</strong></div></figure></section>
<section><h2>평균 3골쯤? 실제로 3골이 나온 건 두 경기</h2><p>23골을 8경기로 나누면 경기당 약 2.9골이에요. 그런데 딱 세 골이 나온 경기는 아일랜드의 3대0과 보스니아 헤르체고비나의 2대1뿐이었어요. 평균은 전체를 한 줄로 보여주지만, 실제 점수는 한 골부터 다섯 골까지 달랐어요.</p></section>
<section><h2>첫 화면에 어떤 경기를 틀었느냐에 따라</h2><p>다섯 골씩 나온 두 경기만 봤다면 “골이 쏟아지네”라고 할 만해요. 그런데 1대1로 끝난 경기도 세 편이었어요. 그중 두 편을 골랐다면 본 골은 네 개, 골이 가장 많았던 두 편을 봤다면 열 개예요. 같은 날 같은 대회를 봤는데도 이야기할 거리가 달랐겠죠.</p><p>여덟 경기를 골 수대로 줄 세워 볼까요?</p><p><strong>1 · 2 · 2 · 2 · 3 · 3 · 5 · 5</strong></p><p>8경기 중 6경기는 3골 이하였어요. 평균이 3골에 가까운 건 맨 오른쪽의 5골짜리 두 경기가 숫자를 끌어올렸기 때문이에요. 그렇다고 나머지가 재미없었다는 뜻은 아니에요. 이 글에서 센 건 골 개수이지, 긴장감이나 경기의 재미가 아니니까요.</p></section><section><h2>‘골이 많았다’ 다음엔 ‘어디서?’</h2><p>23골은 맞는 말이지만 그 숫자만으로는 여덟 점수판이 보이지 않아요. <strong>여덟 경기에서 골이 고루 터졌다기보다, 3대2 두 경기가 전체 숫자를 눈에 띄게 끌어올린 날</strong>에 가까웠어요. 다음에 “하루에 몇 골이 터졌다”는 기사를 만나면, 합계 옆에 가장 골이 많았던 경기 두 편만 놓고 보세요. 제목만 읽었을 때와 꽤 다른 그림이 나올 수 있어요.</p></section>
<section id="story-sources"><h2>여덟 경기 점수도 볼 수 있나요?</h2><p>네. <a href="${UEFA_REPORT}">UEFA가 현지 11월 17일 결과로 올린 경기</a>와 <a href="${UEFA_RESULTS}">팀별 경기 결과</a>를 봤어요. 한국시간으로는 11월 18일 새벽 경기예요. <a href="/stories/nations-league-eight-matches-23-goals/snapshot.json">여덟 경기 점수와 계산</a>을 확인해 보세요. 다른 대회나 그날 열린 모든 대표팀 경기를 더한 숫자는 아니에요.</p></section>`
  }
];
