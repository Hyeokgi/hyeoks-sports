// Elo 레이팅 계산 (predict_round42_v2.py compute_elo_and_history 이식, 파이썬과 동일 상수/수식)
export const K_FACTOR = 32;
export const HOME_ADV = 60.0;
export const SEASON_REGRESSION = 0.25;

// 2026-08-17: MLS는 대륙 횡단 원정(예: 밴쿠버-마이애미 약 4,500km) 빈도가 높아 실측 홈승률이
// 45.6%로 K리그1(38.9%)보다 뚜렷이 높음. HOME_ADV 그리드서치(40~300, train/test 4분할) 결과
// 80~90에서 안정적으로 수렴(Brier 최솟값도 경계값이 아닌 내부 90~100 부근)해 85로 채택.
// 다른 리그는 기존 HOME_ADV=60 유지(리스트에 없으면 기본값으로 폴백).
const HOME_ADV_BY_LEAGUE: Record<string, number> = { "MLS": 85.0 };

export function homeAdvForLeague(league: string): number {
  return HOME_ADV_BY_LEAGUE[league] ?? HOME_ADV;
}

export interface MatchRow {
  league: string;
  date: string; // ISO yyyy-mm-dd
  home: string;
  away: string;
  hg: number;
  ag: number;
}

export interface EloState {
  elo: number;
  lastSeason: number;
}

export interface TeamHistoryEntry {
  gf: number;
  ga: number;
  pts: number; // 0/1/3
}

export interface H2HMeeting {
  home: string;
  hg: number;
  ag: number;
}

export interface EloComputation {
  elo: Map<string, EloState>; // key: `${league}|${team}`
  teamHistory: Map<string, TeamHistoryEntry[]>; // key: `${league}|${team}`, chronological
  h2h: Map<string, H2HMeeting[]>; // key: `${league}|${sortedPair}`
}

function key(league: string, team: string): string {
  return `${league}|${team}`;
}

function h2hKey(league: string, a: string, b: string): string {
  const pair = [a, b].sort();
  return `${league}|${pair[0]}|${pair[1]}`;
}

// matches는 league, date 오름차순 정렬되어 있어야 함
export function computeEloAndHistory(matches: MatchRow[]): EloComputation {
  const elo = new Map<string, EloState>();
  const teamHistory = new Map<string, TeamHistoryEntry[]>();
  const h2h = new Map<string, H2HMeeting[]>();

  for (const row of matches) {
    const { league, home, away, hg, ag } = row;
    const season = new Date(row.date).getUTCFullYear();

    for (const t of [home, away]) {
      const k = key(league, t);
      const state = elo.get(k);
      if (!state) {
        elo.set(k, { elo: 1500.0, lastSeason: season });
      } else if (state.lastSeason !== season) {
        elo.set(k, { elo: 1500.0 + (state.elo - 1500.0) * (1 - SEASON_REGRESSION), lastSeason: season });
      }
    }

    const hState = elo.get(key(league, home))!;
    const aState = elo.get(key(league, away))!;
    const he = hState.elo;
    const ae = aState.elo;

    const sH = hg > ag ? 1.0 : hg === ag ? 0.5 : 0.0;
    const eH = 1.0 / (1.0 + 10.0 ** ((ae - (he + homeAdvForLeague(league))) / 400.0));
    hState.elo += K_FACTOR * (sH - eH);
    aState.elo += K_FACTOR * (1.0 - sH - (1.0 - eH));

    const homeKey = key(league, home);
    const awayKey = key(league, away);
    if (!teamHistory.has(homeKey)) teamHistory.set(homeKey, []);
    if (!teamHistory.has(awayKey)) teamHistory.set(awayKey, []);
    teamHistory.get(homeKey)!.push({ gf: hg, ga: ag, pts: hg > ag ? 3 : hg === ag ? 1 : 0 });
    teamHistory.get(awayKey)!.push({ gf: ag, ga: hg, pts: ag > hg ? 3 : hg === ag ? 1 : 0 });

    const hk = h2hKey(league, home, away);
    if (!h2h.has(hk)) h2h.set(hk, []);
    h2h.get(hk)!.push({ home, hg, ag });
  }

  return { elo, teamHistory, h2h };
}

export function recentForm(
  teamHistory: Map<string, TeamHistoryEntry[]>,
  league: string,
  team: string,
  n = 5,
): { avgPts: number; n: number } {
  const hist = (teamHistory.get(key(league, team)) ?? []).slice(-n);
  if (hist.length === 0) return { avgPts: 0, n: 0 };
  const avg = hist.reduce((s, x) => s + x.pts, 0) / hist.length;
  return { avgPts: avg, n: hist.length };
}

export function h2hDiff(
  h2h: Map<string, H2HMeeting[]>,
  league: string,
  home: string,
  away: string,
  n = 5,
): { diff: number; n: number } {
  const meetings = (h2h.get(h2hKey(league, home, away)) ?? []).slice(-n);
  if (meetings.length === 0) return { diff: 0, n: 0 };
  const pts = meetings.map((m) => {
    const winnerPts = m.hg > m.ag ? 2 : m.hg === m.ag ? 1 : 0;
    return m.home === home ? winnerPts : 2 - winnerPts;
  });
  const avg = pts.reduce((s, x) => s + x, 0) / pts.length;
  return { diff: avg - 1.0, n: pts.length };
}

export function leagueDrawRate(matches: MatchRow[], league: string): number {
  const d = matches.filter((m) => m.league === league);
  if (d.length === 0) return 0;
  const draws = d.filter((m) => m.hg === m.ag).length;
  return draws / d.length;
}
