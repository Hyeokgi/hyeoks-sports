// 선발투수가 끊어진 고리2를 이어주는가.
//
// 배경 (scripts/measure_baseball_sabr.ts)
//   고리1 총득점 -> 1점차 확률   성립한다. 총득점 구간별 46.8% ~ 14.7%로 32%p 스윙
//   고리2 사전정보 -> 총득점     끊어졌다. 팀 득점환경(최근 20경기)만으로 R^2 0.70%
//   사슬이 이어지지 않아 승1패를 예측할 수 없었고, 그래서 지금 모듈은 "1"을 리그 상수로 둔다.
//
// 선발투수가 고리2를 살릴 유일한 후보였다. 이제 데이터가 있다(MLB 9,342경기 양쪽 확보).
// 세 가지를 순서대로 잰다. 앞이 안 되면 뒤는 볼 필요가 없다.
//   A 고리2  선발을 넣으면 총득점 예측이 실제로 나아지는가 (R^2, 4분할 test)
//   B 고리1+2 그 예측으로 만든 P(1)이 변별력을 갖는가 (5분위별 실제 1점차 비율)
//   C 승패   선발이 승패 2택 모델도 개선하는가 (4분할, 적중률 포함)
//
// 누수 방지: 모든 피처는 그 경기 이전 정보만 쓴다. 투수는 최소 3선발, 팀은 20경기 이후부터.
// 회귀 계수도 train에서만 적합한다.
//
// 실행: npx tsx scripts/measure_starter_signal.ts [KBO|MLB]
import { readFileSync } from "node:fs";

const LEAGUE = (process.argv[2] ?? "MLB") as "KBO" | "MLB";
const TEAM_WINDOW = 20;
const MIN_STARTS = 3;
const SPLITS = [0.5, 0.6, 0.7, 0.8];
const ELO = { KBO: { k: 4, reg: 0, ha: 9.7 }, MLB: { k: 6, reg: 0.25, ha: 21.8 } }[LEAGUE];

interface G { date: string; home: string; away: string; hs: number; as: number; homeStarter: string; awayStarter: string }

interface Feat {
  date: string;
  homeOff: number; awayOff: number; homeDef: number; awayDef: number;
  homeSt: number | null; awaySt: number | null; // 선발의 '팀 실점' 평균 - 리그 평균
  eloDiff: number;
  total: number; margin: number; homeWin: 0 | 1;
}

