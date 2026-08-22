// 한글 팀명 <-> FotMob 영문 팀명 매핑 (predict_round42_v2.py NAME_MAP 이식)
export type League = "K리그1" | "K리그2" | "J1리그" | "MLS" | "EPL" | "세리에A";

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
  // nameKr은 wisetoto 실표기. nameEn은 FotMob 현재시즌 실표기와 backfill_epl_seriea.ts의
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
  // EPL 나머지 팀 - 46회차에 노출되지 않아 wisetoto 실표기 미확인(추정). 노출 시 정정 필요.
  { nameKr: "아스널", nameEn: "Arsenal", league: "EPL" },
  { nameKr: "첼시", nameEn: "Chelsea", league: "EPL" },
  { nameKr: "맨체스U", nameEn: "Manchester United", league: "EPL" },
  { nameKr: "웨스트햄", nameEn: "West Ham United", league: "EPL" },
  { nameKr: "울버햄튼", nameEn: "Wolverhampton Wanderers", league: "EPL" },
  { nameKr: "풀럼", nameEn: "Fulham", league: "EPL" },
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
  { nameKr: "AC밀란", nameEn: "AC Milan", league: "세리에A" },
  // 세리에A 나머지 팀 - 46회차에 노출되지 않아 wisetoto 실표기 미확인(추정). 노출 시 정정 필요.
  { nameKr: "인터밀란", nameEn: "Inter", league: "세리에A" },
  { nameKr: "AS로마", nameEn: "Roma", league: "세리에A" },
  { nameKr: "라치오", nameEn: "Lazio", league: "세리에A" },
  { nameKr: "피오렌티", nameEn: "Fiorentina", league: "세리에A" },
  { nameKr: "볼로냐", nameEn: "Bologna", league: "세리에A" },
];

export const NAME_MAP: Record<string, string> = Object.fromEntries(
  TEAM_ENTRIES.map((e) => [e.nameKr, e.nameEn]),
);

const LEAGUE_BY_KR: Record<string, League> = Object.fromEntries(
  TEAM_ENTRIES.map((e) => [e.nameKr, e.league]),
);

export function leagueOfKr(nameKr: string): League {
  return LEAGUE_BY_KR[nameKr] ?? "K리그2";
}

export function allTeamMapEntries(): TeamMapEntry[] {
  return TEAM_ENTRIES;
}
