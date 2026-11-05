# P0 리허설 코칭 공통 계약 가이드

<a id="1-이-문서는-왜-필요한가"></a>

## 1. 공통 데이터 구조와 적용 범위

P0 리허설 코칭은 API·Worker·Python·Web에서 같은 데이터 구조와 검증 규칙을 사용한다. 보안, 접근 권한, 데이터 보존 기간도 공통 계약을 따른다.

구현 기준이나 설명이 서로 다르면 다음 순서로 확인한다.

1. [`docs/contracts.md`](../contracts.md)
2. `packages/shared`의 Zod schema
3. `p0-core-contract.fixtures.json`과 schema test
4. 이 설명 문서

관련 변경은 [PR #306](https://github.com/na-man-mu-303-team2/Orbit/pull/306)에서 확인할 수 있다.

---

## 2. 계약과 fixture란 무엇인가

공통 계약은 프로그램들이 데이터를 주고받을 때 지켜야 하는 약속이다.

예를 들어 한국어 발표 속도는 다음처럼 통일한다.

```text
기준 지표: charactersPerMinute
측정 불가: 값을 추측하지 않고 unmeasured와 이유를 저장
```

각 파일의 역할은 다음과 같다.

| 구성요소 | 역할 |
| --- | --- |
| `docs/contracts.md` | 계약의 의미와 정책을 설명한다. |
| `*.schema.ts` | 잘못된 데이터를 실제로 거부한다. |
| `p0-core-contract.fixtures.json` | TypeScript와 Python이 공유하는 정상 데이터 예시다. |
| `*.schema.test.ts` | 잘못된 값이 제대로 거부되는지 검사한다. |
| DB migration | 잘못된 값이 데이터베이스에 저장되는 것을 막는다. |

`p0-core-contract.fixtures.json`에는 테스트용 예시 데이터가 들어 있다. TypeScript와 Python이 같은 입력을 같은 규칙으로 처리하는지 검사할 때 사용하며, 실제 사용자 데이터는 포함하지 않는다.

---

## 3. 전체 흐름

```text
Web
  → API
  → TypeScript Worker
  → Python Worker
  → Rehearsal Report
  → DB
```

데이터는 여러 단계에서 반복 검증한다.

- TypeScript Worker는 Python에 보내기 전에 Zod schema로 검사한다.
- Python Worker는 Pydantic model로 다시 검사한다.
- report를 만들 때 shared schema로 최종 결과를 검사한다.
- 보존 기간과 접근 권한 같은 중요한 규칙은 DB에서도 검사한다.

---

## 4. 핵심 계약 한눈에 보기

| 계약 | 쉽게 말하면 | 중요한 규칙 |
| --- | --- | --- |
| `RehearsalFocusProfile` | 이번 연습에서 고칠 목표 | 최대 3개, 우선순위는 1부터 연속 |
| `revision` | 다른 수정 내용을 덮어쓰지 않는 번호 | 오래된 revision으로 저장하면 충돌 반환 |
| `focusProfileSnapshot` | 발표 시작 시점에 복사한 연습 목표 | 과거 run은 시작 당시 목표로 평가 |
| 문장 target | 특정 문장만 반복 연습 | 문장 위치와 SHA-256 hash 저장 |
| `speechRate` | 한국어 발표 속도 | CPM을 기준으로 사용하고 WPM은 호환값으로 유지 |
| `STTQualityGate` | STT 결과를 믿을 수 있는지 판단 | provider가 주지 않은 confidence는 추측 금지 |
| `pauseV2` | 발표자가 멈춘 위치와 이유 | 근거가 없으면 이유는 `unknown` |
| `EvidenceClip` | 문제 구간을 다시 듣는 짧은 음성 | 최대 12초, 7일, Owner-only |
| `rehearsalAnalyzeRequest` | TypeScript가 Python에 보내는 분석 요청 | 정의되지 않은 필드는 HTTP 422로 거부 |
| `PresenterAid` | 발표 중 보여주는 최소 도움말 | 키워드 최대 3개, 문제 1개, 전체 script 금지 |

---

## 5. Focus Profile과 snapshot

`RehearsalFocusProfile`은 사용자가 이번 연습에서 고칠 목표를 저장한다.

```text
1순위: 도입부에서 발표 목적 먼저 말하기
2순위: 불필요한 추임새 줄이기
3순위: 마지막 결론 분명하게 말하기
```

목표는 최대 3개이며 우선순위는 `1`, `2`, `3`처럼 이어져야 한다.

### revision

두 브라우저가 같은 Profile을 수정할 수 있으므로 저장 요청에 `expectedRevision`을 포함한다.

서버의 현재 revision과 다르면 저장하지 않고 `REHEARSAL_FOCUS_PROFILE_REVISION_CONFLICT`를 반환한다. 이를 통해 다른 사람이 먼저 저장한 내용을 실수로 덮어쓰는 문제를 막는다.

### snapshot

연습 목표는 나중에 바뀔 수 있다. 따라서 run 시작 시점의 목표와 revision을 snapshot으로 저장한다.

```text
run 시작
  → 현재 Focus Profile 복사
  → evaluationSnapshot에 저장
  → 과거 run은 당시 목표로 평가
```

---

## 6. 문장 단위 연습

특정 문장만 연습할 때는 다음 정보를 저장한다.

```text
slideId
sentenceIndex
textSnapshotHash
```

`textSnapshotHash`는 당시 문장의 지문이다. 문장이 수정되어 현재 hash가 달라졌다면 오래된 target으로 판단하고 자동 연습이나 과거 결과 비교에 사용하지 않는다.

---

## 7. 한국어 발표 속도

한국어 발표 속도의 기준값은 CPM이다.

```text
CPM = 1분 동안 말한 공백 제외 글자 수
```

기존 report와의 호환을 위해 WPM도 유지하지만 CPM과 WPM을 임의로 환산하지 않는다.

측정에 필요한 시간 정보가 없으면 `unmeasured` 상태와 이유를 저장하고, 발표 속도는 `null`로 둔다.

```text
measurementState: unmeasured
charactersPerMinute: null
reasonCode: NO_DURATION_EVIDENCE
```

과거 report에 `speechRate`가 없어도 오류로 처리하지 않고 legacy 미측정값으로 본다.

---

## 8. STT 결과 검증

STT provider가 confidence를 제공한 경우에만 confidence와 threshold를 사용한다.

```text
confidence: 0.91
threshold: 0.70
state: accepted
```

provider가 confidence를 제공하지 않으면 confidence와 threshold를 `null`로 두고 `CONFIDENCE_NOT_PROVIDED`를 기록한다.

```text
confidenceCapability: not-provided
confidence: null
threshold: null
reasonCode: CONFIDENCE_NOT_PROVIDED
```

측정하거나 제공받은 값만 평가에 사용한다. 값이 없는 이유는 각 계약의 상태와 reason code로 표시한다.

---

## 9. pause v2

pause v2는 발표자가 멈춘 위치와 분류 결과를 저장한다.

위치는 문장 사이, 문장 중간, 슬라이드 전환, 알 수 없음으로 나눈다. 분류는 다음 값을 사용한다.

- `intentional`: 일부러 멈춤
- `hesitation`: 말이 막힘
- `unknown`: 판단할 근거가 없음

provider가 분류 근거를 제공하지 않으면 `unknown`을 사용한다. pause v1은 유지하고 pause v2를 별도 버전으로 추가한다.

---

## 10. Evidence Clip

Evidence Clip은 사용자가 자신의 문제 구간을 다시 들을 수 있도록 만든 짧은 파생 음성이다.

주요 정책은 다음과 같다.

- 최대 12초
- 생성 후 정확히 7일 보관
- 프로젝트 Owner만 재생 가능
- 재생할 때마다 Owner 권한 재확인
- 전체 raw audio와 별도로 관리
- clip 실패나 만료가 report 실패를 의미하지 않음

report에는 `clipId`와 `observationId`만 저장한다. 다음 정보는 report, Job result 또는 로그에 저장하지 않는다.

- signed URL
- storage key
- `audioFileId`
- transcript 원문
- audio bytes

signed URL은 사용자가 재생을 요청하고 권한 검사를 통과했을 때만 짧은 시간 동안 발급한다.

### 음성 종류 구분

| 종류 | 목적 | 보존 |
| --- | --- | --- |
| raw audio | 전체 리허설 분석 | 분석 후 삭제 |
| Evidence Clip | 사용자의 문제 근거 | 최대 12초, 7일 |
| 모범 발화 audio | 좋은 발화 예시 | Later 범위, 별도 정책 필요 |

---

## 11. TypeScript와 Python의 공통 요청

TypeScript Worker는 Python Worker에 다음 데이터를 보낸다.

```text
runId
projectId
deckId
transcript
durationSeconds
segments
deckKeywords
slideTimeline
```

특히 `deckKeywords[].required`를 양쪽에서 동일하게 사용해야 한다.

허용되지 않은 top-level 또는 nested field가 들어오면 Python은 HTTP 422로 거부한다. 이를 통해 다음 문제를 막는다.

- TypeScript와 Python의 필드 불일치
- provider 원본 데이터 유입
- 민감한 정보 전달
- 잘못된 필드가 조용히 무시되는 문제

---

## 12. Presenter Aid

Presenter Aid는 발표자에게 다음 정보만 보여준다.

- 남은 시간
- 현재 슬라이드 키워드 최대 3개
- 아직 해결하지 못한 문제 최대 1개

전체 발표 script는 포함할 수 없다.

```text
scriptVisible: false
```

Presenter Aid는 발표자가 짧은 단서를 보고 발표를 이어가도록 돕는다. 전체 대본은 표시하지 않는다.

---

## 13. 공통 fixture가 막는 문제

여러 담당자가 각자 enum, DTO, fixture를 만들면 다음 문제가 생길 수 있다.

- TypeScript에는 `required`가 있지만 Python에는 없다.
- Web은 Evidence Clip을 30초로 생각하지만 DB는 12초로 생각한다.
- API는 만료된 clip에 URL을 반환한다.
- 담당자마다 CPM과 WPM의 의미를 다르게 사용한다.
- 근거가 없는 pause를 `hesitation`으로 판단한다.
- report나 로그에 transcript 또는 signed URL이 들어간다.

공통 fixture를 함께 읽으면 이러한 차이를 테스트에서 바로 발견할 수 있다.

---

## 14. PR #306의 범위

### 구현된 내용

- shared schema
- 언어 중립 공통 fixture
- TypeScript schema test
- Python 공통 fixture test
- Worker의 Python 요청 전 schema 검증
- Focus Profile DB migration
- Evidence Clip DB migration
- 계약 문서와 decision log

### 후속 구현이 필요한 내용

- Focus Profile GET/PUT API
- revision 충돌의 HTTP 409 연결
- Focus Profile 입력 UI
- run 시작 시 실제 snapshot 저장
- CPM과 pause v2 실제 분석
- Evidence Clip 생성, 재생, 만료 처리
- Evidence Clip 재생 UI
- Presenter Aid 실제 화면

PR #306은 전체 기능 구현이 아니라 여러 담당자가 사용할 설계도와 안전 경계를 먼저 고정한 PR이다.

---

## 15. 계약 변경 시 지켜야 할 원칙

1. 앱 내부에 같은 enum이나 DTO를 다시 만들지 않는다.
2. shared schema를 먼저 수정한다.
3. fixture와 schema test를 함께 수정한다.
4. Python 요청이 바뀌면 Pydantic model과 Python test도 함께 확인한다.
5. 계약의 의미가 바뀌면 `docs/contracts.md`도 수정한다.
6. 보존 기간이나 접근 권한 변경은 decision log에 기록한다.
7. transcript, script, signed URL 같은 민감한 정보를 report나 로그에 넣지 않는다.

---

## 16. 한 문장 요약

> P0 공통 계약과 fixture는 사람과 AI가 같은 데이터, 측정 기준, 보안 규칙을 사용하도록 만든 공용 설계도다.

## 관련 문서와 코드

- [공식 공통 계약](../contracts.md)
- [의사결정 기록](../decision-log.md)
- [Rehearsal Report 파이프라인](./README.md)
- [P0 공통 fixture](../../packages/shared/src/coaching/p0-core-contract.fixtures.json)
- [P0 fixture schema test](../../packages/shared/src/coaching/p0-core-contract.schema.test.ts)
- [Focus Profile schema](../../packages/shared/src/coaching/rehearsal-focus-profile.schema.ts)
- [Speech Evidence schema](../../packages/shared/src/coaching/speech-evidence.schema.ts)
- [Python 분석 요청 schema](../../packages/shared/src/coaching/rehearsal-analyze.schema.ts)
- [Presenter Aid schema](../../packages/shared/src/coaching/presenter-aid.schema.ts)
