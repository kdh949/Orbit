# 서버 로그 규칙

ORBIT 서버 로그는 컨테이너 stdout/stderr로 출력되는 JSON 로그를 기준으로 한다.
로컬 Docker Compose와 운영 ECS Fargate 모두 같은 구조를 유지하고, 운영 수집기는 CloudWatch를 기준으로 한다.

## 환경변수

```txt
LOG_LEVEL=trace | debug | info | warn | error | fatal | silent
LOG_PRETTY=false | true
```

- 기본 로그 형식은 모든 환경에서 JSON이다.
- `LOG_PRETTY=true`는 `NODE_ENV=development`에서만 허용한다.
- staging/production은 `LOG_PRETTY=false`를 유지한다.
- 로컬 개발 기본값은 `LOG_LEVEL=debug`, staging/production 기본값은 `LOG_LEVEL=info`다.
- 애플리케이션 런타임의 TypeORM query logging은 모든 환경에서 비활성화한다.
  SQL parameter에는 Deck JSON, 참고자료 추출 결과, 발표자 script처럼 로그 금지
  데이터가 포함될 수 있다.

## 공통 필드

모든 서버 로그는 가능한 경우 아래 필드를 사용한다.

| 필드 | 의미 |
| --- | --- |
| `service` | `api`, `worker` 등 로그를 낸 서비스 |
| `appEnv` | `local`, `test`, `staging`, `production` |
| `event` | 기계가 읽을 수 있는 이벤트 이름 |
| `requestId` | HTTP 요청 상관관계 ID |
| `jobId` | 공통 Job ID |
| `jobType` | `reference-extract`, `rehearsal-stt` 등 작업 유형 |
| `projectId` | 프로젝트 단위 추적 ID |
| `runId` | 리허설 실행 ID |
| `roomId`, `sessionId`, `userId` | 실시간/세션 관련 추적 ID |
| `durationMs` | 작업 처리 시간 |
| `error` | `{ name, message, stack }` 또는 도메인 error object |

이벤트 이름은 `영역.동작` 형식을 사용한다.
예: `http.request.completed`, `job.enqueued`, `job.started`, `job.succeeded`, `job.failed`, `bullmq.job.failed`, `worker.ready`.

## 업무 이벤트 로그

서버 쪽 기능을 구현할 때 아래 지점에는 업무 이벤트 로그를 함께 남긴다.

- Job 생성, enqueue 성공, enqueue 실패
- Worker의 job 시작, 성공, 실패
- 외부 provider 호출 실패 또는 fallback
- 파일 업로드/삭제처럼 사용자 데이터 생명주기에 영향을 주는 상태 변경
- 인증, 세션, WebSocket room join/leave처럼 운영 추적이 필요한 경계 이벤트

로그는 디버깅 가능한 식별자와 상태만 남긴다.
성공 로그는 `info`, 예상 가능한 거절/부분 실패는 `warn`, 실제 처리 실패는 `error`를 기본으로 한다.

## 금지 데이터

아래 값은 로그에 직접 남기지 않는다.

- API key, access token, cookie, authorization header
- password, session secret, signed cookie 원문
- 파일 `contentBase64`, raw audio, transcript 원문, 발표자 script
- 대용량 request/response body 원문
- presigned URL처럼 접근 권한을 담은 URL

필요하면 `fileId`, `audioFileId`, `jobId`, `projectId`, `runId`, `fileCount`, `mimeType`처럼 추적 가능한 메타데이터만 남긴다.

## AI PPT stage 진단 로그

AI PPT stage는 transport와 관계없이 `ai-ppt.stage.started`, `ai-ppt.stage.succeeded`,
`ai-ppt.stage.attempt-failed`, `ai-ppt.stage.failed` 이벤트를 사용한다. 재시도 예정
실패는 `warn`, checkpoint와 parent Job에 반영된 최종 실패는 `error`로 기록한다.
이미지 provider 실패가 placeholder fallback으로 흡수되면
`ai-ppt.image-asset.fallback`을 `warn`으로 기록한다.

