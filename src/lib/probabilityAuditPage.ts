// 현재 모델로 과거를 메우지 않고 공개 기록의 엄격한 검증기를 재사용한다.
import type { Env } from "../types";
import { PERFORMANCE_ROW_CEILING, RECENT_ROWS_LIMIT, PUBLIC_PERFORMANCE_SQL, summarizePublicPerformance, gameIdentity, parseTimestamp, EXCLUSION_REASON_LABELS, type PublicPerformanceDbRow, type PublicPerformanceSummary, type PerformanceRow } from "./publicPerformance";
import { basisNames, escapeText as e, fullKst, renderSitePage } from "./publicSite";

export const AUDIT_INDEX_MIN = 100;
export const AUDIT_SMALL_SAMPLE = 30;
export const AUDIT_BIN_EDGES = [0, .4, .5, .6, .7, .8, .9, 1] as const;
export interface AuditDbRow extends PublicPerformanceDbRow { computed_at?: string | null }
export interface AuditEstimate { n: number; successes: number; meanPredicted: number | null; observed: number | null; gapPp: number | null; interval: [number, number] | null }
export interface AuditBin extends AuditEstimate { lower: number; upper: number; label: string }
export interface AuditOutcome extends AuditEstimate { outcome: "H" | "D" | "A"; expected: number }
export interface AuditGroup { key: string; n: number; bins: AuditBin[]; outcomes: AuditOutcome[] }
export interface ProbabilityAudit {
  record: PublicPerformanceSummary;
  considered: number;
  provenanceExcluded: { unknown: number; afterKickoff: number };
  excludedTotal: number;
  source: { rowCeiling: number; rowsFetched: number; isTruncated: boolean };
  overall: AuditGroup;
  byBasis: AuditGroup[];
  byLeague: AuditGroup[];
}

/** 경기 독립을 가정한 실제 비율의 Wilson 95% 구간. 예측값의 구간은 아니다. */
export function wilson95(successes: number, n: number): [number, number] | null {
  if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(successes) || successes < 0 || successes > n) return null;
  const z = 1.959963984540054, z2 = z * z, p = successes / n;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
function estimate(n: number, successes: number, sum: number): AuditEstimate {
  const meanPredicted = n ? sum / n : null, observed = n ? successes / n : null;
  return { n, successes, meanPredicted, observed, gapPp: n ? (observed! - meanPredicted!) * 100 : null, interval: wilson95(successes, n) };
}
function group(key: string, rows: PerformanceRow[]): AuditGroup {
  const bins = AUDIT_BIN_EDGES.slice(0, -1).map((lower, i) => {
    const upper = AUDIT_BIN_EDGES[i + 1];
    const selected = rows.filter((r) => r.pickProbability >= lower && (r.pickProbability < upper || (upper === 1 && r.pickProbability === 1)));
    return { lower, upper, label: lower === 0 ? "40% 미만" : (lower * 100).toFixed(0) + "~" + (upper * 100).toFixed(0) + "%", ...estimate(selected.length, selected.filter((r) => r.hit).length, selected.reduce((s, r) => s + r.pickProbability, 0)) };
  });
  const outcomes = (["H", "D", "A"] as const).map((outcome) => {
    const expected = rows.reduce((s, r) => s + (outcome === "H" ? r.pHome : outcome === "D" ? r.pDraw : r.pAway), 0);
    return { outcome, expected, ...estimate(rows.length, rows.filter((r) => r.actual === outcome).length, expected) };
  });
  return { key, n: rows.length, bins, outcomes };
}

