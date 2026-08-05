-- K리그2 한정: 경기당 코너킥 수(홈/원정). 백테스트로 검증된 실질 개선 피처(2026-08-04).
-- 다른 리그는 검증 결과 무효/역효과라 이 컬럼을 채우지 않는다(NULL로 남김).
ALTER TABLE matches ADD COLUMN home_corners INTEGER;
ALTER TABLE matches ADD COLUMN away_corners INTEGER;

ALTER TABLE round_predictions ADD COLUMN corners_diff REAL;
