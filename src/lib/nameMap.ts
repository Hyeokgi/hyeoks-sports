// 한글 팀명 <-> FotMob 영문 팀명 매핑 (predict_round42_v2.py NAME_MAP 이식)
export type League = "K리그1" | "K리그2";

export interface TeamMapEntry {
  nameKr: string;
  nameEn: string;
  league: League;
}

export const K1_TEAMS_KR = [
  "강원FC", "부천FC", "전북현대", "FC서울", "포항스틸", "김천상무",
  "울산HDFC", "FC안양", "대전하나", "광주FC", "제주SKFC", "인천유나",
] as const;

export const NAME_MAP: Record<string, string> = {
  "강원FC": "Gangwon FC", "부천FC": "Bucheon FC 1995",
  "전북현대": "Jeonbuk Hyundai Motors FC", "FC서울": "FC Seoul",
  "포항스틸": "Pohang Steelers", "김천상무": "Gimcheon Sangmu",
  "충남아산": "Chungnam Asan FC", "성남FC": "Seongnam FC",
  "천안시티": "Cheonan City", "용인FC": "Yongin FC",
  "충북청주": "Cheongju FC", "수원삼성": "Suwon Samsung Bluewings",
  "화성FC": "Hwaseong FC", "대구FC": "Daegu FC",
  "울산HDFC": "Ulsan HD FC", "FC안양": "FC Anyang",
  "대전하나": "Daejeon Hana Citizen", "광주FC": "Gwangju FC",
  "제주SKFC": "Jeju SK", "인천유나": "Incheon United",
  "부산아이": "Busan I'Park", "서울이랜": "Seoul E-Land FC",
  "김포FC": "Gimpo FC", "경남FC": "Gyeongnam FC",
  "전남드래": "Jeonnam Dragons", "파주프런": "Paju Frontier",
  "안산그리": "Ansan Greeners", "김해FC": "Gimhae FC 2008",
};

export function leagueOfKr(nameKr: string): League {
  return (K1_TEAMS_KR as readonly string[]).includes(nameKr) ? "K리그1" : "K리그2";
}

export function allTeamMapEntries(): TeamMapEntry[] {
  return Object.entries(NAME_MAP).map(([nameKr, nameEn]) => ({
    nameKr,
    nameEn,
    league: leagueOfKr(nameKr),
  }));
}
