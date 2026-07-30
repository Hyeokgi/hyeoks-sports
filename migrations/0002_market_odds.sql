-- 해외 북메이커 배당(오버라운드 제거된 암시확률) - GitHub Actions에서 주기적으로 채워 넣는다
CREATE TABLE market_odds (
  round_match_id INTEGER PRIMARY KEY REFERENCES round_matches(id),
  p_home REAL NOT NULL,
  p_draw REAL NOT NULL,
  p_away REAL NOT NULL,
  n_bookmakers INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