/** recentRows가 100건뿐이므로 같은 검증기를 작은 묶음에 적용하고 전체 범위에서 다시 중복 제거한다. */
export function computeProbabilityAudit(input: readonly AuditDbRow[], now: number | Date = Date.now()): ProbabilityAudit {
  const rows = input.slice(0, PERFORMANCE_ROW_CEILING);
  const provenanceExcluded = { unknown: 0, afterKickoff: 0 };
  const eligible = rows.filter((r) => {
    const k = parseTimestamp(r.kickoff_at), c = parseTimestamp(r.computed_at);
    // 출처 시각을 모르면 사전 입력임을 가정하지 않는다. 한 행에는 첫 사유 하나만 부여한다.
    if (c == null) { provenanceExcluded.unknown++; return false; }
    if (k != null && c >= k) { provenanceExcluded.afterKickoff++; return false; }
    return true;
  });
  const record = summarizePublicPerformance(eligible, now);
  const unique = new Map<string, PerformanceRow>();
  for (let i = 0; i < eligible.length; i += RECENT_ROWS_LIMIT) {
    for (const r of summarizePublicPerformance(eligible.slice(i, i + RECENT_ROWS_LIMIT), now).recentRows) {
      const identity = gameIdentity(r.league, r.home, r.away, Date.parse(r.kickoffAt));
      const old = unique.get(identity);
      if (!old || r.capturedAt > old.capturedAt || (r.capturedAt === old.capturedAt && r.roundMatchId > old.roundMatchId)) unique.set(identity, r);
    }
  }
  const counted = [...unique.values()];
  const byBasis = ["model", "market", "national"].map((key) => group(key, counted.filter((r) => r.basis === key)));
  const byLeague = [...new Set(counted.map((r) => r.league))].sort().map((key) => group(key, counted.filter((r) => r.league === key)));
  return { record, considered: rows.length, provenanceExcluded, excludedTotal: record.excluded.total + provenanceExcluded.unknown + provenanceExcluded.afterKickoff, source: { rowCeiling: PERFORMANCE_ROW_CEILING, rowsFetched: rows.length, isTruncated: input.length > PERFORMANCE_ROW_CEILING }, overall: group("전체", counted), byBasis, byLeague };
}
// 현재 확률은 읽지 않는다. 계산 시각은 사후 입력을 제외하는 데만 쓰며 재계산하지 않는다.
export const PROBABILITY_AUDIT_SQL = PUBLIC_PERFORMANCE_SQL
  .replace("rr.settled_at AS settled_at", "rr.settled_at AS settled_at, rp.computed_at AS computed_at")
  .replace("LEFT JOIN rounds r", "LEFT JOIN round_predictions rp ON rp.round_match_id = rm.id\n  LEFT JOIN rounds r");
