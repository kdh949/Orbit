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

## driver 값

```txt
STORAGE_DRIVER=minio | s3
JOB_QUEUE_DRIVER=bullmq | sqs
LIVE_STT_PROVIDER=sherpa
REPORT_STT_PROVIDER=openai | whisperx
OCR_PROVIDER=python | textract
LLM_PROVIDER=openai
```

현재 `.env.example`, `.env.staging.example`, `.env.production.example` 템플릿은 구현 완료된 BullMQ/Redis 경로를 기준으로 `JOB_QUEUE_DRIVER=bullmq`를 사용한다. `JOB_QUEUE_DRIVER=sqs`는 AWS SQS adapter 구현 후 활성화한다.

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
AI_SLIDE_IMAGE_REVIEW_MODE=auto
ORBIT_PPTX_OOXML_VECTOR_IMPORT=true
```

리허설 리포트의 시간 기반 지표를 계산해야 하는 local/staging report STT는 `OPENAI_TRANSCRIPTION_MODEL=whisper-1`을 사용한다. `whisper-1`의 `verbose_json` 응답은 duration과 segment timestamp를 제공하므로 WPM, 구간별 속도, 긴 침묵 계산에 사용할 수 있다. production 모델은 전사 정확도와 시간 지표 요구를 함께 검토한 뒤 별도로 고정한다.

브라우저 리허설 Live STT의 기본 엔진은 `openai-realtime`이며 API가 프로젝트 권한 확인 후 OpenAI Realtime transcription client secret을 발급한다. `OPENAI_REALTIME_TRANSCRIPTION_MODEL` 기본값은 `gpt-realtime-whisper`이고, `OPENAI_REALTIME_TRANSCRIPTION_DELAY`는 `minimal | low | medium | high | xhigh`, `OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS`는 10초부터 7200초까지 허용한다.

`AI_SLIDE_IMAGE_REVIEW_MODE=auto | off`는 텍스트 겹침 후보가 있는 슬라이드 PNG preview 검증을 제어한다. `auto`는 기존 `OPENAI_API_KEY`와 `OPENAI_MODEL`을 쓰고, `off`는 이미지 호출 없이 rule-based warning만 남긴다.

`ORBIT_PPTX_OOXML_VECTOR_IMPORT=true | false`는 PPTX import에서 OOXML XML 직접 파서 기반 visual tree 추출 경로를 제어한다. 기본값 `true`는 OOXML visual tree importer를 먼저 사용하고, `false`는 기존 `python-pptx` 기반 importer를 사용한다.

로컬과 테스트에서는 `OPENAI_API_KEY`를 비워둘 수 있지만, staging/production에서는 반드시 secret store에 설정한다.

STT/AI provider는 목적별로 분리한다.

- `LIVE_STT_PROVIDER=sherpa`: device-local runtime provider 계약이다. 브라우저 리허설 엔진 선택은 presenter settings의 `sttEngine`으로 관리하며 기본값은 `openai-realtime`이다.
- `REPORT_STT_PROVIDER=openai | whisperx`: 리허설 종료 후 녹음 파일을 전사하고 코칭 리포트를 만들기 위한 서버 리포트 STT다. `whisperx`는 hosted API provider이며 live-control STT로 선택할 수 없다.
- `LLM_PROVIDER=openai`: 전사 결과, 발표자료, 키워드, 청중 반응 등을 종합해 리포트와 코칭 문장을 생성하는 AI provider다.

Report STT에 업로드하는 `rehearsal-audio`는 MP3, MP4, MPEG, MPGA, M4A, FLAC, WAV, WebM 계열만 허용한다. `REPORT_STT_PROVIDER=openai` 단일 파일 전사 경로에서는 `REHEARSAL_AUDIO_MAX_BYTES` 기본값과 최대값이 `25000000`이다. `REPORT_STT_PROVIDER=whisperx`를 사용하려면 `WHISPERX_API_URL`, `WHISPERX_API_KEY`, `WHISPERX_MODEL`, `WHISPERX_TIMEOUT_MS`를 설정한다.

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
