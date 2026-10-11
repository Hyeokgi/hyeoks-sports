# 004. HYEOKS 공개 데이터 홈과 검증 가능한 분석 개편

상태: 구현 전달 명세. 코드 변경·배포·정책 승인·외부 자료 사실 검증은 이 문서 작성에 포함하지 않는다.
담당: Codex 설계, Claude 구현·검증. 기준: 저장소 AGENTS.md, HANDOFF.md, COLLAB.md 및 현재 소스.

## 1. 목표와 범위

홈을 단순 앱 진입점에서 **자료를 읽고, 근거를 확인하고, 결과와 비교할 수 있는 SSR 축구 데이터 서비스**로 바꾼다. 기존 승무패·예산 조합 도구는 `/app`에 보존하고 명확히 설명한다. 도구를 감추거나 축구 정보로 위장하는 프로젝트가 아니다.

- 저가치 콘텐츠 문제를 해결할 방향은 실제 데이터의 맥락, 출처, 시점, 한계, 검증 가능한 기록이다. 글 수·최소 글자 수·AI 기사 대량 추가를 목표로 삼지 않는다.
- AdSense 승인이나 수익을 보장하지 않는다. 도박 관련 기능의 정책 적용은 실제 기능·국가·Google의 현행 정책에 따라 사람 검토가 필요하다. 스포츠/배당 언급을 일괄 금지하지도, 명칭 변경으로 정책을 회피하지도 않는다.
- 모델 계수, 구매 한도, 자동화 루틴은 이 명세로 변경하지 않는다. 계수 변경에는 기존 시간순 4분할 검증 기준이 그대로 적용된다.
- 홈의 주 사용자는 오늘/이번 주 경기의 확률과 불확실성을 알고 싶은 독자다. 회차 사용자에게는 항상 명시적인 도구 링크를 제공한다.

## 2. 확인한 현재 상태와 해결할 결함

읽은 구현: `public/index.html`, `app.ts`, `matchesView.ts`, `style.css`, `public/guide/*`, `src/index.ts`, `src/routes/matchPage.ts`, `src/lib/matchPage.ts`, `settlementStats.ts`, `usage.ts`, 관련 migrations, `wrangler.toml`.

1. 현재 `/`는 경기 목록·설정·AI 리포트·조합·신뢰도 탭을 JS로 채우는 앱이다. HTML 자체에는 오늘의 실제 경기 데이터가 없다. `/matches`, `/league/:slug`, `/match/:slug`, `/round/:no` SSR 자산은 이미 있으므로 이를 중심으로 연결한다.
2. `wrangler.toml`의 assets-first 설정 때문에 정적 `/index.html`이 Worker 홈 라우트를 우회할 수 있다. 라우트 코드만 추가하면 개편이 적용되지 않을 수 있다.
3. 홈 및 가이드 HTML에 `adsbygoogle.js`가 현재 직접 삽입돼 있다. 개편의 P0는 이를 기본 비활성화하는 것이다. `ads.txt`는 별도 소유권 파일이며 유지 가능하다.
4. `loadHubView`는 fixture 예측을 그대로 보여주지만 상세/앱은 회차 예측으로 덮어쓸 수 있다. 상세의 분석 근거 또한 fixture 성분에서 생성하므로 표시 확률과 설명이 다른 원천이 될 위험이 있다. 한 선택 함수로 확률·basis·시점·설명을 함께 결정해야 한다.
5. 정산 안내의 ‘실제로 낸 픽’과 예전 데이터의 재계산 대체 규칙이 충돌할 수 있다. 기존 `/api/settlement` 집계를 신규 ‘사전 기록’ KPI에 그대로 재사용하지 않는다.
6. 가이드 5개는 이미 문단·표·날짜를 갖고 있다. 다만 일부 출처는 클릭 불가능한 이름 나열이며 ‘HYEOKS 데이터팀’ 표기가 실제 운영 인력 증빙 없이 전문 팀을 암시한다. Elo 가이드의 ‘기대 승률’은 무승부 반 점을 포함하는 **기대 점수**와 3-way 승리 확률을 구별하도록 교정한다. MLS 홈 이점 등 글/인수인계 숫자 차이는 실제 모델 코드와 대조한 뒤 수정한다.
7. 소스 감사만 수행했다. 이 문서는 현재 운영 DB 수치, 브라우저 실측 성능, 가이드의 최신 규정 사실을 확인했다는 주장이 아니다.

## 3. 정보 구조와 URL 계약 [P0]

### 공개 경로

