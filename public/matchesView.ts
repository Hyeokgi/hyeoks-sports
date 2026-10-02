// 앱 상단 영역 전환(승무패 회차 ↔ 경기 분석)과 '경기 분석' 화면.
// 승무패 회차 화면(app.ts)은 그대로 두고, 이 모듈이 전환 버튼·경기 목록·회차 카드의 '경기 분석 →' 링크만 맡는다.
// 경기 카드를 누르면 별도 경기 페이지(/match/:slug)로 간다(검색 유입·공유용 주소를 그대로 쓰기 위해, 사용자 결정 2026-09-27).

export interface MatchCard {
  slug: string;
  league: string;
  leagueName: string;
  competition: string | null;
  kickoffAt: string;
  home: string;
  away: string;
  // 검색용 영문명(FotMob 표기, 국가대표는 결과 데이터셋 표기). 예전 응답에는 없을 수 있다.
  homeEn?: string;
  awayEn?: string;
  homeLogo: string | null;
  awayLogo: string | null;
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: "홈승" | "무승부" | "원정승";
  basisLabel: string;
  status: string;
  hg: number | null;
  ag: number | null;
  round: { roundNo: number; seq: number } | null;
}

import { teamIndex, searchTeams, type TeamEntry } from "../src/lib/teamSearch";
import { stepIndex } from "../src/lib/swipe";
import { attachSwipe, slideIn } from "./swipe";

type Mode = "round" | "match";
type DayFilter = "today" | "tomorrow" | "week" | "past";

// 리그 칩 순서. 목록에 경기가 있는 리그만 보여준다.
const LEAGUE_ORDER = ["국가대표", "EPL", "라리가", "세리에A", "분데스리가", "K리그1", "K리그2", "J1리그", "MLS"];
const LEAGUE_LABEL: Record<string, string> = { EPL: "프리미어리그" };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3);
const kstDay = (t: number) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
function whenText(iso: string): string {
  const k = kst(iso);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${DOW[k.getUTCDay()]}) ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}

let cards: MatchCard[] | null = null;
let loading: Promise<MatchCard[]> | null = null;
let league = "all";
// 경기 분석의 홈은 '오늘'(2026-10-02 사용자 요청). 오늘 경기가 없으면 빈 화면에서 7일 보기로 안내한다.
let day: DayFilter = "today";
const DAY_ORDER: DayFilter[] = ["today", "tomorrow", "week", "past"];
let trackFn: (e: string) => void = () => {};
let team: string | null = null; // 팀·국가 검색으로 고른 팀(있으면 리그·날짜 필터 대신 그 팀 경기 전체)

export function loadMatchCards(): Promise<MatchCard[]> {
  if (cards) return Promise.resolve(cards);
  if (!loading) {
    loading = fetch("/api/matches")
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((d) => (cards = (d.matches ?? []) as MatchCard[]))
      .catch(() => (cards = []));
  }
  return loading;
}

/** 회차 카드(app.ts renderMatches)에 '경기 분석 →' 링크를 붙인다. 경기 페이지가 있는 경기만. */
export async function decorateRoundCards(roundNo: number | null | undefined): Promise<void> {
  if (roundNo == null) return;
  const list = await loadMatchCards();
  const bySeq = new Map(list.filter((c) => c.round?.roundNo === roundNo).map((c) => [c.round!.seq, c.slug]));
  for (const card of Array.from(document.querySelectorAll<HTMLElement>("#match-list .match-card[data-seq]"))) {
    const slug = bySeq.get(Number(card.dataset.seq));
    const line = card.querySelector<HTMLElement>(".pick-line");
    if (!slug || !line || line.querySelector(".to-match")) continue;
    const a = document.createElement("a");
    a.className = "to-match";
    a.href = `/match/${slug}?utm_source=app`;
    a.textContent = "경기 분석 →";
    a.addEventListener("click", () => trackFn("round_to_match"));
    line.appendChild(a);
  }
}

function crest(name: string, src: string | null): string {
  if (src) return `<span class="mx-crest${src.startsWith("/flags/") ? " flag" : ""}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></span>`;
  const ini = name.replace(/\s|FC|SC|CF/g, "").slice(0, 2) || "?";
  return `<span class="mx-crest mono" aria-hidden="true">${esc(ini)}</span>`;
}

