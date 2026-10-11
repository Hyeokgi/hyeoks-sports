// 공개 적중 기록 집계가 "킥오프 전에 실제로 공개한 예측"만, 의심스러운 행 없이 세는지 고정한다.
// 공개 성적표는 한 번 부풀려지면 신뢰를 되돌리기 어렵다 - 제외 규칙 하나하나를 테스트로 묶어 둔다.
import { describe, expect, it } from "vitest";
import {
  EXCLUDED_SAMPLES_LIMIT,
  EXCLUSION_REASONS,
  EXCLUSION_REASON_LABELS,
  LOG_LOSS_EPSILON,
  PERFORMANCE_ROW_CEILING,
  PUBLIC_PERFORMANCE_SQL,
  RECENT_ROWS_LIMIT,
  gameIdentity,
  loadPublicPerformance,
  parseTimestamp,
  summarizePublicPerformance,
  type PublicPerformanceDbRow,
} from "../src/lib/publicPerformance";
import type { Env } from "../src/types";

const NOW = Date.parse("2026-10-11T12:00:00Z");

let nextId = 1;
/** 기본값은 "집계에 들어가는 정상 행". 테스트마다 필요한 칸만 바꾼다. */
function row(over: Partial<PublicPerformanceDbRow> = {}): PublicPerformanceDbRow {
  const id = over.round_match_id ?? nextId++;
  return {
    round_match_id: id,
    round_id: 10,
    round_no: 58,
    round_no_confirmed: 1,
    seq: 1,
    league: "EPL",
    home_kr: `홈${id}`,
    away_kr: `원정${id}`,
    kickoff_at: "2026-10-05T14:00:00.000Z",
    snapshot_round_match_id: id,
    p_home: 0.5,
    p_draw: 0.3,
    p_away: 0.2,
    pick: "홈승",
    basis: "model",
    confidence_gap: 0.2,
    tier: "보통",
    n_bookmakers: 8,
    captured_at: "2026-10-05T12:00:00.000Z",
    result_round_match_id: id,
    actual: "H",
    hg: 2,
    ag: 1,
    settled_at: "2026-10-05T18:00:00.000Z",
    ...over,
  };
}

function reasonOf(r: PublicPerformanceDbRow, now = NOW) {
  const s = summarizePublicPerformance([r], now);
  const reasons = EXCLUSION_REASONS.filter((k) => s.excluded.byReason[k] > 0);
  return { s, reason: reasons.length === 1 ? reasons[0] : reasons.length === 0 ? null : reasons.join(",") };
}

describe("parseTimestamp", () => {
  it("ISO(Z·밀리초·오프셋)와 SQLite 공백 표기를 같은 시각으로 읽는다", () => {
    const t = Date.parse("2026-09-27T10:00:00Z");
    expect(parseTimestamp("2026-09-27T10:00:00Z")).toBe(t);
    expect(parseTimestamp("2026-09-27T10:00:00.000Z")).toBe(t);
    expect(parseTimestamp("2026-09-27 10:00:00")).toBe(t); // SQLite datetime('now')는 UTC
    expect(parseTimestamp("2026-09-27T10:00")).toBe(t);
    expect(parseTimestamp("2026-09-27T19:00:00+09:00")).toBe(t);
    expect(parseTimestamp("2026-09-27T19:00:00+0900")).toBe(t);
    expect(parseTimestamp("2026-09-27t10:00:00z")).toBe(t);
    expect(parseTimestamp("  2026-09-27T10:00:00Z  ")).toBe(t);
    expect(parseTimestamp("2026-09-27T05:00:00-05:00")).toBe(t);
    expect(parseTimestamp("2026-09-27T10:00:00.123456Z")).toBe(t + 123);
  });
  it("날짜만, 달력에 없는 날, 범위 밖 시각, 이상한 값은 거부한다", () => {
    expect(parseTimestamp("2026-09-27")).toBeNull(); // 시각을 몰라 킥오프 전후 판단 불가
    expect(parseTimestamp("2026-02-30T10:00:00Z")).toBeNull();
    expect(parseTimestamp("2026-02-29T10:00:00Z")).toBeNull(); // 2026은 평년
    expect(parseTimestamp("2028-02-29T10:00:00Z")).toBe(Date.parse("2028-02-29T10:00:00Z"));
    expect(parseTimestamp("2026-04-31T10:00:00Z")).toBeNull();
    expect(parseTimestamp("2026-13-01T10:00:00Z")).toBeNull();
    expect(parseTimestamp("2026-09-27T24:00:00Z")).toBeNull();
    expect(parseTimestamp("2026-09-27T10:60:00Z")).toBeNull();
    expect(parseTimestamp("2026-09-27T10:00:60Z")).toBeNull();
    expect(parseTimestamp("2026-09-27T10:00:00+15:00")).toBeNull();
    expect(parseTimestamp("1970-01-01T00:00:00Z")).toBeNull();
    expect(parseTimestamp("09.27(토) 19:00")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(1727431200000)).toBeNull();
    expect(parseTimestamp("not a date")).toBeNull();
  });
});

