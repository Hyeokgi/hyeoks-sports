// 프론트엔드 로직: 회차 조회, 변수 토글(클라이언트 즉시 재계산), 예산별 조합, AI 리포트
import { predictMatch, DEFAULT_TOGGLES, type PredictionToggles, type PredictionInputs } from "../src/lib/prediction";
import { generateSystemBetTiers, DEFAULT_BUDGET_TIERS, generateSystemBet, type ComboMatch } from "../src/lib/combinations";
import { findCalibrationBucket, confidenceTier, TIER_EMOJI } from "../src/lib/calibration";
import { computeUpsetSignal } from "../src/lib/upsetSignal";
import { generateExclusivePick, type ExclusiveMatchInput } from "../src/lib/exclusivePick";

interface MatchData {
  seq: number;
  league: string;
  home: string;
  away: string;
  raw: {
    eloDiff: number;
    formDiff: number;
    h2hDiff: number;
    nH2h: number;
    leagueDrawRate: number;
    market: { pHome: number; pDraw: number; pAway: number; nBookmakers: number } | null;
    xgDiff: number | null;
    cornersDiff: number | null;
  };
  // 회차가 정산되면 채워짐(경기 전이면 null) - 적중현황 표시용.
  result: { actual: "H" | "D" | "A"; hg: number; ag: number } | null;
  // betman 투표(매수)율 최신 스냅샷 %. 발매 전/미수집이면 null - 독식 픽 계산에 사용.
  voteShare: { home: number; draw: number; away: number } | null;
}

const RESULT_LABEL: Record<"H" | "D" | "A", "홈승" | "무승부" | "원정승"> = { H: "홈승", D: "무승부", A: "원정승" };

const TOGGLE_LABELS: { key: keyof PredictionToggles; label: string; kind: "bool" }[] = [
  { key: "useElo", label: "Elo 전력차", kind: "bool" },
  { key: "useForm", label: "최근 폼(5경기)", kind: "bool" },
  { key: "useH2H", label: "상대전적(H2H)", kind: "bool" },
  { key: "useHomeAdvantage", label: "홈 어드밴티지", kind: "bool" },
  { key: "useLeagueDrawRate", label: "리그별 무승부율", kind: "bool" },
  { key: "useClosenessDrawAdjustment", label: "격차 보정 무승부율", kind: "bool" },
  { key: "useMarketOdds", label: "해외 배당 반영", kind: "bool" },
  { key: "useXG", label: "기대득점(xG, K리그1만)", kind: "bool" },
  { key: "useCorners", label: "코너킥 반영(K리그2만)", kind: "bool" },
];

let currentMatches: MatchData[] = [];
let currentToggles: PredictionToggles = { ...DEFAULT_TOGGLES };
let currentRoundId: number | null = null;

const roundSelect = document.getElementById("round-select") as HTMLSelectElement;
const toggleGrid = document.getElementById("toggle-grid") as HTMLDivElement;
const matchList = document.getElementById("match-list") as HTMLDivElement;
const roundSummaryEl = document.getElementById("round-summary") as HTMLDivElement;
const comboTiersEl = document.getElementById("combo-tiers") as HTMLDivElement;
const budgetInput = document.getElementById("budget-input") as HTMLInputElement;
const budgetBtn = document.getElementById("budget-custom-btn") as HTMLButtonElement;
const reportBtn = document.getElementById("report-btn") as HTMLButtonElement;
const reportText = document.getElementById("report-text") as HTMLParagraphElement;
const drawGuaranteeSelect = document.getElementById("draw-guarantee-select") as HTMLSelectElement;
const exclusivePickEl = document.getElementById("exclusive-pick") as HTMLDivElement;
const upsetCountSelect = document.getElementById("upset-count-select") as HTMLSelectElement;
const drawForceSelect = document.getElementById("draw-force-select") as HTMLSelectElement;
const settlementSummaryEl = document.getElementById("settlement-summary") as HTMLDivElement;
const settlementRoundsEl = document.getElementById("settlement-rounds") as HTMLDivElement;
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-btn"));
const tabPages = Array.from(document.querySelectorAll<HTMLElement>(".tab-page"));

