// Worker 라우트 공용 헬퍼 (JSON 응답, 관리자 토큰 검증)
import type { Env } from "../types";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function safeJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ADMIN_TOKEN 미설정 시 관리자 인증을 생략한다(로컬 개발/1인 운영 편의).
export function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) return null;
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);
  return null;
}
