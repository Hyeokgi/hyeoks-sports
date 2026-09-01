// 야구 예측의 결과 타입. 축구(홈승/무승부/원정승)와 구조가 다르므로 재사용하지 않는다.
//
// 가장 중요한 차이: 승1패의 "1"은 무승부가 아니라 점수차 구간이다. 홈이 1점차로 이겨도
// 원정이 1점차로 이겨도 똑같이 "1"이다. 축구의 무승부는 '누구도 이기지 않음'이지만
// 여기서는 '누가 이겼든 1점차'다. 이걸 무승부처럼 다루면 조합 로직이 통째로 틀어진다.

export type BaseballLeague = "KBO" | "MLB";

/** 승패 2택 - 프로토 승부식 '야구 승패'(betId 2)에 해당 */
export type WinLoseOutcome = "승" | "패";

/** 승1패 3택 - 야구토토 승1패(G024), 프로토 '야구 승1패'(betId 108)에 해당 */
export type Seung1PaeOutcome = "승" | "1" | "패";

/**
 * 스코어에서 승1패 결과를 낸다.
 *
 * KBO는 연장 뒤 무승부가 있다(실측 2,736경기 중 58건, 2.12%). 그 경우 점수차가 0이라
 * 승(홈 2점차+)도 1(1점차)도 패(원정 2점차+)도 아니다. 토토가 무승부를 어떻게 정산하는지는
 * 베트맨 규정을 확인하기 전까지 모르므로 추측해서 어느 구간에 넣지 않고 null로 돌려준다.
 * 호출부가 "정산 불가"로 다루게 해서, 잘못된 구간에 넣고 조용히 틀리는 일을 막는다.
 * (MLB는 무승부가 0건이라 이 문제가 없다.)
 */
export function seung1PaeOf(homeScore: number, awayScore: number): Seung1PaeOutcome | null {
  const d = homeScore - awayScore;
  if (d === 0) return null;
  if (Math.abs(d) === 1) return "1";
  return d > 0 ? "승" : "패";
}

/** 승패 2택 결과. 무승부는 마찬가지로 판정 불가다. */
export function winLoseOf(homeScore: number, awayScore: number): WinLoseOutcome | null {
  if (homeScore === awayScore) return null;
  return homeScore > awayScore ? "승" : "패";
}
