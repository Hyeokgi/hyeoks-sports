import { describe, it, expect } from "vitest";
import { USAGE_EVENTS } from "../src/lib/usage";

describe("앱 영역 전환 측정", () => {
  it("matchesView가 보내는 이벤트가 모두 허용 목록에 있다", () => {
    for (const e of ["mode_match", "mode_round", "match_card_click", "round_to_match", "match_view", "league_view", "hub_view"]) {
      expect(USAGE_EVENTS as readonly string[]).toContain(e);
    }
  });
});
