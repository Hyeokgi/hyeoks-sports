// xG가 유럽 4대리그에서도 실제로 예측력을 더하는지 워크포워드 검증.
//
// 배경: 챗GPT 분석은 xG/xGA를 Team Elo와 동급(★★★★★)으로 꼽았다. 우리 앱은 xG를
// K리그1에서만 쓴다(createRound.ts XG_SUPPORTED_LEAGUES). 그 제한의 근거는 "K리그2는
// FotMob에 데이터가 없다"와 "J1리그는 상관이 무의미했다"였을 뿐, 유럽 4대리그에서 검증해본
// 적은 한 번도 없다. 그런데 지금 승무패 회차에 실제로 나오는 리그가 바로 그 4개다.
// DEFAULT_XG_WEIGHT=100.0도 백테스트로 fit한 값이 아니라 업계 통념을 채택한 값이다.
//
// 방법
//   데이터: understat.com 경기별 xG (EPL/라리가/세리에A/분데스리가, 2023~2026 시즌).
//           앱이 쓰는 FotMob은 "시즌 누적 팀 xG"만 줘서 과거 시점 재현이 안 된다.
//           understat은 경기별이라 워크포워드가 가능하다 - 각 경기 직전까지의 xG만 쓴다.
//   피처:   xgDiff = (홈 최근N경기 평균 xG - xGA) - (원정 최근N경기 평균 xG - xGA)
//           앱 코드(createRound.computeXgDiff)와 같은 정의를 최근경기 창으로 옮긴 것.
//   비교:   현행 모델(Elo+폼+H2H) 대비 xgWeight를 0부터 올려가며 적중률/Brier/로그손실.
//
// 샌드박스에서 understat이 막혀 있어 GitHub Actions 러너에서 실행한다.
// 실행: npx tsx scripts/measure_xg_europe.ts
import {
  h2hDiff as h2hDiffOf,
  leagueDrawRate,
  seasonOf,
  homeAdvForLeague,
  K_FACTOR,
  SEASON_REGRESSION,
  type MatchRow,
} from "../src/lib/elo";
import { closenessAdjustedDrawRate } from "../src/lib/drawCurve";
import { DEFAULT_FORM_WEIGHT, DEFAULT_H2H_WEIGHT, DEFAULT_XG_WEIGHT } from "../src/lib/prediction";

const WARMUP = 15;
const XG_WINDOW = 5; // 최근 몇 경기의 xG를 평균낼지

const LEAGUES: { league: string; understat: string }[] = [
  { league: "EPL", understat: "EPL" },
  { league: "라리가", understat: "La_liga" },
  { league: "세리에A", understat: "Serie_A" },
  { league: "분데스리가", understat: "Bundesliga" },
];
const SEASONS = ["2023", "2024", "2025", "2026"];

interface XMatch extends MatchRow {
  hxg: number;
  axg: number;
}

