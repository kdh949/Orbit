# 환경변수 규칙

## 파일

- `.env.example`: 로컬 개발 기본값과 필수 키의 기준
- `.env.local`: 실제 로컬 실행값, git에 커밋하지 않음
- `.env.staging.example`: AWS staging 전환 시 필요한 키의 기준
- `.env.production.example`: 운영 배포 시 필요한 키의 기준

로컬 실행 전에는 다음 명령으로 `.env.local`을 만든다.

```bash
cp .env.example .env.local
```

API, worker, web, Python worker는 시작 시 환경변수를 검증한다.
필수 값이 없거나 빈 문자열이면 startup이 실패해야 하며 오류 메시지에는 누락된 env key가 포함되어야 한다.
`APP_ENV=staging` 또는 `APP_ENV=production`에서는 localhost, 로컬 DB/Redis, 로컬 secret placeholder를 그대로 사용하지 않는다.

발표 입장 코드를 발표자 화면에 다시 표시하기 위한 암호화 키는 아래 계약을 따른다.

```txt
PRESENTATION_PASSCODE_ENCRYPTION_KEY=<32-byte key encoded as base64>
PRESENTATION_PASSCODE_ENCRYPTION_KEY_VERSION=1
PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY=
PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY_VERSION=
```

현재 키는 정확히 32 byte를 base64로 인코딩해야 한다. 회전할 때는 새 key/version을
현재 값으로 올리고, 기존 key/version을 `PREVIOUS` 쌍으로 유지한다. 이전 값 두 개는
항상 함께 설정하거나 함께 비워야 하며 현재 버전과 같을 수 없다. 원문 입장 코드는
저장하지 않고 session ID를 AAD로 사용하는 AES-256-GCM ciphertext만 저장한다.

모든 PR과 `develop` push에서는 `Environment Contract CI`가 세 환경 예시 파일의 key 집합, 필수 key, 중복 선언, 선언 형식, 허용되지 않은 빈 값을 검사한다. 선택 기능 또는 secret store에서 주입하는 값처럼 비어 있을 수 있는 key는 `infra/scripts/check-env.mjs`의 환경별 allowlist에 명시한다. 실제 개인 서버 값은 PR CI에 노출하지 않고, 배포 직전에 Doppler 환경에서 `infra/scripts/check-personal-staging-env.sh`로 존재 여부만 확인한다. Doppler `orbit / stg` 변경은 GitHub workflow dispatch를 통해 개인 서버의 앱 컨테이너에 자동 재적용하며, 필수값 누락·공백 또는 Compose 검증 실패 시 실행 중인 컨테이너를 교체하지 않는다.

개인 서버의 key source와 전달 방식은 `infra/env/personal-staging-env-policy.json`에 명시한다. `repo-default`는 저장소에 커밋할 수 있는 일반 설정, `doppler-optional`은 운영자 override, `doppler-required`는 환경별 값 또는 secret이다. `delivery=compose`인 key는 `docker-compose.yml` 또는 `docker-compose.staging.yml`에 명시적으로 전달되어야 하고, `delivery=code-default`는 개인 서버에서 runtime 기본값을 사용한다. PR CI는 예시 파일의 모든 key가 정책에 정확히 한 번 분류됐는지와 Compose 전달 선언이 정책과 일치하는지 함께 검사한다.

`develop` push의 full 배포는 개인 서버를 변경하기 전에 GitHub Environment `personal-staging`의 `DOPPLER_STG_SYNC_TOKEN`으로 `pnpm env:sync:stg:apply`를 실행한다. 이 token은 Doppler `orbit / stg` config에만 read/write 권한을 가진 별도 service token이어야 하며 개인 서버 runtime의 read-only token과 분리한다. 동기화는 Doppler에 없는 `repo-default` + `delivery=compose` key만 `.env.staging.example`의 일반 설정값으로 한 번에 추가하고, 기존 key와 `doppler-required` 및 `doppler-optional` 값은 갱신하거나 자동 생성하지 않는다. 필수 수동 값이 없으면 full 배포를 시작하지 않는다.

`pnpm env:sync:stg`는 같은 정책을 Doppler 값 대신 key 이름만 읽어 확인하는 로컬 dry-run이다. 자동 동기화가 Doppler를 변경하면 기존 webhook의 `environment-only` 요청은 full 배포와 같은 concurrency group에서 후속 실행된다. 새 key가 없으면 Doppler 변경과 webhook 요청도 발생하지 않는다.

`API_JSON_BODY_LIMIT_BYTES`는 API의 JSON request body 최대 크기다. 기본값은 `5000000`이며, full deck 저장(`PUT /api/v1/projects/:projectId/deck`)처럼 checkpoint용 Deck JSON을 보내는 경로가 Express 기본값 100KB에 걸리지 않도록 명시한다.

