# K리그 승무패 토토 예측 웹앱

FotMob 데이터 기반 Elo/최근폼/상대전적/리그별 무승부율 모델로 K리그1·K리그2 승무패 회차를 예측하고, 예산별 구매 조합과 Gemini 분석 리포트를 제공하는 Cloudflare Worker 앱.

## 로컬 개발

```bash
npm install
npm run typecheck
npm test
npm run db:migrate:local
npx wrangler d1 execute kleague-toto-db --local --file=seed/seed.sql
npm run dev
```

`seed/seed.sql`이 없다면 먼저 생성한다 (pandas/pyarrow 필요):

```bash
python seed/export_history_to_sql.py
```

## 배포 (사용자 Cloudflare 계정 필요)

1. `npx wrangler login` - 브라우저에서 Cloudflare 계정 로그인
2. `npx wrangler d1 create kleague-toto-db` 실행 후 출력된 `database_id`를 `wrangler.toml`의 `REPLACE_AFTER_WRANGLER_D1_CREATE`에 붙여넣기
3. `npx wrangler kv namespace create KV` 실행 후 출력된 `id`를 `wrangler.toml`의 `REPLACE_AFTER_WRANGLER_KV_CREATE`에 붙여넣기
4. `npm run db:migrate:remote`
5. `npx wrangler d1 execute kleague-toto-db --remote --file=seed/seed.sql`
6. 시크릿 설정 (선택 기능은 미설정 시 자동 비활성화됨):
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   npx wrangler secret put ADMIN_TOKEN
   ```
7. `npm run deploy`

## 텔레그램 봇 만들기

1. 텔레그램에서 `@BotFather` 채팅 시작 → `/newbot` → 봇 이름 지정 → 토큰 발급받음(`TELEGRAM_BOT_TOKEN`)
2. 만든 봇과 대화 시작(아무 메시지나 전송)
3. `https://api.telegram.org/bot<TOKEN>/getUpdates`를 브라우저로 열어 `chat.id` 값을 확인(`TELEGRAM_CHAT_ID`)

## 운영 관리자 API

`ADMIN_TOKEN` 시크릿을 설정하면 아래 엔드포인트는 `Authorization: Bearer <ADMIN_TOKEN>` 헤더가 필요하다. 미설정 시(로컬 개발) 인증 없이 열려있다.

- `POST /api/admin/sync` - FotMob 경기 결과 수동 갱신
- `POST /api/admin/detect-round` - 다음 14경기 회차 수동 감지/등록
- `PATCH /api/admin/rounds/:id` - `{"round_no": 42}`로 실제 공식 회차번호 수동 보정 (betman.co.kr에서 확인 필요)
- `POST /api/admin/notify-test` - 텔레그램 발송 테스트

## 독식 지향 픽

승무패는 파리뮤추얼이라 당첨금이 당첨자 수에 반비례한다. `src/lib/exclusivePick.ts`는 모델 1픽을 기준으로, 적중확률 손실이 작으면서 betman 투표가 덜 몰린 결과로만 제한적으로 뒤집어 "당첨 시 단독(독식) 가능성"을 높이는 픽을 만든다(당첨확률 자체를 높이는 게 아님 - UI/로그에 항상 병기).

- 웹앱: 베팅추천 탭 상단 "👑 독식 지향 픽" (이변 반영 경기 수 조절 가능)
- API: `POST /api/rounds/:id/exclusive-pick` (body: `{toggles?, options?}`)
- CLI: `npx tsx scripts/print_exclusive_pick.ts` (배포된 Worker 데이터 기준)
- GitHub Actions: `Generate Round & Exclusive Pick` 워크플로우(workflow_dispatch) - 회차 감지 → 배당 수집 → betman 투표율 수집 → 독식 픽 로그 출력을 한 번에 실행

## 알려진 제약

- betman.co.kr 공식 회차 확인은 세션 게이트가 있어 Worker에서 직접 스크래핑 불가. `detectNewRound` 크론은 FotMob 예정 경기로 "다음 14경기 묶음"을 추정만 하며, 실제 회차번호는 위 관리자 API로 수동 보정해야 한다.
- 통계 모델은 참고용이며 배당 마진 대비 실질적 우위를 보장하지 않는다.
