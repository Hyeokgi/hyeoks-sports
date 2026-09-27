-- 경기별 분석 페이지(docs/specs/002-match-pages.md) 1단계.
-- 회차(round_matches)와 별개로, 지원 리그의 앞으로 7일 경기를 FotMob 경기 번호 기준으로 모은다.
CREATE TABLE fixtures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league TEXT NOT NULL,
  fotmob_id INTEGER NOT NULL UNIQUE,
  kickoff_at TEXT NOT NULL,          -- UTC ISO
  home_en TEXT NOT NULL,             -- FotMob 표기(matches·team_elo와 같은 키)
  away_en TEXT NOT NULL,
  home_kr TEXT,                      -- nameMap 역참조. 없으면 NULL(화면에서 영문명 사용)
  away_kr TEXT,
  slug TEXT NOT NULL UNIQUE,         -- /match/{slug}. 처음 만든 뒤 바꾸지 않는다(주소 고정)
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | finished | cancelled
  hg INTEGER,
  ag INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_fixtures_kickoff ON fixtures(kickoff_at);
CREATE INDEX idx_fixtures_league_kickoff ON fixtures(league, kickoff_at);

-- 경기 예측. 성분과 함께 확률까지 저장하고, 킥오프가 지나면 다시 쓰지 않는다.
-- 회차의 prediction_snapshots와 같은 목적(그때 공개한 값을 기록으로 남김)을 한 표로 해결한다.
CREATE TABLE fixture_predictions (
  fixture_id INTEGER PRIMARY KEY REFERENCES fixtures(id),
  elo_diff REAL NOT NULL,
  form_diff REAL NOT NULL,
  h2h_diff REAL NOT NULL,
  n_h2h INTEGER NOT NULL,
  league_draw_rate REAL NOT NULL,
  xg_diff REAL,
  corners_diff REAL,
  p_home REAL NOT NULL,
  p_draw REAL NOT NULL,
  p_away REAL NOT NULL,
  pick TEXT NOT NULL,
  basis TEXT NOT NULL,
  confidence_gap REAL NOT NULL,
  tier TEXT,
  computed_at TEXT NOT NULL
);