`API_TRUST_PROXY_HOPS`는 API 앞에서 신뢰할 reverse proxy hop 수다. 직접 접속하는 local/test는 `0`, ALB 또는 단일 Nginx 뒤의 staging/production은 `1`을 사용한다. 실제 proxy 수보다 크게 설정하면 외부 `X-Forwarded-For`를 신뢰하게 되므로 배포 topology와 정확히 맞춰야 한다.

## driver 값

```txt
STORAGE_DRIVER=minio | s3
JOB_QUEUE_DRIVER=bullmq
AI_DECK_EXECUTION_MODE=monolith | bullmq | pg
AI_DECK_WORKER_QUEUE=all | reference-extract | research-content | design-layout | image | qa-finalize
AI_DECK_WORKER_CONCURRENCY=1..32
AI_DECK_USER_CONCURRENCY=1..32
LIVE_STT_PROVIDER=sherpa
LIVE_STT_ENGINE=openai-realtime | web-speech
REPORT_STT_PROVIDER=openai | whisperx
OCR_PROVIDER=python | textract
LLM_PROVIDER=openai
```

현재 `.env.example`, `.env.staging.example`, `.env.production.example` 템플릿은 다른 비동기 Job의 transport로 `JOB_QUEUE_DRIVER=bullmq`를 사용한다. AI Deck stage transport는 `AI_DECK_EXECUTION_MODE`가 별도로 결정한다. `JOB_QUEUE_DRIVER=sqs`는 지원하지 않으며 Worker startup이 실패한다.

`AI_DECK_EXECUTION_MODE`의 코드 fallback은 `bullmq`지만 로컬 `.env.example`의 명시적 기본값은 `pg`, `AI_DECK_WORKER_QUEUE`의 기본값은 `all`이다. `AI_DECK_WORKER_CONCURRENCY`와 `AI_DECK_USER_CONCURRENCY`는 각각 5가 기본값이며 `pg`에서만 AI Deck 실행 상한으로 사용한다. 로컬 `docker-compose.yml`의 API와 Worker는 이 값을 별도 `environment` 항목으로 덮어쓰지 않고 `.env.local`에서 읽는다. `.env.staging.example`과 `.env.production.example`은 별도 cutover 전까지 명시적 `monolith`/`all`을 유지하므로 코드 배포가 staging·production을 `pg`로 자동 전환하지 않는다.

현재 지원하는 조합은 다음과 같다.

| `AI_DECK_EXECUTION_MODE` | `AI_DECK_WORKER_QUEUE` | 현재 동작                                                                                                                            |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `monolith`               | `all`                  | 회귀 검증과 운영 rollback용 기존 full-deck 호환 경로를 실행한다. 제거 대상이 아니다.                                                  |
| `bullmq`                 | `all`                  | rollback용 staged 경로다. coordinator부터 OCR·planning·image·QA·publication 전체 queue, dispatcher와 reconciler를 실행한다.          |
| `bullmq`                 | `reference-extract`    | `generate-deck` coordinator queue와 `reference-extract` queue만 소비한다. 다른 Job queue를 처리할 `all` Worker가 별도로 있어야 한다. |
| `bullmq`                 | `research-content`     | `source-grounding`, `content-planning` queue만 소비한다.                                                                             |
| `bullmq`                 | `design-layout`        | `design-planning`, `layout-compile` queue만 소비한다.                                                                                |
| `bullmq`                 | `image`                | `image-slide` queue만 소비한다. legacy에서는 image 대상 slide, v2에서는 모든 slide의 상세 생성·asset·QA shard를 처리한다.             |
| `bullmq`                 | `qa-finalize`          | `semantic-quality`, `rendered-visual-quality`, `publication` queue만 소비한다.                                                       |
| `pg`                     | `all`                  | 로컬 기본값. `ai_deck_generation_stages`를 직접 claim한다. AI Deck BullMQ coordinator·stage queue는 enqueue/consume하지 않고 process 전체 5개, 사용자 전체 5개 기본 상한을 적용한다. |

`AI_DECK_EXECUTION_MODE=sqs`는 도입 취소된 미지원 값이며 API와 Worker가 startup에서 거부한다. dedicated role은 `bullmq` 실행 모드에서만 허용되고 `pg`는 `all`만 허용된다. 지원되지 않는 값을 설정해 겉보기에는 정상인 비활성 Worker가 뜨는 동작은 허용하지 않는다.

## 서버 로그

서버 로그는 stdout JSON을 기본으로 한다.

