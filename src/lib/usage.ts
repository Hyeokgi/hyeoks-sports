// 이용 측정: 일별 이벤트 수만 센다(usage_daily, migration 0010).
// 개인 식별 정보·쿠키·IP는 받지도 저장하지도 않는다. 목적은 두 가지뿐이다.
//   1) 블로그 글에서 앱·회차 페이지로 얼마나 넘어오는가(유입 경로)
//   2) 어떤 기능(조합·독식픽·AI분석 등)이 실제로 쓰이는가
// 스폰서 제안서와 화면 개편 우선순위의 근거로 쓴다.
import type { Env } from "../types";

// 받는 이벤트 이름을 고정한다. 아무 문자열이나 받으면 표가 쓰레기로 찬다.
export const USAGE_EVENTS = [
  "app_open",
  "round_view",
  "tab_matches",
  "tab_settings",
  "tab_ai",
  "tab_bets",
  "tab_calibration",
  "tab_info",
  "report_view",
  "round_page_view",
  "round_page_cta",
] as const;
export type UsageEvent = (typeof USAGE_EVENTS)[number];

/**
 * 유입 경로를 분류한다. utm_source가 있으면 그걸 쓰고(우리가 단 꼬리표: blog/round_page 등),
 * 없으면 리퍼러 도메인으로 나눈다. 분류는 서버 한 곳에서만 한다(페이지·앱은 원자료만 보낸다).
 */
export function classifySource(utm: string | null | undefined, referrer: string | null | undefined, ownHost: string): string {
  const u = (utm ?? "").toLowerCase().trim();
  if (/^[a-z0-9_]{1,24}$/.test(u)) return u;
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "direct";
  }
  if (host === ownHost) return "internal";
  if (host.includes("naver")) return "naver";
  if (host.includes("google")) return "google";
  if (host.includes("daum") || host.includes("kakao")) return "daum";
  if (host.includes("bing")) return "bing";
  if (host === "t.co" || host.includes("twitter") || host === "x.com") return "x";
  return "referral";
}

export function kstDay(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const BOT_RE = /bot|crawl|spider|slurp|preview|headless/i;

export interface UsageInput {
  e?: unknown;
  r?: unknown;
  u?: unknown;
  ref?: unknown;
}

/** 이벤트 한 건을 센다. 형식이 틀리거나 봇이면 조용히 무시한다(측정이 서비스를 막으면 안 됨). */
export async function recordUsage(env: Env, input: UsageInput, request: Request, now = Date.now()): Promise<boolean> {
  if (BOT_RE.test(request.headers.get("user-agent") ?? "")) return false;
  const e = typeof input.e === "string" ? input.e : "";
  if (!(USAGE_EVENTS as readonly string[]).includes(e)) return false;
  const r = Number(input.r);
  const roundNo = Number.isInteger(r) && r > 0 && r < 100000 ? r : 0;
  const source = classifySource(
    typeof input.u === "string" ? input.u : null,
    typeof input.ref === "string" ? input.ref : null,
    new URL(request.url).hostname,
  );
  await env.DB.prepare(
    `INSERT INTO usage_daily (day, event, source, round_no, count) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(day, event, source, round_no) DO UPDATE SET count = count + 1`,
  )
    .bind(kstDay(now), e, source, roundNo)
    .run();
  return true;
}

export interface UsageRow {
  day: string;
  event: string;
  source: string;
  round_no: number;
  count: number;
}

export async function usageSince(env: Env, days: number, now = Date.now()): Promise<UsageRow[]> {
  const from = kstDay(now - Math.max(1, Math.min(days, 180)) * 86400000);
  const { results } = await env.DB.prepare(
    "SELECT day, event, source, round_no, count FROM usage_daily WHERE day > ? ORDER BY day DESC, count DESC",
  )
    .bind(from)
    .all<UsageRow>();
  return results ?? [];
}
