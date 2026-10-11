import { describe, it, expect } from "vitest";
import {
  renderMatchPage, renderLeaguePage, renderHubPage, renderNotFoundPage, neutralSummary, matchTags, matchTitle, kstLabel, matchData,
  matchIndexable, leagueIndexable, hubIndexable, SITE_LINKS, type MatchView, type SiblingView,
} from "../src/lib/matchPage";
import { displayTeamName, leagueBySlug, leagueInfo, missingDisplayNames } from "../src/lib/teamNames";
import { DISCLAIMER } from "../src/lib/roundArticle";

const view = (over: Partial<MatchView> = {}): MatchView => ({
  slug: "2026-10-04-columbus-crew-inter-miami-cf",
  league: "MLS",
  competition: null,
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
  basis: "model",
  basisLabel: "통계 모델",
  withMarket: false,
  nBookmakers: null,
  source: "fixture",
  provenance: { kind: "current_estimate", source: "fixture", capturedAt: "2026-09-27T14:12:00.000Z" },
  probabilityAsOf: "2026-09-27T14:12:00.000Z",
  round: null,
  status: "scheduled",
  result: null,
  reasons: ["Elo 전력 지수는 인터 마이애미가 120점 앞섭니다."],
  risks: [],
  explanationNote: null,
  context: null,
  calib: null,
  siblings: [],
  ...over,
});
const finished = (over: Partial<MatchView> = {}) =>
  view({
    status: "finished",
    result: { hg: 0, ag: 1, actual: "원정승" },
    provenance: { kind: "pre_kickoff_fixture", source: "fixture", capturedAt: "2026-09-27T14:12:00.000Z" },
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
    const withRound = view({
      round: { roundNo: 57, seq: 9 }, withMarket: true, basisLabel: "통계 모델 + 해외 배당", source: "round",
      provenance: { kind: "current_estimate", source: "round", capturedAt: "2026-09-27T10:00:00.000Z" },
      context: { asOf: "2026-09-27T09:00:00.000Z", pHome: 0.3, pDraw: 0.25, pAway: 0.45, basisLabel: "통계 모델", lines: ["Elo 전력 지수는 사실상 대등합니다."] },
    });
    for (const v of [view(), withRound, finished()]) {
      const h = body(renderMatchPage(v));
      for (const w of FORBIDDEN) expect(h, w).not.toContain(w);
    }
  });

  it("광고 스크립트와 상시 스폰서 모집 칸이 없다", () => {
    const h = renderMatchPage(view());
    expect(h).not.toContain("adsbygoogle");
    expect(h).not.toContain("pagead2");
    expect(h).not.toContain("SPONSOR");
    expect(h).not.toContain("파트너를 찾습니다");
    expect(h).toContain("mailto:hyeoks.data@gmail.com");
  });

  it("공통 메뉴·푸터 링크와 책임 있는 이용 안내", () => {
    const h = renderMatchPage(view());
    for (const href of ["/", "/matches", "/guide/", "/methodology", "/performance", "/editorial", "/sources", "/contact", "/app", "/privacy"]) {
      expect(h, href).toContain(`href="${href}"`);
    }
    expect(SITE_LINKS.length).toBeGreaterThanOrEqual(10);
    expect(h).toContain('id="responsible-use"');
    expect(h).toContain("1336");
  });

  it("앱 링크는 /app으로 간다(회차가 있으면 회차 번호 포함)", () => {
    expect(renderMatchPage(view())).toContain('href="/app?utm_source=match_page"');
    expect(renderMatchPage(view({ round: { roundNo: 57, seq: 9 } }))).toContain('href="/app?round=57&amp;utm_source=match_page"');
    expect(renderMatchPage(view())).not.toContain('href="/?utm_source=match_page"');
  });

  it("결과는 킥오프 전 저장 확률이 있을 때만 확률 1위와 비교한다", () => {
    expect(renderMatchPage(finished())).toContain("확률 1위 적중");
    expect(renderMatchPage(finished({ result: { hg: 2, ag: 0, actual: "홈승" } }))).toContain("확률 1위와 다른 결과");
    const noPrior = renderMatchPage(
      finished({ basis: null, provenance: { kind: "unavailable", source: null, capturedAt: null }, probabilityAsOf: null, reasons: [], explanationNote: "없음" }),
    );
    expect(noPrior).not.toContain("확률 1위 적중");
    expect(noPrior).toContain("결과만 표시");
  });

  it("승무패 회차 경기면 회차로 연결한다", () => {
    expect(renderMatchPage(view({ round: { roundNo: 57, seq: 9 } }))).toContain('href="/round/57"');
  });

  it("회차 확률이면 fixture 성분은 '경기 데이터 맥락'으로 분리하고 계산 근거라 하지 않는다", () => {
    const h = renderMatchPage(view({
      source: "round", basis: "market", basisLabel: "해외 배당", withMarket: true, round: { roundNo: 60, seq: 3 },
      provenance: { kind: "current_estimate", source: "round", capturedAt: "2026-09-27T10:00:00.000Z" },
      reasons: ["해외 북메이커 5곳의 평균 배당을 확률로 환산(마진 제거)하면 ..."],
      context: { asOf: "2026-09-27T09:00:00.000Z", pHome: 0.3, pDraw: 0.25, pAway: 0.45, basisLabel: "통계 모델", lines: ["Elo 전력 지수는 사실상 대등합니다(홈 이점은 별도 반영)."] },
    }));
    expect(h).toContain("경기 데이터 맥락(참고)");
    expect(h).toContain("위 확률의 계산 근거가 아니라");
    expect(h).toContain("승무패 60회차 확률을 그대로 보여줍니다");
    expect(h).toContain('href="/methodology"');
    expect(h).toContain('href="/sources"');
    expect(h).toContain('href="/performance"');
  });

  it("한 줄 요약은 확률 차 크기로만 말한다", () => {
    expect(neutralSummary(view())).toBe("인터 마이애미 승 확률이 58%로 가장 높고, 1·2위 확률 차는 36.0%p로 한쪽으로 뚜렷한 편입니다.");
    expect(neutralSummary(view({ confidenceGap: 0.02 }))).toContain("박빙");
  });

  it("한국시간 표기", () => {
    expect(kstLabel("2026-09-27T23:00:00.000Z")).toBe("9월 28일(월) 08:00");
  });
});

