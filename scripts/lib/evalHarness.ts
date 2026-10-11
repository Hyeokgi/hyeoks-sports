// 변수 검증 공용 하네스.
//
// 챗GPT 제안대로 "좋아 보이는 변수를 하나씩 추가"하는 방식 대신, 베이스라인을 고정하고
// 후보를 같은 프로토콜로 재는 방식으로 통일한다. 스크립트마다 워크포워드를 다시 짜면
// 미묘하게 달라져서 비교가 안 되므로(실제로 measure_rest / measure_h2h / measure_xg가
// 각자 복붙본을 갖고 있었다) 여기 한 곳에 모은다.
//
// 지표: 적중률 / Brier / 로그손실 / 캘리브레이션(ECE)
// 검증: 시간순 4분할 워크포워드 (train에서 하이퍼파라미터 선택 -> test에서만 평가)
//
// ── 2026-10-11 피처 계약 수정 (FEATURE_CONTRACT v2) ─────────────────────────────
// 감사에서 v1 피처의 결함이 확인됐다. 이 하네스로 낸 과거 수치는 전부 v1 기준이라
// 시간순 4분할을 다시 돌리기 전까지 잠정값으로 본다(계수·기본값·캘리브레이션 표는 그 전까지
// 건드리지 않는다).
//   1) 누수: 리그 무승부율(drawBase)을 반복 전에 "전체 행"으로 한 번 계산했다. 2024년 경기의
//      피처에 2026년 결과까지 섞인 무승부율이 들어갔다. -> 그 날짜 이전에 끝난 경기만으로
//      누적 계산한다.
//   2) 단위 불일치: formDiff를 /3 해서 0~1 척도로 냈다. 운영(src/lib/elo.ts recentForm)은
//      경기당 승점 0~3 척도이고 DEFAULT_FORM_WEIGHT(60)도 그 척도에 붙는다. 하네스에서
//      60 * formDiff는 운영 폼 항의 1/3만 반영하고 있었다. -> 운영 척도(0~3) 그대로 낸다.
//   3) 같은 날짜 순서 인공물: 입력이 날짜(일 단위)만 갖고 있어 같은 날 경기의 실제 종료
//      순서를 알 수 없다. 그런데 v1은 행 순서대로 상태를 갱신해, 같은 날 앞 행의 결과가
//      뒤 행의 피처(같은 팀 Elo·폼, 훅 기반 부가 피처 등)에 들어갈 수 있었다. -> 하루치 피처를
//      모두 "전날까지의 상태"로 만든 뒤에야 그날 결과로 상태를 갱신한다.
//   4) 운영 동치: 피처는 운영(createRound/syncFixtures)이 그 경기 직전에 계산했을 값과 같다.
//      운영은 computeEloAndHistory 결과를 그대로 읽으므로, 새 시즌 첫 경기의 eloDiff에는
//      시즌 회귀가 아직 적용되지 않는다(회귀는 그 팀의 다음 경기를 처리할 때 적용됨).
//      v1은 피처 생성 전에 회귀를 먼저 적용해 시즌 개막 경기에서 운영과 달랐다.
// ──────────────────────────────────────────────────────────────────────────────
import {
  h2hDiff as h2hDiffOf,
  recentForm,
  seasonOf,
  homeAdvForLeague,
  K_FACTOR,
  SEASON_REGRESSION,
  type MatchRow,
  type EloState,
  type TeamHistoryEntry,
  type H2HMeeting,
} from "../../src/lib/elo";
import { closenessAdjustedDrawRate } from "../../src/lib/drawCurve";
import { FALLBACK_DRAW_RATE } from "../../src/lib/prediction";

// 이 하네스가 내는 피처의 계약 버전. 결과를 기록할 때 함께 남겨 v1 수치와 섞이지 않게 한다.
export const FEATURE_CONTRACT =
  "v2 (2026-10-11): 전날까지 끝난 경기만 사용, 같은 날 묶음 처리, formDiff 운영 척도(경기당 승점 0~3), 운영 Elo 동치";

