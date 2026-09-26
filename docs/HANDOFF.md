# 프로젝트 인수인계 문서 (HYEOKS 승무패 분석)

> 다른 에이전트(Codex 등)나 사람이 이 저장소를 이어받을 때 읽는 문서다.
> 작성 기준일: 2026-09-26. 코드와 이 문서가 다르면 **코드가 맞다**. 고친 사람은 이 문서도 함께 고친다.
> Claude·Codex 역할 분담과 데이터 인터페이스는 [`COLLAB.md`](COLLAB.md)를 본다.

---

## 1. 무엇을 하는 앱인가

- 축구토토 **승무패**(14경기, 홈승/무/원정승) 회차별 예측 웹앱이다.
- 경기별 확률, 예산별 구매 조합, 독식(단독 당첨) 지향 픽, AI 리포트, 실전 정산 기록을 제공한다.
- 새로 생긴 것
  - 회차 분석 페이지 `/round/:no`: 검색 노출용
  - 블로그 초안 `/round/:no/draft`: 사람이 네이버 블로그에 붙여넣어 발행
- 운영 URL: `https://kleague-toto-predictor.hyeoks.workers.dev`
- 저장소: `Hyeokgi/hyeoks-sports`. 기본 브랜치 `main`, 작업 브랜치 `claude/46th-exclusive-pick-generation-wek14i`

### 지키는 원칙 (바꾸지 말 것)

1. **확률의 출처를 항상 밝힌다.** 경기마다 `prediction.basis`가 붙는다.

   | basis | 뜻 |
   |---|---|
   | `model` | 클럽 Elo 모델 |
   | `market` | 해외 배당 |
   | `national` | 국가대표 Elo |
   | `none` | 근거 없음 |

   화면·리포트·블로그 모두 이 구분을 따른다.
2. **적중·수익을 약속하지 않는다.** 확신도 등급에는 과거 실측 적중률을 함께 적는다.
3. **구매는 공식 판매처(베트맨)에서만, 만 19세 이상**이라는 고지를 공개 글에 항상 붙인다(`DISCLAIMER`).
4. **모델 변경은 시간순 4분할 검증을 통과해야만 채택한다**(아래 5장).

---

## 2. 구조

| 구성 | 위치 | 역할 |
|---|---|---|
| Cloudflare Worker | `src/index.ts` | API, 정적 자산(`public/`), 회차 페이지, 크론 |
| D1 (SQLite) | `migrations/0001~0009` | 경기 결과, 회차, 예측 성분, 배당, 투표율, 정산, 국가대표 Elo |
| KV | `src/lib/reportCache.ts` 등 | AI 리포트(6시간 TTL), 초안 알림 중복 방지 키 |
| 웹 클라이언트 | `public/app.ts` → esbuild → `public/app.js` | 서버 응답의 `raw` 성분으로 **클라이언트에서 다시 예측**한다(토글 시뮬레이션) |
| GitHub Actions | `.github/workflows/*.yml` | Cloudflare에서 막히는 외부 호출 담당(wisetoto 배당, betman 투표율, Gemini) |

### 주의: 클라이언트 재계산

- 서버 API에 예측 입력 필드를 추가하면 `public/app.ts`의 `loadRound()` 매핑에도 **반드시** 추가해야 한다.
- 2026-09-26에 `nationalEloDiff`·`predictedAfterKickoff`가 여기서 빠져, 브라우저에서만 국가대표 Elo가 적용되지 않은 적이 있다.

### 크론·정기 실행