function build(rows: G[]): Feat[] {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const scored = new Map<string, number[]>();
  const allowed = new Map<string, number[]>();
  const stRuns = new Map<string, number[]>(); // 투수별, 그 선발 경기에서 팀이 내준 점수
  const elo = new Map<string, number>();
  const played = new Map<string, number>();
  let season = Number(sorted[0].date.slice(0, 4));
  let runSum = 0, runN = 0; // 리그 평균 실점(경기당 한 팀 기준)
  const out: Feat[] = [];

  const mean = (a: number[] | undefined, w = Infinity) => {
    if (!a || !a.length) return null;
    const s = a.slice(-w);
    return s.reduce((x, y) => x + y, 0) / s.length;
  };

  for (const g of sorted) {
    const s = Number(g.date.slice(0, 4));
    if (s !== season) {
      for (const [t, v] of elo) elo.set(t, 1500 + (v - 1500) * (1 - ELO.reg));
      season = s;
    }
    const eh = elo.get(g.home) ?? 1500, ea = elo.get(g.away) ?? 1500;
    const lgAvg = runN ? runSum / runN : 4.5;

    const ho = mean(scored.get(g.home), TEAM_WINDOW), ao = mean(scored.get(g.away), TEAM_WINDOW);
    const hd = mean(allowed.get(g.home), TEAM_WINDOW), ad = mean(allowed.get(g.away), TEAM_WINDOW);
    const hsArr = stRuns.get(g.homeStarter), asArr = stRuns.get(g.awayStarter);
    const hSt = g.homeStarter && hsArr && hsArr.length >= MIN_STARTS ? mean(hsArr)! - lgAvg : null;
    const aSt = g.awayStarter && asArr && asArr.length >= MIN_STARTS ? mean(asArr)! - lgAvg : null;

    if (ho !== null && ao !== null && hd !== null && ad !== null &&
        (played.get(g.home) ?? 0) >= TEAM_WINDOW && (played.get(g.away) ?? 0) >= TEAM_WINDOW) {
      out.push({
        date: g.date,
        homeOff: ho, awayOff: ao, homeDef: hd, awayDef: ad,
        homeSt: hSt, awaySt: aSt,
        eloDiff: eh - ea,
        total: g.hs + g.as, margin: g.hs - g.as, homeWin: g.hs > g.as ? 1 : 0,
      });
    }

    // 갱신
    (scored.get(g.home) ?? scored.set(g.home, []).get(g.home)!).push(g.hs);
    (scored.get(g.away) ?? scored.set(g.away, []).get(g.away)!).push(g.as);
    (allowed.get(g.home) ?? allowed.set(g.home, []).get(g.home)!).push(g.as);
    (allowed.get(g.away) ?? allowed.set(g.away, []).get(g.away)!).push(g.hs);
    if (g.homeStarter) (stRuns.get(g.homeStarter) ?? stRuns.set(g.homeStarter, []).get(g.homeStarter)!).push(g.as);
    if (g.awayStarter) (stRuns.get(g.awayStarter) ?? stRuns.set(g.awayStarter, []).get(g.awayStarter)!).push(g.hs);
    runSum += g.hs + g.as; runN += 2;

    const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
    const sc = g.hs === g.as ? 0.5 : g.hs > g.as ? 1 : 0;
    elo.set(g.home, eh + ELO.k * (sc - exp));
    elo.set(g.away, ea + ELO.k * (exp - sc));
    played.set(g.home, (played.get(g.home) ?? 0) + 1);
    played.set(g.away, (played.get(g.away) ?? 0) + 1);
  }
  return out;
}

// 최소제곱 (정규방정식). 피처 수가 적어 가우스 소거로 충분하다.
function ols(X: number[][], y: number[]): number[] {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) A[a][b] += X[i][a] * X[i][b];
      A[a][p] += X[i][a] * y[i];
    }
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-10) continue;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => (Math.abs(row[i]) < 1e-10 ? 0 : row[p] / row[i]));
}

const r2 = (yTrue: number[], yPred: number[]) => {
  const m = yTrue.reduce((s, v) => s + v, 0) / yTrue.length;
  const ss = yTrue.reduce((s, v, i) => s + (v - yPred[i]) ** 2, 0);
  const tt = yTrue.reduce((s, v) => s + (v - m) ** 2, 0);
  return 1 - ss / tt;
};

