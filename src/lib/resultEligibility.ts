// 결과 경계 검증. 날짜만 있는 기록은 UTC 일 단위이며 실제 종료 시각을 증명하지 않는다.
export function parseResultScore(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function parseResultDate(value: unknown): { ms: number; day: string; granularity: "day" | "timestamp" } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > days[mo - 1]) return null;
  if (m[4] != null) {
    if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return null;
    if (m[8] !== "Z") {
      const [h, min] = m[8].slice(1).split(":").map(Number);
      if (h > 14 || min > 59 || (h === 14 && min !== 0)) return null;
    }
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return { ms, day: new Date(ms).toISOString().slice(0, 10), granularity: m[4] == null ? "day" : "timestamp" };
}

export function resultUtcCutoff(nowMs: number): { iso: string; day: string } {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) throw new RangeError("유효한 UTC 기준 시각이 필요합니다");
  const iso = new Date(nowMs).toISOString();
  if (!parseResultDate(iso)) throw new RangeError("지원하지 않는 UTC 기준 시각입니다");
  return { iso, day: iso.slice(0, 10) };
}

export function isEligibleResultDate(value: unknown, nowMs = Date.now()): boolean {
  const cutoff = resultUtcCutoff(nowMs);
  const date = parseResultDate(value);
  return date != null && (date.granularity === "day" ? date.day <= cutoff.day : date.ms <= nowMs);
}

export function isEligibleResult(row: { date: unknown; hg: unknown; ag: unknown }, nowMs = Date.now()): boolean {
  resultUtcCutoff(nowMs);
  return parseResultScore(row.hg) != null && parseResultScore(row.ag) != null && isEligibleResultDate(row.date, nowMs);
}

/** 원본을 지우지 않는 읽기 격리. 해제는 원천 대조 후 별도 코드 검토로만 한다. */
export const RESULT_QUARANTINE = [{ id: 964046, league: "라리가", date: "2026-12-09", home: "Rayo Vallecano", away: "Athletic Club", hg: 0, ag: 0, observedAt: "2026-11-16T14:26:05.537Z", reason: "기준 시각보다 미래인 0:0 저장 결과. 직접 유입원·올바른 날짜·종료 상태 확인 전 읽기 격리" }] as const;
export interface StoredResultCandidate { league?: unknown; date: unknown; home?: unknown; away?: unknown; hg: unknown; ag: unknown }
export function isQuarantinedResult(row: StoredResultCandidate): boolean {
  return RESULT_QUARANTINE.some(q => row.league === q.league && row.date === q.date && row.home === q.home && row.away === q.away && parseResultScore(row.hg) === q.hg && parseResultScore(row.ag) === q.ag);
}
export function isQuarantinedStoredElo(row: { league?: string; team: string; lastMatchDate: string | null }): boolean {
  return RESULT_QUARANTINE.some(q => row.league === q.league && row.lastMatchDate === q.date && (row.team === q.home || row.team === q.away));
}
export function isEligibleStoredResult(row: StoredResultCandidate, nowMs = Date.now()): boolean {
  return isEligibleResult(row, nowMs) && !isQuarantinedResult(row);
}
