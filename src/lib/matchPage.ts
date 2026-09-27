// 경기별 분석 페이지(docs/specs/002-match-pages.md) 2단계: /match/{slug}, /match/{slug}/data.json, /league/{slug}
//
// 원칙
// - 베팅 추천 페이지가 아니다. 단식·복식·조합·배당 추천 같은 말을 쓰지 않는다(테스트로 막는다).
// - 확률의 출처를 항상 표시한다. 승무패 회차에 포함된 경기는 회차와 같은 확률(배당 반영)을 보여준다.
// - 킥오프가 지난 경기는 킥오프 전에 저장한 확률로 보여주고 결과와 나란히 둔다.
import { buildRoundPredictions } from "./predictRound";
import { getPredictionSnapshots } from "./predictionSnapshot";
import { analyzeMatch } from "./matchAnalysis";
import { findCalibrationBucket } from "./calibration";
import { TEAM_LOGOS } from "./teamLogos";
import { teamKr } from "./fixtures";
import { displayTeamName, leagueInfo, leagueBySlug, LEAGUE_INFO } from "./teamNames";
import { DISCLAIMER, escapeHtml as e } from "./roundArticle";
import type { Env } from "../types";

const SITE = "https://hyeoks.com";
const OUT = ["홈승", "무승부", "원정승"] as const;
type Outcome = (typeof OUT)[number];

export interface MatchRow {
  id: number;
  league: string;
  fotmob_id: number;
  kickoff_at: string;
  home_en: string;
  away_en: string;
  slug: string;
  status: string;
  hg: number | null;
  ag: number | null;
  updated_at: string;
  elo_diff: number;
  form_diff: number;
  h2h_diff: number;
  n_h2h: number;
  league_draw_rate: number;
  p_home: number;
  p_draw: number;
  p_away: number;
  pick: string;
  basis: string;
  confidence_gap: number;
  tier: string | null;
  computed_at: string;
}

export interface MatchView {
  slug: string;
  league: string;
  leagueName: string;
  leagueSlug: string;
  kickoffAt: string;
  home: string;
  away: string;
  homeLogo: string | null;
  awayLogo: string | null;
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: Outcome;
  confidenceGap: number;
  basisLabel: string;
  source: "fixture" | "round";
  withMarket: boolean;
  round: { roundNo: number; seq: number } | null;
  status: string;
  result: { hg: number; ag: number; actual: Outcome } | null;
  reasons: string[];
  risks: string[];
  calib: { accuracy: number; n: number } | null;
  asOf: string;
  siblings: SiblingView[];
}

export interface SiblingView {
  slug: string;
  kickoffAt: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  status: string;
  hg: number | null;
  ag: number | null;
  pick: Outcome;
}

// ---------- 표기 ----------
const pct = (x: number) => `${Math.round(x * 100)}%`;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export function kstLabel(iso: string, withTime = true): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const k = new Date(t + 9 * 3600e3);
  const d = `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일(${DOW[k.getUTCDay()]})`;
  return withTime ? `${d} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}` : d;
}
const outcomeOf = (hg: number, ag: number): Outcome => (hg > ag ? "홈승" : hg === ag ? "무승부" : "원정승");
const whoWins = (o: Outcome, home: string, away: string) => (o === "홈승" ? `${home} 승` : o === "원정승" ? `${away} 승` : "무승부");

/** 검색용 태그(페이지 하단 노출 + 메타 keywords). 사람들이 실제로 치는 형태 위주로 6~8개. */
export function matchTags(v: Pick<MatchView, "home" | "away" | "leagueName" | "league" | "kickoffAt">): string[] {
  const aliases = LEAGUE_INFO[v.league]?.aliases ?? [];
  const day = kstLabel(v.kickoffAt, false).replace(/\(.\)/, "");
  return [
    ...new Set([
      `${v.home} ${v.away} 승부예측`,
      `${v.home} vs ${v.away}`,
      `${v.home} ${v.away} 경기 분석`,
      `${v.leagueName} 승부예측`,
      `${v.leagueName} ${day} 경기`,
      `${v.home} 경기 일정`,
      `${v.away} 경기 일정`,
      ...aliases.slice(0, 1).map((a) => `${a} 경기 분석`),
    ]),
  ];
}

/** 한 줄 요약. 베팅 용어 없이 확률과 확률 차의 크기만 말한다. */
export function neutralSummary(v: Pick<MatchView, "home" | "away" | "pHome" | "pDraw" | "pAway" | "pick" | "confidenceGap">): string {
  const p = v.pick === "홈승" ? v.pHome : v.pick === "원정승" ? v.pAway : v.pDraw;
  const gap = v.confidenceGap * 100;
  const shape = gap >= 20 ? "한쪽으로 뚜렷한 편입니다" : gap >= 10 ? "다소 기운 편입니다" : gap >= 5 ? "비교적 팽팽합니다" : "세 결과가 모두 열려 있는 박빙입니다";
  return `${whoWins(v.pick, v.home, v.away)} 확률이 ${pct(p)}로 가장 높고, 1·2위 확률 차는 ${gap.toFixed(1)}%p로 ${shape}.`;
}

