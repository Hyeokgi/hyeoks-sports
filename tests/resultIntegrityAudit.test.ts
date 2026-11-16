import {describe,it,expect} from "vitest";
import {auditResultHistory} from "../src/lib/resultIntegrityAudit";
import {computeEloAndHistory} from "../src/lib/elo";
describe("읽기 전용 결과 정합성 대조",()=>{
  it("미래 행을 제외했을 때의 Elo·무승부율 차이를 보이며 원본은 보존한다",()=>{
    const now=Date.parse("2026-11-16T12:00:00Z");
    const rows=[{id:1,league:"라리가",date:"2026-11-08",home:"A",away:"B",hg:2,ag:0},{id:2,league:"라리가",date:"2026-12-09",home:"A",away:"B",hg:0,ag:0}];
    const old=computeEloAndHistory(rows).elo;
    const previous=[...old].map(([key,s])=>({league:"라리가",team_en:key.split("|")[1],elo:s.elo,last_season:s.lastSeason,last_match_date:"2026-12-09"}));
    const before=JSON.stringify(rows);
    const out=auditResultHistory(rows,previous,[{league:"라리가",draw_rate:.5,sample_size:2}],now);
    expect(out.rawRows).toBe(2);expect(out.eligibleRows).toBe(1);
    expect(out.excluded[0].reason).toBe("future_date");
    expect(out.eloDiffs).toHaveLength(2);
    expect(out.eloDiffs.every(x=>x.newDate==="2026-11-08")).toBe(true);
    expect(out.drawDiffs[0]).toMatchObject({newRate:0,newSample:1,oldRate:.5,oldSample:2});
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("없는 데이터를 채우거나 파생값 삭제를 제안하지 않는다",()=>{
    const out=auditResultHistory([],[],[],Date.parse("2026-11-16T12:00:00Z"));
    expect(out.eligibleRows).toBe(0);expect(out.eloDiffs).toEqual([]);expect(out.drawDiffs).toEqual([]);
  });
});
