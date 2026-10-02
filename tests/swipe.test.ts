import { describe, it, expect } from "vitest";
import { swipeDirection, stepIndex } from "../src/lib/swipe";

describe("swipeDirection", () => {
  it("왼쪽으로 밀면 다음 탭, 오른쪽으로 밀면 이전 탭", () => {
    expect(swipeDirection(-120, 10, 300)).toBe("next");
    expect(swipeDirection(120, -8, 300)).toBe("prev");
  });
  it("짧은 이동·세로 스크롤·느린 드래그는 무시한다", () => {
    expect(swipeDirection(-40, 0, 200)).toBeNull();
    expect(swipeDirection(-90, 80, 300)).toBeNull();
    expect(swipeDirection(-150, 10, 1200)).toBeNull();
  });
});

describe("stepIndex", () => {
  it("한 칸씩 이동하고 처음·끝에서 멈춘다", () => {
    expect(stepIndex(0, 6, "next")).toBe(1);
    expect(stepIndex(5, 6, "next")).toBe(5);
    expect(stepIndex(0, 4, "prev")).toBe(0);
    expect(stepIndex(2, 4, "prev")).toBe(1);
    expect(stepIndex(2, 4, null)).toBe(2);
  });
});
