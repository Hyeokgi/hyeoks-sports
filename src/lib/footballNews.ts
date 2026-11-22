// 기사 논증을 재현하도록 원자료와 산식을 고정한다. stories의 런타임 순환 참조는 만들지 않는다.
import type { Story } from "./stories";

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

const NATIONS_AS_OF = "2026-11-22T08:48:02.551Z";
const DENMARK_MATCH = "https://www.uefa.com/uefanationsleague/match/2047919--denmark-vs-norway/";
const NORWAY_FOTMOB = "https://www.fotmob.com/matches/denmark-vs-norway/2bbwdn";
const DENMARK_ELO = "https://eloratings.net/Denmark.tsv";
const NORWAY_ELO = "https://eloratings.net/Norway.tsv";
const FIRST_MEETING = "https://www.uefa.com/uefanationsleague/match/2048005--norway-vs-denmark/";
const norwayEvidence = {
  "all": {
    "shots": [
      7,
      21
    ],
    "onTarget": [
      4,
      6
    ],
    "xg": [
      1.62,
      4.2
    ],
    "nonPenaltyXg": [
      1.62,
      3.42
    ]
  },
  "first": {
    "shots": [
      4,
      10
    ],
    "xg": [
      1.51,
      1.89
    ]
  },
  "second": {
    "shots": [
      3,
      11
    ],
    "xg": [
      0.11,
      2.31
    ]
  },
  "preMatchElo": {
    "denmark": 1920,
    "norway": 1909,
    "difference": 11,
    "sourceRows": [
      "2026\t11\t14\tPT\tDK\t1\t4\tENA\t\t-59\t1996\t1920\t0\t+6\t5\t12",
      "2026\t11\t14\tNO\tWA\t3\t1\tENA\t\t8\t1909\t1673\t−2\t0\t15\t48"
    ],
    "venueAdjustment": false
  },
  "previousFive": [
    {
      "round": 1,
      "result": "Norway 3-2 Denmark",
      "url": "https://www.uefa.com/uefanationsleague/match/2048005--norway-vs-denmark/",
      "norwayGoals": 3
    },
    {
      "round": 2,
      "result": "Norway 1-2 Portugal",
      "url": "https://www.uefa.com/uefanationsleague/match/2047978--norway-vs-portugal/",
      "norwayGoals": 1
    },
    {
      "round": 3,
      "result": "Wales 2-1 Norway",
      "url": "https://www.uefa.com/uefanationsleague/match/2047950--wales-vs-norway/",
      "norwayGoals": 1
    },
    {
      "round": 4,
      "result": "Portugal 2-1 Norway",
      "url": "https://www.uefa.com/uefanationsleague/match/2047924--portugal-vs-norway/",
      "norwayGoals": 1
    },
    {
      "round": 5,
      "result": "Norway 3-1 Wales",
      "url": "https://www.uefa.com/uefanationsleague/match/2047893--norway-vs-wales/",
      "norwayGoals": 3
    }
  ],
  "penaltyXg": 0.7884
} as const;

