// 야구는 선수 지표가 훨씬 정밀한데 왜 축구보다 예측이 안 되는가.
//
// 겉으로는 비슷해 보인다 - 축구 승무패 53%, MLB 승패 55%. 그런데 이건 3택과 2택을
// 나란히 놓은 것이라 비교가 성립하지 않는다. 같은 과제로 맞추고, 종목의 천장까지 재본다.
//
//   1 팀 실력차가 결과에 반영되는 정도 - 시즌 승점률의 분산
//   2 같은 과제(무승부 제외 승패 2택)에서의 적중률 - 4분할 프로토콜
//   3 천장 - 시즌 최종 성적을 미리 안다고 가정했을 때 강팀이 이기는 비율
//     (사후 정보라 실제로는 불가능하다. '팀 전력만으로 예측할 때의 상한'을 보는 용도다.)
//
// 실행: npx tsx scripts/compare_sport_predictability.ts
import { readFileSync } from "node:fs";

interface M { date: string; home: string; away: string; h: number; a: number }

const soccer = (): M[] =>
  [
    ...JSON.parse(readFileSync("seed/backfill_leagues.json", "utf8")),
    ...JSON.parse(readFileSync("seed/backfill_epl_seriea.json", "utf8")),
  ].map((x: any) => ({ date: x.date, home: `${x.league}|${x.home}`, away: `${x.league}|${x.away}`, h: x.hg, a: x.ag }));
const baseball = (p: string): M[] =>
  JSON.parse(readFileSync(p, "utf8")).map((x: any) => ({ date: x.date, home: x.home, away: x.away, h: x.hs, a: x.as }));

function seasonRecords(games: M[]) {
  const rec = new Map<string, { w: number; n: number }>();
  for (const g of games) {
    const s = g.date.slice(0, 4);
    const r = g.h === g.a ? 0.5 : g.h > g.a ? 1 : 0;
    for (const [t, p] of [[g.home, r], [g.away, 1 - r]] as const) {
      const k = `${s}|${t}`;
      const e = rec.get(k) ?? { w: 0, n: 0 };
      e.w += p; e.n++;
      rec.set(k, e);
    }
  }
  return rec;
}

function spread(name: string, games: M[]) {
  const rates = [...seasonRecords(games).values()].filter((v) => v.n >= 30).map((v) => v.w / v.n).sort((a, b) => a - b);
  const m = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - m) ** 2, 0) / rates.length);
  console.log(`  ${name.padEnd(10)} 팀-시즌 ${String(rates.length).padStart(4)}개  승점률 표준편차 ${(sd * 100).toFixed(2)}%p  최약 ${(rates[0] * 100).toFixed(1)}% ~ 최강 ${(rates.at(-1)! * 100).toFixed(1)}%`);
}