describe("색인 판정(noindex)", () => {
  it("근거 있는 예정 경기와 결과+사전 확률이 있는 끝난 경기는 색인한다", () => {
    expect(matchIndexable(view())).toBe(true);
    expect(matchIndexable(finished())).toBe(true);
    const h = renderMatchPage(finished());
    expect(h).toContain('<meta name="robots" content="index,follow">');
  });
  it("확률 없음·취소·근거 없는 예정 경기는 noindex", () => {
    const none = view({ basis: null, provenance: { kind: "unavailable", source: null, capturedAt: null }, reasons: [] });
    expect(matchIndexable(none)).toBe(false);
    expect(renderMatchPage(none)).toContain('<meta name="robots" content="noindex,follow">');
    expect(matchIndexable(view({ status: "cancelled" }))).toBe(false);
    expect(matchIndexable(view({ reasons: [] }))).toBe(false);
    expect(matchIndexable(view({ pHome: 0.5, pDraw: 0.5, pAway: 0.5 }))).toBe(false);
    expect(matchIndexable(view({ away: "콜럼버스 크루" }))).toBe(false);
  });
});

describe("data.json", () => {
  it("basis를 model로 고정하지 않고 실제 원천을 싣는다", () => {
    const d = matchData(view({
      basis: "market", basisLabel: "해외 배당", withMarket: true, nBookmakers: 6, source: "round", round: { roundNo: 60, seq: 3 },
      provenance: { kind: "current_estimate", source: "round", capturedAt: "2026-09-27T10:00:00.000Z" }, probabilityAsOf: "2026-09-27T10:00:00.000Z",
    }));
    expect(d.basis).toBe("market");
    expect(d.provenance.kind).toBe("current_estimate");
    expect(d.probabilityAsOf).toBe("2026-09-27T10:00:00.000Z");
    expect(d.asOf).toBe(d.probabilityAsOf);
    expect(d.pageUrl).toBe("https://hyeoks.com/match/2026-10-04-columbus-crew-inter-miami-cf");
  });
  it("확률이 없으면 숫자 대신 null", () => {
    const d = matchData(view({ basis: null, provenance: { kind: "unavailable", source: null, capturedAt: null }, reasons: [] }));
    expect(d.pHome).toBeNull();
    expect(d.basis).toBeNull();
    expect(d.indexable).toBe(false);
  });
});

