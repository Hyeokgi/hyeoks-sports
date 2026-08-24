// 한글 팀명 <-> FotMob 영문 팀명 매핑 (predict_round42_v2.py NAME_MAP 이식)
// 모델(Elo+최근폼+H2H)이 실제로 백테스트된 리그 목록. 이 목록에 없는 대회(UCL/UEL 등)는
// 리그 내 상대평가인 Elo를 쓸 수 없어 배당만으로 예측한다(isModelLeague 참고).
export const MODEL_LEAGUES = [
  "K리그1",
  "K리그2",
  "J1리그",
  "MLS",
  "EPL",
  "세리에A",
  "라리가",
  "분데스리가",
] as const;
export type ModelLeague = (typeof MODEL_LEAGUES)[number];

// 리그명은 wisetoto 원문을 그대로 담는다("UCL", "UEL", ...). 알려진 8개는 자동완성이 되고
// 그 밖의 대회명도 값으로 들어올 수 있게 열어둔다 - 새 대회가 조용히 K리그2로 오분류되는
// 사고(예전 leagueOfKr 기본값)를 막기 위해 타입에서부터 "모르는 리그가 있을 수 있음"을 인정한다.
export type League = ModelLeague | (string & {});

const MODEL_LEAGUE_SET: ReadonlySet<string> = new Set(MODEL_LEAGUES);

/** Elo/폼/H2H 모델이 검증된 리그인가. false면 배당 기반(marketOnly) 경로로 간다. */
export function isModelLeague(league: string): boolean {
  return MODEL_LEAGUE_SET.has(league);
}

export interface TeamMapEntry {
  nameKr: string;
  nameEn: string;
  league: League;
}

