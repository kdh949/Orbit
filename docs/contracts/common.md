# 공통 플랫폼 계약

> 인덱스: [ORBIT 공통 계약](../contracts.md)
>
> 런타임 source of truth는 `packages/shared` schema와 서비스 validation이다.

## 인증과 세션 구조

ORBIT-8은 self-managed email/password 인증을 사용한다. 비밀번호 reset, social login, email verification은 MVP 범위에서 제외한다.

요청:

```json
{
  "email": "person@example.com",
  "password": "password-123"
}
```

응답:

```json
{
  "user": {
    "userId": "user_1",
    "email": "person@example.com",
    "createdAt": "2026-06-27T01:00:00+09:00"
  }
}
```

현재 세션 조회:

```json
{
  "user": {
    "userId": "user_1",
    "email": "person@example.com",
    "createdAt": "2026-06-27T01:00:00+09:00"
  },
  "authenticatedAt": "2026-06-27T01:00:00+09:00",
  "expiresAt": "2026-07-04T01:00:00+09:00"
}
```

API:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

결정 사항:

- email은 shared schema에서 trim/lowercase normalization 후 저장한다.
- password는 8자 이상, 128자 이하로 검증한다.
- password는 Argon2id hash로만 저장한다. 평문 password는 저장하거나 응답하지 않는다.
- session id는 signed HttpOnly cookie로 전달한다.
- cookie signing은 `COOKIE_SECRET`을 사용한다.
- session payload는 Redis에 저장하고 Redis key는 `SESSION_SECRET` 기반 HMAC digest를 사용한다.
- session TTL은 MVP 기준 7일이다.
- logout은 session 삭제 후 cookie를 지우며, 없는 session에 대한 logout은 성공으로 처리한다.

구현 위치:

- `packages/shared/src/auth/auth.schema.ts`
- `apps/api/src/auth`
- `apps/api/src/database/migrations/2026062702000-CreateAuthUsers.ts`
- `apps/web/src/features/auth/AuthPanel.tsx`

## 프로젝트 생성 구조

프로젝트는 워크스페이스 안에서 생성되며, 1차 스프린트에서는 데모 사용자와 데모 워크스페이스 boundary를 기준으로 접근을 제한한다.

생성 요청:

```json
{
  "title": "Demo Project"
}
```

응답 구조:

```json
{
  "projectId": "project_1",
  "workspaceId": "workspace_demo_1",
  "title": "Demo Project",
  "createdBy": "user_demo_1",
  "createdAt": "2026-06-27T01:00:00+09:00"
}
```

API:

- `POST /api/v1/workspaces/:workspaceId/projects`
- `GET /api/v1/workspaces/:workspaceId/projects`
- `PATCH /api/v1/workspaces/:workspaceId/projects/:projectId/pin`
- `PATCH /api/v1/workspaces/:workspaceId/projects/:projectId/tags`
- `DELETE /api/v1/workspaces/:workspaceId/projects/:projectId`

결정 사항:

- 인증 시스템이 완성되기 전까지는 `DEMO_WORKSPACE_ID`와 `DEMO_USER_ID`를 기준으로 project boundary를 검증한다.
- `workspaceId`가 데모 워크스페이스와 다르면 권한 실패로 처리한다.
- 프로젝트 목록의 각 항목은 로그인 사용자의 `project_members.is_pinned` 값을 `isPinned`으로 포함한다.
- 프로젝트 목록의 각 항목은 `tags`와 최신 활성 `ai-deck-generation` 또는 `pptx-ooxml-generation` 작업의 `generation` 요약을 포함한다. 요약은 `jobId`, `type`, `status`, `progress`, `message` 구조이며 활성 작업이 없으면 `generation`은 `null`이다.
- 프로젝트 고정 변경 요청은 `{ "isPinned": true }`, 응답은 `{ "projectId": "project_1", "isPinned": true }` 구조이며 accepted member 본인의 상태만 변경한다.
- 프로젝트 태그 변경 요청은 `{ "tags": ["중요", "완료"] }` 구조다. 태그는 프로젝트당 최대 12개, 각 20자 이하이며 중복을 허용하지 않는다.
- 프로젝트 삭제는 accepted owner만 수행할 수 있으며 응답은 `{ "projectId": "project_1" }` 구조다.
- 프로젝트 응답은 `packages/shared/src/projects/project.schema.ts`의 schema로 검증한다.

구현 위치:

- `packages/shared/src/projects/project.schema.ts`
- `apps/api/src/projects`

## Project access 오류 계약

프로젝트 권한과 구성원 조회는 `projectAccessResponseSchema`를 사용한다. 데이터베이스
schema drift 또는 일시적인 저장소 장애는 빈 500 대신 `projectApiErrorSchema`의
`code`, `message`, `details` 구조와 HTTP 503으로 응답한다.

지원하는 실패 코드는 다음과 같다.

- `PROJECT_ACCESS_UNAVAILABLE`
- `PROJECT_MEMBERS_UNAVAILABLE`
- `PROJECT_SCHEMA_NOT_READY`

API는 pending migration 또는 필수 `project_members.is_pinned` 컬럼 누락을 확인한 뒤
schema가 준비되지 않았으면 listen 전에 기동을 중단한다. `/health/readiness`도 동일한
검사를 사용한다.

## 파일 업로드 결과 구조

파일 업로드는 공통 API로 제공하고, 각 기능은 `fileId`와 `purpose`를 기준으로 업로드 결과를 사용한다.

```json
{
  "fileId": "file_1",
  "projectId": "project_demo_1",
  "originalName": "sample.pptx",
  "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "size": 1024000,
  "url": "/uploads/file_1",
  "purpose": "pptx-import",
  "createdAt": "2026-06-27T01:00:00+09:00"
}
```

`purpose` 값:

- `pptx-import`
- `reference-material`
- `rehearsal-audio`
- `rehearsal-transcript-json`
- `rehearsal-transcript-text`
- `export-result`
- `report-result`
- `thumbnail`
- `profile-avatar`
- `rehearsal-slide-snapshot`
- `design-asset`

`rehearsal-transcript-json`과 `rehearsal-transcript-text`는 리허설 처리 과정에서만
생성하는 Owner 전용 내부 자산이다. 공통 업로드, 일반 자산 목록 및 공개 content
API에서는 노출하지 않는다. `rehearsal_runs.transcript_json_file_id`와
`rehearsal_runs.transcript_text_file_id`가 각 `project_assets.file_id`를 참조한다.

리허설 STT 성공 시 Worker는 run의 `created_at`을 Asia/Seoul 날짜로 변환하고
`rehearsals/{date}/{projectId}/{runId}/transcript.json`과 `transcript.txt`를 저장한다.
JSON은 `text`, `liveTranscript`, `slideTranscriptSnapshots`, `language`, `duration`, `provider`,
`segments[{ text, start, end }]` 구조다. `text`는 서버의 리포트 STT 결과이며
`liveTranscript`는 브라우저가 리허설 중 누적한 실시간 인식 문장이다. 실시간 인식을
사용하지 않았거나 전달되지 않은 경우 `liveTranscript`는 `null`이다. speaker와
word-level segment는 보관하지 않는다. 두 `project_assets` row와
`rehearsal_runs` 참조 갱신은 하나의 DB transaction으로 처리하고, DB 반영 실패 시
이번 시도에서 새로 생성한 storage object만 보상 삭제한다.

리포트 지표 중 `liveTranscript`를 데이터 원본으로 사용하는 항목은 전체 `습관어`
횟수와 단어별 횟수뿐이다. 말하기 속도, 키워드 포함률, 침묵, 의미 평가 등 나머지
지표는 서버 STT와 오디오 분석 결과를 유지한다. `liveTranscript`가 비어 있으면
습관어도 기존 서버 분석 결과를 사용한다.

리허설 소유자는 `GET /api/v1/rehearsals/:runId/downloads/transcript`와
`GET /api/v1/rehearsals/:runId/downloads/audio`를 통해 각각 보존된
`transcript.txt`와 원본 `rehearsal.webm`을 attachment로 내려받을 수 있다. 두 API는
run의 project read 권한을 검사하며 일반 asset content API로 우회 노출하지 않는다.
원본 audio는 `raw_audio_delete_deadline_at` 이전이고 실제 삭제되지 않은 경우에만
제공한다.

리포트 조회 응답의 `transcriptDownloadAvailable`은 owner-only transcript asset metadata와
Object Storage의 실제 `transcript.txt` 존재 여부를 확인한 다운로드 가능 상태다.
리포트 원문 노출 정책을 나타내는 `report.transcriptRetained`와 구분해서 사용한다.

결정 사항:

- 업로드 후 API 응답은 위 구조로 통일한다.
- PPTX import, 참고자료 추출, 리포트용 리허설 STT는 모두 `fileId`를 받아 시작한다.
- `url`은 임시로 로컬 경로를 쓰되, 이후 S3 signed URL로 교체할 수 있게 유지한다.
- 업로드 요청은 `POST /api/v1/projects/:projectId/assets/upload-url`로 시작한다.
- 업로드 완료 처리는 `POST /api/v1/projects/:projectId/assets/complete`에서 `fileId`를 받아 위 구조를 반환한다.
- 1차 구현에서 허용하는 mime type은 purpose별로 제한한다. 문서/이미지 purpose는 PDF, PPTX, DOCX, JPEG, PNG, WebP를 허용하고 최대 크기는 50MiB다. `rehearsal-audio`는 MP3, MP4, MPEG, MPGA, M4A, FLAC, WAV, WebM 계열만 허용한다. `REPORT_STT_PROVIDER=openai` 경로에서는 `REHEARSAL_AUDIO_MAX_BYTES` 기본값과 최대값을 25MB로 유지한다. WhisperX는 현재 별도 provider 최대 크기 계약을 정의하지 않는다.
- upload URL을 발급한 뒤 complete가 호출되지 않은 파일은 `pending` metadata로 남기고, 정리 정책은 후속 작업에서 결정한다.
- 분석이 끝난 `rehearsal-audio` raw object는 삭제하고, metadata는 `status=deleted`, `deletedAt`으로 추적한다.

구현 위치:

- `packages/shared/src/files/file.schema.ts`
- `apps/api/src/files`

## Job 상태 구조

PPTX OOXML import/export, 참고자료 추출, AI 생성, 리허설 STT, 최종 보고서는 모두 동일한 Job 구조를 사용한다.

```json
{
  "jobId": "job_1",
  "projectId": "project_demo_1",
  "type": "pptx-ooxml-generation",
  "status": "queued",
  "progress": 0,
  "message": "작업 대기 중",
  "result": null,
  "error": null,
  "createdAt": "2026-06-27T01:00:00+09:00",
  "updatedAt": "2026-06-27T01:00:00+09:00"
}
```

`status` 값:

- `queued`
- `running`
- `succeeded`
- `failed`

historical `type` 값:

- `pptx-import`
- `deck-export`
- `reference-extract`
- `ai-deck-generation`
- `ai-template-deck-generation`
- `semantic-cue-extraction`
- `pptx-ooxml-generation`
- `pptx-ooxml-sync`
- `worker-health-check`
- `rehearsal-stt`
- `rehearsal-semantic-evaluation`
- `final-report-generation`
- `report-pdf-export`
- `focused-practice-analysis`
- `challenge-qna-generation`
- `challenge-qna-answer-analysis`
- `private-audio-cleanup`

결정 사항:

