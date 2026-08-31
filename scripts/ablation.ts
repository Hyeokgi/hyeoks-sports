// A~E 절제(ablation) 사다리: 지금 시스템에서 무엇이 실제로 예측력을 더하는가.
//
// 배경: DEFAULT_FORM_WEIGHT/H2H_WEIGHT는 "백테스트 상관계수 비율(Elo 0.40 : 폼 0.27 :
// H2H 0.23)"에서 도출했다. 그런데 단순 상관은 겹침을 그대로 다시 센다 - 폼도 H2H도
// 강팀이 좋으니 Elo와 상관이 있고, 그래서 셋 다 결과와 상관이 나온다. "Elo를 이미 쓴
// 뒤에도 추가 정보가 있는가"는 상관으로는 알 수 없고 빼고 넣어봐야 안다.
//
// arm (모두 같은 무승부 모델을 쓴다 - 강도 항 차이만 비교되도록)
//   A Market only        배당 암시확률 그대로
//   B Elo only           홈어드밴티지조차 없음
//   C Elo + 홈어드밴티지
//   D C + 최근폼
//   E D + H2H            = 현재 모델(배당 미반영)
//   F E + 배당 블렌딩 0.4 = 앱이 실제로 서비스하는 구성
//
// 전부 동일한 시간순 4분할 워크포워드로 평가한다. 지표는 적중률/Brier/로그손실/ECE.
// 데이터: football-data.co.uk (결과와 배당이 한 파일에 있어 조인이 필요 없다).
// 샌드박스에서 막혀 있어 GitHub Actions 러너에서 실행한다.
import {
  buildFeatures,
  toProbs,
  blend,
  evaluate,
  fmtMetrics,
  SPLITS,
  type Features,
  type Probs,
  type MarketProbs,
  type Metrics,
} from "./lib/evalHarness";
import { DEFAULT_FORM_WEIGHT, DEFAULT_H2H_WEIGHT, DEFAULT_MARKET_WEIGHT } from "../src/lib/prediction";
import type { MatchRow } from "../src/lib/elo";

const LEAGUES = [
  { league: "EPL", fdCode: "E0" },
  { league: "세리에A", fdCode: "I1" },
  { league: "라리가", fdCode: "SP1" },
  { league: "분데스리가", fdCode: "D1" },
];
const SEASONS = ["2324", "2425", "2526", "2627"];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
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

function parseFdDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[2]}-${m[1]}`;
}

function impliedProbs(oh: number, od: number, oa: number): MarketProbs | null {
  if (!(oh > 1 && od > 1 && oa > 1)) return null;
  const rh = 1 / oh, rd = 1 / od, ra = 1 / oa;
  const s = rh + rd + ra;
  if (!(s > 1.0) || s > 1.5) return null;
  return { pHome: rh / s, pDraw: rd / s, pAway: ra / s };
}

const ODDS_SETS: [string, string, string][] = [
  ["AvgCH", "AvgCD", "AvgCA"],
  ["B365CH", "B365CD", "B365CA"],
  ["AvgH", "AvgD", "AvgA"],
  ["B365H", "B365D", "B365A"],
];

async function load(): Promise<{ rows: MatchRow[]; odds: Map<string, MarketProbs> }> {
  const rows: MatchRow[] = [];
  const odds = new Map<string, MarketProbs>();
  for (const { league, fdCode } of LEAGUES) {
    for (const season of SEASONS) {
      const url = `https://www.football-data.co.uk/mmz4281/${season}/${fdCode}.csv`;
      let csv: string;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) { console.log(`  ${league} ${season}: HTTP ${res.status} 스킵`); continue; }
        csv = new TextDecoder("utf-8").decode(await res.arrayBuffer());
      } catch (e) {
        console.log(`  ${league} ${season}: 요청 실패 ${(e as Error).message}`);
        continue;
      }
      const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const header = parseCsvLine(lines[0]);
      const ix = (c: string) => header.indexOf(c);
      let n = 0, withOdds = 0;
      for (const line of lines.slice(1)) {
        const c = parseCsvLine(line);
        const date = parseFdDate(c[ix("Date")] ?? "");
        const home = c[ix("HomeTeam")]?.trim();
        const away = c[ix("AwayTeam")]?.trim();
        const hg = Number(c[ix("FTHG")]);
        const ag = Number(c[ix("FTAG")]);
        if (!date || !home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
        rows.push({ league, date, home, away, hg, ag });
        n++;
        for (const [h, d, a] of ODDS_SETS) {
          if (ix(h) < 0) continue;
          const p = impliedProbs(Number(c[ix(h)]), Number(c[ix(d)]), Number(c[ix(a)]));
          if (p) { odds.set(`${league}|${date}|${home}|${away}`, p); withOdds++; break; }
        }
      }
      console.log(`  ${league} ${season}: ${n}경기 (배당 ${withOdds})`);
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows, odds };
}

type Arm = { key: string; label: string; predict: (f: Features) => Probs | null };

