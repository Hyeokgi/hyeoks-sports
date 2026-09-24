// 6시간마다 실행: wisetoto.com에서 betman 공식 회차번호+정확한 경기목록을 그대로 가져와 등록.
// (과거엔 FotMob 예정 경기 캘린더로 "다음 14경기"를 추정했으나, 리그가 섞인 회차를 인식하지 못해
// wisetoto 직접 스크래핑으로 교체 - 로그인 없이 확정 회차번호+정확한 경기목록을 그대로 제공한다.)
import { discoverRoundMasterSeq, fetchRoundFixtures } from "../lib/wisetoto";
import { createRoundFromFixtures, type RoundFixture } from "../lib/createRound";
import { NAME_MAP, leagueOfKr, isModelLeague } from "../lib/nameMap";
import { sendTelegramMessage } from "../lib/telegram";
import type { Env } from "../types";

// 한 번 실행에 따라잡을 최대 회차 수. 밀린 걸 메우되 wisetoto를 과하게 두드리지 않는 선.
const MAX_CATCHUP = 4;

/**
 * 발매된 회차를 찾아 등록한다. 밀려 있으면 여러 회차를 따라잡는다.
 *
 * 종전에는 MAX(round_no)+1 한 회차만 시도하고 실패하면 그대로 끝냈다. 그 결과 53회차가
 * 경기목록 403으로 실패한 뒤 54~56회차는 시도조차 되지 않아, 앱이 52회차에 4주 넘게
 * 멈춰 있었다(2026-09-24 확인). 한 회차의 일시적 실패가 파이프라인을 영구히 세우는 구조였다.
 *
 * 이제는 '아직 발매 전'일 때만 멈춘다. 그건 위쪽에 회차가 없다는 뜻이라 더 볼 이유가 없다.
 * 그 외 실패(403, 빈 응답 등)는 건너뛰고 다음 회차를 계속 시도한다 - 최신 회차를 보여주는
 * 게 마감이 있는 서비스에서 더 중요하다. 건너뛴 회차는 조용히 두지 않고 텔레그램으로 알린다.
 */
export async function detectNewRound(
  env: Env,
): Promise<{ created: boolean; roundId?: number; reason?: string; createdRounds?: number[] }> {
  const maxRow = await env.DB.prepare(
    "SELECT MAX(round_no) as max_round_no FROM rounds WHERE round_no IS NOT NULL",
  ).first<{ max_round_no: number | null }>();
  const base = maxRow?.max_round_no ?? 0;
  const gameYear = String(new Date().getUTCFullYear());

  const createdRounds: number[] = [];
  const skipped: Array<{ roundNo: number; reason: string }> = [];
  let lastRoundId: number | undefined;
  let lastReason: string | undefined;

  for (let i = 1; i <= MAX_CATCHUP; i++) {
    const roundNo = base + i;
    const r = await registerRound(env, roundNo, gameYear);
    if (r.created) {
      createdRounds.push(roundNo);
      lastRoundId = r.roundId;
      if (r.reason) lastReason = r.reason;
      continue;
    }
    lastReason = r.reason;
    if (r.reason === "round_not_yet_open") break; // 위쪽에 회차가 없다 - 정상 종료
    skipped.push({ roundNo, reason: r.reason ?? "unknown" });
  }

  if (skipped.length > 0) {
    console.error(`detectNewRound: 건너뛴 회차 ${skipped.map((s) => `${s.roundNo}(${s.reason})`).join(", ")}`);
    await sendTelegramMessage(
      env,
      `⚠️ <b>등록에 실패한 회차가 있습니다</b>\n\n` +
        `${skipped.map((s) => `· ${s.roundNo}회차 — ${s.reason}`).join("\n")}\n\n` +
        `이후 회차는 계속 등록했습니다(빠진 회차는 비어 있습니다). ` +
        `같은 사유가 반복되면 wisetoto 응답이 바뀐 것이므로 확인이 필요합니다.`,
    );
  }

  if (createdRounds.length === 0) return { created: false, reason: lastReason ?? "unknown" };
  return {
    created: true,
    roundId: lastRoundId,
    createdRounds,
    ...(lastReason && lastReason !== "round_not_yet_open" ? { reason: lastReason } : {}),
  };
}