- `/`: 데이터 홈, SSR, canonical `/`.
- `/matches`: 전체 경기 탐색, 기존 SSR 허브 보강. 홈과 달리 날짜·리그별 전체 탐색 역할.
- `/league/:slug`, `/match/:slug`, `/round/:no`: 기존 주소 유지. 정상 기존 slug를 재작성하지 않는다.
- `/app`: 기존 앱과 조합 도구. 제목 ‘승무패 분석 도구 | HYEOKS’, canonical `/app`. 기본 도구는 그대로 사용 가능하며 JS가 없을 때 `/matches`, `/round/:no`로 안내한다.
- `/methodology`: 확률 계산과 한계.
- `/performance`: 사전 저장 기록과 별도 백테스트.
- `/sources`: 출처·수집주기·자료 범위·데이터 주의사항.
- `/editorial`: 작성·자동화·검수·정정 원칙.
- `/contact`: 실제 연락처 `hyeoks.data@gmail.com`, 오류 신고 형식. `/about`, `/privacy`는 유지.
- `/guide/` 및 기존 5개 가이드 URL 유지. 제목만 짧게 다듬어도 URL은 보존.

### 이전 링크 호환

- GET/HEAD `/?round=56&utm_source=blog_top&utm_campaign=r56` → **302** `/app?round=56&utm_source=blog_top&utm_campaign=r56`. 이전 링크를 장기 지원하며 안정화 후 301 전환은 별도 결정.
- GET/HEAD `/?view=matches&...` → 302 `/app?view=matches&...`. `round`와 `view=matches`가 함께 있으면 기존 클라이언트 우선순위인 matches를 유지한다.
- root에 `round` 또는 `view` 키가 존재하면 전체 query string을 같은 origin의 `/app`에 보존한다. 잘못된 값은 앱에서 ‘선택한 회차/보기를 찾을 수 없습니다’와 기본 회차 선택을 제공한다. 임의 외부 redirect URL을 받지 않는다.
- UTM만 있는 `/?utm_source=blog`는 새 홈이다. 파라미터 없는 옛 앱 북마크는 홈에서 ‘승무패 도구’로 이동한다. 기존 localStorage `hs_mode`는 `/app` 내부에만 적용하고 홈을 강제 전환하지 않는다.
- hash는 서버에 전달되지 않는다. URL fragment 기본 유지 동작을 브라우저로 확인하고, 과거 앱 hash가 발견되면 최소 클라이언트 호환 처리로 `/app`에 전달한다. 확인되지 않은 hash 의미를 새로 만들지 않는다.
- `/app/`는 `/app`로 정규화. `/index.html`은 새 홈으로 정규화하되 legacy query는 위 규칙을 먼저 적용한다.
- `/api/*`, `/round/:no/data.json`, `/match/:slug/data.json`의 경로·기존 필드·CORS·인증은 그대로 유지한다. round number와 내부 round id를 혼동하지 않는다.
- `roundArticle`의 `appUrl`, SSR CTA, 가이드의 ‘웹앱’, 블로그 신규 링크 생성기의 기본값을 `/app?...`으로 교체한다. 이미 발행된 블로그는 수정할 필요 없다. 기존 `blog_top`, `blog_match`, `blog_end`, `blog_review`, `blog_edu` 등 source 값은 손실 없이 보존한다.
- root의 리다이렉트 응답은 홈 캐시에 섞지 않는다. canonical에는 UTM을 포함하지 않는다. 기존 match/round canonical은 유지한다.

### assets와 라우팅

구현자는 Worker가 `/`, `/index.html`, `/app`, `/app/` 및 신규 SSR 경로를 먼저 받도록 assets `run_worker_first`의 지원 문법을 확인해 설정한다. 전체 worker-first를 택할 때도 정적 파일은 `env.ASSETS.fetch`로 1회 위임하고 재귀 요청을 만들지 않는다. 기존 앱 shell을 별도 asset으로 옮기고 Worker가 `/app`에서 제공한다. 직접 asset URL이 중복 색인되지 않도록 정규화한다. 기존 `/guide/` clean URL 동작, `.html`, trailing slash도 함께 검증한다.

## 4. 공통 화면과 홈 배치 [P0]

### 공통 shell

브랜드는 ‘HYEOKS 풋볼 데이터’. 바로 아래 작은 설명은 ‘축구 경기 확률과 기록, 계산 근거를 함께 봅니다’. 브랜드 클릭은 항상 `/`.

헤더 1차 링크: 경기 분석(`/matches`), 기록(`/performance`), 가이드(`/guide/`), 승무패 도구(`/app`). 2차 ‘이 데이터를 읽는 법’ 링크: 방법론, 출처·데이터 주의사항. 푸터에는 소개/방법론/기록/출처/편집 원칙/문의/개인정보를 **펼쳐진 실제 앵커**로 제공한다. 필수 신뢰 링크를 앱 탭 뒤에만 넣지 않는다.

### 홈의 위에서 아래 순서

