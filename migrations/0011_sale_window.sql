-- betman 발매기간(시작·마감, UTC ISO). 마감은 첫 경기 시각이 아니다.
-- 56회차 실측: 발매 9/27(일) 08:00 ~ 9/28(월) 23:00 KST, 첫 경기 9/29(화) 01:00 KST.
-- 첫 경기를 마감으로 보면 2시간 늦게 잡혀 "마감 1시간 전" 수집이 마감 뒤에 돈다.
-- scripts/fetch_vote_share.mjs가 구매투표지에서 읽어 /api/admin/rounds/:id/sale-window로 저장하고,
-- src/cron/deadlineTrigger.ts(마감 12·6·3·1시간 전 수집), src/lib/roundPick.ts, data.json(saleEndAt)이 쓴다.
ALTER TABLE rounds ADD COLUMN sale_start_at TEXT;
ALTER TABLE rounds ADD COLUMN sale_end_at TEXT;
