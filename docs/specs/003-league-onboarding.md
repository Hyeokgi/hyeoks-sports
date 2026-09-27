# 003. 새 리그 자동 추가

> 작성: 2026-09-27, 사용자 요청. 초안 작성 Aside, 구현 Claude.
> 사용자 결정: **새 리그가 인식되면 앱·경기 페이지·블로그에 올리기 전에 데이터 생성부터 끝낸다.** 텔레그램 알림은 지금은 쓰지 않는다.

## 1. 목적

프로토 승부식이나 승무패 회차에 우리가 모르는 리그가 나오면, 사람이 손대지 않아도 그 리그의 과거 데이터를 만들고 검증한 뒤 서비스에 올린다.
예: 49회차 승무패의 잉글랜드 챔피언십(당시 배당만으로 계산).

## 2. 감지

- **프로토 승부식:** 하루 1회 GitHub Actions(Playwright, betman 세션 게이트 때문). 발매 중 회차의 `gameInfoInq.do` 응답에서 `itemCode = SC` 행의 `leagueName` 목록을 읽는다.
  - 2026-09 실측(15개 회차 표본): 지원 리그 외에 잉글랜드 챔피언십 45경기, J2 31, 에레디비시 28, 노르웨이 엘리테세리엔 25, 리그1 19 등이 나왔다.
- **승무패 회차:** `createRound`가 이미 "모델 미지원 대회"를 찾는다. 이때 즉시 온보딩 작업을 시작한다.
- 이미 등록됐거나 `excluded`인 리그는 건너뛴다.

## 3. 분류

| 종류 | 예 | 처리 |
|---|---|---|
| 국가대표 | 네이션스리그, A매치 친선, 아세안컵 | 국가대표 Elo가 이미 전 세계를 다룬다. 등록만 한다 |
| 단일 리그(클럽) | 챔피언십, J2, 에레디비시, 리그1 | 4~6장 절차로 데이터 생성·검증 |
| 리그끼리 대회 | UCL, UEL, 리베르타도레스, AFC, 각국 FA컵 | 리그별 Elo로 비교할 수 없다. `market` 전용으로 등록. FA컵은 두 팀이 모두 등록 리그 소속일 때만 모델 |
| 제외 | 여자·연령별·클럽 친선·슈퍼컵 | `excluded` |

분류는 이름 규칙(“FA컵”, “챔피언스”, “친선”, “여자”, “U-”) + FotMob 리그 정보(국가 코드, 컵/리그 구분)로 한다. 애매하면 `needs_review`로 멈춘다(추측으로 등록하지 않는다).

## 4. 데이터 생성 (단일 리그)

1. **FotMob 리그 찾기:** 한국어 리그명 → FotMob 리그 ID. 먼저 `seed/league_registry.json`의 수동 표를 보고, 없으면 FotMob 전체 리그 목록에서 국가+이름으로 찾는다. 후보가 정확히 1개일 때만 진행하고, 아니면 `needs_mapping`.
2. **과거 결과:** 최근 3시즌 경기 결과를 FotMob에서 받는다(가능하면 football-data.co.uk로 교차 확인). 팀명은 FotMob 표기로 통일하고 한글명 표(`nameMap`)를 자동 생성한다.
3. **모델 입력:** Elo(기본 계수 K·HOME_ADV=60·시즌 회귀), 최근 5경기 흐름, 맞대결, 리그 무승부율, 확신 구간별 적중률 표(calibration).
4. **적재:** `backfill_leagues.sql`과 같은 방식으로 D1에 넣는다(배치).

## 5. 검증

- 저장소 규칙대로 **시간순 4분할**(학습 0.5/0.6/0.7/0.8)로 평가한다.
- 통과 기준: 4분할 모두에서 (a) 적중률이 "항상 홈승"보다 높고, (b) 로그손실이 리그 기본 분포(홈·무·원정 비율)보다 낮을 것.
- 통과 → `active_model`. 실패 → `market_only`(배당이 있을 때만 표시).
- 계수 튜닝(예: 라리가 HOME_ADV=105)은 자동으로 하지 않는다. 기본 계수로 통과 여부만 본다. 튜닝은 사람이 검토해 별도 PR로 한다.

## 6. 공개 순서 (사용자 결정)

- **데이터 생성과 검증이 끝나기 전에는** 이 리그 경기를 경기 페이지·웹앱·블로그에 새로 올리지 않는다.
- 상태가 `active_model` 또는 `market_only`가 된 뒤에 경기 페이지(002)를 만든다.
- **승무패 회차에 포함된 경우:** 회차 글은 14경기가 모두 필요하다. 회차 감지 시 온보딩을 바로 시작하고, 블로그 첫 발행은 온보딩이 끝날 때까지 기다린다. 발매 마감 12시간 전까지도 끝나지 않으면 그 경기만 `market`(배당 기반)으로 표시해 발행한다(발행 누락 방지).
  - 블로그 루틴의 `hpost.plan()`은 `/api/rounds`의 새 필드 `onboarding_pending`(true면 대기)을 본다.

## 7. 상태 저장

D1 테이블 `leagues`:
`id, betman_name, kind(national|club|cross|excluded), fotmob_id, slug, status(detected|backfilling|validating|active_model|market_only|needs_mapping|needs_review|excluded), metrics_json(4분할 결과), created_at, updated_at`

## 8. 알림

- 텔레그램은 쓰지 않는다(2026-09-27 사용자 결정. 현재 GitHub 비밀값에 텔레그램 값도 없다).
- 온보딩 결과는 **GitHub Issue**로 남긴다(라벨 `league-onboarding`): 리그명, 분류, FotMob ID, 적재 경기 수, 4분할 결과, 최종 상태. `needs_mapping`·`needs_review`도 이슈로 남겨 사람이 보게 한다.
- 관리자 API `GET /api/admin/leagues`로 상태를 조회한다.

## 9. 코드 위치(제안)

- `scripts/detect_leagues.ts`(감지), `scripts/onboard_league.ts`(생성·검증), 워크플로 `task=onboard-league`
- `src/lib/leagueRegistry.ts`(리그 표·분류), `seed/league_registry.json`(수동 매핑)
- `createRound`에서 미지원 대회 발견 시 `repository_dispatch`로 온보딩 워크플로 호출(`GH_DISPATCH_TOKEN` 사용)

## 10. 테스트

- 분류 규칙(컵·여자·연령별), FotMob 후보가 여러 개면 `needs_mapping`, 검증 실패 시 `market_only`, 온보딩 전에는 경기 페이지가 404, `onboarding_pending`이면 블로그 plan이 대기.