1. **짧은 제목과 데이터 상태**: H1 ‘이번 주 축구, 확률과 근거로 읽기’. 부제는 2줄 이내. ‘일정 확인 시각’, ‘확률 계산 시각’을 구분한다. 큰 홍보 hero, 수익 문구, 전체 화면 일러스트는 없다. 첫 700px 내에 실제 경기 카드가 보이는 것을 목표로 한다.
2. **가까운 경기 6개**: 미래 7일 내 킥오프 오름차순, 동률은 fixture id. 승률 높은 순으로 선정하지 않는다. ‘앞으로 7일 중 가장 가까운 6경기’라는 선정 기준 표시. 경기별 리그/대회·KST 시간·전체 팀명·홈/무/원정 확률·basis·계산 시각·근거 1개/한계 1개를 출력한다. 없는 설명을 만들어 채우지 않는다. 링크는 `/match/:slug`, 전체 보기는 `/matches`.
3. **최근 결과로 다시 보기 3개**: 최근 14일 종료 경기, 최신순. 저장된 사전 확률과 실제 스코어를 나란히 표시. 적중한 경기만 골라내지 않는다. 사전 자료가 없으면 ‘결과만 확인 가능’. 종료 경기의 현재 재계산 확률을 복기처럼 노출하지 않는다.
4. **기록을 읽는 법 + 최신 검증 요약**: 동일 코호트의 평가 경기 수, 기간, 1순위 일치율, 로그손실. 최대 4개 숫자, 반드시 ‘회차 사전 저장 기록’ 범위와 제외 수 표시. 표본 0이면 숫자 대신 설명/기록 링크. 백테스트 성적을 홈 실전 KPI로 대체하지 않는다.
5. **확률을 해석하는 읽을거리 2개**: 검수된 Elo 가이드, 승강제 가이드 우선. 각 제목/독자가 알 수 있는 것/실제 수정일. 금융·환급 제도 글은 가이드 목록의 별도 ‘스포츠토토 제도’ 구역에서 정직하게 표시하며 숨기지 않는다.
6. **데이터 생성 과정**: ‘공개 결과·일정 수집 → 계산/저장 → 경기 후 비교’ 3단계와 링크. 사람이 검수하지 않은 자동 데이터는 ‘자동 집계’라고 표시.
7. **승무패 도구 안내**: 회차 분석·변수 시뮬레이션·예산 조합 기능을 정확히 설명한 작은 보조 카드. 구매·적중·수익 보장 없음. 만 19세 구매 제한과 1336 안내는 해당 도구/토토 콘텐츠에서 분명히 유지.

각 경기 카드의 확률은 텍스트 숫자가 본체다. 막대는 보조 시각화이며 색만으로 결과를 구분하지 않는다. ‘근거 없음’이면 33/33/34 같은 임시값을 예측으로 보여주지 않는다.

## 5. 경기·리그·회차 화면의 실질 가치 [P1]

- 경기 상세 순서: 제목/리그/시간/상태 → 결과 또는 예정 → 확률 3개와 provenance → 왜 이런 값인가 → 무엇을 모르는가 → 비교 자료 → 출처/시점 → 관련 경기.
- ‘왜’는 선택된 예측 원천과 같은 시점의 성분만 사용한다. Elo 격차, 최근 폼 정의와 대상 5경기, H2H 표본 수, 리그 무승부율과 표본, 적용 시장 비중 중 실제 존재하는 값만 출력한다. 라인업·부상·전술·동기 서사는 수집하지 않았으면 쓰지 않는다.
- raw 성분이 사전 스냅샷에 없는 종료 경기: 저장 확률/결과만 제공하고 ‘당시 세부 입력은 보존되지 않아 근거를 복원하지 않습니다’ 표시. 현재 Elo로 과거 설명을 꾸미지 않는다.
- 시장 확률을 비교하면 마진 제거 방식·업체 수·배당 시점을 표시한다. 모델과 시장의 차이를 수익 기회나 베팅 우위로 단정하지 않는다.
- basis `model`, `market`, `national`, `none`을 그대로 전달한다. `model`의 배당 혼합 여부는 별도 `withMarket`로 표시한다. 팀 종류만 보고 basis를 추정하지 않는다.
- 리그/허브는 전체 경기 목록만 복제하지 말고 필터 기간, 수집 범위, 누락/결과 미확인 설명을 둔다. 계산이 없는 일정도 LEFT JOIN으로 읽어 ‘확률 준비 중’ 상태로 나타낸다.
- 회차 화면/앱의 현재 시뮬레이션 결과에는 ‘사용자 설정에 따른 재계산’ 표시. 공식 저장 기록과 섞지 않는다. 기존 기능을 유지하되 과거 적중의 근거 출처를 새 기준으로 명확히 한다.
- 검색어 해시태그 나열보다 독자 질문에 답하는 설명을 우선한다. 경기 수만 늘리려고 입력 부족 페이지를 양산하지 않는다.

## 6. 사전 기록과 재구성 백테스트 계약 [P0]