function cardHtml(c: MatchCard): string {
  const P = [c.pHome, c.pDraw, c.pAway];
  const top = ["홈승", "무승부", "원정승"].indexOf(c.pick);
  const done = c.status === "finished" && c.hg != null && c.ag != null;
  const actual = done ? (c.hg! > c.ag! ? 0 : c.hg === c.ag ? 1 : 2) : -1;
  const label = c.competition ?? LEAGUE_LABEL[c.league] ?? c.leagueName;
  const center = done ? `<div class="mx-score">${c.hg} : ${c.ag}</div>` : `<div class="mx-vs">VS</div>`;
  const resultTag = done ? `<span class="mx-res ${actual === top ? "hit" : "miss"}">${actual === top ? "확률 1위 적중" : "다른 결과"}</span>` : "";
  return (
    `<a class="mx-card" href="/match/${esc(c.slug)}?utm_source=app" data-slug="${esc(c.slug)}">` +
    `<div class="mx-top"><span class="mx-lg">${esc(label)}</span><span>${whenText(c.kickoffAt)}</span>` +
    (c.round ? `<span class="mx-rnd">승무패 ${c.round.roundNo}회차 ${c.round.seq}번</span>` : "") +
    resultTag +
    `</div>` +
    `<div class="mx-teams"><div class="mx-team">${crest(c.home, c.homeLogo)}<span>${esc(c.home)}</span></div>${center}` +
    `<div class="mx-team r"><span>${esc(c.away)}</span>${crest(c.away, c.awayLogo)}</div></div>` +
    `<div class="mx-probs">${["홈승", "무", "원정승"].map((l, i) => `<div class="mx-p${i === top ? " top" : ""}${i === actual ? (actual === top ? " act" : " act miss") : ""}">${l}<b>${pct(P[i])}</b></div>`).join("")}</div>` +
    `<div class="mx-bar"><i style="width:${(P[0] * 100).toFixed(1)}%"></i><i style="width:${(P[1] * 100).toFixed(1)}%"></i><i style="width:${(P[2] * 100).toFixed(1)}%"></i></div>` +
    `<div class="mx-foot"><span>확률 출처 · ${esc(c.basisLabel)}</span><span class="mx-more">자세히 →</span></div>` +
    `</a>`
  );
}

function filtered(list: MatchCard[], now: number): MatchCard[] {
  if (team) {
    // 팀을 고르면 리그·날짜와 상관없이 그 팀 경기 전체: 예정(가까운 순) 다음 지난 결과(최근 순)
    const mine = list.filter((c) => c.home === team || c.away === team);
    const up = mine.filter((c) => c.status !== "finished").sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt));
    const done = mine.filter((c) => c.status === "finished").sort((a, b) => Date.parse(b.kickoffAt) - Date.parse(a.kickoffAt));
    return [...up, ...done];
  }
  const today = kstDay(now);
  const tomorrow = kstDay(now + 86400e3);
  return list.filter((c) => {
    if (league !== "all" && c.league !== league) return false;
    const t = Date.parse(c.kickoffAt);
    const d = kstDay(t);
    if (day === "past") return c.status === "finished";
    if (c.status === "finished") return false;
    if (day === "today") return d === today;
    if (day === "tomorrow") return d === tomorrow;
    return t > now - 3 * 3600e3;
  });
}