| 무엇 | 주기 | 어디서 | 내용 |
|---|---|---|---|
| `refreshHistory` | 3시간 | Worker 크론 | FotMob 종료 경기 → Elo·무승부율 재계산 → K리그2 코너 → K리그1 xG → **국가대표 Elo(12시간마다 갱신) + 킥오프 전 경기에 격차 고정** → 정산 |
| `detectNewRound` | 6시간 | Worker 크론 | wisetoto에서 다음 회차들을 찾아 등록(최대 4회차 따라잡기) |
| `deadlineTrigger` | 10분 | Worker 크론 | betman 발매 마감(`rounds.sale_end_at`) 12·6·3·1시간 전 25분 창에 `fetch_vote_share.yml` pipeline을 GitHub API로 호출. 워커 시크릿 `GH_DISPATCH_TOKEN`(저장소 시크릿에서 deploy 때 동기화)이 없으면 건너뜀 |
| `Fetch Market Odds` | 2시간 | Actions(**main**) | 진행중 회차 전부의 킥오프 전 경기 해외 배당 |
| `Fetch Betman Vote Share` pipeline | 4시간 | Actions(**main**) | 회차 감지 트리거 + 배당 + betman 투표율(Playwright) + 독식픽 출력 |
| `Generate AI Report` | 6시간 | Actions(**main**) | 마감 임박 회차의 Gemini 리포트 → KV. 첫 저장 때 텔레그램으로 초안 링크 |
| `Export Google Sheets` | 매일 04:00 KST | Actions(**main**) | 회차분석·팀DB·선수DB 시트 |

- **정기 실행은 항상 main 코드로 돈다.** 스크립트를 고쳤으면 main에 병합해야 정기 실행에 반영된다.
- Worker는 브랜치에서 수동으로 배포할 수 있다(`fetch_vote_share.yml`의 `task=deploy`). 이 태스크는 마이그레이션 → 백필 → 배포 → sync 순서로 돈다.

---

## 3. 데이터 소스

| 소스 | 용도 | 비고 |
|---|---|---|
| FotMob | 8개 리그 경기 결과, xG, 코너 | `src/lib/fotmob.ts` |
| wisetoto | **확정 회차번호·경기목록·결과·해외 배당** | `get_toto_list.htm`은 헤더 `X-Requested-With: XMLHttpRequest`가 없으면 403(`gtoto_xrw`). 팀명을 **4글자로 자름**("크로아티"). 발매 전 회차는 master_seq가 `"0"` |
| betman | 대중 투표(매수)율, **발매기간** | 세션·WAF 때문에 Playwright로 페이지를 띄워 응답을 가로챈다(`scripts/fetch_vote_share.mjs`). 구매투표지의 "발매기간"을 `rounds.sale_start_at/sale_end_at`(migration 0011)에 저장. **마감은 첫 경기가 아니다**(56회차: 마감 9/28 23:00, 첫 경기 9/29 01:00 KST) |
| martj42/international_results | 국가대표 A매치 전체 결과(1872~) | raw.githubusercontent CSV, 약 3.7MB |
| lipis/flag-icons (MIT) | 국기 엠블럼 | `public/flags/`에 자체 호스팅(`scripts/fetch_national_flags.ts`) |
| football-data.co.uk | 백테스트·백필 | 유럽 4대리그, JPN/USA/KOR 배당 포함 |
| Gemini | AI 리포트 | Cloudflare IP는 차단돼 **Actions에서만** 호출 |

- 외부 CDN 핫링크는 쓰지 않는다. 엠블럼·국기·폰트 모두 자체 호스팅이다.

---

## 4. 예측 모델

### 클럽 경기 (`basis=model`)

- 구성: Elo 전력차 + 최근 폼 + H2H + 리그별 실측 무승부율 + 격차 기반 무승부 곡선(`src/lib/prediction.ts`, `elo.ts`, `drawCurve.ts`)
- 해외 배당과 섞는 가중치(`marketWeightForLeague`)
  - 유럽 4대리그(EPL·세리에A·라리가·분데스리가): **0.8**
  - K리그1·K리그2·J1·MLS: **0.4**
- xG는 K리그1에만, 코너킥은 K리그2에만 쓴다(다른 리그는 검증 실패).
- 라리가만 홈 어드밴티지가 105이고 나머지는 60이다.
- 확신도 등급(확신픽/보통/불확실)은 리그별 캘리브레이션 표(`src/lib/calibration.ts`)로 붙는다.

### 클럽 Elo가 성립하지 않는 대회 (UCL/UEL/네이션스리그 등)

- 회차 등록 때 `market_only=1`로 고정된다.
- 판정 순서
  1. 배당이 있으면 `market`
  2. 배당이 없고 국가대표 경기면 `national`
  3. 둘 다 없으면 `none`(대칭 확률, 예측 아님)