‘사전 저장’은 `captured_at/computed_at < kickoff_at`이 검증된 서버 기록이다. 이것만으로 외부에 언제 공개됐는지까지 증명하지는 못하므로 ‘공개 예측’보다 ‘킥오프 전 저장 예측’이라고 쓴다. 공개 이력 감사 로그가 있을 때만 더 강한 표현을 쓴다.

`provenance.kind`:
- `pre_kickoff_snapshot`: 회차 prediction_snapshots의 유효한 시각과 확률.
- `pre_kickoff_fixture`: fixture_predictions의 유효한 사전 computed_at.
- `current_estimate`: 아직 시작 전의 현재 계산.
- `reconstructed_backtest`: 사후 재실행, 실제 사전 기록으로 집계 금지.
- `unavailable`: 없음/시점 검증 불가. 0%가 아니다.

신규 `/performance` 기본 코호트는 **회차 prediction_snapshots + round_results**만 사용한다. fixture 기록은 별도 섹션/분모로 제공하며 초기에는 생략 가능하다. 두 모집단을 합산하지 않아 같은 경기 중복을 피한다.

포함 조건: 결과 H/D/A 존재, kickoff/captured 시각 parse 가능, captured < kickoff, raw computed_at도 존재하면 kickoff 이전, basis != none, 세 확률이 finite 및 0..1이고 합이 허용오차 1e-6 내 1. 사후 등록 플래그 true, 취소/무효, 시간 불확실, 중복은 제외한다. 연기 후 원래 시각과 변경 시각이 불명확하면 별도 제외한다.

- 회차별 최종 사전 스냅샷 하나를 사용한다. 동일 실제 경기의 회차 중복은 공통 fixture id가 있으면 이를 키로 중복 제거하고, 없으면 league+정규화 팀+정확한 kickoff 키로 확인한다. 모호한 매칭은 합치지 말고 검토 제외 수로 공개한다.
- pick은 저장된 값을 사용한다. 저장 pick과 argmax가 불일치하면 검토 제외. 동률은 저장된 선택 규칙을 문서화한다.
- 일치율 = 맞은 경기 / 적격 경기. 로그손실 = 평균 `-ln(max(1e-15,p_actual))`. 0 표본은 null. raw 확률이 유효하지 않으면 정규화해 은폐하지 말고 제외한다.
- 홈승 baseline은 **동일 경기 집합**에서 실제 H 비율. 시장 baseline은 당시 시장 snapshot이 있는 경기끼리 별도 paired cohort로만 제공한다. 현재 배당을 가져와 과거 비교하지 않는다.
- basis별 표본/기간 공개. ‘전체’를 클럽 모델 단독 성능이라 부르지 않는다. 수익률·당첨 수·실제 구매 실적은 수집되지 않았다면 표시하지 않는다.
- UI에는 기간, n, 제외 사유별 n, 집계 시각, 마지막 결과 반영 시각을 붙인다. 작은 표본 경고(n<30)는 통계 보증 기준이 아니라 독해 경고임을 밝힌다.
- 별도 ‘재구성 백테스트’에는 데이터 기간/출처, 코드 버전, 학습·검증 경계 4개, out-of-sample 여부, 지표, 적용/기각 결정을 공개한다. 폴드가 중첩되면 n을 합산하지 않는다. 기존 seed 값은 메타데이터가 확인된 항목만 사용한다. 알 수 없는 버전은 ‘기록 없음’.

## 7. 새 데이터 계약과 조회 계획 [P0]

다음은 **추가할 내부 SSR view model**이다. 기존 공개 JSON을 파괴적으로 변경하지 않는다. public JSON에 더할 경우 optional 추가와 schema 호환성을 구현자가 문서화한다.

### HomeView

- `generatedAt: ISO`, `timezone: 'Asia/Seoul'`.
- `freshness: {scheduleUpdatedAt: ISO|null, predictionUpdatedAt: ISO|null, performanceUpdatedAt: ISO|null, stale: boolean, warnings: string[]}`. updatedAt 최댓값을 전체 자료의 신선도로 오인하지 않도록 카드별 시각도 유지.
- `upcoming: MatchSummary[<=6]`, `recent: MatchSummary[<=3]`.
- `performance: {cohort:'round_pre_kickoff', from:ISO|null,to:ISO|null,n:number,hits:number,accuracy:number|null,logLoss:number|null,homeBaseline:number|null,excluded:Record<reason,number>,byBasis:Array<{basis,n,hits}>,computedAt:ISO}|null`.
- `guides: {slug,title,summary,category,publishedAt,modifiedAt,reviewedAt:null|ISO,reviewStatus:'pending'|'reviewed',sourceLinks:string[]}[<=2]`。빌드 시 검수 manifest에서 읽고 파일 mtime을 검수일로 사용하지 않는다.

### MatchSummary