// ---------- 불러오기 ----------
async function findRoundLink(env: Env, row: MatchRow): Promise<{ roundId: number; roundNo: number; seq: number; matchId: number } | null> {
  const hk = teamKr(row.league, row.home_en);
  const ak = teamKr(row.league, row.away_en);
  if (!hk || !ak) return null;
  return await env.DB.prepare(
    `SELECT r.id AS roundId, r.round_no AS roundNo, rm.seq AS seq, rm.id AS matchId
       FROM round_matches rm JOIN rounds r ON r.id = rm.round_id
      WHERE rm.league = ? AND rm.home_kr = ? AND rm.away_kr = ? AND substr(rm.kickoff_at, 1, 10) = substr(?, 1, 10)
        AND r.round_no IS NOT NULL AND r.round_no_confirmed = 1
      ORDER BY r.id DESC LIMIT 1`,
  )
    .bind(row.league, hk, ak, row.kickoff_at)
    .first<{ roundId: number; roundNo: number; seq: number; matchId: number }>();
}

const MATCH_SELECT = `SELECT f.id, f.league, f.fotmob_id, f.kickoff_at, f.home_en, f.away_en, f.slug, f.status, f.hg, f.ag, f.updated_at,
  p.elo_diff, p.form_diff, p.h2h_diff, p.n_h2h, p.league_draw_rate, p.p_home, p.p_draw, p.p_away, p.pick, p.basis,
  p.confidence_gap, p.tier, p.computed_at
  FROM fixtures f JOIN fixture_predictions p ON p.fixture_id = f.id`;

function toSibling(r: MatchRow): SiblingView {
  return {
    slug: r.slug, kickoffAt: r.kickoff_at, home: displayTeamName(r.home_en), away: displayTeamName(r.away_en),
    pHome: r.p_home, pDraw: r.p_draw, pAway: r.p_away, status: r.status, hg: r.hg, ag: r.ag, pick: r.pick as Outcome,
  };
}

