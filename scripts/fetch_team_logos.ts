// FotMob에서 팀 엠블럼을 수집해 이 저장소에 자체 호스팅한다.
//
// 왜 자체 호스팅인가: 외부 CDN 직접 참조(핫링크)는 상대가 리퍼러를 막거나 경로를 바꾸면
// 전 경기 마크가 한꺼번에 깨진다. 한 번 받아서 public/logos/에 두면 그 위험이 사라지고
// 사용자 브라우저가 제3자 서버에 요청을 보내지도 않는다.
//
// 샌드박스에서는 fotmob.com이 네트워크 정책으로 막혀 있어 GitHub Actions 러너에서 실행한다
// (task=logos). 산출물은 러너가 커밋한다.
//
// 실행: npx tsx scripts/fetch_team_logos.ts
import fs from "node:fs";
import path from "node:path";
import { LEAGUE_IDS } from "../src/lib/fotmob";
import { TEAM_ENTRIES } from "../src/lib/nameMap";

const OUT_DIR = path.join(process.cwd(), "public", "logos");
const TS_OUT = path.join(process.cwd(), "src", "lib", "teamLogos.ts");
const LOGO_URL = (id: number | string) =>
  `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
  Referer: "https://www.fotmob.com/",
};

async function fetchNextData(url: string): Promise<any | null> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    console.warn(`  ! HTTP ${res.status} ${url}`);
    return null;
  }
  const text = await res.text();
  const startTag = '<script id="__NEXT_DATA__" type="application/json">';
  const start = text.indexOf(startTag);
  if (start === -1) {
    console.warn("  ! __NEXT_DATA__ 없음");
    return null;
  }
  const end = text.indexOf("</script>", start);
  return JSON.parse(text.slice(start + startTag.length, end).trim());
}

// 팀 id/이름이 어디에 들어 있든(fixtures의 home/away, 순위표 등) 재귀로 긁는다.
// FotMob 페이지 구조가 종종 바뀌어서 특정 경로에 의존하지 않는다.
function collectTeams(node: any, out: Map<number, string>, depth = 0): void {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) {
    for (const v of node) collectTeams(v, out, depth + 1);
    return;
  }
  const id = node.id;
  const name = node.name;
  // 팀 객체의 특징: 숫자 id + 문자열 name. 경기/선수 객체와 섞이지 않도록
  // 팀에만 있는 힌트 필드(shortName/teamColor 등)나 home/away 컨텍스트를 함께 본다.
  if (typeof name === "string" && name.length > 0 && (typeof id === "number" || /^\d+$/.test(String(id ?? "")))) {
    const nid = Number(id);
    if (Number.isFinite(nid) && nid > 0) {
      // 경기 카드의 home/away, 순위표 행 등 팀 객체가 가질 법한 필드를 폭넓게 본다.
      // (리그 개요만 보면 경기 창 밖의 팀이 누락돼 실제로 6팀이 빠졌다)
      const looksLikeTeam =
        "shortName" in node ||
        "teamColor" in node ||
        "score" in node ||
        "imageUrl" in node ||
        "played" in node ||
        "pts" in node ||
        "goalConDiff" in node ||
        (typeof node.pageUrl === "string" && node.pageUrl.includes("/teams/"));
      if (looksLikeTeam) out.set(nid, name);
    }
  }
  for (const key of ["home", "away", "table", "tables", "all", "data", "teams", "allMatches", "matches", "content"]) {
    if (key in node) collectTeams(node[key], out, depth + 1);
  }
  // 위 힌트 키가 없으면 얕게 전체 순회(깊이 제한이 폭주를 막는다)
  if (depth < 6) {
    for (const [k, v] of Object.entries(node)) {
      if (["home", "away", "table", "tables", "all", "data", "teams", "allMatches", "matches", "content"].includes(k)) continue;
      if (v && typeof v === "object") collectTeams(v, out, depth + 1);
    }
  }
}

function slug(nameKr: string): string {
  // 파일명은 ASCII로 유지(배포/CDN 경로에서 한글 인코딩 이슈 회피)
  let h = 2166136261;
  for (let i = 0; i < nameKr.length; i++) {
    h ^= nameKr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // FotMob 영문명 -> 한글명 (nameMap의 역방향). 표기 흔들림 대비해 정규화 키도 같이 넣는다.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const enToKr = new Map<string, { nameKr: string; league: string }>();
  for (const e of TEAM_ENTRIES) {
    enToKr.set(norm(e.nameEn), { nameKr: e.nameKr, league: e.league });
  }

  const found = new Map<string, { id: number; en: string; league: string }>(); // key: nameKr
  const unmatched: { en: string; id: number; league: string }[] = [];

  for (const [league, leagueId] of Object.entries(LEAGUE_IDS)) {
    console.log(`\n[${league}] leagueId=${leagueId}`);
    const teams = new Map<number, string>();
    // overview는 경기 창에 걸린 팀만 나온다. table 페이지에 리그 전체 팀이 있으므로 둘 다 본다.
    for (const sub of ["overview", "table"]) {
      const json = await fetchNextData(`https://www.fotmob.com/ko/leagues/${leagueId}/${sub}/`);
      if (!json) continue;
      const before = teams.size;
      collectTeams(json?.props?.pageProps, teams);
      console.log(`  ${sub}: +${teams.size - before} (누적 ${teams.size})`);
      await new Promise((r) => setTimeout(r, 800));
    }
    if (teams.size === 0) continue;

    for (const [id, en] of teams) {
      const hit = enToKr.get(norm(en));
      if (!hit) {
        unmatched.push({ en, id, league });
        continue;
      }
      // 같은 팀이 여러 리그 페이지에 나올 수 있으니 nameMap의 리그와 일치할 때만 채택
      if (hit.league !== league) continue;
      if (!found.has(hit.nameKr)) found.set(hit.nameKr, { id, en, league });
    }
    await new Promise((r) => setTimeout(r, 1200)); // 예의상 간격
  }

  console.log(`\n=== 매핑 성공 ${found.size} / nameMap 전체 ${TEAM_ENTRIES.length} ===`);

  // 엠블럼 다운로드
  const manifest: Record<string, string> = {};
  let ok = 0;
  let fail = 0;
  for (const [nameKr, info] of found) {
    const file = `${slug(nameKr)}.png`;
    const dest = path.join(OUT_DIR, file);
    try {
      const res = await fetch(LOGO_URL(info.id), { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // 200KB 넘으면 엠블럼이 아닐 가능성이 커서 건너뛴다(오탐 방어)
      if (buf.length === 0 || buf.length > 200_000) throw new Error(`size ${buf.length}`);
      if (!(buf[0] === 0x89 && buf[1] === 0x50)) throw new Error("PNG 아님");
      fs.writeFileSync(dest, buf);
      manifest[nameKr] = `/logos/${file}`;
      ok++;
    } catch (e) {
      console.warn(`  ! ${nameKr}(${info.en}, id=${info.id}) 실패: ${(e as Error).message}`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(`\n다운로드 성공 ${ok} / 실패 ${fail}`);

  // 매칭 실패 목록은 nameMap 보완에 쓰이므로 그대로 남긴다
  if (unmatched.length > 0) {
    const uniq = [...new Map(unmatched.map((u) => [`${u.league}|${u.en}`, u])).values()];
    fs.writeFileSync(
      path.join(process.cwd(), "seed", "logo_unmatched.json"),
      JSON.stringify(uniq, null, 2),
      "utf-8",
    );
    console.log(`nameMap에 없는 팀 ${uniq.length}건 -> seed/logo_unmatched.json`);
  }

  const missing = TEAM_ENTRIES.filter((e) => !manifest[e.nameKr]).map((e) => `${e.league}/${e.nameKr}`);
  if (missing.length > 0) {
    // 대부분 강등 등으로 현재 시즌 1부에 없는 팀이다. FotMob 리그 페이지(overview/table)는
    // 현재 시즌만 담으므로 잡히지 않는다. 1부에 없으면 승무패 회차에 편성될 수도 없어서
    // 실제 화면에서는 모노그램 폴백이 보이지 않는다 - 버그가 아니다.
    // 해당 팀이 승격해 돌아오면 다음 수집 때 자동으로 채워진다.
    console.log(`\n엠블럼 없는 팀 ${missing.length}건 (현재 시즌 1부 미소속 추정, 모노그램 폴백):`);
    console.log("  " + missing.join(", "));
  }

  const sorted = Object.keys(manifest).sort();
  const body = sorted.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(manifest[k])},`).join("\n");
  fs.writeFileSync(
    TS_OUT,
    `// 자동 생성 파일 - 직접 수정하지 말 것. scripts/fetch_team_logos.ts로 재생성한다.\n` +
      `// 팀 엠블럼은 public/logos/에 자체 호스팅한다(외부 CDN 핫링크 금지 - 차단되면 전부 깨짐).\n` +
      `// 여기에 없는 팀은 프론트에서 팀명 기반 모노그램 마크로 자동 폴백한다.\n` +
      `export const TEAM_LOGOS: Record<string, string> = {\n${body}\n};\n`,
    "utf-8",
  );
  console.log(`\n생성: ${TS_OUT} (${sorted.length}팀)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