- 오래 걸리는 작업은 전부 Job으로 처리한다.
- `historicalJobTypeSchema`, `jobTypeSchema`, `jobSchema`는 `pptx-import`, `ai-template-deck-generation` 과거 row를 계속 읽는다.
- `activeJobTypeSchema`와 `publicCreatableJobTypeSchema`는 두 historical-only type을 거부한다.
- `packages/job-queue`는 두 legacy queue/job constant와 enqueue helper를 export하지 않으며 Worker도 해당 queue를 구독하지 않는다.
- PR 4 제거 코드는 personal staging에 자동 배포됐고 #339 종료 시 배포 환경의 두 legacy queue와 관련 DB queued/running 잔여 상태가 0임을 읽기 전용으로 확인했다. 로컬 증거로 대신하지 않는다.
- 프론트는 `jobId`로 진행률을 조회한다.
- Job 조회 API는 `GET /jobs/:jobId`를 기본 경로로 사용하고, 기존/캐시된 web client 호환을 위해 `GET /api/v1/jobs/:jobId`도 같은 응답을 반환한다.
- 성공 결과는 `result`, 실패 이유는 `error`에 넣는다.
- `error`는 `{ code, message, failedStage?, retryable? } | null`이다. 기존 row는 두 optional field가 없어도 유효하다.
- `failedStage`는 AI Deck 부모 Job의 실패 stage 요약이며 shard 식별자는 `ai_deck_generation_stages` checkpoint key에만 저장한다.
- `retryable`은 부모 Job 실패 후 `POST /api/v1/projects/:projectId/jobs/:jobId/retry`를 허용할지 나타낸다. 자동 stage 재시도는 checkpoint의 `attempt < 5`로 별도 관리한다. 명시적 retry는 `failedStage`의 실패 checkpoint만 `queued`, `attempt=0`으로 초기화하고 성공한 upstream 및 같은 OCR/image stage의 성공 shard를 보존하며 downstream checkpoint와 artifact를 무효화한다. coordinator 자체 실패처럼 `reference-extract-file` checkpoint가 없을 때만 기존 failed BullMQ coordinator entry를 제거하고 ID-only coordinator를 다시 enqueue한다.
- `error`에는 provider raw response, token, cookie, 사용자 원문 등 민감하거나 과도한 데이터를 저장하지 않는다.

구현 위치:

- `packages/shared/src/jobs/job.schema.ts`

### AI Deck 내부 stage와 checkpoint

