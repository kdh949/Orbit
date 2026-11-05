# Rehearsal Report 파이프라인 전체 가이드

리허설 녹음을 업로드하면 서버가 STT 전사·분석을 실행하고 리포트를 저장한다. 화면은 저장된 결과를 조회해 보여준다.

---

## 목차

1. [핵심 개념 빠르게 잡기](#1-핵심-개념-빠르게-잡기)
2. [전체 파이프라인 흐름](#2-전체-파이프라인-흐름)
3. [RehearsalRun 상태 전이](#3-rehearsalrun-상태-전이)
4. [Worker 처리 순서 상세](#4-worker-처리-순서-상세)
5. [데이터베이스 테이블 구조](#5-데이터베이스-테이블-구조)
6. [각 계층별 책임 정리](#6-각-계층별-책임-정리)
7. [report_json 구조](#7-report_json-구조)
8. [수정할 때 같이 봐야 하는 곳](#8-수정할-때-같이-봐야-하는-곳)
9. [현재 구조의 주요 리스크](#9-현재-구조의-주요-리스크)
10. [코드 읽는 순서](#10-코드-읽는-순서)

---

## 1. 핵심 개념 빠르게 잡기

<a id="live-stt-vs-rehearsal-report-stt--완전히-다른-흐름이다"></a>

### Live STT와 Rehearsal Report STT의 역할

| | Live STT | Rehearsal Report STT |
|---|---|---|
| 실행 시점 | 발표 **중** 실시간 | 녹음 **완료 후** 비동기 |
| 실행 위치 | 브라우저 내부 | 서버 (Python Worker) |
| 목적 | 발표 진행 보조 | 리포트 생성을 위한 전사/분석 |
| Provider | `LIVE_STT_PROVIDER=sherpa` | `REPORT_STT_PROVIDER=openai\|whisperx` |

### 도메인 객체 4개

```
RehearsalRun          ← 리허설 한 번 실행의 단위 (canonical row)
  ├─ Job              ← 비동기 작업 상태 추적 (보조)
  ├─ RehearsalRunMeta ← 프론트가 수집한 보조 메타데이터 (meta_json)
  └─ RehearsalReport  ← 서버 분석 확정 결과 (report_json) ← 공식 SSoT
```

리포트 조회 기준은 `rehearsal_runs.report_json`이다. 성공 Job의 `jobs.result`에도 처리 정보와 리포트 사본을 저장한다.

---

## 2. 전체 파이프라인 흐름

```mermaid
sequenceDiagram
    participant B as 브라우저 (프론트)
    participant A as API 서버
    participant S as Object Storage
    participant Q as Bull Queue
    participant W as Node Worker
    participant P as Python Worker
    participant D as DB (PostgreSQL)

    Note over B: 리허설 시작
    B->>B: getUserMedia() → MediaRecorder 시작
    B->>B: P3 tracking 시작 (slideTimeline, missedKeywords, adviceEvents 수집)

    Note over B,A: 녹음 종료 후 업로드 흐름
    B->>A: POST /api/v1/projects/:projectId/rehearsals
    A->>D: INSERT rehearsal_runs (status=created)
    A-->>B: { runId }

    B->>A: POST /api/v1/rehearsals/:runId/audio/upload-url
    A->>D: UPDATE rehearsal_runs SET status=uploading, audio_file_id=...
    A-->>B: { uploadUrl, fileId }

    B->>S: PUT 오디오 파일 (presigned URL 직접 업로드)

    B->>A: PATCH /api/v1/rehearsals/:runId/meta
    Note right of B: { slideTimeline, missedKeywords, adviceEvents }
    A->>D: UPDATE rehearsal_runs SET meta_json=...

    B->>A: POST /api/v1/rehearsals/:runId/audio/complete
    A->>D: UPDATE rehearsal_runs SET status=processing
    A->>D: INSERT jobs (type=rehearsal-stt, status=queued)
    A->>Q: enqueue { jobId, runId, deckId, audioFileId }
    A-->>B: { jobId }

    B->>A: GET /api/jobs/:jobId (polling)

    Note over Q,P: 비동기 Worker 처리
    Q->>W: processRehearsalSttJob(payload)
    W->>D: UPDATE jobs SET status=running (progress=10)
    W->>D: UPDATE rehearsal_runs SET status=processing

    W->>D: SELECT project_assets WHERE file_id=audioFileId
    W->>D: SELECT decks WHERE deck_id=...
    W->>D: SELECT deck_patches WHERE after_version > checkpoint.version ORDER BY after_version
    Note right of W: checkpoint + patch 순차 적용으로 최신 deck 재구성
    W->>D: SELECT rehearsal_runs.meta_json

    W->>S: getSignedReadUrl(storage_key)

    W->>P: POST /audio/transcribe { runId, audio: { storageUrl, mimeType } }
    P-->>W: { transcript, segments, durationSeconds, language, provider, model }

    W->>P: POST /rehearsal/analyze { transcript, segments, deckKeywords, durationSeconds }
    P-->>W: { wordsPerMinute, fillerWordCount, pauseCount, keywordCoverage, speedSamples, fillerWordDetails, pauseDetails, missedKeywords, coaching }

    W->>S: removeObject(storage_key) (raw audio 삭제)
    W->>D: UPDATE project_assets SET status=deleted
    W->>W: buildRehearsalReport() → Zod schema 검증
    W->>D: UPDATE rehearsal_runs SET status=succeeded, report_json=...
    W->>D: UPDATE jobs SET status=succeeded, result=buildReportGenerationRecord(...)

    Note over B,A: 리포트 조회
    B->>A: GET /api/v1/rehearsals/:runId/report
    A->>D: SELECT rehearsal_runs WHERE run_id=... AND status=succeeded
    A-->>B: RehearsalReport (report_json 내용 그대로)
```

---

## 3. RehearsalRun 상태 전이

```mermaid
stateDiagram-v2
    [*] --> created : POST /rehearsals (run 생성)

    created --> uploading : POST /audio/upload-url (audioFileId 연결)
    uploading --> uploading : PATCH /meta (meta_json 저장)

    uploading --> processing : POST /audio/complete (job enqueue 성공)
    created --> processing : POST /audio/complete (이미 uploading 상태여야 함)

    processing --> succeeded : Worker 완료 - report_json 저장됨
    processing --> failed : Worker 실패 (STT 오류, 분석 오류 등)

    created --> failed : enqueue 실패
    uploading --> failed : enqueue 실패

    succeeded --> [*]
    failed --> [*]
```

**Job 상태는 별도로 추적된다**:

```
queued → running → succeeded
                 → failed
```

Job 상태와 RehearsalRun 상태는 쌍으로 움직이지만, 공식 결과 판정은 `rehearsal_runs.status`를 기준으로 한다.

---

## 4. Worker 처리 순서 상세

`apps/worker/src/rehearsal-stt.processor.ts`의 `processRehearsalSttJob()` 함수가 전체 오케스트레이션을 담당한다.

```mermaid
flowchart TD
    A([Job payload 수신]) --> B{payload schema\n검증}
    B -- 실패 --> B1[failJobOnly\nREHEARSAL_STT_PAYLOAD_INVALID]
    B -- 성공 --> C[jobs.status = running\nprogress = 10]

    C --> D[rehearsal_runs.status = processing]
    D -- run 없음 --> D1[failJobOnly\nREHEARSAL_RUN_UNAVAILABLE]

    D -- 성공 --> E["입력 데이터 로드\n① project_assets 오디오 row\n② deck + patches 재구성\n③ meta_json\n④ Storage signed URL"]
    E -- 실패 --> E5[failJobAndRun\nREHEARSAL_STT_INPUT_UNAVAILABLE]
    E -- 성공 --> F[Python Worker: POST /audio/transcribe]
    F -- 실패/오류 --> F1[raw audio 삭제 후\nfailAfterDelete\nPYTHON_WORKER_STT_FAILED]
    F -- 성공 --> G[Python Worker: POST /rehearsal/analyze]
    G -- 실패/오류 --> G1[raw audio 삭제 후\nfailAfterDelete\nPYTHON_WORKER_ANALYZE_FAILED]

    G -- 성공 --> H[raw audio 삭제\nStorage + project_assets]
    H -- 실패 --> H1[failJobAndRun\nRAW_AUDIO_DELETE_FAILED]

    H -- 성공 --> I[buildRehearsalReport 조립\n+ Zod schema 검증]
    I -- 검증 실패 --> I1[failJobAndRun\nREHEARSAL_REPORT_INVALID\nrawAudioDeletedAt 기록]

    I -- 성공 --> J[rehearsal_runs.status = succeeded\nreport_json 저장]
    J --> K[jobs.status = succeeded\nresult = buildReportGenerationRecord]
    K --> Z([완료])
```

### deck 재구성 로직이 중요한 이유

Worker는 `decks.deck_json`의 checkpoint Deck에 이후 `deck_patches`를 버전순으로 모두 적용해 분석 시점의 최신 Deck을 만든다.

```
decks.deck_json (v5)
  + deck_patches v5→v6
  + deck_patches v6→v7
  = 최신 deck (v7)
```

리포트의 `slideTimings`, `missedKeywords`, `keywordCoverage`는 최신 Deck을 기준으로 계산한다. 중간 patch가 빠져 있으면 Worker에서 오류가 발생해 리포트 생성을 중단한다.

---

## 5. 데이터베이스 테이블 구조

```mermaid
erDiagram
    rehearsal_runs {
        text run_id PK
        text project_id FK
        text deck_id FK
        text audio_file_id FK "→ project_assets.file_id"
        text job_id FK "→ jobs.job_id"
        text status "created|uploading|processing|succeeded|failed"
        jsonb error "{ code, message } | null"
        jsonb report_json "RehearsalReport (공식 SSoT)"
        jsonb meta_json "{ slideTimeline, missedKeywords, adviceEvents }"
        boolean transcript_retained "기본값 false"
        timestamptz raw_audio_deleted_at "삭제 시각 | null"
        timestamptz created_at
        timestamptz updated_at
    }

    jobs {
        text job_id PK
        text project_id FK
        text type "rehearsal-stt"
        text status "queued|running|succeeded|failed"
        int progress "0~100"
        text message
        jsonb payload "{ runId, deckId, audioFileId, ... }"
        jsonb result "buildReportGenerationRecord 결과 (참고용)"
        jsonb error "{ code, message } | null"
        timestamptz created_at
        timestamptz updated_at
    }

    project_assets {
        text file_id PK
        text project_id FK
        text storage_key "Object Storage 경로"
        text mime_type
        text original_name
        text purpose "rehearsal-audio"
        text status "pending|uploaded|deleted"
        timestamptz uploaded_at
        timestamptz deleted_at
    }

    decks {
        text deck_id PK
        text project_id FK
        jsonb deck_json "checkpoint deck"
        int version "checkpoint 버전"
    }

    deck_patches {
        text change_id PK
        text project_id FK
        text deck_id FK
        int before_version
        int after_version
        text source "user|ai|import|system"
        jsonb operations "JSON Patch 연산 배열"
        timestamptz created_at
    }

    rehearsal_runs ||--o| jobs : "job_id"
    rehearsal_runs ||--o| project_assets : "audio_file_id"
    rehearsal_runs }o--|| decks : "deck_id"
    decks ||--o{ deck_patches : "deck_id"
```

### 테이블 역할 한 줄 요약

| 테이블 | 역할 |
|---|---|
| `rehearsal_runs` | 리허설 실행의 canonical row. `report_json`이 공식 리포트 |
| `jobs` | 비동기 작업 상태 추적 (보조) |
| `project_assets` | raw audio 라이프사이클 추적 (업로드 → 삭제) |
| `decks` | 분석 컨텍스트 공급 (checkpoint) |
| `deck_patches` | 분석 시점 최신 deck 재구성을 위한 변경 이력 |

---

## 6. 각 계층별 책임 정리

### 6.1 프론트 (`apps/web/src/features/rehearsal/`)

```
startRecording()
  └─ getUserMedia() + createRecordingSession()
  └─ startP3Tracking(stream)
       └─ slideTimeline 수집 (슬라이드 이동 시각)
       └─ missedKeywords 수집 (Live STT 기반 누락 키워드)
       └─ adviceEvents 수집 (pace-too-fast, slide-overtime 등)

stopRecording() → submitRecording(activeDeck, audioFile)
  └─ runRehearsalUploadFlow()
       1. createRehearsalRun()         → POST /projects/:id/rehearsals
       2. requestAudioUploadUrl()      → POST /rehearsals/:runId/audio/upload-url
       3. uploadRehearsalAudio()       → Storage 직접 PUT
       4. updateRehearsalRunMeta()     → PATCH /rehearsals/:runId/meta
       5. completeRehearsalAudioUpload() → POST /rehearsals/:runId/audio/complete
       6. pollRehearsalJob()           → GET /jobs/:jobId (완료까지 polling)
       7. fetchRehearsalReport()       → GET /rehearsals/:runId/report
```

**주의**: 프론트가 수집한 `meta_json`은 보조 입력이지만, `slideTimings`와 `missedKeywords` UX에 실질적으로 영향을 준다. 프론트 tracking 로직이 바뀌면 서버 리포트 내용도 바뀐다.

### 6.2 API (`apps/api/src/rehearsals/`)

| 엔드포인트 | 역할 |
|---|---|
| `POST /projects/:id/rehearsals` | run 생성 (`status=created`) |
| `POST /rehearsals/:runId/audio/upload-url` | presigned URL 발급, `status=uploading` |
| `PATCH /rehearsals/:runId/meta` | meta_json 저장 (created/uploading 상태만 허용) |
| `POST /rehearsals/:runId/audio/complete` | job 생성 + enqueue, `status=processing` |
| `GET /rehearsals/:runId` | run 상태 조회 |
| `GET /rehearsals/:runId/report` | report 조회 (succeeded + report_json 있을 때만 반환) |

**enqueue 실패 시**: API가 raw audio를 직접 삭제하고 run/job을 실패 처리한다.

### 6.3 Worker (`apps/worker/src/rehearsal-stt.processor.ts`)

- 전체 비동기 처리 오케스트레이션
- 입력 데이터 로드 (오디오, 최신 deck, run meta)
- Python Worker 호출 (전사 → 분석)
- raw audio 삭제 (분석 완료 후 또는 STT/분석 실패 후)
- `buildRehearsalReport()`: 모든 결과 조합 + Zod schema 검증
- DB 상태 업데이트 (raw SQL)

### 6.4 Python Worker (`services/python-worker/app/rehearsal.py`)

| 엔드포인트 | 입력 | 출력 |
|---|---|---|
| `POST /audio/transcribe` | storageUrl, mimeType | transcript, segments, durationSeconds |
| `POST /rehearsal/analyze` | transcript, segments, deckKeywords, durationSeconds | metrics, speedSamples, pauseDetails, coaching |

**coaching 생성**: OpenAI Responses API를 사용해 `summary`, `strengths`, `improvements`, `nextPracticeFocus`를 생성한다. transcript가 비어 있으면 skip/unavailable 처리한다.

---

## 7. report_json 구조

`rehearsal_runs.report_json`에 저장되는 `RehearsalReport`의 주요 필드:

```typescript
{
  reportId: string,           // "report_{runId}"
  runId: string,
  projectId: string,
  deckId: string,
  transcriptRetained: false,  // DB report_json 기준, API 응답에서는 Redis TTL 캐시가 있으면 true
  transcript: null,           // DB에는 저장하지 않고 API 응답에서만 Redis cache 값을 주입

  metrics: {
    durationSeconds: number,
    wordsPerMinute: number,
    fillerWordCount: number,
    pauseCount: number,
    keywordCoverage: number   // 0~1
  },

  speedSamples: [{ startSecond, endSecond, wordsPerMinute }],
  fillerWordDetails: [{ word, count }],
  pauseDetails: [{ startSecond, endSecond, durationSeconds }],

  missedKeywords: [{ slideId, keywordId, text }],
  // Python worker 분석 결과. 중복 제거됨.

  slideTimings: [{ slideId, targetSeconds, actualSeconds }],
  // deck.estimatedSeconds + runMeta.slideTimeline으로 Worker가 계산

  qnaSummary: { questionCount: 0, questionSummary: "", unclearTopics: [] },
  // 현재 기본값 성격이 강함

  coaching: { summary, strengths, improvements, nextPracticeFocus } | null,
  generatedAt: string         // raw audio 삭제 시각
}
```

**`slideTimings` 계산 방식**:

```
runMeta.slideTimeline = [
  { slideId: "s1", enteredAt: "2026-01-01T10:00:00Z" },
  { slideId: "s2", enteredAt: "2026-01-01T10:01:30Z" },   ← s1의 exitedAt
  { slideId: "s3", enteredAt: "2026-01-01T10:03:00Z" }    ← s2의 exitedAt
]

s1 actualSeconds = (s2.enteredAt - s1.enteredAt) / 1000 = 90
s1 targetSeconds = slide.estimatedSeconds
                   ?? (deck.targetDurationMinutes * 60 / slides.length)
```

마지막 슬라이드는 `nextEntry`가 없으므로 `slideTimings`에 포함되지 않는다.

---

## 8. 수정할 때 같이 봐야 하는 곳

### `report_json` shape 변경 (공식 지표 추가/수정)

1. `packages/shared/src/rehearsals/rehearsal.schema.ts` (Zod schema)
2. `services/python-worker/app/rehearsal.py` (분석 로직)
3. `apps/worker/src/rehearsal-stt.processor.ts` (`buildRehearsalReport`)
4. `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx` (렌더링)
5. `docs/contracts.md`

### `meta_json` shape 변경 (수집 메타데이터 변경)

1. `packages/shared/src/rehearsals/rehearsal.schema.ts`
2. `apps/web/src/features/rehearsal/speech/p3RehearsalSession.ts`
3. `apps/web/src/features/rehearsal/speech/rehearsalLogCollector.ts`
4. `apps/api/src/rehearsals/rehearsals.service.ts` (`updateRunMeta`)
5. `apps/worker/src/rehearsal-stt.processor.ts` (`loadRehearsalRunMeta` 이후 계산)

### raw audio 보존 정책 변경

1. `docs/contracts.md`
2. `apps/worker/src/rehearsal-stt.processor.ts` (`deleteRawAudio`, `failAfterDelete`)
3. `apps/api/src/files/files.service.ts`

### API 요청/응답 변경

1. `packages/shared/src/rehearsals/rehearsal.schema.ts`
2. `apps/api/src/rehearsals/rehearsals.service.ts`
3. 프론트 fetch 코드
4. `docs/contracts.md`

---

## 9. 현재 구조의 주요 리스크

| 리스크 | 이유 |
|---|---|
| `report_json` schema 변경 영향이 크다 | Worker가 raw SQL로 직접 저장하므로 컬럼명·shape 변경 시 영향 범위가 넓다 |
| deck patch chain 끊기면 리포트 생성 막힘 | Worker가 순차 적용 중 version 불일치 감지 시 즉시 에러 |
| 프론트 meta 수집 품질이 리포트에 직결 | `slideTimings`, `missedKeywords`는 프론트 tracking 결과에 의존 |
| `qnaSummary`는 아직 기본값 | questionCount, questionSummary, unclearTopics 모두 빈 값 |
| 마지막 슬라이드 timing 미수집 | `buildSlideTimings`에서 nextEntry 없는 마지막 항목은 제외됨 |
| transcript 미보존 | 한번 삭제된 audio와 미저장 transcript는 복구 불가 |

---

## 10. 코드 읽는 순서

### 계약 (shared schema)

```
packages/shared/src/rehearsals/rehearsal.schema.ts   ← 가장 먼저
packages/shared/src/rehearsals/live-stt.schema.ts
packages/shared/src/jobs/job.schema.ts
```

### 프론트

```
apps/web/src/App.tsx                                        ← 라우트 구조
apps/web/src/features/rehearsal/RehearsalWorkspace.tsx      ← 핵심 (큰 파일)
apps/web/src/features/rehearsal/speech/p3RehearsalSession.ts
apps/web/src/features/rehearsal/speech/rehearsalLogCollector.ts
apps/web/src/features/rehearsal/panel/rehearsalTiming.ts
```

### 백엔드

```
apps/api/src/rehearsals/rehearsals.controller.ts     ← 엔드포인트 목록
apps/api/src/rehearsals/rehearsals.service.ts        ← API 로직
apps/api/src/rehearsals/rehearsal-run.entity.ts      ← DB entity
apps/worker/src/rehearsal-stt.processor.ts           ← Worker 핵심 (처음 끝까지 읽기)
services/python-worker/app/rehearsal.py              ← 분석/코칭
```

### DB migration

```
apps/api/src/database/migrations/2026062700200-CreateJobs.ts
apps/api/src/database/migrations/2026062901000-CreateRehearsalRuns.ts
apps/api/src/database/migrations/2026062903000-AddRehearsalReportColumns.ts
apps/api/src/database/migrations/2026070301000-AddRehearsalRunMetaJson.ts
apps/api/src/files/project-asset.entity.ts
```

---

## 관련 문서

- [P0 리허설 코칭 공통 계약 가이드](./p0-core-contract-guide.md) — 공통 fixture와 P0 계약의 의미, 보안 경계, 구현 범위를 쉽게 설명한다.
- `docs/rehearsal/backend.md` — API, Worker, Python Worker 책임 상세
- `docs/rehearsal/frontend.md` — 화면, 라우트, 녹음/업로드/리포트 조회 흐름
- `docs/rehearsal/database.md` — 테이블, 컬럼, 상태 전이, 저장 규칙
- `docs/contracts.md` — 계약 원문
- `docs/conventions/environment.md` — 환경변수 규칙
- `docs/specs/whisperx-report-stt-provider.md` — WhisperX STT provider 스펙