export const WARMUP = 15;
export const SPLITS = [0.5, 0.6, 0.7, 0.8];

export type Outcome = 0 | 1 | 2; // 홈승/무/원정승
export type Probs = [number, number, number];

export interface MarketProbs {
  pHome: number;
  pDraw: number;
  pAway: number;
}

// 각 경기 시점에 "그 경기 날짜 이전에 끝난 경기 정보만"으로 만들어진 피처들.
// 단위는 운영 PredictionInputs(src/lib/prediction.ts)와 같다.
export interface Features {
  league: string;
  date: string;
  season: number;
  eloDiff: number; // 홈 Elo - 원정 Elo (홈어드밴티지 제외, 운영 computeEloAndHistory 상태 그대로)
  formDiff: number; // 최근 5경기 경기당 승점 차(홈-원정), 운영 recentForm과 같은 척도(-3~3)
  h2hDiff: number; // 운영 h2hDiff와 동일(-1~1)
  drawBase: number; // 그 날짜 이전에 끝난 같은 리그 경기의 무승부율(없으면 FALLBACK_DRAW_RATE)
  drawBaseN: number; // drawBase 계산에 쓴 표본 수(0이면 폴백값을 쓴 것)
  homeAdv: number;
  market: MarketProbs | null;
  outcome: Outcome;
  // 리그별/스크립트별 추가 피처는 여기 담는다(xG 변형 등).
  extra: Record<string, number | null>;
}

export interface Metrics {
  n: number;
  acc: number;
  brier: number;
  logloss: number;
  ece: number; // 캘리브레이션 오차: 1픽 확률과 실제 적중률의 가중 절대차
}

export interface BuildOptions {
  // 경기별 부가 피처를 만드는 훅. 워밍업을 통과한 경기에만 불린다. 같은 날짜의 피처를 만드는
  // 동안 호출되고, 그날 어떤 경기의 onMatch보다도 먼저 불린다(같은 날 결과가 새지 않게).
  extraFeatures?: (m: MatchRow, key: { home: string; away: string; season: number }) => Record<string, number | null>;
  // 상태 갱신 훅(예: xG 히스토리 누적). 그날의 피처를 전부 만든 뒤, 입력 순서대로 모든 경기에 호출된다.
  onMatch?: (m: MatchRow, key: { home: string; away: string; season: number }) => void;
  market?: (m: MatchRow) => MarketProbs | null;
}

// 날짜 문자열에서 일(day) 키를 뽑는다. 시각이 붙어 있어도 일 단위로 묶는다 - 시각은 킥오프일 뿐
// 앞 경기가 끝났다는 보장이 아니다.
export function dayKey(date: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(date);
  if (!m) throw new Error(`evalHarness: 날짜 형식이 ISO(yyyy-mm-dd)가 아니다: "${date}"`);
  return m[1];
}

function outcomeOf(r: MatchRow): Outcome {
  return r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2;
}

