# 002. 경기별 분석 페이지 (`/match/...`)

> 작성: 2026-09-27, 사용자 승인(방향 A). 초안 작성 Aside, 구현 Claude. 화면 샘플은 Aside가 57회차 크로아티아 vs 잉글랜드 실데이터로 만들었다.
> 관련: [003. 새 리그 자동 추가](003-league-onboarding.md)

## 1. 목적

승무패 회차와 상관없이 **지원 리그의 모든 경기**에 확률·근거 페이지를 자동으로 만든다.
경기 이름 검색("토트넘 아스날 승부예측", "K리그 승부예측")으로 들어오는 유입을 늘려 `hyeoks.com`의 광고 수익 기반을 만든다.
베팅 추천 페이지가 아니다. **단식·복식·조합·배당 추천 같은 베팅 용어를 쓰지 않는다.**

## 2. 범위

| 대상 | 확률 출처 | 페이지 |
|---|---|---|
| 지원 리그(K리그1·K리그2·J1·MLS·EPL·세리에A·라리가·분데스리가) | `model`(배당이 있으면 블렌딩) | 생성 |
| 국가대표 경기 | `national`(배당이 있으면 `market`) | 생성 |
| 003으로 추가돼 검증을 통과한 리그 | `model` | 생성 |
| 리그끼리 붙는 대회(UCL·UEL·리베르타도레스·AFC 등) | `market`만 | 배당이 있을 때만 생성 |
| 근거가 없는 경기(`basis = none`) | - | 만들지 않는다 |

- 경기 7일 전부터 페이지를 만든다. 끝난 경기 페이지는 지우지 않고 결과를 붙여 남긴다(검색 유입이 계속 들어온다).
- 여자·연령별·친선 클럽 경기는 제외한다.

## 3. 데이터

- **경기 목록:** 하루 1회 크론. 리그마다 `fotmob.ts`의 `fetchUpcomingMatches(leagueId)`로 앞으로 7일 경기를 읽는다. 새 테이블 `fixtures`
  - `id, league, fotmob_match_id(unique), kickoff_at, home_kr, away_kr, home_en, away_en, slug(unique), round_match_id(null|승무패 회차 경기와 연결), status(scheduled|finished|postponed), hg, ag, updated_at`
- **예측:** 회차 예측과 **같은 함수**(`prediction.ts`)를 기본 토글로 쓴다. 회차에 포함된 경기는 회차 예측값을 그대로 보여준다(두 값이 달라지지 않게).
- **스냅샷:** 킥오프 전 마지막 예측을 `prediction_snapshots`와 같은 방식으로 보존한다(`fixture_id` 기준). 끝난 경기는 스냅샷으로 표시·채점한다.
- **결과:** 기존 결과 동기화(`refreshHistory`)가 들어올 때 `fixtures.hg/ag/status`도 채운다.
- **배당:** 지금 배당 수집(wisetoto)은 승무패 회차 경기만 있다. 회차 밖 경기는 우선 배당 없이 모델만 쓴다. 배당 확대는 별도 명세로 한다.
- D1 쓰기는 `env.DB.batch`로 묶는다(호출당 1,000회 한도).

## 4. 주소

- 경기: `/match/{YYYY-MM-DD}-{home-slug}-{away-slug}` (날짜는 한국시간 기준, 이름은 FotMob 영문명 소문자·하이픈). 겹치면 `-2`.
  예: `/match/2026-10-04-croatia-england`
- 리그 모음: `/league/{league-slug}` (예: `/league/epl`, `/league/k-league-1`). 이번 주 경기와 지난 경기 결과 목록.
- 원자료: `/match/{slug}/data.json` (회차 `data.json`의 `matches[]` 한 항목과 같은 모양 + `fixture` 정보).

## 5. 화면 구성 (샘플과 같은 순서)

1. 이동 경로: HYEOKS › 리그 › 경기
2. 제목 `{홈} vs {원정} 승부예측`, 리그·킥오프(KST)
3. 확률 카드: 팀 엠블럼(자체 호스팅), 홈승·무·원정승 3칸, 막대, 확률 1위 강조, 배지(확률 출처 · 1·2위 차 · 승무패 N회차 M번 경기면 표시), 반올림 안내
4. 한 줄 요약(`analysis.verdict`를 베팅 용어 없이 바꾼 문장)
5. 광고 자리 `match-mid`
6. 근거와 변수·한계(`analysis.reasons`, `analysis.risks` + 고정 한계 문장)
7. 같은 리그(대회) 다른 경기 목록(내부 링크)
8. 경기 후: 실제 스코어와 킥오프 전 확률 비교(끝난 경기만)
9. 계산 방법 요약 + 신뢰도 페이지 링크
10. 광고 자리 `match-bottom`
11. 고지(`DISCLAIMER`)

- `analysis.stance`(단식·복식 등)와 `cover`는 이 페이지에 쓰지 않는다. `matchAnalysis.ts`에 베팅 용어 없는 `verdictNeutral`을 추가한다.
- 광고는 확률·근거 영역 사이에 넣지 않는다(001 명세 7장).

## 6. 검색 노출

- `<title>`: `{홈} vs {원정} 승부예측 · {M월 D일} {리그} 확률 분석 | HYEOKS`
- `meta description`: 확률 1위와 확률, 근거 한 문장
- `canonical`, JSON-LD `SportsEvent`(이름·시작 시각·홈/원정 팀·장소)
- 사이트맵: 경기 페이지를 추가하고 `lastmod`는 예측 갱신 또는 결과 입력 시각. 사이트맵이 커지면 사이트맵 인덱스로 나눈다(리그별).
- 웹앱 회차 화면과 회차 분석 페이지에서 해당 경기 페이지로 링크한다.

## 7. 측정

- `usage.ts` 허용 목록에 `match_view`, `league_view`, `match_to_app` 추가(날짜별 합계만).

## 8. 테스트

- 슬러그 생성(한글·특수문자·중복), 회차 경기와 경기 페이지의 확률이 같은지, 스냅샷 이후 확률이 바뀌지 않는지, `basis = none`이면 페이지가 404인지, 페이지에 금지 용어(단식·복식·조합·베팅·투표율)가 없는지.

## 9. 단계(PR 단위)

1. `fixtures` 테이블·수집 크론·예측·스냅샷 (화면 없음)
2. `/match/...`, `/league/...` 페이지와 `data.json`, 사이트맵
3. 결과 표시, 회차 화면·분석 페이지와의 상호 링크, 측정 이벤트
