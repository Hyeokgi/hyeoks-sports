// 경기 페이지·리그 페이지에 보여줄 한글 팀명(전체 이름).
//
// nameMap.ts의 한글명은 wisetoto 표기라 4글자로 잘려 있다("콜럼크루", "인터마이"). 회차 화면은
// 토토 표기를 그대로 쓰는 게 맞지만, 검색으로 들어오는 경기 페이지는 사람들이 실제로 검색하는
// 이름("콜럼버스 크루", "인터 마이애미")이어야 한다. 그래서 표시용 이름을 따로 둔다.
//
// 키는 FotMob 영문 표기(matches·fixtures·team_elo와 같은 키). 없는 팀은 영문명으로 보여주고,
// syncFixtures 결과의 missingNames로 드러나게 해서 채워 넣는다(추측으로 번역하지 않는다).
export const TEAM_DISPLAY_KR: Record<string, string> = {
  // K리그1
  "Gangwon FC": "강원 FC",
  "Bucheon FC 1995": "부천 FC 1995",
  "Jeonbuk Hyundai Motors FC": "전북 현대 모터스",
  "FC Seoul": "FC 서울",
  "Pohang Steelers": "포항 스틸러스",
  "Gimcheon Sangmu": "김천 상무",
  "Ulsan HD FC": "울산 HD FC",
  "FC Anyang": "FC 안양",
  "Daejeon Hana Citizen": "대전 하나 시티즌",
  "Gwangju FC": "광주 FC",
  "Jeju SK": "제주 SK FC",
  "Incheon United": "인천 유나이티드",
  // K리그2
  "Chungnam Asan FC": "충남 아산 FC",
  "Seongnam FC": "성남 FC",
  "Cheonan City": "천안 시티 FC",
  "Yongin FC": "용인 FC",
  "Cheongju FC": "충북 청주 FC",
  "Suwon Samsung Bluewings": "수원 삼성 블루윙즈",
  "Hwaseong FC": "화성 FC",
  "Daegu FC": "대구 FC",
  "Busan I'Park": "부산 아이파크",
  "Seoul E-Land FC": "서울 이랜드 FC",
  "Gimpo FC": "김포 FC",
  "Gyeongnam FC": "경남 FC",
  "Jeonnam Dragons": "전남 드래곤즈",
  "Paju Frontier": "파주 프런티어 FC",
  "Suwon FC": "수원 FC",
  "Ansan Greeners": "안산 그리너스",
  "Gimhae FC 2008": "김해 FC 2008",
  // J1리그
  "FC Tokyo": "FC 도쿄",
  "Machida Zelvia": "마치다 젤비아",
  "Nagoya Grampus": "나고야 그램퍼스",
  "Shimizu S-Pulse": "시미즈 에스펄스",
  "Cerezo Osaka": "세레소 오사카",
  "Fagiano Okayama FC": "파지아노 오카야마",
  "Avispa Fukuoka": "아비스파 후쿠오카",
  "Vissel Kobe": "비셀 고베",
  "Sanfrecce Hiroshima": "산프레체 히로시마",
  "JEF United Chiba": "제프 유나이티드 지바",
  "Tokyo Verdy": "도쿄 베르디",
  "Kawasaki Frontale": "가와사키 프론탈레",
  "V-Varen Nagasaki": "V-바렌 나가사키",
  "Kyoto Sanga FC": "교토 상가",
  "Gamba Osaka": "감바 오사카",
  "Kashima Antlers": "가시마 앤틀러스",
  "Kashiwa Reysol": "가시와 레이솔",
  "Mito Hollyhock": "미토 홀리호크",
  "Urawa Red Diamonds": "우라와 레드 다이아몬즈",
  "Yokohama F.Marinos": "요코하마 F. 마리노스",
  // MLS
  "FC Cincinnati": "FC 신시내티",
  "New York City FC": "뉴욕 시티 FC",
  "Columbus Crew": "콜럼버스 크루",
  "CF Montreal": "CF 몽레알",
  "DC United": "DC 유나이티드",
  "New England Revolution": "뉴잉글랜드 레볼루션",
  "Red Bull New York": "뉴욕 레드불스",
  "Nashville SC": "내슈빌 SC",
  "Orlando City": "올랜도 시티",
  "Chicago Fire FC": "시카고 파이어",
  "Toronto FC": "토론토 FC",
  "Charlotte FC": "샬럿 FC",
  "Sporting Kansas City": "스포팅 캔자스시티",
  "St. Louis City": "세인트루이스 시티",
  "Minnesota United": "미네소타 유나이티드",
  "Atlanta United": "애틀랜타 유나이티드",
  "Colorado Rapids": "콜로라도 래피즈",
  "Los Angeles FC": "LAFC",
  "Real Salt Lake": "레알 솔트레이크",
  "FC Dallas": "FC 댈러스",
  "Seattle Sounders FC": "시애틀 사운더스",
  "Austin FC": "오스틴 FC",
  "LA Galaxy": "LA 갤럭시",
  "San Jose Earthquakes": "새너제이 어스퀘이크스",
  "Portland Timbers": "포틀랜드 팀버스",
  "San Diego FC": "샌디에이고 FC",
  "Vancouver Whitecaps": "밴쿠버 화이트캡스",
  "Houston Dynamo FC": "휴스턴 다이너모",
  "Inter Miami CF": "인터 마이애미",
  "Philadelphia Union": "필라델피아 유니온",
  // EPL
  "Everton": "에버턴",
  "Crystal Palace": "크리스털 팰리스",
  "Ipswich Town": "입스위치 타운",
  "Sunderland": "선덜랜드",
  "Nottingham Forest": "노팅엄 포리스트",
  "Leeds United": "리즈 유나이티드",
  "Brentford": "브렌트퍼드",
  "Tottenham Hotspur": "토트넘 홋스퍼",
  "Brighton & Hove Albion": "브라이턴",
  "Aston Villa": "애스턴 빌라",
  "Manchester City": "맨체스터 시티",
  "AFC Bournemouth": "본머스",
  "Newcastle United": "뉴캐슬 유나이티드",
  "Liverpool": "리버풀",
  "Arsenal": "아스널",
  "Chelsea": "첼시",
  "Manchester United": "맨체스터 유나이티드",
  "Fulham": "풀럼",
  "Coventry City": "코번트리 시티",
  "Hull City": "헐 시티",
  "West Ham United": "웨스트햄 유나이티드",
  "Wolverhampton Wanderers": "울버햄튼",
  "Burnley": "번리",
  // 세리에A
  "Udinese": "우디네세",
  "Como": "코모",
  "Genoa": "제노아",
  "Napoli": "나폴리",
  "Parma": "파르마",
  "Cagliari": "칼리아리",
  "Frosinone": "프로시노네",
  "Juventus": "유벤투스",
  "Venezia": "베네치아",
  "Lecce": "레체",
  "Atalanta": "아탈란타",
  "Sassuolo": "사수올로",
  "Torino": "토리노",
  "Milan": "AC 밀란",
  "Inter": "인테르",
  "Roma": "AS 로마",
  "Lazio": "라치오",
  "Fiorentina": "피오렌티나",
  "Bologna": "볼로냐",
  "Monza": "몬차",
  "Cremonese": "크레모네세",
  "Pisa": "피사",
  "Hellas Verona": "헬라스 베로나",
  // 라리가
  "Real Madrid": "레알 마드리드",
  "Barcelona": "바르셀로나",
  "Atletico Madrid": "아틀레티코 마드리드",
  "Athletic Club": "아틀레틱 빌바오",
  "Real Sociedad": "레알 소시에다드",
  "Real Betis": "레알 베티스",
  "Sevilla": "세비야",
  "Valencia": "발렌시아",
  "Villarreal": "비야레알",
  "Celta Vigo": "셀타 비고",
  "Osasuna": "오사수나",
  "Getafe": "헤타페",
  "Rayo Vallecano": "라요 바예카노",
  "Espanyol": "에스파뇰",
  "Deportivo Alaves": "알라베스",
  "Mallorca": "마요르카",
  "Girona": "지로나",
  "Levante": "레반테",
  "Elche": "엘체",
  "Oviedo": "레알 오비에도",
  "Deportivo A Coruña": "데포르티보 라코루냐",
  "Malaga": "말라가",
  "Racing Santander": "라싱 산탄데르",
  // 분데스리가
  "Bayern München": "바이에른 뮌헨",
  "Borussia Dortmund": "보루시아 도르트문트",
  "Bayer Leverkusen": "바이어 레버쿠젠",
  "RB Leipzig": "RB 라이프치히",
  "Eintracht Frankfurt": "아인트라흐트 프랑크푸르트",
  "VfB Stuttgart": "VfB 슈투트가르트",
  "Borussia Mönchengladbach": "보루시아 묀헨글라트바흐",
  "1. FC Köln": "FC 쾰른",
  "Union Berlin": "우니온 베를린",
  "Freiburg": "SC 프라이부르크",
  "Hoffenheim": "호펜하임",
  "Mainz 05": "마인츠 05",
  "Werder Bremen": "베르더 브레멘",
  "Augsburg": "아우크스부르크",
  "Hamburger SV": "함부르크 SV",
  "Wolfsburg": "볼프스부르크",
  "St. Pauli": "장크트파울리",
  "Heidenheim": "하이덴하임",
  "Schalke 04": "샬케 04",
  "Elversberg": "엘베르스베르크",
  "Paderborn": "파더보른",
};