function toInputs(m: MatchData): PredictionInputs {
  return {
    eloDiff: m.raw.eloDiff,
    formDiff: m.raw.formDiff,
    h2hDiff: m.raw.h2hDiff,
    leagueDrawRate: m.raw.leagueDrawRate,
    marketOdds: m.raw.market,
    xgDiff: m.raw.xgDiff,
    cornersDiff: m.raw.cornersDiff,
    league: m.league,
  };
}

function renderToggles() {
  toggleGrid.innerHTML = "";
  for (const t of TOGGLE_LABELS) {
    const wrap = document.createElement("label");
    wrap.className = "toggle-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(currentToggles[t.key]);
    checkbox.addEventListener("change", () => {
      (currentToggles as any)[t.key] = checkbox.checked;
      renderMatches();
      renderCombos();
    });
    const span = document.createElement("span");
    span.textContent = t.label;
    wrap.appendChild(span);
    wrap.appendChild(checkbox);
    toggleGrid.appendChild(wrap);
  }
}

function renderRoundSummary() {
  const settled = currentMatches.filter((m) => m.result);
  if (settled.length === 0) {
    roundSummaryEl.hidden = true;
    return;
  }
  let correct = 0;
  for (const m of settled) {
    const prediction = predictMatch(toInputs(m), currentToggles);
    if (prediction.rankedPicks[0] === RESULT_LABEL[m.result!.actual]) correct++;
  }
  const pct = ((correct / settled.length) * 100).toFixed(1);
  const ongoing = currentMatches.length - settled.length;
  roundSummaryEl.hidden = false;
  roundSummaryEl.innerHTML =
    `<span class="summary-stat">✅ ${correct}/${settled.length} 적중 (${pct}%)</span>` +
    (ongoing > 0 ? `<span class="summary-note">진행중 ${ongoing}경기 제외</span>` : "");
}

