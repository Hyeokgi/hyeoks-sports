// 첫 화면에 띄울 회차를 고르고, 회차 목록에 붙일 상태(발매예정·발매중 등)를 정한다.
//
// 예전엔 가장 최근 등록 회차(id DESC 첫 번째)를 띄웠다. betman은 여러 회차를 동시에
// 발매하므로, 56회차가 곧 마감인데 대진만 먼저 나온 57회차가 첫 화면에 떴다(2026-09-26).
// 사용자가 지금 사야 하는 건 '마감이 가장 임박한 발매중 회차'다.
//
// 상태는 betman 발매기간(sale_start_at ~ sale_end_at) 기준이다(2026-10-02 사용자 요청).
// 예전엔 '마감 전이면 발매중'이라 대진만 나온 58·59회차까지 발매중으로 보였다.
// 발매 시작 시각을 아직 모르는 회차는 발매중이라고 단정하지 않고 발매예정으로 둔다.
//
// 마감 시각은 betman 발매기간 끝(sale_end_at)을 쓴다. 첫 경기와 다르다(56회차: 마감 9/28 23:00,
// 첫 경기 9/29 01:00 KST). 아직 수집 전인 회차만 예전처럼 첫 킥오프를 마감으로 본다.
//   1) 지금 발매 중인 회차(시작 ≤ 지금 < 마감) 중 마감이 가장 이른 것
//   2) 없으면 아직 마감 전인 회차 중 마감이 가장 이른 것(곧 발매될 회차)
//   3) 없으면 경기가 진행 중인 회차(마지막 킥오프 + 여유시간 전) 중 가장 최근에 시작한 것
//   4) 그것도 없으면 가장 최근 회차(종전 동작)
export interface RoundForPick {
  id: number;
  status: string;
  first_kickoff_at?: string | null;
  last_kickoff_at?: string | null;
  sale_start_at?: string | null;
  sale_end_at?: string | null;
}

export type RoundPhase = "발매예정" | "발매중" | "발매마감" | "경기중" | "결과 집계 중" | "종료";

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** 발매 마감 시각(ms). betman 발매기간이 있으면 그것, 없으면 첫 킥오프. */
export function saleDeadline(r: RoundForPick): number {
  return ms(r.sale_end_at ?? r.first_kickoff_at);
}

/** 지금 betman에서 살 수 있는가: 발매 시작 시각을 알고, 시작 ≤ 지금 < 마감. */
export function isOnSale(r: RoundForPick, now: number = Date.now()): boolean {
  const start = ms(r.sale_start_at);
  return r.status === "upcoming" && Number.isFinite(start) && start <= now && saleDeadline(r) > now;
}

const IN_PLAY_BUFFER_MS = 3 * 60 * 60 * 1000;

export function pickDefaultRound<T extends RoundForPick>(rounds: T[], now: number = Date.now()): T | null {
  if (rounds.length === 0) return null;
  const byDeadline = (a: T, b: T) => saleDeadline(a) - saleDeadline(b);

  const onSale = rounds.filter((r) => isOnSale(r, now)).sort(byDeadline);
  if (onSale.length > 0) return onSale[0];

  const soon = rounds.filter((r) => r.status === "upcoming" && saleDeadline(r) > now).sort(byDeadline);
  if (soon.length > 0) return soon[0];

  const inPlay = rounds
    .filter((r) => r.status === "upcoming" && ms(r.last_kickoff_at) + IN_PLAY_BUFFER_MS > now)
    .sort((a, b) => ms(b.first_kickoff_at) - ms(a.first_kickoff_at));
  if (inPlay.length > 0) return inPlay[0];

  return rounds[0];
}

/** 회차 상태. betman 발매기간 기준. */
export function roundPhase(r: RoundForPick, now: number = Date.now()): RoundPhase | null {
  if (r.status === "settled") return "종료";
  if (r.status !== "upcoming") return null;
  if (saleDeadline(r) > now) return isOnSale(r, now) ? "발매중" : "발매예정";
  const first = ms(r.first_kickoff_at);
  if (Number.isFinite(first) && first > now) return "발매마감";
  const last = ms(r.last_kickoff_at);
  if (Number.isFinite(last) && last + IN_PLAY_BUFFER_MS > now) return "경기중";
  return "결과 집계 중";
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** KST 기준 '10/4(일) 08:00'. */
export function kstShort(iso: string): string {
  const k = new Date(Date.parse(iso) + 9 * 3600e3);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${DOW[k.getUTCDay()]}) ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}

/** 회차 선택창·상태 칩에 붙일 짧은 설명. 예: '10/4(일) 08:00 발매', '~10/2(금) 23:00 마감'. */
export function phaseDetail(r: RoundForPick, now: number = Date.now()): string {
  const phase = roundPhase(r, now);
  if (phase === "발매예정") return r.sale_start_at ? `${kstShort(r.sale_start_at)} 발매` : "발매일 확인 중";
  if (phase === "발매중") return r.sale_end_at ? `~${kstShort(r.sale_end_at)} 마감` : "";
  if (phase === "발매마감") return r.first_kickoff_at ? `${kstShort(r.first_kickoff_at)} 첫 경기` : "";
  return "";
}
