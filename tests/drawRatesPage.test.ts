import { describe, it, expect } from "vitest";
import {
  computeDrawRates,
  drawRatesIndexable,
  renderDrawRatesPage,
  outcomeSplit,
  MIN_SEASON_MATCHES,
  J1_SEASON_NOTE,
  type DrawRatesOverview,
} from "../src/lib/drawRatesPage";
import type { MatchRow } from "../src/lib/elo";
import { navSection, siteHeader } from "../src/lib/publicSite";
import { USAGE_EVENTS } from "../src/lib/usage";

const NOW = Date.parse("2026-10-13T00:00:00Z");
const day = (start: string, i: number) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400e3).toISOString().slice(0, 10);
// 홈승(2-1)·무승부(1-1)·원정승(0-2)·홈승 순서를 반복한다 → 홈 50%, 무 25%, 원정 25%, 경기당 2.5골.
const SCORES: [number, number][] = [[2, 1], [1, 1], [0, 2], [2, 1]];
function gen(league: string, start: string, n: number): MatchRow[] {
  return Array.from({ length: n }, (_, i) => ({ league, date: day(start, i), home: `H${i % 10}`, away: `A${i % 10}`, hg: SCORES[i % 4][0], ag: SCORES[i % 4][1] }));
}
const season = (ov: DrawRatesOverview, league: string, s: number) => ov.leagues.find((l) => l.league === league)!.seasons.find((x) => x.season === s)!;

// 이 페이지도 다른 공개 화면처럼 구매 권유 표현을 쓰지 않는다.
const FORBIDDEN = ["베팅", "추천", "픽", "단식", "복식", "조합", "투표율"];

describe("리그별 무승부 비율 계산", () => {
  it("세 비율의 합은 100%이고 경기당 골을 계산한다", () => {
    const ov = computeDrawRates(gen("EPL", "2025-08-01", 40), NOW);
    const s = season(ov, "EPL", 2025);
    expect(s.matches).toBe(40);
    expect(s.homeRate! + s.drawRate! + s.awayRate!).toBeCloseTo(1, 10);
    expect(s.homeRate).toBeCloseTo(0.5, 10);
    expect(s.drawRate).toBeCloseTo(0.25, 10);
    expect(s.avgGoals).toBeCloseTo(2.5, 10);
    expect(s.firstDate).toBe("2025-08-01");
    expect(s.lastDate).toBe(day("2025-08-01", 39));
    expect(outcomeSplit([]).homeRate).toBeNull();
  });

  it("유럽 리그는 7월 1일 경계로, 역년 리그는 연도로 시즌을 나눈다", () => {
    const rows = [...gen("EPL", "2025-06-01", 30), ...gen("EPL", "2025-07-01", 31), ...gen("K리그1", "2025-06-15", 30)];
    const ov = computeDrawRates(rows, NOW);
    expect(season(ov, "EPL", 2024).matches).toBe(30); // 6월 = 2024-25 시즌
    expect(season(ov, "EPL", 2025).matches).toBe(31); // 7월 1일부터 2025-26 시즌
    expect(season(ov, "EPL", 2024).label).toBe("2024-25");
    expect(season(ov, "K리그1", 2025).matches).toBe(30); // 6월·7월 모두 2025
  });

  it("현재 시즌 + 지난 3시즌만, 현재 시즌 표시와 범위 밖 제외", () => {
    const rows = [...gen("EPL", "2026-08-15", 35), ...gen("EPL", "2021-09-01", 50), ...gen("국가대표", "2025-09-01", 50)];
    const ov = computeDrawRates(rows, NOW);
    const epl = ov.leagues.find((l) => l.league === "EPL")!;
    expect(epl.currentSeason).toBe(2026);
    expect(epl.seasons.map((s) => s.season)).toEqual([2026, 2025, 2024, 2023]);
    expect(epl.seasons[0].current).toBe(true);
    expect(epl.seasons[1].current).toBe(false);
    expect(ov.leagues.some((l) => l.league === "국가대표")).toBe(false);
    expect(ov.totalMatches).toBe(35); // 2021 시즌과 국가대표는 빠진다
    // 요약은 완료 시즌만(진행 중 시즌 제외)
    expect(epl.summary.matches).toBe(0);
    expect(epl.summary.enough).toBe(false);
    const h = renderDrawRatesPage(ov);
    expect(h).toContain("진행 중");
  });

  it(`${MIN_SEASON_MATCHES}경기 미만은 표본 부족`, () => {
    const short = computeDrawRates(gen("K리그1", "2025-03-01", MIN_SEASON_MATCHES - 1), NOW);
    expect(season(short, "K리그1", 2025).enough).toBe(false);
    const shortHtml = renderDrawRatesPage(short);
    expect(shortHtml).toContain(`표본 부족(${MIN_SEASON_MATCHES}경기 미만)`);
    expect(shortHtml).not.toContain("51.7%"); // 29경기 중 홈승 15경기 비율은 보여주지 않는다
    const ok = computeDrawRates(gen("K리그1", "2025-03-01", MIN_SEASON_MATCHES), NOW);
    expect(season(ok, "K리그1", 2025).enough).toBe(true);
    expect(renderDrawRatesPage(ok)).toContain("50.0%");
    expect(ok.leagues.find((l) => l.league === "K리그1")!.summary.enough).toBe(true);
  });

  it("잘못된 줄(같은 팀끼리, 음수 점수)은 집계하지 않는다", () => {
    const rows: MatchRow[] = [...gen("EPL", "2025-08-01", 30), { league: "EPL", date: "2025-10-01", home: "X", away: "X", hg: 1, ag: 0 }, { league: "EPL", date: "2025-10-02", home: "X", away: "Y", hg: -1, ag: 0 }];
    expect(season(computeDrawRates(rows, NOW), "EPL", 2025).matches).toBe(30);
  });

  it("J1리그는 역년 기준임을 시즌 이름과 안내로 밝힌다", () => {
    const ov = computeDrawRates(gen("J1리그", "2025-03-01", 40), NOW);
    expect(season(ov, "J1리그", 2025).label).toContain("역년 기준(1~12월)");
    expect(renderDrawRatesPage(ov)).toContain(J1_SEASON_NOTE);
  });
});

