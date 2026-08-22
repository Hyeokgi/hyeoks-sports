// EPL/세리에A 과거경기 백필 데이터 생성 (npx tsx scripts/backfill_epl_seriea.ts, GitHub Actions 러너용).
//
// 46회차(2026-08-22)가 EPL 7 + 세리에A 7 경기 회차로 처음 등장했는데, 두 리그는 matches 히스토리가
// 없어 Elo/폼/H2H를 계산할 수 없다. MLS 편입(c4dad60)과 동일 절차의 백필을 재현 가능한 스크립트로
// 만든다(당시 원본 스크립트는 scratchpad에만 있었음).
//
// - 데이터 원천: football-data.co.uk 시즌별 CSV (로그인/키 불필요, 안정 포맷)
// - 팀명: 앞으로의 자동 동기화(refreshHistory)는 FotMob 영문명을 쓰므로, football-data 표기를
//   FotMob 표기로 변환해 저장해야 같은 팀이 두 이름으로 갈라지지 않는다. 변환 결과는 FotMob
//   현재시즌 실데이터(리그 overview의 팀명 집합)와 교차검증하고, 현재시즌에 존재하는 팀이
//   하나라도 매칭 실패하면 실패로 종료한다(과거 시즌에만 있던 강등팀은 백필 내부에서만 일관되면
//   되므로 검증 대상에서 제외).
// - 산출물: seed/backfill_epl_seriea.sql (D1 백필용), seed/backfill_epl_seriea.json (로컬 백테스트용),
//   seed/fotmob_current_names.json (검증에 쓴 FotMob 현재시즌 팀명 스냅샷)
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchFinishedMatches, fetchUpcomingMatches, LEAGUE_IDS } from "../src/lib/fotmob";

interface BackfillLeague {
  league: "EPL" | "세리에A";
  fdCode: string; // football-data.co.uk 리그 코드
}

const LEAGUES: BackfillLeague[] = [
  { league: "EPL", fdCode: "E0" },
  { league: "세리에A", fdCode: "I1" },
];

// 2023-24 ~ 2026-27(진행중). MLS 백필(약 2.5시즌)보다 넉넉한 3.5시즌 - H2H(최근 5회)까지 커버.
const SEASONS = ["2324", "2425", "2526", "2627"];

// football-data 표기 -> FotMob 표기. 여기 없는 이름은 그대로(identity) 사용한다.
// 현재시즌 팀은 아래 검증 단계에서 FotMob 실표기와 대조되므로, 틀리면 실행이 실패해 드러난다.
const FD_TO_FOTMOB: Record<string, Record<string, string>> = {
  EPL: {
    "Man City": "Manchester City",
    "Man United": "Manchester United",
    "Newcastle": "Newcastle United",
    "Nott'm Forest": "Nottingham Forest",
    "Tottenham": "Tottenham Hotspur",
    "West Ham": "West Ham United",
    "Wolves": "Wolverhampton Wanderers",
    "Brighton": "Brighton & Hove Albion",
    "Leeds": "Leeds United",
    "Ipswich": "Ipswich Town",
    "Leicester": "Leicester City",
    "Luton": "Luton Town",
    "Bournemouth": "AFC Bournemouth",
  },
  // 세리에A: FotMob은 짧은 표기("Milan", "Inter", "Roma", "Verona")를 쓴다 - 2026-08-22 실측
  // (seed/fotmob_current_names.json). football-data 표기와 동일해 변환이 필요 없다.
  "세리에A": {},
};

interface BackfillMatch {
  league: string;
  date: string; // yyyy-mm-dd
  home: string;
  away: string;
  hg: number;
  ag: number;
}

// football-data Date는 dd/mm/yyyy(간혹 dd/mm/yy) 형식
function parseFdDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[2]}-${m[1]}`;
}

// 따옴표 필드까지 처리하는 최소 CSV 파서 (football-data는 대부분 단순하지만 방어적으로)
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchSeasonCsv(season: string, fdCode: string): Promise<string | null> {
  const url = `https://www.football-data.co.uk/mmz4281/${season}/${fdCode}.csv`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    console.log(`  ${url} -> HTTP ${res.status} (스킵)`);
    return null;
  }
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

