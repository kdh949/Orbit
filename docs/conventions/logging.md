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

## iPad 발표 도우미

허용하는 event는 다음으로 제한한다.

```txt
presentation_companion.pairing_created
presentation_companion.pairing_exchanged
presentation_companion.connected
presentation_companion.disconnected
presentation_companion.replaced
presentation_companion.revoked
presentation_companion.command_rejected
presentation_companion.webrtc_failed
```

허용 field는 `projectId`, `presentationSessionId`, opaque `companionId`,
`pairingGeneration`, `previousGeneration`, `reasonCode`, `rttBucket`,
`webrtcState`, `elapsedBucket`처럼 bounded metadata뿐이다. pairing code와 URL,
cookie/token, raw user-agent/IP, Deck·slide text, notes/script/transcript,
annotation point·stroke 속성, SDP, ICE candidate와 username fragment는
로그에 포함하지 않는다. WebRTC와 command 실패는 raw error object 대신
고정 enum과 bucket만 기록한다.

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