export async function loadMatchView(env: Env, slug: string, now = Date.now()): Promise<MatchView | null> {
  const row = await env.DB.prepare(`${MATCH_SELECT} WHERE f.slug = ?`).bind(slug).first<MatchRow>();
  if (!row) return null;
  const home = displayTeamName(row.home_en);
  const away = displayTeamName(row.away_en);
  const hk = teamKr(row.league, row.home_en);
  const ak = teamKr(row.league, row.away_en);

  let probs = { pHome: row.p_home, pDraw: row.p_draw, pAway: row.p_away, gap: row.confidence_gap, pick: row.pick as Outcome };
  let source: MatchView["source"] = "fixture";
  let withMarket = false;
  let round: MatchView["round"] = null;
  // 승무패 회차에 포함된 경기는 회차 화면과 같은 확률을 보여준다(두 곳에서 숫자가 다르면 신뢰를 잃는다).
  try {
    const link = await findRoundLink(env, row);
    if (link) {
      round = { roundNo: link.roundNo, seq: link.seq };
      const started = Date.parse(row.kickoff_at) <= now;
      if (started) {
        const snap = (await getPredictionSnapshots(env, [link.matchId])).get(link.matchId);
        if (snap) {
          const q = snap.prediction;
          probs = { pHome: q.pHome, pDraw: q.pDraw, pAway: q.pAway, gap: q.confidenceGap, pick: q.rankedPicks[0] as Outcome };
          source = "round";
          withMarket = (snap.nBookmakers ?? 0) > 0;
        }
      } else {
        const rp = (await buildRoundPredictions(env, link.roundId)).find((x) => x.match.id === link.matchId);
        if (rp && rp.prediction.basis !== "none") {
          const q = rp.prediction;
          probs = { pHome: q.pHome, pDraw: q.pDraw, pAway: q.pAway, gap: q.confidenceGap, pick: q.rankedPicks[0] as Outcome };
          source = "round";
          withMarket = !!rp.raw.market;
        }
      }
    }
  } catch (err) {
    console.error(`loadMatchView: 회차 연결 실패(경기 예측으로 표시) - ${(err as Error).message}`);
  }

  const bucket = findCalibrationBucket(row.league, probs.gap);
  const a = analyzeMatch(
    {
      home, away, pHome: probs.pHome, pDraw: probs.pDraw, pAway: probs.pAway, pick: probs.pick, confidenceGap: probs.gap,
      basis: "model", vote: null,
      detail: {
        eloDiff: row.elo_diff, formDiff: row.form_diff, h2hDiff: row.h2h_diff, nH2h: row.n_h2h,
        natEloDiff: null, natProbs: null, market: null, marketOpen: null, modelOnly: null,
        calib: bucket ? { accuracy: bucket.accuracy, n: bucket.n, minGap: bucket.minGap, maxGap: bucket.maxGap } : null,
      },
    },
    { avgDraw: row.league_draw_rate },
  );
  // 분석 문장은 회차 글용이라 '이번 회차 평균'이라고 쓴다. 경기 페이지에서는 리그 평균이다.
  const fix = (s: string) => s.replace("이번 회차 평균", "리그 평균");

  const { results: sib } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.league = ? AND f.id != ? AND f.kickoff_at >= ? AND f.kickoff_at <= ? ORDER BY f.kickoff_at ASC LIMIT 12`,
  )
    .bind(row.league, row.id, new Date(now - 2 * 86400e3).toISOString(), new Date(now + 8 * 86400e3).toISOString())
    .all<MatchRow>();

  const li = leagueInfo(row.league);
  return {
    slug: row.slug, league: row.league, leagueName: li.name, leagueSlug: li.slug, kickoffAt: row.kickoff_at, home, away,
    homeLogo: hk ? TEAM_LOGOS[hk] ?? null : null, awayLogo: ak ? TEAM_LOGOS[ak] ?? null : null,
    pHome: probs.pHome, pDraw: probs.pDraw, pAway: probs.pAway, pick: probs.pick, confidenceGap: probs.gap,
    basisLabel: withMarket ? "통계 모델 + 해외 배당" : "통계 모델",
    source, withMarket, round, status: row.status,
    result: row.status === "finished" && row.hg != null && row.ag != null ? { hg: row.hg, ag: row.ag, actual: outcomeOf(row.hg, row.ag) } : null,
    reasons: a.reasons.map(fix), risks: a.risks.map(fix),
    calib: bucket ? { accuracy: bucket.accuracy, n: bucket.n } : null,
    asOf: row.computed_at,
    siblings: (sib ?? []).map(toSibling),
  };
}

export async function loadLeagueView(env: Env, leagueSlug: string, now = Date.now()) {
  const league = leagueBySlug(leagueSlug);
  if (!league) return null;
  const { results: upcoming } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.league = ? AND f.kickoff_at >= ? AND f.status = 'scheduled' ORDER BY f.kickoff_at ASC LIMIT 60`,
  )
    .bind(league, new Date(now - 3 * 3600e3).toISOString())
    .all<MatchRow>();
  const { results: recent } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.league = ? AND f.status = 'finished' AND f.kickoff_at >= ? ORDER BY f.kickoff_at DESC LIMIT 30`,
  )
    .bind(league, new Date(now - 21 * 86400e3).toISOString())
    .all<MatchRow>();
  return { league, info: leagueInfo(league), upcoming: (upcoming ?? []).map(toSibling), recent: (recent ?? []).map(toSibling) };
}

// ---------- 화면 ----------
// 앱(public/style.css)과 같은 어두운 바탕·색 체계. 홈 초록·무 금색·원정 빨강은 앱 범례와 같다.
// 경기 분석 영역은 남보라(인디고)로, 승무패 회차 영역(금색)과 구분한다.
const CSS = `
:root{--bg0:#0a0c12;--bg1:#10131c;--card:rgba(255,255,255,.045);--line:rgba(255,255,255,.09);--ink:#f2f4f8;--muted:#8b93a5;--muted2:#5c6474;
--gold:#f2a93b;--indigo:#8b93ff;--indigo-soft:rgba(129,140,248,.14);--home:#22c55e;--draw:#f2a93b;--away:#ef4444;--hit:#22c55e;--miss:#ef4444}
*{box-sizing:border-box}html{background:var(--bg0)}
body{margin:0;color:var(--ink);font:16px/1.65 "Pretendard Variable","Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-feature-settings:"tnum" 1;
background:radial-gradient(900px 480px at 110% -5%,rgba(99,102,241,.16),transparent 60%),radial-gradient(900px 500px at -10% 0%,rgba(242,169,59,.08),transparent 60%),linear-gradient(180deg,var(--bg1),var(--bg0));background-attachment:fixed;-webkit-font-smoothing:antialiased}
a{color:var(--indigo);text-decoration:none}a:hover{text-decoration:underline}
header.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px max(16px,calc((100% - 760px)/2));background:rgba(10,12,18,.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:9px;color:var(--ink);font-weight:800;font-size:.95rem}.brand i{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#ffc766,#c9791a);display:inline-block}
.switch{display:flex;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:999px;padding:3px;font-size:.8rem;font-weight:700}
.switch a{padding:5px 12px;border-radius:999px;color:var(--muted)}.switch a.on{background:var(--indigo-soft);color:var(--indigo)}
main{max-width:760px;margin:0 auto;padding:14px 16px 56px}
.crumb{font-size:.82rem;color:var(--muted);margin:6px 0 2px}.crumb a{color:var(--muted)}
.eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:.75rem;font-weight:800;letter-spacing:.06em;color:var(--indigo);background:var(--indigo-soft);border-radius:999px;padding:3px 10px;margin-top:10px}
h1{font-size:1.5rem;line-height:1.3;margin:.35em 0 .15em;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:.9rem;margin:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin:14px 0;box-shadow:0 10px 28px rgba(0,0,0,.28)}
h2{font-size:1.02rem;margin:0 0 .6em;display:flex;align-items:center;gap:8px}h2:before{content:"";width:4px;height:16px;border-radius:2px;background:var(--indigo)}
.teams{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;text-align:center;gap:8px}
.team b{display:block;font-size:1.08rem;margin-top:8px;line-height:1.3;word-break:keep-all}.team small{color:var(--muted);font-size:.75rem}
.logo{width:64px;height:64px;border-radius:50%;margin:0 auto;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 0 0 3px rgba(255,255,255,.06)}
.logo img{width:52px;height:52px;object-fit:contain}.mono{background:linear-gradient(135deg,#2b3350,#1b2135);color:#cfd6ff;font-weight:800;font-size:1.2rem}
.mid{font-weight:900;color:var(--muted2);font-size:.95rem}.score{font-size:2rem;font-weight:900;color:var(--ink);letter-spacing:.02em}
.probs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:22px}
.prob{border-radius:14px;padding:11px 6px 10px;text-align:center;background:rgba(255,255,255,.035);border:1px solid var(--line);position:relative}
.prob span{display:block;font-size:.78rem;color:var(--muted);font-weight:700}.prob strong{font-size:1.55rem;font-weight:900;display:block;line-height:1.25}
.prob.top{border-color:rgba(129,140,248,.6);background:var(--indigo-soft)}.prob.top:after{content:"확률 1위";position:absolute;top:-10px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:.66rem;font-weight:800;line-height:1.5;background:var(--indigo);color:#0b0e1a;border-radius:999px;padding:1px 9px}
.prob.act{outline:2px solid var(--hit);outline-offset:-2px}.prob.act.miss{outline-color:var(--miss)}
.bar{display:flex;height:10px;border-radius:6px;overflow:hidden;margin-top:12px;background:rgba(255,255,255,.05)}.bar i{display:block}
.legend{display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:5px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.chip{font-size:.75rem;font-weight:700;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.chip.round{color:var(--gold);border-color:rgba(242,169,59,.45);background:rgba(242,169,59,.08)}
.summary{font-size:1.02rem;font-weight:700;line-height:1.6;margin:0}
ul.list{margin:0;padding-left:1.1em}ul.list li{margin:.35em 0;color:#dfe3ec}
.note{color:var(--muted);font-size:.85rem;margin:.6em 0 0}
.result{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tag-hit,.tag-miss{font-weight:800;border-radius:999px;padding:3px 12px;font-size:.85rem}
.tag-hit{background:rgba(34,197,94,.16);color:var(--hit)}.tag-miss{background:rgba(239,68,68,.16);color:var(--miss)}
.rows a.row{display:grid;grid-template-columns:86px 1fr 92px;gap:10px;align-items:center;padding:10px 4px;border-top:1px solid var(--line);color:var(--ink)}
.rows a.row:first-child{border-top:0}.rows .when{font-size:.78rem;color:var(--muted);line-height:1.35}.rows .vs{font-weight:700;font-size:.92rem;line-height:1.35;word-break:keep-all}
.rows .mini{font-size:.75rem;color:var(--muted);text-align:right}.rows .mini .b{display:flex;height:6px;border-radius:4px;overflow:hidden;margin-top:4px}
.sponsor{border:1px dashed rgba(255,255,255,.18);border-radius:16px;padding:14px 16px;margin:18px 0;min-height:100px}
.sponsor small{font-size:.7rem;font-weight:800;letter-spacing:.12em;color:var(--muted)}.sponsor p{margin:.3em 0}
.tags{display:flex;flex-wrap:wrap;gap:6px}.tags span{font-size:.78rem;color:var(--muted);background:rgba(255,255,255,.04);border-radius:8px;padding:3px 9px}
.cta{display:inline-flex;align-items:center;gap:6px;margin-top:4px;padding:10px 16px;border-radius:12px;background:var(--indigo-soft);border:1px solid rgba(129,140,248,.45);color:var(--indigo);font-weight:800}
.foot{color:var(--muted2);font-size:.8rem;text-align:center;margin-top:26px}.foot a{color:var(--muted)}
.disc{color:var(--muted);font-size:.8rem;line-height:1.6;margin-top:18px}
@media (max-width:420px){h1{font-size:1.3rem}.logo{width:54px;height:54px}.logo img{width:44px;height:44px}.prob strong{font-size:1.35rem}.rows a.row{grid-template-columns:70px 1fr 78px}}
`;

function logoHtml(name: string, src: string | null): string {
  if (src) return `<div class="logo"><img src="${e(src)}" alt="${e(name)} 엠블럼" width="52" height="52" loading="lazy"></div>`;
  const ini = name.replace(/\s|FC|SC|CF/g, "").slice(0, 2) || "?";
  return `<div class="logo mono" aria-hidden="true">${e(ini)}</div>`;
}
function barHtml(ph: number, pd: number, pa: number, h = 10): string {
  return `<div class="bar" style="height:${h}px"><i style="width:${(ph * 100).toFixed(1)}%;background:var(--home)"></i><i style="width:${(pd * 100).toFixed(1)}%;background:var(--draw)"></i><i style="width:${(pa * 100).toFixed(1)}%;background:var(--away)"></i></div>`;
}
function rowHtml(s: SiblingView): string {
  const right = s.status === "finished" && s.hg != null && s.ag != null
    ? `<b style="color:var(--ink);font-size:.95rem">${s.hg} : ${s.ag}</b>`
    : `${s.pick === "무승부" ? "무" : s.pick} ${pct(s.pick === "홈승" ? s.pHome : s.pick === "원정승" ? s.pAway : s.pDraw)}`;
  return `<a class="row" href="/match/${e(s.slug)}"><span class="when">${e(kstLabel(s.kickoffAt, false))}<br>${e(kstLabel(s.kickoffAt).slice(-5))}</span><span class="vs">${e(s.home)}<br><span style="color:var(--muted);font-weight:600">vs</span> ${e(s.away)}</span><span class="mini">${right}${barHtml(s.pHome, s.pDraw, s.pAway, 6).replace('class="bar"', 'class="b"')}</span></a>`;
}
function header(active: "match" | "round"): string {
  return `<header class="top"><a class="brand" href="/"><i></i>HYEOKS</a><nav class="switch" aria-label="영역 전환"><a href="/"${active === "round" ? ' class="on"' : ""}>승무패 회차</a><a href="/matches"${active === "match" ? ' class="on"' : ""}>경기 분석</a></nav></header>`;
}
const SPONSOR = `<aside class="sponsor" aria-label="스폰서"><small>SPONSOR</small><p><b>이 자리의 파트너를 찾습니다</b></p><p class="note" style="margin:0">스포츠 미디어·데이터 서비스·축구 용품 브랜드를 위한 자리입니다. 불법 도박·사설 토토 광고는 받지 않습니다. <a href="https://blog.naver.com/beauty017/224423344071" rel="noopener">제휴·광고 안내 →</a></p></aside>`;
const FOOT = `<p class="foot"><a href="/">웹앱</a> · <a href="/about">서비스 소개</a> · <a href="/privacy">개인정보처리방침</a> · <a href="https://blog.naver.com/beauty017" rel="noopener">블로그</a></p>`;
const beacon = (event: string) => `<script>(function(){try{var q=new URLSearchParams(location.search);var d={e:${JSON.stringify(event)},u:q.get("utm_source"),ref:document.referrer};navigator.sendBeacon("/api/e",JSON.stringify(d))}catch(_){}})();</script>`;

export function matchTitle(v: Pick<MatchView, "home" | "away" | "leagueName" | "kickoffAt">): string {
  return `${v.home} vs ${v.away} 승부예측 · ${kstLabel(v.kickoffAt, false).replace(/\(.\)/, "")} ${v.leagueName} 확률 분석 | HYEOKS`;
}

export function renderMatchPage(v: MatchView): string {
  const title = matchTitle(v);
  const top = v.pick;
  const pOf = (o: Outcome) => (o === "홈승" ? v.pHome : o === "원정승" ? v.pAway : v.pDraw);
  const desc = `${kstLabel(v.kickoffAt)} ${v.leagueName} ${v.home} vs ${v.away}. ${whoWins(top, v.home, v.away)} ${pct(pOf(top))}, 무승부 ${pct(v.pDraw)}. 확률 근거와 변수, 같은 리그 다른 경기까지 정리했습니다.`;
  const url = `${SITE}/match/${v.slug}`;
  const tags = matchTags(v);
  const hit = v.result ? v.result.actual === top : null;
  const probBox = (o: Outcome, label: string) => {
    const cls = ["prob", o === top ? "top" : "", v.result && v.result.actual === o ? `act${hit ? "" : " miss"}` : ""].filter(Boolean).join(" ");
    return `<div class="${cls}"><span>${e(label)}</span><strong>${pct(pOf(o))}</strong></div>`;
  };
  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "SportsEvent", name: `${v.home} vs ${v.away}`, sport: "Soccer",
      startDate: v.kickoffAt, eventStatus: v.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      homeTeam: { "@type": "SportsTeam", name: v.home }, awayTeam: { "@type": "SportsTeam", name: v.away },
      superEvent: { "@type": "SportsEvent", name: v.leagueName }, url,
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "HYEOKS", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: `${v.leagueName} 경기 분석`, item: `${SITE}/league/${v.leagueSlug}` },
        { "@type": "ListItem", position: 3, name: `${v.home} vs ${v.away}`, item: url },
      ],
    },
  ];
  const limits = [
    ...v.risks,
    v.withMarket ? "" : "해외 배당은 반영하지 않은 통계 모델 확률입니다.",
    "선발 명단·부상·로테이션 같은 경기 직전 정보는 반영되지 않습니다.",
  ].filter(Boolean);

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}">
<meta name="keywords" content="${e(tags.join(", "))}">
<link rel="canonical" href="${e(url)}">
<meta property="og:type" content="article"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(url)}">
<meta name="theme-color" content="#0a0c12">
<link rel="stylesheet" href="/fonts/pretendard/pretendard.css">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
<style>${CSS}</style></head>
<body>${header("match")}
<main>
<p class="crumb"><a href="/">HYEOKS</a> › <a href="/league/${e(v.leagueSlug)}">${e(v.leagueName)}</a> › ${e(v.home)} vs ${e(v.away)}</p>
<span class="eyebrow">경기 분석 · ${e(v.leagueName)}</span>
<h1>${e(v.home)} vs ${e(v.away)} 승부예측</h1>
<p class="sub">${e(kstLabel(v.kickoffAt))} KST · 확률 기준 ${e(kstLabel(v.asOf))}</p>

<section class="card" aria-label="확률">
<div class="teams">
<div class="team">${logoHtml(v.home, v.homeLogo)}<b>${e(v.home)}</b><small>홈</small></div>
${v.result ? `<div class="score">${v.result.hg} : ${v.result.ag}</div>` : `<div class="mid">VS</div>`}
<div class="team">${logoHtml(v.away, v.awayLogo)}<b>${e(v.away)}</b><small>원정</small></div>
</div>
<div class="probs">${probBox("홈승", "홈승")}${probBox("무승부", "무승부")}${probBox("원정승", "원정승")}</div>
${barHtml(v.pHome, v.pDraw, v.pAway)}
<div class="legend"><span>홈승</span><span>무승부</span><span>원정승</span></div>
<div class="chips"><span class="chip">확률 출처 · ${e(v.basisLabel)}</span><span class="chip">1·2위 차 ${(v.confidenceGap * 100).toFixed(1)}%p</span>${v.round ? `<a class="chip round" href="/round/${v.round.roundNo}">승무패 ${v.round.roundNo}회차 ${v.round.seq}번 경기 →</a>` : ""}</div>
<p class="note">확률은 반올림하여 합계가 100%와 다를 수 있습니다. 확률 1위는 가능성이 가장 높은 결과일 뿐 확정이 아닙니다.</p>
</section>

${v.result ? `<section class="card"><h2>경기 결과</h2><div class="result"><b>${e(v.home)} ${v.result.hg} : ${v.result.ag} ${e(v.away)}</b><span class="${hit ? "tag-hit" : "tag-miss"}">${hit ? "확률 1위 적중" : "확률 1위와 다른 결과"}</span></div><p class="note">킥오프 전 확률 1위는 ${e(whoWins(top, v.home, v.away))}(${pct(pOf(top))})였고, 실제 결과는 ${e(whoWins(v.result.actual, v.home, v.away))}였습니다. 킥오프 전에 공개한 확률은 바꾸지 않습니다.</p></section>` : v.status === "cancelled" ? `<section class="card"><h2>경기 취소·연기</h2><p class="note" style="margin:0">이 경기는 취소되거나 연기됐습니다.</p></section>` : ""}

<section class="card"><h2>한 줄 요약</h2><p class="summary">${e(neutralSummary(v))}</p>${v.calib ? `<p class="note">이 리그에서 같은 확률 차 구간의 과거 확률 1위 적중률은 ${pct(v.calib.accuracy)}입니다(${v.calib.n.toLocaleString("ko-KR")}경기 검증).</p>` : ""}</section>

<section class="card"><h2>근거</h2><ul class="list">${v.reasons.length ? v.reasons.map((r) => `<li>${e(r)}</li>`).join("") : "<li>확률 차를 설명할 뚜렷한 근거 신호가 없습니다.</li>"}</ul></section>

<section class="card"><h2>변수와 한계</h2><ul class="list">${limits.map((r) => `<li>${e(r)}</li>`).join("")}</ul></section>

${v.siblings.length ? `<section class="card"><h2>${e(v.leagueName)} 다른 경기</h2><div class="rows">${v.siblings.map(rowHtml).join("")}</div><p class="note"><a href="/league/${e(v.leagueSlug)}">${e(v.leagueName)} 경기 전체 보기 →</a></p></section>` : ""}

<section class="card"><h2>이 확률은 어떻게 계산하나요</h2><p class="note" style="margin:0">리그별 Elo 전력 지수, 최근 5경기 흐름, 맞대결 기록, 리그 무승부율로 계산합니다. 승무패 회차에 포함된 경기는 해외 배당을 함께 반영한 회차 확률을 그대로 보여줍니다. 새 요소는 과거 경기를 시간순으로 나눈 검증에서 나빠지지 않을 때만 반영합니다.</p>
<p style="margin:12px 0 0"><a class="cta" href="/?utm_source=match_page">웹앱에서 더 보기 →</a></p></section>

${SPONSOR}

<section aria-label="관련 검색어"><p class="note" style="margin:0 0 6px">관련 검색어</p><div class="tags">${tags.map((t) => `<span>#${e(t)}</span>`).join("")}</div></section>

<p class="disc">${e(DISCLAIMER)}</p>
${FOOT}
</main>
${beacon("match_view")}
</body></html>`;
}

export function renderLeaguePage(d: NonNullable<Awaited<ReturnType<typeof loadLeagueView>>>): string {
  const n = d.info.name;
  const title = `${n} 승부예측 · 이번 주 경기 확률 분석 | HYEOKS`;
  const url = `${SITE}/league/${d.info.slug}`;
  const desc = `${n} 이번 주 경기별 홈승·무승부·원정승 확률과 근거, 지난 경기 결과를 한곳에 모았습니다.`;
  const tags = [...new Set([`${n} 승부예측`, `${n} 경기 분석`, `${n} 일정`, `${n} 경기 결과`, ...d.info.aliases.map((a) => `${a} 승부예측`)])];
  const byDay = new Map<string, SiblingView[]>();
  for (const s of d.upcoming) {
    const k = kstLabel(s.kickoffAt, false);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const hits = d.recent.filter((s) => s.hg != null && s.ag != null && outcomeOf(s.hg, s.ag) === s.pick).length;
  const others = Object.entries(LEAGUE_INFO).filter(([k]) => k !== d.league).map(([, v]) => `<a class="chip" href="/league/${v.slug}">${e(v.name)}</a>`).join("");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}"><meta name="keywords" content="${e(tags.join(", "))}">
<link rel="canonical" href="${e(url)}"><meta property="og:type" content="website"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(url)}">
<meta name="theme-color" content="#0a0c12"><link rel="stylesheet" href="/fonts/pretendard/pretendard.css"><style>${CSS}</style></head>
<body>${header("match")}
<main>
<p class="crumb"><a href="/">HYEOKS</a> › ${e(n)}</p>
<span class="eyebrow">경기 분석</span>
<h1>${e(n)} 승부예측</h1>
<p class="sub">${e(d.info.country)} · 이번 주 경기 확률과 지난 경기 결과</p>
<div class="chips" style="margin-top:10px">${others}</div>
${byDay.size ? [...byDay.entries()].map(([day, list]) => `<section class="card"><h2>${e(day)}</h2><div class="rows">${list.map(rowHtml).join("")}</div></section>`).join("") : `<section class="card"><h2>예정 경기</h2><p class="note" style="margin:0">앞으로 7일 안에 예정된 경기가 없습니다. 리그 휴식기(A매치 기간 등)일 수 있습니다.</p></section>`}
${d.recent.length ? `<section class="card"><h2>지난 경기 결과</h2><p class="note" style="margin:0 0 6px">최근 3주 ${d.recent.length}경기 중 킥오프 전 확률 1위가 맞은 경기 ${hits}경기</p><div class="rows">${d.recent.map(rowHtml).join("")}</div></section>` : ""}
${SPONSOR}
<section aria-label="관련 검색어"><p class="note" style="margin:0 0 6px">관련 검색어</p><div class="tags">${tags.map((t) => `<span>#${e(t)}</span>`).join("")}</div></section>
<p class="disc">${e(DISCLAIMER)}</p>
${FOOT}
</main>
${beacon("league_view")}
</body></html>`;
}

export function matchData(v: MatchView) {
  return {
    schema: 1, slug: v.slug, league: v.league, leagueName: v.leagueName, kickoffAt: v.kickoffAt, home: v.home, away: v.away,
    pHome: v.pHome, pDraw: v.pDraw, pAway: v.pAway, pick: v.pick, confidenceGap: v.confidenceGap, basis: "model", basisLabel: v.basisLabel,
    round: v.round, status: v.status, result: v.result, reasons: v.reasons, risks: v.risks, calib: v.calib, asOf: v.asOf,
    tags: matchTags(v), pageUrl: `${SITE}/match/${v.slug}`,
  };
}

export async function loadHubView(env: Env, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE f.status = 'scheduled' AND f.kickoff_at >= ? AND f.kickoff_at <= ? ORDER BY f.kickoff_at ASC LIMIT 200`,
  )
    .bind(new Date(now - 3 * 3600e3).toISOString(), new Date(now + 8 * 86400e3).toISOString())
    .all<MatchRow>();
  const byLeague = new Map<string, SiblingView[]>();
  for (const r of results ?? []) byLeague.set(r.league, [...(byLeague.get(r.league) ?? []), toSibling(r)]);
  return { byLeague };
}

export function renderHubPage(d: Awaited<ReturnType<typeof loadHubView>>): string {
  const title = "이번 주 축구 승부예측 · 리그별 경기 확률 분석 | HYEOKS";
  const url = `${SITE}/matches`;
  const desc = "EPL·라리가·세리에A·분데스리가·K리그·J리그·MLS 이번 주 경기별 홈승·무승부·원정승 확률과 근거를 리그별로 모았습니다.";
  const tags = ["축구 승부예측", "이번 주 축구 경기 분석", "해외축구 승부예측", "K리그 승부예측", "EPL 승부예측", "축구 경기 확률"];
  const total = [...d.byLeague.values()].reduce((s, l) => s + l.length, 0);
  const order = Object.keys(LEAGUE_INFO);
  const sections = [...d.byLeague.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([lg, list]) => { const li = leagueInfo(lg); return `<section class="card"><h2>${e(li.name)} <span style="color:var(--muted);font-weight:600;font-size:.85rem">${list.length}경기</span></h2><div class="rows">${list.slice(0, 10).map(rowHtml).join("")}</div><p class="note"><a href="/league/${li.slug}">${e(li.name)} 전체 보기 →</a></p></section>`; })
    .join("");
  const chips = Object.values(LEAGUE_INFO).map((v) => `<a class="chip" href="/league/${v.slug}">${e(v.name)}</a>`).join("");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}"><meta name="keywords" content="${e(tags.join(", "))}">
<link rel="canonical" href="${e(url)}"><meta property="og:type" content="website"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(url)}">
<meta name="theme-color" content="#0a0c12"><link rel="stylesheet" href="/fonts/pretendard/pretendard.css"><style>${CSS}</style></head>
<body>${header("match")}
<main>
<span class="eyebrow">경기 분석</span>
<h1>이번 주 축구 승부예측</h1>
<p class="sub">지원 리그 앞으로 7일 경기 ${total}개 · 리그별 확률과 근거</p>
<div class="chips" style="margin-top:10px">${chips}</div>
${sections || `<section class="card"><h2>예정 경기</h2><p class="note" style="margin:0">앞으로 7일 안에 예정된 경기가 없습니다. 리그 휴식기(A매치 기간 등)일 수 있습니다. 승무패 회차는 <a href="/">웹앱</a>에서 볼 수 있습니다.</p></section>`}
${SPONSOR}
<section aria-label="관련 검색어"><p class="note" style="margin:0 0 6px">관련 검색어</p><div class="tags">${tags.map((t) => `<span>#${e(t)}</span>`).join("")}</div></section>
<p class="disc">${e(DISCLAIMER)}</p>
${FOOT}
</main>
${beacon("hub_view")}
</body></html>`;
}

/** 사이트맵용: 리그 페이지 + 예측이 있는 경기 페이지(지난 60일 ~ 예정). */
export async function sitemapEntries(env: Env, origin: string, now = Date.now()): Promise<string[]> {
  const leagues = [`<url><loc>${origin}/matches</loc></url>`, ...Object.values(LEAGUE_INFO).map((v) => `<url><loc>${origin}/league/${v.slug}</loc></url>`)];
  const { results } = await env.DB.prepare(
    `SELECT f.slug, f.updated_at, p.computed_at FROM fixtures f JOIN fixture_predictions p ON p.fixture_id = f.id
      WHERE f.kickoff_at >= ? AND f.status != 'cancelled' ORDER BY f.kickoff_at DESC LIMIT 3000`,
  )
    .bind(new Date(now - 60 * 86400e3).toISOString())
    .all<{ slug: string; updated_at: string; computed_at: string }>();
  const matches = (results ?? []).map((r) => {
    const last = [r.updated_at, r.computed_at].sort().pop() ?? r.updated_at;
    return `<url><loc>${origin}/match/${r.slug}</loc><lastmod>${last.slice(0, 10)}</lastmod></url>`;
  });
  return [...leagues, ...matches];
}