- **국가대표 Elo**(`src/lib/nationalElo.ts`)
  - 방식: eloratings.net 규칙(대회별 K, 득실차 가중, 홈 +100)
  - 확률 변환: 순서형 로지스틱 3계수
  - 검증: 2010년 이후 공식전 10,511경기, 4분할 모두 통과
    - Elo 61~62% vs 대칭 46%
    - 네이션스리그만: 53~58% vs 41~44%
  - 결과: `seed/national_elo_backtest.json`
  - 배당이 있으면 배당이 우선한다(국가대표 과거 배당이 없어 섞는 비율을 검증할 수 없음).
  - 한글→영문 국가명 매핑은 `src/lib/nationalNames.ts`. 4글자로 잘린 표기는 "그 글자로 시작하는 이름이 한 나라뿐일 때만" 인정한다.

### 킥오프 전 예측 보존 (`prediction_snapshots`, migration 0010)

- 예측은 조회할 때마다 현재 코드로 다시 계산된다. 그래서 모델을 바꾸면 이미 끝난 경기의 픽까지 소급해서 바뀐다.
- 이를 막기 위해 킥오프 전까지는 배당 저장 직후(2시간)와 `refreshHistory`(3시간)에 경기별 예측을 덮어쓰고, 킥오프 이후에는 쓰지 않는다(`src/lib/predictionSnapshot.ts`).
- 스냅샷을 쓰는 곳: 실제 기록 전부. `/api/settlement`, 회차 글의 끝난 경기와 최근 성적, 앱의 적중 배지와 회차 요약(`snapshot.pick`)
- 스냅샷이 없던 시절(2026-09-26 이전) 경기는 재계산값으로 대체된다.

### 사후 등록

- 킥오프 이후에 계산된 예측(`predictedAfterKickoff`)은 결과를 이미 품고 있다.
- 그래서 적중 집계에서 뺀다. 화면에는 "사후 등록" 배지가 붙고, 시트·회차 글에서도 제외한다.

---

## 5. 채택 기준과 기각 기록

**기준:**
- 시간순 4분할(학습 비율 0.5/0.6/0.7/0.8)로 나눈다.
- 계수와 가중치는 학습 구간에서만 고르고, 테스트 구간에서만 평가한다.
- **4분할 모두에서 적중률과 로그손실이 나빠지지 않아야** 채택한다.

| 후보 | 결과 | 판정 |
|---|---|---|
| 유럽 marketWeight 0.4→0.8 | 4/4 개선 | 채택 |
| 국가대표 Elo (배당 없을 때) | 4/4 개선 | 채택 |
| 유럽 xG(여러 형태, 공수분리 포함) | 최대 1/4 | 기각 |
| H2H 제거 | 차이 없음(54.12/53.77/52.74/52.54 → 54.17/53.77/52.74/52.40) | 기각 |
| H2H+폼 제거 | 4/4 악화 | 기각 |
| K리그1·J1·MLS marketWeight 변경 | 적중률 기준 3/4, 0/4, 1/4 | 현행 0.4 유지 |
| 유럽 marketWeight 0.8→1.0 | 백테스트는 4/4 개선. 앱 실데이터는 반대 방향(n=42, 유의하지 않음) | 보류 |
| 야구(KBO·MLB) 승1패 | 승패 2택은 통과했지만, "1"(1점차)은 산수상 예측 불가 | 앱 비노출 |

**실전 성적** (`seed/recent_accuracy.json`, 2026-09-26, 정산 162경기):

| 기준 | 적중률 |
|---|---|
| 모델 전체 | 48.1% |
| 배당이 있던 120경기 | 모델 47.5% vs 배당 1위 45.0% |
| 투표율이 있던 134경기 | 모델 46.3% vs 투표 1위 44.0% |
| 항상 홈승 | 37.7% |
| 확신픽 | 66.7% (27경기) |
| 보통 | 40.5% (79경기) |

- 50·52회차의 저조(35.7%)는 무승부가 8·6개 몰린 탓이다.
- 모델은 무승부를 1픽으로 거의 고르지 않는다. 확률상 argmax가 맞기 때문이다.
- 1픽 적중률을 더 올릴 검증된 방법은 현재 없다. **실전 개선은 "보통·불확실 경기에 복식을 쓰는 것"**이다(앱의 헤지 배지·무승부 헤지).