describe("국가대표 경기 페이지", () => {
  const nat = view({
    slug: "2026-10-10-south-korea-uruguay", league: "국가대표", competition: "A매치 친선", leagueName: "A매치 친선", leagueSlug: "national-teams",
    home: "대한민국", away: "우루과이", homeLogo: "/flags/kr.svg", awayLogo: "/flags/uy.svg", basis: "national", basisLabel: "국가대표 Elo", calib: null,
    reasons: ["국가대표 Elo(1872년 이후 A매치 기반)는 우루과이가 40점 높고, 홈 이점까지 반영하면 대한민국 승 41%입니다."],
  });
  it("대회명이 제목에 들어가고 국가대표 한계를 알린다", () => {
    expect(matchTitle(nat)).toContain("대한민국 vs 우루과이 승부예측");
    expect(matchTitle(nat)).toContain("A매치 친선");
    const h = renderMatchPage(nat);
    expect(h).toContain("중립 경기장 여부는 반영하지 않고");
    expect(h).toContain("/flags/kr.svg");
    for (const w of FORBIDDEN) expect(body(h), w).not.toContain(w);
  });
});

const sib = (over: Partial<SiblingView> = {}): SiblingView => ({
  slug: "2026-10-04-arsenal-chelsea", kickoffAt: "2026-10-04T14:00:00.000Z", home: "아스널", away: "첼시",
  pHome: 0.5, pDraw: 0.25, pAway: 0.25, pick: "홈승", status: "scheduled", hg: null, ag: null, ready: true, ...over,
});

describe("리그·허브 페이지", () => {
  it("예정 경기가 없으면 빈 상태 안내 + noindex", () => {
    const empty = { league: "EPL", info: leagueInfo("EPL"), upcoming: [], recent: [] };
    const h = renderLeaguePage(empty);
    expect(h).toContain("프리미어리그 승부예측");
    expect(h).toContain("이 기간에 수집된 예정 경기가 없습니다");
    expect(leagueIndexable(empty)).toBe(false);
    expect(h).toContain("noindex");
    expect(renderHubPage({ byLeague: new Map() })).toContain("이번 주 축구 승부예측");
    expect(hubIndexable({ byLeague: new Map() })).toBe(false);
  });
  it("리그 지난 경기 '적중 수'를 사전 기록처럼 집계하지 않고 기록 페이지로 보낸다", () => {
    const d = {
      league: "EPL", info: leagueInfo("EPL"), upcoming: [sib()],
      recent: [sib({ status: "finished", hg: 2, ag: 0 }), sib({ status: "finished", hg: 0, ag: 0, pHome: null, pDraw: null, pAway: null, pick: null, ready: false })],
    };
    const h = renderLeaguePage(d);
    expect(h).not.toContain("맞은 경기");
    expect(h).toContain('href="/performance"');
    expect(leagueIndexable(d)).toBe(true);
    expect(h).toContain('<meta name="robots" content="index,follow">');
    expect(h).not.toContain("SPONSOR");
  });
  it("확률 없는 카드는 숫자 대신 '확률 없음'", () => {
    const h = renderHubPage({ byLeague: new Map([["EPL", [sib({ pHome: null, pDraw: null, pAway: null, pick: null, ready: false })]]]) });
    expect(h).toContain("확률 없음");
  });
  it("리그 주소 왕복", () => {
    expect(leagueBySlug(leagueInfo("K리그1").slug)).toBe("K리그1");
    expect(leagueBySlug("nope")).toBeNull();
  });
});

describe("404", () => {
  it("브랜드 틀 + noindex, 광고 없음", () => {
    const h = renderNotFoundPage();
    expect(h).toContain("noindex");
    expect(h).toContain("HYEOKS 풋볼 데이터");
    expect(h).toContain('href="/matches"');
    expect(h).not.toContain("adsbygoogle");
    expect(h).not.toContain('rel="canonical"');
  });
});

describe("표시용 팀명", () => {
  it("전체 이름, 없으면 영문 그대로", () => {
    expect(displayTeamName("Columbus Crew")).toBe("콜럼버스 크루");
    expect(displayTeamName("Unknown FC")).toBe("Unknown FC");
    expect(missingDisplayNames(["Arsenal", "Unknown FC", "Unknown FC"])).toEqual(["Unknown FC"]);
  });
});