function renderMatches() {
  matchList.innerHTML = "";
  renderRoundSummary();
  for (const m of currentMatches) {
    const prediction = predictMatch(toInputs(m), currentToggles);
    const card = document.createElement("div");
    card.className = "match-card";

    const tier = confidenceTier(m.league, prediction.confidenceGap);
    const meta = document.createElement("div");
    meta.className = "meta";
    let resultBadge = "";
    if (m.result) {
      const hit = prediction.rankedPicks[0] === RESULT_LABEL[m.result.actual];
      resultBadge = `<span class="result-badge ${hit ? "hit" : "miss"}">${hit ? "✅ 적중" : "❌ 실패"} (${m.result.hg}:${m.result.ag})</span>`;
    }
    meta.innerHTML = `<span class="league-badge">${m.seq}경기 · ${m.league}</span><span class="confidence-badge">${TIER_EMOJI[tier]} ${tier} · 확신도 ${(prediction.confidenceGap * 100).toFixed(1)}%p</span>${resultBadge}`;
    card.appendChild(meta);

    const teams = document.createElement("div");
    teams.className = "teams";
    teams.textContent = `${m.home} vs ${m.away}`;
    card.appendChild(teams);

    const bar = document.createElement("div");
    bar.className = "prob-bar";
    bar.innerHTML = `
      <span class="home" style="width:${(prediction.pHome * 100).toFixed(1)}%">${(prediction.pHome * 100).toFixed(0)}%</span>
      <span class="draw" style="width:${(prediction.pDraw * 100).toFixed(1)}%">${(prediction.pDraw * 100).toFixed(0)}%</span>
      <span class="away" style="width:${(prediction.pAway * 100).toFixed(1)}%">${(prediction.pAway * 100).toFixed(0)}%</span>
    `;
    card.appendChild(bar);

    const pick = document.createElement("div");
    pick.className = "pick-line";
    const marketNote = m.raw.market
      ? ` <span class="market-note">해외배당 ${m.raw.market.nBookmakers}개사 반영</span>`
      : "";
    const xgNote = m.raw.xgDiff != null ? ` <span class="market-note">xG 반영</span>` : "";
    const cornersNote = m.raw.cornersDiff != null ? ` <span class="market-note">코너킥 반영</span>` : "";
    pick.innerHTML = `모델 추천 <b>${prediction.rankedPicks[0]}</b>${marketNote}${xgNote}${cornersNote}`;
    card.appendChild(pick);

    // 작업1: 모델 원본 확률을 덮어쓰지 않고, 같은 확신도 구간의 실측 적중률을 항상 보이게 병기
    // ("82%"만 보이면 실제보다 신뢰도가 높아 보일 수 있어서 - 근거보기를 펼쳐야만 보이면 놓치기 쉬움).
    const bucket = findCalibrationBucket(m.league, prediction.confidenceGap);
    const bucketNote = bucket
      ? `이 확신도 구간(${(bucket.minGap * 100).toFixed(0)}~${(bucket.maxGap * 100).toFixed(0)}%p), 과거 실측 적중률 ${(bucket.accuracy * 100).toFixed(1)}% (표본 ${bucket.n}경기)`
      : "이 구간에 대한 실측 데이터가 부족합니다";
    const calibLine = document.createElement("div");
    calibLine.className = "calib-note";
    calibLine.textContent = `참고: ${bucketNote}`;
    card.appendChild(calibLine);

    // 작업(2026-08-06): 모델픽-시장픽 합의여부 참고 표시. contrarian(모델 확신픽인데 시장과
    // 불일치)은 근거(n=2)가 극히 약해 항상 그 사실을 같이 보여준다 - 픽 자체는 절대 안 바꿈.
    const upset = computeUpsetSignal(prediction, m.raw.market, tier);
    if (upset.hasMarket) {
      const upsetLine = document.createElement("div");
      upsetLine.className = upset.contrarian ? "calib-note upset-warn" : "calib-note";
      upsetLine.textContent = upset.note;
      card.appendChild(upsetLine);
    }

    const evidenceBtn = document.createElement("button");
    evidenceBtn.className = "evidence-toggle";
    evidenceBtn.type = "button";
    evidenceBtn.textContent = "근거 보기 ▾";
    const evidenceBody = document.createElement("div");
    evidenceBody.className = "evidence-body";
    evidenceBody.hidden = true;
    evidenceBody.innerHTML = `
      <div>Elo 전력차: ${m.raw.eloDiff.toFixed(0)}점 (${m.raw.eloDiff >= 0 ? m.home : m.away} 우세)</div>
      <div>최근 폼(5경기) 차이: ${m.raw.formDiff.toFixed(2)}점</div>
      <div>상대전적(H2H) 성향: ${m.raw.h2hDiff.toFixed(2)} (표본 ${m.raw.nH2h}회)</div>
      <div>리그 실측 무승부율: ${(m.raw.leagueDrawRate * 100).toFixed(1)}%</div>
      ${m.raw.cornersDiff != null ? `<div>최근 폼(5경기) 코너킥 차이: ${m.raw.cornersDiff.toFixed(1)}개 (K리그2 실증 검증된 피처)</div>` : ""}
      ${m.voteShare ? `<div>betman 투표율: 홈 ${m.voteShare.home.toFixed(1)}% / 무 ${m.voteShare.draw.toFixed(1)}% / 원정 ${m.voteShare.away.toFixed(1)}%</div>` : ""}
    `;
    evidenceBtn.addEventListener("click", () => {
      evidenceBody.hidden = !evidenceBody.hidden;
      evidenceBtn.textContent = evidenceBody.hidden ? "근거 보기 ▾" : "근거 접기 ▴";
    });
    card.appendChild(evidenceBtn);
    card.appendChild(evidenceBody);

    matchList.appendChild(card);
  }
}

function toComboMatches(): ComboMatch[] {
  return currentMatches.map((m) => ({
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    prediction: predictMatch(toInputs(m), currentToggles),
  }));
}

function renderComboPlan(container: HTMLElement, title: string, plan: ReturnType<typeof generateSystemBet>) {
  const box = document.createElement("div");
  box.className = "combo-tier";
  const head = document.createElement("div");
  head.className = "tier-head";
  head.innerHTML = `<span>${title}</span><span>${plan.totalCombinations}조합 · ${plan.totalCostWon.toLocaleString()}원</span>`;
  box.appendChild(head);

  for (const p of plan.picks) {
    if (p.picks.length <= 1) continue;
    const row = document.createElement("div");
    row.className = "pick-row";
    const tags = p.picks.map((pk) => `<span class="${pk}">${pk}</span>`).join("");
    row.innerHTML = `<span>${p.seq}. ${p.home} vs ${p.away}</span><span class="pick-tags">${tags}</span>`;
    box.appendChild(row);
  }
  container.appendChild(box);
}