describe("색인 판정", () => {
  const leagues = ["EPL", "라리가", "K리그1", "MLS"];
  it("한 시즌 100경기 이상 리그가 4개 이상이면 색인", () => {
    const ov = computeDrawRates(leagues.flatMap((l) => gen(l, l === "EPL" || l === "라리가" ? "2025-08-01" : "2025-03-01", 100)), NOW);
    expect(drawRatesIndexable(ov)).toBe(true);
    expect(renderDrawRatesPage(ov)).not.toContain("noindex");
  });
  it("3개뿐이거나 99경기면 noindex", () => {
    const three = computeDrawRates(leagues.slice(0, 3).flatMap((l) => gen(l, l === "EPL" || l === "라리가" ? "2025-08-01" : "2025-03-01", 100)), NOW);
    expect(drawRatesIndexable(three)).toBe(false);
    expect(renderDrawRatesPage(three)).toContain('<meta name="robots" content="noindex,follow">');
    const thin = computeDrawRates(leagues.flatMap((l) => gen(l, l === "EPL" || l === "라리가" ? "2025-08-01" : "2025-03-01", 99)), NOW);
    expect(drawRatesIndexable(thin)).toBe(false);
  });
});

describe("/insights/draw-rates 화면", () => {
  const ov = computeDrawRates(
    [...gen("EPL", "2025-08-01", 120), ...gen("라리가", "2024-08-01", 120), ...gen("K리그1", "2025-03-01", 120), ...gen("MLS", "2025-03-01", 60)],
    NOW,
  );
  it("제목·대표 주소·측정 이벤트·링크", () => {
    const h = renderDrawRatesPage(ov);
    expect(h).toContain("<h1>리그별 홈승·무승부·원정승 비율</h1>");
    expect(h).toContain('<link rel="canonical" href="https://hyeoks.com/insights/draw-rates">');
    expect(h).toContain('"draw_rates_view"');
    for (const href of ["/ratings", "/methodology", "/performance", "/league/epl", "/league/k-league-1"]) expect(h, href).toContain(`href="${href}"`);
    expect(h).toContain("<caption");
    expect(h).toContain("50.0%"); // 홈승 비율이 집계값 그대로
    expect(h).toContain("개 리그 중");
    expect(h).not.toContain("adsbygoogle");
  });
  it("금지 표현을 쓰지 않는다", () => {
    const h = renderDrawRatesPage(ov);
    for (const w of FORBIDDEN) expect(h, w).not.toContain(w);
  });
  it("메뉴·이벤트 허용 목록", () => {
    expect(navSection("/insights/draw-rates")).toBe("matches");
    expect(siteHeader("/insights/draw-rates")).toContain('<a href="/insights/draw-rates" aria-current="page">무승부 비율</a>');
    expect(USAGE_EVENTS as readonly string[]).toContain("draw_rates_view");
  });
});
