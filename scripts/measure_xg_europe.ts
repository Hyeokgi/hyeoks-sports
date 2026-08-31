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
//   피처:   두 정의를 나란히 잰다. A) 시즌누적 - 앱 createRound.computeXgDiff와 같은 계산
//           B) 최근5경기 롤링. 채택 가중치는 앱이 실제로 계산하는 A 기준으로 정한다.
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

// understat은 2026년 기준으로 리그 페이지를 껍데기로 바꾸고 데이터를 JSON 엔드포인트로 옮겼다.
// js/league.min.js 실물에서 확인한 호출:
//   $.ajax({url:"getLeagueData/"+league+"/"+season, type:"get", dataType:"json",
//           success: data => { datesData=data.dates; teamsData=data.teams; playersData=data.players }})
// 즉 예전에 HTML에 인라인돼 있던 datesData가 지금은 data.dates로 온다. 경기별 xG는 그대로다.
async function fetchSeason(understat: string, season: string): Promise<any[]> {
  const url = `https://understat.com/getLeagueData/${understat}/${season}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept-language": "en",
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        referer: `https://understat.com/league/${understat}/${season}`,
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.log(`  !! ${understat} ${season}: 요청 실패 ${(e as Error).message}`);
    return [];
  }
  if (!res.ok) {
    console.log(`  !! ${understat} ${season}: HTTP ${res.status}`);
    return [];
  }
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`  !! ${understat} ${season}: JSON 아님 (${text.length}B, 앞120자: ${text.slice(0, 120).replace(/\s+/g, " ")})`);
    return [];
  }
  const dates = json?.dates;
  if (!Array.isArray(dates)) {
    console.log(`  !! ${understat} ${season}: data.dates가 배열이 아님 (키: ${Object.keys(json ?? {}).join(", ")})`);
    return [];
  }
  return dates;
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
  // 두 가지 정의를 같이 잰다. 앱이 실제로 계산하는 것은 season 쪽이므로 채택 가중치는
  // season 기준으로 정해야 한다(createRound.computeXgDiff: 시즌누적 xG/경기 - xGA/경기).
  xgDiffSeason: number | null;
  xgDiffRolling: number | null;
  drawBase: number;
  homeAdv: number;
  outcome: 0 | 1 | 2;
}

