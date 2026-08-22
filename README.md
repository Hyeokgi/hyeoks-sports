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
- GitHub Actions: `Fetch Betman Vote Share` 워크플로우 수동 실행(task 선택) 또는 main 머지 후 `Generate Round & Exclusive Pick`(workflow_dispatch) - 회차 감지 → 배당 수집 → betman 투표율 수집 → 독식 픽 로그 출력을 한 번에 실행
  - `task=offline-pick`: Worker 배포/백필 전에도 러너에서 발매중 회차를 직접 분석해 독식픽을 로그로 출력 (`scripts/offline_round_pick.ts`)

## EPL/세리에A 편입 (46회차~)

46회차부터 EPL·세리에A 회차가 등장해 두 리그를 편입했다(MLS와 동일 절차 + 재현 가능 스크립트화). 웹앱에 46회차 이후 회차가 뜨려면 아래 순서로 반영해야 한다:

1. D1 백필 적용: `npx wrangler d1 execute kleague-toto-db --remote --file=seed/backfill_epl_seriea.sql`
   (백필 데이터 재생성은 `Fetch Betman Vote Share` 워크플로우 `task=backfill` - football-data.co.uk 3.5시즌 + FotMob 현재시즌 경기를 FotMob 팀명 기준으로 생성/커밋)
2. Worker 배포: `npm run deploy` (신규 리그 nameMap/캘리브레이션 포함)
3. 결과 동기화+회차 등록: `POST /api/admin/sync` → `POST /api/admin/detect-round` (또는 크론 대기, 또는 워크플로우 `task=pipeline`)
4. 이후 배당/투표율 크론이 평소처럼 채워진다

주의: EPL/세리에A는 교차연도 시즌(8월~5월)이라 Elo 시즌 회귀 경계를 7월로 처리한다(`elo.ts seasonOf`). xG/코너킥은 기존 게이팅에 따라 자동 미적용(기본모델만).

## 저장소 통합 (hyeoks-sports-engine)

`hyeoks-sports-engine`(Python/구글시트)에 있던 기능을 이 저장소로 옮기는 중이다. 엔진의 예측 역할은 이미 이 앱에 위임돼 있었고(`predict_engine.py`가 K리그 예측을 앱 API에서 가져다 씀), FotMob·football-data 크롤링도 중복이었다.

**이관 완료**
- 1~41회차 원본 데이터 → `seed/history_*.json` (엔진 레포에만 있어 앱 백테스트가 존재조차 몰랐던 자산)
- `build_round_analysis_sheet.py` → `scripts/export_sheets.py` (HYEOKS_회차분석 탭)
- `crawl_and_update.py`의 팀 DB / 선수 DB → `scripts/export_player_db.py`
  - 선수 통계는 D1이 아니라 구글시트에만 적재한다(앱에 선수 스키마가 없고 용도가 스카우팅/열람이라 시트가 적합). 앱 예측 모델은 이 데이터를 쓰지 않는다
  - 대상 리그에 MLS를 추가했다(엔진 시절엔 없었으나 45회차가 MLS 회차였고 앱에도 편입돼 있어서)
- 두 스크립트는 `scripts/sheets_common.py`(인증·시트 기록 공용)를 함께 쓰고, `Export Google Sheets` 워크플로우가 매일 04:00 KST에 둘 다 실행한다

**이관하지 않은 것** (의도적)
- `crawl_and_update.py`의 경기 단위 크롤링(`전체`/리그별/`HYEOKS_팀통계`/`HYEOKS_선수통계` 탭) — 이 앱의 `refreshHistory` 크론과 중복이라 옮기지 않았다
- `predict_engine.py` — RandomForest 기반 `HYEOKS_예측리포트` 시트. K리그는 이미 이 앱의 예측을 가져다 쓰고 있었고, EPL/세리에A/MLS/J1도 모두 이 앱에 편입돼 사실상 중복이다

**엔진 레포를 끄기 전 확인**
1. 이 저장소에 `GOOGLE_SERVICE_ACCOUNT_KEY` 시크릿 등록 (완료)
2. 엔진 레포의 `hyeoks_engine.yml`에서 `build_round_analysis_sheet.py`·`crawl_and_update.py` 실행을 제거 — 안 그러면 두 레포가 같은 시트를 이중으로 쓴다
3. `HYEOKS_예측리포트`가 더 이상 필요 없다고 판단되면 엔진 레포 아카이브

## 알려진 제약

- betman.co.kr 공식 회차 확인은 세션 게이트가 있어 Worker에서 직접 스크래핑 불가. `detectNewRound` 크론은 FotMob 예정 경기로 "다음 14경기 묶음"을 추정만 하며, 실제 회차번호는 위 관리자 API로 수동 보정해야 한다.
- 통계 모델은 참고용이며 배당 마진 대비 실질적 우위를 보장하지 않는다.