---

## 6. 2026-09 사고와 수정 (재발 방지용)

1. **회차가 52에서 4주 멈춤**
   - 원인: wisetoto 경기목록이 X-Requested-With 없이 403 → 53회차 등록 실패 → "마지막 회차+1"만 시도하던 구조라 전체 정지.
   - 수정: 헤더 추가, 최대 4회차 따라잡기, 실패 회차는 건너뛰고 텔레그램 알림, master_seq `"0"` 처리.
2. **`/api/admin/sync` 500**
   - 원인: 워커 호출당 D1 요청 1,000회 한도("Too many API requests by single Worker invocation"). 시즌 전체 경기를 한 건씩 INSERT했다.
   - 수정: **D1 쓰기는 반드시 `env.DB.batch`로 묶는다**(100건 단위).
3. **배당·투표율이 최신 등록 회차만 수집됨**
   - 원인: betman은 여러 회차를 동시에 발매한다.
   - 수정: 진행중 회차 전부를 돈다. 킥오프가 지난 경기의 배당은 덮어쓰지 않는다.
4. **정기 배당 수집이 main에서 계속 403**
   - 원인: 수정이 브랜치에만 있었다.
   - 수정: PR #2 병합으로 해결. 교훈: 스크립트 수정은 main 병합까지가 끝이다.
5. **첫 화면에 57회차가 뜸**
   - 수정: `pickDefaultRound`(`src/lib/roundPick.ts`)로 마감이 가장 임박한 발매중 회차를 띄운다. AI 리포트·독식픽 출력도 같은 규칙을 쓴다.
6. **화면에서 국가대표 Elo 미적용**: 2장의 클라이언트 매핑 누락이 원인이었다.

---

## 7. 블로그·수익화 방향 (2026-09-26 결정)

- **방향:** 무료 웹앱이 본체, 블로그는 유입 통로다. 네이티브 앱은 스토어 심사 부담 때문에 보류하고, 필요하면 PWA로 간다.
- **자동화:** 매 회차 **블로그 초안 자동 생성 + 텔레그램 전달**
  - 초안: `/round/:no/draft`. 제목·본문(서식/텍스트)·태그 복사 버튼이 있다.
  - 알림: 리포트가 처음 저장될 때 회차당 1회(`notifyDraftOnce`, `src/routes/admin.ts`)
- **발행(2026-09-26 사용자 결정으로 변경): 사용자 PC의 AI 브라우저(Aside) 루틴이 완전 자동 발행한다.**
  - 새 회차 글을 발행하고, betman 발매 마감 12·6·3·1시간 전에 최신 배당·투표율로 글을 고친다.
  - 워커 `deadlineTrigger`가 같은 체크포인트 직전에 수집을 돌려 앱·`data.json`도 같은 시점 값을 갖게 한다.
  - 루틴은 `data.json`의 `saleEndAt`(없으면 betman 페이지)을 마감 기준으로 쓴다.
- (이전 결정) 발행은 자동화하지 않는다.
  - 티스토리는 글쓰기 API를 종료했고, 네이버 블로그는 공개 API가 없다.
  - 반복 자동 게시는 네이버 저품질·약관 위험이 있다.
  - 발행은 사람이 하거나, 사용자 PC의 AI 브라우저가 초안을 붙여넣는다(발행 전 사람 검수 권장).
- **검색 유입:** `/round/:no` 공개 페이지(canonical·description·og·JSON-LD, 10분 엣지 캐시) + `/sitemap.xml` + `/robots.txt`(초안·API 제외). 앱 링크는 `/?round=56`.
- **법적 주의:** 불법 도박 사이트 광고·링크 금지. 유료 예측 판매는 국민체육진흥법 검토 전에는 하지 않는다. 광고(애드센스·애드포스트)는 "통계·데이터 분석"으로 보이게 하고 고지를 붙인다. **법률 자문이 선행 과제다.**
- **제휴 문의 경로(사용자 결정):** 블로그 안부글. 제휴 안내 글 https://blog.naver.com/beauty017/224423344071 , 블로그 사이드바·회차 글 하단에 SPONSOR 칸 운영 중.
- **예정 과제:** 공개 적중 기록 페이지, PWA(설치 아이콘), 이용 고지, 앱 광고 자리(명세 `docs/specs/001-sponsor-slots.md` 초안, Codex 검토 후 구현).
- **역할 분담(2026-09-26):** 블로그 글·이미지·화면 설계는 Codex, 시스템과 자동화는 Claude가 맡는다(`docs/COLLAB.md`).
- **측정:** `usage_daily`(일별 집계, 개인정보 없음). 블로그 링크에는 `utm_source=blog`가 붙는다. 조회는 `task=usage-stats`.