```txt
LOG_LEVEL=trace | debug | info | warn | error | fatal | silent
LOG_PRETTY=false | true
```

`LOG_PRETTY=true`는 `NODE_ENV=development`에서만 허용한다.
staging/production에서는 CloudWatch 수집을 위해 `LOG_PRETTY=false`를 유지한다.
업무 이벤트 로그와 금지 데이터 기준은 `docs/conventions/logging.md`를 따른다.

## 인증 cookie secure override

기본 인증 cookie는 `APP_ENV=local` 또는 `APP_ENV=test`에서만 non-secure로 설정되고, `APP_ENV=staging` 또는 `APP_ENV=production`에서는 secure cookie를 사용한다.

개인 서버의 임시 HTTP demo처럼 TLS가 아직 없는 staging 검증 경로에서만 다음 값을 사용할 수 있다. 이때 `WEB_ORIGIN`과 `API_BASE_URL`은 모두 `http://` origin이어야 한다.

```txt
AUTH_COOKIE_SECURE=false
```

이 값은 개인 서버 develop demo 전용 예외다. production에서는 `AUTH_COOKIE_SECURE=false`를 사용할 수 없고, `https://` staging origin과 함께 설정하면 startup이 실패한다. HTTPS를 적용한 staging은 값을 비우거나 `true`로 설정한다.

## OpenAI 기본 모델

OpenAI 모델은 코드 상수가 아니라 env로 결정한다.

```txt
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper
OPENAI_REALTIME_TRANSCRIPTION_DELAY=minimal
OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS=600
LIVE_STT_ENGINE=web-speech
AI_SLIDE_IMAGE_REVIEW_MODE=auto
ORBIT_PPTX_OOXML_VECTOR_IMPORT=true
```

리허설 리포트의 시간 기반 지표를 계산해야 하는 local/staging report STT는 `OPENAI_TRANSCRIPTION_MODEL=whisper-1`을 사용한다. `whisper-1`의 `verbose_json` 응답은 duration과 segment timestamp를 제공하므로 WPM, 구간별 속도, 긴 침묵 계산에 사용할 수 있다. production 모델은 전사 정확도와 시간 지표 요구를 함께 검토한 뒤 별도로 고정한다.

브라우저 리허설 Live STT의 실행 엔진은 API runtime config가 내려주는 `LIVE_STT_ENGINE=openai-realtime | web-speech` 값이 우선한다. presenter localStorage의 `sttEngine` 값은 실행 엔진을 덮어쓰지 않는다. 기본값은 `web-speech`이며 Chrome Web Speech on-device 경로를 사용한다. `LIVE_STT_ENGINE=openai-realtime`로 설정하면 API가 프로젝트 권한 확인 후 OpenAI Realtime transcription client secret을 발급한다. `OPENAI_REALTIME_TRANSCRIPTION_MODEL` 기본값은 `gpt-realtime-whisper`이고, `OPENAI_REALTIME_TRANSCRIPTION_DELAY`는 `minimal | low | medium | high | xhigh`, `OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS`는 10초부터 7200초까지 허용한다.

`LIVE_STT_ENGINE=web-speech`는 Chrome Web Speech on-device 경로를 사용한다. 이 값에서는 OpenAI Realtime client secret을 요청하지 않으며, 브라우저가 온디바이스 Web Speech 또는 한국어 언어팩을 지원하지 않으면 OpenAI로 자동 fallback하지 않고 명확한 Live STT 시작 오류를 표시한다.

`AI_SLIDE_IMAGE_REVIEW_MODE=auto | off`는 텍스트 겹침 후보가 있는 슬라이드 PNG preview 검증을 제어한다. `auto`는 기존 `OPENAI_API_KEY`와 `OPENAI_MODEL`을 쓰고, `off`는 이미지 호출 없이 rule-based warning만 남긴다.

`ORBIT_PPTX_OOXML_VECTOR_IMPORT=true | false`는 PPTX import에서 OOXML XML 직접 파서 기반 visual tree 추출 경로를 제어한다. 기본값 `true`는 OOXML visual tree importer를 먼저 사용하고, `false`는 기존 `python-pptx` 기반 importer를 사용한다.

로컬과 테스트에서는 `OPENAI_API_KEY`를 비워둘 수 있지만, staging/production에서는 반드시 secret store에 설정한다.

STT/AI provider는 목적별로 분리한다.

