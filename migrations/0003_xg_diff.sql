-- 팀 시즌 xG(기대득점) 기반 공수 격차. K리그2는 FotMob에 xG 자체가 없어 NULL로 남는다.
ALTER TABLE round_predictions ADD COLUMN xg_diff REAL;
