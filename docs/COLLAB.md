# Claude ↔ Codex 협업 규약

> 결정일: 2026-09-26 (사용자 지시). 역할이나 인터페이스가 바뀌면 이 문서를 먼저 고친다.
> 저장소 전체 맥락은 [`HANDOFF.md`](HANDOFF.md)를 본다.

## 1. 역할

| 담당 | 범위 |
|---|---|
| **Codex** | 브랜드, **화면 설계**(홈 개편·메뉴 구성·광고/스폰서 자리의 모양과 위치), **회차별 블로그 글 편집**, 표지·데이터 이미지 제작, Claude가 바로 구현할 수 있는 **명세 작성** |
| **Claude** | **시스템 유지와 자동화**: 수집·예측·정산 파이프라인, 배포, 데이터 인터페이스, 측정, 명세를 받은 화면의 구현, 장애 대응 |
| **사용자** | 우선순위 결정, PR 병합, 블로그 발행(또는 AI 브라우저에 맡김), 법률·제휴 판단 |

- 예측 모델(계수·가중치)은 Claude 담당이다. 바꾸려면 4분할 검증(HANDOFF 5장)을 통과해야 한다.
- 블로그 문구와 이미지에 들어가는 **숫자는 반드시 아래 데이터 인터페이스에서 가져온다.** 이미지 생성 모델이 팀명·확률·성적을 직접 쓰게 하지 않는다(숫자 오류 방지).

## 2. 데이터 인터페이스 (Claude가 제공, 계약)

### `GET /round/{회차}/data.json`

회차 글의 원자료다. 공개 페이지 `/round/{회차}`와 초안 `/round/{회차}/draft`가 **같은 함수로 같은 데이터**를 쓴다.

```jsonc
{
  "schema": 1,                       // 형식이 호환되지 않게 바뀌면 올린다
  "generatedAt": "ISO",              // 이 응답을 만든 시각
  "asOf": "ISO | null",              // 데이터 기준 시각 = 이 회차 해외 배당 최종 갱신 시각
  "asOfKst": "9. 26. (토) 10:49",    // 사람용 표기(한국시간). 이미지·본문에 이 값을 그대로 쓴다
  "roundNo": 56,
  "title": "...", "description": "...", "tags": ["..."],
  "leagues": ["U네이션"], "deadline": "9. 27. (일) 22:00",   // 첫 경기(KST)
  "saleEndAt": "ISO | null", "saleDeadline": "9. 28. (월) 23:00 | null",  // betman 발매 마감(첫 경기와 다름). 수집 전이면 null
  "report": "AI 요약 | null",
  "matches": [{
    "seq": 1, "league": "U네이션", "home": "아르메니아", "away": "몬테네그로",   // 국가대표는 전체 이름으로 복원, 클럽은 wisetoto 표기
    "kickoffAt": "ISO|null",
    "pHome": 0.355, "pDraw": 0.289, "pAway": 0.356,
    "pick": "홈승|무승부|원정승",
    "confidenceGap": 0.001,           // 1·2위 확률 차
    "basis": "model|market|national|none",   // 확률 출처. none이면 픽을 쓰지 말 것(임시값)
    "tier": "확신픽|보통|불확실|근거없음",      // model일 때만 의미 있음
    "nBookmakers": 2,
    "vote": { "home": 30, "draw": 20, "away": 50 } ,   // betman 투표율(%) | null
    "result": { "actual": "H|D|A", "hg": 1, "ag": 1 } | null,
    "predictedAfterKickoff": false,   // true면 채점·홍보에 쓰지 말 것
    "detail": {                       // 근거 원자료(끝난 경기는 null). 없는 근거는 null
      "eloDiff": 120, "formDiff": 0.8, "h2hDiff": 0.6, "nH2h": 4,      // 클럽 모델 경기만
      "natEloDiff": 90, "natProbs": { "pHome": 0.6, "pDraw": 0.24, "pAway": 0.16 },  // 국가대표만
      "market": { "pHome": 0.55, "pDraw": 0.26, "pAway": 0.19, "n": 5 },  // 해외 배당(최신)
      "marketOpen": { "pHome": 0.52, "pDraw": 0.27, "pAway": 0.21 },      // 첫 수집 배당(흐름)
      "modelOnly": { "pHome": 0.5, "pDraw": 0.27, "pAway": 0.23 },         // 배당 섞기 전 모델
      "calib": { "accuracy": 0.61, "n": 812, "minGap": 0.2, "maxGap": 0.3 } // 같은 확신 구간 과거 적중률
    },
    "analysis": {                     // 규칙으로 만든 분석 문장(숫자는 전부 detail에서 옴, LLM 아님)
      "reasons": ["근거 문장…"], "risks": ["변수·위험 문장…"],
      "stance": "단식|단식·여유 시 복식|복식|삼복식 고려|판단 보류",
      "cover": ["홈승", "무승부"], "verdict": "한 줄 결론"
    }
  }],
  "keyMatches": [12, 11, 1],         // 심층 분석 대상 seq(중요도 순)
  "highlights": ["한눈에 보기 요점…"], "basisSummary": "배당 14경기", "strategy": "단식 권장 …",
  "top": [/* 확신도 상위 3 (matches와 같은 모양) */],
  "hedges": [/* 확신도 하위 4 = 복식 후보 */],
  "crowdSplits": [/* 투표 1위와 우리 픽이 다른 경기 */],
  "recent": [{ "roundNo": 55, "hits": 8, "n": 14 }],   // 킥오프 전 공개 예측 기준, 사후 등록 제외
  "pageUrl": "...", "draftUrl": "...", "appUrl": "...", "dataUrl": "..."
}
```

