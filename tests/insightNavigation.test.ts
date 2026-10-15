// 직접 계산한 해설이 홈과 공통 메뉴에서 끊기지 않게 한다.
import { describe, it, expect } from "vitest";
import { navSection, siteHeader, siteFooter } from "../src/lib/publicSite";
import { renderDataHome } from "../src/lib/dataHome";
import { USAGE_EVENTS } from "../src/lib/usage";

describe("데이터 관찰실 탐색", () => {
  it("순위 차이는 경기 분석, 확률 성적표는 예측 기록 아래에 둔다", () => {
    expect(navSection("/insights/rank-gap")).toBe("matches");
    expect(navSection("/insights/probability-audit")).toBe("performance");
    expect(siteHeader("/insights/rank-gap")).toContain('href="/insights/rank-gap" aria-current="page"');
    expect(siteHeader("/insights/probability-audit")).toContain('href="/insights/probability-audit" aria-current="page"');
    expect(siteHeader("/performance")).toContain('href="/insights/probability-audit"');
  });
  it("홈과 꼬리말에서 세 해설 모두 발견할 수 있다", () => {
    const home = renderDataHome({generatedAt:"2026-10-15T03:00:00Z",matches:[],performance:null,performanceUnavailable:false,rounds:[]});
    expect(home).toContain("HYEOKS 데이터 관찰실");
    for(const href of ["/insights/rank-gap","/insights/probability-audit","/insights/draw-rates"]) {
      expect(home).toContain('href="'+href+'"');
      expect(siteFooter()).toContain('href="'+href+'"');
    }
  });
  it("해설 조회를 일별로 집계한다",()=>{
    expect(USAGE_EVENTS).toContain("rank_gap_view");
    expect(USAGE_EVENTS).toContain("probability_audit_view");
  });
});