- staged BullMQ coordinator message는 strict `{ jobId, projectId }`만 담고 전체 request는 DB의 부모 `jobs.payload`에서 읽는다. `generate-deck` queue는 `job.name`의 `generate-deck`과 `generate-deck-staged-coordinator`, `reference-extract` queue는 `reference-extract`와 `reference-extract-file`을 구분해 기존 monolith/standalone OCR과 staged handler를 함께 안전하게 routing한다. 나머지 stage queue도 stage 이름과 `job.name`이 일치할 때만 실행한다.
- `AI_DECK_WORKER_QUEUE=all|reference-extract|research-content|design-layout|image|qa-finalize`를 실행할 수 있다. `research-content`는 `ai-deck-research-content`, `design-layout`은 `ai-deck-design-layout`, `image`는 `ai-deck-image`, `qa-finalize`는 `ai-deck-qa-finalize`만 소비한다. 지원되는 실행 모드는 `monolith|bullmq|pg`다. dedicated role은 `bullmq`에서만 허용하고 `pg`는 `all`만 허용한다. `AI_DECK_EXECUTION_MODE=sqs`는 도입 취소된 미지원 값이므로 Worker 시작 시 거부한다.
- 부모 `jobs.payload`는 strict `generateDeckStoredJobPayloadSchema`를 사용한다. 새 인증 요청은 `requestedByUserId`를 저장하고 Style 확정 후 strict `designSelection`과 deterministic `coverPlan`을 추가한다. 기존 payload에 `requestedByUserId`가 없으면 PostgreSQL claim에서 `projects.created_by`를 사용한다. raw source, OCR, provider 응답과 내부 prompt는 이 payload에 추가하지 않는다.
- stage enum은 `reference-extract-file`, `source-grounding`, `content-planning`, `cover-slide`, `design-planning`, `layout-compile`, `image-slide`, `semantic-quality`, `rendered-visual-quality`, `publication`의 정확한 10개다.
- queue envelope은 strict `{ pipelineJobId, projectId, stage, shardKey }`만 허용한다. binary, base64, 전체 Deck, provider raw response, 별도 checkpoint/asset ID는 금지한다.
- `reference-extract-file`과 `image-slide`은 colon 없는 non-empty `shardKey`를 사용하고 나머지 singleton stage는 정확히 `""`를 사용한다. stage 전용 `pipelineJobId`에도 colon을 허용하지 않으며 일반 historical `Job.jobId` 계약은 좁히지 않는다.
- BullMQ `opts.jobId`는 `${pipelineJobId}:${stage}:${shardKey}`로 만들어 정확히 세 segment를 유지한다. stage message에는 별도 `jobId` field를 넣지 않으며 duplicate delivery와 crash 복구는 DB checkpoint 전이로 수렴시킨다.
- repository는 parent row의 `jobs.job_id`, `jobs.project_id`, `jobs.type="ai-deck-generation"`을 envelope과 대조한다.
- `ai_deck_generation_stages`는 `(pipeline_job_id, stage, shard_key)` UNIQUE checkpoint다. `pipeline_job_id`는 `jobs(job_id) ON DELETE CASCADE`, `shard_key`는 `NOT NULL DEFAULT ''`, `status`는 `queued | running | succeeded | failed`, `attempt`는 `0..5`다.
- `source-grounding`과 `cover-slide`의 `input_ref_json`은 `{}`다. `content-planning`, `design-planning`, `layout-compile`, `image-slide`, `semantic-quality`의 input은 strict `{ planningArtifactId: UUID }`, `rendered-visual-quality`, `publication`의 input은 strict `{ executionArtifactId: UUID }`만 허용한다. 각 consumer는 같은 tenant·pipeline과 기대 upstream stage·shard의 artifact인지 다시 검증한다. `result_ref_json`은 기본적으로 `null | {}`이고 `reference-extract-file`은 strict `{ referenceExtractionArtifactId: UUID }`, 네 planning stage는 strict `{ planningArtifactId: UUID }`, cover를 포함한 다섯 execution stage는 strict `{ executionArtifactId: UUID }`만 허용한다. 전체 Deck·content·binary/base64·provider raw response는 checkpoint에 저장하지 않는다.
- `ai_deck_reference_extraction_artifacts`는 `(pipeline_job_id, file_id)` UNIQUE이며 `artifact_id` UUID를 primary key로 사용한다. `(pipeline_job_id, project_id)`는 부모 `jobs(job_id, project_id)`, `(project_id, file_id)`는 `project_assets(project_id, file_id)`, `(pipeline_job_id, stage, file_id)`는 해당 `ai_deck_generation_stages(pipeline_job_id, stage, shard_key)`를 각각 `ON DELETE CASCADE`로 참조한다. 같은 pipeline/file을 upsert할 때 기존 `artifact_id`를 바꾸지 않아 locator UUID가 안정적으로 유지된다.
- `ai_deck_planning_artifacts`는 `(pipeline_job_id, stage)` UNIQUE이며 `source-grounding`, `content-planning`, `design-planning`, `layout-compile`의 검증된 JSON object만 저장한다. `(pipeline_job_id, project_id)`는 부모 Job, `(pipeline_job_id, stage, shard_key='')`는 해당 singleton checkpoint를 `ON DELETE CASCADE`로 참조한다. 같은 pipeline/stage를 upsert해도 기존 `artifact_id`를 유지한다.
- `ai_deck_execution_artifacts`는 `(pipeline_job_id, stage, shard_key)` UNIQUE이며 `cover-slide`, `image-slide`, `semantic-quality`, `rendered-visual-quality`, `publication`의 shared schema 검증 결과만 저장한다. `(pipeline_job_id, project_id)`는 부모 Job, `(pipeline_job_id, stage, shard_key)`는 해당 checkpoint를 `ON DELETE CASCADE`로 참조한다. cover artifact는 선택 디자인의 1장 Deck, legacy image artifact는 한 slide와 warning을 저장한다. v2 completed slide artifact는 strict `{ artifactVersion:2, sourceOrder, order, slideId, slide, warnings, validation }`이며 identity가 manifest와 일치해야 한다. quality artifact는 검증된 worker payload만, publication artifact는 최종 Job result만 저장하며 locator UUID는 같은 stage/shard upsert에서 유지한다.
- 검증된 OCR 응답은 `usable=false`여도 artifact로 보존할 수 있다. transient/unusable 결과는 먼저 해당 shard만 재시도하고, 총 5번째 시도에도 unusable이면 `usable=false` artifact와 locator를 저장해 checkpoint를 `succeeded`로 끝낸 뒤 policy join이 부모의 계속/실패를 결정한다. provider raw response와 credential은 artifact나 Job error에 저장하지 않는다.
- claim은 `queued -> running` 조건부 update에 성공한 consumer만 허용하며 이때만 `attempt`를 증가시킨다. stable worker ID에 UUID를 붙인 opaque `lease_owner` token을 claim마다 새로 발급하고 `attempt`를 generation fencing token으로 함께 사용한다. claim이 반환한 `lease_owner`와 `attempt`가 모두 일치하고 lease가 만료되지 않은 heartbeat·성공·실패·retry release만 허용한다.
- `pg`는 `AI_DECK_WORKER_CONCURRENCY=5`의 process-wide slot을 모든 stage handler가 공유한다. 후보 사용자는 현재 running 수, 가장 오래 기다린 checkpoint, 사용자 ID 순으로 고른다. 사용자별 advisory transaction lock과 해당 `users` row의 `FOR UPDATE` lock을 획득한 뒤 running 수를 다시 확인하고, `AI_DECK_USER_CONCURRENCY=5` 이상이면 건너뛴다. 실제 checkpoint row는 `FOR UPDATE OF stages SKIP LOCKED LIMIT 1`로 claim한다. Worker replica가 늘어나도 사용자별 상한은 같은 transaction과 durable user row lock으로 유지된다.
- `pg`에서 checkpoint가 없는 active 부모 Job은 Worker maintenance가 기존 staged coordinator 함수를 직접 호출해 멱등 초기화한다. `bullmq` rollback 경로도 같은 durable stage chain을 유지한다.
- BullMQ dispatcher는 10개 stage checkpoint를 모두 enqueue한다. enqueue 후 BullMQ `getState()`가 `waiting | delayed | prioritized`일 때만 조회 당시 `attempt`를 대조해 `dispatched_at`을 기록한다. `active | completed | failed | unknown`은 durable dispatch로 인정해 mark하지 않으며, 늦은 이전 send가 새 retry generation을 덮지 못한다. `pg`에서는 dispatcher를 실행하지 않는다.
- BullMQ dispatcher는 매 회차 `listUndispatched` 전에 active parent의 10개 stage 중 `status='queued'`이고 `dispatched_at`이 15분 이상 지난 row를 최대 100개씩 `FOR UPDATE ... SKIP LOCKED`로 복구한다. 이 scan은 `idx_ai_deck_generation_stages_stale_dispatch (dispatched_at, pipeline_job_id, shard_key)` partial index를 사용한다.
- retryable failure는 현재 stage/shard만 지수 backoff로 최대 총 5회 시도한다. DB lease는 10분, heartbeat는 60초다. retry release와 expired lease의 1~4번째 복구는 `status='queued'`, `lease_owner=NULL`, `lease_expires_at=NULL`, `dispatched_at=NULL`로 전이하고 기존 `attempt`는 유지한다. OCR의 5번째 종료는 policy join이 부모의 계속/실패를 결정하고, 나머지 필수 stage의 5번째 실패·expired lease는 checkpoint와 부모를 함께 terminal 처리한다. 부모가 terminal이면 transaction commit 후 반환된 parent Job으로 표준 `job.failed` 업무 로그를 남긴다. 이 DB checkpoint `attempt`는 BullMQ transport의 `attemptsMade`와 별도 재시도 층이다. expired-lease reconciler는 `bullmq`와 `pg` 모두 Worker 시작 직후 한 번 실행한 뒤 주기적으로 실행하고 dispatcher는 `bullmq`에서만 실행한다.
- coordinator는 reference policy를 root `referencePolicy`, `design.referencePolicy`, `brief.referencePolicy` 순으로 선택한다. OCR selector 입력인 `references`와 `referenceFileIds`는 각각 최대 10개이며, non-empty `references`의 `{ fileId }[]`를 우선하고 비어 있을 때만 `referenceFileIds`를 fallback으로 사용한다. 첫 등장 순서로 중복 제거한 전체 선택 집합이 `selectedReferenceFileIds`이고, 여기서 `referenceContext.fileId`로 이미 covered된 file을 제외한 집합이 `uncoveredReferenceFileIds`다. `reference-extract-file` checkpoint와 OCR fan-out은 `uncoveredReferenceFileIds`에만 생성한다. Web의 인증된 `POST /api/v1/projects/:projectId/references/extractions` standalone OCR과 `referenceContext` 전달 경로는 계속 유지한다.
- `/documents/parse`는 정제된 전체 텍스트를 1,200~1,500자 chunk로 `reference_chunks`에 인덱싱한다. staged `source-grounding`은 주제, prompt, audience, reference keyword를 한 번 embedding하고 같은 project의 선택 file별 상위 3개를 조회한다. 파일당 최대 3개, 전체 최대 12개를 사용하며 동일 content와 인접 chunk의 150자 overlap은 제거하되 실제 `sourceId`와 `chunkId`는 유지한다.
- `references-only`는 모든 선택 file에서 chunk 1개 이상을 요구하고 검색 불가 또는 누락 시 `SOURCE_GROUNDING_REQUIRED`로 종료한다. `references-first`는 유효한 file별 최상위 chunk를 우선하고 남은 자리를 관련도순으로 채우며 누락 file은 direct OCR context로 degrade한다. `research-first`는 검증된 web source 최대 8개와 관련 첨부 chunk 최대 4개를 사용한다. `user-input-only`는 첨부 chunk를 검색하거나 Story evidence에 넣지 않으며, legacy `topic-only + referenceContext` direct 입력 호환은 유지한다.
- Story prompt는 topic/user input record와 별도로 evidence 최대 12개를 사용한다. indexed chunk는 최대 1,500자 전문이 포함되며 1,600자 source block 제한은 direct OCR fallback의 안전 상한이다. 검색 저하는 strict policy가 아닌 경우 `REFERENCE_CHUNK_RETRIEVAL_DEGRADED` warning code와 함께 계속한다.
- 별도 join stage는 만들지 않는다. 마지막 `reference-extract-file` child가 끝난 트랜잭션에서 예상 shard 전체와 artifact `usable`을 확인하고 `source-grounding` checkpoint를 멱등 생성한다. `references-only`는 `selectedReferenceFileIds`가 하나 이상이어야 하고 선택한 모든 file이 검증된 `referenceContext`로 covered됐거나 새 OCR artifact에서 `usable=true`여야 한다. 선택되지 않은 `referenceContext`만으로 이 조건을 대신할 수 없다. `references-first`는 기존 context와 새 artifact를 합쳐 usable source가 하나 이상이면 계속하고, `research-first`는 uploaded grounding이 없어도 계속한다. strict 조건을 만족하지 못하면 부모를 `SOURCE_GROUNDING_REQUIRED`, `retryable=false`로 terminal 처리한다.
- `PYTHON_WORKER_EXTRACT_INVALID_RESPONSE`처럼 schema가 유효하지 않은 non-retryable provider 응답은 artifact를 만들지 않고 해당 `reference-extract-file` checkpoint만 `failed`로 끝낸다. 이 오류는 `fatalParent=false`로 같은 policy join에 합류하며 artifact가 없는 shard는 `usable=false`로 판정한다. provider invalid 자체가 부모를 즉시 실패시키지 않고 reference policy가 계속 또는 terminal을 결정한다. 반면 project·asset identity 위반은 active sibling checkpoint와 부모를 함께 terminal 처리한다.
- BullMQ 최종 transport attempt가 실패하면 DB recovery를 원 오류 재throw 전에 await한다. 10개 stage는 DB `attempt`나 checkpoint terminal 상태를 변경하지 않고 active parent의 queued checkpoint에서 `dispatched_at=NULL`만 복구해 결정적 `opts.jobId`로 다시 enqueue할 수 있게 한다. `generate-deck-staged-coordinator`는 active parent의 queued/running checkpoint와 부모 Job을 한 transaction에서 `AI_DECK_COORDINATOR_FAILED`, `failedStage="reference-extract-file"`, `retryable=true`로 종료하고 반환된 terminal parent Job으로 commit 후 표준 `job.failed` 업무 로그를 남긴다.
- `generate-deck-staged-coordinator` BullMQ Job은 재시도 소진뿐 아니라 stall/started limit 초과로도 failed set에 들어갈 수 있다. failed entry는 `removeOnFail=false`로 cap 없이 보존한다. BullMQ의 정확한 transport-boundary `failedReason`인 `job stalled more than allowable limit` 또는 `job started more than allowable limit`이면 `attemptsMade`와 무관하게 coordinator transaction을 멱등 재실행한다. 그 외에는 `attemptsMade >= opts.attempts`일 때 active checkpoint와 부모를 terminal 복구하고, 그보다 작으면 역시 멱등 재실행해 commit 전 crash와 commit 후 ACK 유실을 모두 수렴시킨다. resume가 failed parent를 반환하거나 지연된 terminal DB recovery가 성공하면 DB commit 이후에만 failed entry 제거를 시도하고, reconciliation 결과를 받은 Worker가 같은 표준 `job.failed` 업무 로그를 남긴다. maintenance reconciler는 live rank offset 대신 Redis failed ZSET의 opaque `ZSCAN` cursor와 초과 batch의 `pendingJobIds`를 Worker에 보존하고 한 회차에 기본 25개, 최대 100개만 처리한다. concurrent cleanup으로 사라진 entry와 중복 scan은 멱등 처리하며, DB recovery가 실패한 entry는 제거하지 않아 다음 full cursor cycle에서 다시 방문한다.
- legacy `layout-compile` artifact는 검증된 worker payload와 visual requirements를 유지한다. v2 `layout-compile`은 전체 Deck을 미리 만들지 않고 strict `{ artifactVersion:2, deckShell, slides, warnings }` manifest를 저장한다. v2 manifest의 모든 slide는 `001-slide_1` 형식의 zero-padded `shardKey`로 기존 `image-slide` checkpoint에 fan-out한다. 각 shard가 content-planning 고정 필드 검증, slide 상세 생성, layout compile, asset resolution과 bounded QA를 끝낸 뒤에만 completed slide artifact를 저장한다.
- v2 fan-out은 한 shard의 최종 실패만으로 sibling을 중단하지 않는다. 모든 shard가 terminal이 될 때까지 join을 지연하고, 모두 성공하면 `semantic-quality`을 정확히 한 번 만들며 실패가 하나라도 있으면 성공 artifact를 보존한 채 부모 Job을 실패시킨다. 명시적 retry는 기존 성공 shard를 재사용하고 실패 shard만 다시 실행한다. `semantic-quality`은 manifest 전체 identity를 검증해 `sourceOrder` 순서로 Deck을 조립한다. 이후 global semantic/rendered quality는 공개된 slide를 변경하는 repair 없이 검증만 수행한다.
- `semantic-quality` → `rendered-visual-quality` → `publication`은 각각 독립 checkpoint이며 publication transaction이 execution artifact, checkpoint 성공, Deck upsert와 부모 Job `succeeded/progress=100`을 함께 commit한다. terminal failure에서는 Deck을 쓰지 않는다. `WEB_RESEARCH_QUALITY_FAILED`는 usable grounding 또는 사용자 입력이 있으면 warning으로 계속하고, usable grounding이 전혀 없는 strict policy의 `SOURCE_GROUNDING_REQUIRED`와 내부 재시도 후에도 유효하지 않은 Art Director 응답의 `ART_DIRECTOR_INVALID_RESPONSE`는 terminal이다.

