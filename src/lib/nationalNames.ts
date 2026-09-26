// wisetoto 국가대표 한글 표기 → martj42/international_results 영문 표기.
//
// wisetoto는 팀명을 4글자에서 자른다("크로아티", "스코틀랜", "북마케도" - 2026-09-24 55~57회차 실측).
// 그래서 전체 이름을 넣어 두고, 정확히 맞는 게 없으면 '이 글자로 시작하는 이름이 하나뿐일 때만'
// 그 이름으로 본다. 둘 이상이면(예: "아일랜드"/"북아일랜드"는 앞글자가 달라 괜찮지만) 추측하지 않는다.
const NATIONAL_KR: Record<string, string> = {
  // UEFA
  잉글랜드: "England",
  스코틀랜드: "Scotland",
  웨일스: "Wales",
  북아일랜드: "Northern Ireland",
  아일랜드: "Republic of Ireland",
  프랑스: "France",
  독일: "Germany",
  스페인: "Spain",
  포르투갈: "Portugal",
  이탈리아: "Italy",
  네덜란드: "Netherlands",
  벨기에: "Belgium",
  룩셈부르크: "Luxembourg",
  스위스: "Switzerland",
  오스트리아: "Austria",
  덴마크: "Denmark",
  노르웨이: "Norway",
  스웨덴: "Sweden",
  핀란드: "Finland",
  아이슬란드: "Iceland",
  페로제도: "Faroe Islands",
  폴란드: "Poland",
  체코: "Czech Republic",
  슬로바키아: "Slovakia",
  헝가리: "Hungary",
  루마니아: "Romania",
  불가리아: "Bulgaria",
  그리스: "Greece",
  튀르키예: "Turkey",
  터키: "Turkey",
  키프로스: "Cyprus",
  몰타: "Malta",
  크로아티아: "Croatia",
  슬로베니아: "Slovenia",
  세르비아: "Serbia",
  보스니아헤르체고비나: "Bosnia and Herzegovina",
  보스니아: "Bosnia and Herzegovina",
  몬테네그로: "Montenegro",
  북마케도니아: "North Macedonia",
  알바니아: "Albania",
  코소보: "Kosovo",
  우크라이나: "Ukraine",
  벨라루스: "Belarus",
  몰도바: "Moldova",
  러시아: "Russia",
  조지아: "Georgia",
  아르메니아: "Armenia",
  아제르바이잔: "Azerbaijan",
  카자흐스탄: "Kazakhstan",
  이스라엘: "Israel",
  라트비아: "Latvia",
  리투아니아: "Lithuania",
  에스토니아: "Estonia",
  리히텐슈타인: "Liechtenstein",
  안도라: "Andorra",
  산마리노: "San Marino",
  지브롤터: "Gibraltar",
  // AFC
  대한민국: "South Korea",
  한국: "South Korea",
  일본: "Japan",
  중국: "China",
  호주: "Australia",
  이란: "Iran",
  사우디아라비아: "Saudi Arabia",
  사우디: "Saudi Arabia",
  카타르: "Qatar",
  이라크: "Iraq",
  아랍에미리트: "United Arab Emirates",
  UAE: "United Arab Emirates",
  우즈베키스탄: "Uzbekistan",
  요르단: "Jordan",
  오만: "Oman",
  바레인: "Bahrain",
  쿠웨이트: "Kuwait",
  시리아: "Syria",
  베트남: "Vietnam",
  태국: "Thailand",
  인도네시아: "Indonesia",
  말레이시아: "Malaysia",
  북한: "North Korea",
  // CONMEBOL / CONCACAF
  브라질: "Brazil",
  아르헨티나: "Argentina",
  우루과이: "Uruguay",
  콜롬비아: "Colombia",
  에콰도르: "Ecuador",
  칠레: "Chile",
  페루: "Peru",
  파라과이: "Paraguay",
  베네수엘라: "Venezuela",
  볼리비아: "Bolivia",
  미국: "United States",
  멕시코: "Mexico",
  캐나다: "Canada",
  코스타리카: "Costa Rica",
  파나마: "Panama",
  자메이카: "Jamaica",
  온두라스: "Honduras",
  // CAF
  모로코: "Morocco",
  세네갈: "Senegal",
  이집트: "Egypt",
  나이지리아: "Nigeria",
  가나: "Ghana",
  카메룬: "Cameroon",
  튀니지: "Tunisia",
  알제리: "Algeria",
  코트디부아르: "Ivory Coast",
  남아프리카공화국: "South Africa",
  말리: "Mali",
};

const FULL_NAMES = Object.keys(NATIONAL_KR);

