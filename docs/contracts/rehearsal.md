# Rehearsal 계약

> 인덱스: [ORBIT 공통 계약](../contracts.md)
>
> 런타임 source of truth는 `packages/shared` schema와 서비스 validation이다.

## 리허설 STT/AI provider 구분

리허설에는 서로 다른 두 종류의 음성/AI 처리가 있다. 두 흐름은 provider, latency 요구사항, 데이터 보존 정책이 다르므로 하나의 `STT_PROVIDER`로 표현하지 않는다.

### Live STT

발표/리허설 중 사용자의 발화를 실시간으로 인식해 화면 제어에 사용한다.

- device-local provider env: `LIVE_STT_PROVIDER=sherpa`
- browser engine env: `LIVE_STT_ENGINE=openai-realtime | web-speech`
- 기본 browser engine: `web-speech`
- OpenAI model env: `OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper`
- 실행 위치: web 또는 device-local runtime
- 목적: 애니메이션 cue, 강조 표시, 키워드 누락 체크, 다음 슬라이드 전환 제안/실행
- 입력: 마이크 스트림
- 출력: partial transcript, keyword detection, cue event, slide advance signal
- 원칙: raw audio를 서버 리포트용 storage에 업로드하지 않는다.
- OpenAI Realtime 경로는 raw OpenAI API key를 브라우저에 노출하지 않고, API가 project read 권한을 확인한 뒤 ephemeral client secret만 반환한다.
- API runtime config 경로는 `LIVE_STT_ENGINE`만 노출한다. web은 이 값을 presenter localStorage의 `sttEngine`보다 우선하며, `web-speech`가 미지원이면 OpenAI로 자동 fallback하지 않는다.
- 구현 위치: `packages/shared/src/rehearsals/live-stt.schema.ts`, `packages/shared/src/rehearsals/realtime-transcription.schema.ts`, `apps/api/src/realtime-transcription`, `apps/web/src/features/rehearsal`

Runtime config API:

- `GET /api/v1/runtime-config`
  - 인증: 없음. secret 값을 포함하지 않는 공개 런타임 설정만 반환한다.
  - response: `{ "liveSttEngine": "openai-realtime" }`

OpenAI Realtime client secret API:

- `POST /api/v1/projects/:projectId/realtime-transcription/client-secret`
  - 인증: signed session cookie 필수
  - 권한: `projectId`에 대한 read 권한 필요
  - response: `{ "clientSecret": "ek_...", "expiresAt": 1790000000, "model": "gpt-realtime-whisper", "delay": "minimal" }`
  - 서버 로그에는 OpenAI API key, client secret, raw audio, transcript 원문을 남기지 않는다.

### Report STT/AI

리허설 종료 뒤 녹음 파일을 전사하고 코칭 리포트를 생성한다.

- STT provider env: `REPORT_STT_PROVIDER=openai | whisperx`
- WhisperX env: `WHISPERX_API_URL`, `WHISPERX_API_KEY`, `WHISPERX_MODEL`, `WHISPERX_TIMEOUT_MS`
- rehearsal audio limit env: `REHEARSAL_AUDIO_MAX_BYTES=25000000`
- LLM provider env: `LLM_PROVIDER=openai`
- 실행 위치: API/worker/Python worker
- 목적: 억양, 말 속도, 톤, 발음, 키워드 누락, 청중 반응 등을 종합한 리포트와 코칭 생성
- 입력: `rehearsal-audio` fileId, deck JSON, 키워드, 청중 반응 데이터
- 출력: transcript, metrics, coaching/report result
- 원칙: 업로드 완료 시점부터 raw audio object를 14일 보관한 뒤 삭제하고 삭제 시각을 기록한다. 분석 실패와 Job enqueue 실패는 기존처럼 즉시 삭제를 요청한다.

## 리포트용 리허설 Run 및 STT 계약

리포트용 리허설 녹음은 run 단위로 생성하고, 현재 구현된 upload-url 기반 `rehearsal-audio` 업로드가 완료된 뒤 `rehearsal-stt` Job을 시작한다. 이 계약은 실시간 발표 제어용 Live STT 계약이 아니다.

Run 상태:

- `created`
- `uploading`
- `processing`
- `succeeded`
- `failed`
- `cancelled`

Run 응답 구조:

```json
{
  "runId": "run_1",
  "projectId": "project_demo_1",
  "deckId": "deck_demo_1",
  "audioFileId": "file_audio_1",
  "jobId": "job_1",
  "deckVersion": 7,
  "evaluationSnapshot": {
    "deckId": "deck_demo_1",
    "deckVersion": 7,
    "capturedAt": "2026-07-10T08:00:00.000Z",
    "pronunciationLexicon": {
      "schemaVersion": 1,
      "generatorVersion": "deterministic-v1",
      "deckId": "deck_demo_1",
      "deckVersion": 7,
      "sourceHash": "0123456789abcdef",
      "entries": []
    },
    "slides": []
  },
  "semanticEvaluationMode": "full",
  "status": "processing",
  "error": null,
  "rawAudioDeleteDeadlineAt": "2026-07-11T01:00:00+09:00",
  "rawAudioDeletedAt": null,
  "createdAt": "2026-06-27T01:00:00+09:00",
  "updatedAt": "2026-06-27T01:00:00+09:00"
}
```

API:

- `POST /api/v1/projects/:projectId/rehearsals`
  - request: `{ "deckId": "deck_demo_1", "expectedDeckVersion": 7, "semanticEvaluationMode": "full", "slideSnapshots": [{ "slideId": "slide_1", "fileId": "file_1" }] }`
  - `expectedDeckVersion`은 optional이며 `full` run에서 현재 서버 deck version과 다르면 `REHEARSAL_DECK_VERSION_MISMATCH` 충돌로 거부한다.
  - `semanticEvaluationMode`는 `full | delivery-only`이고 기본값은 `full`이다.
  - `slideSnapshots`는 optional이며 `rehearsal-slide-snapshot` purpose로 업로드 완료된 현재 Deck 이미지의 `slideId/fileId` 매핑만 허용한다. API는 이 매핑을 run의 immutable `evaluationSnapshot.slides[].thumbnailUrl`로 고정한다.
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/cancel`
  - audio processing 시작 전 `created/uploading` run만 `cancelled`로 바꾼다.
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/audio/upload-url`
  - request: `{ "originalName": "rehearsal.webm", "mimeType": "audio/webm", "size": 1048576 }`
  - `size`는 service runtime schema에서 `REPORT_STT_PROVIDER`와 `REHEARSAL_AUDIO_MAX_BYTES` 기준으로 검증한다.
  - response: `{ "run": RehearsalRun, "upload": AssetUploadUrlResponse }`
- `POST /api/v1/rehearsals/:runId/audio/complete`
  - request: `{ "fileId": "file_audio_1", "recordingDurationSeconds": 90.25 }`
  - `recordingDurationSeconds`는 생략하거나 `null`일 수 있고, 값이 있으면 양수 finite number여야 한다.
  - run에 연결된 `fileId`만 허용하고, 업로드 완료 확인 뒤 `rehearsal-stt` Job을 enqueue한다. Web/API producer는 enqueue 전에 `recordingDurationSeconds`를 Run meta에 저장한다.
  - response: `{ "run": RehearsalRun, "job": Job }`
- `GET /api/v1/rehearsals/:runId`
  - response: `{ "run": RehearsalRun }`
- `GET /api/v1/rehearsals/:runId/report`
  - response: `{ "run": RehearsalRun, "report": RehearsalReport | null }`
  - run이 아직 `processing`이거나 과거 run에 `report_json`이 없으면 `report`는 `null`이다.
- `GET /api/v1/projects/:projectId/rehearsal-summary`
  - response: `{ "summary": RehearsalProjectSummary | null }`
  - 성공한 리허설이 없으면 `summary=null`을 반환한다.
  - `runMetricSeries`는 성공 회차별 총 소요시간, 긴 침묵, 핵심 키워드 전달률, 시간 초과 슬라이드 비율과 각 항목의 `measurementState`를 제공한다.
  - `slidePerformanceSummaries`는 최신 성공 회차의 immutable `evaluationSnapshot`을 기준으로 슬라이드 순서·제목·썸네일·권장 시간을 제공하고, 같은 slide ID의 측정 가능한 과거 결과만 평균·비율에 집계한다.