describe("제외 규칙 - 행 하나씩", () => {
  it("정상 행은 집계된다", () => {
    const { s, reason } = reasonOf(row());
    expect(reason).toBeNull();
    expect(s.overall.n).toBe(1);
    expect(s.overall.hits).toBe(1);
  });

  it("킥오프 시각 없음/빈 문자열", () => {
    expect(reasonOf(row({ kickoff_at: null })).reason).toBe("missing_kickoff");
    expect(reasonOf(row({ kickoff_at: "  " })).reason).toBe("missing_kickoff");
  });

  it("킥오프 시각 형식 오류", () => {
    expect(reasonOf(row({ kickoff_at: "2026-10-05" })).reason).toBe("invalid_kickoff");
    expect(reasonOf(row({ kickoff_at: "2026-02-30T14:00:00Z" })).reason).toBe("invalid_kickoff");
    expect(reasonOf(row({ kickoff_at: "garbage" })).reason).toBe("invalid_kickoff");
  });

  it("킥오프가 now와 같거나 이후면 아직 집계 대상이 아니다(엄격히 kickoff < now)", () => {
    expect(reasonOf(row({ kickoff_at: new Date(NOW).toISOString() })).reason).toBe("not_started");
    expect(reasonOf(row({ kickoff_at: new Date(NOW + 1).toISOString() })).reason).toBe("not_started");
    expect(
      // 정산 시각은 킥오프 이후여야 한다(기본값 10월 5일을 그대로 두면 invalid_result로 빠진다).
      reasonOf(row({ kickoff_at: new Date(NOW - 1).toISOString(), captured_at: new Date(NOW - 3600e3).toISOString(), settled_at: new Date(NOW).toISOString() })).reason,
    ).toBeNull();
  });

  it("스냅샷이 없으면 다시 계산해 채우지 않고 제외한다", () => {
    const { s, reason } = reasonOf(
      row({ snapshot_round_match_id: null, p_home: null, p_draw: null, p_away: null, pick: null, basis: null, captured_at: null }),
    );
    expect(reason).toBe("missing_snapshot");
    expect(s.overall.n).toBe(0);
    expect(s.overall.accuracy).toBeNull();
  });

  it("캡처 시각 형식 오류", () => {
    expect(reasonOf(row({ captured_at: null })).reason).toBe("invalid_captured_at");
    expect(reasonOf(row({ captured_at: "어제" })).reason).toBe("invalid_captured_at");
  });

  it("캡처가 킥오프와 같거나 이후면 사후 기록이다(엄격히 captured < kickoff)", () => {
    expect(reasonOf(row({ captured_at: "2026-10-05T14:00:00.000Z" })).reason).toBe("captured_at_or_after_kickoff");
    expect(reasonOf(row({ captured_at: "2026-10-05T14:00:00.001Z" })).reason).toBe("captured_at_or_after_kickoff");
    expect(reasonOf(row({ captured_at: "2026-10-06T00:00:00Z" })).reason).toBe("captured_at_or_after_kickoff");
    expect(reasonOf(row({ captured_at: "2026-10-05T13:59:59.999Z" })).reason).toBeNull();
  });

  it("표기가 섞여도 같은 시각 비교를 한다(SQLite 킥오프 vs KST 오프셋 캡처)", () => {
    // 킥오프 14:00Z(SQLite 표기), 캡처 22:30+09:00 = 13:30Z → 킥오프 전
    expect(reasonOf(row({ kickoff_at: "2026-10-05 14:00:00", captured_at: "2026-10-05T22:30:00+09:00" })).reason).toBeNull();
    // 캡처 23:30+09:00 = 14:30Z → 킥오프 후. 문자열 비교였다면 놓쳤을 경우다.
    expect(reasonOf(row({ kickoff_at: "2026-10-05 14:00:00", captured_at: "2026-10-05T23:30:00+09:00" })).reason).toBe(
      "captured_at_or_after_kickoff",
    );
  });

  it("근거 none은 예측이 아니라 제외, 모르는 근거도 제외", () => {
    expect(reasonOf(row({ basis: "none" })).reason).toBe("basis_none");
    expect(reasonOf(row({ basis: "elo" })).reason).toBe("invalid_basis");
    expect(reasonOf(row({ basis: null })).reason).toBe("invalid_basis");
    expect(reasonOf(row({ basis: "Model" })).reason).toBe("invalid_basis");
    for (const b of ["model", "market", "national"]) expect(reasonOf(row({ basis: b })).reason).toBeNull();
  });

  it("확률이 비정상이면 제외(유한·범위·합 1±1e-4)", () => {
    const bad: Partial<PublicPerformanceDbRow>[] = [
      { p_home: null },
      { p_home: Number.NaN },
      { p_home: Number.POSITIVE_INFINITY },
      { p_home: -0.1, p_draw: 0.6, p_away: 0.5 },
      { p_home: 1.2, p_draw: -0.1, p_away: -0.1 },
      { p_home: "0.5" as unknown as number },
      { p_home: 0.5, p_draw: 0.3, p_away: 0.3 }, // 합 1.1
      { p_home: 0.5, p_draw: 0.3, p_away: 0.2002 }, // 합 1.0002
      { p_home: 0.5, p_draw: 0.3, p_away: 0.1997 }, // 합 0.9997
    ];
    for (const b of bad) expect(reasonOf(row(b)).reason).toBe("invalid_probabilities");
    // 저장 반올림 수준의 오차는 허용
    expect(reasonOf(row({ p_home: 0.5, p_draw: 0.3, p_away: 0.20005 })).reason).toBeNull();
    expect(reasonOf(row({ p_home: 0.5, p_draw: 0.3, p_away: 0.19995 })).reason).toBeNull();
    expect(reasonOf(row({ p_home: 1 / 3, p_draw: 1 / 3, p_away: 1 / 3 })).reason).toBeNull();
  });

  it("픽 표기는 저장 형식(한글 라벨)만 인정한다", () => {
    for (const p of ["H", "home", "", null, "홈 승", "toString", "__proto__"]) {
      expect(reasonOf(row({ pick: p })).reason).toBe("invalid_pick");
    }
  });

  it("픽이 최고 확률 결과가 아니면 제외, 동률은 허용", () => {
    expect(reasonOf(row({ pick: "원정승" })).reason).toBe("pick_not_argmax");
    expect(reasonOf(row({ pick: "무승부" })).reason).toBe("pick_not_argmax");
    // 동률이면 그때 낸 픽을 지킨다(predictionSnapshot.ts와 같은 원칙)
    expect(reasonOf(row({ p_home: 0.4, p_draw: 0.2, p_away: 0.4, pick: "원정승", actual: "A", hg: 0, ag: 1 })).reason).toBeNull();
  });

  it("결과 행이 없으면 미정산", () => {
    expect(
      reasonOf(row({ result_round_match_id: null, actual: null, hg: null, ag: null, settled_at: null })).reason,
    ).toBe("unsettled");
  });

  it("결과 코드·점수·정산 시각이 어긋나면 제외", () => {
    const bad: Partial<PublicPerformanceDbRow>[] = [
      { actual: "X" },
      { actual: "h" },
      { actual: null },
      { actual: "H", hg: 1, ag: 1 },
      { actual: "D", hg: 2, ag: 1 },
      { actual: "A", hg: 2, ag: 1 },
      { hg: 2, ag: null },
      { hg: null, ag: 1 },
      { hg: -1, ag: -2 },
      { hg: 2.5, ag: 1 },
      { settled_at: null },
      { settled_at: "나중에" },
      { settled_at: "2026-10-05T13:00:00Z" }, // 킥오프(14:00Z) 전 정산
    ];
    for (const b of bad) expect(reasonOf(row(b)).reason).toBe("invalid_result");
    // 점수 없이 결과 코드만 있는 정산(결과표 폴백)은 정상
    expect(reasonOf(row({ actual: "D", hg: null, ag: null })).reason).toBeNull();
    // 0:0 무승부
    expect(reasonOf(row({ actual: "D", hg: 0, ag: 0 })).reason).toBeNull();
  });

  it("판정 순서: 여러 문제가 겹치면 앞선 사유 하나로만 센다", () => {
    // 스냅샷 없음 + 미정산 → missing_snapshot
    const r1 = reasonOf(row({ snapshot_round_match_id: null, result_round_match_id: null }));
    expect(r1.reason).toBe("missing_snapshot");
    expect(r1.s.excluded.total).toBe(1);
    // 미래 경기 + 스냅샷 없음 → not_started
    expect(reasonOf(row({ kickoff_at: "2026-10-20T10:00:00Z", snapshot_round_match_id: null })).reason).toBe("not_started");
    // 사후 캡처 + none → captured_at_or_after_kickoff
    expect(reasonOf(row({ captured_at: "2026-10-06T00:00:00Z", basis: "none" })).reason).toBe("captured_at_or_after_kickoff");
  });

  it("모든 사유에 화면용 설명이 있다", () => {
    for (const r of EXCLUSION_REASONS) expect(EXCLUSION_REASON_LABELS[r].length).toBeGreaterThan(0);
  });
});

