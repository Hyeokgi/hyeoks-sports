// 북메이커별·시점별 배당 품질 비교 — "배당의 질을 어떻게 올릴 것인가"에 대한 검증 데이터.
//
// 배경: 앱은 wisetoto 표시 해외배당을 2시간마다 스냅샷한다. 앞선 검증에서 종가 평균 배당은
// 우리 모델을 크게 앞섰지만(3,482경기, p=2.6e-6) 앱 실제 배당(65경기)으로는 판정이 안 됐다.
// 그렇다면 "어떤 배당을 쓰느냐"가 얼마나 중요한지를 먼저 재야 한다.
//
// football-data.co.uk CSV에는 북메이커별 배당이 개장가(예: B365H)와 종가(B365CH)로 나뉘어
// 들어 있다. 같은 경기에 대해 여러 소스를 동시에 평가하면 두 가지를 분리해서 잴 수 있다:
//   1) 시점 효과  - 같은 북메이커의 개장가 vs 종가 (페어 비교)
//   2) 소스 효과  - 같은 시점에서 북메이커 간 우열 (공통 표본 비교)
//
// 커버리지가 다른 소스를 그냥 비교하면 표본 차이가 섞이므로, 핵심 비교는 전부
// "그 소스들이 모두 존재하는 경기"로 한정한다.
//
// 실행: npx tsx scripts/compare_bookmakers.ts   (러너 전용 - 샌드박스는 football-data 차단)
import fs from "node:fs";
import path from "node:path";
import {
  computeEloAndHistory,
  recentForm,
  h2hDiff,
  leagueDrawRate,
  type MatchRow,
} from "../src/lib/elo";
import { predictMatch, DEFAULT_TOGGLES } from "../src/lib/prediction";

const LEAGUES = [
  { league: "EPL", fdCode: "E0" },
  { league: "세리에A", fdCode: "I1" },
  { league: "라리가", fdCode: "SP1" },
  { league: "분데스리가", fdCode: "D1" },
];
const SEASONS = ["2324", "2425", "2526", "2627"];
const WARMUP = 15;

// football-data 북메이커 접두사. C가 붙으면 종가(closing), 없으면 개장가(opening).
// Avg/Max는 개별 북이 아니라 집계값이라 따로 표시한다.
const BOOK_LABEL: Record<string, string> = {
  B365: "Bet365",
  BW: "Betway",
  IW: "Interwetten",
  PS: "Pinnacle",
  P: "Pinnacle",
  WH: "William Hill",
  VC: "VC Bet",
  BF: "Betfair",
  Max: "Max(최고배당)",
  Avg: "Avg(평균)",
  BFE: "Betfair Exchange",
  "1XB": "1xBet",
  LB: "Ladbrokes",
  SJ: "Stan James",
  GB: "Gamebookers",
  SB: "Sportingbet",
  BS: "Blue Square",
  SY: "Stanleybet",
};

type Outcome = 0 | 1 | 2;

interface Probs { h: number; d: number; a: number; overround: number; }

interface Rec {
  league: string; date: string; home: string; away: string; hg: number; ag: number;
  odds: Map<string, Probs>; // key: `${prefix}|${open|close}`
}

function parseFdDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[2]}-${m[1]}`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}

function implied(oh: number, od: number, oa: number): Probs | null {
  if (!(oh > 1 && od > 1 && oa > 1)) return null;
  const rh = 1 / oh, rd = 1 / od, ra = 1 / oa;
  const s = rh + rd + ra;
  if (!(s > 0.9) || s > 1.5) return null;
  return { h: rh / s, d: rd / s, a: ra / s, overround: s - 1 };
}

async function fetchCsv(season: string, fdCode: string): Promise<string | null> {
  const url = `https://www.football-data.co.uk/mmz4281/${season}/${fdCode}.csv`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) { console.log(`  ${url} -> HTTP ${res.status} (스킵)`); return null; }
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
}

interface M { n: number; hit: number; brier: number; logloss: number; over: number; }
const newM = (): M => ({ n: 0, hit: 0, brier: 0, logloss: 0, over: 0 });

function acc(m: M, p: [number, number, number], actual: Outcome, overround = 0): void {
  m.n++;
  if (p.indexOf(Math.max(...p)) === actual) m.hit++;
  for (let i = 0; i < 3; i++) m.brier += (p[i] - (i === actual ? 1 : 0)) ** 2;
  m.logloss += -Math.log(Math.max(p[actual], 1e-12));
  m.over += overround;
}