- `POST /api/v1/rehearsals/:runId/audio/clip`
  - request: `{ "startSeconds": 10, "endSeconds": 12.5 }`; 0초보다 길고 최대 60초인 구간만 허용한다.
  - 프로젝트 read 권한, `succeeded` run, 원본 보관기한과 녹음 길이를 확인한다.
  - 최초 요청은 Python worker가 원본을 mono 16kHz PCM WAV로 자르고, 원본과 같은 `rehearsals/{date}/{projectId}/{runId}/` 폴더에 `volume-{startMs}-{endMs}.wav`로 저장한다. 같은 구간의 후속 요청은 저장된 파일을 재사용한다.
  - response는 `audio/wav` binary이며 Web origin의 API proxy를 통해 전달한다. 파생 파일 삭제는 원본 `rawAudioDeleteDeadlineAt`에 맞춰 `storage_deletion_outbox`로 처리한다.
  - 만료·삭제된 원본은 HTTP 410 `REHEARSAL_AUDIO_EXPIRED`, 잘못된 구간은 HTTP 400/422로 응답한다.- `GET /api/v1/rehearsals/:runId/audio/playback-url`
  - 프로젝트 read 권한, `succeeded` run, `rehearsal-audio` purpose, uploaded·미삭제 상태를 확인한다.
  - response: `{ "playbackUrl": "short-lived-signed-url", "expiresAt": "2026-07-11T00:15:00.000Z", "retentionExpiresAt": "2026-07-25T00:00:00.000Z" }`
  - signed URL은 최대 15분이며 `rawAudioDeleteDeadlineAt` 이후까지 유효하게 발급하지 않는다.
  - 처리 중인 run은 HTTP 409 `REHEARSAL_AUDIO_NOT_READY`, 만료·삭제된 음성은 HTTP 410 `REHEARSAL_AUDIO_EXPIRED`로 응답한다.
  - signed URL, storage key, 파일명, 음성 데이터는 DB·리포트·로그에 저장하지 않는다.
- `GET /api/v1/projects/:projectId/rehearsals/:runId/coaching-report`
  - response: `CoachingReportView`
  - 프로젝트 read 권한과 run 소속을 확인한 뒤 여러 담당자의 저장 결과를 재계산하지 않고 조립한다.
  - 일부 결과만 준비됐으면 HTTP 200과 `viewState=partial`을 반환한다. P0 조립 결과가 없는 과거 run은 HTTP 404 `COACHING_REPORT_NOT_FOUND`를 반환하며 Web은 기존 report 응답으로 대체한다.
  - 기존 `GET /api/v1/rehearsals/:runId/report`의 경로와 응답 구조는 변경하지 않는다.
  - 현재 연습 목표는 이 응답에 중복하지 않고 `GET /api/v1/projects/:projectId/practice-plan?sourceFullRunId=:runId`에서 조회한다.
- `GET /api/v1/projects/:projectId/rehearsals/:runId/comparison`
  - 현재 run과 같은 프로젝트의 직전 `succeeded` run을 비교하며, 프로젝트 read 권한과 run 소속을 모두 검증한다.
  - response: `RehearsalRunComparison`
  - 현재 report가 준비되지 않았으면 `REHEARSAL_COMPARISON_NOT_READY`, 현재 report 계약이 유효하지 않으면 `REHEARSAL_COMPARISON_REPORT_INVALID` 충돌을 반환한다.
- `POST /api/v1/rehearsals/:runId/semantic-evaluation/retry`
  - response: `{ "job": Job }`
  - 성공한 `full` run에 retryable semantic report, immutable evaluation snapshot, Redis semantic evidence cache가 모두 있을 때만 `rehearsal-semantic-evaluation` Job을 enqueue한다.
  - cache가 만료됐으면 HTTP 409 `{ "code": "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED", "retryable": false }`를 반환한다.
  - Job payload에는 `jobId`, `projectId`, `runId`만 포함하고 transcript/segment 원문은 넣지 않는다.
- `PATCH /api/v1/rehearsals/:runId/meta`
  - request: `{ "recordingDurationSeconds": 90.25, "slideTimeline": [{ "slideId": "slide_1", "enteredAt": "2026-07-02T00:00:00.000Z" }], "missedKeywords": [{ "slideId": "slide_1", "keywordId": "kw_1" }], "adviceEvents": [{ "type": "pace-too-fast", "at": "2026-07-02T00:00:30.000Z" }] }`
  - 기존 Run meta는 `recordingDurationSeconds=null`로 읽는다. 값이 있으면 양수 finite number만 허용하며 `0`을 자료 없음 sentinel로 사용하지 않는다.
  - transcript, speaker notes, raw audio, script 원문은 받지 않는다.
  - response: `{ "run": RehearsalRun }`

후속 구현 예정 API:

- `POST /api/v1/rehearsals/:runId/audio-begin`
  - request: `{ "codec": "flac", "sampleRate": 16000, "channels": 1, "chunkDurationMs": 30000 }`
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/audio-chunks/:index`
  - params: `index`는 `0`부터 시작하는 정수다. route segment로 들어오는 문자열 숫자는 shared schema에서 정수로 변환한다.
  - body: `audio/flac` chunk binary. 서버는 chunk별 hash 검증과 중복 업로드 멱등 처리를 담당한다.
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/audio-complete`
  - request: `{ "chunkCount": 3, "totalDurationMs": 90000, "totalSizeBytes": 1048576, "sha256": "<64 hex>", "recordingDurationSeconds": 90.25 }`
  - `recordingDurationSeconds`는 legacy upload complete와 같은 nullable 양수 finite number 계약을 사용한다.
  - 청크 수, 전체 길이, runtime 크기 한도, 조립 결과 sha256을 검증한 뒤 `rehearsal-stt` Job을 enqueue한다.
  - response: `{ "run": RehearsalRun, "job": Job }`

Report 응답 구조:

리허설 Report 계약은 `rehearsal_runs.report_json`에 저장되는 서버 생성 결과만 공식 값으로 본다. MVP 단계의 공식 지표는 `metrics`의 원시 측정값과 `coaching` 요약이며, 프론트엔드는 이 계약에 없는 0-100 점수나 상세 평가값을 별도로 계산해 공식 점수처럼 표시하지 않는다.

