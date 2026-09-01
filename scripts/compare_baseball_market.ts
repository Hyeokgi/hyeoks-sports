// 야구: 프로토 배당 단독 vs 우리 Elo 모델. 축구 절제 사다리의 A vs E를 야구로 옮긴 것이다.
//
// 왜 이게 결정적인가
//   backtest_baseball.ts가 낸 KBO 4/4, MLB 4/4는 '무조건 홈' 대비다. 축구에서는 그 기준을
//   통과하고도 배당 단독이 우리 전체 모델을 이겼다(E->A 로그손실 -0.0272, 적중률 약 2%p).
//   배당이 야구에서도 이기면 모델을 얹을 이유가 없고, 우리가 이기면 그때 조합을 만들 근거가 생긴다.
//
// 순환이 없다
//   Elo 하이퍼파라미터(K, 시즌회귀, 홈어드밴티지)는 2023~2025로 고른 값을 그대로 쓰고,
//   평가는 2026 경기에서만 한다. 배당은 우리가 고른 게 아니라 주어진 값이다.
//   그래서 여기서는 4분할을 다시 나누지 않는다 - 이 창 자체가 이미 out-of-sample이다.
//
// 조인
//   프로토는 팀명을 '뉴욕양키'처럼 4자로 줄여 쓰고 우리 MLB 데이터는 영문 정식명이다.
//   한글-영문 대응표를 내가 손으로 적으면 30개를 추측하는 셈이라, (날짜, 스코어)로 후보를
//   맞춘 뒤 표를 데이터에서 학습하고 일관성을 검증한다. KBO는 표기가 같아 바로 붙는다.
//   mchScore가 home:away인지 away:home인지도 가정하지 않고 양쪽을 다 재서 맞는 쪽을 고른다.
//
// 실행: npx tsx scripts/compare_baseball_market.ts
import { readFileSync } from "node:fs";

// backtest_baseball.ts가 2023~2025 마지막 분할에서 고른 값. 여기서 다시 고르지 않는다.
const PARAMS: Record<string, { k: number; reg: number }> = {
  KBO: { k: 4, reg: 0 },
  MLB: { k: 6, reg: 0.25 },
};
const WARMUP = 20;
const EVAL_FROM = "2026-01-01"; // 이 날짜 이후만 평가. 그 전은 Elo를 데우는 데만 쓴다

interface Seed { date: string; home: string; away: string; hs: number; as: number }
interface Odds {
  gameKey: string; date: string; league: string; home: string; away: string;
  score: string | null; winAllot: number; loseAllot: number;
  s1WinAllot: number; s1DrawAllot: number; s1LoseAllot: number;
}

const load = <T,>(p: string): T[] => JSON.parse(readFileSync(p, "utf8"));
const seasonOf = (d: string) => Number(d.slice(0, 4));

// 시간순 Elo. 각 경기의 '경기 전' 격차와 그 시점의 소화 경기수를 기록한다.
function eloTimeline(rows: Seed[], k: number, reg: number) {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const elo = new Map<string, number>();
  const played = new Map<string, number>();
  let season = seasonOf(sorted[0].date);
  const out = new Map<string, { diff: number; warm: boolean; g: Seed }>();

  for (const r of sorted) {
    const s = seasonOf(r.date);
    if (s !== season) {
      for (const [t, v] of elo) elo.set(t, 1500 + (v - 1500) * (1 - reg));
      season = s;
    }
    const eh = elo.get(r.home) ?? 1500;
    const ea = elo.get(r.away) ?? 1500;
    const warm = (played.get(r.home) ?? 0) >= WARMUP && (played.get(r.away) ?? 0) >= WARMUP;
    out.set(`${r.date}|${r.home}|${r.away}`, { diff: eh - ea, warm, g: r });

    const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
    const score = r.hs === r.as ? 0.5 : r.hs > r.as ? 1 : 0;
    elo.set(r.home, eh + k * (score - exp));
    elo.set(r.away, ea + k * (exp - score));
    played.set(r.home, (played.get(r.home) ?? 0) + 1);
    played.set(r.away, (played.get(r.away) ?? 0) + 1);
  }
  return out;
}

// 홈어드밴티지: 2026 이전 경기에서만 추정한다.
function estimateHA(rows: Seed[], tl: ReturnType<typeof eloTimeline>): number {
  const pre = rows.filter((r) => r.date < EVAL_FROM && r.hs !== r.as);
  const warm = pre.filter((r) => tl.get(`${r.date}|${r.home}|${r.away}`)?.warm);
  if (warm.length < 100) return 0;
  const pHome = warm.filter((r) => r.hs > r.as).length / warm.length;
  const meanDiff = warm.reduce((s, r) => s + (tl.get(`${r.date}|${r.home}|${r.away}`)!.diff), 0) / warm.length;
  return -400 * Math.log10(1 / pHome - 1) - meanDiff;
}