export async function loadProbabilityAudit(env: Pick<Env, "DB">, now: number | Date = Date.now()): Promise<ProbabilityAudit> {
  const { results } = await env.DB.prepare(PROBABILITY_AUDIT_SQL).bind(PERFORMANCE_ROW_CEILING + 1).all<AuditDbRow>();
  return computeProbabilityAudit(results ?? [], now);
}
export function probabilityAuditIndexable(a: ProbabilityAudit): boolean { return a.overall.n >= AUDIT_INDEX_MIN; }
const pct = (v: number | null) => v == null ? "자료 없음" : (v * 100).toFixed(1) + "%";
const pp = (v: number | null) => v == null ? "자료 없음" : (v > 0 ? "+" : "") + v.toFixed(1) + "%p";
const interval = (v: [number, number] | null) => v ? pct(v[0]) + " ~ " + pct(v[1]) : "자료 없음";
const warning = (n: number) => n === 0 ? "관측 없음" : n < AUDIT_SMALL_SAMPLE ? "소표본 · 해석 유보" : "불확실성 확인";
function table(label: string, headings: string[], rows: string): string {
  return '<div class="site-table-wrap" tabindex="0" role="region" aria-label="' + e(label) + '"><table><caption>' + e(label) + '</caption><thead><tr>' + headings.map((h) => '<th scope="col">' + e(h) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function binTable(g: AuditGroup): string {
  return table(g.key + ' · 최고 확률 구간별 일치율(경기당 1행)', ['예측 구간', '경기 수', '평균 예측', '실제 1순위 일치율', '실제 − 예측', 'Wilson 95% 구간', '주의'], g.bins.map((b) => '<tr><th scope="row">' + e(b.label) + '</th><td>' + b.n + '</td><td>' + pct(b.meanPredicted) + '</td><td>' + pct(b.observed) + '</td><td>' + pp(b.gapPp) + '</td><td>' + interval(b.interval) + '</td><td>' + warning(b.n) + '</td></tr>').join(''));
}
const outcomeNames = { H: "홈승", D: "무승부", A: "원정승" };
function outcomeTable(g: AuditGroup): string {
  return table(g.key + ' · 결과별 확률과 관측 빈도(범주마다 경기당 1사건)', ['결과', '경기 수', '기대 발생 수', '실제 발생 수', '평균 예측 확률', '실제 발생률', '실제 − 예측', 'Wilson 95% 구간'], g.outcomes.map((o) => '<tr><th scope="row">' + outcomeNames[o.outcome] + '</th><td>' + o.n + '</td><td>' + o.expected.toFixed(1) + '</td><td>' + o.successes + '</td><td>' + pct(o.meanPredicted) + '</td><td>' + pct(o.observed) + '</td><td>' + pp(o.gapPp) + '</td><td>' + interval(o.interval) + '</td></tr>').join(''));
}
export function renderProbabilityAuditPage(a: ProbabilityAudit): string {
  const r = a.record;
  const exclusions = Object.entries(r.excluded.byReason).filter(([, n]) => n > 0).map(([key, n]) => '<li>' + n + '건 · ' + e(EXCLUSION_REASON_LABELS[key as keyof typeof EXCLUSION_REASON_LABELS]) + '</li>').join('');
  const observed = a.overall.n ? a.overall.bins.reduce((s, b) => s + b.successes, 0) / a.overall.n : null;
  const predicted = a.overall.n ? a.overall.bins.reduce((s, b) => s + (b.meanPredicted ?? 0) * b.n, 0) / a.overall.n : null;
  const largest = [...a.overall.outcomes].filter((o) => o.gapPp != null).sort((x, y) => Math.abs(y.gapPp!) - Math.abs(x.gapPp!))[0];
  const findings = a.overall.n ? '<section class="site-panel"><h2>이번 표본에서 확인한 것</h2><p>검증된 ' + a.overall.n + '경기의 1순위 평균 확률은 ' + pct(predicted) + ', 실제 결과와 일치한 비율은 ' + pct(observed) + '였습니다. 차이는 ' + pp((observed! - predicted!) * 100) + '입니다.</p>' + (largest ? '<p>세 결과 중 평균 예측과 실제 발생률의 절대 차이가 가장 큰 범주는 ' + outcomeNames[largest.outcome] + '입니다. 평균 예측 ' + pct(largest.meanPredicted) + ', 실제 발생 ' + pct(largest.observed) + ', 차이 ' + pp(largest.gapPp) + '였습니다.</p>' : '') + '<p class="site-note">이는 이번 표본에서 관측한 차이일 뿐 지속적인 모델 편향을 입증하지 않습니다. 확률 출처·리그·시점이 섞여 있고, 구간별 표본 수와 아래 불확실성 안내를 함께 봐야 합니다.</p></section>' : '';
  const body = '<section class="site-hero"><p class="site-eyebrow">HYEOKS 공개 확률 감사</p><h1>70%라는 예측, 실제로 얼마나 맞았을까?</h1><p>킥오프 전에 저장된 확률과 확정 결과를 대조합니다. 현재 모델로 과거 예측을 다시 계산하지 않습니다.</p><p>자료 조회 기준: ' + e(fullKst(r.generatedAt)) + '</p><p>검사 ' + a.considered + '행 · 포함 ' + a.overall.n + '개 고유 경기 · 제외 ' + a.excludedTotal + '행</p><p>포함 경기 기간: ' + e(fullKst(r.range.earliestKickoffAt)) + ' ~ ' + e(fullKst(r.range.latestKickoffAt)) + '<br>예측 저장 기간: ' + e(fullKst(r.range.earliestCapturedAt)) + ' ~ ' + e(fullKst(r.range.latestCapturedAt)) + '</p><p><a href="/performance">경기별 공식 공개 기록과 원자료는 /performance에서 확인</a></p></section>' +
  findings + '<section class="site-panel"><h2>숫자를 읽기 전에</h2><p>확률 보정(calibration)은 비슷한 확률을 제시한 경기에서 실제 발생 비율이 그 확률과 가까운지 보는 일입니다. 최고 확률 결과를 고르는 argmax 적중률과는 다릅니다. 70% 예측이 틀린 한 경기만으로 확률이 잘못됐다고 결론 내릴 수 없습니다.</p><p>첫 표의 관측 단위는 경기당 1행입니다. 저장된 1순위 확률로 구간을 나누고, 그 결과가 맞으면 1, 다르면 0으로 셉니다. 결과 빈도표는 각 경기의 홈승·무승부·원정승을 범주마다 하나의 사건으로 봅니다. 범주별 분모는 각각 N경기이며 3N개의 독립 경기가 아닙니다. 홈승 발생률은 홈승을 고른 예측의 적중률이 아닙니다.</p><p>차이는 실제 관측률 − 평균 예측 확률(%p)입니다. 음수면 예측이 관측보다 높았고 양수면 낮았습니다. 기대 발생 수는 해당 범주의 저장 확률 합으로 정수일 필요가 없습니다.</p><p>Wilson 95% 구간은 실제 관측 비율의 표본 불확실성입니다. 예측 확률 자체의 신뢰구간이나 모델 우수성 검정이 아닙니다. 경기 독립을 가정하므로 같은 팀·일정의 상관은 반영하지 못합니다. 구간별 30경기 미만은 소표본으로 해석을 유보합니다. 30경기 이상도 우수성을 입증하지 않으며 순위표를 만들지 않습니다.</p></section>' +
  '<section class="site-panel"><h2>1. 최고 확률은 실제 일치율과 가까웠나</h2>' + (a.overall.n === 0 ? '<p>검증된 고유 경기가 아직 없습니다. 0% 성적으로 표시하지 않습니다.</p>' : '') + binTable(a.overall) + '<p>구간은 하한 포함·상한 미포함이며 마지막 90~100% 구간만 100%를 포함합니다.</p></section>' +
  '<section class="site-panel"><h2>2. 홈승·무승부·원정승을 얼마나 예상했나</h2>' + outcomeTable(a.overall) + '<p>' + warning(a.overall.n) + ' · 결과 빈도와 1순위 적중률을 혼동하지 마세요.</p></section>' +
  '<section class="site-panel"><h2>3. 확률 출처를 나누어 보기</h2><p>서로 다른 입력을 한 모델의 능력으로 묶지 않습니다. model은 배당 혼합이 가능하고, market은 해외 배당, national은 국가대표 Elo입니다. none과 알 수 없는 출처는 제외합니다.</p>' + a.byBasis.map((g) => '<details><summary>' + e(basisNames[g.key]) + ' · ' + g.n + '경기 · ' + warning(g.n) + '</summary>' + binTable(g) + outcomeTable(g) + '</details>').join('') + '<h3>버전 기록의 한계</h3><p>현재 스냅샷 스키마에는 모델 버전이 기록돼 있지 않습니다. 따라서 버전별 분리나 변경 전후 효과 비교를 할 수 없습니다. 입력·설정이 바뀐 기록이 섞인 기간의 관측이며 현재 모델의 능력을 뜻하지 않습니다. 버전을 추정하거나 현재 코드로 소급해 붙이지 않습니다.</p></section>' +
  '<section class="site-panel"><h2>4. 리그별 관측 범위</h2><p>리그 간 우열 비교가 아닙니다. 경기 구성·확률 출처·시점이 달라 단순 비교할 수 없습니다. 30경기 미만은 범주별 비교표를 보류합니다.</p>' + (a.byLeague.map((g) => '<details><summary>' + e(g.key) + ' · ' + g.n + '경기 · ' + warning(g.n) + '</summary>' + (g.n >= AUDIT_SMALL_SAMPLE ? outcomeTable(g) : '<p>소표본: 결과별 비교를 보류합니다.</p>') + '</details>').join('') || '<p>포함된 리그 없음</p>') + '</section>' +
  '<section class="site-panel"><h2>5. 포함·제외와 재현 기준</h2><p>원천은 prediction_snapshots와 round_results입니다. /performance의 엄격 검증기를 사용해 유효한 저장 시각 &lt; 유효한 킥오프, 정상 확률·최고 확률 픽·출처, 확정 결과와 점수·정산 시각 정합성을 요구합니다. 추가로 round_predictions.computed_at이 없거나 잘못됐거나 킥오프 이후인 입력도 제외합니다. 이 추가 필터 때문에 /performance와 경기 수가 다를 수 있습니다.</p><p>중복은 리그·홈팀·원정팀의 앞뒤 공백을 뺀 표기와 정규화한 킥오프 시각이 같은 경우입니다. 유효 기록 중 가장 늦은 킥오프 전 저장본 하나를 선택하며 동시각이면 round_match_id가 큰 것을 남깁니다. 회차 ID만으로 경기 수를 늘리지 않습니다. 표기 차이·일정 변경은 같은 경기로 확정할 수 없어 자동 병합하지 못하는 한계가 있습니다.</p><ul><li>' + a.provenanceExcluded.unknown + '건 · 예측 입력 계산 시각 누락·비정상(출처 확인 불가)</li><li>' + a.provenanceExcluded.afterKickoff + '건 · 예측 입력 계산이 킥오프와 같거나 이후</li>' + exclusions + '</ul><p>한 행은 처음 걸린 제외 사유 하나만 셉니다. 조회 상한 ' + a.source.rowCeiling + '행, round_matches.id 최신 등록순. ' + (a.source.isTruncated ? '상한에 걸려 이전 등록 기록이 제외된 제한된 범위입니다. 전체 이력을 대표하지 않습니다.' : '이번 조회는 상한에 걸리지 않았습니다.') + '</p><p>검증된 고유 경기 ' + AUDIT_INDEX_MIN + '개 미만은 noindex로 운영합니다. 검색엔진 요구가 아니라 서비스 내부 편집 기준이며, 기준 도달은 통계적 검증이나 품질 보증이 아닙니다.</p><p>결과나 수익을 보장하지 않습니다. 구매는 만 19세 이상, 공식 판매처에서만 가능합니다. 도박 문제 상담 1336.</p></section>';
  return renderSitePage({ title: "70%라는 예측, 실제로 얼마나 맞았을까?", description: "킥오프 전 저장 예측과 실제 결과로 보는 확률 구간·결과별 편향과 표본 불확실성", path: "/insights/probability-audit", body, noindex: !probabilityAuditIndexable(a), event: "probability_audit_view" });
}
