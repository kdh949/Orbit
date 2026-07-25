# Milestone 3 — 내용 중심 코칭

> 선행 조건: Milestone 2 Gate G2  
> 목표: `어떻게 말했나` 중심의 report를 `무엇을 어떻게 연결해 말했나`까지 확장하고, 문장 위치·Q&A 결과·회차 음성 비교를 같은 coaching read model에 연결한다.

## 1. 범위

포함:

- 논리 점프, 연결 설명 누락, 불필요한 반복, 불명확한 지시 표현 분석
- timestamp 품질이 허용할 때 문장 단위 반복·재시작 feedback
- report에서 Q&A 질문과 답변 평가 결과 확인
- 첫 회차와 최신 회차 audio 비교
- content/Q&A 완료 후 readiness 재평가

제외:

- 외부 자료 사실 검증과 citation 평가
- 임의의 `거짓 주장` 판정
- transcript 또는 답변 원문의 30일 이상 보존
- word-level timestamp가 없는 provider 결과를 문장 단위로 과장하는 UI
- audience API에 content feedback evidence 원문 노출

## 2. 핵심 계약 결정

### 2.1 Qualitative criterion과 observation

기존 coaching contract에 다음 additive union을 추가한다.

```ts
type QualitativeCriterionMeasurement = {
  type: "qualitative-check";
  metric: "content-flow" | "sentence-fluency";
};

type QualitativeObservationValue = {
  kind: "qualitative";
  metric: "content-flow" | "sentence-fluency";
  outcome: "ok" | "issue";
  issueType:
    | "logical-jump"
    | "missing-transition"
    | "redundancy"
    | "unclear-reference"
    | "repetition"
    | "restart";
};

type TranscriptLocatorEvidenceRef = {
  kind: "transcript-locator";
  slideId: string;
  sentenceOrdinal: number | null;
  segmentStartIndex: number;
  segmentEndIndex: number;
  startMs: number;
  endMs: number;
};
```

장기 `CoachingReportView`에는 원문 excerpt를 저장하지 않는다. Web은 transcript가 available인 30일 동안에만 locator와 transcript artifact를 조합해 실제 문장을 표시한다. 만료 후에도 slide, 문장 번호, 시간 범위, 요약, 개선 제안은 남지만 원문과 audio 재생은 사라진다.

### 2.2 Content feedback output

provider output은 최대 20개 issue로 제한한다.

```ts
type ContentFeedbackItem = {
  observationId: string;
  category: "structure" | "delivery";
  issueType: QualitativeObservationValue["issueType"];
  slideId: string;
  sentenceOrdinal: number | null;
  startMs: number;
  endMs: number;
  severity: "high" | "medium" | "low";
  summary: string; // 200자 이하
  suggestion: string; // 240자 이하
  evidenceState: "available" | "locator-only" | "unmeasured";
};
```

`summary`와 `suggestion`은 transcript 인용이 아니라 paraphrase다. provider가 unknown slide, 범위 밖 timestamp, unknown issue type을 반환하면 해당 output 전체를 거부한다.

### 2.3 Q&A projection

Q&A report는 `ChallengeQnaSession`과 succeeded `ChallengeQnaAnswerAttempt`의 bounded 결과만 사용한다.

- question text는 report UI에서 표시할 수 있다.
- concept outcome, clarity, audience fit, assistance level을 표시한다.
- typed answer, voice transcript, raw audio, answer guide 원문은 coaching report에 복사하지 않는다.
- source가 current full run과 일치하는 latest completed final session만 자동 연결한다.

## 3. 선행 위험 검증

문장 단위 feedback은 STT timestamp 품질에 따라 제품 문구가 달라진다. 다음 gate를 먼저 통과하기 전에는 sentence ordinal을 production UI에 노출하지 않는다.