// 워크포워드로 피처를 만든다. 입력은 날짜(일) 오름차순이어야 하며, 아니면 예외를 던진다
// (조용히 정렬하면 호출자의 정렬 실수가 묻힌다). 출력 순서는 입력 순서를 따른다.
export function buildFeatures(rows: MatchRow[], opts: BuildOptions = {}): Features[] {
  // 상태는 운영 elo.ts와 같은 키·자료구조로 둔다. 그래야 recentForm/h2hDiff를 그대로 호출해
  // 단위와 계산식이 운영과 어긋날 여지가 없다.
  const elo = new Map<string, EloState>(); // `${league}|${team}`
  const teamHistory = new Map<string, TeamHistoryEntry[]>(); // `${league}|${team}`
  const h2h = new Map<string, H2HMeeting[]>(); // `${league}|${정렬된 팀1}|${팀2}`
  const leagueTally = new Map<string, { n: number; draws: number }>();
  const out: Features[] = [];

  let i = 0;
  let prevDay = "";
  while (i < rows.length) {
    const day = dayKey(rows[i].date);
    if (prevDay && day < prevDay) {
      throw new Error(`evalHarness: 입력이 날짜순이 아니다 (${prevDay} 다음에 ${day})`);
    }
    let j = i;
    while (j < rows.length && dayKey(rows[j].date) === day) j++;
    const dayRows = rows.slice(i, j);

    // 1) 피처: 전날까지의 상태만 읽는다. 여기서는 어떤 상태도 바꾸지 않는다.
    for (const r of dayRows) {
      const hk = `${r.league}|${r.home}`;
      const ak = `${r.league}|${r.away}`;
      const season = seasonOf(r.league, r.date);
      const nH = teamHistory.get(hk)?.length ?? 0;
      const nA = teamHistory.get(ak)?.length ?? 0;
      if (nH < WARMUP || nA < WARMUP) continue;
      const tally = leagueTally.get(r.league);
      const drawBaseN = tally?.n ?? 0;
      out.push({
        league: r.league,
        date: r.date,
        season,
        // 운영(createRound/syncFixtures)은 저장된 Elo를 그대로 읽는다 - 시즌 회귀는 다음 경기
        // 처리 때 적용되므로 여기서도 적용하지 않는다.
        eloDiff: (elo.get(hk)?.elo ?? 1500) - (elo.get(ak)?.elo ?? 1500),
        formDiff: recentForm(teamHistory, r.league, r.home).avgPts - recentForm(teamHistory, r.league, r.away).avgPts,
        h2hDiff: h2hDiffOf(h2h, r.league, r.home, r.away).diff,
        drawBase: tally && drawBaseN > 0 ? tally.draws / drawBaseN : FALLBACK_DRAW_RATE,
        drawBaseN,
        homeAdv: homeAdvForLeague(r.league),
        market: opts.market?.(r) ?? null,
        outcome: outcomeOf(r),
        extra: opts.extraFeatures?.(r, { home: r.home, away: r.away, season }) ?? {},
      });
    }

    // 2) 상태 갱신: 그날 피처를 전부 만든 뒤 입력 순서대로. 수식은 computeEloAndHistory와 동일.
    for (const r of dayRows) {
      const { league, home, away, hg, ag } = r;
      const season = seasonOf(league, r.date);
      for (const t of [home, away]) {
        const k = `${league}|${t}`;
        const st = elo.get(k);
        if (!st) elo.set(k, { elo: 1500.0, lastSeason: season });
        else if (st.lastSeason !== season) {
          elo.set(k, { elo: 1500.0 + (st.elo - 1500.0) * (1 - SEASON_REGRESSION), lastSeason: season });
        }
      }
      const hState = elo.get(`${league}|${home}`)!;
      const aState = elo.get(`${league}|${away}`)!;
      const he = hState.elo;
      const ae = aState.elo;
      const sH = hg > ag ? 1.0 : hg === ag ? 0.5 : 0.0;
      const eH = 1.0 / (1.0 + 10.0 ** ((ae - (he + homeAdvForLeague(league))) / 400.0));
      hState.elo += K_FACTOR * (sH - eH);
      aState.elo += K_FACTOR * (1.0 - sH - (1.0 - eH));

      for (const [k, entry] of [
        [`${league}|${home}`, { gf: hg, ga: ag, pts: hg > ag ? 3 : hg === ag ? 1 : 0 }],
        [`${league}|${away}`, { gf: ag, ga: hg, pts: ag > hg ? 3 : hg === ag ? 1 : 0 }],
      ] as [string, TeamHistoryEntry][]) {
        const h = teamHistory.get(k) ?? [];
        h.push(entry);
        teamHistory.set(k, h);
      }
      const pair = [home, away].sort();
      const pk = `${league}|${pair[0]}|${pair[1]}`;
      const arr = h2h.get(pk) ?? [];
      arr.push({ home, hg, ag });
      h2h.set(pk, arr);

      const tl = leagueTally.get(league) ?? { n: 0, draws: 0 };
      tl.n++;
      if (hg === ag) tl.draws++;
      leagueTally.set(league, tl);

      opts.onMatch?.(r, { home, away, season });
    }

    prevDay = day;
    i = j;
  }
  return out;
}

