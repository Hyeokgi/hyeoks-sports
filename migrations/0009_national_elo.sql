-- 국가대표 Elo(src/lib/nationalElo.ts). 네이션스리그·월드컵 예선 등 국가대표 회차는 클럽 Elo가
-- 성립하지 않아 배당만 기다렸고, 배당이 올라오기 전엔 36/27/36(근거없음)이었다.
-- A매치 전체 결과(martj42/international_results)로 레이팅을 만들어 여기에 둔다.
CREATE TABLE national_elo (
  team_en TEXT PRIMARY KEY,
  elo REAL NOT NULL,
  n_matches INTEGER NOT NULL,
  last_match_date TEXT,
  updated_at TEXT NOT NULL
);

-- 경기별 국가대표 Elo 격차(홈-원정, 홈어드밴티지 제외). 킥오프 전까지만 갱신하고 그 뒤로는
-- 고정한다 - 경기 뒤에 결과가 반영된 레이팅으로 바뀌면 사후 예측이 되기 때문이다.
-- NULL이면 국가대표 경기가 아니거나 팀 매핑/표본이 부족한 경기.
ALTER TABLE round_predictions ADD COLUMN nat_elo_diff REAL;
