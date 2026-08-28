// 6시간마다 실행: wisetoto.com에서 betman 공식 회차번호+정확한 경기목록을 그대로 가져와 등록.
// (과거엔 FotMob 예정 경기 캘린더로 "다음 14경기"를 추정했으나, 리그가 섞인 회차를 인식하지 못해
// wisetoto 직접 스크래핑으로 교체 - 로그인 없이 확정 회차번호+정확한 경기목록을 그대로 제공한다.)
import { discoverRoundMasterSeq, fetchRoundFixtures } from "../lib/wisetoto";
import { createRoundFromFixtures, type RoundFixture } from "../lib/createRound";
import { NAME_MAP, leagueOfKr, isModelLeague } from "../lib/nameMap";
import { sendTelegramMessage } from "../lib/telegram";
import type { Env } from "../types";

export async function detectNewRound(env: Env): Promise<{ created: boolean; roundId?: number; reason?: string }> {
  const maxRow = await env.DB.prepare(
    "SELECT MAX(round_no) as max_round_no FROM rounds WHERE round_no IS NOT NULL",
  ).first<{ max_round_no: number | null }>();
  const roundNo = (maxRow?.max_round_no ?? 0) + 1;
  const gameYear = String(new Date().getUTCFullYear());

  const masterSeq = await discoverRoundMasterSeq(gameYear, String(roundNo));
  if (!masterSeq) return { created: false, reason: "round_not_yet_open" };

  const wtFixtures = await fetchRoundFixtures(gameYear, String(roundNo), masterSeq);
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