function render(): void {
  const root = document.getElementById("mx-list");
  const chipsEl = document.getElementById("mx-leagues");
  const daysEl = document.getElementById("mx-days");
  if (!root || !chipsEl || !daysEl) return;
  if (!cards) {
    root.innerHTML = `<div class="mx-empty">경기 목록을 불러오는 중입니다…</div>`;
    return;
  }
  const now = Date.now();
  const present = LEAGUE_ORDER.filter((l) => cards!.some((c) => c.league === l));
  if (league !== "all" && !present.includes(league)) league = "all";
  chipsEl.innerHTML = [["all", "전체"], ...present.map((l) => [l, LEAGUE_LABEL[l] ?? l])]
    .map(([k, n]) => `<button type="button" class="mx-chip${k === league ? " on" : ""}" data-league="${esc(k)}">${esc(n)}</button>`)
    .join("");
  const days: [DayFilter, string, string][] = [
    ["today", "오늘", kstDay(now).slice(5).replace("-", "/")],
    ["tomorrow", "내일", kstDay(now + 86400e3).slice(5).replace("-", "/")],
    ["week", "7일", "예정 전체"],
    ["past", "지난 결과", "최근 2주"],
  ];
  daysEl.innerHTML = days
    .map(([k, a, b]) => `<button type="button" class="mx-day${k === day ? " on" : ""}" data-day="${k}"><b>${a}</b>${esc(b)}</button>`)
    .join("");

  const teamEl = document.getElementById("mx-team");
  if (teamEl) {
    teamEl.hidden = !team;
    teamEl.innerHTML = team
      ? `<span>${esc(team)} 경기만 보는 중</span><button type="button" data-clear-team aria-label="팀 선택 해제">전체 보기 ✕</button>`
      : "";
  }
  chipsEl.classList.toggle("dim", !!team);
  daysEl.classList.toggle("dim", !!team);

  const list = filtered(cards, now);
  if (!team && day === "past") list.reverse();
  if (team) {
    root.innerHTML = list.length
      ? `<div class="mx-h"><h3>${esc(team)}</h3><span>${list.length}경기 · 예정 먼저, 지난 결과는 최근 순</span></div>` + list.map(cardHtml).join("")
      : `<div class="mx-empty">${esc(team)}의 경기가 목록에 없습니다.</div>`;
    return;
  }
  if (list.length === 0) {
    root.innerHTML =
      `<div class="mx-empty">${day === "past" ? "최근 2주 동안 끝난 경기가 없습니다." : "조건에 맞는 예정 경기가 없습니다."}` +
      `<br><span>리그 휴식기(A매치 기간)일 수 있습니다. 다른 날짜나 리그를 골라 보세요.</span>` +
      (day === "today" || day === "tomorrow" ? `<br><button type="button" class="mx-empty-btn" data-day="week">7일 일정 보기</button>` : "") +
      `</div>`;
    return;
  }
  const groups = new Map<string, MatchCard[]>();
  for (const c of list) groups.set(c.league, [...(groups.get(c.league) ?? []), c]);
  const order = [...groups.keys()].sort((a, b) => LEAGUE_ORDER.indexOf(a) - LEAGUE_ORDER.indexOf(b));
  root.innerHTML = order
    .map((lg) => {
      const g = groups.get(lg)!;
      const inRound = g.filter((c) => c.round).length;
      return (
        `<div class="mx-h"><h3>${esc(LEAGUE_LABEL[lg] ?? g[0].leagueName)}</h3><span>${g.length}경기${inRound ? ` · 승무패 포함 ${inRound}` : ""}` +
        `</span></div>` +
        g.map(cardHtml).join("")
      );
    })
    .join("");
}

/** 지금 경기 분석 화면인가. */
export function isMatchMode(): boolean {
  return document.body.classList.contains("mode-match");
}

/** 경기 분석의 홈: 오늘 · 전체 리그 · 팀 선택 해제. */
export function goMatchHome(): void {
  day = "today";
  league = "all";
  team = null;
  render();
  scrollTo({ top: 0, behavior: "smooth" });
}

