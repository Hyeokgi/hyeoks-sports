// wisetoto.com 스크래핑: betman 공식 회차번호+정확한 경기목록을 로그인 없이 그대로 가져온다.
// (scripts/fetch_market_odds.mjs에서 이미 검증된 파싱 패턴과 동일 계열)
const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.wisetoto.com/index.htm" };

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`wisetoto fetch 실패 ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

// game_round 파라미터 없는 index.htm의 "기본값"은 승무패 이월(1등 미배출) 등의 사정으로 최신
// 발매회차보다 뒤처질 수 있음이 실측으로 확인됨(42회차 이월 중에도 기본값이 42로 남아있었음).
// 그래서 "다음 회차 번호를 명시적으로 넣어 존재 여부를 물어보는" 방식을 쓴다 - master_seq가
// 비어 있으면 아직 해당 회차가 열리지 않은 것.
export async function discoverRoundMasterSeq(gameYear: string, gameRound: string): Promise<string | null> {
  const url = `https://www.wisetoto.com/index.htm?tab_type=toto&game_type=sc&game_category=sc1&game_year=${gameYear}&game_round=${gameRound}`;
  const html = await fetchText(url);
  const m = html.match(/'toto','sc1','(\d+)','(\d+)','','','(\d+)',now_sports/);
  return m && m[3] ? m[3] : null;
}

export interface WisetotoFixture {
  seq: number;
  league: string; // "K리그1" | "K리그2" | "J1리그" | ... (wisetoto 원문 그대로)
  homeKr: string;
  awayKr: string;
  kickoffAt: string | null; // UTC ISO (wisetoto는 KST 표기라 -9시간 변환)
}

// "08.08(토) 19:00" (KST, 연도 없음) -> UTC ISO. 파싱 실패 시 null.
function parseKickoff(gameYear: string, dateStr: string): string | null {
  const m = dateStr.match(/(\d{2})\.(\d{2}).*?(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, mm, dd, hh, min] = m;
  // KST(UTC+9) 로컬시각을 그대로 Date.UTC에 넣고 9시간을 빼 UTC로 변환
  const kstAsUtc = Date.UTC(Number(gameYear), Number(mm) - 1, Number(dd), Number(hh), Number(min));
  const utcMs = kstAsUtc - 9 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}

export async function fetchRoundFixtures(
  gameYear: string,
  gameRound: string,
  masterSeq: string,
): Promise<WisetotoFixture[]> {
  const url = new URL("https://www.wisetoto.com/util/gameinfo/get_toto_list.htm");
  url.searchParams.set("game_category", "sc1");
  url.searchParams.set("game_year", gameYear);
  url.searchParams.set("game_round", gameRound);
  url.searchParams.set("game_month", "");
  url.searchParams.set("game_day", "");
  url.searchParams.set("game_info_master_seq", masterSeq);
  url.searchParams.set("sports", "");
  url.searchParams.set("sort", "");
  url.searchParams.set("tab_type", "toto");
  const html = await fetchText(url.toString());

  const fixtures: WisetotoFixture[] = [];
  const blockRe =
    /<div class="sub1_1">(\d+)<\/div>\s*<div class="sub_bet">([^<]+)<\/div>\s*<div class="sub2_1">\s*([^<]+?)\s*<\/div>[\s\S]*?class="stu">([^<]+)<\/a>[\s\S]*?class="stu">([^<]+)<\/a>/g;
  let m;
  while ((m = blockRe.exec(html))) {
    const seq = Number(m[1]);
    const league = m[3].trim();
    const homeKr = m[4].trim();
    const awayKr = m[5].trim();
    fixtures.push({ seq, league, homeKr, awayKr, kickoffAt: parseKickoff(gameYear, m[2]) });
  }
  return fixtures;
}