describe("중복 경기", () => {
  const base = {
    league: "UCL",
    home_kr: "레알마드",
    away_kr: "맨체스C",
    kickoff_at: "2026-10-05T19:00:00Z",
    settled_at: "2026-10-05T22:00:00Z",
  };

  it("다른 회차의 같은 경기는 가장 늦은 킥오프 전 캡처 하나만 센다", () => {
    const older = row({ ...base, round_match_id: 101, round_no: 58, captured_at: "2026-10-04T10:00:00Z", p_home: 0.6, p_draw: 0.25, p_away: 0.15 });
    const newer = row({ ...base, round_match_id: 102, round_no: 59, captured_at: "2026-10-05T17:00:00Z", p_home: 0.45, p_draw: 0.3, p_away: 0.25 });
    const s = summarizePublicPerformance([older, newer], NOW);
    expect(s.overall.n).toBe(1);
    expect(s.recentRows[0].roundMatchId).toBe(102);
    expect(s.recentRows[0].pHome).toBe(0.45);
    expect(s.excluded.byReason.duplicate).toBe(1);
    expect(s.excluded.duplicates).toEqual([
      {
        roundMatchId: 101,
        roundNo: 58,
        keptRoundMatchId: 102,
        keptRoundNo: 59,
        identity: gameIdentity("UCL", "레알마드", "맨체스C", Date.parse("2026-10-05T19:00:00Z")),
        conflictingResult: false,
      },
    ]);
    expect(s.excluded.samples[0].reason).toBe("duplicate");
    expect(s.excluded.samples[0].detail).toContain("#102");
  });

  it("입력 순서가 바뀌어도 같은 행을 남긴다", () => {
    const a = row({ ...base, round_match_id: 201, captured_at: "2026-10-05T17:00:00Z" });
    const b = row({ ...base, round_match_id: 202, captured_at: "2026-10-04T10:00:00Z" });
    expect(summarizePublicPerformance([a, b], NOW).recentRows[0].roundMatchId).toBe(201);
    expect(summarizePublicPerformance([b, a], NOW).recentRows[0].roundMatchId).toBe(201);
  });

  it("캡처 시각까지 같으면 나중에 등록된 행(id 큰 쪽)을 남긴다", () => {
    const a = row({ ...base, round_match_id: 301 });
    const b = row({ ...base, round_match_id: 302 });
    expect(summarizePublicPerformance([a, b], NOW).recentRows[0].roundMatchId).toBe(302);
    expect(summarizePublicPerformance([b, a], NOW).recentRows[0].roundMatchId).toBe(302);
  });

  it("무효한 중복 행이 유효한 행을 밀어내지 않는다", () => {
    const valid = row({ ...base, round_match_id: 401, captured_at: "2026-10-04T10:00:00Z" });
    const lateInvalid = row({ ...base, round_match_id: 402, captured_at: "2026-10-05T20:00:00Z" }); // 킥오프 후 캡처
    const s = summarizePublicPerformance([valid, lateInvalid], NOW);
    expect(s.overall.n).toBe(1);
    expect(s.recentRows[0].roundMatchId).toBe(401);
    expect(s.excluded.byReason.captured_at_or_after_kickoff).toBe(1);
    expect(s.excluded.byReason.duplicate).toBe(0);
  });

  it("표기가 달라도 같은 순간이면 같은 경기로 본다", () => {
    const a = row({ ...base, round_match_id: 501, kickoff_at: "2026-10-05 19:00:00" });
    const b = row({ ...base, round_match_id: 502, kickoff_at: "2026-10-06T04:00:00+09:00" });
    const s = summarizePublicPerformance([a, b], NOW);
    expect(s.overall.n).toBe(1);
    expect(s.excluded.byReason.duplicate).toBe(1);
  });

  it("킥오프나 팀이 다르면 다른 경기다(리턴매치 등)", () => {
    const a = row({ ...base, round_match_id: 601 });
    const b = row({ ...base, round_match_id: 602, kickoff_at: "2026-10-08T19:00:00Z", settled_at: "2026-10-08T22:00:00Z" });
    const c = row({ ...base, round_match_id: 603, home_kr: "맨체스C", away_kr: "레알마드" });
    expect(summarizePublicPerformance([a, b, c], NOW).overall.n).toBe(3);
  });

  it("같은 경기인데 결과 기록이 다르면 표시한다", () => {
    const a = row({ ...base, round_match_id: 701, captured_at: "2026-10-04T10:00:00Z", actual: "D", hg: 1, ag: 1 });
    const b = row({ ...base, round_match_id: 702, captured_at: "2026-10-05T17:00:00Z", actual: "H", hg: 2, ag: 1 });
    const s = summarizePublicPerformance([a, b], NOW);
    expect(s.excluded.duplicates[0].conflictingResult).toBe(true);
    expect(s.excluded.samples[0].detail).toContain("불일치");
    expect(s.recentRows[0].actual).toBe("H");
  });
});

