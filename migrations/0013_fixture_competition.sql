-- 경기별 분석 페이지: 국가대표 경기(league = '국가대표')의 대회명(UEFA 네이션스리그 A, A매치 친선 등).
-- 클럽 리그 경기는 NULL(리그 = 대회).
ALTER TABLE fixtures ADD COLUMN competition TEXT;
