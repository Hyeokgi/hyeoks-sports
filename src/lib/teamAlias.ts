// 같은 팀의 영문 표기를 하나로 모은다(팀 식별자 정규화).
//
// 왜 필요한가: 과거 백필(scripts/backfill_leagues.ts, football-data)은 악센트 없는 표기("Atletico Madrid")로,
// FotMob 동기화는 악센트가 붙은 원문("Atlético Madrid")으로 matches에 저장했다. matches의 UNIQUE(league,date,home,away)는
// 두 표기를 다른 팀으로 보므로 같은 경기가 두 줄로 남고, Elo·폼·상대 전적·순위표가 한 팀을 둘로 나눠 계산한다.
//
// 원칙
// - 악센트를 일괄로 떼지 않는다. "Bayern München", "Borussia Mönchengladbach", "1. FC Köln", "Deportivo A Coruña"는
//   악센트가 붙은 표기가 이미 정식 키(nameMap.ts·teamNames.ts·백필과 같은 표기)다.
// - 아래 표에 적힌 이름만 바꾼다. 바뀐 이름(값)은 반드시 nameMap.ts·teamNames.ts·과거 백필에 있는 키여야 한다
//   (tests/teamAlias.test.ts가 확인한다).
const TEAM_ALIASES = new Map<string, string>([
  ["Atlético Madrid", "Atletico Madrid"],
  ["Atlético de Madrid", "Atletico Madrid"],
  ["Deportivo Alavés", "Deportivo Alaves"],
  ["Alavés", "Deportivo Alaves"],
  ["Málaga", "Malaga"],
  ["CF Montréal", "CF Montreal"],
  ["Cádiz", "Cadiz"],
  ["Leganés", "Leganes"],
]);

/** 별칭 표(읽기 전용 사본). 테스트·정리 작업용. */
export const TEAM_ALIAS_ENTRIES: readonly (readonly [string, string])[] = [...TEAM_ALIASES.entries()];

/** 정식 키가 아닌 별칭 이름들(team_elo 정리에 쓴다). */
export const ALIAS_TEAM_NAMES: readonly string[] = [...TEAM_ALIASES.keys()];

/** 저장·조회에 쓸 정식 팀 키. 표에 없는 이름은 그대로 돌려준다. */
export function canonicalTeamName(name: string): string {
  if (typeof name !== "string") return name;
  // 같은 글자라도 조합형(NFD)으로 들어오면 표와 일치하지 않으므로 완성형으로 맞춰 찾는다.
  return TEAM_ALIASES.get(name) ?? TEAM_ALIASES.get(name.normalize("NFC")) ?? name;
}

/** 정식 키가 아니라 별칭인가. */
export function isAliasTeamName(name: string): boolean {
  return canonicalTeamName(name) !== name;
}

/**
 * 팀명을 정식 키로 바꾸고, 바꾼 뒤 league|date|home|away가 같은 줄(같은 경기의 두 표기)은 처음 것만 남긴다.
 * 점수가 서로 달라도 예외를 던지지 않고 처음 줄을 쓴다. 입력 순서는 그대로 유지한다.
 */
export function dedupeResults<T extends { league: string; date: string; home: string; away: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const home = canonicalTeamName(r.home);
    const away = canonicalTeamName(r.away);
    const k = `${r.league}|${r.date}|${home}|${away}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(home === r.home && away === r.away ? r : { ...r, home, away });
  }
  return out;
}
