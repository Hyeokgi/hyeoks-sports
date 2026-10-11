// 검증 하네스(scripts/lib/evalHarness.ts) 피처 계약 v2 테스트.
//
// 왜: 2026-10-11 감사에서 v1 하네스가 (1) 리그 무승부율을 전체 행으로 미리 계산해 미래 결과를
// 피처에 섞었고, (2) formDiff를 /3 해서 운영(0~3 척도)과 단위가 달랐고, (3) 같은 날 경기를 행
// 순서대로 갱신해 같은 날 결과가 뒤 경기 피처로 샐 수 있었다. 이 테스트는 그 세 가지가 다시
// 생기지 않게 막고, 피처가 운영(computeEloAndHistory + recentForm + h2hDiff + 리그 무승부율)이
// 그 날짜 직전에 계산했을 값과 같은지 합성 데이터로 확인한다.
import { describe, expect, it } from "vitest";
import {
  buildFeatures,
  chronologicalCut,
  dayKey,
  walkForward,
  WARMUP,
  type Features,
  type Probs,
} from "../scripts/lib/evalHarness";
import {
  computeEloAndHistory,
  recentForm,
  h2hDiff,
  leagueDrawRate,
  seasonOf,
  type MatchRow,
} from "../src/lib/elo";
import { FALLBACK_DRAW_RATE } from "../src/lib/prediction";

// 재현 가능한 의사난수(mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(base: string, plusDays: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}

// 두 리그를 같은 날짜에 섞어 만든다.
//   EPL: 교차연도 시즌(7월 경계), 8팀, 주 1회 4경기
//   라리가: 교차연도 + 리그별 홈어드밴티지(105), 6팀
//   K리그1: 역년 시즌(1월 경계), 6팀
// 100주면 각 리그가 시즌 경계를 두 번 넘는다(시즌 회귀 동치 확인용).
function synth(seed = 7, weeks = 100): MatchRow[] {
  const rand = rng(seed);
  const leagues: { league: string; teams: string[] }[] = [
    { league: "EPL", teams: ["A", "B", "C", "D", "E", "F", "G", "H"] },
    { league: "라리가", teams: ["La", "Lb", "Lc", "Ld", "Le", "Lf"] },
    { league: "K리그1", teams: ["Ka", "Kb", "Kc", "Kd", "Ke", "Kf"] },
  ];
  const rows: MatchRow[] = [];
  for (let w = 0; w < weeks; w++) {
    const date = isoDay("2023-08-05", 7 * w);
    for (const { league, teams } of leagues) {
      const perm = [...teams];
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      for (let k = 0; k < perm.length; k += 2) {
        rows.push({ league, date, home: perm[k], away: perm[k + 1], hg: Math.floor(rand() * 4), ag: Math.floor(rand() * 3) });
      }
    }
  }
  return rows;
}

