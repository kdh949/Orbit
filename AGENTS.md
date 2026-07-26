# ORBIT Agent Rules

이 파일은 저장소 최상위 필수 규칙이다. 작업 파일과 가까운 하위 `AGENTS.md`를
함께 적용하고, 충돌하면 더 가까운 규칙을 따른다.

## 작업 시작

- 대상 파일을 찾은 직후 `pnpm agent:context --path <target-file>`을 실행한다.
- 등록 도메인은 `pnpm agent:context --list`, 검증은
  `pnpm verify:scope <area>:<domain> --dry-run`으로 먼저 좁힌다.
- Web/API/Worker/Python처럼 영역이 분명하면 해당 디렉터리에서 시작한다.
- 요청 밖 리팩터링, 파일 이동, 대량 포맷팅, 외부 서비스 변경을 하지 않는다.

## 리뷰와 보안

- GitHub PR의 Codex 리뷰 요약과 inline comment는 한국어로 작성한다.
- 코드 식별자, 경로, API, 환경변수, 오류, 명령, schema key, enum은 원문을 유지한다.
- `P0`, `P1` severity label은 유지하고 설명과 권장 조치는 한국어로 작성한다.
- `.env` 값, API key, token, cookie, password, credential, secret은 출력하지 않는다.
- correctness, security, architecture boundary, schema compatibility, missing test처럼
  실제 merge 위험에 집중한다.

## 영역과 공통 계약

- Web: `apps/web`, 필요 시 `packages/shared`, `packages/editor-core`,
  `packages/realtime`.
- API: `apps/api`, 필요 시 `packages/shared`, `packages/config`,
  `packages/storage`, `packages/job-queue`, `packages/realtime`.
- Worker: `apps/worker`, 필요 시 `packages/shared`, `packages/job-queue`,
  `packages/storage`, `packages/ai`.
- Python: `services/python-worker`.
- 공통 request/response, Job, WebSocket payload는 `packages/shared` Zod schema가
  source of truth다. Deck JSON은 Konva 상태가 아니라 shared schema를 따른다.
- File 결과는 `fileId`, `projectId`, `purpose`, `url`, `createdAt`을 유지한다.
- Job 상태는 `queued`, `running`, `succeeded`, `failed`를 유지한다.
- WebSocket envelope은 `roomId`, `sessionId`, `userId`, `payload`, `sentAt`을 유지한다.
- 계약 변경은 `docs/contracts.md`, domain 문서, shared schema와 consumer 검증을
  함께 갱신한다.

## 구현 원칙

- 외부 입력과 Python/AI/STT/OCR 결과를 Zod 또는 Pydantic으로 검증한다.
- DB 변경은 TypeORM migration으로 관리한다.
- 저장소는 `StoragePort`, queue는 `JobQueuePort`, provider는 interface 뒤에 둔다.
- enqueue, Worker 처리, 외부 provider 호출, 사용자 상태 변경에는 업무 이벤트를
  남기되 secret, raw audio, transcript, 발표자 script, file base64를 기록하지 않는다.
- 발표자 script와 raw audio를 청중 API로 노출하지 않는다.
- 버그 수정에는 가능한 한 재발 방지 테스트를 추가한다.
- Python dependency는 `pyproject.toml`/`uv.lock`, JS/TS dependency는
  `package.json`/`pnpm-lock.yaml`로 관리한다.

## Git과 검증

- 원격 조회·push·PR·merge는 별도 지시가 없으면 `kdh949/Orbit`만 대상으로 한다.
- `main`에 직접 커밋하지 않고 브랜치와 PR을 사용한다.
- 공유 브랜치에 rebase 또는 force push하지 않는다.
- 최신 base 반영은 clean tree에서 `git fetch origin <base> --prune` 후
  `git merge origin/<base>`를 사용한다.
- 가장 가까운 하위 `AGENTS.md`의 targeted 검증을 먼저 실행한다.
- 여러 workspace 또는 shared contract 변경은 `pnpm verify:affected --dry-run` 후
  실제 명령을 실행한다.
- 전체 TypeScript gate는 `pnpm build`, `pnpm format:check`, `pnpm typecheck`,
  `pnpm test`다. 환경/Compose 변경은 `node infra/scripts/check-env.mjs`와
  `docker compose config --quiet`를 추가한다.
- 테스트를 실행하지 못하면 이유와 남은 범위를 결과와 PR에 기록한다.

## 상세 문서

- Agent dispatch와 검증: `docs/agent/workspace-dispatch.md`,
  `docs/agent/verification.md`
- 계약: `docs/contracts.md`
- Git/PR: `docs/git-rules.md`
- 환경/로그: `docs/conventions/environment.md`, `docs/conventions/logging.md`
- 로컬 개발: `docs/runbooks/local-development.md`
- 아키텍처/버전: `docs/architecture/local-first-stack.md`,
  `docs/architecture/tech-stack-versions.md`