/** 스와이프로 날짜 탭 넘기기(오늘 → 내일 → 7일 → 지난 결과). */
function swipeDay(dir: "next" | "prev"): void {
  const cur = DAY_ORDER.indexOf(day);
  const next = stepIndex(cur, DAY_ORDER.length, dir);
  if (next === cur) return;
  day = DAY_ORDER[next];
  team = null;
  render();
  slideIn(document.getElementById("mx-list"), dir);
  document.querySelector(`#mx-days button[data-day="${day}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function applyMode(mode: Mode, record: boolean): void {
  document.body.classList.toggle("mode-match", mode === "match");
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>(".mode-seg button"))) {
    const on = b.dataset.mode === mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  }
  const view = document.getElementById("matches-view");
  if (view) view.hidden = mode !== "match";
  const title = document.querySelector(".topbar h1");
  const sub = document.querySelector(".topbar .brand-sub");
  if (title) title.textContent = mode === "match" ? "HYEOKS 축구" : "HYEOKS 축구토토";
  if (sub) sub.textContent = mode === "match" ? "경기별 확률 · 실측 검증" : "승무패 예측 · 실측 검증";
  try {
    localStorage.setItem("hs_mode", mode);
  } catch {
    // 저장소를 못 쓰면 매번 기본(회차)으로 연다
  }
  const url = new URL(location.href);
  if (mode === "match") url.searchParams.set("view", "matches");
  else url.searchParams.delete("view");
  history.replaceState(null, "", url.toString());
  if (record) trackFn(mode === "match" ? "mode_match" : "mode_round");
  if (mode === "match") {
    render();
    loadMatchCards().then(render);
    scrollTo(0, 0);
  }
}

function initSearch(): void {
  const input = document.getElementById("mx-search") as HTMLInputElement | null;
  const box = document.getElementById("mx-suggest") as HTMLUListElement | null;
  if (!input || !box) return;
  let items: TeamEntry[] = [];
  let active = -1;
  const close = () => {
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const choose = (name: string) => {
    team = name;
    input.value = "";
    close();
    input.blur();
    trackFn("team_search");
    render();
    scrollTo({ top: 0, behavior: "smooth" });
  };
  const paint = () => {
    if (!cards) return;
    const q = input.value.trim();
    items = searchTeams(teamIndex(cards), q).slice(0, 60);
    if (items.length === 0) {
      box.innerHTML = `<li class="mx-sg-empty">'${esc(q)}'에 맞는 팀·국가가 이번 목록에 없습니다</li>`;
    } else {
      box.innerHTML =
        (q ? "" : `<li class="mx-sg-head">예정 경기가 많은 순 · 스크롤해서 고르세요</li>`) +
        items
          .map((e, i) =>
            `<li role="option" id="mx-sg-${i}" class="mx-sg${i === active ? " on" : ""}" data-team="${esc(e.name)}" aria-selected="${i === active}">` +
            `${crest(e.name, e.logo)}<span class="nm">${esc(e.name)}</span>` +
            `<span class="lg">${esc(LEAGUE_LABEL[e.league] ?? e.league)}</span><span class="ct">${e.upcoming ? `예정 ${e.upcoming}` : `결과 ${e.total}`}</span></li>`,
          )
          .join("");
    }
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", `mx-sg-${active}`);
      document.getElementById(`mx-sg-${active}`)?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  input.addEventListener("focus", () => {
    void loadMatchCards().then(paint);
  });
  input.addEventListener("input", () => {
    active = -1;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      active = Math.min(items.length - 1, active + 1);
      paint();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(0, active - 1);
      paint();
      e.preventDefault();
    } else if (e.key === "Enter") {
      const pick = items[active >= 0 ? active : 0];
      if (pick) choose(pick.name);
      e.preventDefault();
    } else if (e.key === "Escape") close();
  });
  // mousedown: blur보다 먼저 받아야 목록이 닫히기 전에 고를 수 있다(터치도 같은 순서로 온다).
  box.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-team]");
    if (li) {
      e.preventDefault();
      choose(li.dataset.team!);
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  document.getElementById("mx-team")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-clear-team]")) {
      team = null;
      render();
    }
  });
}

export function initModeSwitch(track: (e: string) => void): void {
  trackFn = track;
  const q = new URLSearchParams(location.search);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("hs_mode");
  } catch {
    saved = null;
  }
  // ?round=N(블로그·분석 글 링크)으로 들어오면 회차 화면이 우선이다.
  const initial: Mode = q.get("view") === "matches" ? "match" : q.get("round") ? "round" : saved === "match" ? "match" : "round";
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>(".mode-seg button"))) {
    b.addEventListener("click", () => applyMode(b.dataset.mode as Mode, true));
  }
  document.getElementById("mx-leagues")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-league]");
    if (!b) return;
    league = b.dataset.league!;
    team = null;
    render();
  });
  document.getElementById("mx-days")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-day]");
    if (!b) return;
    day = b.dataset.day as DayFilter;
    team = null;
    render();
  });
  document.getElementById("mx-list")?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".mx-card")) trackFn("match_card_click");
    const empty = t.closest<HTMLButtonElement>(".mx-empty-btn[data-day]");
    if (empty) {
      day = empty.dataset.day as DayFilter;
      render();
    }
  });
  const view = document.getElementById("matches-view");
  if (view) attachSwipe(view, swipeDay, isMatchMode);
  initSearch();
  applyMode(initial, false);
}