describe("지표 - 손으로 계산한 예", () => {
  it("적중률·홈승 기준선·Brier·로그손실", () => {
    const a = row({ p_home: 0.5, p_draw: 0.3, p_away: 0.2, pick: "홈승", actual: "H", hg: 1, ag: 0 });
    const b = row({ p_home: 0.2, p_draw: 0.3, p_away: 0.5, pick: "원정승", actual: "D", hg: 0, ag: 0 });
    const s = summarizePublicPerformance([a, b], NOW);
    expect(s.overall.n).toBe(2);
    expect(s.overall.hits).toBe(1);
    expect(s.overall.accuracy).toBe(0.5);
    expect(s.overall.homeBaseline).toEqual({ hits: 1, accuracy: 0.5 });
    // a: 0.5²+0.3²+0.2² = 0.38 / b: 0.2²+0.7²+0.5² = 0.78
    expect(s.overall.brier!).toBeCloseTo((0.38 + 0.78) / 2, 12);
    expect(s.overall.logLoss!).toBeCloseTo((-Math.log(0.5) - Math.log(0.3)) / 2, 12);
    const byId = new Map(s.recentRows.map((r) => [r.roundMatchId, r]));
    expect(byId.get(a.round_match_id)!.brier).toBeCloseTo(0.38, 12);
    expect(byId.get(b.round_match_id)!.brier).toBeCloseTo(0.78, 12);
    expect(byId.get(b.round_match_id)!.hit).toBe(false);
  });

  it("Brier는 0~2, 확률 0에 결과가 나오면 로그손실은 -ln(1e-15)", () => {
    const perfect = row({ p_home: 1, p_draw: 0, p_away: 0, pick: "홈승", actual: "H", hg: 3, ag: 0 });
    const worst = row({ p_home: 1, p_draw: 0, p_away: 0, pick: "홈승", actual: "A", hg: 0, ag: 1 });
    const s1 = summarizePublicPerformance([perfect], NOW);
    expect(s1.overall.brier).toBe(0);
    expect(s1.overall.logLoss).toBeCloseTo(0, 15);
    const s2 = summarizePublicPerformance([worst], NOW);
    expect(s2.overall.brier).toBe(2);
    expect(s2.overall.logLoss!).toBeCloseTo(-Math.log(LOG_LOSS_EPSILON), 10);
    expect(Number.isFinite(s2.overall.logLoss!)).toBe(true);
    expect(s2.overall.homeBaseline.accuracy).toBe(0);
  });

  it("균등 확률의 로그손실은 ln3", () => {
    const u = row({ p_home: 1 / 3, p_draw: 1 / 3, p_away: 1 / 3, pick: "홈승", actual: "D", hg: 0, ag: 0 });
    const s = summarizePublicPerformance([u], NOW);
    expect(s.overall.logLoss!).toBeCloseTo(Math.log(3), 12);
    expect(s.overall.brier!).toBeCloseTo(2 / 3, 12);
  });

  it("집계 대상이 없으면 비율·평균은 null(0%로 보이지 않게)", () => {
    const s = summarizePublicPerformance([], NOW);
    expect(s.overall).toEqual({ n: 0, hits: 0, accuracy: null, homeBaseline: { hits: 0, accuracy: null }, brier: null, logLoss: null });
    expect(s.range).toEqual({ earliestKickoffAt: null, latestKickoffAt: null, earliestCapturedAt: null, latestCapturedAt: null });
    expect(s.calibrationBins.every((b) => b.n === 0 && b.meanPredicted === null && b.observed === null)).toBe(true);
    expect(s.byBasis).toEqual([]);
    expect(s.considered).toBe(0);
  });

  it("근거별·리그별로 나눠 센다(표본 큰 순, 같으면 이름순)", () => {
    const rows = [
      row({ basis: "model", league: "EPL" }),
      row({ basis: "model", league: "EPL", actual: "A", hg: 0, ag: 1 }),
      row({ basis: "market", league: "UCL" }),
      row({ basis: "national", league: "국가대표" }),
      row({ basis: "none", league: "국가대표" }), // 제외
    ];
    const s = summarizePublicPerformance(rows, NOW);
    expect(s.byBasis.map((g) => [g.key, g.n, g.hits])).toEqual([
      ["model", 2, 1],
      ["market", 1, 1],
      ["national", 1, 1],
    ]);
    expect(s.byLeague.map((g) => [g.key, g.n])).toEqual([
      ["EPL", 2],
      ["UCL", 1],
      ["국가대표", 1],
    ]);
    expect(s.byBasis[0].accuracy).toBe(0.5);
    expect(s.byBasis.find((g) => g.key === "none")).toBeUndefined();
  });
});

