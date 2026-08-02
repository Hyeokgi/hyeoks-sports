-- 회차별 정산(실제결과) + 투표율 스냅샷 - 회차별 투표율/시스템예측치/실제결과 비교 기능용
CREATE TABLE round_results (
  round_match_id INTEGER PRIMARY KEY REFERENCES round_matches(id),
  actual TEXT NOT NULL CHECK (actual IN ('H', 'D', 'A')),
  hg INTEGER,
  ag INTEGER,
  settled_at TEXT NOT NULL
);

-- betman 투표율(득표율) 스냅샷. 회차 진행 중 여러 번 기록될 수 있어 시점(snapshot_at)별로 남긴다.
CREATE TABLE round_vote_share (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_match_id INTEGER NOT NULL REFERENCES round_matches(id),
  vote_home REAL NOT NULL,
  vote_draw REAL NOT NULL,
  vote_away REAL NOT NULL,
  snapshot_at TEXT NOT NULL
);
CREATE INDEX idx_round_vote_share_match ON round_vote_share (round_match_id, snapshot_at);
