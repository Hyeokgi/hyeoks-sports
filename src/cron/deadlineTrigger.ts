// 베팅 마감 12·6·3·1시간 전에 배당·투표율 수집 파이프라인을 즉시 돌린다.
//
// 왜 워커 크론인가: 투표율 수집(fetch_vote_share.yml, cron "0 */4 * * *")의 실제 예약 실행은
// GitHub 스케줄 지연으로 3~7시간 간격이었다(2026-09-23~26 실측, 일부 회차 시각은 아예 빠짐).
// 블로그 글을 마감 12·6·3·1시간 전에 고치는데 투표율이 몇 시간 전 값이면 의미가 없다.
// 워커 크론은 제시간에 돌므로, 체크포인트 직전에 GitHub API로 pipeline 태스크를 호출한다.
//
// 토큰(GH_DISPATCH_TOKEN)이 없으면 아무것도 하지 않는다. 기존 4시간 수집은 그대로 유지된다.
import { listRounds } from "../lib/db";
import { sendTelegramMessage } from "../lib/telegram";
import type { Env, RoundRow } from "../types";

export const CHECKPOINT_HOURS = [12, 6, 3, 1] as const;
// 체크포인트 25분 전부터 직전까지를 호출 창으로 본다. 파이프라인이 Playwright 설치를 포함해
// 5~10분 걸리고, 워커 크론이 10분 간격이라 창이 10분보다 넓어야 한 번은 걸린다.
export const LEAD_MS = 25 * 60 * 1000;
const KEY_TTL_SECONDS = 3 * 24 * 60 * 60;
const DEFAULT_REPO = "Hyeokgi/hyeoks-sports";
const WORKFLOW_FILE = "fetch_vote_share.yml";

export interface DueCheckpoint {
  roundId: number;
  roundNo: number | null;
  hours: number;
  checkpointAt: string;
}

export type RoundForTrigger = Pick<RoundRow, "id" | "round_no" | "status"> & { sale_end_at?: string | null };

/** 지금 호출 창에 들어온 (회차, 체크포인트) 목록. 마감을 모르는 회차는 추측하지 않고 뺀다. */
export function dueCheckpoints(rounds: RoundForTrigger[], now: number): DueCheckpoint[] {
  const out: DueCheckpoint[] = [];
  for (const r of rounds) {
    if (r.status !== "upcoming" || !r.sale_end_at) continue;
    const end = Date.parse(r.sale_end_at);
    if (!Number.isFinite(end) || end <= now) continue;
    for (const h of CHECKPOINT_HOURS) {
      const cp = end - h * 60 * 60 * 1000;
      if (now >= cp - LEAD_MS && now < cp) {
        out.push({ roundId: r.id, roundNo: r.round_no, hours: h, checkpointAt: new Date(cp).toISOString() });
      }
    }
  }
  return out;
}

export const doneKey = (d: DueCheckpoint): string => `deadline_trigger:${d.roundId}:${d.hours}`;
const failKey = (d: DueCheckpoint): string => `deadline_trigger_fail:${d.roundId}:${d.hours}`;

export interface DeadlineTriggerResult {
  due: number;
  dispatched: boolean;
  reason?: "none_due" | "already_done" | "no_token" | "dispatch_failed";
}

export async function runDeadlineTrigger(
  env: Env,
  now: number = Date.now(),
  loadRounds: (env: Env) => Promise<RoundForTrigger[]> = listRounds,
): Promise<DeadlineTriggerResult> {
  const due = dueCheckpoints(await loadRounds(env), now);
  if (due.length === 0) return { due: 0, dispatched: false, reason: "none_due" };

  const fresh: DueCheckpoint[] = [];
  for (const d of due) if (!(await env.KV.get(doneKey(d)))) fresh.push(d);
  if (fresh.length === 0) return { due: due.length, dispatched: false, reason: "already_done" };

  if (!env.GH_DISPATCH_TOKEN) {
    console.log("GH_DISPATCH_TOKEN이 없어 마감 기준 수집 호출을 건너뜁니다.");
    return { due: due.length, dispatched: false, reason: "no_token" };
  }

  // pipeline 태스크는 진행중 회차 전부를 수집하므로 체크포인트가 여러 개 겹쳐도 한 번만 부른다.
  const ok = await dispatchPipeline(env);
  if (ok) {
    await Promise.all(
      fresh.map((d) => env.KV.put(doneKey(d), new Date(now).toISOString(), { expirationTtl: KEY_TTL_SECONDS })),
    );
    return { due: due.length, dispatched: true };
  }

  // 실패는 다음 크론(10분 뒤)에 창 안이면 다시 시도된다. 알림은 체크포인트당 한 번만 보낸다.
  const unnotified: DueCheckpoint[] = [];
  for (const d of fresh) if (!(await env.KV.get(failKey(d)))) unnotified.push(d);
  if (unnotified.length > 0) {
    const lines = unnotified.map((d) => `· ${d.roundNo ?? "?"}회차 마감 ${d.hours}시간 전`).join("\n");
    await sendTelegramMessage(
      env,
      `⚠️ <b>마감 기준 투표율 수집 호출 실패</b>\n${lines}\nGH_DISPATCH_TOKEN 권한(Actions: Read and write)을 확인하세요.`,
    );
    await Promise.all(unnotified.map((d) => env.KV.put(failKey(d), "1", { expirationTtl: KEY_TTL_SECONDS })));
  }
  return { due: due.length, dispatched: false, reason: "dispatch_failed" };
}

async function dispatchPipeline(env: Env): Promise<boolean> {
  const repo = env.GH_REPO || DEFAULT_REPO;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "hyeoks-deadline-trigger",
        "content-type": "application/json",
      },
      // 정기 수집과 같은 코드(main)로 돌린다.
      body: JSON.stringify({ ref: "main", inputs: { task: "pipeline" } }),
    });
    if (res.status === 204) return true;
    console.error(`workflow dispatch 실패: ${res.status} ${await res.text()}`);
    return false;
  } catch (e) {
    console.error(`workflow dispatch 예외: ${(e as Error).message}`);
    return false;
  }
}