`fixtureId`, `slug`, `league`, `leagueSlug`, `competition:null|string`, `home`, `away`, `kickoffAt`, `status`, `scheduleUpdatedAt`, `result:null|{hg,ag,actual}`, `probability:null|{pHome,pDraw,pAway,pick,basis,withMarket}`, `provenance:{kind,source:'round'|'fixture'|null,capturedAt:null|ISO,modelVersion:null|string}`, `round:null|{roundNo,seq}`, `reason:null|string`, `limitation:string`, `sourceIds:string[]`.

성분 확장 `detail`은 `eloDiff`, `formDiff`, `nForm`, `formWindow`, `h2hDiff`, `nH2h`, `leagueDrawRate`, `leagueDrawSample`, `marketWeight`, `nBookmakers`, `marketCapturedAt`, `inputCapturedAt`을 모두 nullable로 선언한다. DB에 없는 표본/시점을 임의 채우지 않는다. 과거 snapshot에는 없는 성분은 null이다. 향후 저장을 추가할 때부터만 제공한다.

### 요청 시 읽기: 명시적 필드와 제한

Q1 가까운 경기: fixtures LEFT JOIN fixture_predictions ON fixture_id=f.id. 선택 필드 `f.id,slug,league,competition,home_en,away_en,home_kr,away_kr,kickoff_at,status,hg,ag,updated_at`, `p.p_home,p_draw,p_away,pick,basis,computed_at,elo_diff,form_diff,h2h_diff,n_h2h,league_draw_rate`. WHERE `status='scheduled' AND kickoff_at>=? AND kickoff_at<?` (now~now+7일), ORDER BY kickoff_at,id, LIMIT 6.

Q2 최근 결과: 같은 select, WHERE `status='finished' AND kickoff_at>=? AND kickoff_at<? AND hg IS NOT NULL AND ag IS NOT NULL` (now-14일~now), ORDER BY kickoff_at DESC,id DESC, LIMIT 3. 유효 사전값이 없는 행도 결과 카드로 유지.

Q3 회차 연결: 선정된 최대 9경기의 최소/최대 kickoff 범위에 한해 `round_matches rm JOIN rounds r`에서 `rm.id,round_id,seq,league,home_kr,away_kr,kickoff_at,r.round_no`를 batch 조회. `round_no_confirmed=1`, LIMIT 300; 한도 초과를 조용히 완전 조회로 해석하지 않고 해당 연결을 ‘미확인’ 처리한다. 기존 팀 매핑과 정확 시간 검증으로 연결하며 날짜+짧은 팀명만 같다고 확정하지 않는다.

Q4 선정된 연결 match id 최대 9개에 대해 `prediction_snapshots`의 `round_match_id,p_home,p_draw,p_away,pick,basis,captured_at,n_bookmakers`와 `round_predictions.computed_at`를 한 번에 읽는다. 킥오프 전/후를 공통 selector로 처리한다. 홈 요청에서 `buildRoundPredictions`를 경기별 호출하지 않는다. 유효 round snapshot 없으면 유효 fixture 예측을 선택하되 원천을 공개한다. 상세/목록/앱과 같은 최신 원천을 요구하면 수집 때 생성한 회차 view cache를 사용하고, 캐시 없는 경우 홈에 원천 차이와 시점을 명시한다.

Q5 검증 요약: KV `performance:v1:round-prekickoff` 한 번 읽기. 없으면 ‘검증 기록 집계 준비 중’. 홈 요청 안에서 전기간 정산을 계산하지 않는다.

이 구조는 최대 4 D1 읽기+1 KV 읽기이며 fixture별 외부 HTTP 요청, LLM 호출, 순차 N+1 쿼리는 금지한다. 매 카드 상세 로더 호출도 금지한다. 기존 `listMatchCards`의 최대 500행/회차별 계산을 홈 전체 로더로 그대로 호출하지 않는다.

### 비동기 집계와 색인

새 집계 함수가 결과 동기화 후 주기적으로 `round_matches rm JOIN rounds r LEFT JOIN prediction_snapshots s LEFT JOIN round_predictions p LEFT JOIN round_results rr`를 읽는다. 필요한 필드: rm.id/round_id/seq/league/home_kr/away_kr/kickoff_at, r.round_no, s의 확률/pick/basis/captured_at, p.computed_at, rr.actual/hg/ag/settled_at. 존재하지 않는 DB 사후 등록 컬럼을 가정하지 말고 현재 코드의 판정과 위 timestamp 검사를 함께 사용한다.

500행 keyset(`rm.id > ? ORDER BY rm.id LIMIT 500`)으로 순회해 일별/basis별 중간 집계를 누적하고 완료 후 KV 요약을 교체한다. 기존 정산 후 결과 수정도 반영되도록 최근 구간 재집계 및 주간 전량 재집계를 제공한다. 진행 중 summary를 완성본처럼 노출하지 않는다. 최종 제외 사유와 계산 규칙 버전도 저장한다. D1 쓰기 필요 시 `env.DB.batch` 사용, invocation당 1,000 요청 한도보다 충분히 작은 배치로 나눈다.