| capability                   | 통과 기준                                          | 실패 시 fallback                        |
| ---------------------------- | -------------------------------------------------- | --------------------------------------- |
| slide mapping                | 합성 fixture 문장의 95% 이상이 올바른 slide에 연결 | slide-level feedback만 제공             |
| sentence ordering            | 문장 순서 90% 이상 일치                            | time range만 표시                       |
| repetition/restart precision | precision 85% 이상                                 | 해당 issue type을 `unmeasured` 처리     |
| timestamp availability       | start/end pair 95% 이상                            | content flow만 제공하고 audio jump 숨김 |

수치는 실제 합성 fixture 결과를 보고 문서에 확정하며 낮추려면 별도 제품 검토가 필요하다.

## 4. 구현 순서

```text
M3.1 provider capability harness
  └─ M3.2 qualitative evidence contract
       ├─ M3.3 content flow analysis
       └─ M3.4 sentence fluency analysis
            └─ M3.5 coaching report·UI projection

M3.6 Q&A projection·readiness refresh

M2 media surface
  └─ M3.7 first/latest audio comparison
```

M3.3과 M3.6은 contract PR이 병합된 뒤 병렬 진행할 수 있다. M3.3과 M3.4는 같은 Python/Worker hot spot을 사용할 가능성이 높으므로 순차 병합한다.

## 5. 작업 목록

### M3.1 — STT 문장 위치 capability harness

**설명:** OpenAI report STT와 WhisperX가 제공하는 segment/word timestamp를 같은 합성 Korean fixture로 비교한다. 빠르게 말하기, 반복, 재시작, 긴 pause, slide transition을 포함한다.

**수용 기준:**

- [ ] provider별 timestamp, sentence boundary, confidence capability를 machine-readable 결과로 남긴다.
- [ ] slide mapping, sentence ordering, repetition/restart precision을 계산한다.
- [ ] capability gate 실패 시 사용할 fallback product copy를 확정한다.

**검증:**

- [ ] 합성 audio/text fixture만 사용하고 실제 사용자 audio를 포함하지 않는다.
- [ ] 동일 fixture 반복 실행에서 허용 오차 안의 결과가 나온다.
- [ ] `docs/spikes`에 provider별 통과/실패와 구현 결정을 기록한다.

**의존성:** G2

**예상 파일:**

- `services/python-worker/tests/fixtures/rehearsal_content/manifest.json`
- `services/python-worker/tests/test_rehearsal_content_alignment.py`
- `services/python-worker/app/audio/transcribe.py`
- `docs/spikes/rehearsal-content-evidence-capability.md`

**예상 규모:** M

### M3.2 — Qualitative evidence shared 계약

**설명:** qualitative criterion, observation value, transcript locator, content feedback item을 strict schema로 추가한다. 기존 observation과 coaching report fixture는 additive default로 계속 읽혀야 한다.

**수용 기준:**

- [ ] locator index/time/sentence ordinal의 nonnegative·ordering 불변식을 검증한다.
- [ ] content issue가 실제 observation과 timeline event를 참조하도록 강제한다.
- [ ] public coaching report schema에 transcript excerpt, answer text, storage reference 필드가 존재하지 않는다.

**검증:**

- [ ] 정상 content/Q&A fixture parse
- [ ] unknown issue, reversed range, missing observation, forbidden raw field negative test
- [ ] `packages/shared` test/build와 `docs/contracts.md` enum 일치 확인

**의존성:** M3.1

**예상 파일:**

- `packages/shared/src/coaching/evaluation-criterion.schema.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.ts`
- `packages/shared/src/coaching/coaching-contract.schema.test.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.test.ts`
- `docs/contracts.md`

**예상 규모:** M

### M3.3 — Content flow 분석

**설명:** transcript segment를 slide timeline에 매핑하고 현재 slide와 앞뒤 slide의 visible text, 작성 대본 sentence index를 제한된 입력으로 Python content analyzer에 전달한다. 논리 점프, 연결 누락, 반복, 불명확한 지시 표현만 분석한다.

**수용 기준:**

- [ ] 분석 결과는 shared content feedback schema와 slide/timestamp 범위를 통과한다.
- [ ] 분석 근거가 부족한 slide는 issue를 추측하지 않고 unmeasured reason을 반환한다.
- [ ] provider 실패는 legacy report와 기존 coaching report를 유지하고 content 부분만 partial로 만든다.

