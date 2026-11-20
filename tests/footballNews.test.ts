import { describe, expect, it } from "vitest";
import { FOOTBALL_NEWS, FOOTBALL_NEWS_SNAPSHOTS } from "../src/lib/footballNews";

// 공개 계약은 unknown으로 유지하고 테스트에서만 직렬화 가능한 스냅샷을 검사한다.
const snapshot = (slug: string): any => JSON.parse(JSON.stringify(FOOTBALL_NEWS_SNAPSHOTS[slug]));
const plain = (html: string): string => html.replace(/<[^>]*>/g, "");

describe("최근 경기 기사의 고정 원자료", () => {
  it("한국전 관측 비율의 분자와 분모를 보존한다", () => {
    const s = snapshot("korea-qatar-20-shots-one-goal");
    expect(s.match).toMatchObject({ status: "FT", homeGoals: 0, awayGoals: 1 });
    expect(s.stats.totalShots).toEqual({ home: 2, away: 20 });
    expect(s.stats.shotsOnTarget).toEqual({ home: 0, away: 9 });
    expect(s.stats.possessionPercent).toEqual({ home: 43, away: 57 });
    expect(s.stats).not.toHaveProperty("oppositionBoxTouches");
    expect(s.goals).toEqual([{ team: "대한민국", player: "오세훈", minute: "43", assist: "송민규" }]);
    const c = s.calculations.observedConversionPercent;
    expect(c).toEqual({ numerator: 1, denominator: 20, formula: "1 / 20 * 100", value: 5 });
    expect(s.match.awayGoals / s.stats.totalShots.away * 100).toBe(c.value);
    const onTarget = s.calculations.shotsOnTargetPercent;
    expect(onTarget.numerator).toBe(s.stats.shotsOnTarget.away);
    expect(onTarget.denominator).toBe(s.stats.totalShots.away);
    expect(onTarget.numerator / onTarget.denominator * 100).toBe(45);
    expect(onTarget.value).toBe(45);
  });

  it("노르웨이전 득점 순서·추가시간과 직접 계산을 보존한다", () => {
    const s = snapshot("norway-denmark-comeback-clock");
    expect(s.goals.map((g: any) => g.minute)).toEqual(["11", "14", "37", "83", "90+6"]);
    expect(s.goals.map((g: any) => [g.homeGoals, g.awayGoals])).toEqual([[1, 0], [2, 0], [2, 1], [2, 2], [2, 3]]);
    expect(s.goals[4].penalty).toBe(true);
    const goals = s.goals.filter((g: any) => g.team === "노르웨이");
    const late = goals.filter((g: any) => Number.parseInt(g.minute, 10) >= 83);
    const c = s.calculations.norwayLateGoalSharePercent;
    expect([c.numerator, c.denominator]).toEqual([late.length, goals.length]);
    expect(c.value).toBe(2 / 3 * 100);
    expect(Number(c.value.toFixed(1))).toBe(c.rounded);
    expect(s.calculations.norwayGoalDifferenceSwing.value).toBe((3 - 2) - (0 - 2));
    expect(s).not.toHaveProperty("xG");
    expect(s).not.toHaveProperty("stats");
  });

  it("공식 8경기만으로 23골과 집중도를 재계산한다", () => {
    const s = snapshot("nations-league-eight-matches-23-goals");
    expect(s.matches).toHaveLength(8);
    expect(s.matches.map((m: any) => [m.home, m.away, m.homeGoals, m.awayGoals])).toEqual([
      ["덴마크", "노르웨이", 2, 3], ["웨일스", "포르투갈", 2, 3],
      ["헝가리", "북아일랜드", 1, 1], ["우크라이나", "조지아", 1, 0],
      ["이스라엘", "오스트리아", 1, 1], ["아일랜드", "코소보", 3, 0],
      ["보스니아 헤르체고비나", "루마니아", 2, 1], ["폴란드", "스웨덴", 1, 1]
    ]);
    const totals = s.matches.map((m: any) => m.homeGoals + m.awayGoals);
    const sum = totals.reduce((a: number, b: number) => a + b, 0);
    const top = [...totals].sort((a: number, b: number) => b - a).slice(0, 2).reduce((a: number, b: number) => a + b, 0);
    expect(totals).toEqual(s.calculations.totalGoals.terms);
    expect(sum).toBe(23);
    expect(sum).toBe(s.calculations.totalGoals.value);
    expect(top).toBe(10);
    expect(s.calculations.topTwoSharePercent).toMatchObject({ numerator: top, denominator: sum, rounded: 43.5 });
    expect(s.calculations.topTwoSharePercent.value).toBe(top / sum * 100);
    expect(Number((top / sum * 100).toFixed(1))).toBe(43.5);
    expect(s.calculations.overallAverage.value).toBe(sum / 8);
    expect(s.calculations.overallAverage.rounded).toBe(2.88);
    expect(s.calculations.remainingAverage.value).toBe((sum - top) / 6);
    expect(totals.every((n: number) => n > 0)).toBe(true);
  });

  it("기사와 스냅샷은 중복 없는 일대일 slug 계약이다", () => {
    expect(FOOTBALL_NEWS).toHaveLength(3);
    const slugs = FOOTBALL_NEWS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(3);
    expect(Object.keys(FOOTBALL_NEWS_SNAPSHOTS).sort()).toEqual([...slugs].sort());
  });

  it.each(FOOTBALL_NEWS)("$slug 축구 우선·출처·접근성·완성도", (story) => {
    const s = snapshot(story.slug);
    expect(story.kind).toBe("match-report");
    expect(story.publishedAt).toBe("2026-11-20");
    expect(story.dataAsOf).toBe("2026-11-20T13:30:46.941Z");
    expect(s.asOf).toBe(story.dataAsOf);
    expect(s.scope).toBe(story.scope);
    expect(s.sources).toEqual(story.sources);
    expect(story.featureStat.value.length).toBeGreaterThan(0);
    expect(story.topic.length).toBeGreaterThan(0);
    expect(story.summary.length).toBeGreaterThan(30);
    expect(story.sources.length).toBeGreaterThanOrEqual(2);
    for (const url of story.sources) {
      expect(url).toMatch(/^https:\/\//);
      expect(story.body).toContain(`href="${url}"`);
    }
    expect(story.body).toContain(`href="/stories/${story.slug}/snapshot.json"`);
    expect(story.body).toContain('id="story-sources"');
    expect(story.body.match(/<figure /g)).toHaveLength(1);
    expect(story.body).toContain("<figcaption>");
    expect(story.body).not.toMatch(/<img|<style|style=|전문가 검수|전문가 심사 완료/);
    expect(story.body).not.toContain("오늘");
    expect(story.body).not.toMatch(/<h2>(?:질문|관찰|한계):/);
    const lead = story.body.split("</section>")[0];
    expect(lead).not.toMatch(/예측|확률|토토|구매|베팅/);
    expect(plain(story.body).length).toBeGreaterThanOrEqual(700);
    expect(plain(story.body).length).toBeLessThanOrEqual(1100);
    expect(s.limitations.length).toBeGreaterThan(0);
  });

  it("현지 기사 날짜와 한국시간 경기 날짜를 구별한다", () => {
    for (const story of FOOTBALL_NEWS) {
      const s = snapshot(story.slug);
      expect(new Date(s.kickoffAt).getTime()).toBe(new Date(s.kickoffKst).getTime());
      expect(story.eventDate).toBe(s.kickoffKst.slice(0, 10));
      expect(story.eventDate < story.publishedAt).toBe(true);
    }
    expect(snapshot("norway-denmark-comeback-clock").sourceReportDate).toBe("2026-11-17");
    expect(snapshot("nations-league-eight-matches-23-goals").eventLocalDate).toBe("2026-11-17");
  });
});