/** 한글 국가명(잘린 표기 포함) → 결과 데이터셋의 영문명. 모르거나 모호하면 null. */
export function nationalTeamEn(kr: string): string | null {
  const k = kr.replace(/\s+/g, "");
  if (NATIONAL_KR[k]) return NATIONAL_KR[k];
  // 잘린 표기: 이 글자로 시작하는 전체 이름들이 모두 같은 나라를 가리킬 때만 인정한다.
  const cands = new Set(FULL_NAMES.filter((n) => n.startsWith(k)).map((n) => NATIONAL_KR[n]));
  if (k.length >= 3 && cands.size === 1) return [...cands][0];
  return null;
}

/**
 * 잘린 국가명을 글에 쓸 전체 이름으로 되돌린다("슬로베니" → "슬로베니아"). 국가가 아니면 그대로.
 * 분석 글에서 "슬로베니가"처럼 조사가 어색하게 붙는 것을 막는다. 후보가 여럿이면 가장 짧은 표기.
 */
export function nationalDisplayName(kr: string): string {
  const k = kr.replace(/\s+/g, "");
  if (NATIONAL_KR[k]) return kr;
  const en = nationalTeamEn(k);
  if (!en) return kr;
  const full = FULL_NAMES.filter((n) => n.startsWith(k) && NATIONAL_KR[n] === en).sort((a, b) => a.length - b.length)[0];
  return full ?? kr;
}

export const NATIONAL_EN_NAMES: readonly string[] = [...new Set(Object.values(NATIONAL_KR))];

// 영문 국가명 → 국기 파일 코드(lipis/flag-icons 파일명: ISO 3166-1 alpha-2, 영국 4개 협회는 gb-xxx).
// 국기는 public/flags/{code}.svg에 자체 호스팅한다(scripts/fetch_national_flags.ts로 받는다 -
// 팀 엠블럼과 같은 이유로 외부 CDN 핫링크 금지).
export const NATIONAL_FLAG_CODE: Record<string, string> = {
  England: "gb-eng", Scotland: "gb-sct", Wales: "gb-wls", "Northern Ireland": "gb-nir",
  "Republic of Ireland": "ie", France: "fr", Germany: "de", Spain: "es", Portugal: "pt", Italy: "it",
  Netherlands: "nl", Belgium: "be", Luxembourg: "lu", Switzerland: "ch", Austria: "at", Denmark: "dk",
  Norway: "no", Sweden: "se", Finland: "fi", Iceland: "is", "Faroe Islands": "fo", Poland: "pl",
  "Czech Republic": "cz", Slovakia: "sk", Hungary: "hu", Romania: "ro", Bulgaria: "bg", Greece: "gr",
  Turkey: "tr", Cyprus: "cy", Malta: "mt", Croatia: "hr", Slovenia: "si", Serbia: "rs",
  "Bosnia and Herzegovina": "ba", Montenegro: "me", "North Macedonia": "mk", Albania: "al", Kosovo: "xk",
  Ukraine: "ua", Belarus: "by", Moldova: "md", Russia: "ru", Georgia: "ge", Armenia: "am",
  Azerbaijan: "az", Kazakhstan: "kz", Israel: "il", Latvia: "lv", Lithuania: "lt", Estonia: "ee",
  Liechtenstein: "li", Andorra: "ad", "San Marino": "sm", Gibraltar: "gi",
  "South Korea": "kr", Japan: "jp", China: "cn", Australia: "au", Iran: "ir", "Saudi Arabia": "sa",
  Qatar: "qa", Iraq: "iq", "United Arab Emirates": "ae", Uzbekistan: "uz", Jordan: "jo", Oman: "om",
  Bahrain: "bh", Kuwait: "kw", Syria: "sy", Vietnam: "vn", Thailand: "th", Indonesia: "id",
  Malaysia: "my", "North Korea": "kp",
  Brazil: "br", Argentina: "ar", Uruguay: "uy", Colombia: "co", Ecuador: "ec", Chile: "cl", Peru: "pe",
  Paraguay: "py", Venezuela: "ve", Bolivia: "bo", "United States": "us", Mexico: "mx", Canada: "ca",
  "Costa Rica": "cr", Panama: "pa", Jamaica: "jm", Honduras: "hn",
  Morocco: "ma", Senegal: "sn", Egypt: "eg", Nigeria: "ng", Ghana: "gh", Cameroon: "cm", Tunisia: "tn",
  Algeria: "dz", "Ivory Coast": "ci", "South Africa": "za", Mali: "ml",
};

/** 한글 국가명(잘린 표기 포함) → 자체 호스팅 국기 경로. 국가가 아니면 null. */
export function nationalFlagUrl(kr: string): string | null {
  const en = nationalTeamEn(kr);
  const code = en ? NATIONAL_FLAG_CODE[en] : undefined;
  return code ? `/flags/${code}.svg` : null;
}
