// wisetoto 표시 해외배당(앱이 실제로 쓰는 것) vs football-data 북메이커 배당을 같은 경기에서 비교.
//
// 왜 필요한가: marketWeight 조정 근거가 두 갈래로 갈렸다.
//   football-data 종가/개장 (n=3,482, 유럽4대리그): 배당이 우리 모델을 압도. w=1.0까지 단조 개선.
//   앱 D1 wisetoto  (n=84):                        배당이 우리 모델보다 나쁨(46.4% vs 51.2%).
//                                                  스윙 최적이 w=0.3, 0.5 넘으면 급락.
// 두 결론이 반대인데, 둘은 서로 다른 배당을 재고 있다. 앱의 배당이 실제 북메이커 배당과
// 같은 값이면 n=84가 노이즈라는 뜻이고, 다른 값이면 앱 배당이 실제로 나쁘다는 뜻이다.
// 이걸 확인하지 않고 가중치를 올리면 검증 안 된 소스를 신뢰하는 셈이다.
//
// 방법: 앱이 저장한 배당과 football-data 배당을 같은 경기에 대해 나란히 놓고
//   (1) 암시확률이 얼마나 다른가 (평균 절대차, 상관)
//   (2) 오버라운드(마진)가 다른가 - 마진이 크면 정보가 아니라 수수료가 낀 것이다
//   (3) 각각의 적중률/Brier - 같은 경기에서 어느 쪽이 실제로 나은가
// 매칭은 킥오프 날짜 + 팀명으로 한다. 팀명은 우리 NAME_MAP(한글->영문) 후 football-data
// 표기와 정규화 매칭한다. 매칭률이 낮으면 결론을 내지 않고 그렇다고 찍는다.
//
// 실행: npx tsx scripts/compare_odds_source.ts   (러너 전용)
import { NAME_MAP } from "../src/lib/nameMap";

