-- 1) 경기 시작 전 마지막 예측을 보존한다.
-- 예측은 조회할 때마다 현재 코드로 다시 계산된다(round_predictions 성분 + 최신 배당). 그래서
-- 나중에 모델 가중치를 바꾸면 이미 끝난 회차의 "우리가 냈던 픽"까지 소급해서 바뀐다. 실제 기록은
-- 그때 공개했던 값이어야 하므로, 킥오프 전까지 주기적으로 덮어쓰고 킥오프 이후엔 건드리지 않는다.
CREATE TABLE prediction_snapshots (
  round_match_id INTEGER PRIMARY KEY REFERENCES round_matches(id),
  p_home REAL NOT NULL,
  p_draw REAL NOT NULL,
  p_away REAL NOT NULL,
  pick TEXT NOT NULL,
  basis TEXT NOT NULL,
  confidence_gap REAL NOT NULL,
  tier TEXT,
  n_bookmakers INTEGER,
  captured_at TEXT NOT NULL
);

-- 2) 이용 측정(일별 집계만). 개인 식별 정보·쿠키·IP는 저장하지 않는다.
-- 블로그에서 얼마나 넘어오는지, 어떤 기능을 쓰는지를 스폰서·운영 판단의 근거로 쓴다.
CREATE TABLE usage_daily (
  day TEXT NOT NULL,          -- KST 날짜 YYYY-MM-DD
  event TEXT NOT NULL,
  source TEXT NOT NULL,       -- utm_source 또는 유입 경로 분류(naver/google/direct 등)
  round_no INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, source, round_no)
);