const norway = {
  schema: 1, asOf: NATIONS_AS_OF,
  scope: "덴마크–노르웨이 2026-11-17 경기와 노르웨이의 앞선 A4조 5경기, 경기 전 Elo",
  sources: [UEFA_REPORT, UEFA_RESULTS, DENMARK_MATCH, NORWAY_FOTMOB, FIRST_MEETING, DENMARK_ELO, NORWAY_ELO], evidence: norwayEvidence, sourceReportDate: "2026-11-17",
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
  limitations: ["xG는 FotMob 단일 제공처의 슈팅별 기대득점 모델이다. 실제 득점 수나 승리 확률로 해석하지 않는다.", "90+6은 원문 추가시간 표기이며 정확한 초 단위 득점 간격으로 환산하지 않는다."]
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
const comparisonScores = [
  [1,"A4","2048005","Norway 3-2 Denmark",3,2],
  [1,"A4","2048002","Portugal 1-0 Wales",1,0],
  [1,"B3","2048006","Austria 3-1 Israel",3,1],
  [1,"B3","2048007","Kosovo 1-0 Republic of Ireland",1,0],
  [1,"B2","2048014","Georgia 0-1 Northern Ireland",0,1],
  [1,"B2","2048012","Hungary 0-1 Ukraine",0,1],
  [1,"B4","2048013","Poland 0-0 Bosnia and Herzegovina",0,0],
  [1,"B4","2048015","Sweden 2-1 Romania",2,1],
  [2,"A4","2047977","Denmark 2-0 Wales",2,0],
  [2,"B3","2047979","Austria 3-1 Kosovo",3,1],
  [2,"A4","2047978","Norway 1-2 Portugal",1,2],
  [2,"B3","2047982","Israel 0-3 Republic of Ireland",0,3],
  [2,"B2","2047991","Georgia 0-0 Ukraine",0,0],
  [2,"B2","2047986","Northern Ireland 0-0 Hungary",0,0],
  [2,"B4","2047984","Romania 2-4 Bosnia and Herzegovina",2,4],
  [2,"B4","2047985","Sweden 3-1 Poland",3,1],
  [3,"A4","2047957","Denmark 2-4 Portugal",2,4],
  [3,"A4","2047950","Wales 2-1 Norway",2,1],
  [3,"B3","2047952","Israel 0-0 Kosovo",0,0],
  [3,"B3","2047953","Republic of Ireland 2-2 Austria",2,2],
  [3,"B2","2047962","Hungary 1-0 Georgia",1,0],
  [3,"B2","2047959","Ukraine 0-3 Northern Ireland",0,3],
  [3,"B4","2047964","Bosnia and Herzegovina 1-1 Sweden",1,1],
  [3,"B4","2047963","Poland 6-0 Romania",6,0],
  [4,"B3","2047927","Kosovo 1-1 Austria",1,1],
  [4,"A4","2047924","Portugal 2-1 Norway",2,1],
  [4,"A4","2047930","Wales 0-1 Denmark",0,1],
  [4,"B3","2047929","Republic of Ireland 1-1 Israel",1,1],
  [4,"B2","2047934","Northern Ireland 0-0 Georgia",0,0],
  [4,"B2","2047932","Ukraine 1-2 Hungary",1,2],
  [4,"B4","2047939","Bosnia and Herzegovina 1-0 Poland",1,0],
  [4,"B4","2047933","Romania 0-1 Sweden",0,1],
  [5,"B3","2047896","Kosovo 0-0 Israel",0,0],
  [5,"A4","2047893","Norway 3-1 Wales",3,1],
  [5,"B2","2047895","Georgia 0-2 Hungary",0,2],
  [5,"A4","2047892","Portugal 1-4 Denmark",1,4],
  [5,"B2","2047897","Northern Ireland 1-0 Ukraine",1,0],
  [5,"B3","2047894","Austria 1-0 Republic of Ireland",1,0],
  [5,"B4","2047891","Romania 2-1 Poland",2,1],
  [5,"B4","2047890","Sweden 3-2 Bosnia and Herzegovina",3,2]
] as const;
const comparisonRounds = [1, 2, 3, 4, 5].map(round => {
  const rows = comparisonScores.filter(row => row[0] === round);
  return { round, matches: rows.length, goals: rows.reduce((sum, row) => sum + row[4] + row[5], 0) };
});
const suppliedResultGroups = ["A4","A4","B2","B2","B3","B3","B4","B4"] as const;
const comparisonMatches = comparisonRounds.reduce((n, r) => n + r.matches, 0);
const comparisonGoals = comparisonRounds.reduce((n, r) => n + r.goals, 0);
const groupComparison = ["A4", "B2", "B3", "B4"].map(group => {
  const earlier = comparisonScores.filter(r => r[1] === group);
  const last = eightMatches.filter((_, i) => suppliedResultGroups[i] === group);
  return { group, priorMatches: earlier.length, priorGoals: earlier.reduce((n, r) => n + r[4] + r[5], 0), finalMatches: last.length, finalGoals: last.reduce((n, r) => n + r.homeGoals + r.awayGoals, 0) };
});
const concentration = {
  schema: 1, asOf: NATIONS_AS_OF,
  scope: "UEFA 네이션스리그 A4·B2·B3·B4조 1~6차전 48경기. 6차전 8경기는 현지 2026-11-17",
  sources: [UEFA_REPORT, UEFA_RESULTS], sourceReportDate: "2026-11-17", eventLocalDate: "2026-11-17",
  kickoffAt: "2026-11-17T19:45:00Z", kickoffKst: "2026-11-18T04:45:00+09:00",
  matches: eightMatches, matchGroups: suppliedResultGroups,
  comparison: { selection: "같은 네 조의 1~5차전 전 경기", columns: ["round", "group", "uefaMatchId", "sourceResult", "homeGoals", "awayGoals"], scores: comparisonScores, rounds: comparisonRounds, matches: comparisonMatches, goals: comparisonGoals, average: comparisonGoals / comparisonMatches, byGroup: groupComparison },
  calculations: {
    totalGoals: { terms: [5, 5, 2, 1, 2, 3, 3, 2], formula: "5 + 5 + 2 + 1 + 2 + 3 + 3 + 2", value: 23 },
    topTwoSharePercent: { numerator: 10, denominator: 23, formula: "10 / 23 * 100", value: 10 / 23 * 100, rounded: 43.5 },
    remainingAverage: { numerator: 13, denominator: 6, formula: "(23 - 10) / (8 - 2)", value: 13 / 6, rounded: 2.17 },
    overallAverage: { numerator: 23, denominator: 8, formula: "23 / 8", value: 2.875, rounded: 2.88 }
  },
  limitations: ["UEFA 네이션스리그 전체가 아닌 같은 네 조끼리의 비교다.", "득점 집중도는 이 묶음의 분포이며 최근 득점 증가 추세를 입증하지 않는다."]
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
    slug: "norway-denmark-comeback-clock", title: "덴마크는 72분을 앞섰다. 노르웨이는 어떻게 뒤집었을까?",
    summary: "경기 전 Elo는 11점 차이였지만 후반 슈팅은 11대3. 마지막 페널티킥을 빼고도 노르웨이의 역전이 설명되는지 살폈습니다.",
    category: "경기 분석", publishedAt: PUBLISHED, dataAsOf: NATIONS_AS_OF,
    scope: norway.scope, readingMinutes: 7, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "0:2→3:2", label: "노르웨이가 뒤집은 점수" }, topic: "네이션스리그 · 경기 분석", sources: norway.sources,
    body: `<section><h2>두 골을 먼저 내주고도 슛을 더 많이 했다</h2><p>덴마크는 14분 만에 2대0으로 앞섰다. 11분 라스무스 호일룬의 선제골, 14분 피에르에밀 호이비에르의 헤더가 연달아 나왔다. 그런데 전반이 끝났을 때 슈팅은 노르웨이가 10대4로 앞서 있었다. 점수는 덴마크가 2대1로 앞섰지만, 기회를 더 자주 만든 쪽은 반대였다.</p><p>결말만 보면 추가시간 페널티킥 하나가 승부를 가른 경기다. 하지만 그 킥을 빼도 노르웨이가 더 위협적인 기회를 만들었는지, 그리고 3대2가 경기 전 전력 차를 감안해 얼마나 놀라운 결과였는지 따로 볼 필요가 있다.</p></section>
<section><h2>경기 전 전력은 거의 같았다</h2><p>양 팀이 11월 14일 경기를 마쳤을 때 World Football Elo Ratings 점수는 덴마크 1,920점, 노르웨이 1,909점이었다. 덴마크가 11점 앞섰다. 홈 이점을 따로 반영하지 않은 원점수라 승률로 읽을 수는 없지만, 전력 점수만 놓고 보면 큰 격차가 없었다.</p><p>노르웨이는 앞선 조별리그 5경기에서 9골을 넣었다. 경기당 1.8골이다. 그중 포르투갈과의 두 경기, 웨일스 원정에서는 한 골씩 넣고 모두 1대2로 졌다. 반면 9월 덴마크와의 첫 맞대결은 노르웨이가 이미 3대2로 이긴 경기였다. 이번에도 3골을 넣은 건 평소보다 높은 득점이지만, 이 상대를 꺾은 것 자체가 처음은 아니었다.</p></section>
<section><h2>후반에는 슛의 횟수뿐 아니라 기회의 질도 벌어졌다</h2><p>전반 덴마크는 슛 4개에서 2골을 얻었다. FotMob의 전반 기대득점(xG)은 덴마크 1.51, 노르웨이 1.89였다. xG는 각각의 슛이 골이 될 가능성을 추정해 더한 값이다. 실제 점수와는 다르고, 같은 슛을 다른 데이터 업체가 다르게 평가할 수 있다.</p><figure class="news-stat-figure"><figcaption>덴마크 : 노르웨이 · FotMob 기록</figcaption><div class="news-stat-row"><span>전반 슈팅</span><strong>4 : 10</strong></div><div class="news-stat-row"><span>후반 슈팅</span><strong>3 : 11</strong></div><div class="news-stat-row"><span>후반 기대득점</span><strong>0.11 : 2.31</strong></div><div class="news-stat-row"><span>전체 기대득점</span><strong>1.62 : 4.20</strong></div><div class="news-stat-row"><span>페널티킥 제외 기대득점</span><strong>1.62 : 3.42</strong></div></figure><p>후반에는 덴마크도 세 번 찼지만 세 슛을 합한 xG가 0.11이었다. 노르웨이는 11번 차서 2.31을 쌓았다. 물론 마지막 페널티킥은 큰 기회다. 그래서 경기 전체에서 페널티킥을 빼고 비교해 봤다. 그래도 노르웨이가 3.42대1.62로 앞섰다. 마지막 킥 하나가 기회의 차이를 만들어낸 건 아니었다.</p><p>다만 슈팅과 xG만으로 후반 흐름이 왜 그렇게 바뀌었는지는 알 수 없다. 뒤진 팀이 공격에 더 많은 선수를 투입했는지, 덴마크가 의도적으로 내려앉았는지는 이 숫자만으로 판정하지 않았다.</p></section>
<section><h2>83분까지 동점조차 아니었다</h2><p>37분 홀란이 빈 골문에 공을 밀어 넣어 1대2로 따라붙었지만 덴마크는 83분까지 리드를 지켰다. 공식 기록의 분 표시를 빼면 11분부터 약 72분이다. 외데고르의 동점골이 나오고 나서야 노르웨이는 다음 한 골로 승부를 끝낼 수 있었다.</p><details class="story-reading-notes"><summary>추가시간에 무슨 일이 있었을까?</summary><p><strong>90+6분 홀란의 페널티킥이 들어갔다.</strong> 노르웨이가 이 경기에서 처음 앞선 순간이었고, UEFA는 이 승리로 노르웨이가 A4조 2위와 8강 진출을 확정했다고 기록했다.</p></details><p>두 팀은 최종 승점 9로 같았다. 하지만 노르웨이는 덴마크와의 두 맞대결에서 모두 3대2로 이겼다. 2대2로 끝났다면 덴마크가 10점, 노르웨이가 7점이었다. 마지막 한 골이 단순히 경기 승패뿐 아니라 조별리그 순위까지 바꾼 셈이다.</p></section>
<section><h2>의외였던 건 누가 이겼느냐보다, 언제 앞섰느냐다</h2><p><strong>전력은 비슷했고, 그날의 기회는 노르웨이 쪽이 더 많았다. 극적이었던 건 그 우세가 승부에 반영된 시점이다.</strong> 노르웨이는 페널티킥을 빼도 더 좋은 기회를 만들었지만, 83분에야 동점을 만들고 추가시간까지 기다려야 했다. 덴마크가 오래 앞섰다는 사실과 노르웨이가 더 위협적인 기회를 만들었다는 사실은 서로 모순되지 않는다.</p><p>이 경기를 다시 본다면 결승골보다 먼저 전반 37분에 멈춰 볼 만하다. 그때도 노르웨이는 뒤지고 있었다. 다만 0대2일 때는 한 골을 넣어도 뒤지지만, 1대2가 된 뒤에는 다음 기회 하나가 동점을 만들 수 있었다. 마지막 페널티킥은 그때 시작된 추격의 끝이었다.</p></section>
<section id="story-sources"><h2>경기·전력·비교에 쓴 자료</h2><p><a href="${UEFA_REPORT}">UEFA 6차전 리포트</a>와 <a href="${DENMARK_MATCH}">공식 경기 페이지</a>에서 득점과 진출을, <a href="${FIRST_MEETING}">첫 맞대결</a>과 <a href="${UEFA_RESULTS}">UEFA 팀별 결과</a>에서 앞선 다섯 경기를 확인했다. 슈팅과 xG는 <a href="${NORWAY_FOTMOB}">FotMob 경기 기록</a>을 사용했다. Elo는 <a href="${DENMARK_ELO}">덴마크 원자료</a>와 <a href="${NORWAY_ELO}">노르웨이 원자료</a>의 11월 14일 경기 종료 뒤 값을 썼다. <a href="/stories/norway-denmark-comeback-clock/snapshot.json">경기별 숫자와 원자료(JSON)</a>.</p></section>`
  },
  {
    slug: "nations-league-eight-matches-23-goals", title: "8경기 23골, 정말 골이 많이 터진 날이었을까?",
    summary: "같은 네 조의 앞선 40경기와 비교했더니 23골은 평균보다 많았습니다. 다만 차이를 만든 건 거의 전부 A4조 두 경기였습니다.",
    category: "경기 분석", publishedAt: PUBLISHED, dataAsOf: NATIONS_AS_OF,
    scope: concentration.scope, readingMinutes: 7, kind: "match-report", eventDate: "2026-11-18",
    featureStat: { value: "43.5%", label: "두 경기에 나온 골의 비율" }, topic: "네이션스리그 · 득점 분석", sources: concentration.sources,
    body: `<section><h2>23골 중 10골이 두 경기에서 나왔다</h2><p>한국시간 11월 18일 새벽에 열린 UEFA 네이션스리그 여덟 경기에서 모두 23골이 나왔다. 그중 10골이 같은 조의 두 경기에 몰렸다. 어느 경기였을까? 나머지 여섯 경기의 합은 13골이었다.</p><details class="story-reading-notes"><summary>두 경기 점수 공개</summary><p><strong>덴마크 2대3 노르웨이, 웨일스 2대3 포르투갈.</strong> 두 경기만으로 전체 골의 43.5%가 나왔다.</p></details><p>그날은 정말 골이 많이 나온 날이었을까? 합계만으로는 답하기 어렵다. 같은 팀들이 치른 앞선 경기에서는 평소 몇 골이 나왔는지, 23골 가운데 어떤 조가 숫자를 끌어올렸는지부터 봤다.</p></section>
<section><h2>평소보다 많았다. 하지만 가장 많았던 날은 아니다</h2><p>비교 기준은 이날 경기를 치른 A4·B2·B3·B4조다. 네 조는 매 라운드 두 경기씩, 모두 여덟 경기를 치렀다. 다른 조를 섞지 않고 1~5차전 40경기를 세니 총 97골이었다. 경기당 2.43골, 여덟 경기로 환산하면 19.4골이다.</p><figure class="news-stat-figure"><figcaption>같은 네 조의 라운드별 득점 · 매 라운드 8경기</figcaption><div class="news-stat-row"><span>1차전</span><strong>16골</strong></div><div class="news-stat-row"><span>2차전</span><strong>22골</strong></div><div class="news-stat-row"><span>3차전</span><strong>25골</strong></div><div class="news-stat-row"><span>4차전</span><strong>13골</strong></div><div class="news-stat-row"><span>5차전</span><strong>21골</strong></div><div class="news-stat-row"><span>6차전 · 현지 11월 17일</span><strong>23골</strong></div></figure><p>23골은 앞선 평균보다 3.6골 많았고, 직전 5차전보다 2골 많았다. 그래도 25골이 나온 3차전에는 못 미쳤다. 같은 네 조의 여섯 라운드 중 두 번째였으니, ‘평소보다 많았다’는 말은 맞지만 ‘유례없이 많았다’고 할 숫자는 아니다.</p></section>
<section><h2>A4조는 경기당 5골, 나머지 여섯 경기는 2.17골</h2><p>두 3대2 경기가 모두 A4조였다. 이 조의 앞선 10경기에서는 33골, 경기당 3.30골이 나왔다. 최종전 두 경기는 경기당 5.00골이었다. 반면 B2·B3·B4조는 앞선 30경기에서 64골(2.13골), 최종전 여섯 경기에서 13골(2.17골)이었다. B리그 세 조의 득점은 사실상 앞선 평균과 비슷했다.</p><p>라운드당 증가분 3.6골을 나눠 보면 더 분명하다. A4조는 이전 두 경기 평균 6.6골에서 10골로 3.4골 늘었다. B리그 세 조는 여섯 경기 평균 12.8골에서 13골로 0.2골 늘었다. <strong>이날 평균을 끌어올린 건 여덟 경기 전체가 아니라 거의 전부 A4조 두 경기였다.</strong></p></section>
<section><h2>같은 날을 봐도 기억에 남는 골 수가 다르다</h2><p>여덟 경기의 골 수를 낮은 순서로 놓으면 1·2·2·2·3·3·5·5다. 경기당 평균은 2.88골이지만 가운데 두 값의 평균인 중앙값은 2.5골이다. 세 골 이하로 끝난 경기가 여섯 경기였다. 중계를 두 편만 챙겼다면, 1대1 두 경기를 본 사람은 4골을, A4조 두 경기를 본 사람은 10골을 봤다.</p><p>같은 네 조를 비교해도 상대 조합과 홈·원정, 조별리그 상황은 라운드마다 다르다. 따라서 이 숫자로 ‘최종전이라 수비가 느슨해졌다’고 결론 내릴 수 없다. 슈팅과 경기별 전술이 아니라 최종 점수만 비교한 기사다.</p></section>
<section><h2>다득점 라운드였지만, 다득점 경기가 고루 나온 건 아니다</h2><p><strong>23골은 비교 기준보다 높았다. 그 차이를 만든 곳을 좁혀보니 A4조 두 경기였다.</strong> 합계만 보면 여덟 경기 전체에서 골이 쏟아진 것처럼 들리지만, 여섯 경기만 놓고 보면 이전과 거의 같았다. 다음에 하루 골 합계를 볼 때도 먼저 경기 수를 나누고, 골이 가장 많이 나온 경기들이 평균을 얼마나 움직였는지 함께 보면 보도 제목 뒤의 점수판이 보인다.</p></section>
<section id="story-sources"><h2>비교에 쓴 48경기</h2><p><a href="${UEFA_REPORT}">UEFA 현지 11월 17일 리포트</a>와 <a href="${UEFA_RESULTS}">UEFA 공식 라운드별 결과</a>를 대조했다. 비교는 같은 네 조의 1~6차전에 한정했다. <a href="/stories/nations-league-eight-matches-23-goals/snapshot.json">경기별 점수와 조별·라운드별 계산(JSON)</a>에서 표본을 확인할 수 있다.</p></section>`
  }
];