### AI Deck 비동기 입력과 Design Selection gate

- Story Review UI/API/shared schema와 `ai_deck_story_reviews` 테이블은 제거한다. `POST /api/v1/projects/:projectId/jobs/generate-deck` 응답은 strict `{ job }`이며 content planning은 입력 화면의 **다음 단계** 클릭 직후 백그라운드에서 시작한다.
- 첨부파일을 선택하면 임시 project를 한 번만 만들고 파일을 병렬 업로드한다. Web은 파일 순서를 유지하며 `uploading | uploaded | failed`를 표시한다. 업로드 중이거나 실패 파일이 남아 있으면 다음 단계 진행을 막고, 실패 파일은 재시도 또는 제거할 수 있다.
- Style 상태는 `GET /api/v1/projects/:projectId/jobs/:jobId/design-selection`, 확정은 같은 경로의 strict `PUT`을 사용한다. selection은 `paletteOptionId`, 전체 `paletteOverride`, strict `fontOverride`, 선택 `designPrompt`만 받는다.
- `content-planning` 완료와 Style 확정은 순서와 관계없이 같은 Job row lock과 checkpoint UNIQUE 계약으로 합류하고 `design-planning`을 정확히 한 번 enqueue한다. 신규 Job은 `coverPlan`을 만들거나 `cover-slide` checkpoint를 enqueue하지 않는다.
- 신규 v2 `layout-compile` manifest는 1번을 포함한 모든 descriptor를 `image-slide`로 fan-out한다. 표지도 다른 slide와 같은 compose, asset resolution, Content/Fact/Semantic/Vision QA 경로를 통과한다.
- shared enum의 `cover-slide`, stored payload의 optional `coverPlan`, cover artifact/processor와 preview fallback은 이미 시작했거나 저장된 과거 Job의 재개를 위해 유지한다. 신규 생성 경로에서는 사용하지 않으며 이를 위한 DB migration이나 대규모 정리는 하지 않는다.