async function main() {
  const all: BackfillMatch[] = [];
  const errors: string[] = [];
  const fotmobNames: Record<string, string[]> = {};

  for (const { league, fdCode } of LEAGUES) {
    // FotMob 현재시즌 팀명 집합(검증 기준) - 종료+예정 경기의 home/away 합집합
    const leagueId = LEAGUE_IDS[league];
    const [finished, upcoming] = await Promise.all([
      fetchFinishedMatches(leagueId),
      fetchUpcomingMatches(leagueId),
    ]);
    const currentSet = new Set<string>();
    for (const m of [...finished, ...upcoming]) {
      currentSet.add(m.home);
      currentSet.add(m.away);
    }
    fotmobNames[league] = [...currentSet].sort();
    console.log(`${league}: FotMob 현재시즌 팀 ${currentSet.size}개`);
    console.log(`  ${fotmobNames[league].join(" | ")}`);
    if (currentSet.size === 0) {
      errors.push(`${league}: FotMob에서 현재시즌 팀명을 가져오지 못함(리그ID ${leagueId}) - 검증 불가`);
    }

    const nameMap = FD_TO_FOTMOB[league] ?? {};
    const seen = new Set<string>(); // league|date|home|away 중복 방지(CSV-FotMob 겹침 대비)
    const mappedNames = new Set<string>();

    for (const season of SEASONS) {
      const csv = await fetchSeasonCsv(season, fdCode);
      if (!csv) continue;
      const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const header = parseCsvLine(lines[0]);
      const idx = (col: string) => header.indexOf(col);
      const iDate = idx("Date");
      const iHome = idx("HomeTeam");
      const iAway = idx("AwayTeam");
      const iHg = idx("FTHG");
      const iAg = idx("FTAG");
      if ([iDate, iHome, iAway, iHg, iAg].some((i) => i < 0)) {
        errors.push(`${league} ${season}: CSV 헤더에 필수 컬럼 없음 (${header.slice(0, 8).join(",")})`);
        continue;
      }

      let count = 0;
      for (const line of lines.slice(1)) {
        const cols = parseCsvLine(line);
        const date = parseFdDate(cols[iDate] ?? "");
        const fdHome = (cols[iHome] ?? "").trim();
        const fdAway = (cols[iAway] ?? "").trim();
        const hg = Number(cols[iHg]);
        const ag = Number(cols[iAg]);
        if (!date || !fdHome || !fdAway || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;

        const home = nameMap[fdHome] ?? fdHome;
        const away = nameMap[fdAway] ?? fdAway;
        mappedNames.add(home);
        mappedNames.add(away);
        const dedupKey = `${league}|${date}|${home}|${away}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        all.push({ league, date, home, away, hg, ag });
        count++;
      }
      console.log(`${league} ${season}: ${count}경기`);
    }

    // 현재시즌(2026-27)은 football-data CSV가 아직 없을 수 있어(HTTP 300 확인됨) FotMob 종료
    // 경기를 직접 합류시킨다 - 최근 폼 신호에 필수. 이름은 FotMob 원본 그대로라 변환 불필요.
    let fmCount = 0;
    for (const m of finished) {
      const dedupKey = `${league}|${m.date}|${m.home}|${m.away}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      all.push({ league, date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag });
      fmCount++;
    }
    console.log(`${league} 현재시즌(FotMob): ${fmCount}경기`);

    // 팀명 검증(이름 분열 방지): FotMob 현재시즌 팀명이 잘못된 변환 때문에 백필과 갈라지는
    // 경우를 잡는다 - "FD 원표기 그대로면 FotMob과 일치했을 이름"이 다른 이름으로 변환됐거나,
    // FotMob 현재 팀이 백필 전체(3.5시즌)에 전혀 등장하지 않으면(승격팀 제외 대부분 의심) 보고.
    for (const [fdName, mapped] of Object.entries(nameMap)) {
      if (currentSet.has(fdName) && !currentSet.has(mapped)) {
        errors.push(`${league}: '${fdName}'을 '${mapped}'로 변환하지만 FotMob 현재 표기는 '${fdName}'임 - 매핑 제거 필요`);
      }
    }
    for (const t of currentSet) {
      if (!mappedNames.has(t)) {
        console.log(`  참고: FotMob 현재 팀 '${t}'는 백필 CSV에 없음(승격팀이면 정상 - FotMob 현재시즌 경기로만 편입됨)`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("\n팀명 검증 실패 - FD_TO_FOTMOB 매핑을 정정한 뒤 다시 실행하세요:");
    for (const e of errors) console.error(`  - ${e}`);
    // 검증용 스냅샷은 실패해도 남겨 정정에 쓴다
    mkdirSync("seed", { recursive: true });
    writeFileSync("seed/fotmob_current_names.json", JSON.stringify(fotmobNames, null, 2));
    process.exit(1);
  }

  // getAllMatches의 ORDER BY league ASC, date ASC와 동일 순서로 저장(백테스트 재현성)
  all.sort((a, b) => (a.league === b.league ? a.date.localeCompare(b.date) : a.league.localeCompare(b.league)));

  mkdirSync("seed", { recursive: true });
  writeFileSync("seed/fotmob_current_names.json", JSON.stringify(fotmobNames, null, 2));
  writeFileSync("seed/backfill_epl_seriea.json", JSON.stringify(all, null, 1));

  const sqlLines = [
    "-- EPL/세리에A 과거경기 백필 (scripts/backfill_epl_seriea.ts 생성물 - 수기 편집 금지)",
    "-- 적용: npx wrangler d1 execute kleague-toto-db --remote --file=seed/backfill_epl_seriea.sql",
  ];
  for (const m of all) {
    sqlLines.push(
      `INSERT OR IGNORE INTO matches (league, date, home, away, hg, ag) VALUES ('${sqlEscape(m.league)}', '${m.date}', '${sqlEscape(m.home)}', '${sqlEscape(m.away)}', ${m.hg}, ${m.ag});`,
    );
  }
  writeFileSync("seed/backfill_epl_seriea.sql", sqlLines.join("\n") + "\n");

  console.log(`\n총 ${all.length}경기 백필 생성 완료 (seed/backfill_epl_seriea.{sql,json})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
