// 첫 화면에 띄울 회차를 고른다.
//
// 예전엔 가장 최근 등록 회차(id DESC 첫 번째)를 띄웠다. betman은 여러 회차를 동시에
// 발매하므로, 56회차가 곧 마감인데 대진만 먼저 나온 57회차가 첫 화면에 떴다(2026-09-26).
// 사용자가 지금 사야 하는 건 '마감이 가장 임박한 발매중 회차'다.
//
// 발매 마감은 회차 첫 경기 직전이므로 첫 킥오프를 마감 시각으로 본다.
//   1) 첫 킥오프가 아직 안 지난 진행중 회차 중 가장 이른 것 (= 지금 살 수 있고 마감이 제일 가까움)
//   2) 없으면 경기가 진행 중인 회차(마지막 킥오프 + 여유시간 전) 중 가장 최근에 시작한 것
//   3) 그것도 없으면 가장 최근 회차(종전 동작)
export interface RoundForPick {
  id: number;
  status: string;
  first_kickoff_at?: string | null;
  last_kickoff_at?: string | null;
}

const IN_PLAY_BUFFER_MS = 3 * 60 * 60 * 1000;

export function pickDefaultRound<T extends RoundForPick>(rounds: T[], now: number = Date.now()): T | null {
  if (rounds.length === 0) return null;
  const t = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

  const onSale = rounds
    .filter((r) => r.status === "upcoming" && t(r.first_kickoff_at) > now)
    .sort((a, b) => t(a.first_kickoff_at) - t(b.first_kickoff_at));
  if (onSale.length > 0) return onSale[0];

  const inPlay = rounds
    .filter((r) => r.status === "upcoming" && t(r.last_kickoff_at) + IN_PLAY_BUFFER_MS > now)
    .sort((a, b) => t(b.first_kickoff_at) - t(a.first_kickoff_at));
  if (inPlay.length > 0) return inPlay[0];

  return rounds[0];
}

/** 드롭다운 라벨에 붙일 상태. 회차가 여러 개 열려 있을 때 어느 게 발매중인지 보이게 한다. */
export function roundPhase(r: RoundForPick, now: number = Date.now()): "발매중" | "경기중" | "종료" | null {
  if (r.status === "settled") return "종료";
  const first = r.first_kickoff_at ? Date.parse(r.first_kickoff_at) : NaN;
  const last = r.last_kickoff_at ? Date.parse(r.last_kickoff_at) : NaN;
  if (r.status === "upcoming" && first > now) return "발매중";
  if (r.status === "upcoming" && last + IN_PLAY_BUFFER_MS > now) return "경기중";
  return null;
}