```json
{
  "reportId": "report_run_1",
  "runId": "run_1",
  "projectId": "project_demo_1",
  "deckId": "deck_demo_1",
  "transcriptRetained": false,
  "transcript": null,
  "volumeAnalysis": {
    "metricDefinitionVersion": 2,
    "measurementState": "measured",
    "reasonCode": null,
    "averageDbfs": -22.4,
    "baselineDbfs": -21.8,
    "variationDb": 8.3,
    "activeRatio": 0.76,
    "issueSegments": [
      {
        "kind": "quiet",
        "startSeconds": 8.1,
        "endSeconds": 10.2,
        "durationSeconds": 2.1,
        "meanDeviationDb": -7.4
      }
    ]
  },
  "silenceAnalysis": {
    "metricDefinitionVersion": 2,
    "measurementState": "measured",
    "reasonCode": null,
    "detector": "silero-vad",
    "detectorVersion": "6.2.1",
    "speechThreshold": 0.5,
    "minimumSilenceMs": 250,
    "longSilenceMs": 5000,
    "analysisWindowStartSeconds": 0.42,
    "analysisWindowEndSeconds": 89.31,
    "totalSilenceSeconds": 6.74,
    "silenceRatio": 0.0758,
    "longSilenceCount": 1,
    "detectedSegmentCount": 3,
    "segmentsTruncated": false,
    "segments": [
      {
        "category": "long",
        "startSeconds": 8.12,
        "endSeconds": 13.46,
        "durationSeconds": 5.34
      }
    ]
  },
  "metrics": {
    "durationSeconds": 90,
    "charactersPerMinute": 318,
    "wordsPerMinute": 120,
    "fillerWordCount": 2,
    "longSilenceCount": 1,
    "keywordCoverage": 0.75,
    "measurements": {
      "duration": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "charactersPerMinute": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "wordsPerMinute": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "fillerWordCount": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "longSilenceCount": {
        "measurementState": "measured",
        "metricDefinitionVersion": 2,
        "reasonCode": null
      },
      "keywordCoverage": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      }
    },
    "sttQualityGate": {
      "version": 1,
      "state": "passed",
      "reasonCode": "CONFIDENCE_ACCEPTED",
      "confidence": 0.91,
      "threshold": 0.8,
      "policyId": "stt_quality_v1"
    },
    "analysisCapabilities": {
      "recordingDuration": { "state": "available", "source": "recording" },
      "providerDuration": { "state": "available", "source": "provider" },
      "segmentTimestamps": { "state": "available", "source": "provider" },
      "sttConfidence": { "state": "available", "source": "provider" },
      "sentenceBoundaries": { "state": "available", "source": "provider" }
    },
    "keywordCoverageMeasurement": {
      "state": "measured"
    }
  },
  "speedSamples": [
    {
      "startSecond": 0,
      "endSecond": 5,
      "wordsPerMinute": 120
    }
  ],
  "fillerWordDetails": [
    {
      "word": "음",
      "count": 2
    }
  ],
  "missedKeywords": [
    {
      "slideId": "slide_1",
      "keywordId": "kw_1",
      "text": "핵심 메시지"
    }
  ],
  "slideTimings": [
    {
      "slideId": "slide_1",
      "targetSeconds": 60,
      "actualSeconds": 52
    }
  ],
  "slideInsights": [
    {
      "slideId": "slide_1",
      "fillerWordCount": 2,
      "longSilenceCount": 1,
      "speakingRate": {
        "metricDefinitionVersion": 1,
        "measurementState": "measured",
        "reasonCode": null,
        "charactersPerSecond": 4.62,
        "baselineCharactersPerSecond": 4.24,
        "relativeRateRatio": 1.0896,
        "paceCategory": "similar",
        "activeSpeechSeconds": 12.4,
        "characterCount": 57
      }
    }
  ],
  "qnaSummary": {
    "questionCount": 0,
    "questionSummary": "",
    "unclearTopics": []
  },
  "semanticEvaluation": {
    "state": "unavailable",
    "measurementMode": "none",
    "reasons": ["evaluation_not_run"],
    "retryable": false
  },
  "semanticCueOutcomes": [],
  "coaching": {
    "status": "succeeded",
    "summary": "핵심 메시지가 분명합니다.",
    "strengths": ["키워드를 언급했습니다."],
    "improvements": ["불필요한 filler를 줄이세요."],
    "nextPracticeFocus": "도입부를 더 짧게 연습하세요.",
    "message": ""
  },
  "generatedAt": "2026-06-27T01:00:10+09:00"
}
```

결정 사항:

- `audio/complete`는 run에 연결된 `fileId`만 허용한다.
- `recordingDurationSeconds`는 Web recorder가 측정한 실제 전체 경과시간의 canonical transport다. legacy upload와 chunk upload 모두 분석 enqueue 전에 같은 값을 Run meta에 저장한다.
- worker는 Run meta의 `recordingDurationSeconds`를 v2 분석 요청에 그대로 전달하며 provider duration으로 덮어쓰지 않는다. 이 runtime 연결은 P1 sender/parser PR에서 구현한다.
- worker는 시작 시 run을 `processing`으로 갱신하고, 성공 시 `succeeded`, 실패 시 `failed`로 갱신한다.
- 업로드 완료 시 `rawAudioDeleteDeadlineAt=완료 시각+14일`을 저장한다. 기존 성공 음성은 migration에서 `project_assets.uploaded_at+14일`로 backfill한다.
- 성공한 raw audio는 deadline까지 보관한다. 30초 deletion reconciler가 만료 대상을 `storage_deletion_outbox`에 멱등 등록하고 기존 삭제 처리를 수행한다.
- STT·지표·리포트 처리 실패와 Job enqueue 실패는 보관 기간을 적용하지 않고 즉시 raw audio 삭제를 요청한다.
- raw audio 삭제 성공은 `rawAudioDeletedAt`과 `project_assets.status=deleted`, `deleted_at`으로 남긴다.
- 삭제 실패는 `RAW_AUDIO_DELETE_FAILED` error로 run/job 양쪽에 남긴다.
- 공식 보고서 원본은 `jobs.result`가 아니라 `rehearsal_runs.report_json`이다.
- `full` run은 생성 시점의 materialized deck으로 owner-only `evaluationSnapshot`을 저장한다. snapshot에는 slide identity/order/title/estimatedSeconds, run-scoped `thumbnailUrl`, keyword 요약, `approved/excluded` Semantic Cue, 그리고 대본에서 추출한 `pronunciationLexicon`만 포함한다. `speakerNotes` 원문, elements, transcript, raw audio는 포함하지 않는다.
- `pronunciationLexicon`은 `schemaVersion=1`, generator/source version, 전체 Deck source hash, canonical entry와 원본 `speakerNotes` UTF-16 occurrence를 가진 immutable run 계약이다. deterministic generator는 원문을 한국어 발음으로 치환하지 않으며 source/alias는 canonical term evidence를 만들기 위한 비교용 값이다.
- live 처리는 전체 사전 중 현재·다음 장표의 active high-confidence entry만 사용한다. Report Worker는 같은 snapshot에서 최대 32개 source/대표 alias를 `pronunciationContext`로 만들며, 지원하는 STT provider에만 prompt 또는 phrase hint로 전달한다. 지원 여부가 확인되지 않은 provider에는 no-op으로 처리한다.
- transcript 원문은 저장·표시·evidence excerpt와 timestamp의 기준으로 유지한다. alias matcher는 별도의 canonical evidence만 생성하며, 동일 alias가 여러 canonical source와 충돌하면 자동 귀속하지 않는다.
- alias evidence는 term/keyword 언급 증거다. 문장 관계, 방향, 부정까지 전달했다는 의미 증거가 아니므로 full Semantic Cue 평가는 alias match가 있어도 semantic grader를 통과해야 한다. grader가 unavailable이면 alias만으로 `covered`를 확정하지 않는다.
- 에디터 썸네일은 현재 Deck JSON을 렌더링한 browser-memory Blob URL이며 Deck patch/version 또는 `project_assets`를 생성하지 않는다. 영속 이미지는 리허설 시작 준비 시에만 `rehearsal-slide-snapshot`으로 업로드하고 리포트는 현재 Deck의 `thumbnailUrl`보다 run snapshot URL을 우선한다.
- `freshness=stale`인 reviewed cue도 snapshot에 유지해 최종 결과를 `unmeasured(stale_cue)`로 설명할 수 있게 한다.
- snapshot은 생성 후 수정하지 않는다. `deckVersion`과 cue `revision`은 해당 run의 immutable 평가 기준이다.
- `delivery-only`와 legacy run은 `deckVersion=null`, `evaluationSnapshot=null`이며 Semantic Cue 최종 평가는 각각 `evaluation_snapshot_mismatch`, `evaluation_not_run`으로 구분한다.
- 기본 run 목록은 `cancelled`를 제외한다. processing이 시작된 run은 cancel할 수 없다.
- `transcript_retained` 기본값은 `false`이며, `false`일 때 `report.transcript`는 반드시 `null`이다.
- `GET /api/v1/rehearsals/:runId/report` 접근은 현재 프로젝트 접근 경계(`ProjectsService.getAccessibleProject`)를 재사용한다.
- ORBIT-37의 고급 0-100 점수 산식은 이 계약에 포함하지 않으며, 실제 산식이 확정되기 전까지 UI에서도 점수를 표시하지 않는다.
- `score`, `deliveryScore`, `speedScore`처럼 산식이 확정되지 않은 점수 필드는 `RehearsalReport`에 저장하지 않는다.
- `/audio/transcribe`는 원본 음성을 한 번만 읽고 PyAV 디코딩도 한 번만 수행한다. 같은 `AudioContent`는 STT에, 같은 mono float32 16kHz `DecodedAudio`는 음량 분석과 Silero VAD 침묵 분석에 전달한다. `/audio/transcribe-private`는 STT 전용 계약을 유지한다.
- `volumeAnalysis`는 현재 녹음 내부의 상대 음량 변화만 나타내며 절대적인 `적정·작음·큼` 판정으로 사용하지 않는다. 신규 `metricDefinitionVersion=2`는 2초 이상 구간만 사용하고, 같은 종류의 1초 이하 간격을 병합한 뒤 `durationSeconds * abs(meanDeviationDb)`가 큰 최대 5개를 시작 시간순으로 저장한다. `metricDefinitionVersion=1`은 과거 리포트 읽기 호환을 유지하며, 음량 분석 실패는 STT를 실패시키지 않고 `unmeasured`와 제한된 `reasonCode`로 기록한다.
- 리포트 음량 카드는 `quiet/loud` 문제 구간의 상대적인 개수·위치·시간만 표시하고 dBFS·RMS 수치를 노출하지 않는다. 사용자가 구간 재생을 요청하면 `POST /api/v1/rehearsals/:runId/audio/clip`이 동일 회차 폴더에 WAV 구간 파일을 생성·재사용하고, Web은 same-origin binary 응답을 Blob URL로 재생한다.
- `silenceAnalysis`는 Silero VAD가 찾은 발화 사이의 비발화 구간만 나타낸다. 앞뒤 무음은 제외하고 250ms 이상을 원천 구간으로 저장하며, 정확히 5초 이상을 `long`으로 분류한다. 의도한 멈춤, 말막힘, 긴장 여부는 추정하지 않는다.
- public report는 `metrics.longSilenceCount`, `silenceAnalysis`, `measurements.longSilenceCount`, `slideInsights[].longSilenceCount`를 사용한다. `pauseCount`, `pauseDetails`, `pauseV2Details`, `measurements.pauseV1`, `measurements.pauseV2`는 신규 계약에 저장하지 않는다.
- legacy report는 읽기 경계에서 과거 pause 필드를 제거하고 `silenceAnalysis=unmeasured/LEGACY_REPORT`, `metrics.longSilenceCount=null`, `measurements.longSilenceCount=unmeasured/LEGACY_MEASUREMENT_STATE_UNKNOWN`으로 정규화한다. 과거 pause 결과는 새 침묵 결과와 비교하거나 PracticeGoal 평가에 사용하지 않는다.
- measurement version은 긴 침묵이 2이고, duration·CPM·WPM·filler·keyword coverage는 1이다. `longSilenceCount`는 `silenceAnalysis.measurementState=measured`인 새 회차에서만 사용한다.
- `sttQualityGate.state=failed`이어도 VAD 침묵 분석은 독립적으로 성공할 수 있다. Gate 실패는 CPM·WPM·filler·keyword coverage와 해당 STT 상세만 차단하며 `silenceAnalysis`와 `longSilenceCount`를 차단하지 않는다.
- 말 속도 변화는 `speedSamples`, 습관어 상세는 `fillerWordDetails`, 비발화 상세는 `silenceAnalysis.segments`, 누락 필수 키워드 상세는 `missedKeywords`를 공식 필드로 사용한다. UI는 `long` 구간만 문제 구간으로 표시하고 `brief`는 원천 통계에만 사용한다.
- 필수 키워드 평가는 Deck의 `slide.keywords[].required=true` 항목만 대상으로 한다. 각 STT segment의 midpoint를 canonical slide timeline에 배정한 뒤 해당 슬라이드 발화에서 키워드 원문·유의어·약어를 NFKC/casefold 정규화해 부분 문자열로 비교한다. 다른 슬라이드에서의 언급은 충족으로 인정하지 않으며, slide timeline 또는 timestamped segment가 없으면 `keywordCoverageMeasurement=unmeasured/transcript-incomplete`로 표시한다.
- 장표별 상대 말하기 속도는 `slideInsights[].speakingRate`를 사용한다. NFKC 정규화 후 Unicode Letter·Number 수를 STT segment timestamp 합집합 시간으로 나누고, segment midpoint가 속한 canonical slide timeline에 배정한다. 같은 장표 재방문은 하나로 합산한다.
- 장표별 속도는 한국어(`ko`, `ko-*`)에서만 측정한다. 유효 발화 5초 이상·20자 이상인 장표가 3개 이상일 때 해당 장표들의 CPM 중앙값 대비 비율을 계산하며 `0.85` 미만은 `slower`, `0.85~1.15`는 `similar`, `1.15` 초과는 `faster`다. 리포트 UI는 장표 CPM과 이번 발표 기준 대비 차이를 표시한다.
- 장표별 속도 측정 불가 reason code는 `UNSUPPORTED_LANGUAGE`, `SEGMENT_TIMESTAMPS_UNAVAILABLE`, `INSUFFICIENT_SLIDE_SPEECH`, `BASELINE_UNAVAILABLE`, `LEGACY_REPORT`로 제한한다. 기존 리포트는 `unmeasured/LEGACY_REPORT`로 정규화하며 회차 비교·PracticeGoal·Top 3 평가에는 사용하지 않는다.
- 슬라이드별 목표/실제 시간은 `slideTimings`를 공식 필드로 사용한다. `targetSeconds`는 deck의 `estimatedSeconds` 또는 `targetDurationMinutes` 기반 목표값이고, `actualSeconds`는 `PATCH /api/v1/rehearsals/:runId/meta`의 `slideTimeline`에서 연속된 slide 진입 시각 차이로 계산한다. 종료 시각이 없는 마지막 slide는 실제 시간을 추정하지 않는다.
- 청중 QnA 기반 피드백은 질문 원문을 저장하지 않고 `qnaSummary.questionCount`, `qnaSummary.questionSummary`, `qnaSummary.unclearTopics[].topic`, optional `slideId`만 report에 저장한다. 현재 audience 질문 저장 API가 없으면 기본값은 질문 수 0과 빈 요약이다.

### 프로젝트 리허설 요약 집계 계약

`RehearsalProjectSummary`는 성공 회차의 공식 `rehearsal_runs.report_json`과 각 run의 immutable `evaluationSnapshot`에서 계산하는 owner-only 파생 응답이며 별도 DB 원본이나 종합 점수로 저장하지 않는다.

- 총 소요시간은 `metrics.measurements.duration.measurementState=measured`인 회차의 `metrics.durationSeconds`만 사용한다. 미측정·유효하지 않은 report는 `0`으로 대체하지 않고 `unmeasured`로 반환한다.
- 긴 침묵은 `silenceAnalysis.measurementState=measured`인 회차의 `longSilenceCount`와 `metricDefinitionVersion`을 사용한다. UI는 서로 다른 버전을 같은 추세로 직접 비교하지 않는다.
- 핵심 키워드 전달률은 각 run의 immutable `evaluationSnapshot.slides[].keywords`를 분모로 사용하고, 같은 `(slideId, keywordId)`가 `report.missedKeywords`에 없으면 전달된 것으로 계산한다. 원문·유의어·약어·발음 보정 별칭의 일치 여부는 report 생성 단계에서 판정하며, 이 지표는 키워드 언급 여부만 나타내고 설명의 의미 정확성은 평가하지 않는다.
- `metrics.measurements.keywordCoverage` 또는 `metrics.keywordCoverageMeasurement`가 미측정이거나 snapshot에 키워드가 없으면 `0%`가 아니라 `unmeasured`와 `KEYWORD_COVERAGE_UNMEASURED | NO_MEASURABLE_KEYWORDS` reason code를 반환한다. 최신 회차는 직전 측정 가능 회차와 개수가 아니라 전달률의 percentage point 차이로 비교한다.
- 슬라이드별 `keywordCoverage`는 같은 slide ID의 측정 가능 성공 회차에서 당시 snapshot 키워드를 누적한다. 직전 두 측정 가능 회차에 같은 `(slideId, keywordId)` 누락이 반복되면 `repeatedMissedKeywordCount`에 기록한다. 최신 snapshot에서 삭제된 슬라이드는 현재 요약에서 제외한다.
- 기존 `coreMessageCoverage`는 호환성을 위해 유지하는 deprecated 필드다. 이는 Semantic Cue의 의미 전달 평가 결과이며 핵심 키워드 전달률로 재해석하거나 UI 지표에 사용하지 않는다.
- 시간 초과 슬라이드는 `targetSeconds > 0`인 `slideTimings` 중 `actualSeconds > targetSeconds * 1.2`인 항목이다. 실제 시간이 없는 마지막 슬라이드와 측정 불가 항목은 분모에서 제외한다.
- 슬라이드별 평균 소요시간은 같은 slide ID의 측정 가능한 `actualSeconds` 산술평균이며 `sampleCount`를 함께 반환한다. 최신 snapshot에 없는 과거 슬라이드는 현재 표에서 제외한다.
- 최신 snapshot이 없는 legacy/delivery-only 회차는 슬라이드 메타데이터의 기준으로 사용하지 않는다. 측정 가능한 report가 없으면 해당 수치는 `N/A`로 표시한다.

