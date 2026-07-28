// 텔레그램 봇 알림 (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정 시 조용히 무시)
import type { Env } from "../types";

export async function sendTelegramMessage(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
    }),
  });
  if (!res.ok) {
    console.error(`telegram sendMessage 실패: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}