function renderCombos() {
  comboTiersEl.innerHTML = "";
  if (currentMatches.length === 0) return;
  const comboMatches = toComboMatches();
  const guaranteeDrawCount = Number(drawGuaranteeSelect.value) || 0;
  const plans = generateSystemBetTiers(comboMatches, DEFAULT_BUDGET_TIERS, undefined, { guaranteeDrawCount });
  plans.forEach((plan, i) => {
    renderComboPlan(comboTiersEl, `${DEFAULT_BUDGET_TIERS[i].toLocaleString()}원 예산`, plan);
  });
  renderExclusivePick();
}

// 독식 지향 픽: 모델픽을 덮어쓰지 않고 별도 박스로만 보여준다(exclusivePick.ts 주석 참고).
function renderExclusivePick() {
  exclusivePickEl.innerHTML = "";
  if (currentMatches.length === 0) return;

  const inputs: ExclusiveMatchInput[] = currentMatches.map((m) => ({
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    prediction: predictMatch(toInputs(m), currentToggles),
    voteShare: m.voteShare,
  }));
  const maxUpsets = Number(upsetCountSelect.value) || 0;
  const forceDrawCount = Number(drawForceSelect.value) || 0;
  const result = generateExclusivePick(inputs, { maxUpsets, forceDrawCount });

  const box = document.createElement("div");
  box.className = "combo-tier";

  const head = document.createElement("div");
  head.className = "tier-head";
  const edgeText =
    result.payoutEdge != null ? `기대 배당가치 ${result.payoutEdge.toFixed(1)}배` : "투표율 수집 대기";
  const forcedText = result.forcedDrawCount > 0 ? ` · 무승부 강제 ${result.forcedDrawCount}` : "";
  head.innerHTML = `<span>독식픽 (이변 ${result.upsetCount}${forcedText})</span><span>${edgeText}</span>`;
  box.appendChild(head);

  for (const p of result.picks) {
    const row = document.createElement("div");
    row.className = "pick-row";
    const voteText = p.votePct != null ? `투표 ${p.votePct.toFixed(1)}%` : "투표율 없음";
    const upsetBadge = p.isForcedDraw
      ? ` <span class="upset-badge">무강제</span> <s class="base-pick">${p.basePick}</s>`
      : p.isUpset
        ? ` <span class="upset-badge">이변</span> <s class="base-pick">${p.basePick}</s>`
        : "";
    row.innerHTML =
      `<span>${p.seq}. ${p.home} vs ${p.away}<span class="vote-note">모델 ${(p.modelProb * 100).toFixed(0)}% · ${voteText}</span></span>` +
      `<span class="pick-tags">${upsetBadge}<span class="${p.pick}">${p.pick}</span></span>`;
    box.appendChild(row);
  }

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = result.note;
  box.appendChild(note);

  exclusivePickEl.appendChild(box);
}

// 실전 정산 기록: /api/settlement이 계산한 회차별 기본픽 vs 독식픽 실적을 그대로 보여준다.
// 백테스트 수치와 섞이지 않도록 "실전"임을 명시하고, 표본이 적으면 그 사실도 같이 적는다.
function fmtShare(v: number | null): string {
  return v == null ? "-" : `${(v * 1e6).toFixed(2)}/백만`;
}

async function loadSettlement() {
  let data: any;
  try {
    const res = await fetch("/api/settlement");
    data = await res.json();
  } catch {
    return;
  }
  const s = data?.summary;
  const rounds: any[] = data?.rounds ?? [];
  if (!s || s.rounds === 0) {
    settlementSummaryEl.hidden = false;
    settlementSummaryEl.innerHTML = `<span class="summary-note">아직 정산된 회차가 없습니다. 회차가 끝나면 여기에 실전 성적이 쌓입니다.</span>`;
    return;
  }

  settlementSummaryEl.hidden = false;
  settlementSummaryEl.innerHTML =
    `<span class="summary-stat">📒 정산 ${s.rounds}회차 · ${s.settledMatches}경기</span>` +
    `<span class="summary-note">기본픽 ${(s.basePickAccuracy * 100).toFixed(1)}% · 독식픽 ${(s.exclusivePickAccuracy * 100).toFixed(1)}% · 실제 무승부 ${(s.drawRate * 100).toFixed(1)}%</span>` +
    (s.rounds < 5 ? `<span class="summary-note">⚠️ 표본 ${s.rounds}회차 — 아직 판단 근거로 쓰기엔 부족합니다</span>` : "");

  settlementRoundsEl.innerHTML = "";
  for (const r of rounds) {
    if (r.settledMatches === 0) continue;
    const box = document.createElement("div");
    box.className = "combo-tier";
    const head = document.createElement("div");
    head.className = "tier-head";
    head.innerHTML =
      `<span>${r.roundNo ?? "?"}회차</span>` +
      `<span>기본 ${r.basePickHits}/${r.settledMatches} · 독식 ${r.exclusivePickHits}/${r.settledMatches}</span>`;
    box.appendChild(head);

    const row = document.createElement("div");
    row.className = "pick-row";
    row.innerHTML =
      `<span>실제 무승부 ${r.drawsActual}경기 · 이변반영 ${r.upsetCount}<span class="vote-note">대중 구매비중 — 실제 당첨조합 ${fmtShare(r.actualCrowdShare)} / 우리 독식픽 ${fmtShare(r.exclusiveCrowdShare)}</span></span>`;
    box.appendChild(row);
    settlementRoundsEl.appendChild(box);
  }
}

