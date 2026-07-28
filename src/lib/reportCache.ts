// AI 리포트 KV 캐시 키/TTL 공용 정의 (report.ts GET, admin.ts POST 양쪽에서 사용)
export const REPORT_CACHE_TTL_SECONDS = 60 * 60 * 6;

export function reportCacheKey(roundId: number): string {
  return `report:${roundId}`;
}
