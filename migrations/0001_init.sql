-- 팀명(한글/FotMob 영문) 매핑 테이블
CREATE TABLE team_name_map (
  name_kr TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  league TEXT NOT NULL CHECK (league IN ('K리그1', 'K리그2'))
);
CREATE INDEX idx_team_name_map_en ON team_name_map (name_en, league);

-- 경기 이력 (Elo/폼/H2H 계산용 원본 데이터)
CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league TEXT NOT NULL,
  date TEXT NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  hg INTEGER NOT NULL,
  ag INTEGER NOT NULL,
  UNIQUE (league, date, home, away)
);
CREATE INDEX idx_matches_league_date ON matches (league, date);
CREATE INDEX idx_matches_home ON matches (league, home, date);
CREATE INDEX idx_matches_away ON matches (league, away, date);

-- 팀별 현재 Elo 레이팅 (증분 업데이트 캐시)
CREATE TABLE team_elo (
  league TEXT NOT NULL,
  team_en TEXT NOT NULL,
  elo REAL NOT NULL DEFAULT 1500,
  last_season INTEGER NOT NULL,
  last_match_date TEXT,
  PRIMARY KEY (league, team_en)
);

-- 리그별 실측 무승부율 (주기 재계산, 하드코딩 금지)
CREATE TABLE league_draw_rates (
  league TEXT PRIMARY KEY,
  draw_rate REAL NOT NULL,
  sample_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- 회차 (승무패 14경기 묶음)
CREATE TABLE rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_no INTEGER,
  round_no_confirmed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'closed', 'settled')),
  created_at TEXT NOT NULL,
  notified_at TEXT
);

-- 회차별 경기 (14경기)
CREATE TABLE round_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  seq INTEGER NOT NULL,
  league TEXT NOT NULL,
  home_kr TEXT NOT NULL,
  away_kr TEXT NOT NULL,
  kickoff_at TEXT,
  UNIQUE (round_id, seq)
);

-- 회차별 경기 예측 원본 성분 (토글 재계산은 이 값들로 순수 연산, 재조회 불필요)
CREATE TABLE round_predictions (
  round_match_id INTEGER PRIMARY KEY REFERENCES round_matches(id),
  elo_diff REAL NOT NULL,
  form_diff REAL NOT NULL,
  h2h_diff REAL NOT NULL,
  n_h2h INTEGER NOT NULL,
  league_draw_rate REAL NOT NULL,
  computed_at TEXT NOT NULL
);