### 리허설 회차 비교와 브리핑 계약

`RehearsalRunComparison`은 owner-only report 파생 응답이며 별도 DB 원본으로 저장하지 않는다.

`silenceComparison`은 현재·직전 회차의 `silenceAnalysis`가 모두 `measured`이고 `metricDefinitionVersion`이 같을 때만 `comparable`이다. 이때 `longSilenceCount`와 `totalSilenceSeconds`의 현재값, 이전값, delta를 함께 제공한다. 첫 회차, legacy, 측정 실패, 버전 불일치는 `unavailable`과 reason code로 반환하며 과거 pause 결과를 대신 사용하지 않는다.

```json
{
  "currentRunId": "run_2",
  "previousRunId": "run_1",
  "improved": [],
  "repeated": [],
  "newIssues": [],
  "incomparable": [],
  "briefing": []
}
```

각 배열 항목은 `{ category, slideId, cueId?, cueRevision?, label, severity, reason }` 구조다. `category`는 `semantic-cue | timing | delivery`, `severity`는 `high | medium | low`이며 `briefing`은 최대 3개다.

- Semantic Cue는 동일한 `cueId + cueRevision`일 때만 직접 비교한다. revision이 다르거나 어느 회차라도 `unmeasured | excluded`이면 `incomparable`로 분류하고 부정적 결과나 브리핑 우선순위에 포함하지 않는다.
- 직전 `missed | partial`이 현재 `covered`이면 `improved`, 두 회차 모두 `missed | partial`인 core Cue이면 `repeated`, 현재 이슈 중 반복 core가 아닌 항목은 `newIssues`다.
- 첫 성공 run은 `previousRunId=null`이며 현재 측정 이슈를 `newIssues`, 측정 불가 항목을 `incomparable`로 설명한다.
- 브리핑 우선순위는 반복 core 의미 누락, 현재 core 의미 누락, 반복 시간 초과, 반복 전달 이슈 순서이며 최대 3개만 제공한다.
- 응답에는 transcript, Semantic Cue evidence excerpt, speaker notes, raw audio, presenter script를 포함하지 않는다. 서버 로그와 audience channel에도 비교/브리핑 내용을 전송하지 않는다.
- 슬라이드 진입 알림은 `repeated`의 high-severity `semantic-cue`만 대상으로 하며 한 리허설 세션에서 항목별 한 번만 표시하고 사용자가 닫을 수 있다.

### Semantic Cue 측정·fallback 계약

live `semanticCueDecisions`는 provisional/debug 호환 필드이며 canonical report 결과는 `semanticCueOutcomes`다. legacy decision은 `matchedBy=nli`, `measurementMode=full`, `fallbackUsed=false`로 정규화하고 기존 required `provider`는 optional로 완화한다.

- capability: `stt | semantic_runtime | embedding | nli | server_evaluation | cue_freshness | transcript_evidence`
- capability state: `available | degraded | unavailable`
- measurement mode: `full | basic | none`
- decision match: `lexical | alias | embedding | nli`
- outcome match: decision match 값과 `post_run_semantic`
- outcome status: `covered | partial | missed | unmeasured | excluded`
- fallback reason: `user_disabled | permission_denied | stt_unavailable | network_error | provider_unavailable | model_not_ready | model_load_failed | timeout | runtime_error | server_evaluation_failed | stale_cue | transcript_incomplete | no_transcript | insufficient_evidence | slide_not_visited | evaluation_not_run | evaluation_snapshot_mismatch | queue_dropped | needs_confirmation`

`semanticCapabilityEvents`는 owner-only run meta에 최대 100개를 저장한다. event의 `cueIds`는 중복 제거 후 최대 50개이며 transcript, speaker notes, premise 원문을 넣지 않는다. `degraded/unavailable` event는 `reason`이 필수고 `available` 복구 event는 `fromState`와 `at`이 필수다.

`semanticCueOutcomes`는 cue마다 `cueRevision`, meaning/report label snapshot, importance, measurement 상태, fallback 상태, covered/missing concept를 저장한다. evidence는 정규화된 300자 이하 excerpt 하나와 `startMs/endMs`만 허용한다.

- `unmeasured`는 `measurementMode=none`과 `unmeasuredReason`이 필수다.
- `excluded`는 `measurementMode=none`이며 evidence를 가질 수 없다.
- `missed`는 정상 full 평가가 완료된 경우에만 허용한다.
- `fallbackUsed=true`이면 `fallbackReason`이 필수다.
- `basic` mode는 positive evidence가 있는 `covered/partial`만 허용하며 absence를 `missed`로 바꾸지 않는다.
- legacy report는 `semanticEvaluation=unavailable/none/evaluation_not_run`, `semanticCueOutcomes=[]`, `keywordCoverageMeasurement.state=measured`로 parse한다.
- 새 report의 keyword 분모가 0이면 숫자 `keywordCoverage=0`은 계산 placeholder로만 두고 `keywordCoverageMeasurement={ state: "unmeasured", reason: "no-keywords" }`를 저장한다. UI는 숫자 대신 `N/A`를 표시한다.
- timestamped transcript segment는 DB나 Job payload에 저장하지 않고 `rehearsal:semantic-evidence:<runId>` Redis key에 최대 30분만 보존한다. cache key와 server log에는 segment text를 넣지 않는다.
- semantic retry worker는 cache와 run snapshot으로 Python semantic endpoint만 다시 호출하며 `report_json.semanticEvaluation`과 `report_json.semanticCueOutcomes`만 멱등 교체한다. 기존 metrics, coaching, delivery 분석, generatedAt은 변경하지 않는다.
- retry가 다시 실패하거나 partial/unavailable이면 기존 report를 유지하고 Job을 실패 처리하며 `rehearsal.semantic_evaluation.retry_failed`에 ID와 reason만 기록한다.

구현 위치:

- `packages/shared/src/rehearsals/live-stt.schema.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.ts`
- `apps/api/src/rehearsals`
- `apps/worker/src/rehearsal-stt.processor.ts`

## Adaptive Rehearsal Coach Milestone 1 계약

상세 제품·DB·API·Job·Web 수용 기준은
[`docs/product/adaptive-rehearsal-coach-direction.md`](product/adaptive-rehearsal-coach-direction.md)의
19~31장을 따른다. 런타임 계약의 원본은 `packages/shared/src/coaching`이다.

### Aggregate와 snapshot 경계

- `RehearsalRun`, `FocusedPracticeSession`, `ChallengeQnaSession`은 서로 다른 aggregate다.
- 부분 연습 결과는 full-run comparison, trend, North Star 또는 `PracticeGoalResolution`을 만들지 않는다.
- `PracticeGoalSet`과 Question revision은 immutable이며 retry는 새 revision을 발행한다.
- `FocusedPracticeSession.snapshot.goalSetRef`는 세션 생성 당시 `PracticeGoalSet`의 `goalSetId`와 revision을 고정하며, 최상위 `sourceGoalSetId`와 같은 ID여야 한다.
- full run은 `deckContentHash`, Brief/Lens, criterion revision, metric definition version, approved reference hash를 evaluation snapshot에 고정한다.
- resolution과 comparison은 deck/Brief/Lens/criterion/scope가 호환되는 full run에서만 수행한다.

