# 경기 전 확률 변화 이력: 앞으로 수집

## 목적과 범위

‘경기가 다가오면서 확률은 어떻게 바뀌었을까’를 설명할 원자료를 배포 이후부터 모은다. 이번 변경은 저장만 추가하며 공개 페이지·API·라우팅·예측 수식·정산 기준은 바꾸지 않는다. 기존 `prediction_snapshots`는 계속 경기별 마지막 값이며 실제 기록의 유일한 기존 입력이다. 이력은 적중률 검증 자료로 자동 채택하지 않는다.

## 배포 순서

1. `migrations/0014_prediction_history.sql`을 D1에 적용한다.
2. Worker를 배포한다.
3. 다음 정상 `snapshotRound` 호출 이후 `prediction_history` 신규 행과 Worker 오류 로그를 확인한다.

과거 스냅샷 복사, 과거 시각으로의 재계산, UPDATE/DELETE, 백필은 하지 않는다. 첫 행은 최초 예측 시각이 아니라 **수집 도입 이후 첫 관측**이다. 테이블의 UPDATE/DELETE 트리거도 기존 행 변경을 거부한다.

## 캡처 필드

- `id`: 증가하는 내부 식별자.
- `round_match_id`, `round_id`: DB 경기와 회차 식별자.
- `p_home`, `p_draw`, `p_away`, `pick`, `basis`: 당시 서버 기본 설정 예측. model/market/national만 대상이다.
- `captured_at`: 예측 조립이 끝난 직후 실제 관측 시각(UTC ISO). 배당 공급자 갱신 시각이나 DB 커밋 시각은 아니다. 기존 테스트/호출자의 `now` 하한을 실제 관측 시각으로 가장하지 않는다.
- `kickoff_at`: INSERT 문장이 읽은 현재 DB 킥오프.
- `prediction_kickoff_at`: 예측 조립 당시 읽은 킥오프. 일정 변경을 확인하기 위해 둘 다 남긴다.
- `model_revision`: `history-instrumentation-v1`. 계측 도입 기준선이라는 명시적 식별자일 뿐, git 해시·과거 모델 버전·새로운 모델 검증 통과를 뜻하지 않는다. 예측 코드나 기본 설정을 바꿀 때 이 상수도 갱신해야 한다. 과거 행은 수정하지 않는다.
- `input_context`: schema 1, 리그(100자 제한), Elo·폼·H2H 격차/표본 수, 리그 무승부율, xG·코너·국가대표 Elo 격차, market-only 판정, 시장 암시확률/북메이커 수, 당시 적용한 서버 기본 토글/리그별 가중치. 허용 목록만 저장하고 비유한 숫자는 null로 기록한다. 4,096자 제한으로 임의 속성·개인정보·환경·인증정보를 넣지 않는다.

`buildRoundPredictions.raw`에는 원자료 계산 시각이나 배당 갱신 시각이 없으므로 그것을 만들어 저장하지 않는다. 시장 값은 원시 소수 배당 자체가 아니라 계산에 사용한 암시확률이다.

## 쓰기 규칙과 동시성

기존 `isSnapshotWritable` 판정을 그대로 공유한다. 킥오프 불명/파싱 실패, 사후 등록, 근거 없음, 비정상 확률/픽은 제외한다. 단일 INSERT SELECT 안에서 현재 DB 킥오프가 유효하고 `captured_at < kickoff_at`, `captured_at < prediction_kickoff_at`, `julianday('now') < kickoff_at`을 다시 검사한다.

최신 이력 한 행의 세 확률과 basis가 정확히 같으면 건너뛴다. 반올림이나 시간 버킷으로 변화를 버리지 않는다. 입력이나 revision만 바뀌고 확률/basis가 같으면 새 행이 없다. A→A는 한 행, A→B→A는 세 행이다. 픽만 바뀐 동률도 새 변화로 세지 않는다.

최신 행 비교와 INSERT는 같은 SQL 문장이므로 동시 실행에서도 분리된 조회/쓰기 경합을 피한다. 최신 기록보다 같거나 이전 관측 시각의 지연 요청은 버린다. `(round_match_id, captured_at)`은 유일하며 동일 밀리초 충돌은 먼저 받아들인 행을 보존한다. 따라서 모든 중간 변화나 연속 시간을 완전하게 추적한다고 주장하지 않는다. 실행 주기 사이의 변화, 장애 기간, 같은 밀리초 충돌은 수집되지 않는다.

## 기존 저장과 장애 격리

기존 스냅샷 batch가 먼저 성공해야 별도의 이력 batch를 실행한다. 기존 batch SQL·바인딩 순서·엄격한 판정·반환 건수는 유지한다. 반환 건수에 이력 삽입 수를 더하지 않는다. 기존 저장 실패는 이전처럼 호출자에게 전파한다.

이력 batch 실패(스키마 누락 포함)는 `console.error("prediction_history append failed; existing snapshots preserved", { roundId, error })`로 명시적으로 남긴다. 이미 성공한 기존 저장을 되돌리거나 반환을 실패로 바꾸지 않는다. 별도 상태 API나 자동 경보는 이번 범위 밖이다. 운영자는 이 로그를 감시해야 하며, 장애로 빠진 과거 이력을 복원하지 않는다.

## 해석상의 제한

두 관측의 **기록된 입력 차이**를 설명할 수는 있지만 인과 효과를 입증하지 않는다. ‘배당이 이만큼 바뀌어서 확률이 정확히 이만큼 변했다’ 같은 인과 귀속을 하지 않는다. Elo·폼 등 일부 성분은 회차 등록 시 고정돼 있을 수 있다. 서로 다른 revision의 변화 역시 검증된 개선이나 성능 향상을 뜻하지 않는다.

## 검증

`tests/predictionHistory.test.ts`는 SQL 가드/최신 비교 계약, bounded whitelist, 기존/이력 batch 순서와 반환값, 기존 엄격 판정, 누락 스키마 로그, 기존 실패 전파를 검사한다. 기존 테스트를 수정하거나 완화하지 않는다. 배포 전 기존 typecheck/test/build와 실제 D1 마이그레이션 적용 확인이 필요하다.
