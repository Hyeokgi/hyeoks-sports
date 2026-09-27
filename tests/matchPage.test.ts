import { describe, it, expect } from "vitest";
import { renderMatchPage, renderLeaguePage, renderHubPage, neutralSummary, matchTags, matchTitle, kstLabel, type MatchView } from "../src/lib/matchPage";
import { displayTeamName, leagueBySlug, leagueInfo, missingDisplayNames } from "../src/lib/teamNames";
import { DISCLAIMER } from "../src/lib/roundArticle";

const view = (over: Partial<MatchView> = {}): MatchView => ({
  slug: "2026-10-04-columbus-crew-inter-miami-cf",
  league: "MLS",
  leagueName: "MLS",
  leagueSlug: "mls",
  kickoffAt: "2026-09-27T23:00:00.000Z",
  home: "콜럼버스 크루",
  away: "인터 마이애미",
  homeLogo: "/logos/x.png",
  awayLogo: null,
  pHome: 0.22,
  pDraw: 0.2,
  pAway: 0.58,
  pick: "원정승",
  confidenceGap: 0.36,
  basisLabel: "통계 모델",
  source: "fixture",
  withMarket: false,
  round: null,
  status: "scheduled",
  result: null,
  reasons: ["Elo 전력 지수는 인터 마이애미가 120점 앞섭니다."],
  risks: [],
  calib: { accuracy: 0.61, n: 812 },
  asOf: "2026-09-27T14:12:00.000Z",
  siblings: [],
  ...over,
});

// 경기 페이지는 베팅 추천 페이지가 아니다(명세 002 1장). 고지 문구(판매처 안내)는 제외하고 검사한다.
const FORBIDDEN = ["단식", "복식", "조합", "베팅", "투표율", "배당 추천", "픽을", "강추"];
const body = (html: string) => html.replace(DISCLAIMER.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!), "");

describe("경기 페이지", () => {
  it("제목·주소·검색 태그", () => {
    const v = view();
    expect(matchTitle(v)).toBe("콜럼버스 크루 vs 인터 마이애미 승부예측 · 9월 28일 MLS 확률 분석 | HYEOKS");
    const h = renderMatchPage(v);
    expect(h).toContain('<link rel="canonical" href="https://hyeoks.com/match/2026-10-04-columbus-crew-inter-miami-cf">');
    expect(h).toContain("#콜럼버스 크루 인터 마이애미 승부예측");
    expect(h).toContain('"@type":"SportsEvent"');
    expect(matchTags(v).length).toBeGreaterThanOrEqual(6);
  });

  it("베팅 용어를 쓰지 않는다", () => {
    for (const v of [view(), view({ round: { roundNo: 57, seq: 9 }, withMarket: true, basisLabel: "통계 모델 + 해외 배당" }), view({ status: "finished", result: { hg: 0, ag: 1, actual: "원정승" } })]) {
      const h = body(renderMatchPage(v));
      for (const w of FORBIDDEN) expect(h, w).not.toContain(w);
    }
  });

  it("결과가 나오면 킥오프 전 확률 1위와 비교한다", () => {
    const hit = renderMatchPage(view({ status: "finished", result: { hg: 0, ag: 1, actual: "원정승" } }));
    expect(hit).toContain("확률 1위 적중");
    const miss = renderMatchPage(view({ status: "finished", result: { hg: 2, ag: 0, actual: "홈승" } }));
    expect(miss).toContain("확률 1위와 다른 결과");
  });

  it("승무패 회차 경기면 회차로 연결한다", () => {
    expect(renderMatchPage(view({ round: { roundNo: 57, seq: 9 } }))).toContain('href="/round/57"');
  });

  it("한 줄 요약은 확률 차 크기로만 말한다", () => {
    expect(neutralSummary(view())).toBe("인터 마이애미 승 확률이 58%로 가장 높고, 1·2위 확률 차는 36.0%p로 한쪽으로 뚜렷한 편입니다.");
    expect(neutralSummary(view({ confidenceGap: 0.02 }))).toContain("박빙");
  });

  it("한국시간 표기", () => {
    expect(kstLabel("2026-09-27T23:00:00.000Z")).toBe("9월 28일(월) 08:00");
  });
});

describe("리그·허브 페이지", () => {
  it("예정 경기가 없으면 휴식기 안내", () => {
    const h = renderLeaguePage({ league: "EPL", info: leagueInfo("EPL"), upcoming: [], recent: [] });
    expect(h).toContain("프리미어리그 승부예측");
    expect(h).toContain("휴식기");
    expect(renderHubPage({ byLeague: new Map() })).toContain("이번 주 축구 승부예측");
  });
  it("리그 주소 왕복", () => {
    expect(leagueBySlug(leagueInfo("K리그1").slug)).toBe("K리그1");
    expect(leagueBySlug("nope")).toBeNull();
  });
});

describe("표시용 팀명", () => {
  it("전체 이름, 없으면 영문 그대로", () => {
    expect(displayTeamName("Columbus Crew")).toBe("콜럼버스 크루");
    expect(displayTeamName("Unknown FC")).toBe("Unknown FC");
    expect(missingDisplayNames(["Arsenal", "Unknown FC", "Unknown FC"])).toEqual(["Unknown FC"]);
  });
});