const ARMS: Arm[] = [
  {
    key: "A",
    label: "A. 배당만 (market only)",
    predict: (f) => (f.market ? [f.market.pHome, f.market.pDraw, f.market.pAway] : null),
  },
  {
    key: "B",
    label: "B. Elo만 (홈이점 없음)",
    predict: (f) => toProbs(f.eloDiff, f.drawBase, Math.abs(f.eloDiff)),
  },
  {
    key: "C",
    label: "C. Elo + 홈이점",
    predict: (f) => toProbs(f.eloDiff + f.homeAdv, f.drawBase, Math.abs(f.eloDiff)),
  },
  {
    key: "D",
    label: "D. C + 최근폼",
    predict: (f) =>
      toProbs(f.eloDiff + f.homeAdv + DEFAULT_FORM_WEIGHT * f.formDiff, f.drawBase, Math.abs(f.eloDiff)),
  },
  {
    key: "E",
    label: "E. D + H2H (=현재 모델, 배당 미반영)",
    predict: (f) =>
      toProbs(
        f.eloDiff + f.homeAdv + DEFAULT_FORM_WEIGHT * f.formDiff + DEFAULT_H2H_WEIGHT * f.h2hDiff,
        f.drawBase,
        Math.abs(f.eloDiff),
      ),
  },
  {
    key: "F",
    label: `F. E + 배당 블렌딩 ${DEFAULT_MARKET_WEIGHT} (=앱 실제 구성)`,
    predict: (f) => {
      const m = toProbs(
        f.eloDiff + f.homeAdv + DEFAULT_FORM_WEIGHT * f.formDiff + DEFAULT_H2H_WEIGHT * f.h2hDiff,
        f.drawBase,
        Math.abs(f.eloDiff),
      );
      return f.market ? blend(m, f.market, DEFAULT_MARKET_WEIGHT) : null;
    },
  },
];

function evalArm(arm: Arm, feats: Features[]): Metrics | null {
  const items = [];
  for (const f of feats) {
    const p = arm.predict(f);
    if (p) items.push({ probs: p, outcome: f.outcome });
  }
  return items.length ? evaluate(items) : null;
}

async function main() {
  console.log("football-data.co.uk 수집 중...");
  const { rows, odds } = await load();
  console.log(`\n총 ${rows.length}경기, 배당 ${odds.size}건\n`);
  if (rows.length === 0) {
    console.log("데이터를 못 받았다. 결론 없음.");
    process.exit(1);
  }

  const feats = buildFeatures(rows, {
    market: (m) => odds.get(`${m.league}|${m.date}|${m.home}|${m.away}`) ?? null,
  });
  // 모든 arm을 같은 경기 집합에서 비교해야 공정하다. 배당이 없는 경기는 A/F가 예측을
  // 못 내므로 표본이 달라진다 -> 배당이 있는 경기로 한정한다.
  const common = feats.filter((f) => f.market != null);
  console.log(`워밍업(팀당 ${15}경기) 이후 ${feats.length}경기, 그중 배당 보유 ${common.length}경기`);
  console.log("모든 arm을 이 공통 표본에서 비교한다(표본이 다르면 비교가 성립하지 않는다).\n");

  console.log("═".repeat(78));
  console.log("전체 구간 (참고용 - 하이퍼파라미터를 고른 데이터와 겹치므로 이것만 믿으면 안 된다)");
  console.log("═".repeat(78));
  for (const arm of ARMS) {
    const m = evalArm(arm, common);
    if (m) console.log(`${arm.label.padEnd(38)} ${fmtMetrics(m)}`);
  }

  console.log("\n" + "═".repeat(78));
  console.log("시간순 4분할 워크포워드 (test 구간에서만 평가)");
  console.log("═".repeat(78));
  for (const frac of SPLITS) {
    const cut = Math.floor(common.length * frac);
    const test = common.slice(cut);
    console.log(`\n── 분할 ${frac} (train ${cut} / test ${test.length}) ──`);
    for (const arm of ARMS) {
      const m = evalArm(arm, test);
      if (m) console.log(`  ${arm.label.padEnd(38)} ${fmtMetrics(m)}`);
    }
  }

  // 증분 기여: 사다리에서 한 칸 올라갈 때 로그손실이 실제로 줄어드는가
  console.log("\n" + "═".repeat(78));
  console.log("증분 기여 (4분할 test 로그손실 평균, 음수면 개선)");
  console.log("═".repeat(78));
  const avgLl = (arm: Arm) => {
    const v = SPLITS.map((frac) => {
      const m = evalArm(arm, common.slice(Math.floor(common.length * frac)));
      return m ? m.logloss : NaN;
    });
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const lls = new Map(ARMS.map((a) => [a.key, avgLl(a)]));
  const steps: [string, string, string][] = [
    ["B", "C", "홈어드밴티지 추가"],
    ["C", "D", "최근폼 추가"],
    ["D", "E", "H2H 추가"],
    ["E", "F", "배당 블렌딩 추가"],
    ["E", "A", "우리 모델 -> 배당만 (양수면 배당이 우리보다 낫다는 뜻)"],
  ];
  for (const [from, to, label] of steps) {
    const d = lls.get(to)! - lls.get(from)!;
    console.log(`  ${label.padEnd(46)} ${d >= 0 ? "+" : ""}${d.toFixed(4)}  ${d < 0 ? "개선" : "악화"}`);
  }
  console.log("\n주의: 모든 arm이 동일한 무승부 모델(리그 무승부율 + 격차보정)을 공유한다.");
  console.log("따라서 이 비교는 강도 항의 기여만 분리해서 보여준다.");
}

main();