// 한글 축약 -> 우리 데이터 팀명. (날짜, 스코어)로 후보를 맞춘 뒤 다수결로 학습한다.
function learnNameMap(odds: Odds[], seed: Seed[], scoreIsHomeFirst: boolean) {
  const byDate = new Map<string, Seed[]>();
  for (const g of seed) (byDate.get(g.date) ?? byDate.set(g.date, []).get(g.date)!).push(g);
  const votes = new Map<string, Map<string, number>>();
  const vote = (kr: string, en: string) => {
    const m = votes.get(kr) ?? new Map<string, number>();
    m.set(en, (m.get(en) ?? 0) + 1);
    votes.set(kr, m);
  };
  for (const o of odds) {
    if (!o.score || !/^\d+:\d+$/.test(o.score)) continue;
    const [a, b] = o.score.split(":").map(Number);
    const [hs, as_] = scoreIsHomeFirst ? [a, b] : [b, a];
    const cands = (byDate.get(o.date) ?? []).filter((g) => g.hs === hs && g.as === as_);
    if (cands.length !== 1) continue; // 애매하면 표를 주지 않는다
    vote(o.home, cands[0].home);
    vote(o.away, cands[0].away);
  }
  const map = new Map<string, string>();
  for (const [kr, m] of votes) {
    const tot = [...m.values()].reduce((s, n) => s + n, 0);
    const [en, n] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
    if (n >= 3 && n / tot >= 0.6) map.set(kr, en);
  }
  return map;
}

const devig2 = (a: number, b: number) => {
  const ia = 1 / a, ib = 1 / b;
  return ia / (ia + ib);
};

interface M { n: number; acc: number; brier: number; logloss: number; ece: number }
function metrics(items: Array<{ p: number; y: 0 | 1 }>): M {
  let hit = 0, br = 0, ll = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const { p, y } of items) {
    const q = Math.min(0.999, Math.max(0.001, p));
    if ((q >= 0.5 ? 1 : 0) === y) hit++;
    br += (q - y) ** 2;
    ll += -(y ? Math.log(q) : Math.log(1 - q));
    const b = bins[Math.min(9, Math.floor(q * 10))];
    b.n++; b.p += q; b.y += y;
  }
  const n = items.length || 1;
  const ece = bins.reduce((s, b) => (b.n ? s + (b.n / n) * Math.abs(b.p / b.n - b.y / b.n) : s), 0);
  return { n: items.length, acc: hit / n, brier: br / n, logloss: ll / n, ece };
}
const fmt = (m: M) => `n=${m.n} 적중 ${(m.acc * 100).toFixed(2)}% Brier ${m.brier.toFixed(4)} 로그손실 ${m.logloss.toFixed(4)} ECE ${m.ece.toFixed(4)}`;

// McNemar - 두 방식의 적중/실패가 갈린 경기만 세서 차이가 우연인지 본다.
function mcnemar(aHit: boolean[], bHit: boolean[]) {
  let a = 0, b = 0;
  for (let i = 0; i < aHit.length; i++) {
    if (aHit[i] && !bHit[i]) a++;
    else if (!aHit[i] && bHit[i]) b++;
  }
  const n = a + b;
  if (n < 10) return { a, b, z: 0, note: "표본 부족 - 판정 불가" };
  const z = (Math.abs(a - b) - 1) / Math.sqrt(n);
  const p = 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
  return { a, b, z, note: `p ≈ ${p.toFixed(3)}` };
}
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