현재 index `idx_fixtures_kickoff`, `idx_fixtures_league_kickoff`, 각 prediction PK를 우선 사용한다. 구현자가 query plan을 확인한 뒤 필요하면 `(status,kickoff_at,id)` fixture index, `(kickoff_at,id)` round_matches index를 migration으로 추가한다. 이 명세 작성자는 migration을 만들지 않는다.

신선도: fixture 수집 예정 주기 6시간의 2배(12시간) 초과면 해당 카드 ‘업데이트 지연’. 이것은 일정/예측 갱신 상태이지 실시간 중계가 아니다. 결과 미수집 경기를 임의 finished로 바꾸지 않는다. kickoff는 지났지만 결과가 없으면 ‘결과 확인 중’ 파생 표시를 한다.

캐시: 홈 정상 데이터 300초 shared cache, stale-while-revalidate 최대 600초를 지원 환경에서 적용. cache key는 origin/path/허용된 콘텐츠 필터만, UTM/사용자 source는 HTML에 bake하지 않는다. provenance 고정값을 요청 시 안전하게 렌더링한다. 오류 응답은 no-store, 정상 HTML만 cache. 목표 서버 처리 p95 500ms 이내(실측 목표이지 현재 성능 주장 아님), 홈 JS gzip 15KB 이내, app.js는 홈에서 로드하지 않는다.

## 8. 방법론·가이드·운영 신뢰 [P1]

`/methodology`: 3-way 확률과 기대 점수의 차이, basis 네 종류, 리그별 입력/혼합값(현재 코드에서 가져오기), 시장 마진 제거 정의, 홈 이점, 캘리브레이션과 확신도 차이, 모델 변경 검증, 미반영 요소, 사전 스냅샷/백테스트 차이. 실제 한 경기의 값과 데이터 링크로 계산 해석을 보여주되 설명용 가상 숫자는 명시한다.

`/sources`: FotMob 일정/결과, WiseToto 회차/시장, Betman 판매기간/투표, 국가대표 결과 데이터셋, 백테스트 자료를 용도별 구분한다. 원문 URL, 수집 방법, 예정 주기, 표시 범위, 시간대, 최신 확인일, 누락 시 동작, 재배포 권한 확인 상태를 기록한다. 타 서비스 자료라는 사실은 사용 허가나 제휴를 뜻하지 않는다. 공식성·라이선스를 확인하지 않고 보증하지 않는다.

`/editorial`: ‘HYEOKS 운영자’처럼 확인 가능한 작성 주체만. 실제 다인 팀/전문가 검수 증빙 없이 데이터팀·전문가라고 쓰지 않는다. 규칙 기반 문장, AI 보조 작성, 자동 통계, 사람이 확인한 부분을 구별한다. 정정 접수 → 원출처 대조 → 수정 내역/시각 기록 흐름을 설명하되 검수하지 않은 글에 검수 완료 배지를 붙이지 않는다.

`/contact`: 메일 링크와 ‘페이지 주소·문제 문장·확인 가능한 출처’를 요청한다. 투표권 번호, 계좌, 신분증 같은 민감 정보는 보내지 말라고 안내한다. 실제 운영 연락처 외에 가짜 주소·회사·응답 SLA를 만들지 않는다.

기존 가이드 개선 우선순위:
1. Elo: 기대 점수 용어, 모델 실제 상수 대조, 시점 다른 FIFA/World Elo 구분, 원문 앵커, 최신 순위가 아닌 기준일 기록임을 표시.
2. 승강제: 2026/2027 제도 구분, 공식 규정의 조항/발표 날짜 링크, 경우의 수 표를 원문과 대조.
3. 세금/환급/프로토 확인: 법령·약관 적용일 링크, 예외 조건과 사례 산식, 오래된 월별 환급액을 현재 현황처럼 쓰지 않기. 개인별 세무 판단을 보장하지 않는다.
4. 다섯 글의 author/modified/reviewed/출처 표시 통일. 본문에 실제 고친 내용 없이 dateModified만 갱신하지 않는다.
5. 제목의 연도/키워드 반복을 줄이고 질문에 바로 답한다. 홈에 기존 글 5개를 기사처럼 재생산하지 않는다. 새 글은 검증 가능한 고유 분석이 있을 때만 추가한다.

## 9. 모바일·키보드·오류 [P0]