async function loadRounds() {
  const res = await fetch("/api/rounds");
  const data = await res.json();
  roundSelect.innerHTML = "";
  for (const r of data.rounds ?? []) {
    const opt = document.createElement("option");
    opt.value = String(r.id);
    opt.textContent = r.round_no_confirmed
      ? `${r.round_no}회차`
      : `${r.round_no ?? "추정"}회차 (미확정, #${r.id})`;
    roundSelect.appendChild(opt);
  }
  if (data.rounds?.length > 0) {
    await loadRound(data.rounds[0].id);
  }
}

async function loadRound(roundId: number) {
  currentRoundId = roundId;
  reportText.textContent = "";
  const res = await fetch(`/api/rounds/${roundId}`);
  const data = await res.json();
  currentMatches = (data.matches ?? []).map((m: any) => ({
    seq: m.seq,
    league: m.league,
    home: m.home,
    away: m.away,
    raw: {
      eloDiff: m.raw.eloDiff,
      formDiff: m.raw.formDiff,
      h2hDiff: m.raw.h2hDiff,
      nH2h: m.raw.nH2h,
      leagueDrawRate: m.raw.leagueDrawRate,
      market: m.raw.market ?? null,
      xgDiff: m.raw.xgDiff ?? null,
      cornersDiff: m.raw.cornersDiff ?? null,
    },
    result: m.result ?? null,
    voteShare: m.voteShare ?? null,
  }));
  renderMatches();
  renderCombos();
}

roundSelect.addEventListener("change", () => {
  const id = Number(roundSelect.value);
  if (id) loadRound(id);
});

budgetBtn.addEventListener("click", () => {
  const budget = Number(budgetInput.value);
  if (!budget || budget < 1000) return;
  const comboMatches = toComboMatches();
  const guaranteeDrawCount = Number(drawGuaranteeSelect.value) || 0;
  const plan = generateSystemBet(comboMatches, budget, undefined, { guaranteeDrawCount });
  const box = document.createElement("div");
  renderComboPlan(box, `직접 입력 ${budget.toLocaleString()}원`, plan);
  comboTiersEl.prepend(box.firstElementChild as HTMLElement);
});

drawGuaranteeSelect.addEventListener("change", () => {
  renderCombos();
});

upsetCountSelect.addEventListener("change", () => {
  renderExclusivePick();
});

drawForceSelect.addEventListener("change", () => {
  renderExclusivePick();
});

function switchTab(tabName: string) {
  for (const btn of tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  }
  for (const page of tabPages) {
    page.hidden = page.dataset.tab !== tabName;
  }
}

for (const btn of tabButtons) {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab!));
}

reportBtn.addEventListener("click", async () => {
  if (!currentRoundId) return;
  reportBtn.disabled = true;
  reportText.textContent = "리포트 생성 중...";
  try {
    const res = await fetch(`/api/rounds/${currentRoundId}/report`);
    const data = await res.json();
    reportText.textContent = data.report ?? data.error ?? "리포트를 가져오지 못했습니다.";
  } catch {
    reportText.textContent = "리포트를 가져오지 못했습니다.";
  } finally {
    reportBtn.disabled = false;
  }
});

renderToggles();
loadRounds();
loadSettlement();