- `LIVE_STT_PROVIDER=sherpa`: device-local runtime provider 계약이다. 브라우저 리허설 실행 엔진 선택에는 사용하지 않는다.
- `LIVE_STT_ENGINE=openai-realtime | web-speech`: 브라우저 Live STT 실행 엔진 계약이다. API가 `/api/v1/runtime-config`로 노출하고 web은 이 값을 presenter localStorage보다 우선한다.
- `REPORT_STT_PROVIDER=openai | whisperx`: 리허설 종료 후 녹음 파일을 전사하고 코칭 리포트를 만들기 위한 서버 리포트 STT다. `whisperx`는 hosted API provider이며 live-control STT로 선택할 수 없다.
- `LLM_PROVIDER=openai`: 전사 결과, 발표자료, 키워드, 청중 반응 등을 종합해 리포트와 코칭 문장을 생성하는 AI provider다.

Report STT에 업로드하는 `rehearsal-audio`는 MP3, MP4, MPEG, MPGA, M4A, FLAC, WAV, WebM 계열만 허용한다. `REPORT_STT_PROVIDER=openai` 단일 파일 전사 경로에서는 `REHEARSAL_AUDIO_MAX_BYTES` 기본값과 최대값이 `25000000`이다. `REPORT_STT_PROVIDER=whisperx`를 사용하려면 `WHISPERX_API_URL`, `WHISPERX_API_KEY`, `WHISPERX_MODEL`, `WHISPERX_TIMEOUT_MS`를 설정한다.

## Adaptive Rehearsal Coach

```txt
ADAPTIVE_REHEARSAL_COACH_ENABLED=false
FOCUSED_PRACTICE_ENABLED=false
CHALLENGE_QNA_ENABLED=false
SLIDE_PRACTICE_ENABLED=false
SLIDE_QUESTION_GUIDES_ENABLED=false
DEMO_COACHING_FIXTURE_ENABLED=false
DEMO_AI_DECK_CACHE_ENABLED=false
DEMO_AI_DECK_SOURCE_PROJECT_ID=
DEMO_AI_DECK_TRIGGER_TOPIC=
DEMO_FIXTURE_ENV_ALLOWLIST=local,test
ADAPTIVE_COACHING_PROJECT_ALLOWLIST=project_demo_1
PRIVATE_EVIDENCE_REDIS_URL=redis://localhost:6380
COACHING_IDEMPOTENCY_HMAC_SECRET=
COACHING_IDEMPOTENCY_HMAC_KEY_VERSION=1
COACHING_IDEMPOTENCY_HMAC_PREVIOUS_SECRET=
COACHING_IDEMPOTENCY_HMAC_PREVIOUS_KEY_VERSION=
```

`packages/config`의 두 slide 기능 기본값은 안전하게 `false`를 유지한다. 다만
AWS `main` production 계약은 모든 project에 기능을 공개하기 위해
`SLIDE_PRACTICE_ENABLED=true`와 `SLIDE_QUESTION_GUIDES_ENABLED=true`를
명시한다. 현재 두 flag에는 project allowlist가 없으므로 제한된 rollout이
필요하면 flag를 켜기 전에 별도 계약을 추가해야 한다.

Focused Practice나 Challenge Q&A를 켜려면 Adaptive core도 켜야 한다. project allowlist가 비어 있으면 모든 project를 거부하고 `*`는 전체 project를 허용한다. demo fixture는 environment allowlist와 demo marker가 함께 일치해야 하며 production에서는 활성화할 수 없다. private evidence Redis와 HMAC secret은 browser runtime config에 노출하지 않는다. production HMAC secret은 32자 이상이어야 하고, 이전 secret과 key version은 rotation 기간에만 함께 설정한다.

`DEMO_AI_DECK_CACHE_ENABLED=true`는 시연용 AI PPT 캐시 재생을 켠다. 이때 `DEMO_AI_DECK_SOURCE_PROJECT_ID`에는 검수 완료 덱이 저장된 source project를, `DEMO_AI_DECK_TRIGGER_TOPIC`에는 시연 입력 문구를 설정해야 한다. 기능은 `APP_ENV`가 `DEMO_FIXTURE_ENV_ALLOWLIST`에 있고 요청 사용자가 `DEMO_USER_ID`이며, 공백을 정규화한 topic이 trigger와 정확히 일치할 때만 동작한다. production에서는 시작 단계에서 활성화를 거부한다.

## Demo ID

Demo ID 기반 기능은 아래 값을 사용한다.

```txt
DEMO_USER_ID=user_demo_1
DEMO_WORKSPACE_ID=workspace_demo_1
DEMO_PROJECT_ID=project_demo_1
DEMO_DECK_ID=deck_demo_1
DEMO_SESSION_ID=session_demo_1
```

Demo ID를 바꿔야 하면 `docs/demo-standards.md`, `.env.example`, `packages/shared`를 함께 수정한다.