---

## 8. 작업 규칙

- **로컬 검사:** `npm run typecheck` · `npm test`(vitest) · `npm run build:client`. 커밋 전에 셋 다 통과시킨다.
- **배포:** `fetch_vote_share.yml` `task=deploy`(브랜치 선택 가능). 배포 후 `task=diagnose-sync`로 sync 본문과 상태를 확인하고, `task=check-pages`로 회차 페이지를 확인한다.
- **진단 태스크(같은 워크플로)**

  | 태스크 | 용도 |
  |---|---|
  | `diagnose-round` | 회차 감지 |
  | `diff-round-picks` | 회차 basis 분포·픽 |
  | `recent-accuracy` | 적중률 분해 |
  | `compare-market-d1` | 앱 배당 vs 모델 |

- **샌드박스 네트워크 제한:** 클라우드 세션에서는 wisetoto·betman·workers.dev·football-data·Naver가 막혀 있을 수 있다. 그런 호출은 Actions 태스크로 돌린다.
- **D1:** 쓰기는 batch로 한다. 호출당 1,000회 한도가 있다.
- **코드 스타일:** 주석과 커밋 메시지는 한국어다. "왜"를 적는다(사고 경위, 검증 수치).
- **테스트 정책:** 검증 없이 모델 계수를 바꾸지 않는다. 테스트를 끄거나 건너뛰지 않는다.
- **승인 절차:** PR은 사용자가 요청할 때만 만든다. 병합은 사용자가 한다(merge commit, 브랜치 유지).

---

## 9. 주요 파일 지도

```
src/index.ts                 라우팅(API, /round/:no, sitemap, robots, 정적 자산)
src/cron/refreshHistory.ts   결과·Elo·국가대표 Elo·정산 (D1 batch 필수)
src/cron/detectNewRound.ts   wisetoto 회차 등록 + 따라잡기
src/lib/prediction.ts        predictMatch, basis, marketWeightForLeague
src/lib/predictRound.ts      회차 예측 조립, predictedAfterKickoff
src/lib/nationalElo*.ts      국가대표 Elo 계산·저장·스냅샷
src/lib/nationalNames.ts     한글 국가명 → 영문·국기
src/lib/roundPick.ts         첫 화면 회차 선택(마감 임박)
src/lib/roundArticle.ts      회차 글(페이지·초안·텍스트) 렌더러
src/routes/roundPage.ts      /round/:no, /draft, /data.json, sitemap, robots
src/lib/predictionSnapshot.ts  킥오프 전 예측 보존(실제 기록용)
src/lib/usage.ts             이용 측정(유입 경로 분류, 일별 집계)
src/routes/admin.ts          관리자 API, 리포트 저장 + 초안 텔레그램 알림
src/lib/gemini.ts            AI 리포트 프롬프트 (scripts/generate_report.mjs와 동일 유지 - 동기화 테스트 있음)
src/lib/settlement.ts        정산(FotMob 결과 → wisetoto 결과표 폴백)
public/app.ts                웹 클라이언트 (서버 raw 필드 매핑 주의)
scripts/fetch_market_odds.mjs   배당 수집(진행중 회차 전부)
scripts/fetch_vote_share.mjs    betman 투표율(Playwright)
scripts/generate_report.mjs     Gemini 리포트(마감 임박 회차)
scripts/backtest_national_elo.ts  국가대표 Elo 4분할 검증
scripts/recent_accuracy.ts      실전 적중률 분해
.github/workflows/fetch_vote_share.yml  pipeline + 수동 태스크 모음(deploy 포함)
```