// 운영 getAllMatches와 같은 정렬(league, date). 같은 날짜 안에서는 입력 순서를 유지한다.
function productionOrder(rows: MatchRow[]): MatchRow[] {
  return [...rows].sort((a, b) => (a.league < b.league ? -1 : a.league > b.league ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

describe("evalHarness 피처 계약 v2", () => {
  it("운영 Elo/폼/H2H/무승부율과 동치다 (그 날짜 이전에 끝난 경기만으로 운영 경로를 다시 돌린 값)", () => {
    const rows = synth();
    const feats = buildFeatures(rows);
    const days = [...new Set(rows.map((r) => dayKey(r.date)))];

    const expected: Omit<Features, "market" | "extra">[] = [];
    let seasonOpeners = 0;
    for (const day of days) {
      const prior = rows.filter((r) => dayKey(r.date) < day);
      const { elo, teamHistory, h2h } = computeEloAndHistory(productionOrder(prior));
      for (const r of rows.filter((x) => dayKey(x.date) === day)) {
        const nH = teamHistory.get(`${r.league}|${r.home}`)?.length ?? 0;
        const nA = teamHistory.get(`${r.league}|${r.away}`)?.length ?? 0;
        if (nH < WARMUP || nA < WARMUP) continue;
        const season = seasonOf(r.league, r.date);
        const hs = elo.get(`${r.league}|${r.home}`);
        if (hs && hs.lastSeason !== season) seasonOpeners++;
        const nLeague = prior.filter((m) => m.league === r.league).length;
        expected.push({
          league: r.league,
          date: r.date,
          season,
          // createRound/syncFixtures와 같은 방식으로 읽는다(시즌 회귀 미적용 상태 그대로).
          eloDiff: (hs?.elo ?? 1500) - (elo.get(`${r.league}|${r.away}`)?.elo ?? 1500),
          formDiff: recentForm(teamHistory, r.league, r.home).avgPts - recentForm(teamHistory, r.league, r.away).avgPts,
          h2hDiff: h2hDiff(h2h, r.league, r.home, r.away).diff,
          drawBase: nLeague > 0 ? leagueDrawRate(prior, r.league) : FALLBACK_DRAW_RATE,
          drawBaseN: nLeague,
          homeAdv: r.league === "라리가" ? 105 : 60,
          outcome: r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2,
        });
      }
    }

    expect(feats.length).toBe(expected.length);
    expect(feats.length).toBeGreaterThan(500);
    // 시즌 개막 경기(회귀가 아직 안 걸린 상태)가 표본에 실제로 들어 있어야 이 테스트가 의미 있다.
    expect(seasonOpeners).toBeGreaterThan(0);
    feats.forEach((f, i) => {
      const e = expected[i];
      expect(f.league).toBe(e.league);
      expect(f.date).toBe(e.date);
      expect(f.season).toBe(e.season);
      expect(f.eloDiff).toBeCloseTo(e.eloDiff, 9);
      expect(f.formDiff).toBeCloseTo(e.formDiff, 12);
      expect(f.h2hDiff).toBeCloseTo(e.h2hDiff, 12);
      expect(f.drawBase).toBeCloseTo(e.drawBase, 12);
      expect(f.drawBaseN).toBe(e.drawBaseN);
      expect(f.homeAdv).toBe(e.homeAdv);
      expect(f.outcome).toBe(e.outcome);
    });

    // 운영 척도(0~3): /3 척도에서는 절대값이 1을 넘을 수 없다.
    expect(feats.every((f) => Math.abs(f.formDiff) <= 3 + 1e-12)).toBe(true);
    expect(feats.some((f) => Math.abs(f.formDiff) > 1)).toBe(true);
  });

  it("formDiff는 운영 단위다: 5연승 팀 vs 5연패 팀이면 3.0 (0~1 척도의 1.0이 아니다)", () => {
    const rows: MatchRow[] = [];
    for (let d = 0; d < WARMUP + 1; d++) {
      const date = isoDay("2025-03-01", 7 * d);
      rows.push({ league: "K리그1", date, home: "Win", away: "Foil1", hg: 2, ag: 0 });
      rows.push({ league: "K리그1", date, home: "Foil2", away: "Lose", hg: 1, ag: 0 });
    }
    rows.push({ league: "K리그1", date: isoDay("2025-03-01", 7 * (WARMUP + 1)), home: "Win", away: "Lose", hg: 0, ag: 0 });
    const feats = buildFeatures(rows);
    const last = feats[feats.length - 1];
    expect(last.date).toBe(isoDay("2025-03-01", 7 * (WARMUP + 1)));
    expect(last.formDiff).toBe(3);
  });

  it("뒤에 붙는 미래 결과는 앞 구간 피처를 바꾸지 못한다 (무승부율 전체행 누수 회귀 방지)", () => {
    const rows = synth(11);
    const days = [...new Set(rows.map((r) => dayKey(r.date)))];
    const cutDay = days[60];
    const prefix = rows.filter((r) => dayKey(r.date) <= cutDay);
    const base = buildFeatures(prefix);
    expect(base.length).toBeGreaterThan(0);

    // 1) 그대로 이어 붙이기
    expect(buildFeatures(rows).slice(0, base.length)).toEqual(base);

    // 2) 미래 결과를 전부 무승부로 바꾸기 - v1에서는 전체행 무승부율 때문에 앞 구간 drawBase가 바뀌었다.
    const allDrawFuture = rows.map((r) => (dayKey(r.date) > cutDay ? { ...r, hg: 1, ag: 1 } : r));
    expect(buildFeatures(allDrawFuture).slice(0, base.length)).toEqual(base);

    // 3) 미래 결과를 홈 대승으로 바꾸기
    const homeRout = rows.map((r) => (dayKey(r.date) > cutDay ? { ...r, hg: 5, ag: 0 } : r));
    expect(buildFeatures(homeRout).slice(0, base.length)).toEqual(base);
  });

  it("앞 구간이 하루 중간에서 끊겨도, 같은 날 뒤에 붙는 경기는 앞 경기 피처를 바꾸지 못한다", () => {
    const rows = synth(13);
    const days = [...new Set(rows.map((r) => dayKey(r.date)))];
    const day = days[50];
    const firstIdx = rows.findIndex((r) => dayKey(r.date) === day);
    const prefix = rows.slice(0, firstIdx + 3); // 그날 18경기 중 3경기만
    const base = buildFeatures(prefix);
    const full = buildFeatures(rows);
    expect(full.slice(0, base.length)).toEqual(base);
  });

  it("같은 날 다른 경기 결과가 피처로 새지 않는다 (Elo·폼·H2H·무승부율 모두)", () => {
    const rows = synth(17);
    const days = [...new Set(rows.map((r) => dayKey(r.date)))];
    const day = days[70];
    const idxs = rows.map((r, i) => (dayKey(r.date) === day ? i : -1)).filter((i) => i >= 0);
    const strip = (f: Features) => ({ ...f, outcome: 0 });
    const onDay = (fs: Features[]) => fs.filter((f) => dayKey(f.date) === day).map(strip);
    const before = onDay(buildFeatures(rows));
    expect(before.length).toBeGreaterThan(1);
    // 그날 각 경기의 결과를 하나씩 뒤집어도 그날 피처(결과 제외)는 그대로여야 한다.
    for (const i of idxs) {
      const flipped = rows.map((r, k) => (k === i ? { ...r, hg: r.ag + 3, ag: r.hg } : r));
      expect(onDay(buildFeatures(flipped))).toEqual(before);
    }
  });

  it("같은 팀이 같은 날 두 번 뛰어도 첫 경기 결과가 둘째 경기 피처로 새지 않는다", () => {
    const rows: MatchRow[] = [];
    const teams = ["P", "Q", "R", "S"];
    for (let d = 0; d < WARMUP + 2; d++) {
      const date = isoDay("2025-03-01", 7 * d);
      rows.push({ league: "K리그1", date, home: teams[d % 4], away: teams[(d + 1) % 4], hg: d % 3, ag: 1 });
      rows.push({ league: "K리그1", date, home: teams[(d + 2) % 4], away: teams[(d + 3) % 4], hg: 1, ag: d % 2 });
    }
    const dDay = isoDay("2025-03-01", 7 * (WARMUP + 2));
    const make = (hg: number, ag: number): MatchRow[] => [
      ...rows,
      { league: "K리그1", date: dDay, home: "P", away: "Q", hg, ag },
      { league: "K리그1", date: dDay, home: "R", away: "P", hg: 1, ag: 1 },
    ];
    const second = (fs: Features[]) => {
      const sameDay = fs.filter((f) => f.date === dDay);
      expect(sameDay.length).toBe(2);
      return sameDay[1];
    };
    const a = second(buildFeatures(make(5, 0)));
    const b = second(buildFeatures(make(0, 5)));
    const c = second(buildFeatures(make(2, 2)));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("훅 순서: 그날 extraFeatures가 모두 끝난 뒤에야 그날 onMatch가 불린다", () => {
    const rows = synth(19, 40);
    const log: { kind: "extra" | "match"; day: string }[] = [];
    let seen = 0; // onMatch로 누적된 경기 수(xG 히스토리 같은 외부 상태 흉내)
    const seenAtExtra: { day: string; seen: number }[] = [];
    const feats = buildFeatures(rows, {
      extraFeatures: (m) => {
        log.push({ kind: "extra", day: dayKey(m.date) });
        seenAtExtra.push({ day: dayKey(m.date), seen });
        return { seen };
      },
      onMatch: (m) => {
        log.push({ kind: "match", day: dayKey(m.date) });
        seen++;
      },
    });
    // 날짜별로: 그날 마지막 extra 위치 < 그날 첫 match 위치
    for (const day of new Set(log.map((e) => e.day))) {
      const lastExtra = log.map((e, i) => (e.day === day && e.kind === "extra" ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
      const firstMatch = log.findIndex((e) => e.day === day && e.kind === "match");
      if (lastExtra >= 0) expect(lastExtra).toBeLessThan(firstMatch);
    }
    // extraFeatures가 본 외부 상태는 정확히 "전날까지의 경기 수"다.
    for (const { day, seen: s } of seenAtExtra) {
      expect(s).toBe(rows.filter((r) => dayKey(r.date) < day).length);
    }
    expect(feats.every((f) => f.extra.seen === rows.filter((r) => dayKey(r.date) < dayKey(f.date)).length)).toBe(true);
    // onMatch는 워밍업과 무관하게 모든 경기에 한 번씩
    expect(log.filter((e) => e.kind === "match").length).toBe(rows.length);
  });

  it("날짜순이 아닌 입력과 ISO가 아닌 날짜는 예외를 던진다", () => {
    const rows = synth(23, 20);
    const swapped = [...rows];
    [swapped[0], swapped[swapped.length - 1]] = [swapped[swapped.length - 1], swapped[0]];
    expect(() => buildFeatures(swapped)).toThrow(/날짜순/);
    expect(() => buildFeatures([{ league: "EPL", date: "05/08/2023", home: "A", away: "B", hg: 1, ag: 0 }])).toThrow(/ISO/);
  });

  it("시간순 분할은 같은 날짜를 train/test로 쪼개지 않는다", () => {
    const feats = buildFeatures(synth(29));
    for (const frac of [0.5, 0.6, 0.7, 0.8]) {
      const cut = chronologicalCut(feats, frac);
      expect(cut).toBeGreaterThanOrEqual(Math.floor(feats.length * frac));
      if (cut > 0 && cut < feats.length) expect(dayKey(feats[cut].date)).not.toBe(dayKey(feats[cut - 1].date));
    }
    const res = walkForward(
      feats,
      (): Probs => [0.45, 0.28, 0.27],
      (train) => train.length,
    );
    for (const r of res) {
      expect(r.nTrain + r.nTest).toBe(feats.length);
      expect(r.tuned).toBe(r.nTrain);
      const last = feats[r.nTrain - 1];
      const first = feats[r.nTrain];
      if (last && first) expect(dayKey(first.date) > dayKey(last.date)).toBe(true);
    }
  });
});