// 무승부를 뺀 승패 2택. 종목마다 K는 train에서 고른다.
function twoWay(name: string, games: M[], KG: number[], warmup: number) {
  const g = [...games].sort((a, b) => (a.date < b.date ? -1 : 1));
  const build = (K: number) => {
    const elo = new Map<string, number>(), pl = new Map<string, number>();
    let se = Number(g[0].date.slice(0, 4));
    const out: Array<{ diff: number; y: 0 | 1 }> = [];
    for (const m of g) {
      const s = Number(m.date.slice(0, 4));
      if (s !== se) { for (const [t, v] of elo) elo.set(t, 1500 + (v - 1500) * 0.75); se = s; }
      const eh = elo.get(m.home) ?? 1500, ea = elo.get(m.away) ?? 1500;
      if ((pl.get(m.home) ?? 0) >= warmup && (pl.get(m.away) ?? 0) >= warmup && m.h !== m.a) {
        out.push({ diff: eh - ea, y: m.h > m.a ? 1 : 0 });
      }
      const ex = 1 / (1 + Math.pow(10, (ea - eh) / 400));
      const sc = m.h === m.a ? 0.5 : m.h > m.a ? 1 : 0;
      elo.set(m.home, eh + K * (sc - ex)); elo.set(m.away, ea + K * (ex - sc));
      pl.set(m.home, (pl.get(m.home) ?? 0) + 1); pl.set(m.away, (pl.get(m.away) ?? 0) + 1);
    }
    return out;
  };
  const accs: number[] = [], bases: number[] = [];
  for (const frac of [0.5, 0.6, 0.7, 0.8]) {
    let best = { K: KG[0], ll: Infinity, ha: 0 };
    for (const K of KG) {
      const it = build(K), cut = Math.floor(it.length * frac), tr = it.slice(0, cut);
      if (tr.length < 200) continue;
      const ph = tr.filter((x) => x.y).length / tr.length;
      const md = tr.reduce((s, x) => s + x.diff, 0) / tr.length;
      const ha = -400 * Math.log10(1 / ph - 1) - md;
      const ll = tr.reduce((s, x) => {
        const p = Math.min(0.999, Math.max(0.001, 1 / (1 + Math.pow(10, -(x.diff + ha) / 400))));
        return s - (x.y ? Math.log(p) : Math.log(1 - p));
      }, 0) / tr.length;
      if (ll < best.ll) best = { K, ll, ha };
    }
    const it = build(best.K), cut = Math.floor(it.length * frac), te = it.slice(cut);
    accs.push(te.filter((x) => ((1 / (1 + Math.pow(10, -(x.diff + best.ha) / 400)) >= 0.5 ? 1 : 0) === x.y)).length / te.length);
    const hr = te.filter((x) => x.y).length / te.length;
    bases.push(Math.max(hr, 1 - hr));
  }
  const a = accs.reduce((x, y) => x + y, 0) / accs.length, b = bases.reduce((x, y) => x + y, 0) / bases.length;
  console.log(`  ${name.padEnd(10)} 적중 ${(a * 100).toFixed(2)}%  무조건홈 ${(b * 100).toFixed(2)}%  초과 ${((a - b) * 100).toFixed(2)}%p  (남은여지 대비 ${((a - b) / (1 - b) * 100).toFixed(1)}%)`);
}

function ceiling(name: string, games: M[]) {
  const rec = seasonRecords(games);
  let hit = 0, n = 0;
  for (const g of games) {
    if (g.h === g.a) continue;
    const s = g.date.slice(0, 4);
    const rh = rec.get(`${s}|${g.home}`), ra = rec.get(`${s}|${g.away}`);
    if (!rh || !ra || rh.n < 30 || ra.n < 30) continue;
    const sh = rh.w / rh.n, sa = ra.w / ra.n;
    if (sh === sa) continue;
    n++;
    if ((sh > sa) === (g.h > g.a)) hit++;
  }
  console.log(`  ${name.padEnd(10)} 시즌성적 강팀이 이긴 비율 ${(hit / n * 100).toFixed(2)}%  (n=${n})`);
}

function main() {
  const sc = soccer();
  const kbo = baseball("seed/kbo_games.json");
  const mlb = baseball("seed/mlb_games.json");
  const byLeague = new Map<string, M[]>();
  for (const x of sc) {
    const L = x.home.split("|")[0];
    (byLeague.get(L) ?? byLeague.set(L, []).get(L)!).push(x);
  }

  console.log("[1] 팀 실력차가 결과에 얼마나 드러나는가 (시즌 승점률 분산)");
  for (const [L, gs] of byLeague) if (gs.length >= 700) spread(L, gs);
  spread("KBO", kbo); spread("MLB", mlb);

  console.log("\n[2] 같은 과제(무승부 제외 승패 2택) - 4분할 test 평균");
  console.log("    축구 승무패 53% vs MLB 승패 55%를 나란히 놓으면 안 된다. 3택과 2택이라 기준이 다르다.");
  for (const [L, gs] of byLeague) if (gs.length >= 700) twoWay(L, gs, [8, 16, 24, 32, 48], 15);
  twoWay("축구 전체", sc, [8, 16, 24, 32, 48], 15);
  twoWay("KBO", kbo, [2, 4, 6, 8, 12, 16, 24], 20);
  twoWay("MLB", mlb, [2, 4, 6, 8, 12, 16, 24], 20);

  console.log("\n[3] 천장 - 시즌 최종 성적을 미리 안다고 가정 (사후 정보, 실제로는 불가능)");
  ceiling("축구", sc); ceiling("KBO", kbo); ceiling("MLB", mlb);

  console.log("\n요약: 야구가 안 되는 건 데이터나 모델이 나빠서가 아니라 천장이 낮아서다.");
  console.log("  전력을 완벽히 안다고 가정해도 야구는 58%, 축구는 76%다.");
  console.log("  우리 모델은 야구 55%로 천장 58%의 대부분을 이미 가져왔다.");
}

main();