function runLeague(name: string, seed: Seed[], odds: Odds[]) {
  console.log("\n" + "=".repeat(78));
  console.log(`${name}`);
  console.log("=".repeat(78));
  const { k, reg } = PARAMS[name];
  const tl = eloTimeline(seed, k, reg);
  const ha = estimateHA(seed, tl);
  console.log(`Elo 파라미터 K=${k} 시즌회귀=${reg} (2023~2025에서 고른 값), 홈어드밴티지 ${ha.toFixed(1)}점 (2026 이전에서만 추정)`);

  // 조인 키 만들기
  let map = new Map<string, string>();
  let scoreHomeFirst = true;
  if (name === "MLB") {
    const m1 = learnNameMap(odds, seed, true);
    const m2 = learnNameMap(odds, seed, false);
    scoreHomeFirst = m1.size >= m2.size;
    map = scoreHomeFirst ? m1 : m2;
    console.log(`팀명 대응 학습: home:away 가정 ${m1.size}개 / away:home 가정 ${m2.size}개 -> ${scoreHomeFirst ? "home:away" : "away:home"} 채택, ${map.size}개 확정`);
    if (map.size < 20) console.log(`  ** 30개 팀 중 ${map.size}개만 확정됐다. 조인이 얇으므로 아래 결과를 신뢰하기 어렵다`);
  }
  const toSeedName = (kr: string) => (name === "MLB" ? map.get(kr) ?? "" : kr);

  const market: Array<{ p: number; y: 0 | 1 }> = [];
  const model: Array<{ p: number; y: 0 | 1 }> = [];
  const base: Array<{ p: number; y: 0 | 1 }> = [];
  const mHit: boolean[] = [], eHit: boolean[] = [];
  const blends = [0.2, 0.4, 0.6, 0.8].map((w) => ({ w, xs: [] as Array<{ p: number; y: 0 | 1 }> }));
  let noJoin = 0, noWarm = 0, tie = 0, noOdds = 0;

  const preHome = seed.filter((r) => r.date < EVAL_FROM && r.hs !== r.as);
  const pFixed = preHome.filter((r) => r.hs > r.as).length / preHome.length;

  for (const o of odds) {
    if (o.league !== name) continue;
    if (!(o.winAllot > 0 && o.loseAllot > 0)) { noOdds++; continue; }
    const h = toSeedName(o.home), a = toSeedName(o.away);
    const rec = h && a ? tl.get(`${o.date}|${h}|${a}`) : undefined;
    if (!rec) { noJoin++; continue; }
    if (!rec.warm) { noWarm++; continue; }
    if (rec.g.hs === rec.g.as) { tie++; continue; }
    const y: 0 | 1 = rec.g.hs > rec.g.as ? 1 : 0;

    const pm = devig2(o.winAllot, o.loseAllot);
    const pe = 1 / (1 + Math.pow(10, -(rec.diff + ha) / 400));
    market.push({ p: pm, y });
    model.push({ p: pe, y });
    base.push({ p: pFixed, y });
    mHit.push((pm >= 0.5 ? 1 : 0) === y);
    eHit.push((pe >= 0.5 ? 1 : 0) === y);
    for (const b of blends) b.xs.push({ p: b.w * pm + (1 - b.w) * pe, y });
  }

  console.log(`조인: 평가 ${market.length}건 (배당없음 ${noOdds} / 결과데이터 없음 ${noJoin} / 워밍업 전 ${noWarm} / 무승부 ${tie})`);
  if (market.length < 100) {
    console.log(`** 100건 미만이다. 이 표본으로는 배당과 모델의 우열을 판정하지 않는다.`);
    return;
  }
  console.log(`\n  A 배당만    ${fmt(metrics(market))}`);
  console.log(`  E 모델만    ${fmt(metrics(model))}`);
  console.log(`  기준 무조건홈 ${fmt(metrics(base))}  (2026 이전 홈승률 ${(pFixed * 100).toFixed(2)}% 고정)`);
  for (const b of blends) console.log(`  F 블렌딩 w=${b.w.toFixed(1)}  ${fmt(metrics(b.xs))}`);

  const mm = metrics(market), me = metrics(model);
  const d = mm.logloss - me.logloss;
  console.log(`\n  A - E 로그손실 차이 ${d.toFixed(4)}  -> ${d < 0 ? "배당이 낫다" : "우리 모델이 낫다"}`);
  const mc = mcnemar(mHit, eHit);
  console.log(`  McNemar: 배당만 맞힌 경기 ${mc.a} / 모델만 맞힌 경기 ${mc.b}  ${mc.note}`);
}

function main() {
  const kbo = load<Seed>("seed/kbo_games.json");
  const mlb = load<Seed>("seed/mlb_games.json");
  const odds = load<Odds>("seed/proto_baseball_odds.json");
  console.log(`배당 ${odds.length}건 (${odds[0].date} ~ ${odds.at(-1)!.date})`);
  const byL = new Map<string, number>();
  for (const o of odds) byL.set(o.league, (byL.get(o.league) ?? 0) + 1);
  console.log(`리그: ${[...byL.entries()].map(([k, n]) => `${k} ${n}`).join(" / ")}`);
  console.log(`(NPB는 우리 데이터가 없어 비교 대상이 아니다)`);
  runLeague("KBO", kbo, odds);
  runLeague("MLB", mlb, odds);
}

main();
