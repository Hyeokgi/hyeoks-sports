-- 앞으로 관측한 확률 변화만 보존한다. 기존 prediction_snapshots를 복사하지 않는다.
CREATE TABLE prediction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_match_id INTEGER NOT NULL REFERENCES round_matches(id),
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  p_home REAL NOT NULL CHECK (p_home BETWEEN 0 AND 1),
  p_draw REAL NOT NULL CHECK (p_draw BETWEEN 0 AND 1),
  p_away REAL NOT NULL CHECK (p_away BETWEEN 0 AND 1),
  pick TEXT NOT NULL CHECK (pick IN ('홈승', '무승부', '원정승')),
  basis TEXT NOT NULL CHECK (basis IN ('model', 'market', 'national')),
  captured_at TEXT NOT NULL,
  kickoff_at TEXT NOT NULL,
  prediction_kickoff_at TEXT NOT NULL,
  model_revision TEXT NOT NULL,
  input_context TEXT NOT NULL CHECK (json_valid(input_context) AND length(input_context) <= 4096),
  UNIQUE (round_match_id, captured_at),
  CHECK (abs(p_home + p_draw + p_away - 1) <= 0.0001),
  CHECK (julianday(captured_at) IS NOT NULL AND julianday(kickoff_at) IS NOT NULL
    AND julianday(prediction_kickoff_at) IS NOT NULL
    AND julianday(captured_at) < julianday(kickoff_at)
    AND julianday(captured_at) < julianday(prediction_kickoff_at))
);

-- 실수로 기존 스냅샷처럼 덮어쓰거나 과거 행을 정리하지 못하게 한다.
CREATE TRIGGER prediction_history_no_update BEFORE UPDATE ON prediction_history
BEGIN SELECT RAISE(ABORT, 'prediction_history is append-only'); END;
CREATE TRIGGER prediction_history_no_delete BEFORE DELETE ON prediction_history
BEGIN SELECT RAISE(ABORT, 'prediction_history is append-only'); END;
