// FotMob __NEXT_DATA__ 스크래핑 (crawl_and_update.py의 pageProps 이중 방어 파싱 이식)
export const LEAGUE_IDS: Record<string, string> = { "K리그1": "9080", "K리그2": "9116", "J1리그": "223", "MLS": "130" };

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
  Referer: "https://www.fotmob.com/",
};

export interface FotmobFinishedMatch {
  id: number | null; // 경기별 상세데이터(코너킥 등) 조회용 - 못 찾으면 null
  date: string; // yyyy-mm-dd
  home: string;
  away: string;
  hg: number;
  ag: number;
}

async function fetchNextData(url: string): Promise<any | null> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const text = await res.text();
  const startTag = '<script id="__NEXT_DATA__" type="application/json">';
  const start = text.indexOf(startTag);
  if (start === -1) return null;
  const end = text.indexOf("</script>", start);
  const jsonStr = text.slice(start + startTag.length, end).trim();
  return JSON.parse(jsonStr);
}

// 2026-07-28에 발견된 구조 변경: fixtures/table이 fallback 캐시가 아니라 pageProps
// 최상위에 직접 내려오는 경우가 있어, 최상위에 실데이터가 있으면 그걸 우선 사용한다.
function extractPageProps(fullJson: any): any | null {
  const pageProps = fullJson?.props?.pageProps;
  if (!pageProps) return null;

  const topFixtures = pageProps.fixtures;
  const topAllMatches = Array.isArray(topFixtures?.allMatches) ? topFixtures.allMatches : [];
  if (topAllMatches.length > 0 || pageProps.table) {
    return pageProps;
  }

  const fallback = pageProps.fallback ?? {};
  for (const value of Object.values<any>(fallback)) {
    if (value && typeof value === "object") {
      const content = value.content;
      if (
        content &&
        typeof content === "object" &&
        ("fixtures" in content || "table" in content || "matches" in content)
      ) {
        return value;
      }
      if ("fixtures" in value || "table" in value || "matches" in value) {
        return value;
      }
    }
  }
  if ("data" in pageProps) return pageProps.data;
  return pageProps;
}

function extractMatchDate(match: any): string | null {
  const status = match?.status;
  if (status?.utcTime) return String(status.utcTime).split("T")[0];
  for (const field of ["date", "time", "timeStr"]) {
    const val = match?.[field];
    if (typeof val === "string") return val.includes("T") ? val.split("T")[0] : val;
  }
  return null;
}

function extractFixtureList(data: any): any[] {
  const cNode = data?.content ?? data;
  const searchNodes = cNode && typeof cNode === "object" ? [cNode, data] : [data];
  for (const node of searchNodes) {
    if (!node || typeof node !== "object") continue;
    const fix = node.fixtures;
    if (fix && typeof fix === "object" && !Array.isArray(fix)) {
      const am = fix.allMatches ?? fix.fixtures ?? [];
      if (Array.isArray(am) && am.length > 0) return am;
    } else if (Array.isArray(fix) && fix.length > 0) {
      return fix;
    }
    const mat = node.matches;
    if (mat && typeof mat === "object" && !Array.isArray(mat)) {
      const am = mat.allMatches ?? mat.matches ?? [];
      if (Array.isArray(am) && am.length > 0) return am;
    } else if (Array.isArray(mat) && mat.length > 0) {
      return mat;
    }
  }
  return [];
}

export async function fetchFinishedMatches(leagueId: string): Promise<FotmobFinishedMatch[]> {
  const url = `https://www.fotmob.com/ko/leagues/${leagueId}/overview/`;
  const fullJson = await fetchNextData(url);
  if (!fullJson) return [];
  const data = extractPageProps(fullJson);
  if (!data) return [];

  const fixtures = extractFixtureList(data);
  const results: FotmobFinishedMatch[] = [];
  for (const match of fixtures) {
    if (!match || typeof match !== "object") continue;
    const home = match.home?.name;
    const away = match.away?.name;
    if (!home || !away) continue;

    const status = match.status ?? {};
    if (!status.finished) continue;
    const scoreStr: string = status.scoreStr ?? "";
    const parts = scoreStr.split("-");
    if (parts.length !== 2) continue;
    const hg = Number(parts[0].trim());
    const ag = Number(parts[1].trim());
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;

    const date = extractMatchDate(match);
    if (!date) continue;

    const id = typeof match.id === "number" ? match.id : Number(match.id) || null;
    results.push({ id, date, home, away, hg, ag });
  }
  return results;
}