// league는 팀별로 명시 태그(과거엔 "K1 화이트리스트, 나머지는 K2"인 이진 추론이었으나
// 팀이 승강격을 거치며 리그별로 다른 Elo 컨텍스트를 갖게 되어 명시적 태깅으로 전환).
export const TEAM_ENTRIES: TeamMapEntry[] = [
  // K리그1
  { nameKr: "강원FC", nameEn: "Gangwon FC", league: "K리그1" },
  { nameKr: "부천FC", nameEn: "Bucheon FC 1995", league: "K리그1" },
  { nameKr: "전북현대", nameEn: "Jeonbuk Hyundai Motors FC", league: "K리그1" },
  { nameKr: "FC서울", nameEn: "FC Seoul", league: "K리그1" },
  { nameKr: "포항스틸", nameEn: "Pohang Steelers", league: "K리그1" },
  { nameKr: "김천상무", nameEn: "Gimcheon Sangmu", league: "K리그1" },
  { nameKr: "울산HDFC", nameEn: "Ulsan HD FC", league: "K리그1" },
  { nameKr: "FC안양", nameEn: "FC Anyang", league: "K리그1" },
  { nameKr: "대전하나", nameEn: "Daejeon Hana Citizen", league: "K리그1" },
  { nameKr: "광주FC", nameEn: "Gwangju FC", league: "K리그1" },
  { nameKr: "제주SKFC", nameEn: "Jeju SK", league: "K리그1" },
  { nameKr: "인천유나", nameEn: "Incheon United", league: "K리그1" },
  // K리그2
  { nameKr: "충남아산", nameEn: "Chungnam Asan FC", league: "K리그2" },
  { nameKr: "성남FC", nameEn: "Seongnam FC", league: "K리그2" },
  { nameKr: "천안시티", nameEn: "Cheonan City", league: "K리그2" },
  { nameKr: "용인FC", nameEn: "Yongin FC", league: "K리그2" },
  { nameKr: "충북청주", nameEn: "Cheongju FC", league: "K리그2" },
  { nameKr: "수원삼성", nameEn: "Suwon Samsung Bluewings", league: "K리그2" },
  { nameKr: "화성FC", nameEn: "Hwaseong FC", league: "K리그2" },
  { nameKr: "대구FC", nameEn: "Daegu FC", league: "K리그2" },
  { nameKr: "부산아이", nameEn: "Busan I'Park", league: "K리그2" },
  { nameKr: "서울이랜", nameEn: "Seoul E-Land FC", league: "K리그2" },
  { nameKr: "김포FC", nameEn: "Gimpo FC", league: "K리그2" },
  { nameKr: "경남FC", nameEn: "Gyeongnam FC", league: "K리그2" },
  { nameKr: "전남드래", nameEn: "Jeonnam Dragons", league: "K리그2" },
  { nameKr: "파주프런", nameEn: "Paju Frontier", league: "K리그2" },
  { nameKr: "수원FC", nameEn: "Suwon FC", league: "K리그2" },
  { nameKr: "안산그리", nameEn: "Ansan Greeners", league: "K리그2" },
  { nameKr: "김해FC", nameEn: "Gimhae FC 2008", league: "K리그2" },
  // J1리그 (2026-08 wisetoto/betman 43회차 실데이터로 교차 확인된 14팀)
  { nameKr: "FC도쿄", nameEn: "FC Tokyo", league: "J1리그" },
  { nameKr: "마치다Z", nameEn: "Machida Zelvia", league: "J1리그" },
  { nameKr: "나고야G", nameEn: "Nagoya Grampus", league: "J1리그" },
  { nameKr: "시미즈S", nameEn: "Shimizu S-Pulse", league: "J1리그" },
  { nameKr: "C오사카", nameEn: "Cerezo Osaka", league: "J1리그" },
  { nameKr: "오카야마", nameEn: "Fagiano Okayama FC", league: "J1리그" },
  { nameKr: "후쿠오카", nameEn: "Avispa Fukuoka", league: "J1리그" },
  { nameKr: "비셀고베", nameEn: "Vissel Kobe", league: "J1리그" },
  { nameKr: "산프히로", nameEn: "Sanfrecce Hiroshima", league: "J1리그" },
  { nameKr: "제프유나", nameEn: "JEF United Chiba", league: "J1리그" },
  { nameKr: "도쿄베르", nameEn: "Tokyo Verdy", league: "J1리그" },
  { nameKr: "가와사키", nameEn: "Kawasaki Frontale", league: "J1리그" },
  { nameKr: "V바렌나", nameEn: "V-Varen Nagasaki", league: "J1리그" },
  { nameKr: "교토상가", nameEn: "Kyoto Sanga FC", league: "J1리그" },
  // J1리그 나머지 6팀 - 이번 세션에 실경기(43회차)로 노출되지 않아 wisetoto/betman 실표기를
  // 직접 교차 확인하지 못한 추정 표기. 실제 회차에 등장 시 이름이 다르면 NAME_MAP 미스매치로
  // 조용히 스킵되니(안전장치), 등장하는 대로 실표기로 정정 필요.
  { nameKr: "감바오사카", nameEn: "Gamba Osaka", league: "J1리그" },
  { nameKr: "가시마", nameEn: "Kashima Antlers", league: "J1리그" },
  { nameKr: "가시와", nameEn: "Kashiwa Reysol", league: "J1리그" },
  { nameKr: "미토", nameEn: "Mito Hollyhock", league: "J1리그" },
  { nameKr: "우라와", nameEn: "Urawa Red Diamonds", league: "J1리그" },
  { nameKr: "요코하마M", nameEn: "Yokohama F.Marinos", league: "J1리그" },
  // MLS (2026-08 wisetoto/betman 45회차 실데이터로 교차 확인된 28팀, FotMob 리그ID 130)
  { nameKr: "FC신시내", nameEn: "FC Cincinnati", league: "MLS" },
  { nameKr: "뉴욕시티", nameEn: "New York City FC", league: "MLS" },
  { nameKr: "콜럼크루", nameEn: "Columbus Crew", league: "MLS" },
  { nameKr: "CF몽레알", nameEn: "CF Montreal", league: "MLS" },
  { nameKr: "DC유나이", nameEn: "DC United", league: "MLS" },
  { nameKr: "뉴잉레벌", nameEn: "New England Revolution", league: "MLS" },
  { nameKr: "뉴욕레드", nameEn: "Red Bull New York", league: "MLS" },
  { nameKr: "내슈빌SC", nameEn: "Nashville SC", league: "MLS" },
  { nameKr: "올랜시티", nameEn: "Orlando City", league: "MLS" },
  { nameKr: "시카파이", nameEn: "Chicago Fire FC", league: "MLS" },
  { nameKr: "토론토FC", nameEn: "Toronto FC", league: "MLS" },
  { nameKr: "샬럿FC", nameEn: "Charlotte FC", league: "MLS" },
  { nameKr: "스포캔자", nameEn: "Sporting Kansas City", league: "MLS" },
  { nameKr: "세인시티", nameEn: "St. Louis City", league: "MLS" },
  { nameKr: "미네유나", nameEn: "Minnesota United", league: "MLS" },
  { nameKr: "애틀유나", nameEn: "Atlanta United", league: "MLS" },
  { nameKr: "콜로래피", nameEn: "Colorado Rapids", league: "MLS" },
  { nameKr: "LAFC", nameEn: "Los Angeles FC", league: "MLS" },
  { nameKr: "레알솔트", nameEn: "Real Salt Lake", league: "MLS" },
  { nameKr: "FC댈러스", nameEn: "FC Dallas", league: "MLS" },
  { nameKr: "시애사운", nameEn: "Seattle Sounders FC", league: "MLS" },
  { nameKr: "오스틴FC", nameEn: "Austin FC", league: "MLS" },
  { nameKr: "LA갤럭시", nameEn: "LA Galaxy", league: "MLS" },
  { nameKr: "새너어스", nameEn: "San Jose Earthquakes", league: "MLS" },
  { nameKr: "포틀팀버", nameEn: "Portland Timbers", league: "MLS" },
  { nameKr: "샌디에FC", nameEn: "San Diego FC", league: "MLS" },
  { nameKr: "밴쿠화이", nameEn: "Vancouver Whitecaps", league: "MLS" },
  { nameKr: "휴스다이", nameEn: "Houston Dynamo FC", league: "MLS" },
  // MLS 나머지 2팀 - 45회차엔 결장(바이/휴식주)이라 wisetoto 실표기 미확인. 실제 노출 시 정정 필요.
  { nameKr: "인터마이", nameEn: "Inter Miami CF", league: "MLS" },
  { nameKr: "필라유니", nameEn: "Philadelphia Union", league: "MLS" },
  // EPL (2026-08-22 wisetoto 46회차 실데이터로 교차 확인된 14팀, FotMob 리그ID 47).
  // nameKr은 wisetoto 실표기. nameEn은 FotMob 현재시즌 실표기와 backfill_leagues.ts의
  // 검증 단계(seed/fotmob_current_names.json)로 교차확인한다 - 불일치 발견 시 여기 정정.
  // 백필 데이터(football-data.co.uk)도 같은 표기로 변환해 저장한다.
  { nameKr: "에버턴", nameEn: "Everton", league: "EPL" },
  { nameKr: "크리스털", nameEn: "Crystal Palace", league: "EPL" },
  { nameKr: "입스위치", nameEn: "Ipswich Town", league: "EPL" },
  { nameKr: "선덜랜드", nameEn: "Sunderland", league: "EPL" },
  { nameKr: "노팅엄F", nameEn: "Nottingham Forest", league: "EPL" },
  { nameKr: "리즈U", nameEn: "Leeds United", league: "EPL" },
  { nameKr: "브렌트퍼", nameEn: "Brentford", league: "EPL" },
  { nameKr: "토트넘", nameEn: "Tottenham Hotspur", league: "EPL" },
  { nameKr: "브라이턴", nameEn: "Brighton & Hove Albion", league: "EPL" },
  { nameKr: "A빌라", nameEn: "Aston Villa", league: "EPL" },
  { nameKr: "맨체스C", nameEn: "Manchester City", league: "EPL" },
  { nameKr: "본머스", nameEn: "AFC Bournemouth", league: "EPL" },
  { nameKr: "뉴캐슬U", nameEn: "Newcastle United", league: "EPL" },
  { nameKr: "리버풀", nameEn: "Liverpool", league: "EPL" },
  // EPL 나머지 6팀(FotMob 2026-27 현재시즌 20팀 실측 기준) - 46회차에 노출되지 않아
  // wisetoto 실표기 미확인(추정). 노출 시 정정 필요.
  { nameKr: "아스널", nameEn: "Arsenal", league: "EPL" },
  { nameKr: "첼시", nameEn: "Chelsea", league: "EPL" },
  { nameKr: "맨체스U", nameEn: "Manchester United", league: "EPL" },
  { nameKr: "풀럼", nameEn: "Fulham", league: "EPL" },
  { nameKr: "코번트리", nameEn: "Coventry City", league: "EPL" },
  { nameKr: "헐시티", nameEn: "Hull City", league: "EPL" },
  // 세리에A (2026-08-22 wisetoto 46회차 실데이터로 교차 확인된 14팀, FotMob 리그ID 55)
  { nameKr: "우디네세", nameEn: "Udinese", league: "세리에A" },
  { nameKr: "코모1907", nameEn: "Como", league: "세리에A" },
  { nameKr: "제노아", nameEn: "Genoa", league: "세리에A" },
  { nameKr: "나폴리", nameEn: "Napoli", league: "세리에A" },
  { nameKr: "파르마", nameEn: "Parma", league: "세리에A" },
  { nameKr: "칼리아리", nameEn: "Cagliari", league: "세리에A" },
  { nameKr: "프로시노", nameEn: "Frosinone", league: "세리에A" },
  { nameKr: "유벤투스", nameEn: "Juventus", league: "세리에A" },
  { nameKr: "베네치아", nameEn: "Venezia", league: "세리에A" },
  { nameKr: "US레체", nameEn: "Lecce", league: "세리에A" },
  { nameKr: "아탈란타", nameEn: "Atalanta", league: "세리에A" },
  { nameKr: "사수올로", nameEn: "Sassuolo", league: "세리에A" },
  { nameKr: "토리노", nameEn: "Torino", league: "세리에A" },
  // FotMob 세리에A는 짧은 표기 사용("Milan"/"Inter"/"Roma") - 2026-08-22 현재시즌 실측 확인
  { nameKr: "AC밀란", nameEn: "Milan", league: "세리에A" },
  // 세리에A 나머지 6팀(FotMob 2026-27 현재시즌 20팀 실측 기준) - 46회차에 노출되지 않아
  // wisetoto 실표기 미확인(추정). 노출 시 정정 필요.
  { nameKr: "인터밀란", nameEn: "Inter", league: "세리에A" },
  { nameKr: "AS로마", nameEn: "Roma", league: "세리에A" },
  { nameKr: "라치오", nameEn: "Lazio", league: "세리에A" },
  { nameKr: "피오렌티", nameEn: "Fiorentina", league: "세리에A" },
  { nameKr: "볼로냐", nameEn: "Bologna", league: "세리에A" },
  { nameKr: "몬차", nameEn: "Monza", league: "세리에A" },
  // 라리가 (2026-08-22 선제 편입). nameKr은 1~41회차 betman/wisetoto 실표기에서 확인된 20팀 -
  // 2025-26 시즌 구성이라 그 시점 소속 기준이다. nameEn은 백필 데이터(FotMob 표기로 통일됨)와
  // 일치해야 Elo 히스토리가 연결된다.
  { nameKr: "레알마드", nameEn: "Real Madrid", league: "라리가" },
  { nameKr: "바르셀로", nameEn: "Barcelona", league: "라리가" },
  { nameKr: "AT마드", nameEn: "Atletico Madrid", league: "라리가" },
  { nameKr: "빌바오", nameEn: "Athletic Club", league: "라리가" },
  { nameKr: "소시에다", nameEn: "Real Sociedad", league: "라리가" },
  { nameKr: "베티스", nameEn: "Real Betis", league: "라리가" },
  { nameKr: "세비야", nameEn: "Sevilla", league: "라리가" },
  { nameKr: "발렌시아", nameEn: "Valencia", league: "라리가" },
  { nameKr: "비야레알", nameEn: "Villarreal", league: "라리가" },
  { nameKr: "RC셀타", nameEn: "Celta Vigo", league: "라리가" },
  { nameKr: "오사수나", nameEn: "Osasuna", league: "라리가" },
  { nameKr: "헤타페", nameEn: "Getafe", league: "라리가" },
  { nameKr: "라요", nameEn: "Rayo Vallecano", league: "라리가" },
  { nameKr: "에스파뇰", nameEn: "Espanyol", league: "라리가" },
  { nameKr: "알라베스", nameEn: "Deportivo Alaves", league: "라리가" },
  { nameKr: "마요르카", nameEn: "Mallorca", league: "라리가" },
  { nameKr: "지로나", nameEn: "Girona", league: "라리가" },
  { nameKr: "레반테", nameEn: "Levante", league: "라리가" },
  { nameKr: "엘체", nameEn: "Elche", league: "라리가" },
  { nameKr: "오비에도", nameEn: "Oviedo", league: "라리가" },
  // 라리가 2026-27 승격팀 - 과거 회차에 안 나와 wisetoto 실표기 미확인(추정). 표기가 다르면
  // NAME_MAP 미스매치로 회차 등록이 보류되며(조용한 오염이 아니라 실패), 그때 정정하면 된다.
  { nameKr: "데포르티", nameEn: "Deportivo A Coruña", league: "라리가" },
  { nameKr: "말라가", nameEn: "Malaga", league: "라리가" },
  { nameKr: "산탄데르", nameEn: "Racing Santander", league: "라리가" },
  // 분데스리가 (2026-08-22 선제 편입, 1~41회차 실표기 확인된 18팀)
  { nameKr: "바이뮌헨", nameEn: "Bayern München", league: "분데스리가" },
  { nameKr: "도르트문", nameEn: "Borussia Dortmund", league: "분데스리가" },
  { nameKr: "레버쿠젠", nameEn: "Bayer Leverkusen", league: "분데스리가" },
  { nameKr: "라이프치", nameEn: "RB Leipzig", league: "분데스리가" },
  { nameKr: "프랑크푸", nameEn: "Eintracht Frankfurt", league: "분데스리가" },
  { nameKr: "슈투트가", nameEn: "VfB Stuttgart", league: "분데스리가" },
  { nameKr: "묀헨글라", nameEn: "Borussia Mönchengladbach", league: "분데스리가" },
  { nameKr: "쾰른", nameEn: "1. FC Köln", league: "분데스리가" },
  { nameKr: "U베를린", nameEn: "Union Berlin", league: "분데스리가" },
  { nameKr: "프라이부", nameEn: "Freiburg", league: "분데스리가" },
  { nameKr: "호펜하임", nameEn: "Hoffenheim", league: "분데스리가" },
  { nameKr: "마인츠05", nameEn: "Mainz 05", league: "분데스리가" },
  { nameKr: "브레멘", nameEn: "Werder Bremen", league: "분데스리가" },
  { nameKr: "아우크스", nameEn: "Augsburg", league: "분데스리가" },
  { nameKr: "함부르크", nameEn: "Hamburger SV", league: "분데스리가" },
  { nameKr: "볼프스부", nameEn: "Wolfsburg", league: "분데스리가" },
  { nameKr: "장크트파", nameEn: "St. Pauli", league: "분데스리가" },
  { nameKr: "하이덴하", nameEn: "Heidenheim", league: "분데스리가" },
  // 분데스리가 2026-27 승격팀 - wisetoto 실표기 미확인(추정). 2.분데스리가 시절 경기는
  // football-data D1(1부)에 없어 Elo 히스토리가 없다 - 첫 시즌엔 1500에서 시작하며
  // 경기가 쌓일 때까지 예측 정확도가 낮다(승격팀 공통, EPL 코번트리/헐시티도 동일).
  { nameKr: "샬케04", nameEn: "Schalke 04", league: "분데스리가" },
  { nameKr: "엘버스베", nameEn: "Elversberg", league: "분데스리가" },
  { nameKr: "파더보른", nameEn: "Paderborn", league: "분데스리가" },
];

export const NAME_MAP: Record<string, string> = Object.fromEntries(
  TEAM_ENTRIES.map((e) => [e.nameKr, e.nameEn]),
);

const LEAGUE_BY_KR: Record<string, League> = Object.fromEntries(
  TEAM_ENTRIES.map((e) => [e.nameKr, e.league]),
);

// NAME_MAP에 없는 팀은 우리가 리그를 모르는 팀이다. 예전엔 무조건 "K리그2"로 떨어뜨렸는데,
// 그러면 UCL/UEL 클럽이 K리그2 팀으로 등록돼 Elo가 조용히 오염된다. 호출자가 아는 리그명
// (wisetoto가 알려준 원문)을 fallback으로 넘기게 해서 그 사고를 막는다.
export function leagueOfKr(nameKr: string, fallback: League = "K리그2"): League {
  return LEAGUE_BY_KR[nameKr] ?? fallback;
}

export function allTeamMapEntries(): TeamMapEntry[] {
  return TEAM_ENTRIES;
}
