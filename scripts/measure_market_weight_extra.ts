// K리그1·K리그2·J1리그·MLS의 marketWeight를 검증한다.
//
// 왜 필요한가
//   유럽 4대리그는 0.8로 올렸고 그 근거가 4분할 홀드아웃 4/4다. 그런데 나머지 네 리그는
//   0.4를 쓰는데 그 값은 '검증됐다'가 아니라 '아직 모른다'는 뜻으로 남겨둔 기본값이다.
//   실제 회차에 나오는 리그다(49회차가 잉글랜드 챔피언십 7 + J1리그 7이었다).
//   유럽에서 배당이 모델을 크게 앞섰으니 이쪽도 그럴 가능성이 있고, 그러면 0.4는 손해다.
//
// 데이터: football-data.co.uk의 유럽 외 리그 파일(new/JPN.csv 등). 유럽 파일과 열 구조가
// 다르므로 추측하지 않는다. 먼저 헤더와 행수를 찍고, 필요한 열이 실제로 있을 때만 측정한다.
// 이 레포에서 열 이름을 가정했다가 0건을 '데이터 없음'으로 오판할 뻔한 전례가 여러 번 있었다.
//
// 실행: npx tsx scripts/measure_market_weight_extra.ts
import { buildFeatures, blend, evaluate, toProbs, SPLITS, type Features } from "./lib/evalHarness";
import type { MatchRow } from "../src/lib/elo";
import { DEFAULT_FORM_WEIGHT, DEFAULT_H2H_WEIGHT } from "../src/lib/prediction";