**검증:**

- [ ] 정상 흐름, logical jump, missing transition, redundancy 합성 Python test
- [ ] unknown slide/timestamp/provider extra field rejection Worker test
- [ ] provider request body를 log·Job result·error telemetry에 캡처하지 않는지 확인한다.

**의존성:** M3.2

**예상 파일:**

- `services/python-worker/app/rehearsal_content.py`
- `services/python-worker/tests/test_rehearsal_content.py`
- `services/python-worker/app/main.py`
- `apps/worker/src/rehearsal-content-analysis.processor.ts`
- `apps/worker/src/rehearsal-content-analysis.processor.spec.ts`

**예상 규모:** M

### M3.4 — 문장 반복·재시작 분석

**설명:** M3.1 capability gate를 통과한 provider 결과에 한해 deterministic repetition/restart detector를 실행한다. LLM에게 버벅임 횟수를 추측하게 하지 않는다.

**수용 기준:**

- [ ] 반복 token/phrase와 재시작 boundary를 sentence/time locator로 반환한다.
- [ ] capability가 부족하면 sentence fluency 전체를 unmeasured로 둔다.
- [ ] UI가 `3번 장표 두 번째 문장`을 표시할 때 실제 locator가 존재한다.

**검증:**

- [ ] false positive가 쉬운 정상 강조 반복과 실제 restart fixture 분리
- [ ] provider timestamp 없음, partial timestamp, slide boundary 겹침 test
- [ ] M3.1에 확정한 precision threshold 이상인지 regression test

**의존성:** M3.1, M3.2

**예상 파일:**

- `services/python-worker/app/audio/sentence_fluency.py`
- `services/python-worker/tests/test_sentence_fluency.py`
- `apps/worker/src/rehearsal-content-analysis.processor.ts`
- `apps/worker/src/rehearsal-content-analysis.processor.spec.ts`

**예상 규모:** M

### Checkpoint M3-A — Evidence quality

- [ ] 문장 단위 product copy가 capability gate 결과와 일치한다.
- [ ] LLM이 repetition/restart count를 생성하지 않는다.
- [ ] content output에 raw excerpt가 영속화되지 않는다.
- [ ] 실패한 content 분석이 timing/delivery report를 실패시키지 않는다.

### M3.5 — Content feedback coaching projection과 UI

**설명:** content/sentence analysis output을 `CoachingReportView.observations`, `criterionResults`, `timelineEvents`, `topActions`에 투영하고 active report의 slide detail에 표시한다. transcript가 available이면 locator로 문장을 조합하고 만료 후에는 locator-only copy를 사용한다.

**수용 기준:**

- [ ] slide별 issue가 summary, suggestion, 위치, evidence availability와 함께 표시된다.
- [ ] transcript 만료 전후 같은 observation ID를 유지하고 원문만 제거된다.
- [ ] content high-severity action이 Top 3에 들어가면 practice plan target과 같은 slide를 가리킨다.

**검증:**

- [ ] projection determinism과 stale coaching revision Worker test
- [ ] transcript available/expired, sentence-level/slide-level Web test
- [ ] slide navigator → issue → audio range 이동 Playwright E2E

**의존성:** M3.3, M3.4

**예상 파일:**

- `apps/worker/src/coaching/coaching-report-projection.ts`
- `apps/worker/src/coaching/coaching-report-projection.spec.ts`
- `apps/web/src/features/rehearsal/RehearsalContentFeedback.tsx`
- `apps/web/src/features/rehearsal/RehearsalContentFeedback.test.tsx`
- `apps/web/src/features/rehearsal/RehearsalReportTestView.tsx`

**예상 규모:** M

### M3.6 — Q&A 결과 투영과 readiness refresh

**설명:** latest completed final Q&A session을 source full run에 연결해 `QnaAssessment`와 observations를 생성한다. session 완료 command는 응답을 지연시키지 않고 internal coaching report refresh Job을 enqueue한다.

**수용 기준:**

