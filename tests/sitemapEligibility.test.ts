// 조건부 색인 페이지를 정적 목록에 넣어 noindex 판정을 우회하지 않도록 한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSitemap, SITE_PATHS } from "../src/routes/roundPage";
import { getAllMatches } from "../src/lib/db";
import { loadRatingsOverview } from "../src/lib/leagueTablesStore";
import { loadProbabilityAudit, computeProbabilityAudit } from "../src/lib/probabilityAuditPage";
import { sitemapEntries } from "../src/lib/matchPage";
import type { Env } from "../src/types";

vi.mock("../src/lib/db", async () => ({...await vi.importActual("../src/lib/db"),getAllMatches:vi.fn()}));
vi.mock("../src/lib/leagueTablesStore", async () => ({...await vi.importActual("../src/lib/leagueTablesStore"),loadRatingsOverview:vi.fn()}));
vi.mock("../src/lib/probabilityAuditPage", async () => ({...await vi.importActual("../src/lib/probabilityAuditPage"),loadProbabilityAudit:vi.fn()}));
vi.mock("../src/lib/matchPage", async () => ({...await vi.importActual("../src/lib/matchPage"),sitemapEntries:vi.fn()}));

beforeEach(()=>{
  vi.mocked(getAllMatches).mockResolvedValue([]);
  vi.mocked(loadRatingsOverview).mockResolvedValue({generatedAt:"2026-11-16T12:00:00Z",leagues:[],national:[],nationalAsOf:null,truncated:false});
  vi.mocked(loadProbabilityAudit).mockResolvedValue(computeProbabilityAudit([],Date.parse("2026-11-16T12:00:00Z")));
  vi.mocked(sitemapEntries).mockResolvedValue([]);
});
describe("사이트맵과 데이터 색인 자격 일치",()=>{
  it("조건부 페이지는 고정 목록에 두지 않는다",()=>{
    for(const p of ["/matches","/ratings","/insights/draw-rates"]) expect(SITE_PATHS).not.toContain(p);
  });
  it("자료가 부족한 페이지를 사이트맵에서 제외한다",async()=>{
    const xml=await (await handleSitemap({} as Env,new Request("https://hyeoks.com/sitemap.xml"))).text();
    for(const p of ["/matches","/ratings","/insights/draw-rates","/insights/rank-gap","/insights/probability-audit"]) expect(xml).not.toContain("<loc>https://hyeoks.com"+p+"</loc>");
    expect(xml).toContain("<loc>https://hyeoks.com/methodology</loc>");
  });
  it("충분한 비율 자료와 허브 자격이 있을 때만 해당 주소를 넣는다",async()=>{
    vi.mocked(getAllMatches).mockResolvedValue(["EPL","라리가","K리그1","MLS"].flatMap(league=>Array.from({length:100},(_,i)=>({league,date:new Date(Date.UTC(2025,7,1+i)).toISOString().slice(0,10),home:"H"+i,away:"A"+i,hg:1,ag:0}))));
    vi.mocked(sitemapEntries).mockResolvedValue(['<url><loc>https://hyeoks.com/matches</loc></url>']);
    const xml=await (await handleSitemap({} as Env,new Request("https://hyeoks.com/sitemap.xml"))).text();
    expect(xml).toContain("<loc>https://hyeoks.com/insights/draw-rates</loc>");
    expect(xml).toContain("<loc>https://hyeoks.com/matches</loc>");
    expect(xml).not.toContain("<loc>https://hyeoks.com/ratings</loc>");
  });
});