function build(rows: XMatch[]): Ctx[] {
  const drawRates = new Map<string, number>();
  for (const lg of new Set(rows.map((r) => r.league))) drawRates.set(lg, leagueDrawRate(rows, lg));

  const elo = new Map<string, { elo: number; lastSeason: number }>();
  const hist = new Map<string, number[]>();
  const xgHist = new Map<string, { f: number; a: number; season: number }[]>();
  const h2h = new Map<string, { home: string; hg: number; ag: number }[]>();
  const count = new Map<string, number>();
  const out: Ctx[] = [];

  const avgPts = (h: number[]) => {
    const l = h.slice(-5);
    return l.length ? l.reduce((s, x) => s + x, 0) / l.length / 3 : 0;
  };
  const xgRolling = (k: string): number | null => {
    const l = (xgHist.get(k) ?? []).slice(-XG_WINDOW);
    if (l.length < XG_WINDOW) return null;
    return l.reduce((s, x) => s + (x.f - x.a), 0) / l.length;
  };
  // 앱과 동일한 정의: 해당 시즌 그 시점까지의 누적 xG/경기 - xGA/경기.
  // (앱은 FotMob 시즌 누적 테이블을 쓴다. 워크포워드라 "그 시점까지"로 잘라야 한다.)
  const xgSeason = (k: string, season: number): number | null => {
    const l = (xgHist.get(k) ?? []).filter((x) => x.season === season);
    if (l.length === 0) return null;
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
      const hxR = xgRolling(hk);
      const axR = xgRolling(ak);
      const hxS = xgSeason(hk, season);
      const axS = xgSeason(ak, season);
      out.push({
        eloDiff: he.elo - ae.elo,
        formDiff: avgPts(hist.get(hk) ?? []) - avgPts(hist.get(ak) ?? []),
        h2hDiff: h2hDiffOf(h2h, r.league, r.home, r.away).diff,
        xgDiffSeason: hxS != null && axS != null ? hxS - axS : null,
        xgDiffRolling: hxR != null && axR != null ? hxR - axR : null,
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
      x.push({ f, a, season });
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

type XgKind = "season" | "rolling";
const xgOf = (c: Ctx, kind: XgKind) => (kind === "season" ? c.xgDiffSeason : c.xgDiffRolling);

function evaluate(ctx: Ctx[], xgW: number, kind: XgKind = "rolling") {
  let correct = 0, brier = 0, ll = 0;
  for (const c of ctx) {
    const total =
      c.eloDiff +
      DEFAULT_FORM_WEIGHT * c.formDiff +
      DEFAULT_H2H_WEIGHT * c.h2hDiff +
      (xgOf(c, kind) != null ? xgW * xgOf(c, kind)! : 0);
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
  console.log(`평가 대상 ${ctx.length}경기`);
  for (const kind of ["season", "rolling"] as XgKind[]) {
    console.log(`  ${kind} 정의 확보: ${ctx.filter((c) => xgOf(c, kind) != null).length}경기`);
  }

  for (const kind of ["season", "rolling"] as XgKind[]) {
    const withXg = ctx.filter((c) => xgOf(c, kind) != null);
    console.log(`\n${"=".repeat(64)}`);
    console.log(kind === "season" ? "정의 A: 시즌누적 (앱 createRound.computeXgDiff와 동일)" : "정의 B: 최근5경기 롤링");
    console.log("=".repeat(64));

    // 1. 잔차 상관
    const resid = withXg.map((c) => {
      const total = c.eloDiff + DEFAULT_FORM_WEIGHT * c.formDiff + DEFAULT_H2H_WEIGHT * c.h2hDiff;
      const pHomeRaw = 1 / (1 + 10 ** (-(total + c.homeAdv) / 400));
      const pDraw = closenessAdjustedDrawRate(c.drawBase, Math.abs(c.eloDiff));
      const expPts = pHomeRaw * (1 - pDraw) * 3 + pDraw;
      return (c.outcome === 0 ? 3 : c.outcome === 1 ? 1 : 0) - expPts;
    });
    const r = pearson(withXg.map((c) => xgOf(c, kind)!), resid);
    const t = Math.abs(r) * Math.sqrt((resid.length - 2) / (1 - r * r));
    console.log(`\n1. 잔차 상관: r = ${r >= 0 ? "+" : ""}${r.toFixed(4)}, |t| = ${t.toFixed(2)}, n = ${resid.length}`);
    console.log(`   ${t > 1.96 && r > 0 ? "통과 (유의하고 부호도 가설과 일치)" : "미통과"}`);

    // 2. 전체 그리드
    console.log("\n2. xgWeight 그리드 (전체)");
    console.log("   xgWeight   적중률    Brier     로그손실");
    for (const w of [0, 25, 50, 75, 100, 150]) {
      const e = evaluate(withXg, w, kind);
      console.log(`   ${String(w).padStart(8)}   ${(e.acc * 100).toFixed(2)}%   ${e.brier.toFixed(4)}   ${e.ll.toFixed(4)}`);
    }

    // 3. 홀드아웃 검증 - 위 그리드는 같은 데이터로 가중치를 고른 것이라 그대로 믿으면 안 된다.
    //    시간순 앞 60%에서 가중치를 고르고, 뒤 40%(한 번도 안 본 구간)에서만 평가한다.
    const cut = Math.floor(withXg.length * 0.6);
    const train = withXg.slice(0, cut);
    const test = withXg.slice(cut);
    let bestW = 0;
    let bestLl = Infinity;
    for (let w = 0; w <= 150; w += 5) {
      const e = evaluate(train, w, kind);
      if (e.ll < bestLl) {
        bestLl = e.ll;
        bestW = w;
      }
    }
    const base = evaluate(test, 0, kind);
    const tuned = evaluate(test, bestW, kind);
    console.log(`\n3. 홀드아웃 (train ${train.length} -> test ${test.length}, 시간순 분할)`);
    console.log(`   train에서 고른 xgWeight = ${bestW}`);
    console.log("            적중률    Brier     로그손실");
    console.log(`   w=0      ${(base.acc * 100).toFixed(2)}%   ${base.brier.toFixed(4)}   ${base.ll.toFixed(4)}`);
    console.log(`   w=${String(bestW).padEnd(6)} ${(tuned.acc * 100).toFixed(2)}%   ${tuned.brier.toFixed(4)}   ${tuned.ll.toFixed(4)}`);
    const win = tuned.brier < base.brier && tuned.ll < base.ll;
    console.log(`   -> ${win ? "홀드아웃에서도 Brier·로그손실 둘 다 개선. 채택 가능." : "홀드아웃에서 개선 못 함. 채택 불가."}`);
  }
}

main();