/** 표시용 한글명. 없으면 영문명(추측 번역 금지). */
export function displayTeamName(nameEn: string): string {
  return TEAM_DISPLAY_KR[nameEn] ?? nameEn;
}

/** 표시용 이름이 없는 팀(수집 결과에 모아 사람이 채운다). */
export function missingDisplayNames(namesEn: string[]): string[] {
  return [...new Set(namesEn.filter((n) => !(n in TEAM_DISPLAY_KR)))];
}

// 리그: 주소 조각·표시 이름·검색용 별칭(태그·메타 키워드). 주소는 한 번 정하면 바꾸지 않는다.
export interface LeagueInfo {
  slug: string;
  name: string; // 표시 이름
  country: string;
  aliases: string[]; // 검색어로 쓰이는 다른 이름
}
export const LEAGUE_INFO: Record<string, LeagueInfo> = {
  "K리그1": { slug: "k-league-1", name: "K리그1", country: "대한민국", aliases: ["K리그", "케이리그", "K League 1"] },
  "K리그2": { slug: "k-league-2", name: "K리그2", country: "대한민국", aliases: ["K리그", "케이리그2", "K League 2"] },
  "J1리그": { slug: "j1-league", name: "J1리그", country: "일본", aliases: ["J리그", "일본 J리그", "J1 League"] },
  "MLS": { slug: "mls", name: "MLS", country: "미국", aliases: ["메이저리그사커", "미국 프로축구"] },
  "EPL": { slug: "epl", name: "프리미어리그", country: "잉글랜드", aliases: ["EPL", "잉글랜드 프리미어리그", "프리미어리그"] },
  "세리에A": { slug: "serie-a", name: "세리에A", country: "이탈리아", aliases: ["세리에 A", "이탈리아 세리에A"] },
  "라리가": { slug: "la-liga", name: "라리가", country: "스페인", aliases: ["라 리가", "스페인 라리가", "프리메라리가"] },
  "분데스리가": { slug: "bundesliga", name: "분데스리가", country: "독일", aliases: ["독일 분데스리가", "분데스"] },
};
export function leagueInfo(league: string): LeagueInfo {
  return LEAGUE_INFO[league] ?? { slug: league.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "league", name: league, country: "", aliases: [] };
}
export function leagueBySlug(slug: string): string | null {
  for (const [k, v] of Object.entries(LEAGUE_INFO)) if (v.slug === slug) return k;
  return null;
}