// 미종료(예정) 경기 목록 - 라운드 감지 크론에서 사용
export interface FotmobUpcomingMatch {
  date: string;
  home: string;
  away: string;
  utcKickoff: string | null;
}

export async function fetchUpcomingMatches(leagueId: string): Promise<FotmobUpcomingMatch[]> {
  const url = `https://www.fotmob.com/ko/leagues/${leagueId}/overview/`;
  const fullJson = await fetchNextData(url);
  if (!fullJson) return [];
  const data = extractPageProps(fullJson);
  if (!data) return [];

  const fixtures = extractFixtureList(data);
  const results: FotmobUpcomingMatch[] = [];
  for (const match of fixtures) {
    if (!match || typeof match !== "object") continue;
    const home = match.home?.name;
    const away = match.away?.name;
    if (!home || !away) continue;

    const status = match.status ?? {};
    if (status.finished) continue;

    const date = extractMatchDate(match);
    if (!date) continue;

    results.push({ date, home, away, utcKickoff: status.utcTime ?? null });
  }
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

// 팀 시즌 누적 xG(공격/실점) - K리그2는 FotMob이 아예 xG를 안 채워서 빈 Map이 반환된다
// (실측 확인됨: stats.teams 헤더 목록에 "Expected goals"/"xG conceded" 항목 자체가 없음).
export interface TeamXG {
  xgFor: number;
  xgAgainst: number;
  matchesPlayed: number;
}

interface FotmobStatListEntry {
  ParticipantName?: string;
  TeamId?: number;
  StatValue?: number;
  MatchesPlayed?: number;
}

async function fetchStatList(url: string): Promise<FotmobStatListEntry[]> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data: any = await res.json();
  return data?.TopLists?.[0]?.StatList ?? [];
}

export async function fetchTeamXG(leagueId: string): Promise<Map<string, TeamXG>> {
  const url = `https://www.fotmob.com/ko/leagues/${leagueId}/overview/`;
  const fullJson = await fetchNextData(url);
  if (!fullJson) return new Map();
  const data = extractPageProps(fullJson);
  const teamStats: any[] = data?.stats?.teams ?? [];

  const xgForUrl = teamStats.find((g) => g?.header === "Expected goals")?.fetchAllUrl;
  const xgAgainstUrl = teamStats.find((g) => g?.header === "xG conceded")?.fetchAllUrl;
  if (!xgForUrl || !xgAgainstUrl) return new Map();

  const [forList, againstList] = await Promise.all([fetchStatList(xgForUrl), fetchStatList(xgAgainstUrl)]);

  const result = new Map<string, TeamXG>();
  for (const e of forList) {
    if (!e.ParticipantName || e.StatValue == null) continue;
    result.set(e.ParticipantName, { xgFor: e.StatValue, xgAgainst: 0, matchesPlayed: e.MatchesPlayed ?? 0 });
  }
  for (const e of againstList) {
    if (!e.ParticipantName || e.StatValue == null) continue;
    const existing = result.get(e.ParticipantName);
    if (existing) existing.xgAgainst = e.StatValue;
  }
  return result;
}

// 경기별 코너킥 - K리그2 한정 실증 검증된 피처(2026-08-04 백테스트: train/test 4개 분할 전부에서
// 정확도+Brier 개선). 다른 리그는 검증 결과 무효/역효과라 이 함수를 호출하지 않는다.
export async function fetchMatchCorners(matchId: number): Promise<{ home: number; away: number } | null> {
  const fullJson = await fetchNextData(`https://www.fotmob.com/match/${matchId}`);
  if (!fullJson) return null;
  try {
    const top = fullJson.props.pageProps.content.stats.Periods.All.stats[0].stats;
    for (const s of top) {
      if (s.key === "corners" && Array.isArray(s.stats) && s.stats.length === 2) {
        return { home: Number(s.stats[0]), away: Number(s.stats[1]) };
      }
    }
  } catch {
    // 통계 데이터가 없는 경기(구조 변경 등) - 조용히 스킵
  }
  return null;
}