각 이벤트는 `pipelineJobId`, `projectId`, `stage`, `shardKey`, `workerId`,
`attempt`, `maxAttempts`, `durationMs`를 공통으로 사용한다. 실패 진단의 `error`에는
allowlist `code`, `reasonCode`, `name`, HTTP status, provider, provider request ID,
retry-after, 저장소 내부 첫 stack frame, message fingerprint와 안전한 issue code만 허용한다.
prompt, 사용자 입력, provider response body, 전체 message/stack, Deck JSON, 이미지
base64, signed URL은 AI PPT stage 로그에도 남기지 않는다.

PostgreSQL transport의 bootstrap·runner 경계는 `ai_deck.postgres_initialized`,
`ai_deck.postgres_initialization_failed`, `ai-ppt.stage.retry-scheduled`,
`ai-ppt.stage.runner-failed`를 사용한다. 로그에는 checkpoint identity와 안전하게
직렬화한 오류만 기록하고 부모 Job payload, source, OCR, content, provider 응답은 기록하지 않는다.

Design Selection 확정 경계는 `ai_ppt.design_selection.selected`를 `info`로 기록한다.
공통 필드는 `jobId`와 `projectId`만 사용하고 자연어 디자인 요청, palette, font,
outline, slide content, source metadata, OCR와 provider 응답은 기록하지 않는다.

## 브라우저 로컬 발표 진단

발표, 전체 리허설, 에디터 부분 리허설의 `animationDebug=1` 진단은 위 서버
로그와 별도인 브라우저 로컬 기록이다. 이 파라미터는 민감한 `full` 기록에 대한
명시적 opt-in으로 취급하며, 파라미터가 없으면 기록 모드는 `off`다.

### 저장·전송 경계

- 진단 이벤트는 API, WebSocket, telemetry, 서버 stdout/stderr로 전송하지 않는다.
- 브라우저 IndexedDB의 `diagnosticSessions`, `diagnosticEvents`에만 저장한다.
- 발표 처리는 저장 성공 여부와 분리한다. Worker, IndexedDB, quota 오류가 나도
  발표와 애니메이션은 계속하고 최근 500개 이벤트만 메모리에 유지한다.
- 세션 시작 시 7일이 지난 로컬 세션을 정리한다. 이 보관 기한은 브라우저 로컬
  저장소에만 적용되며 사용자가 내보낸 파일은 자동 삭제 대상이 아니다.
- 사용자는 drawer에서 세션을 수동 중지하고, 전체 로컬 기록을 삭제할 수 있다.
  수동 중지한 같은 페이지에서는 자동 재시작하지 않으며 명시적 시작 또는 페이지
  재진입이 필요하다.

### 기록 모드와 민감정보

`metadata`는 문자열 원문을 길이·개수 중심 메타데이터로 바꾼다. `full`은 원인
분리를 위해 transcript, speaker notes, STT bias phrase를 포함할 수 있으므로
drawer에 현재 모드와 민감정보 안내를 계속 표시한다.

모드와 관계없이 아래 값은 allowlist 밖으로 버리며 IndexedDB와 내보내기 파일에
남기지 않는다.

- credential, API key, `Authorization`, cookie, token, password
- SDP, 접근 URL, presigned URL
- raw audio, `MediaStream`, audio attachment, 파일 base64
- 전체 오류 message와 stack
- OpenAI Realtime 원본 payload의 비허용 필드

OpenAI Realtime에서는 진단에 필요한 `event_id`, `item_id`,
`content_index`, event type과 제한된 전사 결과 필드만 보존한다. 오류는 안전한
error name/code만 기록한다. `projectIdHash`는 로컬 상관관계용 가명 식별자이며
암호학적 익명화로 간주하지 않는다.

### 세션과 내보내기

이벤트 envelope은 `schemaVersion`, `sessionId`, `seq`, `wallTimeIso`,
`monotonicMs`, `level`, `stage`, `name`, `outcome`, `reason`, `trace`,
`data`를 사용한다. 한 발화는 `triggerTraceId`, React state 변경은
`stateTransitionId`, renderer 전환은 `transitionId`로 연결한다.

내보내기는 사용자가 drawer에서 요청할 때만 수행한다. `CompressionStream`을
지원하면 `.jsonl.gz`, 지원하지 않으면 `.jsonl`을 생성한다. File System Access
API가 없으면 브라우저 Blob download를 사용한다. 내보낸 파일에는 민감한 `full`
데이터가 포함될 수 있으므로 이슈, PR, 채팅, 서버 로그에 무심코 첨부하지 않는다.