// compare_market_d1.ts / round_report.ts와 같은 값을 쓴다(환경변수 이름 포함).
// 처음에 URL을 추측해서 넣었다가 ENOTFOUND로 실패했다.
const BASE = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const FD = [
  { league: "EPL", code: "E0" },
  { league: "세리에A", code: "I1" },
  { league: "라리가", code: "SP1" },
  { league: "분데스리가", code: "D1" },
];
const SEASONS = ["2425", "2526", "2627"];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const parseFdDate = (s: string) => {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2]}-${m[1]}`;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Implied { pHome: number; pDraw: number; pAway: number; overround: number }
function implied(oh: number, od: number, oa: number): Implied | null {
  if (!(oh > 1 && od > 1 && oa > 1)) return null;
  const rh = 1 / oh, rd = 1 / od, ra = 1 / oa, s = rh + rd + ra;
  if (!(s > 1) || s > 1.6) return null;
  return { pHome: rh / s, pDraw: rd / s, pAway: ra / s, overround: s - 1 };
}

interface FdRow { league: string; date: string; home: string; away: string; hg: number; ag: number; odds: Implied | null }

async function loadFd(): Promise<FdRow[]> {
  const rows: FdRow[] = [];
  for (const { league, code } of FD) {
    for (const season of SEASONS) {
      const url = `https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`;
      let csv: string;
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) { console.log(`  ${league} ${season}: HTTP ${r.status}`); continue; }
        csv = new TextDecoder("utf-8").decode(await r.arrayBuffer());
      } catch (e) { console.log(`  ${league} ${season}: ${(e as Error).message}`); continue; }
      const lines = csv.split(/\r?\n/).filter((l) => l.trim());
      const h = parseCsvLine(lines[0]);
      const ix = (c: string) => h.indexOf(c);
      let n = 0;
      for (const line of lines.slice(1)) {
        const c = parseCsvLine(line);
        const date = parseFdDate(c[ix("Date")] ?? "");
        const home = c[ix("HomeTeam")]?.trim(), away = c[ix("AwayTeam")]?.trim();
        if (!date || !home || !away) continue;
        let odds: Implied | null = null;
        for (const [a, b, cc] of [["AvgCH", "AvgCD", "AvgCA"], ["B365CH", "B365CD", "B365CA"], ["AvgH", "AvgD", "AvgA"], ["B365H", "B365D", "B365A"]]) {
          if (ix(a) < 0) continue;
          odds = implied(Number(c[ix(a)]), Number(c[ix(b)]), Number(c[ix(cc)]));
          if (odds) break;
        }
        rows.push({ league, date, home, away, hg: Number(c[ix("FTHG")]), ag: Number(c[ix("FTAG")]), odds });
        n++;
      }
      console.log(`  ${league} ${season}: ${n}경기`);
    }
  }
  return rows;
}

// NAME_MAP은 한글표기 -> 영문명 Record다.
const krToEn = (kr: string): string | undefined => NAME_MAP[kr];

// football-data 표기는 축약형이 많다("Man City"). 정규화 후 부분일치로 잇는다.
function findFd(rows: FdRow[], date: string, homeEn: string, awayEn: string): FdRow | null {
  const d = new Date(date);
  const cands = rows.filter((r) => {
    const diff = Math.abs(Date.parse(r.date) - d.getTime()) / 86400000;
    return diff <= 1.5;
  });
  const h = norm(homeEn), a = norm(awayEn);
  const hit = (fd: string, ours: string) => {
    const f = norm(fd);
    return f === ours || ours.includes(f) || f.includes(ours);
  };
  return cands.find((r) => hit(r.home, h) && hit(r.away, a)) ?? null;
}

async function main() {
  console.log("football-data 수집...");
  const fd = await loadFd();
  console.log(`총 ${fd.length}경기, 배당 보유 ${fd.filter((r) => r.odds).length}\n`);

  console.log("앱 D1에서 정산된 유럽 리그 경기 수집...");
  const roundsData = await (await fetch(`${BASE}/api/rounds`)).json();
  const pairs: { league: string; date: string; home: string; away: string; actual: 0 | 1 | 2; app: Implied; fdOdds: Implied }[] = [];
  let noKick = 0, noMap = 0, noMatch = 0, noFdOdds = 0, total = 0;

  for (const r of (roundsData.rounds ?? [])) {
    const data = await (await fetch(`${BASE}/api/rounds/${r.id}`)).json();
    for (const m of data.matches ?? []) {
      if (!m.result || !m.raw?.market) continue;
      if (!FD.some((f) => f.league === m.league)) continue;
      total++;
      if (!m.kickoff_at) { noKick++; continue; }
      const homeEn = krToEn(m.home), awayEn = krToEn(m.away);
      if (!homeEn || !awayEn) { noMap++; continue; }
      const row = findFd(fd, m.kickoff_at, homeEn, awayEn);
      if (!row) { noMatch++; continue; }
      if (!row.odds) { noFdOdds++; continue; }
      const mk = m.raw.market;
      // D1 저장값은 이미 오버라운드 제거된 암시확률이라 overround는 알 수 없다.
      const s = mk.pHome + mk.pDraw + mk.pAway;
      pairs.push({
        league: m.league, date: m.kickoff_at.slice(0, 10), home: homeEn, away: awayEn,
        actual: m.result.actual === "H" ? 0 : m.result.actual === "D" ? 1 : 2,
        app: { pHome: mk.pHome / s, pDraw: mk.pDraw / s, pAway: mk.pAway / s, overround: NaN },
        fdOdds: row.odds,
      });
    }
  }

  console.log(`유럽 리그 정산 경기 ${total}건 중 매칭 ${pairs.length}건`);
  console.log(`  킥오프 없음 ${noKick} / 팀명 매핑 없음 ${noMap} / football-data에서 못 찾음 ${noMatch} / fd 배당 없음 ${noFdOdds}`);
  if (pairs.length < 10) {
    console.log("\n매칭 표본이 너무 작다. 결론을 내지 않는다.");
    return;
  }

  console.log("\n" + "=".repeat(70));
  console.log("1. 두 소스의 암시확률이 얼마나 다른가");
  console.log("=".repeat(70));
  let sumAbs = 0;
  const xs: number[] = [], ys: number[] = [];
  for (const p of pairs) {
    sumAbs += (Math.abs(p.app.pHome - p.fdOdds.pHome) + Math.abs(p.app.pDraw - p.fdOdds.pDraw) + Math.abs(p.app.pAway - p.fdOdds.pAway)) / 3;
    xs.push(p.app.pHome); ys.push(p.fdOdds.pHome);
  }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  console.log(`평균 절대차(확률 3개 평균): ${(sumAbs / pairs.length * 100).toFixed(2)}%p`);
  console.log(`홈승 확률 상관: r = ${(num / Math.sqrt(dx * dy)).toFixed(4)}`);
  console.log(`football-data 평균 오버라운드: ${(pairs.reduce((s, p) => s + p.fdOdds.overround, 0) / pairs.length * 100).toFixed(2)}%`);
  console.log("(앱 D1은 오버라운드가 이미 제거된 상태로 저장돼 마진을 역산할 수 없다.)");

  console.log("\n" + "=".repeat(70));
  console.log("2. 같은 경기에서 어느 쪽이 실제로 나은가");
  console.log("=".repeat(70));
  const ev = (get: (p: typeof pairs[number]) => Implied) => {
    let hit = 0, brier = 0, ll = 0;
    for (const p of pairs) {
      const q = get(p), arr = [q.pHome, q.pDraw, q.pAway];
      if (arr.indexOf(Math.max(...arr)) === p.actual) hit++;
      for (let i = 0; i < 3; i++) brier += (arr[i] - (i === p.actual ? 1 : 0)) ** 2;
      ll -= Math.log(Math.max(arr[p.actual], 1e-12));
    }
    const n = pairs.length;
    return `적중 ${(hit / n * 100).toFixed(2)}%  Brier ${(brier / n).toFixed(4)}  로그손실 ${(ll / n).toFixed(4)}`;
  };
  console.log(`앱(wisetoto)     ${ev((p) => p.app)}`);
  console.log(`football-data   ${ev((p) => p.fdOdds)}`);

  console.log("\n" + "=".repeat(70));
  console.log("3. 경기별 대조 (확률차가 큰 순 상위 10건)");
  console.log("=".repeat(70));
  const sorted = [...pairs].sort((a, b) =>
    Math.abs(b.app.pHome - b.fdOdds.pHome) - Math.abs(a.app.pHome - a.fdOdds.pHome));
  console.log("날짜        경기                              앱 홈%/무%/원%      fd 홈%/무%/원%     실제");
  for (const p of sorted.slice(0, 10)) {
    const f = (q: Implied) => `${(q.pHome * 100).toFixed(0)}/${(q.pDraw * 100).toFixed(0)}/${(q.pAway * 100).toFixed(0)}`;
    console.log(`${p.date}  ${(p.home + " vs " + p.away).padEnd(32)} ${f(p.app).padEnd(18)} ${f(p.fdOdds).padEnd(17)} ${["홈", "무", "원"][p.actual]}`);
  }
}

main();