### Shared coaching schema

- `presentation-brief.schema.ts`: Brief CAS, requirement server revision, approved reference hash.
- `evaluator-lens.schema.ts`: revision 1 Lens registry와 immutable evaluation plan.
- `evaluation-criterion.schema.ts`: structure/semantic/timing/delivery criterion과 measurement.
- `practice-goal.schema.ts`: deterministic Top 3, immutable set, bounded resolution, practice plan.
- `focused-practice.schema.ts`: single target scope session, repeat attempt, timeline, bounded outcome.
- `challenge-qna.schema.ts`: checkpoint 1/final 3, frozen source/grounding, Question/AnswerGuide, bounded answer result.
- `private-audio-cleanup.schema.ts`: identifier-only Job payload/result와 idempotent cleanup.

모든 새 object schema는 `.strict()`이며 `packages/shared/src/index.ts`에서 export한다.

### C0 병렬 개발 공통 계약

C0는 목표 설정·evidence·집중 연습·추세·프롬프터·Q&A 구현이 같은 평가 결과를
공유하도록 만드는 additive read contract다. 기존 `RehearsalReport`,
`PracticeGoalResolution`, `FocusedPracticeAttempt` 저장 계약을 교체하지 않으며,
DB migration이나 API route를 추가하지 않는다. 후속 구현은 기존 aggregate의 bounded
결과를 아래 계약으로 조합한다.

| 계약                          | 소유 schema                      | 역할                                                                                     |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `CriterionResult`             | `evaluation-criterion.schema.ts` | criterion별 측정 가능 여부와 평가 결과를 분리해 표현한다.                                |
| `ReportObservation`           | `evaluation-criterion.schema.ts` | 수치·semantic 결과와 bounded ID/time-range evidence 참조를 표현한다.                     |
| `CoachingAction`              | `practice-goal.schema.ts`        | UI가 임의 URL을 만들지 않도록 실행 대상을 typed target으로 표현한다.                     |
| `PracticeVerificationSummary` | `focused-practice.schema.ts`     | 다음 full run에서 목표가 해결·반복·미측정·비교 불가인지 요약한다.                        |
| `TrendSeries`                 | `rehearsal.schema.ts`            | 최근 최대 5개 full run의 측정값과 비교 가능 여부를 표현한다.                             |
| `CoachingReportView`          | `rehearsal.schema.ts`            | criterion, observation, Top 3 action, verification, trend를 묶는 bounded read model이다. |

#### 상태 축

- `measurementState`는 데이터가 실제로 측정됐는지만 나타내며 `measured`, `unmeasured`만 허용한다.
- `evaluationStatus`는 criterion 평가 결과이며 `passed`, `partial`, `failed`, `not-evaluated`만 허용한다.
- `measurementState=measured`이면 `evaluationStatus`는 `not-evaluated`일 수 없고 `observationId`가 필요하다.
- `measurementState=unmeasured`이면 `evaluationStatus=not-evaluated`, `observationId=null`이어야 한다.
- `evaluationStatus`와 `reasonCode`는 고정 행렬을 사용한다. `passed=PASSED`, `partial=PARTIAL`, `failed=THRESHOLD_EXCEEDED|CONCEPT_MISSED`, `not-evaluated=NO_MEASUREMENT|NOT_APPLICABLE|SOURCE_INCOMPARABLE|EVALUATION_UNAVAILABLE`만 허용한다.
- `resolutionStatus`는 목표의 full-run 검증 결과인 `resolved`, `repeated`, `unmeasured`, `incomparable`이다.
- `verificationStatus`는 검증 summary의 UI 상태인 `verified`, `needs-follow-up`, `incomplete`, `incomparable`이다.
- `comparability`는 회차 간 비교 가능 여부인 `comparable`, `incomparable`이며 `measurementState`와 별도 축이다.
- `unmeasured` 또는 `incomparable` trend point는 bounded `reasonCode`를 반드시 제공한다.

#### `CriterionResult`와 `ReportObservation`

- `CriterionResult`는 `criterionRef`, category, scope, `measurementState`, `evaluationStatus`, `observationId`, `reasonCode`, `evaluatedAt`을 가진다.
- `ReportObservation`은 `observationId`, `criterionRef`, scope, `measurementState`, value, `evidenceRefs`, `observedAt`을 가진다.
- observation value는 duration seconds, filler/pause count, words per minute, bounded rate, semantic outcome, none만 허용한다.
- rate metric은 keyword/semantic coverage, timing balance, volume consistency, pronunciation confidence만 허용하고 값은 0~1이다.
- evidence ref는 `time-range`, `semantic-cue`, `issue`만 허용한다. time range는 `startMs <= endMs`여야 한다.
- 측정된 observation은 `none`을 사용할 수 없고 미측정 observation은 반드시 `none`을 사용한다.
- `CriterionResult.observationId`가 가리키는 observation은 같은 `criterionRef`와 scope를 가져야 한다.
- Focused Practice와 Q&A의 저장 aggregate 결과는 별도 형태를 유지할 수 있지만, 공통 리포트로 조합할 때는 같은 `CriterionResult`와 `ReportObservation` 계약으로 정규화한다.

#### `CoachingAction`

- action은 우선순위 1~3, `criterionRef`, bounded `observationIds`, 짧은 label/detail, audience impact, instruction, success condition, availability와 typed target을 가진다.
- target은 `focused-practice`, `full-rehearsal`, `report-evidence`, `deck-edit`, `challenge-qna`만 허용한다.
- action 계약에 `href`를 넣지 않는다. Web은 target ID로 route를 생성하고 API는 target ID로 권한을 다시 확인한다.
- `availability=available`이면 `unavailableReason=null`이고, `unavailable`이면 bounded reason이 필요하다.

#### `PracticeVerificationSummary`

- summary는 source goal set과 이를 검증한 full run을 명시하고 목표별 `CriterionResult`를 포함한다.
- item은 별도 `measurementState`를 복제하지 않고 내장 `CriterionResult.measurementState`를 단일 원본으로 사용한다.
- item은 비교 결과의 `resolutionReasonCode`를 별도로 가진다. `resolved=PASSED+measured/passed`, `repeated=FAILED+measured/partial|failed`, `unmeasured=NO_MEASUREMENT+unmeasured` 조합만 허용하며 `incomparable`은 bounded compatibility reason을 사용한다.
- counts는 items의 resolution status별 실제 개수와 일치해야 하며 같은 `goalId`를 중복할 수 없다.
- `verificationStatus`는 item counts에서 파생한다. repeated가 있으면 `needs-follow-up`, 그다음 unmeasured가 있으면 `incomplete`, 그다음 incomparable이 있으면 `incomparable`, 모두 resolved이면 `verified`다.
- summary의 next action은 summary와 같은 `projectId`를 사용한다.
- 부분 연습 attempt만으로 summary를 만들지 않는다. `evaluatedFullRunId`의 full run에서만 발행한다.

#### `TrendSeries`

- metric은 filler count, duration seconds, characters per minute, words per minute, timing balance, semantic coverage, volume consistency, pronunciation confidence를 허용한다.
- 모든 series는 양의 `metricDefinitionVersion`을 가진다.
- metric별 단위와 방향은 고정한다. filler는 `count/lower-is-better`, duration과 WPM은 각 단위의 `target-range`, CPM은 `characters-per-minute/neutral`, 나머지 ratio metric은 `ratio/higher-is-better`다.
- `target-range` metric은 `{ minimum, maximum }`을 필수로 가지며 다른 metric은 target range를 갖지 않는다.
- CPM trend는 `targetRange=null`인 설명형 series이며 WPM과 같은 series에 섞거나 pass/fail·적정 범위를 파생하지 않는다.
- point는 `runId`, `createdAt`, `measurementState`, `comparability`, nullable value, nullable `reasonCode`를 가진다.
- measured point만 numeric value를 가질 수 있다. unmeasured point의 value는 `null`이다.
- 한 series 안에서 `runId`는 중복될 수 없으며 최근 최대 5개 point만 포함한다.

