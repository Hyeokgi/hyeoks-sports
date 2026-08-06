-- 배당 라인무브먼트 추적용: market_odds는 "최신값만" 덮어쓰지만 이 테이블은 매 수집(2시간마다)마다
-- append해서 오프닝->클로징 배당 변화 추이를 남긴다. 지금 당장 예측 모델에 반영하지 않고
-- 데이터만 축적한다(표본이 쌓일 때까지는 백테스트가 불가능하므로 - 이전 세션 논의 결론과 동일 원칙).
CREATE TABLE market_odds_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_match_id INTEGER NOT NULL REFERENCES round_matches(id),
  p_home REAL NOT NULL,
  p_draw REAL NOT NULL,
  p_away REAL NOT NULL,
  n_bookmakers INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL
);

CREATE INDEX idx_market_odds_history_match ON market_odds_history (round_match_id, snapshot_at);