function main() {
  const path = LEAGUE === "KBO" ? "seed/kbo_games.json" : "seed/mlb_games.json";
  const rows: G[] = JSON.parse(readFileSync(path, "utf8"));
  const feats = build(rows);
  const withSt = feats.filter((f) => f.homeSt !== null && f.awaySt !== null);
  console.log(`${LEAGUE}: 원본 ${rows.length}경기 -> 피처 ${feats.length}건, 선발 양쪽 확보 ${withSt.length}건 (${(withSt.length / feats.length * 100).toFixed(1)}%)`);
  if (withSt.length < 500) { console.log("선발 확보 표본이 500건 미만 - 판정하지 않는다"); return; }

  console.log(`\n${"=".repeat(74)}\nA. 고리2 - 선발을 넣으면 총득점 예측이 나아지는가 (4분할 test R^2)\n${"=".repeat(74)}`);
  const baseF = (f: Feat) => [1, f.homeOff, f.awayOff, f.homeDef, f.awayDef];
  const stF = (f: Feat) => [1, f.homeOff, f.awayOff, f.homeDef, f.awayDef, f.homeSt!, f.awaySt!];
  let r2base: number[] = [], r2st: number[] = [];
  for (const frac of SPLITS) {
    const cut = Math.floor(withSt.length * frac);
    const tr = withSt.slice(0, cut), te = withSt.slice(cut);
    const yTr = tr.map((f) => f.total), yTe = te.map((f) => f.total);
    const bB = ols(tr.map(baseF), yTr), bS = ols(tr.map(stF), yTr);
    const pB = te.map((f) => baseF(f).reduce((s, x, i) => s + x * bB[i], 0));
    const pS = te.map((f) => stF(f).reduce((s, x, i) => s + x * bS[i], 0));
    const a = r2(yTe, pB), b = r2(yTe, pS);
    r2base.push(a); r2st.push(b);
    console.log(`  분할 ${frac}: 팀지표만 R^2 ${(a * 100).toFixed(2)}%  ->  +선발 R^2 ${(b * 100).toFixed(2)}%   ${b > a ? "개선" : "악화"}`);
  }
  const avgB = r2base.reduce((s, v) => s + v, 0) / 4, avgS = r2st.reduce((s, v) => s + v, 0) / 4;
  console.log(`  평균 ${(avgB * 100).toFixed(2)}% -> ${(avgS * 100).toFixed(2)}%  (증분 ${((avgS - avgB) * 100).toFixed(2)}%p)`);

  console.log(`\n${"=".repeat(74)}\nB. 고리1+2 - "1"을 예측할 수 있는가. 답은 산수에서 나온다\n${"=".repeat(74)}`);
  {
    // 처음에 총득점을 예측해 P(1)을 붙이려 했더니 train 표가 '4점 0% / 6점 0% / 8점 0%'로
    // 나왔다. 버그가 아니라 산수다 - 총득점과 점수차는 홀짝이 같으므로 총득점이 짝수면
    // 1점차가 나올 수 없다. 실측으로도 정확히 0건이다.
    const nz = feats.filter((f) => f.margin !== 0);
    const odd = nz.filter((f) => f.total % 2 === 1);
    const even = nz.filter((f) => f.total % 2 === 0);
    const isOne = (f: Feat) => Math.abs(f.margin) === 1;
    console.log(`  총득점 홀수 ${odd.length}건 중 1점차 ${odd.filter(isOne).length} (${(odd.filter(isOne).length / odd.length * 100).toFixed(1)}%)`);
    console.log(`  총득점 짝수 ${even.length}건 중 1점차 ${even.filter(isOne).length} (${(even.filter(isOne).length / even.length * 100).toFixed(1)}%)  <- 구조적으로 0이다`);
    console.log(`  즉 P(1) = P(총득점 홀수) x P(1 | 홀수) 로 갈라진다. 뒤쪽은 고리1이라 예측되지만,`);
    console.log(`  앞쪽이 예측되지 않으면 P(1)의 절반은 동전던지기에 걸려 있는 셈이다.`);

    // 홀짝을 예측할 수 있는가. 우리가 가진 피처로 홀수 확률이 움직이는지 본다.
    const cut = Math.floor(withSt.length * 0.7);
    const tr = withSt.slice(0, cut), te = withSt.slice(cut).filter((f) => f.margin !== 0);
    const b = ols(tr.map(stF), tr.map((f) => f.total));
    const rows2 = te.map((f) => ({
      pred: stF(f).reduce((s, x, i) => s + x * b[i], 0),
      odd: f.total % 2 === 1 ? 1 : 0,
    })).sort((x, y) => x.pred - y.pred);
    const k = 5, n = rows2.length;
    console.log(`\n  예측 총득점 5분위별 실제 '홀수' 비율 (test n=${n}) - 여기가 평평하면 홀짝은 예측 불가다:`);
    for (let i = 0; i < k; i++) {
      const seg = rows2.slice(Math.floor(n * i / k), Math.floor(n * (i + 1) / k));
      console.log(`    예측총득점 ${seg[0].pred.toFixed(2)}~${seg.at(-1)!.pred.toFixed(2)}  홀수 ${(seg.reduce((s, r) => s + r.odd, 0) / seg.length * 100).toFixed(1)}%  (n=${seg.length})`);
    }
    const base = rows2.reduce((s, r) => s + r.odd, 0) / n;
    console.log(`    전체 홀수 비율 ${(base * 100).toFixed(1)}%`);
    console.log(`\n  참고: 프로토가 파는 '야구 SUM(홀짝)' 배당은 1.59 / 2.07 이었다.`);
    console.log(`  오버라운드를 제거하면 56.6% / 43.4%로, 실제 홀수 비율과 사실상 같다.`);
    console.log(`  북메이커도 홀짝은 예측하지 않고 기저확률로만 매긴다는 뜻이다.`);
  }

  console.log(`\n${"=".repeat(74)}\nC. 승패 2택 - 선발이 Elo 모델을 개선하는가 (4분할, 적중률 포함)\n${"=".repeat(74)}`);
  {
    const GRID = [0, 5, 10, 20, 40, 80, 160];
    let pass = 0;
    for (const frac of SPLITS) {
      const cut = Math.floor(withSt.length * frac);
      const tr = withSt.slice(0, cut), te = withSt.slice(cut);
      // 선발 격차를 Elo 점수로 환산해 더한다. 원정 선발이 나쁠수록 홈에 유리하므로 부호는 (away - home).
      const pOf = (f: Feat, w: number) => 1 / (1 + Math.pow(10, -(f.eloDiff + ELO.ha + w * (f.awaySt! - f.homeSt!)) / 400));
      const ll = (arr: Feat[], w: number) => arr.reduce((s, f) => {
        const p = Math.min(0.999, Math.max(0.001, pOf(f, w)));
        return s - (f.homeWin ? Math.log(p) : Math.log(1 - p));
      }, 0) / arr.length;
      const acc = (arr: Feat[], w: number) => arr.filter((f) => ((pOf(f, w) >= 0.5 ? 1 : 0) === f.homeWin)).length / arr.length;
      let best = { w: 0, ll: Infinity };
      for (const w of GRID) { const v = ll(tr, w); if (v < best.ll) best = { w, ll: v }; }
      const ok = acc(te, best.w) >= acc(te, 0) && ll(te, best.w) <= ll(te, 0);
      if (ok) pass++;
      console.log(`  분할 ${frac}: 선택 w=${best.w}  적중 ${(acc(te, 0) * 100).toFixed(2)}% -> ${(acc(te, best.w) * 100).toFixed(2)}%  로그손실 ${ll(te, 0).toFixed(4)} -> ${ll(te, best.w).toFixed(4)}  ${ok ? "통과" : "미달"}`);
    }
    console.log(`  ${pass}/4 통과 -> ${pass === 4 ? "선발을 승패 모델에 넣을 근거가 있다" : "채택 기준 미달"}`);
  }

  marketOverlap();
}

