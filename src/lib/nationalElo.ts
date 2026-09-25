// 국가대표 경기(UEFA 네이션스리그, 월드컵 예선 등)용 Elo.
//
// 왜 따로 두는가: 클럽 Elo(elo.ts)는 리그 안에서만 비교가 성립하고, 국가대표는 FotMob 리그
// 백필 대상도 아니다. 그래서 55~57회차(네이션스리그)는 모델 근거가 전혀 없어 배당만 기다렸고,
// 배당이 아직 안 올라온 경기는 36/27/36(근거없음)으로 떨어졌다. 북메이커는 킥오프 며칠 전에야
// 배당을 올리므로, 먼저 등록된 회차는 그 사이 내내 근거없음이다.
//
// 데이터: martj42/international_results(1872~ 전 세계 A매치 결과, CSV, 공개 GitHub).
// 방식: World Football Elo(eloratings.net)와 같은 규칙 - 대회 중요도별 K, 득실차 가중,
// 중립 경기가 아니면 홈 +100. 규칙 상수는 튜닝하지 않고 공개 방식 그대로 쓴다(과적합 방지).
// 확률 변환(순서형 로지스틱)의 3개 계수만 과거 경기로 적합했고, 그 검증은
// scripts/backtest_national_elo.ts → seed/national_elo_backtest.json.

export const NATIONAL_RESULTS_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";

export const NATIONAL_INITIAL_ELO = 1500;
export const NATIONAL_HOME_ADV = 100;

export interface NationalResult {
  date: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
  tournament: string;
  neutral: boolean;
}

/** results.csv를 읽는다. 스코어가 비어 있는 행(예정 경기)은 버린다. */
export function parseNationalResultsCsv(text: string): NationalResult[] {
  const out: NationalResult[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 9) continue;
    const [date, home, away, hgS, agS, tournament, , , neutralS] = cols;
    const hg = Number(hgS);
    const ag = Number(agS);
    if (hgS === "" || agS === "" || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    out.push({ date, home, away, hg, ag, tournament, neutral: neutralS.trim().toUpperCase() === "TRUE" });
  }
  return out;
}

// 도시명 등에 쉼표가 들어간 행은 큰따옴표로 감싸져 있다.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** eloratings.net의 대회 중요도 K. */
export function nationalK(tournament: string): number {
  const t = tournament.toLowerCase();
  if (t === "friendly") return 20;
  if (t === "fifa world cup") return 60;
  if (t.includes("qualification")) return 40;
  // 네이션스리그는 예선급으로 본다(eloratings.net도 40).
  if (t.includes("nations league")) return 40;
  if (
    t === "uefa euro" ||
    t === "copa américa" ||
    t === "african cup of nations" ||
    t === "afc asian cup" ||
    t === "gold cup" ||
    t === "confederations cup" ||
    t === "ofc nations cup"
  )
    return 50;
  return 30;
}

/** 득실차 가중(eloratings.net). */
export function goalDiffMultiplier(gd: number): number {
  const a = Math.abs(gd);
  if (a <= 1) return 1;
  if (a === 2) return 1.5;
  return (11 + a) / 8;
}

export interface NationalEloState {
  elo: number;
  n: number;
  lastDate: string;
}

/**
 * 결과를 날짜순으로 한 번 훑어 Elo를 만든다. onBeforeMatch는 경기 직전 레이팅(사전 정보만)으로
 * 백테스트 표본을 뽑을 때 쓴다 - 여기서 받는 값에는 그 경기 결과가 아직 들어 있지 않다.
 */
export function computeNationalElo(
  results: NationalResult[],
  onBeforeMatch?: (r: NationalResult, homeElo: number, awayElo: number, homeN: number, awayN: number) => void,
): Map<string, NationalEloState> {
  const sorted = [...results].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const st = new Map<string, NationalEloState>();
  const get = (t: string) => {
    let s = st.get(t);
    if (!s) {
      s = { elo: NATIONAL_INITIAL_ELO, n: 0, lastDate: "" };
      st.set(t, s);
    }
    return s;
  };
  for (const r of sorted) {
    const h = get(r.home);
    const a = get(r.away);
    onBeforeMatch?.(r, h.elo, a.elo, h.n, a.n);
    const dr = h.elo - a.elo + (r.neutral ? 0 : NATIONAL_HOME_ADV);
    const we = 1 / (1 + 10 ** (-dr / 400));
    const w = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
    const delta = nationalK(r.tournament) * goalDiffMultiplier(r.hg - r.ag) * (w - we);
    h.elo += delta;
    a.elo -= delta;
    h.n++;
    a.n++;
    h.lastDate = r.date;
    a.lastDate = r.date;
  }
  return st;
}

/**
 * 순서형 로지스틱 계수. x = (홈Elo - 원정Elo + 홈어드밴티지)/400.
 *   P(원정승) = σ(θ1 - βx),  P(원정승 또는 무) = σ(θ2 - βx)
 * scripts/backtest_national_elo.ts가 2010년 이후 공식전으로 적합한 값(전체 표본).
 * 4분할 검증은 각 분할의 학습 구간에서 따로 적합해 테스트 구간에 적용했다.
 */
export const NATIONAL_PROB_COEF = { beta: 2.1295, theta1: -0.669, theta2: 0.6113 };

export function nationalProbs(
  eloDiffWithHomeAdv: number,
  coef: { beta: number; theta1: number; theta2: number } = NATIONAL_PROB_COEF,
): { pHome: number; pDraw: number; pAway: number } {
  const x = eloDiffWithHomeAdv / 400;
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const pAway = sig(coef.theta1 - coef.beta * x);
  const pAwayOrDraw = sig(coef.theta2 - coef.beta * x);
  const pDraw = Math.max(0, pAwayOrDraw - pAway);
  const pHome = Math.max(0, 1 - pAwayOrDraw);
  const s = pHome + pDraw + pAway;
  return { pHome: pHome / s, pDraw: pDraw / s, pAway: pAway / s };
}

/** 표본 (x, 결과)로 순서형 로지스틱 3계수를 경사하강으로 적합한다. 결과: 0=원정 1=무 2=홈. */
export function fitOrderedLogit(
  samples: { x: number; y: 0 | 1 | 2 }[],
  init = { beta: 1.5, theta1: -0.6, theta2: 0.5 },
): { beta: number; theta1: number; theta2: number } {
  let { beta, theta1, theta2 } = init;
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const lr = 0.5;
  for (let it = 0; it < 400; it++) {
    let gB = 0;
    let g1 = 0;
    let g2 = 0;
    for (const { x, y } of samples) {
      const s1 = sig(theta1 - beta * x);
      const s2 = sig(theta2 - beta * x);
      const d1 = s1 * (1 - s1);
      const d2 = s2 * (1 - s2);
      const eps = 1e-12;
      if (y === 0) {
        // log s1
        g1 += d1 / (s1 + eps);
        gB += (-x * d1) / (s1 + eps);
      } else if (y === 1) {
        // log (s2 - s1)
        const p = Math.max(s2 - s1, eps);
        g2 += d2 / p;
        g1 -= d1 / p;
        gB += (-x * d2 + x * d1) / p;
      } else {
        // log (1 - s2)
        const p = Math.max(1 - s2, eps);
        g2 -= d2 / p;
        gB += (x * d2) / p;
      }
    }
    const n = samples.length;
    beta += (lr * gB) / n;
    theta1 += (lr * g1) / n;
    theta2 += (lr * g2) / n;
    if (theta2 < theta1 + 0.01) theta2 = theta1 + 0.01;
  }
  return { beta, theta1, theta2 };
}