// understat 리그 페이지의 datesData에서 경기별 xG를 뽑는다.
// 페이지가 `var datesData = JSON.parse('\x5B...\x5D');` 형태로 16진 이스케이프해서 넣어둔다.
function parseDatesData(html: string): any[] | null {
  const m = html.match(/var\s+datesData\s*=\s*JSON\.parse\('([^']+)'\)/);
  if (!m) return null;
  const decoded = m[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

let dumped = false;

async function fetchSeason(understat: string, season: string): Promise<any[]> {
  const url = `https://understat.com/league/${understat}/${season}`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", "accept-language": "en" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    console.log(`  !! ${understat} ${season}: HTTP ${res.status}`);
    return [];
  }
  const html = await res.text();
  const rows = parseDatesData(html);
  if (!rows) {
    // 추측하지 말고 실제로 뭘 받았는지 남긴다. 봇 차단 페이지인지, 구조가 바뀐 건지,
    // 변수명이 다른 건지는 응답을 봐야만 구분된다.
    console.log(`  !! ${understat} ${season}: datesData 파싱 실패`);
    console.log(`     길이 ${html.length}B, content-type=${res.headers.get("content-type")}`);
    const title = html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i)?.[1]?.trim();
    console.log(`     <title>: ${title ?? "(없음)"}`);
    const vars = [...html.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=\s*JSON\.parse/g)].map((m) => m[1]);
    console.log(`     JSON.parse로 주입된 변수: ${vars.length ? vars.join(", ") : "(없음)"}`);
    // 첫 실패 1건만 전체를 덤프한다. 18KB짜리 껍데기 페이지라 데이터를 어디서 불러오는지는
    // 스크립트 태그와 XHR 엔드포인트를 봐야 안다(정상 understat 리그 페이지는 500KB+였다).
    if (!dumped) {
      dumped = true;
      const srcs = [...html.matchAll(/<script[^>]*src=["\']([^"\']+)["\']/gi)].map((m) => m[1]);
      console.log(`     script src (${srcs.length}): ${srcs.join(" | ")}`);
      const urls = [...new Set([...html.matchAll(/["\']([^"\']*\/(?:api|ajax|data|json)[^"\']*)["\']/gi)].map((m) => m[1]))];
      console.log(`     api/ajax 후보 URL: ${urls.length ? urls.join(" | ") : "(없음)"}`);
      console.log("     ===== 전체 HTML 시작 =====");
      console.log(html);
      console.log("     ===== 전체 HTML 끝 =====");
    }
    return [];
  }
  return rows;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function load(): Promise<XMatch[]> {
  const out: XMatch[] = [];
  for (const { league, understat } of LEAGUES) {
    for (const season of SEASONS) {
      const rows = await fetchSeason(understat, season);
      let n = 0;
      for (const r of rows) {
        if (!r?.isResult) continue;
        const hg = Number(r.goals?.h);
        const ag = Number(r.goals?.a);
        const hxg = Number(r.xG?.h);
        const axg = Number(r.xG?.a);
        if (![hg, ag, hxg, axg].every(Number.isFinite)) continue;
        out.push({
          league,
          date: String(r.datetime).slice(0, 10),
          home: r.h?.title ?? "",
          away: r.a?.title ?? "",
          hg,
          ag,
          hxg,
          axg,
        });
        n++;
      }
      console.log(`  ${league} ${season}: ${n}경기`);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

interface Ctx {
  eloDiff: number;
  formDiff: number;
  h2hDiff: number;
  xgDiff: number | null;
  drawBase: number;
  homeAdv: number;
  outcome: 0 | 1 | 2;
}

function build(rows: XMatch[]): Ctx[] {
  const drawRates = new Map<string, number>();
  for (const lg of new Set(rows.map((r) => r.league))) drawRates.set(lg, leagueDrawRate(rows, lg));

  const elo = new Map<string, { elo: number; lastSeason: number }>();
  const hist = new Map<string, number[]>();
  const xgHist = new Map<string, { f: number; a: number }[]>();
  const h2h = new Map<string, { home: string; hg: number; ag: number }[]>();
  const count = new Map<string, number>();
  const out: Ctx[] = [];

  const avgPts = (h: number[]) => {
    const l = h.slice(-5);
    return l.length ? l.reduce((s, x) => s + x, 0) / l.length / 3 : 0;
  };
  const xgNet = (k: string): number | null => {
    const l = (xgHist.get(k) ?? []).slice(-XG_WINDOW);
    if (l.length < XG_WINDOW) return null;
    return l.reduce((s, x) => s + (x.f - x.a), 0) / l.length;
  };

  for (const r of rows) {
    const hk = `${r.league}|${r.home}`;
    const ak = `${r.league}|${r.away}`;
    const season = seasonOf(r.league, r.date);
    for (const k of [hk, ak]) {
      const st = elo.get(k) ?? { elo: 1500, lastSeason: season };
      if (st.lastSeason !== season) {
        st.elo += (1500 - st.elo) * SEASON_REGRESSION;
        st.lastSeason = season;
      }
      elo.set(k, st);
    }
    const he = elo.get(hk)!;
    const ae = elo.get(ak)!;
    if ((count.get(hk) ?? 0) >= WARMUP && (count.get(ak) ?? 0) >= WARMUP) {
      const hx = xgNet(hk);
      const ax = xgNet(ak);
      out.push({
        eloDiff: he.elo - ae.elo,
        formDiff: avgPts(hist.get(hk) ?? []) - avgPts(hist.get(ak) ?? []),
        h2hDiff: h2hDiffOf(h2h, r.league, r.home, r.away).diff,
        xgDiff: hx != null && ax != null ? hx - ax : null,
        drawBase: drawRates.get(r.league)!,
        homeAdv: homeAdvForLeague(r.league),
        outcome: r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2,
      });
    }
    const exp = 1 / (1 + 10 ** (-(he.elo - ae.elo + homeAdvForLeague(r.league)) / 400));
    const sc = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
    he.elo += K_FACTOR * (sc - exp);
    ae.elo -= K_FACTOR * (sc - exp);
    for (const [k, pts, f, a] of [
      [hk, r.hg > r.ag ? 3 : r.hg === r.ag ? 1 : 0, r.hxg, r.axg],
      [ak, r.ag > r.hg ? 3 : r.hg === r.ag ? 1 : 0, r.axg, r.hxg],
    ] as [string, number, number, number][]) {
      const h = hist.get(k) ?? [];
      h.push(pts);
      hist.set(k, h);
      const x = xgHist.get(k) ?? [];
      x.push({ f, a });
      xgHist.set(k, x);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    const pk = `${r.league}|${[r.home, r.away].sort().join("|")}`;
    const arr = h2h.get(pk) ?? [];
    arr.push({ home: r.home, hg: r.hg, ag: r.ag });
    h2h.set(pk, arr);
  }
  return out;
}

function evaluate(ctx: Ctx[], xgW: number) {
  let correct = 0, brier = 0, ll = 0;
  for (const c of ctx) {
    const total =
      c.eloDiff +
      DEFAULT_FORM_WEIGHT * c.formDiff +
      DEFAULT_H2H_WEIGHT * c.h2hDiff +
      (c.xgDiff != null ? xgW * c.xgDiff : 0);
    const pHomeRaw = 1 / (1 + 10 ** (-(total + c.homeAdv) / 400));
    const pDraw = closenessAdjustedDrawRate(c.drawBase, Math.abs(c.eloDiff));
    const p = [pHomeRaw * (1 - pDraw), pDraw, (1 - pHomeRaw) * (1 - pDraw)];
    if (p.indexOf(Math.max(...p)) === c.outcome) correct++;
    for (let i = 0; i < 3; i++) brier += (p[i] - (i === c.outcome ? 1 : 0)) ** 2;
    ll -= Math.log(Math.max(p[c.outcome], 1e-9));
  }
  const n = ctx.length;
  return { acc: correct / n, brier: brier / n, ll: ll / n };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

async function main() {
  console.log("understat 경기별 xG 수집 중...");
  const rows = await load();
  console.log(`\n총 ${rows.length}경기 수집\n`);
  if (rows.length === 0) {
    console.log("데이터를 하나도 못 받았다. 아래 결과 없음 - 결론 내지 말 것.");
    return;
  }

  const ctx = build(rows);
  const withXg = ctx.filter((c) => c.xgDiff != null);
  console.log(`평가 대상 ${ctx.length}경기, 그중 xG 창(최근 ${XG_WINDOW}경기) 확보 ${withXg.length}경기\n`);

  // 1. 잔차 상관: Elo+폼+H2H가 설명하지 못한 부분에 xG 신호가 남아 있는가
  const base = evaluate(withXg, 0);
  const resid = withXg.map((c) => {
    const total = c.eloDiff + DEFAULT_FORM_WEIGHT * c.formDiff + DEFAULT_H2H_WEIGHT * c.h2hDiff;
    const pHomeRaw = 1 / (1 + 10 ** (-(total + c.homeAdv) / 400));
    const pDraw = closenessAdjustedDrawRate(c.drawBase, Math.abs(c.eloDiff));
    const expPts = pHomeRaw * (1 - pDraw) * 3 + pDraw;
    const actual = c.outcome === 0 ? 3 : c.outcome === 1 ? 1 : 0;
    return actual - expPts;
  });
  const r = pearson(withXg.map((c) => c.xgDiff!), resid);
  const t = Math.abs(r) * Math.sqrt((resid.length - 2) / (1 - r * r));
  console.log("── 1. 잔차 상관 (Elo+폼+H2H가 못 잡은 부분 vs xG 격차) ─────────");
  console.log(`r = ${r >= 0 ? "+" : ""}${r.toFixed(4)}   |t| = ${t.toFixed(2)}   ${t > 1.96 ? "유의(p<0.05)" : "유의하지 않음"}`);
  console.log("  부호가 양수여야 가설과 맞다(xG 우위 팀이 모델 예측보다 더 잘함).\n");

  // 2. 가중치 그리드
  console.log("── 2. xgWeight별 성능 (xG 확보 경기만) ─────────────────────────");
  console.log("xgWeight   적중률    Brier     로그손실");
  for (const w of [0, 25, 50, 100, 150, 200]) {
    const e = evaluate(withXg, w);
    const mark = w === DEFAULT_XG_WEIGHT ? "  <- 현행 K리그1 값" : w === 0 ? "  <- 현행 유럽(미적용)" : "";
    console.log(
      `${String(w).padStart(8)}   ${(e.acc * 100).toFixed(2)}%   ${e.brier.toFixed(4)}   ${e.ll.toFixed(4)}${mark}`,
    );
  }
  console.log(`\n기준선(xgWeight=0): 적중률 ${(base.acc * 100).toFixed(2)}%, Brier ${base.brier.toFixed(4)}`);
  console.log("채택 조건: 1번 |t|>1.96 & 부호 양수, 그리고 2번에서 w>0이 w=0보다 Brier·로그손실 둘 다 개선.");
}

main();