// 우리 리그명 <-> football-data 파일. KOR은 있는지 모르므로 후보로 두고 응답으로 판정한다.
const SOURCES = [
  { league: "J1리그", file: "JPN.csv", country: "Japan" },
  { league: "MLS", file: "USA.csv", country: "USA" },
  { league: "K리그1", file: "KOR.csv", country: "South Korea" },
];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// 유럽 파일은 DD/MM/YYYY, 이 파일들도 같은지 응답을 보고 판정한다.
function toIso(d: string): string | null {
  const m = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const year = yy.length === 2 ? `20${yy}` : yy;
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const iso = d.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

const impliedProbs = (h: number, d: number, a: number) => {
  if (![h, d, a].every((x) => Number.isFinite(x) && x > 1)) return null;
  const inv = [1 / h, 1 / d, 1 / a];
  const s = inv[0] + inv[1] + inv[2];
  return { pHome: inv[0] / s, pDraw: inv[1] / s, pAway: inv[2] / s, nBookmakers: 1 };
};

async function main() {
  for (const src of SOURCES) {
    const url = `https://www.football-data.co.uk/new/${src.file}`;
    console.log(`\n${"=".repeat(78)}\n${src.league}  ${url}\n${"=".repeat(78)}`);
    let csv: string;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(40000) });
      if (!res.ok) { console.log(`  HTTP ${res.status} - 건너�online`); continue; }
      csv = await res.text();
    } catch (e) {
      console.log(`  요청 실패 ${(e as Error).message}`);
      continue;
    }
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) { console.log("  빈 파일"); continue; }
    const header = parseCsvLine(lines[0]);
    console.log(`  행 ${lines.length - 1}개`);
    console.log(`  헤더: ${header.join(", ").slice(0, 400)}`);

    const ix = (name: string) => header.indexOf(name);
    // 열 이름을 가정하지 않고 후보 중 실제로 있는 것을 쓴다.
    const dateIx = [ix("Date"), ix("date")].find((i) => i >= 0) ?? -1;
    const homeIx = [ix("Home"), ix("HomeTeam")].find((i) => i >= 0) ?? -1;
    const awayIx = [ix("Away"), ix("AwayTeam")].find((i) => i >= 0) ?? -1;
    const hgIx = [ix("HG"), ix("FTHG")].find((i) => i >= 0) ?? -1;
    const agIx = [ix("AG"), ix("FTAG")].find((i) => i >= 0) ?? -1;
    const oddsSets: Array<[number, number, number]> = [];
    for (const [h, d, a] of [["AvgH", "AvgD", "AvgA"], ["PH", "PD", "PA"], ["B365H", "B365D", "B365A"]]) {
      if (ix(h) >= 0 && ix(d) >= 0 && ix(a) >= 0) oddsSets.push([ix(h), ix(d), ix(a)]);
    }
    console.log(`  열 위치: Date ${dateIx} / Home ${homeIx} / Away ${awayIx} / HG ${hgIx} / AG ${agIx} / 배당세트 ${oddsSets.length}개`);
    if ([dateIx, homeIx, awayIx, hgIx, agIx].some((i) => i < 0) || !oddsSets.length) {
      console.log(`  ** 필요한 열을 못 찾았다. 위 헤더를 보고 파서를 고쳐야 한다(추측으로 넘기지 않는다).`);
      continue;
    }

    const rows: MatchRow[] = [];
    const odds = new Map<string, ReturnType<typeof impliedProbs>>();
    for (let i = 1; i < lines.length; i++) {
      const c = parseCsvLine(lines[i]);
      const date = toIso(c[dateIx] ?? "");
      const home = c[homeIx]?.trim(), away = c[awayIx]?.trim();
      const hg = Number(c[hgIx]), ag = Number(c[agIx]);
      if (!date || !home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      rows.push({ league: src.league, date, home, away, hg, ag } as MatchRow);
      for (const [h, d, a] of oddsSets) {
        const p = impliedProbs(Number(c[h]), Number(c[d]), Number(c[a]));
        if (p) { odds.set(`${date}|${home}|${away}`, p); break; }
      }
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    console.log(`  파싱 ${rows.length}경기 (${rows[0]?.date} ~ ${rows.at(-1)?.date}), 배당 보유 ${odds.size}`);
    if (rows.length < 800 || odds.size < 500) {
      console.log(`  ** 표본이 작다(경기 ${rows.length} / 배당 ${odds.size}). 가중치를 정하지 않는다.`);
      continue;
    }

    // Features에는 팀명이 없다. 배당은 buildFeatures의 market 훅으로 붙인다
    // (사후에 f.home으로 조인하려다 전부 undefined가 되는 실수를 한 번 했다).
    const feats = buildFeatures(rows, {
      market: (m) => odds.get(`${m.date}|${m.home}|${m.away}`) ?? null,
    });
    // 배당이 붙은 경기로만 한정해야 arm 간 표본이 갈리지 않는다.
    const common = feats.filter((f) => f.market);
    console.log(`  워밍업 후 배당 보유 ${common.length}경기`);
    if (common.length < 500) { console.log(`  ** 500경기 미만 - 판정하지 않는다`); continue; }

    const model = (f: Features) =>
      toProbs(
        f.eloDiff + f.homeAdv + DEFAULT_FORM_WEIGHT * f.formDiff + DEFAULT_H2H_WEIGHT * f.h2hDiff,
        f.drawBase,
        Math.abs(f.eloDiff),
      );
    const at = (w: number, arr: Features[]) =>
      evaluate(arr.map((f) => ({ probs: blend(model(f), f.market!, w), outcome: f.outcome })));

    const GRID = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    console.log(`\n  w별 4분할 test 적중률/로그손실 (현행 0.4)`);
    for (const w of GRID) {
      const cells = SPLITS.map((frac) => {
        const cut = Math.floor(common.length * frac);
        const m = at(w, common.slice(cut));
        return `${(m.acc * 100).toFixed(2)}%/${m.logloss.toFixed(4)}`;
      });
      console.log(`   w=${w.toFixed(1)}  ${cells.join("  ")}${w === 0.4 ? "  <- 현행" : ""}`);
    }

    // train에서 고르고 test에서만 평가. 채택은 4분할 전부 현행보다 나빠지지 않을 때만.
    console.log(`\n  train에서 로그손실 최적 w를 골라 test 평가:`);
    let pass = 0;
    const picks: number[] = [];
    for (const frac of SPLITS) {
      const cut = Math.floor(common.length * frac);
      const tr = common.slice(0, cut), te = common.slice(cut);
      let best = { w: 0.4, ll: Infinity };
      for (const w of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
        const m = at(w, tr);
        if (m.logloss < best.ll) best = { w, ll: m.logloss };
      }
      picks.push(best.w);
      const mw = at(best.w, te), cur = at(0.4, te);
      const ok = mw.acc >= cur.acc && mw.logloss <= cur.logloss;
      if (ok) pass++;
      console.log(`   분할 ${frac}: 선택 w=${best.w.toFixed(2)}  적중 ${(cur.acc * 100).toFixed(2)} -> ${(mw.acc * 100).toFixed(2)}%  로그손실 ${cur.logloss.toFixed(4)} -> ${mw.logloss.toFixed(4)}  ${ok ? "통과" : "미달"}`);
    }
    const med = [...picks].sort((a, b) => a - b)[Math.floor(picks.length / 2)];
    console.log(`   선택 w: ${picks.map((w) => w.toFixed(2)).join(" / ")} (중앙값 ${med.toFixed(2)})`);
    console.log(`   ${pass}/${SPLITS.length} 통과 -> ${pass === SPLITS.length ? `${src.league} marketWeight를 ${med.toFixed(2)}로 올릴 근거가 있다` : "현행 0.4를 유지한다"}`);
  }
}

main();
