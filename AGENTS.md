# 에이전트 작업 안내

이 저장소를 처음 다루면 **`docs/HANDOFF.md`를 먼저 읽는다.** 구조, 데이터 소스, 모델, 채택 기준, 최근 사고와 결정이 모두 정리돼 있다.

## 반드시 지킬 것

- 커밋 전에 `npm run typecheck && npm test && npm run build:client`를 통과시킨다.
- 모델 계수나 가중치는 **시간순 4분할 검증**(4분할 모두 적중률·로그손실이 나빠지지 않을 것)을 통과해야만 바꾼다. 테스트를 끄거나 건너뛰지 않는다.
- 확률의 출처(`prediction.basis`: model / market / national / none)를 화면·리포트·글에서 항상 구분한다. 적중이나 수익을 약속하는 표현을 쓰지 않는다. 공개 글에는 고지 문구(`DISCLAIMER`)를 붙인다.
- D1 쓰기는 `env.DB.batch`로 묶는다. 워커 호출당 D1 요청 한도가 1,000회다.
- 서버 API에 예측 입력 필드를 추가하면 `public/app.ts`의 `loadRound()` 매핑에도 추가한다. 클라이언트가 예측을 다시 계산하기 때문이다.
- 정기 GitHub Actions는 **main 코드로 돈다.** 스크립트 수정은 main 병합까지 해야 반영된다.
- `src/lib/gemini.ts`와 `scripts/generate_report.mjs`의 `buildPrompt`는 동일하게 유지한다. `tests/reportPromptSync.test.ts`가 이를 확인한다.
- 외부 CDN을 핫링크하지 않는다. 엠블럼·국기·폰트는 `public/`에 자체 호스팅한다.
- 주석과 커밋 메시지는 한국어로 쓰고, "왜"를 남긴다.
