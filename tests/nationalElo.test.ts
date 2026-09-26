import { describe, it, expect } from "vitest";
import {
  parseNationalResultsCsv,
  computeNationalElo,
  nationalK,
  goalDiffMultiplier,
  nationalProbs,
} from "../src/lib/nationalElo";
import { nationalTeamEn } from "../src/lib/nationalNames";
import { predictMatch } from "../src/lib/prediction";

describe("nationalTeamEn", () => {
  it("wisetoto가 4글자로 자른 표기를 전체 이름으로 푼다(55~57회차 실측 표기)", () => {
    expect(nationalTeamEn("크로아티")).toBe("Croatia");
    expect(nationalTeamEn("스코틀랜")).toBe("Scotland");
    expect(nationalTeamEn("북마케도")).toBe("North Macedonia");
    expect(nationalTeamEn("북아일랜")).toBe("Northern Ireland");
    expect(nationalTeamEn("보스니아")).toBe("Bosnia and Herzegovina");
    expect(nationalTeamEn("튀르키예")).toBe("Turkey");
  });
  it("클럽명이나 모르는 이름은 null(국가대표 Elo를 잘못 붙이지 않게)", () => {
    expect(nationalTeamEn("맨체스터시티")).toBeNull();
    expect(nationalTeamEn("울산")).toBeNull();
  });
});

describe("nationalElo 규칙", () => {
  it("대회 중요도 K(eloratings.net)", () => {
    expect(nationalK("Friendly")).toBe(20);
    expect(nationalK("FIFA World Cup")).toBe(60);
    expect(nationalK("FIFA World Cup qualification")).toBe(40);
    expect(nationalK("UEFA Nations League")).toBe(40);
    expect(nationalK("UEFA Euro")).toBe(50);
    expect(nationalK("Baltic Cup")).toBe(30);
  });
  it("득실차 가중", () => {
    expect(goalDiffMultiplier(1)).toBe(1);
    expect(goalDiffMultiplier(-2)).toBe(1.5);
    expect(goalDiffMultiplier(3)).toBe(1.75);
  });
  it("CSV의 따옴표로 감싼 쉼표 필드와 스코어 없는 예정 경기를 처리한다", () => {
    const csv =
      "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral\n" +
      '2024-01-01,A,B,2,1,Friendly,"Town, X",Y,FALSE\n' +
      "2026-10-10,A,B,NA,NA,Friendly,T,Y,TRUE\n" +
      "2024-02-01,B,A,0,0,UEFA Nations League,T,Y,TRUE\n";
    const rows = parseNationalResultsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ home: "A", away: "B", hg: 2, ag: 1, neutral: false });
    expect(rows[1].neutral).toBe(true);
  });
  it("onBeforeMatch에는 그 경기 결과가 반영되기 전 레이팅이 온다(백테스트 누수 방지)", () => {
    const rows = [
      { date: "2024-01-01", home: "A", away: "B", hg: 3, ag: 0, tournament: "Friendly", neutral: true },
      { date: "2024-02-01", home: "A", away: "B", hg: 0, ag: 0, tournament: "Friendly", neutral: true },
    ];
    const seen: number[] = [];
    const final = computeNationalElo(rows, (_r, he) => seen.push(he));
    expect(seen[0]).toBe(1500);
    expect(seen[1]).toBeGreaterThan(1500);
    expect(final.get("A")!.elo + final.get("B")!.elo).toBeCloseTo(3000, 6); // 제로섬
  });
  it("확률은 합이 1이고 격차가 클수록 홈승이 커진다", () => {
    const even = nationalProbs(0);
    const strong = nationalProbs(300);
    expect(even.pHome + even.pDraw + even.pAway).toBeCloseTo(1, 9);
    expect(strong.pHome).toBeGreaterThan(even.pHome);
    expect(strong.pAway).toBeLessThan(even.pAway);
  });
});

describe("predictMatch 국가대표 폴백", () => {
  const base = { eloDiff: 0, formDiff: 0, h2hDiff: 0, leagueDrawRate: 0.27, marketOnly: true };
  it("배당이 없고 국가대표 Elo가 있으면 national", () => {
    const p = predictMatch({ ...base, nationalEloDiff: 200 });
    expect(p.basis).toBe("national");
    expect(p.rankedPicks[0]).toBe("홈승");
  });
  it("배당이 있으면 배당이 우선한다(블렌딩 비율은 검증 불가라 섞지 않음)", () => {
    const p = predictMatch({
      ...base,
      nationalEloDiff: 400,
      marketOdds: { pHome: 0.2, pDraw: 0.3, pAway: 0.5, nBookmakers: 5 },
    });
    expect(p.basis).toBe("market");
    expect(p.pAway).toBe(0.5);
  });
  it("둘 다 없으면 기존처럼 none", () => {
    expect(predictMatch({ ...base, nationalEloDiff: null }).basis).toBe("none");
  });
});

describe("nationalFlagUrl", () => {
  it("잘린 국가명도 국기로, 영국 4개 협회는 각자의 기로", async () => {
    const { nationalFlagUrl, NATIONAL_EN_NAMES, NATIONAL_FLAG_CODE } = await import("../src/lib/nationalNames");
    expect(nationalFlagUrl("크로아티")).toBe("/flags/hr.svg");
    expect(nationalFlagUrl("스코틀랜")).toBe("/flags/gb-sct.svg");
    expect(nationalFlagUrl("잉글랜드")).toBe("/flags/gb-eng.svg");
    expect(nationalFlagUrl("울산")).toBeNull();
    // 매핑된 모든 국가에 국기 코드가 있어야 한다(없으면 모노그램으로 떨어짐)
    expect(NATIONAL_EN_NAMES.filter((n) => !NATIONAL_FLAG_CODE[n])).toEqual([]);
  });
});