function line(label: string, m: M, showOver = true): string {
  if (m.n === 0) return `  ${label.padEnd(26)} (표본 없음)`;
  return (
    `  ${label.padEnd(26)} n=${String(m.n).padStart(4)}  적중 ${((m.hit / m.n) * 100).toFixed(1)}%  ` +
    `Brier ${(m.brier / m.n).toFixed(4)}  로그손실 ${(m.logloss / m.n).toFixed(4)}` +
    (showOver ? `  마진 ${((m.over / m.n) * 100).toFixed(2)}%` : "")
  );
}

async function main() {
  const recs: Rec[] = [];
  const colSeen = new Set<string>();

  for (const { league, fdCode } of LEAGUES) {
    for (const season of SEASONS) {
      const csv = await fetchCsv(season, fdCode);
      if (!csv) continue;
      const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const header = parseCsvLine(lines[0]);
      const idx = (c: string) => header.indexOf(c);
      const iDate = idx("Date"), iH = idx("HomeTeam"), iA = idx("AwayTeam");
      const iHg = idx("FTHG"), iAg = idx("FTAG");
      if ([iDate, iH, iA, iHg, iAg].some((i) => i < 0)) continue;

      // 헤더에서 배당 컬럼 삼총사를 자동 발견한다(시즌마다 제공 북이 달라진다).
      const groups = new Map<string, { h: number; d: number; a: number }>();
      for (let i = 0; i < header.length; i++) {
        const m = header[i].match(/^([A-Za-z0-9]+?)(C?)(H|D|A)$/);
        if (!m) continue;
        const [, prefix, c, hda] = m;
        if (!(prefix in BOOK_LABEL)) continue;
        const key = `${prefix}|${c === "C" ? "close" : "open"}`;
        const g = groups.get(key) ?? { h: -1, d: -1, a: -1 };
        if (hda === "H") g.h = i; else if (hda === "D") g.d = i; else g.a = i;
        groups.set(key, g);
        colSeen.add(key);
      }

      for (const raw of lines.slice(1)) {
        const c = parseCsvLine(raw);
        const date = parseFdDate(c[iDate] ?? "");
        const home = (c[iH] ?? "").trim(), away = (c[iA] ?? "").trim();
        const hg = Number(c[iHg]), ag = Number(c[iAg]);
        if (!date || !home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
        const odds = new Map<string, Probs>();
        for (const [key, g] of groups) {
          if (g.h < 0 || g.d < 0 || g.a < 0) continue;
          const p = implied(Number(c[g.h]), Number(c[g.d]), Number(c[g.a]));
          if (p) odds.set(key, p);
        }
        recs.push({ league, date, home, away, hg, ag, odds });
      }
    }
  }

  recs.sort((a, b) => (a.league === b.league ? a.date.localeCompare(b.date) : a.league.localeCompare(b.league)));
  console.log(`\n수집 ${recs.length}경기`);
  console.log(`발견된 배당 컬럼: ${[...colSeen].sort().join(", ")}`);

  // 워크포워드로 우리 모델 확률을 미리 붙여둔다(평가 대상 경기만).
  const evalRows: { rec: Rec; actual: Outcome; pure: [number, number, number] }[] = [];
  const seen: MatchRow[] = [];
  const played = new Map<string, number>();
  for (const r of recs) {
    const kh = `${r.league}|${r.home}`, ka = `${r.league}|${r.away}`;
    if ((played.get(kh) ?? 0) >= WARMUP && (played.get(ka) ?? 0) >= WARMUP) {
      const cmp = computeEloAndHistory(seen);
      const p = predictMatch(
        {
          eloDiff: cmp.elo.get(kh)!.elo - cmp.elo.get(ka)!.elo,
          formDiff: recentForm(cmp.teamHistory, r.league, r.home).avgPts - recentForm(cmp.teamHistory, r.league, r.away).avgPts,
          h2hDiff: h2hDiff(cmp.h2h, r.league, r.home, r.away).diff,
          leagueDrawRate: leagueDrawRate(seen, r.league),
          marketOdds: null, xgDiff: null, cornersDiff: null, league: r.league,
        },
        { ...DEFAULT_TOGGLES, useMarketOdds: false },
      );
      evalRows.push({
        rec: r,
        actual: r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2,
        pure: [p.pHome, p.pDraw, p.pAway],
      });
    }
    seen.push(r);
    played.set(kh, (played.get(kh) ?? 0) + 1);
    played.set(ka, (played.get(ka) ?? 0) + 1);
  }
  console.log(`워밍업 후 평가 대상 ${evalRows.length}경기`);

  // ---------- 1) 소스별 전체 성능(자체 커버리지) ----------
  const per = new Map<string, M>();
  for (const { rec, actual } of evalRows) {
    for (const [key, p] of rec.odds) {
      if (!per.has(key)) per.set(key, newM());
      acc(per.get(key)!, [p.h, p.d, p.a], actual, p.overround);
    }
  }
  console.log(`\n=== 1) 소스별 성능 (각자의 커버리지 기준 - 표본이 달라 직접 비교는 주의) ===`);
  const sorted = [...per.entries()].filter(([, m]) => m.n >= 200).sort((a, b) => a[1].brier / a[1].n - b[1].brier / b[1].n);
  for (const [key, m] of sorted) {
    const [pre, when] = key.split("|");
    console.log(line(`${BOOK_LABEL[pre]} ${when === "close" ? "종가" : "개장"}`, m));
  }

  // ---------- 2) 시점 효과: 같은 북의 개장 vs 종가 (페어) ----------
  console.log(`\n=== 2) 시점 효과 - 같은 북메이커, 개장가 vs 종가 (둘 다 있는 경기만) ===`);
  const timing: Record<string, { open: M; close: M }> = {};
  for (const key of colSeen) {
    const [pre, when] = key.split("|");
    if (when !== "close") continue;
    if (!colSeen.has(`${pre}|open`)) continue;
    const o = newM(), c = newM();
    for (const { rec, actual } of evalRows) {
      const po = rec.odds.get(`${pre}|open`), pc = rec.odds.get(`${pre}|close`);
      if (!po || !pc) continue;
      acc(o, [po.h, po.d, po.a], actual, po.overround);
      acc(c, [pc.h, pc.d, pc.a], actual, pc.overround);
    }
    if (o.n >= 200) timing[pre] = { open: o, close: c };
  }
  for (const [pre, v] of Object.entries(timing)) {
    console.log(`  [${BOOK_LABEL[pre]}]`);
    console.log(line("    개장가", v.open));
    console.log(line("    종가", v.close));
    const dAcc = (v.close.hit / v.close.n - v.open.hit / v.open.n) * 100;
    const dBr = v.open.brier / v.open.n - v.close.brier / v.close.n;
    console.log(`    -> 종가가 적중 ${dAcc >= 0 ? "+" : ""}${dAcc.toFixed(1)}%p, Brier ${dBr >= 0 ? "-" : "+"}${Math.abs(dBr).toFixed(4)} ${dBr > 0 ? "(종가 우세)" : "(개장 우세)"}`);
  }

  // ---------- 3) 소스 효과: 공통 표본에서 북메이커 간 비교(종가 기준) ----------
  const closeKeys = [...colSeen].filter((k) => k.endsWith("|close") && (per.get(k)?.n ?? 0) >= 500);
  const common = evalRows.filter((r) => closeKeys.every((k) => r.rec.odds.has(k)));
  console.log(`\n=== 3) 종가 기준 북메이커 비교 (${closeKeys.length}개 소스가 모두 있는 ${common.length}경기 공통 표본) ===`);
  if (common.length >= 200) {
    const cm = new Map<string, M>();
    const ours = newM();
    for (const { rec, actual, pure } of common) {
      acc(ours, pure, actual);
      for (const k of closeKeys) {
        if (!cm.has(k)) cm.set(k, newM());
        const p = rec.odds.get(k)!;
        acc(cm.get(k)!, [p.h, p.d, p.a], actual, p.overround);
      }
    }
    console.log(line("우리 모델(배당 미반영)", ours, false));
    for (const [k, m] of [...cm.entries()].sort((a, b) => a[1].brier / a[1].n - b[1].brier / b[1].n)) {
      console.log(line(BOOK_LABEL[k.split("|")[0]], m));
    }
  } else {
    console.log("  공통 표본이 부족해 생략");
  }

  const out = {
    generatedAt: new Date().toISOString(),
    collected: recs.length,
    evaluated: evalRows.length,
    perSource: Object.fromEntries(
      [...per.entries()].map(([k, m]) => [k, { n: m.n, acc: m.hit / m.n, brier: m.brier / m.n, logloss: m.logloss / m.n, overround: m.over / m.n }]),
    ),
    timing: Object.fromEntries(
      Object.entries(timing).map(([k, v]) => [k, {
        n: v.open.n,
        openAcc: v.open.hit / v.open.n, closeAcc: v.close.hit / v.close.n,
        openBrier: v.open.brier / v.open.n, closeBrier: v.close.brier / v.close.n,
        openOverround: v.open.over / v.open.n, closeOverround: v.close.over / v.close.n,
      }]),
    ),
  };
  fs.writeFileSync(path.join(process.cwd(), "seed", "bookmaker_comparison.json"), JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n저장: seed/bookmaker_comparison.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