### AI Deck 시연 캐시

- 공개 `GenerateDeckRequest`, 응답, Job type/status에는 시연 전용 필드를 추가하지 않는다. 내부 설정 `DEMO_AI_DECK_CACHE_ENABLED`, `DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION`, `DEMO_AI_DECK_SOURCE_PROJECT_ID`, `DEMO_AI_DECK_TRIGGER_TOPIC`을 사용하고 기존 `ai-deck-generation` queued Job을 만든다.
- production은 기본 거부한다. `APP_ENV=production`에서 cache를 켜려면 `DEMO_AI_DECK_CACHE_ENABLED=true`, `DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION=true`, `DEMO_FIXTURE_ENV_ALLOWLIST`의 exact `production` 항목을 모두 요구한다. production 승인 flag는 환경별 기본값을 `false`로 유지하고, source Deck과 시연 사용자 검증이 끝난 운영 환경에서만 별도 변경한다.
- cache hit은 기능 활성화, allowlisted `APP_ENV`, `DEMO_USER_ID` 요청자, 공백 정규화 후 정확히 일치하는 topic, 읽기 가능한 source project, `deckSchema`를 통과한 source Deck을 모두 요구한다. source가 없거나 유효하지 않으면 `DEMO_DECK_CACHE_UNAVAILABLE`로 실패하고 일반 AI 생성으로 fallback하지 않는다.
- hit Job은 Worker에 enqueue하지 않는다. Style 확정 transaction에서 source Deck을 다시 읽고 검증한 다음 target `projectId`, `deckId=deck_${jobId}`, `version=1`만 바꾸어 upsert한다. slide ID, elements, notes, design, animations와 asset URL은 보존하고 selection payload, 유효한 generation result, Job `succeeded/progress=100/error=null`을 같은 transaction에서 저장한다.
- cache 사용 로그 `ai_ppt.demo_cache.used`에는 `jobId`, target/source project ID, `deckId`, slide count만 남긴다. prompt, notes, transcript, asset 내용과 secret은 기록하지 않는다.