async function registerRound(
  env: Env,
  roundNo: number,
  gameYear: string,
): Promise<{ created: boolean; roundId?: number; reason?: string }> {
  const masterSeq = await discoverRoundMasterSeq(gameYear, String(roundNo));
  if (!masterSeq) return { created: false, reason: "round_not_yet_open" };

  // fetchRoundFixtures는 HTTP 실패 시 throw한다. 여기서 잡지 않으면 예외가 루프를 뚫고
  // 올라가 나머지 회차가 다시 시도되지 않는다 - 그게 이번 403 사고의 전파 경로였다.
  let wtFixtures;
  try {
    wtFixtures = await fetchRoundFixtures(gameYear, String(roundNo), masterSeq);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`detectNewRound: ${roundNo}회차 경기목록 요청 실패 - ${msg}`);
    return { created: false, reason: `fetch_failed:${msg.slice(0, 120)}` };
  }
  if (wtFixtures.length === 0) {
    console.error(`detectNewRound: wisetoto ${roundNo}회차 경기목록을 가져오지 못해 스킵`);
    return { created: false, reason: "empty_fetch" };
  }

  const fixtures: RoundFixture[] = [];
  const missing: string[] = [];
  let marketOnlyCount = 0;
  for (const wt of wtFixtures) {
    // 리그는 wisetoto가 알려준 원문을 우선한다. NAME_MAP에 있는 팀이면 우리가 태깅한 리그를 쓴다.
    const league = leagueOfKr(wt.homeKr, wt.league);
    const homeEn = NAME_MAP[wt.homeKr] ?? null;
    const awayEn = NAME_MAP[wt.awayKr] ?? null;

    // 모델 지원 리그인데 팀 매핑이 없으면 그 경기만 배당 기반으로 떨어뜨린다.
    //
    // 예전엔 회차 전체 등록을 보류했다. 근거 없는 예측을 내보내지 않으려는 의도였지만,
    // 실제로 벌어진 일은 48회차가 통째로 앱에서 사라진 것이었다 - 14경기 중 12경기는
    // 멀쩡한데 팀명 표기 하나(인테르/AC몬차) 때문에 사용자가 아무것도 못 봤고, 워커 로그에만
    // 남아 며칠 뒤에야 발견됐다. 마감이 있는 서비스에서 이건 안전한 실패가 아니다.
    //
    // 지금은 배당 기반 경로가 있어서 더 나은 선택지가 있다. 그 경기를 배당으로 예측하고
    // 화면에 "배당 기반"이라고 명시하면 근거 없는 예측이 아니고, 조용하지도 않다.
    // 대신 아래에서 텔레그램으로 알려 매핑을 제대로 고치게 한다(다음 회차부터 Elo 복구).
    if (isModelLeague(league)) {
      if (!homeEn) missing.push(wt.homeKr);
      if (!awayEn) missing.push(wt.awayKr);
      if (!homeEn || !awayEn) marketOnlyCount++;
    } else {
      marketOnlyCount++;
    }

    fixtures.push({
      seq: wt.seq,
      league,
      homeKr: wt.homeKr,
      awayKr: wt.awayKr,
      homeEn,
      awayEn,
      kickoffAt: wt.kickoffAt,
    });
  }

  if (marketOnlyCount > 0) {
    console.log(`detectNewRound: ${roundNo}회차 중 ${marketOnlyCount}경기를 배당 기반으로 등록`);
  }

  // 지원 리그인데 매핑이 빠진 건 우리 데이터 문제다. 회차는 정상 등록하되 조용히 넘기지
  // 않는다 - 이걸 고쳐야 해당 팀의 Elo/폼/H2H가 다음 회차부터 다시 붙는다.
  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length > 0) {
    console.error(
      `detectNewRound: NAME_MAP에 없는 팀 ${uniqueMissing.join(", ")} - 해당 경기는 배당 기반으로 등록됨`,
    );
    await sendTelegramMessage(
      env,
      `⚠️ <b>${roundNo}회차: 팀명 매핑 누락</b>\n\n` +
        `${uniqueMissing.map((t) => `· ${t}`).join("\n")}\n\n` +
        `이 팀이 낀 경기는 Elo·최근폼·상대전적 없이 <b>배당 기반</b>으로 등록했습니다. ` +
        `회차는 정상 노출됩니다.\n\n` +
        `src/lib/nameMap.ts의 TEAM_ENTRIES에 위 한글 표기를 추가하면 다음 회차부터 모델 예측이 복구됩니다. ` +
        `(wisetoto 표기가 우리가 넣어둔 표기와 다른 경우가 대부분입니다)`,
    );
  }

  const { roundId } = await createRoundFromFixtures(env, fixtures, { roundNo, roundNoConfirmed: true });
  return {
    created: true,
    roundId,
    ...(uniqueMissing.length > 0 ? { reason: `missing_teams:${uniqueMissing.join(",")}` } : {}),
  };
}