// C에서 선발이 통과해도 그걸로 끝이 아니다. 배포되는 KBO 모델은 배당을 0.8로 섞어 쓰는데,
// 배당은 이미 선발투수를 반영하고 있을 게 거의 확실하다. 그러면 선발의 '증분' 기여는
// 사라진다. 축구에서 최근폼·H2H가 딱 그랬다 - 단독으로는 상관이 있는데 Elo와 겹쳐서
// 증분이 0이었다. 그래서 블렌딩 위에서 다시 잰다.
function marketOverlap() {
  console.log(`\n${"=".repeat(74)}\nD. 배당 블렌딩 위에서도 선발이 남는가 (배포 구성에서의 증분)\n${"=".repeat(74)}`);
  let odds: any[];
  try {
    odds = JSON.parse(readFileSync("seed/proto_baseball_odds.json", "utf8"));
  } catch {
    console.log("  배당 파일이 없어 건너뛴다");
    return;
  }
  const W = LEAGUE === "KBO" ? 0.8 : 0;
  if (W === 0) { console.log(`  ${LEAGUE}는 배당을 안 쓰므로(w=0) C가 곧 배포 구성이다.`); return; }

  const path = LEAGUE === "KBO" ? "seed/kbo_games.json" : "seed/mlb_games.json";
  const rows: G[] = JSON.parse(readFileSync(path, "utf8"));
  const feats = build(rows);
  const byKey = new Map(feats.map((f) => [`${f.date}|${(f as any).home}|${(f as any).away}`, f]));
  // build()가 팀명을 안 들고 있으므로 원본과 같은 순서로 다시 붙인다.
  const keyed = new Map<string, Feat>();
  {
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let i = 0;
    for (const g of sorted) {
      const f = feats[i];
      if (f && f.date === g.date && f.total === g.hs + g.as && f.margin === g.hs - g.as) {
        keyed.set(`${g.date}|${g.home}|${g.away}`, f);
        i++;
      }
    }
  }

  const items: Array<{ date: string; pm: number; f: Feat }> = [];
  for (const o of odds) {
    if (o.league !== LEAGUE) continue;
    if (!(o.winAllot > 1 && o.loseAllot > 1)) continue;
    const kp = String(o.gameKey).split(":");
    if (kp.length !== 2) continue;
    const f = keyed.get(`${o.date}|${kp[0]}|${kp[1]}`);
    if (!f || f.homeSt === null || f.awaySt === null || f.margin === 0) continue;
    const ia = 1 / o.winAllot, ib = 1 / o.loseAllot;
    items.push({ date: o.date, pm: ia / (ia + ib), f });
  }
  console.log(`  조인 ${items.length}건 (배당 + 선발 둘 다 있는 경기)`);
  if (items.length < 100) { console.log("  100건 미만 - 판정하지 않는다"); return; }

  const pOf = (x: typeof items[number], w: number) => {
    const pe = 1 / (1 + Math.pow(10, -(x.f.eloDiff + ELO.ha + w * (x.f.awaySt! - x.f.homeSt!)) / 400));
    return W * x.pm + (1 - W) * pe;
  };
  const acc = (arr: typeof items, w: number) => arr.filter((x) => ((pOf(x, w) >= 0.5 ? 1 : 0) === x.f.homeWin)).length / arr.length;
  const ll = (arr: typeof items, w: number) => arr.reduce((s, x) => {
    const p = Math.min(0.999, Math.max(0.001, pOf(x, w)));
    return s - (x.f.homeWin ? Math.log(p) : Math.log(1 - p));
  }, 0) / arr.length;

  let pass = 0, n = 0;
  for (const frac of SPLITS) {
    const cut = Math.floor(items.length * frac);
    const tr = items.slice(0, cut), te = items.slice(cut);
    if (tr.length < 60 || te.length < 40) { console.log(`  분할 ${frac}: 표본 부족 - 건너뜀`); continue; }
    n++;
    let best = { w: 0, ll: Infinity };
    for (const w of [0, 5, 10, 20, 40, 80, 160]) { const v = ll(tr, w); if (v < best.ll) best = { w, ll: v }; }
    const ok = acc(te, best.w) >= acc(te, 0) && ll(te, best.w) <= ll(te, 0);
    if (ok) pass++;
    console.log(`  분할 ${frac}: 선택 w=${best.w}  적중 ${(acc(te, 0) * 100).toFixed(2)}% -> ${(acc(te, best.w) * 100).toFixed(2)}%  로그손실 ${ll(te, 0).toFixed(4)} -> ${ll(te, best.w).toFixed(4)}  ${ok ? "통과" : "미달"}`);
  }
  if (n) console.log(`  ${pass}/${n} 통과 -> ${pass === n ? "배당 위에서도 선발이 증분을 준다. 채택 근거가 된다" : "배당이 이미 선발을 반영한다. 증분이 없으므로 넣지 않는다"}`);
}

main();