#### `CoachingReportView`

- view는 readiness, `criterionResults`, `observations`, `topActions`, nullable `practiceVerification`, `trendSeries`, timeline events, nullable Q&A assessment, next practice plan을 조합한다.
- Top action은 최대 3개, criterion result는 최대 100개, observation은 최대 500개, trend series는 최대 7개다.
- measured criterion result의 `observationId`는 같은 view의 observations에 반드시 존재하고 같은 criterion/scope를 사용해야 한다.
- Top action은 하나 이상의 observation을 참조하고 action의 `criterionRef`와 observation criterion이 일치해야 한다.
- timeline event는 같은 view의 observation을 참조하며 Q&A assessment는 같은 project/source full run에 속한다.
- action, verification, trend는 view와 같은 `projectId`에 속해야 하고 verification은 같은 `runId`를 평가해야 한다.
- 이 view는 server-generated bounded read model이며 프론트엔드가 공식 평가 상태나 추세를 재계산하지 않는다.

#### Privacy와 확장 규칙

- 여섯 계약에는 transcript 원문, typed answer 원문, speaker notes, script, raw audio, audio bytes/URL/key, `audioFileId`를 넣지 않는다.
- evidence 재생이 필요한 후속 구현은 `ReportObservation.evidenceRefs`의 bounded ID/time range로 owner-only evidence API를 조회한다.
- provider raw response나 자유 형식 `unknown` payload를 계약에 추가하지 않는다.
- 네 병렬 스트림은 C0 schema를 import해 사용하고 같은 enum이나 결과 shape를 각 앱에 다시 정의하지 않는다.
- 새 metric, action target, reason code가 필요하면 shared schema test와 이 문서를 같은 PR에서 먼저 변경한다.
- 기존 필드의 의미·타입을 바꾸거나 제거하지 않고 additive enum/variant 확장으로 호환성을 유지한다.

### Privacy와 public boundary

- `rehearsal-audio`, `focused-practice-audio`, `slide-practice-audio`, `qna-answer-audio`는 private purpose다.
- generic file upload/list/get/content는 private purpose를 생성하거나 반환하지 않는다.
- `focused-practice-analysis`, `slide-practice-analysis`, `challenge-qna-generation`, `challenge-qna-answer-analysis`, `private-audio-cleanup`은 internal Job type이다.
- public `POST /jobs`는 `publicCreatableJobTypeSchema`만 받으며 internal coaching Job과 historical-only `pptx-import`, `ai-template-deck-generation`을 거부한다.
- Job payload/result에는 canonical ID와 bounded result만 넣고 audio key/URL/bytes, transcript, typed answer, Question/AnswerGuide 원문, reference chunk 원문, speaker notes, provider raw error를 넣지 않는다.
- Worker는 Job 완료 결과를 generic `z.record(z.unknown())`에 직접 저장하지 않고 해당 Job type의 shared result schema로 검증한 값만 저장한다.
- Question과 AnswerGuide 원문은 project-private canonical table에만 저장한다.
- transcript와 typed answer는 non-persistent private-evidence Redis에서 최대 30분만 보존한다.
- raw audio cleanup 실패는 분석 결과를 실패로 되돌리지 않고 최대 5회 idempotent retry 후 exhausted를 관측한다.

### 권한과 상태

- owner/editor만 Brief·Focused·Q&A command를 실행한다.
- viewer는 bounded project result만 읽을 수 있다.
- audience와 non-member는 coaching resource에 접근할 수 없다.
- project 삭제는 Brief, Goal, Resolution, Focused, Q&A child row를 cascade delete한다.
- Focused session은 사용자의 explicit `complete` command로만 완료한다.
- checkpoint Q&A는 정확히 1문항, final Q&A는 정확히 3문항이다.
- 첫 succeeded answer 전에는 full AnswerGuide를 응답하지 않는다.

### Migration 기준

- Migration A `CreateAdaptiveCoachingCore`는 `cancelled` run CHECK, analysis revision, asset content hash, durable Job dispatch, Brief/Goal/Resolution/outbox를 추가한다.
- Migration B `CreateFocusedPractice`는 single-scope session/attempt와 non-terminal partial unique를 추가한다.
- Migration C `CreateChallengeQna`는 session/question revision/progress/answer attempt와 tenant-safe composite FK를 추가한다.
- 세 migration은 각각 `down()`을 제공하고 A/B/C up → C/B/A down → A/B/C up으로 검증한다.

### P0 병렬 구현 선행 계약

P0 담당자는 아래 계약과 `p0-core-contract.fixtures.json`을 단일 원본으로 사용한다.
앱별 enum, DTO, fixture를 별도로 만들기 전에 shared schema를 import한다.

#### RehearsalFocusProfile과 snapshot

- `RehearsalFocusProfile`은 `PresentationBrief`와 분리된 project-level aggregate다.
- `PUT /api/v1/projects/:projectId/rehearsal-focus-profile` 요청은 `expectedRevision`을 사용한다. 최초 생성은 `0`, 이후 수정은 현재 양의 revision을 보낸다.
- CAS 충돌 응답은 `REHEARSAL_FOCUS_PROFILE_REVISION_CONFLICT`, 요청 revision, 현재 revision, 현재 profile을 반환한다. 앱별 임의 충돌 payload를 만들지 않는다.
- focus item은 최대 3개이며 priority는 1부터 연속돼야 한다. `targetScope=null`은 전체 run 목표다.
- run 시작 시 `profileId`, revision, focus item 값을 `evaluationSnapshot.focusProfileSnapshot`에 함께 동결한다. mutable profile을 나중에 다시 읽어 과거 run을 재평가하지 않는다.
- `rehearsal_focus_profiles`는 프로젝트 삭제 시 cascade 삭제한다.

#### 문장 Target

- Focused Practice target은 기존 `slide`, `slide-range`, `opening`, `closing`에 additive `sentence`를 허용한다.
- sentence target은 `scopeId`, `slideId`, 0부터 시작하는 `sentenceIndex`, SHA-256 `textSnapshotHash`를 가진다.
- sentence 분리는 `speakerNotes`를 NFC로 정규화한 뒤 명시적 줄 또는 `.`, `!`, `?`, `。`, `！`, `？`, `…` 경계 순서로 계산한다. 소수점의 `.`은 경계에서 제외한다.
- `textSnapshotHash` 입력은 선택된 문장의 NFC 문자열에서 연속 공백을 한 칸으로 줄이고 앞뒤 공백과 끝 문장부호를 제거한 UTF-8 문자열이다.
- 현재 문장 hash가 snapshot과 다르면 stale이며 자동 실행하거나 과거 결과와 비교하지 않는다.
- `slide-range`는 source evaluation snapshot의 deck order에서 연속된 2~3장이어야 하며 attempt timeline은 같은 slide ID 순서를 정확히 따라야 한다. `opening`, `closing` timeline은 빈 배열이다.
- 30~60초는 권장 연습 길이이고 기존 Focused Practice 5분은 hard maximum이다.
- 권장 연습 시간은 정수 초로 올림한 뒤 30~60초로 제한한다. `sentence`는 NFC 정규화 후 공백·문장부호를 제외한 글자 수를 초당 4자로 계산한다.
- `slide`, `slide-range`, `opening`, `closing`은 장표별 `targetSpokenSeconds`, `targetSeconds`, `estimatedSeconds`, `targetSecondsPerSlide` 순서로 기존 시간 데이터를 사용한다. 시간 데이터가 없으면 같은 방식으로 센 대본 글자 수를 초당 3.5자로 계산한다.
- `slide-range`는 범위 내 장표 시간을 합산하며, `opening`과 `closing`은 각각 Deck 순서의 첫 장표와 마지막 장표를 사용한다. 이 권장 시간은 Criterion threshold와 `successCondition`을 변경하지 않는다.

#### CPM, STT Quality Gate, pause v2