describe("최고 확률 구간표", () => {
  it("확신도 차이가 아니라 최고 확률로 나누고, 경계는 아래 포함·위 제외(마지막만 1.0 포함)", () => {
    const mk = (p: [number, number, number], pick: string, actual: "H" | "D" | "A") =>
      row({ p_home: p[0], p_draw: p[1], p_away: p[2], pick, actual, hg: actual === "H" ? 1 : 0, ag: actual === "A" ? 1 : 0 });
    const rows = [
      mk([0.34, 0.33, 0.33], "홈승", "D"), // 40% 미만, 빗나감
      mk([0.4, 0.35, 0.25], "홈승", "H"), // 40~50% (경계 0.4 포함)
      mk([0.25, 0.3, 0.45], "원정승", "H"), // 40~50%, 빗나감
      mk([0.5, 0.3, 0.2], "홈승", "H"), // 50~60%
      mk([0.7, 0.2, 0.1], "홈승", "H"), // 70% 이상 (경계 0.7)
      mk([1, 0, 0], "홈승", "H"), // 70% 이상 (1.0 포함)
    ];
    const s = summarizePublicPerformance(rows, NOW);
    const b = Object.fromEntries(s.calibrationBins.map((x) => [x.label, x]));
    expect(s.calibrationBins.map((x) => x.label)).toEqual(["40% 미만", "40~50%", "50~60%", "60~70%", "70% 이상"]);
    expect(b["40% 미만"].n).toBe(1);
    expect(b["40% 미만"].observed).toBe(0);
    expect(b["40~50%"].n).toBe(2);
    expect(b["40~50%"].meanPredicted!).toBeCloseTo(0.425, 12);
    expect(b["40~50%"].observed).toBe(0.5);
    expect(b["50~60%"].n).toBe(1);
    expect(b["60~70%"]).toMatchObject({ n: 0, meanPredicted: null, observed: null });
    expect(b["70% 이상"].n).toBe(2);
    expect(b["70% 이상"].meanPredicted!).toBeCloseTo(0.85, 12);
    expect(b["70% 이상"].observed).toBe(1);
    expect(s.calibrationBins.reduce((t, x) => t + x.n, 0)).toBe(s.overall.n);
  });
});

