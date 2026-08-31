// KBO·MLB 승패 2택을 축구와 같은 프로토콜로 백테스트한다 (야구 3단계).
//
// 왜 승무패 하네스(scripts/lib/evalHarness.ts)를 그대로 못 쓰는가
//   그쪽은 결과가 홈승/무승부/원정승 3택이고 무승부 확률 모델(drawBase, absEloForDraw)이
//   구조에 박혀 있다. 야구 승패는 2택이고 무승부가 사실상 없다(MLB 0건, KBO 2,160경기 중 44건).
//   3택 하네스에 억지로 끼우면 무승부 항이 결과를 흔든다. 대신 프로토콜은 똑같이 맞춘다 -
//   시간순 4분할(0.5/0.6/0.7/0.8), train에서 하이퍼파라미터 선택, test에서만 평가,
//   지표는 적중률·Brier·로그손실·ECE.
//
// 데이터는 seed에 떨궈둔 것을 읽는다(fetch_kbo_history.ts / fetch_mlb_history.ts).
// 매번 긁으면 샌드박스에서 못 돌리고 재현도 안 된다.
//
// 누수 방지
//   - Elo는 경기 시간순으로만 갱신한다. 평가 시점의 Elo는 그 경기 이전 정보만 반영한다
//   - 팀당 WARMUP 경기를 채우기 전에는 평가에서 뺀다(초기 1500이 실력이 아니라 초기값이라)
//   - 하이퍼파라미터는 train 구간의 로그손실로만 고른다
//
// 기준선을 반드시 같이 낸다. 야구 승패는 홈팀이 그냥 이기는 비율이 높아서(KBO 50.8%,
// MLB 약 53%) '무조건 홈'을 못 이기면 모델을 만든 의미가 없다. 축구에서 배당 단독이
// 우리 전체 모델을 이겼던 것과 같은 종류의 확인이다.
//
// 실행: npx tsx scripts/backtest_baseball.ts
import { readFileSync } from "node:fs";

const WARMUP = 20;
const SPLITS = [0.5, 0.6, 0.7, 0.8];
const K_GRID = [2, 4, 6, 8, 12, 16, 24];
const REG_GRID = [0, 0.25, 0.5]; // 시즌 사이 평균 회귀

interface Raw { date: string; home: string; away: string; hs: number; as: number }
interface Item {
  league: string;
  date: string;
  eloDiff: number;   // 홈 - 원정 (홈어드밴티지 제외)
  homeWin: 0 | 1;
  tie: boolean;
  margin: number;
}