### AI Deck Progressive Preview

- 신규 Job은 `layout-compile` 이후 1번부터 연속으로 완료된 slide만 반환한다. 과거 Job에 `cover-slide` artifact가 있으면 기존 `layout-compile` 전 1번 slide fallback을 유지한다. 화면은 항상 “검증 중 변경될 수 있음”을 안내하고, 최종 rendered Vision QA와 publication 완료 뒤에만 editor로 전환한다.
- `GET /api/v1/projects/:projectId/jobs/:jobId/deck-preview`는 project read 권한과 `type='ai-deck-generation'` Job identity를 확인하고 strict `AiDeckPreviewResponse`를 반환한다. 응답은 `{ jobId, projectId, status, progress, expectedSlideCountRange, editable:false, outline, deck, completedSlideIds, pendingSlideIds, updatedAt, error }`만 포함하며 raw source, OCR, prompt, provider response, 내부 layout/visual requirement는 노출하지 않는다. status는 checkpoint를 기준으로 `planning`, `grounding`, `composing`, `rendering`, `quality-check`, `ready`, `failed`, `cancelled` 중 하나를 반환한다.
- content plan 전에는 `expectedSlideCountRange`로 5~8장 예정 skeleton을 표시한다. 과거 Job에 성공한 cover가 있으면 1번 슬롯에 표시하고, 실제 outline이 준비되면 임시 슬롯을 제목·핵심 메시지가 있는 실제 목차로 교체한다. `references-first` 웹 보강은 alias 계획, 검색, 출처 검증을 합쳐 최대 20초만 사용하고 SDK 재시도 없이 시간 초과 시 검증되지 않은 웹 citation을 버린 뒤 업로드 자료만으로 계속한다.
- `layout-compile` 전에는 승인된 `content-planning` artifact에서 `order`, `title`, `message`만 projection해 `outline`과 `deck=null`을 반환한다. legacy layout 이후에는 기존 full Deck과 image artifact 병합 규칙을 유지한다. v2에서는 성공한 completed slide artifact를 manifest `sourceOrder`로 검사해 1번부터 끊김 없는 prefix만 partial Deck으로 반환한다. out-of-order 완료 slide는 내부에는 보존하지만 앞 slide가 준비되기 전에는 `completedSlideIds`나 `deck`에 노출하지 않으며 나머지는 모두 `pendingSlideIds`다. 성공한 `semantic-quality` 또는 `rendered-visual-quality` artifact가 있으면 가장 최근 검증 Deck을 우선한다.
- 부모 Job이 `succeeded`이면 `decks.deck_json`의 canonical Deck을 `ready`로 반환한다. failed/cancelled는 마지막으로 검증 가능한 preview를 유지하되 일반화한 오류 문구와 retryable 여부만 제공한다. preview 조회는 canonical Deck이나 artifact를 수정하지 않는다.
- Web은 약 1.2초 polling을 사용하고 backend 완료 순서와 무관하게 `completedSlideIds`의 1번부터 연속된 prefix만 공개한다. 새 slide는 750ms 간격으로 fade-in하며 `prefers-reduced-motion`에서는 즉시 공개한다. backend가 먼저 `ready`여도 공개가 끝날 때까지 화면 status는 `rendering`, progress는 공개 비율 기준 12~96으로 표시한다. 사용자가 이전 slide를 선택하기 전까지만 최신 공개 slide를 자동 선택하고, 마지막 slide를 600ms 유지한 뒤 `["deck", projectId]` query를 invalidate하고 일반 editor route로 replace 이동한다.

구현 위치:

- `packages/shared/src/jobs/ai-deck-generation-stage.schema.ts`
- `packages/config/src/index.ts`
- `packages/job-queue/src/index.ts`
- `apps/api/src/generate-deck/generate-deck.service.ts`
- `apps/api/src/generate-deck/design-selection.controller.ts`
- `apps/api/src/generate-deck/design-selection.service.ts`
- `apps/api/src/database/migrations/2026071706000-ReplaceStoryReviewWithCoverPreview.ts`
- `apps/api/src/database/migrations/2026071502000-CreateAiDeckGenerationStages.ts`
- `apps/api/src/database/migrations/2026071503000-CreateAiDeckReferenceExtractionArtifacts.ts`
- `apps/api/src/database/migrations/2026071601000-CreateAiDeckPlanningArtifacts.ts`
- `apps/api/src/database/migrations/2026071601100-ExpandAiDeckStageDispatchRecovery.ts`
- `apps/api/src/database/migrations/2026071602000-CreateAiDeckExecutionArtifacts.ts`
- `apps/worker/src/worker.service.ts`
- `apps/worker/src/generate-deck/postgres-stage-runner.ts`
- `apps/worker/src/generate-deck/stage-checkpoint-repository.ts`
- `apps/worker/src/generate-deck/planning-stage.processor.ts`
- `apps/web/src/features/ai-ppt/AiPptMockupPage.tsx`
- `packages/shared/src/deck/generate-deck.schema.ts`
- `apps/worker/src/generate-deck/execution-stage.processor.ts`
- `apps/worker/src/generate-deck/execution-artifact-repository.ts`
- `apps/worker/src/reference-extract-python-client.ts`
- `apps/worker/src/reference-extract.processor.ts`
- `services/python-worker/app/ai/deck_generation/stage_runtime.py`
- `apps/worker/src/generate-deck/staged-coordinator.ts`
- `apps/worker/src/generate-deck/stage-checkpoint-repository.ts`
- `apps/worker/src/generate-deck/stage-dispatcher.ts`
- `apps/worker/src/generate-deck/stage-reconciler.ts`
- `apps/worker/src/generate-deck/coordinator-failure-reconciler.ts`
- `apps/worker/src/generate-deck/transport-failure-recovery.ts`
- `apps/worker/src/generate-deck/reference-extract-stage.ts`
- `apps/worker/src/generate-deck/reference-extraction-artifact-repository.ts`
- `apps/worker/src/generate-deck/reference-extraction-join.ts`