- 360px 기준 좌우 16px, 본문 폭 328px. 헤더는 브랜드 1행 + 2x2 링크 그리드, 가로 스크롤 필수 메뉴 금지. 홈은 단일 열, 768px 이상 2열 카드, 최대 1120px.
- 본문 16px/1.65, 보조 14px, H1 28px/1.3. 기존 남색 바탕/금색 보조/보라색 데이터 포인트를 유지하되 작은 회색 글씨 대비는 WCAG AA 4.5:1 검사. 밝은 모드에서도 금색 텍스트 대비 재검사.
- 버튼/주요 링크 최소 44x44px, 긴 국가/팀명 두 줄 이상 허용, 확률은 3등분 줄. 200% 확대와 320px에서도 페이지 전체 가로 넘침 없음.
- skip link, landmark, 페이지당 H1 하나. 링크는 이동, button은 상태 변경. 카드 전체 링크 안에 또 링크/button을 중첩하지 않는다. visible focus 2px 이상, hover 전용 정보 금지.
- 표는 caption/thead/scope, 좁으면 label 포함 카드형 표시 또는 이름 붙인 키보드 스크롤 영역. 그래프에는 동일 숫자 텍스트 제공. tabs를 유지하면 roving tabindex·좌우/Home/End 키·연결된 tabpanel 구현. swipe는 선택 기능이며 버튼을 대체하지 않는다.
- 홈 SSR은 spinner 없이 실제 데이터를 먼저 보여준다. 필터 enhancement에는 aria-busy와 짧은 status live region, 취소 가능한 요청. 자동 새로고침으로 포커스를 뺏지 않는다. reduced-motion 준수.
- 예정 경기 없음: 기간/지원 범위와 ‘이 기간에 수집된 예정 경기가 없습니다’, 최근 결과/가이드 유지. 휴식기라고 단정하지 않는다.
- 확률 없음: 일정은 유지, ‘입력 부족으로 계산하지 않았습니다’. 결과 미확인, 일정 취소, 업데이트 지연을 서로 구분.
- 부분 실패: 성공한 카드/정적 설명 유지, ‘일부 데이터를 불러오지 못했습니다’와 재시도 링크. 0경기와 오류를 구분.
- 전면 DB 장애: 가능하면 시각 표시한 마지막 정상 cache, 없으면 503 HTML과 Retry-After·정적 가이드 링크. 내부 오류 문자열 노출 금지. 없는 slug는 404 HTML, 빈 필터는 정상 200. 가짜 성공 페이지/soft 404 금지.

## 10. 광고·색인·측정 [P0]

### 광고

모든 템플릿/정적 가이드에서 직접 광고 script와 push를 제거하고 단일 gate로 통합한다. 기본 `ADS_ENABLED=false`. 초기에는 자리 자체를 숨기며 빈 광고 박스/높이도 만들지 않는다. 자동 광고도 금지.

광고 요청 허용 조건은 모두 충족해야 한다: (1) 실제 사이트 승인 확인, (2) 현행 정책과 페이지별 적격성 사람 검토, (3) 필요한 지역의 Google 인증 CMP 및 동의 신호 동작 검증, (4) 운영자의 명시적 활성화 변경. 동의 거부/실패/지역 판단 불명 시 기본 차단. CMP 준비가 광고 승인과 같은 뜻은 아니다.

미래 자리는 긴 가이드의 본문 중간/끝처럼 콘텐츠와 분리된 영역만 검토한다. 앱 조합 버튼·확률 카드·네비게이션 옆, sticky/전면 광고는 범위 밖. 광고 허용 page allowlist 기본 비어 있음. `/app`나 토토 글이 정책상 허용되는지는 별도 심사하며 일괄 허용/일괄 금지를 가정하지 않는다. 스폰서는 실제 계약이 있을 때만 ‘광고/후원’ 명시, 없으면 숨김. 광고 활성화는 이번 구현 자동 배포로 이루어지지 않는다.

### 색인

신규 SSR 홈·방법론·기록·가이드·출처는 unique title/description/canonical과 실제 HTML 본문 제공. 개인정보/문의는 신뢰 연결이지 검색 글 확장 수단이 아니다. `/app`는 도구로 접근 가능하게 두되 얕은 파라미터 변형은 canonical `/app`; 필요 시 tool noindex는 검색 품질 판단으로 결정하고 정책 회피 수단으로 쓰지 않는다.

sitemap은 실제 준비된 페이지만 추가, lastmod는 실제 콘텐츠 변경일. 빈/근거 부족 신규 경기 상세는 noindex로 두고 sitemap 제외할 수 있지만 기존 유효 페이지를 일괄 삭제하지 않는다. JSON-LD는 실제 Organization/Article/Breadcrumb만, 가짜 Person 전문성·리뷰·평점 없음. 데이터 설명이나 시각화가 없는데 Dataset 마크업을 붙이지 않는다.

### 이벤트와 저장 매핑

현재 `/api/e` payload `{e,r,u,ref}`, `usage_daily(day,event,source,round_no,count)` 유지. 신규 이벤트는 `src/lib/usage.ts` allowlist에 추가한다.

