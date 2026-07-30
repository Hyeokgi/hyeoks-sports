// 프론트엔드 로직: 회차 조회, 변수 토글(클라이언트 즉시 재계산), 예산별 조합, AI 리포트
import { predictMatch, DEFAULT_TOGGLES, type PredictionToggles, type PredictionInputs } from "../src/lib/prediction";
import { generateSystemBetTiers, DEFAULT_BUDGET_TIERS, generateSystemBet, type ComboMatch } from "../src/lib/combinations";

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
  };
}

const TOGGLE_LABELS: { key: keyof PredictionToggles; label: string; kind: "bool" }[] = [
  { key: "useElo", label: "Elo 전력차", kind: "bool" },
  { key: "useForm", label: "최근 폼(5경기)", kind: "bool" },
  { key: "useH2H", label: "상대전적(H2H)", kind: "bool" },
  { key: "useHomeAdvantage", label: "홈 어드밴티지", kind: "bool" },
  { key: "useLeagueDrawRate", label: "리그별 무승부율", kind: "bool" },
  { key: "useClosenessDrawAdjustment", label: "격차 보정 무승부율", kind: "bool" },
  { key: "useMarketOdds", label: "해외 배당 반영", kind: "bool" },
  { key: "useXG", label: "기대득점(xG, K리그1만)", kind: "bool" },
];

let currentMatches: MatchData[] = [];
let currentToggles: PredictionToggles = { ...DEFAULT_TOGGLES };
let currentRoundId: number | null = null;

const roundSelect = document.getElementById("round-select") as HTMLSelectElement;
const toggleGrid = document.getElementById("toggle-grid") as HTMLDivElement;
const matchList = document.getElementById("match-list") as HTMLDivElement;
const comboTiersEl = document.getElementById("combo-tiers") as HTMLDivElement;
const budgetInput = document.getElementById("budget-input") as HTMLInputElement;
const budgetBtn = document.getElementById("budget-custom-btn") as HTMLButtonElement;
const reportBtn = document.getElementById("report-btn") as HTMLButtonElement;
const reportText = document.getElementById("report-text") as HTMLParagraphElement;
const drawGuaranteeSelect = document.getElementById("draw-guarantee-select") as HTMLSelectElement;
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

function renderMatches() {
  matchList.innerHTML = "";
  for (const m of currentMatches) {
    const prediction = predictMatch(toInputs(m), currentToggles);
    const card = document.createElement("div");
    card.className = "match-card";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<span class="league-badge">${m.seq}경기 · ${m.league}</span><span class="confidence-badge">확신도 ${(prediction.confidenceGap * 100).toFixed(1)}%p</span>`;
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
    pick.innerHTML = `모델 추천 <b>${prediction.rankedPicks[0]}</b>${marketNote}${xgNote}`;
    card.appendChild(pick);

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
    },
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
