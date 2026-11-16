import { isEligibleResult, parseResultDate, parseResultScore, resultUtcCutoff } from "./resultEligibility";
// CLI를 실행하지 않고도 백필 결과 파싱을 검증한다.
export function parseFdDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4}|\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + m[2] + "-" + m[1];
  return parseResultDate(date)?.day ?? null;
}

export function parseFdResult(row: { date: unknown; home: unknown; away: unknown; hg: unknown; ag: unknown }, now = Date.now()) {
  resultUtcCutoff(now);
  const date = parseFdDate(row.date);
  const hg = parseResultScore(row.hg), ag = parseResultScore(row.ag);
  const home = typeof row.home === "string" ? row.home.trim() : "";
  const away = typeof row.away === "string" ? row.away.trim() : "";
  if (!date || hg == null || ag == null || !home || !away || home === away || !isEligibleResult({ date, hg, ag }, now)) return null;
  return { date, home, away, hg, ag };
}

// 따옴표 필드까지 처리하는 최소 CSV 파서 (football-data는 대부분 단순하지만 방어적으로)
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

