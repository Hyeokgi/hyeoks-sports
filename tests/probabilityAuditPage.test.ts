import { describe, it, expect, vi } from "vitest";
import { computeProbabilityAudit, renderProbabilityAuditPage, probabilityAuditIndexable, wilson95, loadProbabilityAudit, PROBABILITY_AUDIT_SQL, type AuditDbRow } from "../src/lib/probabilityAuditPage";
import { handleProbabilityAuditPage } from "../src/routes/probabilityAuditPage";
import type { Env } from "../src/types";
const NOW = Date.parse("2026-10-15T00:00:00Z");
function row(id = 1, patch: Partial<AuditDbRow> = {}): AuditDbRow {
  return { round_match_id: id, round_id: 1, round_no: 60, round_no_confirmed: 1, seq: id, league: "EPL", home_kr: "홈" + id, away_kr: "원정", kickoff_at: "2026-10-10T12:00:00Z", snapshot_round_match_id: id, p_home: .7, p_draw: .2, p_away: .1, pick: "홈승", basis: "model", confidence_gap: .5, tier: null, n_bookmakers: null, captured_at: "2026-10-10T11:00:00Z", result_round_match_id: id, actual: "H", hg: 1, ag: 0, settled_at: "2026-10-10T14:00:00Z", computed_at: "2026-10-10T10:00:00Z", ...patch };
}
const audit = (rows: AuditDbRow[]) => computeProbabilityAudit(rows, NOW);
function db(rows: AuditDbRow[]) {
  const all = vi.fn().mockResolvedValue({ results: rows });
  const bind = vi.fn().mockReturnValue({ all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { env: { DB: { prepare } } as unknown as Env, prepare, bind, all };
}

describe("확률 감사의 엄격한 포함 규칙", () => {
  it("누락·잘못된 스냅샷·근거·확률·미정산·사후 기록은 제외하며 합계가 맞는다", () => {
    const cases: Partial<AuditDbRow>[] = [
      { snapshot_round_match_id: null }, { captured_at: "bad" }, { captured_at: "2026-10-10T12:00:00Z" },
      { basis: "none" }, { basis: "unknown" }, { p_home: NaN }, { p_home: .8 }, { pick: "무승부" },
      { result_round_match_id: null }, { actual: "D" }, { kickoff_at: null }, { settled_at: "bad" },
      { computed_at: null }, { computed_at: "2026-10-10T12:00:00Z" }, { computed_at: "bad" },
    ];
    const a = audit([row(), ...cases.map((x, i) => row(i + 2, x))]);
    expect(a.overall.n).toBe(1);
    expect(a.excludedTotal).toBe(cases.length);
    expect(a.considered).toBe(a.overall.n + a.excludedTotal);
    expect(a.provenanceExcluded).toEqual({ unknown: 2, afterKickoff: 1 });
    expect(a.record.excluded.byReason.basis_none).toBe(1);
    expect(a.record.excluded.byReason.invalid_basis).toBe(1);
  });
  it("회차가 달라도 같은 경기는 가장 최근의 사전 저장본 하나만 남긴다", () => {
    const a = audit([row(1), row(2, { home_kr: "ホーム" }), row(3, { home_kr: "ホーム", round_id: 2, round_no: 61, captured_at: "2026-10-10T11:30:00Z", basis: "market" })]);
    expect(a.overall.n).toBe(2);
    expect(a.record.excluded.byReason.duplicate).toBe(1);
    expect(a.byBasis.find((x) => x.key === "market")!.n).toBe(1);
  });
  it("최근 100건을 넘는 전체 경기와 묶음 경계의 중복을 처리한다", () => {
    const rows = Array.from({ length: 240 }, (_, i) => row(i + 1));
    rows.push(row(300, { home_kr: "홈1", captured_at: "2026-10-10T11:45:00Z", basis: "national" }));
    const a = audit(rows);
    expect(a.overall.n).toBe(240);
    expect(a.overall.bins.reduce((s, b) => s + b.n, 0)).toBe(240);
    expect(a.record.recentRows).toHaveLength(100);
    expect(a.considered).toBe(a.overall.n + a.excludedTotal);
    expect(a.byBasis.find((x) => x.key === "national")!.n).toBe(1);
  });
});

describe("관측 단위·경계·불확실성", () => {
  it("하한 포함, 마지막 100% 포함으로 고정 구간을 나눈다", () => {
    const probs = [1 / 3, .4, .5, .6, .7, .8, .9, 1];
    const a = audit(probs.map((p, i) => row(i + 1, { p_home: p, p_draw: (1 - p) / 2, p_away: (1 - p) / 2 })));
    expect(a.overall.bins.map((b) => b.n)).toEqual([1, 1, 1, 1, 1, 1, 2]);
  });
  it("최고 확률 일치율과 결과 범주별 발생률의 분모를 혼동하지 않는다", () => {
    const a = audit([row(1), row(2, { actual: "D", hg: 0, ag: 0 }), row(3, { p_home: .1, p_draw: .2, p_away: .7, pick: "원정승", actual: "A", hg: 0, ag: 2 })]);
    const bin = a.overall.bins.find((b) => b.lower === .7)!;
    expect(bin.n).toBe(3);
    expect(bin.observed).toBeCloseTo(2 / 3);
    expect(bin.meanPredicted).toBeCloseTo(.7);
    expect(bin.gapPp).toBeCloseTo((2 / 3 - .7) * 100);
    expect(a.overall.outcomes.map((o) => o.n)).toEqual([3, 3, 3]);
    expect(a.overall.outcomes.map((o) => o.successes)).toEqual([1, 1, 1]);
    expect(a.overall.outcomes[0].expected).toBeCloseTo(1.5);
    expect(a.overall.outcomes[0].gapPp).toBeLessThan(0);
    expect(a.overall.outcomes[1].gapPp).toBeGreaterThan(0);
    expect(a.overall.outcomes.reduce((s, o) => s + o.observed!, 0)).toBeCloseTo(1);
  });
  it("0건은 null이며 Wilson 구간은 양 끝점에서도 유한하다", () => {
    expect(wilson95(0, 0)).toBeNull();
    expect(wilson95(2, 1)).toBeNull();
    const zero = wilson95(0, 10)!;
    expect(zero[0]).toBeCloseTo(0);
    expect(zero[1]).toBeCloseTo(.2775328);
    expect(wilson95(10, 10)![1]).toBeCloseTo(1);
    const mid = wilson95(5, 10)!;
    expect(mid[0]).toBeCloseTo(.2365931);
    expect(mid[1]).toBeCloseTo(.7634069);
    const a = audit([]);
    expect(a.overall.bins.every((b) => b.meanPredicted === null && b.observed === null && b.interval === null)).toBe(true);
    expect(renderProbabilityAuditPage(a)).toContain("0% 성적으로 표시하지 않습니다");
  });
});

describe("공개 화면과 조회 경계", () => {
  it("요약 해설 수치도 포함 경기에서 직접 계산하며 인과를 단정하지 않는다", () => {
    const html = renderProbabilityAuditPage(audit([row(1), row(2, {actual: "D", hg: 0, ag: 0})]));
    expect(html).toContain("이번 표본에서 확인한 것");
    expect(html).toContain("1순위 평균 확률은 70.0%, 실제 결과와 일치한 비율은 50.0%");
    expect(html).toContain("차이는 -20.0%p");
    expect(html).toContain("지속적인 모델 편향을 입증하지 않습니다");
  });
  it("고유 100경기부터 색인하되 중복은 기준을 부풀리지 않는다", () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1));
    expect(probabilityAuditIndexable(audit(rows.slice(0, 99)))).toBe(false);
    expect(renderProbabilityAuditPage(audit(rows.slice(0, 99)))).toContain('content="noindex,follow"');
    expect(probabilityAuditIndexable(audit(rows))).toBe(true);
    expect(renderProbabilityAuditPage(audit(rows))).not.toContain('content="noindex,follow"');
    expect(probabilityAuditIndexable(audit([...rows.slice(0, 99), row(999, { home_kr: "홈1" })]))).toBe(false);
  });
  it("리그·출처·버전 한계·관측 단위·기간·소표본 안내와 이스케이프", () => {
    const html = renderProbabilityAuditPage(audit([row(1, { league: '<img src=x onerror="bad">' })]));
    expect(html).toContain("&lt;img src=x onerror=&quot;bad&quot;&gt;");
    expect(html).not.toContain('<img src=x');
    for (const text of ["Wilson 95%", "소표본", "현재 모델의 능력을 뜻하지", "모델 버전이 기록돼 있지", "3N개의 독립 경기가 아닙니다", "argmax", "실제 − 예측", "자료 조회 기준", "국가대표 Elo", "해외 배당", "href=\"/performance\"", "probability_audit_view", "검색엔진 요구가 아니라"]) expect(html).toContain(text);
  });
  it("조회 상한+1과 읽기 전용 원자료를 사용한다", async () => {
    const mock = db([row()]);
    const a = await loadProbabilityAudit(mock.env, NOW);
    expect(mock.bind).toHaveBeenCalledWith(5001);
    expect(mock.prepare).toHaveBeenCalledWith(PROBABILITY_AUDIT_SQL);
    expect(PROBABILITY_AUDIT_SQL).toContain("rp.computed_at AS computed_at");
    expect(PROBABILITY_AUDIT_SQL).toContain("LEFT JOIN prediction_snapshots");
    expect(PROBABILITY_AUDIT_SQL).toContain("LEFT JOIN round_results");
    expect(a.overall.n).toBe(1);
  });
  it("성공은 600초 캐시, 실패는 브랜드 503이며 내부 오류를 공개하지 않는다", async () => {
    const mock = db([]);
    const ok = await handleProbabilityAuditPage(mock.env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=600");
    mock.all.mockRejectedValueOnce(new Error("secret database details"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fail = await handleProbabilityAuditPage(mock.env);
      expect(fail.status).toBe(503);
      expect(fail.headers.get("cache-control")).toBe("no-store");
      const html = await fail.text();
      expect(html).toContain("HYEOKS");
      expect(html).not.toContain("secret database details");
    } finally { spy.mockRestore(); }
  });
});