function load(path: string, league: string): Array<Raw & { league: string }> {
  const rows: Raw[] = JSON.parse(readFileSync(path, "utf8"));
  return rows
    .map((r) => ({ ...r, league }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const seasonOf = (date: string) => Number(date.slice(0, 4));

// 시간순으로 Elo를 굴리며 각 경기의 '경기 전' 격차를 기록한다.
function buildItems(rows: Array<Raw & { league: string }>, k: number, reg: number): Item[] {
  const elo = new Map<string, number>();
  const played = new Map<string, number>();
  let season = seasonOf(rows[0].date);
  const out: Item[] = [];

  for (const r of rows) {
    const s = seasonOf(r.date);
    if (s !== season) {
      // 시즌이 바뀌면 평균으로 일부 회귀시킨다. 로스터가 바뀌므로 전 시즌 실력을
      // 그대로 이월하면 과신이 된다.
      for (const [t, v] of elo) elo.set(t, 1500 + (v - 1500) * (1 - reg));
      season = s;
    }
    const eh = elo.get(r.home) ?? 1500;
    const ea = elo.get(r.away) ?? 1500;
    const nh = played.get(r.home) ?? 0;
    const na = played.get(r.away) ?? 0;

    const tie = r.hs === r.as;
    if (nh >= WARMUP && na >= WARMUP) {
      out.push({
        league: r.league,
        date: r.date,
        eloDiff: eh - ea,
        homeWin: r.hs > r.as ? 1 : 0,
        tie,
        margin: r.hs - r.as,
      });
    }

    // Elo 갱신은 워밍업 여부와 무관하게 항상 한다. 갱신을 미루면 실력 추정이 늦어진다.
    const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
    const score = tie ? 0.5 : r.hs > r.as ? 1 : 0;
    elo.set(r.home, eh + k * (score - exp));
    elo.set(r.away, ea + k * (exp - score));
    played.set(r.home, nh + 1);
    played.set(r.away, na + 1);
  }
  return out;
}

const pHome = (eloDiff: number, ha: number) => 1 / (1 + Math.pow(10, -(eloDiff + ha) / 400));

interface Metrics { n: number; acc: number; brier: number; logloss: number; ece: number }

function evaluate(items: Item[], ha: number): Metrics {
  // 무승부는 승패 2택에서 정답이 없으므로 평가에서 뺀다. 몇 건인지는 호출부가 찍는다.
  const xs = items.filter((i) => !i.tie);
  let hit = 0, brier = 0, ll = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const i of xs) {
    const p = Math.min(0.999, Math.max(0.001, pHome(i.eloDiff, ha)));
    if ((p >= 0.5 ? 1 : 0) === i.homeWin) hit++;
    brier += (p - i.homeWin) ** 2;
    ll += -(i.homeWin ? Math.log(p) : Math.log(1 - p));
    const b = bins[Math.min(9, Math.floor(p * 10))];
    b.n++; b.p += p; b.y += i.homeWin;
  }
  const n = xs.length || 1;
  const ece = bins.reduce((s, b) => (b.n ? s + (b.n / n) * Math.abs(b.p / b.n - b.y / b.n) : s), 0);
  return { n: xs.length, acc: hit / n, brier: brier / n, logloss: ll / n, ece };
}

// 기준선: 무조건 홈. 확률은 train의 홈 승률을 그대로 쓴다.
function baselineHome(items: Item[], pFixed: number): Metrics {
  const xs = items.filter((i) => !i.tie);
  let hit = 0, brier = 0, ll = 0;
  for (const i of xs) {
    if (i.homeWin === 1) hit++;
    brier += (pFixed - i.homeWin) ** 2;
    ll += -(i.homeWin ? Math.log(pFixed) : Math.log(1 - pFixed));
  }
  const n = xs.length || 1;
  return { n: xs.length, acc: hit / n, brier: brier / n, logloss: ll / n, ece: 0 };
}

const fmt = (m: Metrics) =>
  `n=${m.n} 적중 ${(m.acc * 100).toFixed(2)}% Brier ${m.brier.toFixed(4)} 로그손실 ${m.logloss.toFixed(4)} ECE ${m.ece.toFixed(4)}`;

function runLeague(name: string, rows: Array<Raw & { league: string }>) {
  console.log("\n" + "=".repeat(78));
  console.log(`${name}  원본 ${rows.length}경기  ${rows[0].date} ~ ${rows.at(-1)!.date}`);
  console.log("=".repeat(78));

  const ties = rows.filter((r) => r.hs === r.as).length;
  const homeWins = rows.filter((r) => r.hs > r.as).length;
  console.log(`무승부 ${ties}건 (${(ties / rows.length * 100).toFixed(2)}%) - 승패 2택 평가에서 제외`);
  console.log(`전체 홈 승률 ${(homeWins / (rows.length - ties) * 100).toFixed(2)}% (무승부 제외 기준)`);

  const passes: boolean[] = [];
  let lastSplitAcc = 0;
  for (const frac of SPLITS) {
    // train/test 경계는 '원본 경기'의 시간순 비율로 자른다. 하이퍼파라미터마다
    // buildItems 결과 길이가 달라질 수 있으므로 날짜로 경계를 정해 동일하게 맞춘다.
    const cutDate = rows[Math.floor(rows.length * frac)].date;

    let best = { k: 0, reg: 0, ll: Infinity, ha: 0 };
    for (const k of K_GRID) {
      for (const reg of REG_GRID) {
        const items = buildItems(rows, k, reg);
        const tr = items.filter((i) => i.date < cutDate);
        if (tr.length < 200) continue;
        // 홈어드밴티지도 train에서만 추정한다. train 홈 승률을 Elo 스케일로 옮긴 값.
        const trNoTie = tr.filter((i) => !i.tie);
        const pHomeTrain = trNoTie.filter((i) => i.homeWin).length / trNoTie.length;
        const meanDiff = tr.reduce((s, i) => s + i.eloDiff, 0) / tr.length;
        const ha = -400 * Math.log10(1 / pHomeTrain - 1) - meanDiff;
        const m = evaluate(tr, ha);
        if (m.logloss < best.ll) best = { k, reg, ll: m.logloss, ha };
      }
    }

    const items = buildItems(rows, best.k, best.reg);
    const tr = items.filter((i) => i.date < cutDate);
    const te = items.filter((i) => i.date >= cutDate);
    const trNoTie = tr.filter((i) => !i.tie);
    const pFixed = trNoTie.filter((i) => i.homeWin).length / trNoTie.length;

    const mModel = evaluate(te, best.ha);
    const mBase = baselineHome(te, pFixed);
    const beats = mModel.acc > mBase.acc && mModel.logloss < mBase.logloss;
    passes.push(beats);

    console.log(`\n분할 ${frac}  (경계 ${cutDate})  선택 K=${best.k} 회귀=${best.reg} HA=${best.ha.toFixed(1)}점`);
    console.log(`  모델    ${fmt(mModel)}`);
    console.log(`  무조건홈 ${fmt(mBase)}  (train 홈승률 ${(pFixed * 100).toFixed(2)}% 고정)`);
    console.log(`  판정: ${beats ? "모델이 적중률·로그손실 모두 앞선다" : "기준선을 못 넘는다"}`);
    lastSplitAcc = mModel.acc;
  }

  const nPass = passes.filter(Boolean).length;
  const lastAcc = lastSplitAcc;
  console.log(`\n${name} 종합: 4분할 중 ${nPass}개 통과 -> ${nPass === 4 ? "채택 가능" : "채택 기준 미달"}`);
  console.log(`(기준은 축구와 동일하다 - 4분할 전부에서 적중률과 로그손실이 함께 개선돼야 한다.`);
  console.log(` 승패는 argmax 픽으로 돈이 오가므로 확률만 좋아지고 픽이 나빠지면 개선이 아니다.)`);
  return { nPass, lastAcc };
}

// 조합 기대값. 여기서 쓰는 적중률은 '가장 좋았던 분할'이 아니라 '마지막 분할'이다 -
// 우위 폭이 최근으로 갈수록 줄어들기 때문에 낙관적인 쪽을 쓰면 조합 확률이 부풀려진다.
//
// [정정] 앞 커밋에서 '2택은 복식이 경기를 확정시키므로 10만원이면 6경기를 확정할 수
// 있다'고 계산했는데, 그 계산의 전제인 '야구 14경기 승패 2택 토토 상품'은 존재하지 않는다.
// 상품 실측 결과(seed/baseball_products.txt):
//   야구토토 승1패(G024)  14경기 고정 슬레이트, 승/1/패 3택, 파리뮤추얼(확정배당 없음)
//   야구토토 스페셜 더블/트리플(G023/G017)  2~3경기
//   야구 매치(G034/G071)  현재 발매 회차 없음
//   프로토 승부식(G101)   야구 승패 2택에 확정배당이 붙는다(예: 1.48 / 2.17)
// 즉 야구 승패 2택은 프로토 승부식에만 있고, 거기서는 '확정' 개념이 성립하지 않는다 -
// 배당제라 양쪽을 다 사면 배당곱이 1 미만이 되어 확정적으로 손해다. 아래 확정 계산은
// 파리뮤추얼 고정 슬레이트에서만 유효하므로 참고용으로만 남긴다.
//
// 프로토 승부식에서 실제로 물어야 할 것은 확률이 아니라 기대값(p x 배당)이고, 그러려면
// 우리 모델이 그 배당을 이기는지부터 재야 한다. 축구에서는 배당 단독이 우리 전체 모델을
// 이겼다(절제 사다리 E->A 로그손실 -0.0272). 야구에서 같은 비교를 아직 안 했다 -
// 지금 낸 숫자는 '무조건 홈' 대비이지 '배당' 대비가 아니다.
function combinationOutlook(rows: Array<{ name: string; acc: number; ways: number }>) {
  const GAMES = 14;
  const UNITS = 100; // 10만원 / 1,000원. betman 회차당 1인 구매한도
  console.log("\n" + "=".repeat(78));
  console.log("조합 기대값 (14경기 기준, 마지막 분할 적중률 사용)");
  console.log("=".repeat(78));
  for (const r of rows) {
    const single = Math.pow(r.acc, GAMES);
    console.log(`\n${r.name}  적중률 ${(r.acc * 100).toFixed(2)}%  (${r.ways}택)`);
    console.log(`  단식 14경기 전부 적중: ${(single * 100).toFixed(4)}%  =  1/${Math.round(1 / single).toLocaleString()}`);
    if (r.ways !== 2) {
      console.log(`  (3택이라 복식이 경기를 확정시키지 못한다 - 아래 확정 계산은 2택에만 해당)`);
      continue;
    }
    console.log(`  [주의] 아래 '확정' 계산은 14경기 고정 슬레이트 파리뮤추얼을 가정한다.`);
    console.log(`         야구 승패 2택은 프로토 승부식(배당제)에만 있고 거기선 성립하지 않는다.`);
    for (let k = 0; Math.pow(2, k) <= UNITS; k++) {
      const p = Math.pow(r.acc, GAMES - k);
      console.log(`  확정 ${String(k).padStart(2)}경기(${String(Math.pow(2, k)).padStart(3)}구좌) -> 나머지 ${GAMES - k}경기 전부 적중 ${(p * 100).toFixed(3)}%  =  1/${Math.round(1 / p).toLocaleString()}`);
    }
  }
}

function main() {
  const kbo = load("seed/kbo_games.json", "KBO");
  const mlb = load("seed/mlb_games.json", "MLB");
  const a = runLeague("KBO", kbo);
  const b = runLeague("MLB", mlb);

  console.log("\n" + "=".repeat(78));
  console.log(`요약: KBO ${a.nPass}/4, MLB ${b.nPass}/4`);
  console.log("=".repeat(78));

  combinationOutlook([
    { name: "MLB 승패", acc: b.lastAcc, ways: 2 },
    { name: "KBO 승패", acc: a.lastAcc, ways: 2 },
    // 대조군. 앱이 지금 파는 축구 승무패의 같은 프로토콜 마지막 분할 값이다
    // (유럽 4대리그 marketWeight 0.8, 분할 0.8에서 53.20%).
    { name: "축구 승무패(대조, 유럽4 w=0.8)", acc: 0.5320, ways: 3 },
  ]);
}

main();
