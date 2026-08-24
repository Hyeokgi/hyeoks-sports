// 6시간마다 실행: wisetoto.com에서 betman 공식 회차번호+정확한 경기목록을 그대로 가져와 등록.
// (과거엔 FotMob 예정 경기 캘린더로 "다음 14경기"를 추정했으나, 리그가 섞인 회차를 인식하지 못해
// wisetoto 직접 스크래핑으로 교체 - 로그인 없이 확정 회차번호+정확한 경기목록을 그대로 제공한다.)
import { discoverRoundMasterSeq, fetchRoundFixtures } from "../lib/wisetoto";
import { createRoundFromFixtures, type RoundFixture } from "../lib/createRound";
import { NAME_MAP, leagueOfKr, isModelLeague } from "../lib/nameMap";
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

    // 우리가 백테스트한 리그인데 팀 매핑이 없다면 그건 승격/신규팀 누락이다 - 조용히 넘기면
    // 그 경기만 근거 없는 예측이 되므로 회차 전체를 보류하고 알린다(기존 동작 유지).
    // 반면 애초에 모델이 없는 대회(UCL/UEL 등)는 매핑이 없는 게 정상이고, 배당 기반으로 처리한다.
    if (isModelLeague(league)) {
      if (!homeEn) missing.push(wt.homeKr);
      if (!awayEn) missing.push(wt.awayKr);
      if (!homeEn || !awayEn) continue;
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

  if (missing.length > 0) {
    console.error(`detectNewRound: NAME_MAP에 없는 팀 발견, ${roundNo}회차 등록 보류: ${missing.join(", ")}`);
    return { created: false, reason: `missing_teams:${missing.join(",")}` };
  }
  if (marketOnlyCount > 0) {
    console.log(`detectNewRound: ${roundNo}회차 중 ${marketOnlyCount}경기가 모델 미지원 대회 - 배당 기반으로 등록`);
  }

  const { roundId } = await createRoundFromFixtures(env, fixtures, { roundNo, roundNoConfirmed: true });
  return { created: true, roundId };
}