describe("요약 전체 성질", () => {
  it("검사한 행 = 집계 + 제외, 사유별 합 = 제외 총수", () => {
    const rows = [
      row(),
      row({ kickoff_at: null }),
      row({ kickoff_at: "2026-10-20T10:00:00Z" }),
      row({ snapshot_round_match_id: null }),
      row({ basis: "none" }),
      row({ result_round_match_id: null }),
      row({ actual: "H", hg: 0, ag: 0 }),
    ];
    const s = summarizePublicPerformance(rows, NOW);
    const sum = EXCLUSION_REASONS.reduce((t, k) => t + s.excluded.byReason[k], 0);
    expect(s.considered).toBe(rows.length);
    expect(s.overall.n + s.excluded.total).toBe(rows.length);
    expect(sum).toBe(s.excluded.total);
    expect(s.overall.n).toBe(1);
  });

  it("아직 안 한 경기는 개수만 세고 제외 표본에는 넣지 않는다", () => {
    const s = summarizePublicPerformance([row({ kickoff_at: "2026-10-20T10:00:00Z" }), row({ basis: "none" })], NOW);
    expect(s.excluded.byReason.not_started).toBe(1);
    expect(s.excluded.samples.map((x) => x.reason)).toEqual(["basis_none"]);
  });

  it("기간은 집계된 경기만으로, 정규화한 UTC ISO로 낸다", () => {
    const s = summarizePublicPerformance(
      [
        row({ kickoff_at: "2026-10-01 10:00:00", captured_at: "2026-09-30T10:00:00+09:00" }),
        row({ kickoff_at: "2026-10-05T14:00:00Z", captured_at: "2026-10-05T12:00:00Z" }),
        row({ kickoff_at: "2026-09-01T10:00:00Z", basis: "none", captured_at: "2026-08-30T00:00:00Z" }), // 제외 → 기간에 안 들어감
      ],
      NOW,
    );
    expect(s.range).toEqual({
      earliestKickoffAt: "2026-10-01T10:00:00.000Z",
      latestKickoffAt: "2026-10-05T14:00:00.000Z",
      earliestCapturedAt: "2026-09-30T01:00:00.000Z",
      latestCapturedAt: "2026-10-05T12:00:00.000Z",
    });
    expect(s.generatedAt).toBe(new Date(NOW).toISOString());
  });

  it("최근 경기 목록은 킥오프 최신순 최대 100건, 집계는 전부", () => {
    const rows: PublicPerformanceDbRow[] = [];
    for (let i = 0; i < 130; i++) {
      const k = Date.parse("2026-01-01T10:00:00Z") + i * 86400e3;
      rows.push(row({ kickoff_at: new Date(k).toISOString(), captured_at: new Date(k - 3600e3).toISOString(), settled_at: new Date(k + 3 * 3600e3).toISOString() }));
    }
    const s = summarizePublicPerformance(rows, NOW);
    expect(s.overall.n).toBe(130);
    expect(s.recentRows).toHaveLength(RECENT_ROWS_LIMIT);
    expect(s.recentRowsLimit).toBe(RECENT_ROWS_LIMIT);
    for (let i = 1; i < s.recentRows.length; i++) {
      expect(s.recentRows[i - 1].kickoffAt >= s.recentRows[i].kickoffAt).toBe(true);
    }
    expect(s.recentRows[0].kickoffAt).toBe(new Date(Date.parse("2026-01-01T10:00:00Z") + 129 * 86400e3).toISOString());
  });

  it("제외 표본은 상한까지만 싣고 개수는 전부 센다", () => {
    const rows = Array.from({ length: EXCLUDED_SAMPLES_LIMIT + 20 }, () => row({ basis: "none" }));
    const s = summarizePublicPerformance(rows, NOW);
    expect(s.excluded.byReason.basis_none).toBe(EXCLUDED_SAMPLES_LIMIT + 20);
    expect(s.excluded.samples).toHaveLength(EXCLUDED_SAMPLES_LIMIT);
  });

  it("집계된 행은 저장값을 그대로 싣는다(재계산·재정규화 없음)", () => {
    const r = row({ p_home: 0.50003, p_draw: 0.3, p_away: 0.2, tier: "확신픽", n_bookmakers: 11 });
    const out = summarizePublicPerformance([r], NOW).recentRows[0];
    expect(out).toMatchObject({
      pHome: 0.50003,
      pDraw: 0.3,
      pAway: 0.2,
      pick: "홈승",
      pickCode: "H",
      pickProbability: 0.50003,
      tier: "확신픽",
      nBookmakers: 11,
      basis: "model",
      roundNo: 58,
      hg: 2,
      ag: 1,
      hit: true,
    });
  });

  it("now는 숫자·Date 모두 받고, 잘못된 값은 거부한다", () => {
    const a = summarizePublicPerformance([row()], NOW);
    const b = summarizePublicPerformance([row({ round_match_id: a.recentRows[0].roundMatchId, home_kr: a.recentRows[0].home, away_kr: a.recentRows[0].away })], new Date(NOW));
    expect(b.overall).toEqual(a.overall);
    expect(() => summarizePublicPerformance([], Number.NaN)).toThrow();
    expect(() => summarizePublicPerformance([], new Date("x"))).toThrow();
  });
});

