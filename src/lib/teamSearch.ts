// 앱 '경기 분석'의 팀·국가 검색(자동완성). 화면(public/matchesView.ts)과 분리해 테스트한다.
// 자주 쓰는 줄임말·다른 표기. 이름에 그대로 들어 있는 말(토트넘, 울산 등)은 부분 일치로 찾으므로 넣지 않는다.
const ALIASES: Record<string, string[]> = {
  "대한민국": ["한국", "korea", "코리아"],
  "맨체스터 유나이티드": ["맨유"],
  "맨체스터 시티": ["맨시티"],
  "바르셀로나": ["바르사", "바르샤"],
  "인테르": ["인터밀란", "인터 밀란"],
  "튀르키예": ["터키"],
  "아스널": ["아스날"],
  "아틀레티코 마드리드": ["AT마드리드", "아트마"],
  "토트넘 홋스퍼": ["토튼햄"],
  "미국": ["USA"],
};
const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const norm = (s: string) => s.toLowerCase().replace(/[\s.\-·]/g, "");
/** 한글 초성만 뽑는다("대한민국" → "ㄷㅎㅁㄱ"). 초성으로만 입력해도 찾을 수 있게. */
export function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) out += CHO[Math.floor((c - 0xac00) / 588)];
    else if (!/\s/.test(ch)) out += ch.toLowerCase();
  }
  return out;
}
export const isChosungOnly = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);

export interface TeamEntry { name: string; en: string; league: string; logo: string | null; upcoming: number; total: number }
/** 검색에 필요한 경기 카드 필드만 받는다(앱 MatchCard와 같은 이름). */
export interface SearchableMatch {
  league: string;
  kickoffAt: string;
  status: string;
  home: string;
  away: string;
  homeEn?: string;
  awayEn?: string;
  homeLogo: string | null;
  awayLogo: string | null;
}

export function teamIndex(list: SearchableMatch[], now = Date.now()): TeamEntry[] {
  const m = new Map<string, TeamEntry>();
  for (const c of list) {
    for (const side of ["home", "away"] as const) {
      const name = side === "home" ? c.home : c.away;
      const e = m.get(name) ?? { name, en: (side === "home" ? c.homeEn : c.awayEn) ?? "", league: c.league, logo: side === "home" ? c.homeLogo : c.awayLogo, upcoming: 0, total: 0 };
      e.total++;
      if (c.status === "scheduled" && Date.parse(c.kickoffAt) > now - 3 * 3600e3) e.upcoming++;
      m.set(name, e);
    }
  }
  return [...m.values()];
}

/** 검색어에 맞는 팀을 점수순으로. 빈 검색어면 예정 경기가 많은 순(목록에서 골라 쓰기). */
export function searchTeams(entries: TeamEntry[], query: string): TeamEntry[] {
  const q = norm(query);
  if (!q) return [...entries].sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name, "ko"));
  const scored: [TeamEntry, number][] = [];
  for (const e of entries) {
    const n = norm(e.name);
    const en = norm(e.en);
    const al = (ALIASES[e.name] ?? []).map(norm);
    let s = 0;
    if (n === q || al.includes(q)) s = 100;
    else if (n.startsWith(q)) s = 80;
    else if (n.includes(q)) s = 60;
    else if (al.some((a) => a.startsWith(q))) s = 55;
    else if (isChosungOnly(q) && chosung(e.name).replace(/[^ㄱ-ㅎ]/g, "").includes(q)) s = 45;
    else if (en && en.includes(q)) s = en.startsWith(q) ? 40 : 30;
    if (s) scored.push([e, s + Math.min(e.upcoming, 9)]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, "ko")).map((x) => x[0]);
}