- [ ] 질문별 concept outcome, clarity, audience fit, assistance level을 report에서 확인한다.
- [ ] source run/project/revision이 다른 Q&A session은 연결하지 않는다.
- [ ] refresh 실패는 Q&A 완료를 되돌리지 않고 coaching report를 stale 상태로 표시한 뒤 재시도한다.

**검증:**

- [ ] no session, incomplete, completed, stale source, multiple completed session projection test
- [ ] answer text/audio/transcript가 coaching report와 Job result에 없는 security test
- [ ] Q&A 완료 → refresh Job → readiness revision 증가 E2E

**의존성:** M3.2, Milestone 2 M2.8

**예상 파일:**

- `packages/shared/src/jobs/job.schema.ts`
- `apps/api/src/challenge-qna/challenge-qna.service.ts`
- `apps/api/src/challenge-qna/challenge-qna.service.spec.ts`
- `apps/worker/src/coaching/coaching-report-refresh.processor.ts`
- `apps/worker/src/coaching/coaching-report-refresh.processor.spec.ts`

**예상 규모:** M

### M3.7 — 첫 회차와 최신 회차 audio 비교

**설명:** 30일 안에 audio가 available인 성공 run 중 earliest와 latest를 선택하고 같은 slide 시작점에서 번갈아 들을 수 있는 A/B surface를 제공한다. 두 player가 동시에 소리 나지 않도록 하나의 playback coordinator를 사용한다.

**수용 기준:**

- [ ] 실제 첫 run audio가 남아 있으면 `첫 회차`, 만료됐으면 `보존 중인 가장 이른 회차`로 표시한다.
- [ ] 동일 slide를 선택하면 두 run의 각 slide timing 시작점으로 이동한다.
- [ ] 한 player 재생 시 다른 player를 정지하고 만료된 URL은 독립적으로 갱신한다.

**검증:**

- [ ] earliest/latest selection과 expired run 제외 pure model test
- [ ] A/B play coordination, slide seek, one-side-expired hook test
- [ ] 두 run의 실제 MinIO audio로 browser E2E

**의존성:** G2

**예상 파일:**

- `apps/web/src/features/rehearsal/rehearsalAudioComparisonModel.ts`
- `apps/web/src/features/rehearsal/rehearsalAudioComparisonModel.test.ts`
- `apps/web/src/features/rehearsal/RehearsalAudioComparison.tsx`
- `apps/web/src/features/rehearsal/RehearsalAudioComparison.test.tsx`
- `apps/web/src/features/rehearsal/reportApi.ts`

**예상 규모:** M

## 6. 마일스톤 종료 게이트 G3

- [ ] content flow issue가 slide와 time evidence를 가진다.
- [ ] sentence-level 문구는 capability gate를 통과한 provider에서만 노출된다.
- [ ] transcript 만료 후 exact sentence와 audio evidence가 사라진다.
- [ ] Q&A 결과가 current source run에만 연결된다.
- [ ] Q&A/content 완료 후 readiness revision이 안전하게 갱신된다.
- [ ] 첫 회차/가장 이른 보존 회차 label이 실제 retention 상태와 일치한다.
- [ ] Python, Worker, API, Web, E2E와 privacy test가 통과한다.

## 7. Rollout

1. M3.1 capability 결과를 먼저 review하고 sentence-level flag 기본값을 off로 둔다.
2. content flow slide-level feedback을 allowlist project에 먼저 노출한다.
3. provider별 quality threshold를 통과한 경우에만 sentence-level flag를 연다.
4. Q&A projection은 기존 completed session을 read-only backfill한 뒤 refresh Job을 활성화한다.
5. audio comparison은 두 audio가 available한 report에서만 lazy load한다.

## 8. Rollback

- content/sentence feature flag를 끄면 기존 coaching report observations를 렌더하지 않는다.
- Q&A refresh Job을 중지해도 기존 Q&A session과 legacy report는 유지한다.
- qualitative shared union은 additive이므로 rollback 시 reader가 unknown 신규 coaching report를 null fallback하도록 한다.
- transcript/audio retention을 늘리거나 삭제된 artifact를 복구하는 rollback은 하지 않는다.