// 강도 항(Elo점수 단위)을 확률로 바꾼다. 모든 arm이 같은 무승부 모델을 쓰므로
// 비교가 강도 항 차이만 반영한다.
export function toProbs(strengthDiff: number, drawBase: number, absEloForDraw: number): Probs {
  const pHomeRaw = 1 / (1 + 10 ** (-strengthDiff / 400));
  const pDraw = closenessAdjustedDrawRate(drawBase, absEloForDraw);
  return [pHomeRaw * (1 - pDraw), pDraw, (1 - pHomeRaw) * (1 - pDraw)];
}

export function blend(model: Probs, market: MarketProbs, w: number): Probs {
  return [
    model[0] * (1 - w) + market.pHome * w,
    model[1] * (1 - w) + market.pDraw * w,
    model[2] * (1 - w) + market.pAway * w,
  ];
}

export function evaluate(items: { probs: Probs; outcome: Outcome }[]): Metrics {
  let hit = 0, brier = 0, ll = 0;
  // ECE: 1픽 확률을 10구간으로 나눠 (평균 확신도 - 실제 적중률) 가중 평균
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, hit: 0 }));
  for (const { probs, outcome } of items) {
    const top = probs.indexOf(Math.max(...probs));
    const correct = top === outcome;
    if (correct) hit++;
    for (let i = 0; i < 3; i++) brier += (probs[i] - (i === outcome ? 1 : 0)) ** 2;
    ll -= Math.log(Math.max(probs[outcome], 1e-12));
    const p = probs[top];
    const b = bins[Math.min(9, Math.max(0, Math.floor(p * 10)))];
    b.n++;
    b.conf += p;
    if (correct) b.hit++;
  }
  const n = items.length;
  let ece = 0;
  for (const b of bins) if (b.n > 0) ece += (b.n / n) * Math.abs(b.conf / b.n - b.hit / b.n);
  return { n, acc: hit / n, brier: brier / n, logloss: ll / n, ece };
}

export function fmtMetrics(m: Metrics): string {
  return `적중 ${(m.acc * 100).toFixed(2)}%  Brier ${m.brier.toFixed(4)}  로그손실 ${m.logloss.toFixed(4)}  ECE ${m.ece.toFixed(4)}`;
}

// 시간순 분할 지점. floor(n*frac)에서 시작해, 같은 날짜가 train/test 양쪽에 걸치지 않도록
// 그날이 끝나는 지점까지 뒤로 민다(같은 날 결과로 고른 계수를 같은 날 경기에 평가하지 않게).
// 입력은 날짜순이어야 한다(buildFeatures 출력은 날짜순이다).
export function chronologicalCut(feats: { date: string }[], frac: number): number {
  let cut = Math.floor(feats.length * frac);
  while (cut > 0 && cut < feats.length && dayKey(feats[cut].date) === dayKey(feats[cut - 1].date)) cut++;
  return cut;
}

// 시간순 4분할. tune이 있으면 train에서 하이퍼파라미터를 고르고 test에서만 평가한다.
export function walkForward<T>(
  feats: Features[],
  predict: (f: Features, tuned: T) => Probs | null,
  tune: (train: Features[]) => T,
): { split: number; nTrain: number; nTest: number; tuned: T; base: Metrics | null; test: Metrics }[] {
  return SPLITS.map((frac) => {
    const cut = chronologicalCut(feats, frac);
    const train = feats.slice(0, cut);
    const test = feats.slice(cut);
    const tuned = tune(train);
    const items: { probs: Probs; outcome: Outcome }[] = [];
    for (const f of test) {
      const p = predict(f, tuned);
      if (p) items.push({ probs: p, outcome: f.outcome });
    }
    return { split: frac, nTrain: train.length, nTest: test.length, tuned, base: null, test: evaluate(items) };
  });
}