describe("loadPublicPerformance", () => {
  function fakeEnv(rows: PublicPerformanceDbRow[]) {
    const calls: { sql: string; binds: unknown[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          const call = { sql, binds: [] as unknown[] };
          calls.push(call);
          return {
            bind(...args: unknown[]) {
              call.binds = args;
              return { all: async () => ({ results: rows }) };
            },
          };
        },
        batch() {
          throw new Error("쓰기 금지");
        },
        exec() {
          throw new Error("쓰기 금지");
        },
      },
    } as unknown as Pick<Env, "DB">;
    return { env, calls };
  }

  it("상한이 있는 SELECT 한 번만, 스냅샷·결과는 LEFT JOIN", async () => {
    const { env, calls } = fakeEnv([row()]);
    const rep = await loadPublicPerformance(env, NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe(PUBLIC_PERFORMANCE_SQL);
    expect(calls[0].binds).toEqual([PERFORMANCE_ROW_CEILING + 1]);
    expect(PUBLIC_PERFORMANCE_SQL.trim().startsWith("SELECT")).toBe(true);
    expect(PUBLIC_PERFORMANCE_SQL).toMatch(/FROM round_matches rm/);
    expect(PUBLIC_PERFORMANCE_SQL).toMatch(/LEFT JOIN prediction_snapshots ps ON ps\.round_match_id = rm\.id/);
    expect(PUBLIC_PERFORMANCE_SQL).toMatch(/LEFT JOIN round_results rr ON rr\.round_match_id = rm\.id/);
    expect(PUBLIC_PERFORMANCE_SQL).toMatch(/LIMIT \?\s*$/);
    expect(PUBLIC_PERFORMANCE_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i);
    expect(rep.overall.n).toBe(1);
    expect(rep.source).toEqual({ rowCeiling: PERFORMANCE_ROW_CEILING, rowsFetched: 1, isTruncated: false, truncation: null });
  });

  it("상한을 넘으면 잘라서 세고 잘렸다고 밝힌다", async () => {
    const rows: PublicPerformanceDbRow[] = [];
    for (let i = 0; i < PERFORMANCE_ROW_CEILING + 1; i++) rows.push(row({ round_match_id: 100000 - i }));
    const { env } = fakeEnv(rows);
    const rep = await loadPublicPerformance(env, NOW);
    expect(rep.source.isTruncated).toBe(true);
    expect(rep.source.rowsFetched).toBe(PERFORMANCE_ROW_CEILING);
    expect(rep.considered).toBe(PERFORMANCE_ROW_CEILING);
    expect(rep.overall.n).toBe(PERFORMANCE_ROW_CEILING);
    expect(rep.source.truncation).toContain("5,000");
    // 상한 밖(가장 오래된 등록) 행은 집계에 없다
    expect(rep.recentRows.some((r) => r.roundMatchId === 100000 - PERFORMANCE_ROW_CEILING)).toBe(false);
  });

  it("결과가 비어 있어도(undefined) 빈 요약을 낸다", async () => {
    const env = {
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: undefined }) }) }) },
    } as unknown as Pick<Env, "DB">;
    const rep = await loadPublicPerformance(env, NOW);
    expect(rep.overall.n).toBe(0);
    expect(rep.source.isTruncated).toBe(false);
  });
});
