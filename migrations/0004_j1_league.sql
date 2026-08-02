-- team_name_map의 리그 체크에 J1리그 추가 (SQLite는 CHECK를 직접 ALTER할 수 없어 테이블 재생성)
CREATE TABLE team_name_map_new (
  name_kr TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  league TEXT NOT NULL CHECK (league IN ('K리그1', 'K리그2', 'J1리그'))
);
INSERT INTO team_name_map_new SELECT * FROM team_name_map;
DROP TABLE team_name_map;
ALTER TABLE team_name_map_new RENAME TO team_name_map;
CREATE INDEX idx_team_name_map_en ON team_name_map (name_en, league);