- `analysis` 문장은 블로그 본문에 그대로 써도 되는 수준으로 만든다(조사 처리, 과장 표현 없음). 톤·순서·이미지화는 Codex가 편집한다. 새 근거 문장이 필요하면 명세로 요청한다(`src/lib/matchAnalysis.ts`).
- 끝난 경기의 확률과 픽은 **킥오프 전에 공개했던 값**(예측 스냅샷)이다. 모델이 나중에 바뀌어도 변하지 않는다.
- 진행 중인 경기는 현재 값이며, 배당이 들어오면(2시간마다) 바뀐다. **이미지와 본문에는 `asOfKst`를 함께 적는다.** 그래야 페이지와 이미지의 시점 차이를 독자가 알 수 있다.
- CORS가 열려 있다. 로컬 도구나 노트북에서 바로 불러와도 된다.

### 기타

| 경로 | 용도 |
|---|---|
| `/round/{회차}` | 검색 노출용 공개 페이지(10분 캐시) |
| `/round/{회차}/draft` | 블로그 초안(검색 제외). 제목·본문·태그 복사 |
| `/?round={회차}&utm_source=...` | 앱의 해당 회차. 블로그 링크에는 `utm_source=blog&utm_campaign=r{회차}`를 붙인다(초안이 자동으로 붙임) |
| `/api/rounds`, `/api/rounds/{id}` | 앱용 API(내부 id 기준) |
| 텔레그램 | 회차의 첫 AI 리포트가 저장되면 초안 링크가 회차당 1회 온다 |

## 3. 측정 (Claude가 제공)

- 일별 집계만 저장한다(`usage_daily`). 쿠키·IP·개인 식별 정보는 없다.
- 이벤트 목록

  | 구분 | 이벤트 |
  |---|---|
  | 앱 | `app_open`, `round_view` |
  | 앱 탭 | `tab_matches`, `tab_settings`, `tab_ai`, `tab_bets`, `tab_calibration`, `tab_info` |
  | 앱 기능 | `report_view` |
  | 회차 페이지 | `round_page_view`, `round_page_cta` |

- 유입 경로(`source`) 결정 방식
  1. `utm_source`가 있으면 그 값
  2. 없으면 리퍼러로 분류: `naver`, `google`, `daum`, `bing`, `x`, `referral`, `internal`, `direct`
  3. 앱은 세션의 첫 방문 경로로 고정한다
- 조회: 워크플로 `task=usage-stats`, 또는 `GET /api/admin/usage?days=14`(관리자 토큰)
- **새 화면에 측정이 필요하면** Codex는 명세에 이벤트 이름을 적는다. Claude가 `src/lib/usage.ts` 허용 목록과 화면에 추가한다.

## 4. 화면 명세를 넘기는 방법 (Codex → Claude)

- `docs/specs/NNN-제목.md`로 저장소에 올린다(예: `docs/specs/001-home-redesign.md`). 채팅으로만 전달하면 기록이 남지 않는다.
- 명세에 담을 것
  1. 목적
  2. 화면별 구성과 순서
  3. 각 요소가 쓰는 데이터 필드(위 스키마 이름으로)
  4. 빈 상태·로딩·오류 때 모습
  5. 모바일 폭(360px) 기준 레이아웃
  6. 측정 이벤트
  7. 광고/스폰서 자리(광고주가 없을 때 숨김 여부)
- 시안 이미지는 `docs/specs/assets/`에 둔다.
- 데이터가 모자라면 명세에 "필요한 필드"로 적는다. Claude가 인터페이스를 늘리고 이 문서의 스키마를 고친다.

## 5. 작업 규칙

- **브랜치:** Claude는 `claude/*`, Codex는 `codex/*`에서 작업하고 main으로 PR을 올린다. 병합은 사용자가 한다(merge commit, 브랜치 유지).
- **충돌 방지:** 같은 파일을 동시에 크게 고치지 않는다. 화면 파일(`public/index.html`, `public/app.ts`, `public/style.css`)은 명세를 받은 뒤 Claude가 구현하는 것을 기본으로 한다. Codex가 직접 고치려면 먼저 이 문서의 "진행 중" 표에 적는다.
- **시작 전:** 작업을 시작하기 전에 main을 받아온다. `AGENTS.md` 규칙(검사 통과, 고지 문구, basis 구분 등)은 둘 다 지킨다.
- **정기 실행:** 정기 GitHub Actions는 main 코드로 돈다. 병합 전까지는 반영되지 않는다.

## 6. 진행 현황

| 항목 | 담당 | 상태 |
|---|---|---|
| 회차 분석 페이지·초안·텔레그램 알림 | Claude | 완료 |
| `data.json` 인터페이스 + 데이터 기준 시각 | Claude | 완료 |
| 킥오프 전 예측 보존(실제 기록용 스냅샷) | Claude | 완료 |
| 유입·기능 이용 측정 + 블로그 링크 UTM | Claude | 완료 |
| 경기별 근거·위험·권장 커버 분석(리포트형 초안) | Claude | 완료 |
| 한 회차의 본문+이미지 세트(디자인 기준) | Codex | 대기 |
| 홈 개편·메뉴(홈/경기 분석/조합 만들기/실제 기록) 명세 | Codex | 대기 |
| betman 발매 마감 저장 + 마감 12·6·3·1시간 전 수집 호출 | Claude | 완료(토큰 등록 필요) |
| 광고·스폰서 자리 명세(광고주 없으면 숨김) | Codex | 초안 있음(`docs/specs/001-sponsor-slots.md`), 검토 대기 |
| 제휴 문의 경로 | 사용자 | 결정: 블로그 안부글(제휴 안내 글 224423344071) |
| 명세 받은 화면 구현 | Claude | 명세 대기 |
