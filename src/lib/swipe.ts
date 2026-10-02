// 좌우 스와이프 판정(순수 함수). 화면 이벤트 연결은 public/swipe.ts.
// 좌우 스와이프로 탭을 넘긴다(2026-10-02 사용자 요청).
// 승무패 회차: 경기 → 변수 → AI분석 → 조합분석 → 신뢰도 → 정보
// 경기 분석: 오늘 → 내일 → 7일 → 지난 결과
//
// 세로 스크롤을 방해하지 않도록, 가로로 충분히(64px 이상) 그리고 세로보다 확실히(1.6배) 움직였을 때만
// 탭을 넘긴다. 가로 스크롤 영역(리그 칩·표)이나 입력창에서 시작한 동작은 무시한다.

export type SwipeDir = "next" | "prev" | null;

/** 손가락 이동량(dx·dy, px)과 걸린 시간(ms)으로 스와이프 방향을 판정한다. 왼쪽으로 밀면 다음 탭. */
export function swipeDirection(dx: number, dy: number, dt: number): SwipeDir {
  if (dt > 800) return null;
  if (Math.abs(dx) < 64) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.6) return null;
  return dx < 0 ? "next" : "prev";
}

/** 목록에서 한 칸 이동. 처음·끝에서는 멈춘다(돌아가지 않음). */
export function stepIndex(current: number, length: number, dir: SwipeDir): number {
  if (!dir || length <= 0) return current;
  const next = current + (dir === "next" ? 1 : -1);
  return Math.max(0, Math.min(length - 1, next));
}

