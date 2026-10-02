// 좌우 스와이프 화면 연결(터치 이벤트). 판정 규칙은 src/lib/swipe.ts.
import { swipeDirection } from "../src/lib/swipe";

/** 이 요소(또는 조상)가 가로 스크롤 영역이거나 입력 요소면 스와이프로 보지 않는다. */
function startsInIgnored(target: EventTarget | null, root: Element): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el.matches("input, select, textarea, [contenteditable], [data-no-swipe]")) return true;
    if (el.scrollWidth > el.clientWidth + 4) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** root 위에서 좌우 스와이프를 감지해 onSwipe를 부른다. enabled()가 false면 무시. */
export function attachSwipe(root: Element, onSwipe: (dir: "next" | "prev") => void, enabled: () => boolean = () => true): void {
  let x0 = 0, y0 = 0, t0 = 0, active = false;
  root.addEventListener(
    "touchstart",
    (e) => {
      const ev = e as TouchEvent;
      if (!enabled() || ev.touches.length !== 1 || startsInIgnored(ev.target, root)) { active = false; return; }
      x0 = ev.touches[0].clientX;
      y0 = ev.touches[0].clientY;
      t0 = Date.now();
      active = true;
    },
    { passive: true },
  );
  root.addEventListener(
    "touchend",
    (e) => {
      if (!active) return;
      active = false;
      const t = (e as TouchEvent).changedTouches[0];
      const dir = swipeDirection(t.clientX - x0, t.clientY - y0, Date.now() - t0);
      if (dir) onSwipe(dir);
    },
    { passive: true },
  );
}

/** 탭이 바뀐 방향으로 짧게 미끄러지는 효과. */
export function slideIn(el: Element | null, dir: "next" | "prev"): void {
  if (!el) return;
  el.classList.remove("swipe-in-next", "swipe-in-prev");
  void (el as HTMLElement).offsetWidth;
  el.classList.add(dir === "next" ? "swipe-in-next" : "swipe-in-prev");
}