- `home_view`: 홈 DOM 최초 준비 시 1회.
- `home_match_click`: 홈 경기 상세 이동. round 연결 시 r=roundNo, 없으면 0.
- `home_results_click`: 홈 결과 카드 이동.
- `home_app_click`: 홈 도구 CTA 이동.
- `home_guide_click`: 홈 가이드 이동.
- `methodology_view`, `performance_view`, `sources_view`, `editorial_view`, `contact_view`, `guide_view`: 해당 페이지 준비 1회.
- `source_link_click`: 원문 출처 이동. 전체 URL을 저장하지 않는다.
- `contact_email_click`: mailto 클릭, 실제 전송 완료로 해석하지 않는다.
- 기존 `app_open`, `round_view`, `hub_view`, `league_view`, `match_view`, `round_page_cta`, 탭 이벤트 유지. redirect 자체에서는 home_view/app_open을 발송하지 않아 중복 방지.

r은 언제나 회차 번호 또는 0이며 경기 id/guide id를 넣지 않는다. 현재 스키마는 개별 가이드·위치별 클릭을 저장하지 못한다. 초기 보고는 집계만, 상세 차원이 필요하면 허용 enum dimension migration을 별도 설계한다. IP·검색어·메일 본문·user id·전체 URL을 수집하지 않는다. UTM source 우선 규칙과 앱 first-touch 유지. home→app 내부 링크에서 기존 source를 안전하게 전달해 블로그 유입이 internal로 바뀌지 않도록 한다. 허용 형식 이외 임의 source를 생성하지 않는다.

지표: home_match_click/home_view, home_app_click/home_view, performance_view/home_view의 이벤트 비율과 오류율/응답 지연. 사용자 단위 전환율·체류시간으로 부르지 않는다. beacon 차단·재방문·봇의 영향을 명시하며 광고 승인 지표로 오인하지 않는다.

## 11. 구현 순서와 인수 기준

### P0: 안전과 구조

1. 광고 default-off와 직접 script 제거.
2. `/app` shell 분리 + Worker 우선 라우팅 + root query 호환, API 무변경.
3. 공통 nav/footer + SSR 홈 기본 데이터 + 출처/방법론 최소 실질 내용.
4. provenance selector와 엄격 사전 기록 집계. 충분한 데이터가 없으면 정직한 빈 상태로 출시하고 과거 숫자를 가져오지 않는다.
5. 모바일/키보드/error/측정 연결.

### P1: 내용과 일관성

6. `/performance`, `/editorial`, `/sources`, `/contact` 완성.
7. 경기 상세의 원천/시점/근거 정합성, guide 5개 검수, source 원문 링크·수정 내역.
8. sitemap/canonical/구조화 데이터 및 동일 URL 회귀 확인.

### P2: 운영 관측

9. 성능/누락/신선도 점검. 검증 가능한 고유 경기 분석이 있는 경우에만 편집 콘텐츠 추가.
10. 사람이 사이트 전체와 현행 정책을 검토한 후에만 재심사 요청 여부 결정. ‘P0 완료=승인 준비 끝’이라고 보고하지 않는다.

부모 구현자가 수행할 확인 목록(이 명세 작업에서는 실행하지 않음):
- JS 비활성 `/` 응답에 실제 팀명·확률/없음 상태·근거·시간·신뢰 링크가 존재한다.
- 360px/320px, 200% 확대, 키보드-only, 긴 팀명, no data/partial error/503/404 상태 확인.
- `/?round=56&utm_source=blog_top`, `/?view=matches`, 양쪽 파라미터, 잘못된 회차, UTM-only root, `/app/`, `/index.html`, 뒤로가기·직접 새로고침 확인.
- `/round/:no/data.json`과 기존 API 계약/자동 블로그 소비자 불변. 공식 확률과 사용자 토글 확률 라벨 분리.
- 사전 timestamp 없는/킥오프 이후/none/중복/취소/결과 누락 사례를 사전 성적에서 제외. 백테스트 n과 합산하지 않음.
- 같은 경기/같은 원천/같은 시각의 홈·상세·앱 숫자가 일치, 다른 시각이면 이를 명시. 확률을 바꿀 때 basis와 분석 설명도 함께 교체.
- gate false 또는 동의 실패일 때 Google 광고 script/request/빈 광고 슬롯이 없음. ads.txt는 정상 유지.
- 정상 홈 uncached D1 읽기 ≤4, KV ≤1, N+1/외부 API/AI 호출 없음. cache 오염·UTM 유실 없음.
- `npm run typecheck && npm test && npm run build:client` 및 부모의 경로·템플릿 회귀 검증 후 한 PR로 전달한다. 이번 명세는 검사 통과를 주장하지 않는다.

예상 구현 파일 영역: `src/index.ts`, `wrangler.toml`, 신규 home/site/provenance/performance 모듈, `src/lib/matchPage.ts`, `roundArticle.ts`, `usage.ts`, `public/index.html`의 앱 분리, `public/app.ts`, `matchesView.ts`, 공통 CSS, guide/about/privacy shell, 필요한 migration과 tests. **이 명세 작성 범위에서는 위 파일을 수정하지 않는다.**