## WebSocket 이벤트 구조

실시간 협업과 발표 동기화는 WebSocket 공통 envelope을 사용하고, 이벤트별 `payload`는 shared schema로 검증한다.

```json
{
  "type": "slide-changed",
  "roomId": "project_demo_1",
  "sessionId": "session_demo_1",
  "userId": "user_demo_1",
  "payload": {
    "deckId": "deck_demo_1",
    "slideId": "slide_1",
    "slideIndex": 0
  },
  "sentAt": "2026-06-27T01:00:00+09:00"
}
```

최소 이벤트:

- `project-joined`
- `project-presence`
- `deck-updated`
- `slide-changed`
- `highlight-changed`
- `presentation-started`
- `audience-joined`
- `question-created`
- `poll-voted`
- `survey-submitted`

결정 사항:

- `roomId`는 `projectId` 기준으로 시작한다.
- 서버 내부 Socket.IO project room key는 `project:${projectId}` 형식을 사용한다.
- `project:join`은 signed session cookie로 인증하고, 프로젝트 읽기 권한을 확인한 뒤 해당 project room에 입장시킨다.
- `project-presence` payload에는 `projectId`와 현재 project room 접속자 목록을 넣는다.
- 발표 세션은 `sessionId`로 구분한다.
- `slide-changed` payload에는 `deckId`, `slideId`, `slideIndex`를 넣는다.
- `highlight-changed` payload에는 `slideId`, `elementId`, `state`를 넣는다.

`project-presence` payload:

```json
{
  "projectId": "project_demo_1",
  "users": [
    {
      "id": "socket_demo_1",
      "userId": "user_demo_1",
      "email": "user@example.com",
      "connectedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

구현 위치:

- `packages/shared/src/realtime/websocket.schema.ts`

## Shared schema 파일 배치 원칙

`packages/shared`는 프론트엔드, API, worker, realtime, AI 패키지가 함께 사용하는 런타임 계약을 관리한다.

원칙:

- `packages/shared/src/index.ts`에는 구현을 두지 않고 export만 둔다.
- 새 공통 schema는 기능 영역별 폴더에 둔다.
- deck 편집과 직접 관련된 계약은 `packages/shared/src/deck`에 둔다.
- 파일 업로드 계약은 `packages/shared/src/files`에 둔다.
- Job 계약은 `packages/shared/src/jobs`에 둔다.
- WebSocket event 계약은 `packages/shared/src/realtime`에 둔다.
- 발표/리허설/보고서 계약은 `packages/shared/src/presentation`에 둔다.
- schema를 변경하면 이 문서와 `packages/shared/src/README.md`도 함께 갱신한다.

## E2E 체크리스트

- [ ] [1번] 프로젝트 생성 가능
- [ ] [1번] PPTX 또는 참고자료 파일 업로드 가능
- [ ] [2번] PPTX 파일을 편집 가능한 덱으로 가져오기 가능
- [ ] [2번] 슬라이드 목록과 캔버스 표시 가능
- [ ] [2번] 텍스트/객체 수정 후 저장/복원 가능
- [ ] [3번] 참고자료 텍스트 추출 가능
- [ ] [3번] 참고자료 기반 AI 덱 생성 가능
- [ ] [3번] AI 제안을 기존 덱에 적용 가능
- [ ] [4번] 다른 브라우저에서 같은 덱 접속 가능
- [ ] [4번] 한쪽 편집 내용이 다른 쪽에 동기화됨
- [ ] [5번] 슬라이드별 발표 키워드 편집 가능
- [ ] [5번] 리허설 녹음/STT 가능
- [ ] [5번] 기본 리허설 보고서 확인 가능
- [ ] [4번] 발표 세션 생성 가능
- [ ] [4번] 청중 입장 가능
- [ ] [4번] 현재 슬라이드가 청중 화면에 동기화됨
- [ ] [4번] 강조/애니메이션 상태가 청중 화면에 반영됨
- [ ] [5번] 청중 질문 등록 가능
- [ ] [5번] 라이브 투표 참여 가능
- [ ] [5번] 질문/투표/세션 로그 기반 최종 보고서 확인 가능
- [ ] [전원] 처음부터 끝까지 한 번의 데모 흐름으로 이어짐

E2E 시작점은 로그인부터가 아니라 임시 사용자 기반 프로젝트 생성부터다.

## 미해결 질문과 담당자

미확정 항목이 생기면 아래 형식으로 기록하고, 결정 시각과 담당자를 반드시 남긴다.

| 항목 | 담당자 | 결정 시각 | 상태 | 결정 내용 |
| ---- | ------ | --------- | ---- | --------- |
| -    | -      | -         | -    | -         |