- 한국어 말하기 속도의 canonical 지표는 `characters-per-minute` v1이다. 공백을 제외한 글자 수를 실제 전체 녹음 시간으로 나누고, 전체 시간이 없을 때만 유효 segment 시작~종료 범위를 사용한다.
- `wordsPerMinute`는 기존 report 호환값이며 CPM과 서로 환산하지 않는다. `speechRate`가 없는 과거 report는 legacy CPM 미측정으로 취급하고, 새 분석에서 근거가 없을 때는 bounded reason code를 사용한다.
- STT provider가 confidence를 제공할 때만 normalized confidence를 전달한다. 제공하지 않으면 `sttQualityGate`는 `unavailable/CONFIDENCE_NOT_PROVIDED`이며, text·timestamp·duration 근거가 있는 지표 계산은 계속한다.
- normalized confidence는 승인된 `normalizationProfileId`가 있을 때만 허용한다. 현재 승인 profile registry는 비어 있으며 임의 평균·변환값이나 공통 threshold를 만들지 않는다.
- pause v2는 v1을 교체하지 않는다. `metricDefinitionVersion=2`로 위치와 분류 capability를 기록하며 provider 근거가 없으면 classification은 반드시 `unknown`이다.
- CPM·WPM·pause v1·pause v2는 metric definition version이 다르면 같은 trend로 비교하지 않는다.

#### Rehearsal analysis DTO v2

- `POST /rehearsal/analyze`의 canonical request와 response는 숫자 literal `contractVersion: 2`를 사용한다.
- request는 `language`, `provider`, `model`, `sttConfidence`, `recordingDurationSeconds`, `providerDurationSeconds`를 분리한다. 두 duration은 `null` 또는 양수 finite number이며 `0`을 자료 없음 sentinel로 사용하지 않는다.
- request의 optional `pronunciationContext`는 최대 32개 `{ source, aliases }` term이며 alias는 term당 최대 8개다. 이는 immutable run snapshot에서 생성한 STT/keyword 보조 컨텍스트이고 transcript를 canonical source로 치환하는 계약이 아니다.
- request의 `sttConfidence`와 segment confidence는 `value`, `source`, `normalizationProfileId`를 가진 normalized 값이다. 승인되지 않은 profile은 거부하고 confidence object 전체를 `null`로 보내야 한다.
- segment의 `startSeconds`와 `endSeconds`는 둘 다 `null`이거나 둘 다 finite number여야 한다. timed segment와 `slideTimeline`은 시간 비감소 순서이며 연속 중복 slide entry는 sender가 제거한다.
- response는 nullable metric value와 `measurements`를 함께 보낸다. `measured`는 non-null value와 `reasonCode=null`, `unmeasured`는 null value와 bounded reason code를 요구한다.
- response의 `durationSource`는 `recording`, `provider`, `segment-window`, `null` 중 하나이며 `durationSeconds`와 함께 존재하거나 함께 `null`이다.
- `sttQualityGate`는 `passed/CONFIDENCE_ACCEPTED`, `failed/LOW_TRANSCRIPTION_CONFIDENCE`, `unavailable/CONFIDENCE_NOT_PROVIDED|QUALITY_POLICY_NOT_CONFIGURED`만 허용한다. `failed`이면 STT 의존 지표는 모두 `unmeasured/LOW_TRANSCRIPTION_CONFIDENCE`이고 detail 결과는 비어 있다.
- response는 `capabilities`, filler occurrence, pause v1, pause v2를 strict nested object로 제공한다. filler 합계, pause v1 개수, detail 시간 순서와 duration 차이를 schema에서 검증한다.
- request/response의 root와 모든 nested object는 알 수 없는 field를 거부한다. ID는 trim 후 1~128자이며 모든 숫자는 finite여야 한다.
- 신규 공통 fixture는 `rehearsalAnalyzeRequest`와 `rehearsalAnalyzeResponse` v2다. `rehearsalAnalyzeRequestV1`은 배포 전환 중인 Python v1 reader 회귀 검증만 위한 합성 compatibility fixture다.
- 신규 sender/parser는 `rehearsalAnalyzeRequestV2Schema`, `rehearsalAnalyzeResponseV2Schema`를 직접 사용한다. 기존 `rehearsalAnalyzeRequestSchema`의 v1/v2 dual-read는 retry Job drain과 Python cutover 뒤 제거한다.

#### Evidence Clip과 Presenter Aid

- Evidence Clip은 raw audio 원본이 아니라 분석 완료 직전에 파생하는 별도 문제 구간 최대 12초 음성 계약이다. 리포트의 음량 구간 재생 파일은 Evidence Clip 계약과 분리되며, 사용자 요청 시 동일 회차 MinIO 폴더에 최대 60초 WAV로 생성하고 원본 보관 만료 시 함께 삭제한다.
- clip은 `retentionPolicyVersion=1`, `retentionDays=7`을 저장하고 생성 후 정확히 7일에 만료한다. P0에서는 연장하지 않는다. project Owner만 매 요청 권한 재검사 후 짧게 만료되는 signed URL을 받을 수 있다.
- Evidence 재생은 `GET /api/v1/projects/:projectId/rehearsals/:runId/evidence-clips/:clipId/playback`을 사용한다. API는 로그인 사용자, project Owner 역할, project·run·clip 소속을 매 요청 확인한다. Editor·Viewer는 HTTP 403, 소속이 다른 run·clip은 HTTP 404로 거부한다.
- 성공 응답은 `evidenceClipPlaybackResponseSchema`를 따른다. `available`만 최대 15분의 `signedUrl`과 URL 만료 시각 `expiresAt`을 포함하고, `failed`, `expired`, `deleted`, `not-found`는 상태와 `clipId`만 반환한다. 이 `expiresAt`은 clip의 7일 보관 만료 시각과 다른 임시 URL 만료 시각이다.
- signed URL은 응답 직전에 만들고 데이터베이스·로그·Job 결과·장기 Web 상태에 저장하지 않는다.
- report와 observation에는 `clipId`, `observationId`만 넣는다. signed URL, storage key, `audioFileId`, transcript는 report, Job result, 로그에 넣지 않는다.
- clip 실패·만료·삭제는 report 실패가 아니다. 텍스트·수치·time range evidence는 계속 표시한다.
- `rehearsal_evidence_clips`는 project/run tenant FK와 expiry index를 사용하고 project 삭제 시 cascade 삭제한다. object 삭제는 기존 `storage_deletion_outbox` 처리 경계를 재사용한다.
- P0 Presenter Aid는 `scriptVisible=false`, 남은 시간, 현재 slide keyword 최대 3개, 미해결 문제 최대 1개만 허용한다.
- 12초 Evidence Clip은 사용자 자신의 문제 근거다. 제품 Later 후보인 30~60초 모범 발화 audio와 목적·보존 정책이 다르며 서로 재사용하지 않는다.

#### Python 요청 경계

- `/rehearsal/analyze`의 top-level, segment, keyword, slide timeline Pydantic model은 `extra="forbid"`를 사용한다.
- TypeScript DTO에 없는 필드는 HTTP 422로 거부한다. provider raw payload를 통과시키지 않는다.
- 언어 중립 공통 fixture 원본은 `packages/shared/src/coaching/p0-core-contract.fixtures.json`이다. TypeScript는 같은 경로의 wrapper를 import하고 Python test는 JSON을 직접 읽는다. 현재 Python v1 reader는 compatibility fixture를 읽고, Python v2 경계 전환 PR에서 canonical v2 fixture로 바꾼다.
- 현재 Worker의 v1 new-write가 제거되기 전까지 compatibility union을 통과할 수 있다. v2 sender는 반드시 `rehearsalAnalyzeRequestV2Schema`로 검증하고 Python response는 `rehearsalAnalyzeResponseV2Schema`로 검증한다.
- 현재 v1 compatibility request도 STT 결과의 `language`를 전달한다. 필드가 없는 과거 fixture는 `und`로 읽어 장표별 속도를 `UNSUPPORTED_LANGUAGE`로 처리한다.

#### Migration D

- `CreateP0CoachingContracts`는 `rehearsal_focus_profiles`, `rehearsal_evidence_clips`, expiry/observation index를 추가한다.
- migration은 `down()`에서 clip index/table을 먼저 제거한 뒤 focus profile table을 제거한다.
