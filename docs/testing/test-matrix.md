# Test Matrix

이 문서는 기능 범위와 자동/수동 검증을 연결한다. PR에서는 이 표의 "검증 앵커"와 실제 테스트 결과를 함께 확인한다.

이 문서의 `ORBIT-*` 값은 기존 기능과 테스트를 찾기 위한 레거시 식별자다. 현재 프로젝트는 Jira를 사용하지 않으며, 새 브랜치·커밋·PR·테스트에 Jira 이슈 키를 요구하지 않는다.

## Verification Policy

2026-08-30 현재 `develop` push와 수동 dispatch에는 개인 staging 이미지를 만드는
`.github/workflows/build-personal-staging-images.yml`이 있다. 이 workflow는 환경·배포
계약을 검증하고 네 앱 이미지를 동일 commit SHA로 GHCR에 게시하지만 개인 서버에는
접속하지 않는다. Pull request와 다른 범위는 작성자가 로컬 또는 별도 실행 환경에서
검증하고 결과를 PR 본문에 기록한다.

| 시점 | 실행 항목 | 목적 |
| --- | --- | --- |
| docs-only PR | 변경 Markdown UTF-8 읽기 확인 | 구현과 무관한 PR에서 코드 테스트 미실행 사유를 PR 본문에 남김 |
| Agent/repository tooling PR | `node --test tools/agent/*.test.mjs`, `pnpm repo:doctor` | Agent가 사용하는 경로·문서·검증 도구의 회귀 차단 |
| TypeScript app/package PR | 변경 package의 `typecheck`, targeted `test`, 필요한 경우 `build` | 변경 범위의 타입·동작·빌드 회귀 확인 |
| Python worker PR | `uv run ruff check .`, `uv run mypy app`, targeted `uv run pytest` | Python style, type, domain 회귀 확인 |
| env/compose/automation PR | `node infra/scripts/check-env.mjs`, 관련 Node test, `docker compose config --quiet`, shell syntax check | 환경 키, Compose 전달, wrapper 계약 확인 |
| `develop` push | personal staging 계약 검증, API·Worker·Python worker·Web GHCR image build | 성공한 동일 SHA 이미지 집합을 수동 배포 대상으로 준비 |
| `main` push | 이 workflow의 자동 검증·배포 없음 | production 검증·배포 근거를 별도 기록 |
| 개인 staging 배포 | Sophos VPN/관리 LAN SSH에서 `deploy-personal-server.sh <sha>` 수동 실행 | GHCR의 검증된 SHA 이미지를 pull하고 migration·health check 수행 |
| 수동 또는 scheduled | `pnpm test:smoke`, 전체 Playwright E2E, 1000명 load test, 실제 브라우저 STT 측정 | 무겁거나 환경 의존적인 검증 |

Python worker, Docker Compose, Playwright smoke처럼 환경 의존성이 큰 검증을 실행하지
못하면 PR 본문에 미실행 사유와 남은 검증 범위를 남긴다.

## PR Review Rule

- PR 본문에는 완료하는 작업 범위마다 완료 기준, 검증 방법, 테스트 파일 또는 수동 증거를 적는다.
- 자동화 가능한 기준은 unit/API/Python/Playwright 테스트로 고정한다.
- STT 품질, 1000명 fanout, 브라우저 마이크처럼 환경 의존적인 기준은 smoke/manual evidence와 별도 결과 문서로 남긴다.
- 테스트 이름이나 `describe` 이름에는 가능하면 검증 대상 기능명을 포함한다.

## Milestone Matrix

| 레거시 기능 ID | 범위 | 주요 완료 기준 | 검증 앵커 |
| --- | --- | --- | --- |
| ORBIT-1 | 시작 준비 epic | 로컬 서비스, migration, 온디바이스 STT 기준 준비 | `pnpm build`, `pnpm lint`, Python pytest, Compose, STT 문서 review |
| ORBIT-2 | 프로젝트 scaffold | workspace build/test, Compose 서비스 시작 | 수동 `pnpm build`, `pnpm test`, Python pytest, Compose 검증 |
| ORBIT-3 | DB migration | pgvector 연결, migration run/revert | migration spec, `pnpm db:migration:run`, `pnpm db:migration:revert` |
| ORBIT-4 | 온디바이스 STT spike | model artifact, size/load/latency/keyword 기준 문서화 | `docs/spikes/on-device-stt.md`, manual Chrome evidence |
| ORBIT-5 | M0 checkpoint | 시작 준비 결과 점검 | Compose health, migration, STT doc checklist |
| ORBIT-6 | 플랫폼 epic | 로그인부터 업로드/작업 시작까지 연결 | 하위 ORBIT-7..12 테스트 |
| ORBIT-7 | 환경변수 | 필수 env 검증, 예시 파일 정합성 | env schema tests, `node infra/scripts/check-env.mjs` |
| ORBIT-8 | 인증/세션 | 회원가입, 로그인, 세션 유지 | `apps/api/src/auth/auth.service.spec.ts`, web auth tests |
| ORBIT-9 | 초대 링크 | 생성, 만료, 중복 사용, 권한 | planned API unit/integration tests |
| ORBIT-10 | 프로젝트/파일 업로드 | 프로젝트 생성, 업로드 결과 구조 유지 | `projects.service.spec.ts`, `files.service.spec.ts`, `ProjectAssetWorkspace.test.ts`, `tests/e2e/smoke.spec.ts` |
| ORBIT-11 | 작업큐/Python worker | Job 상태, worker health, 실패 상태 | planned job queue unit/API tests, Python health tests |
| ORBIT-12 | M1 checkpoint | 로그인부터 작업 시작까지 확인 | Playwright platform flow |
| ORBIT-13 | 편집기 epic | 덱 편집과 내보내기 흐름 | 하위 ORBIT-14..22 테스트 |
| ORBIT-14 | Deck 계약 | Deck/Patch/ChangeRecord schema | `packages/shared/src/deck/deck.schema.test.ts` |
| ORBIT-15 | 덱 저장/복원 | shared schema 기반 저장/복원/patch/snapshot | `apps/api/src/decks/decks.service.spec.ts` |
| ORBIT-16 | 편집기 shell | project deck open, slide navigation, empty/error state | planned web unit tests, Playwright editor smoke |
| ORBIT-17 | PPTX import | fixture import, fallback warning, deck JSON 검증 | planned Python fixture tests |
| ORBIT-18 | 객체 편집 | select/drag/resize/rotate, patch emission | planned editor-core geometry tests, Playwright editor manipulation |
| ORBIT-19 | Undo/redo | 50 action cap, redo invalidation, version safety | planned editor-core history tests |
| ORBIT-20 | Chart 편집 | chart schema, table editing, invalid data reject | planned shared/web chart tests |
| ORBIT-21 | Export | PPTX/PDF/image export, fallback/warnings | planned Python/API export tests |
| ORBIT-22 | M2 checkpoint | 프로젝트 생성부터 내보내기까지 확인 | Playwright vertical slice |
| ORBIT-23 | AI 생성 epic | 참고자료 기반 덱 생성 | 하위 ORBIT-24..28 테스트 |
| ORBIT-24 | 텍스트 추출 | PDF/PPTX/doc fixture extraction | planned Python parser tests |
| ORBIT-25 | 검색 저장 | chunking, embedding, pgvector search | planned API/Python embedding tests |
| ORBIT-26 | AI 덱 생성 | grounded deck generation, schema validation | planned AI provider fixture tests |
| ORBIT-28 | M3 checkpoint | AI 덱 생성 흐름 확인 | Playwright AI generation smoke |
| ORBIT-29 | 협업 epic | 다중 편집 안전성 | 하위 ORBIT-30..33 테스트 |
| ORBIT-30 | WebSocket 인증/방 | envelope, room join, auth failure | planned realtime gateway tests |
| ORBIT-31 | 덱 동기화 | multi-browser deck sync | planned realtime integration/Playwright tests |
| ORBIT-32 | 객체 잠금 | lock acquire/release/conflict | planned object-lock service tests |
| ORBIT-33 | M4 checkpoint | 협업 편집 안전성 | multi-browser Playwright flow |
| ORBIT-34 | 리허설 epic | 녹음/STT/보고서 | 하위 ORBIT-35..39 테스트 |
| ORBIT-35 | 키워드 편집 | keyword CRUD and validation | planned web/shared keyword tests |
| ORBIT-36 | 리허설 리포트 STT/코칭 | raw audio handling, report STT, report analysis | planned API/Python retention and STT fixture tests |
| ORBIT-37 | 점수/지표 | filler/pause/speed score calculation | planned Python metrics tests |
| ORBIT-38 | 리허설 보고서 UI | report loading/error/results | planned web report tests |
| ORBIT-39 | M5 checkpoint | 리허설부터 보고서까지 확인 | Playwright rehearsal flow |
| ORBIT-40 | 라이브 발표 epic | 발표자/청중 동기화 | 하위 ORBIT-41..47 테스트 |
| ORBIT-41 | 발표 세션/청중 입장 | session create, audience join | planned API/Playwright presentation tests |
| ORBIT-42 | 현재 슬라이드 전송 | slide event fanout | planned WebSocket tests |
| ORBIT-43 | 강조/애니메이션 동기화 | emphasis/animation state sync | planned realtime tests |
| ORBIT-44 | 온디바이스 STT 진행률 | transcript -> keyword progress | planned web unit/manual browser tests |
| ORBIT-45 | 1000명 load | p95 <= 1s target and report | manual/scheduled load harness |
| ORBIT-46 | 자동 슬라이드 전환 | keyword >=80%, script >=80%, manual override | planned auto-advance unit tests |
| ORBIT-47 | M6 checkpoint | live path without server STT | Playwright presentation smoke, load smoke |
| 신규 | 발표자 웹·실습 공유 | 같은 기기의 slide-window/surface swap에서 slide·screen-share·black 전환, 최신 slide 복귀, presenter privacy | presenter unit tests, `tests/e2e/presenter-screen.spec.ts`, `docs/qa/presenter-screen-share-mvp.md` |
| ORBIT-48 | 청중 참여 epic | Q&A, polls, surveys, final report | 하위 ORBIT-49..56 테스트 |
| ORBIT-49 | Q&A 제한 | 3 questions/min, filtered count | planned API rate-limit tests |
| ORBIT-50 | Live poll | start/stop/respond/visibility | planned API/web poll tests |
| ORBIT-51 | Survey | create/respond/report aggregation | planned API/web survey tests |
| ORBIT-52 | AI answer publish | grounded answer, presenter approval, script privacy | planned API/Python privacy tests |
| ORBIT-53 | Question grouping | semantic grouping and review | planned grouping fixture tests |
| ORBIT-54 | Final report | events/Q&A/polls/speech metrics | planned Python/API report tests |
| ORBIT-55 | Report export | PDF export and improvement suggestions | planned export/report tests |
| ORBIT-56 | M7 checkpoint | MVP full flow | release Playwright flow |
| ORBIT-57 | Release hardening epic | 수동 검증과 deployment docs ready | 하위 ORBIT-58..61 테스트 |
| ORBIT-58 | PR verification | PR 수동 검증, Docker build, Playwright smoke | PR template 검증표, `pnpm test:smoke` |
| ORBIT-59 | Privacy/retention tests | raw audio delete, no live upload, script privacy, no auto apply | planned API/Python privacy regression tests |
| ORBIT-60 | Staging docs | staging deployment runbook | docs review checklist |
| ORBIT-61 | Release checkpoint | release readiness | 수동 검증 결과와 release checklist |
| ORBIT-222 | Scoring thresholds | score weights and filler/pause thresholds | planned metrics unit tests after policy approval |
| ORBIT-223 | Live STT microphone input | getUserMedia constraints, unsupported fallback, keyword evidence | planned web unit tests plus manual Chrome evidence |

## Test Subtask Map

| 테스트 범위 | 상위 기능/domain | Required test level |
| --- | --- | --- |
| ORBIT-68 | ORBIT-2 scaffold | build/lint/test/Compose smoke |
| ORBIT-71 | ORBIT-3 migration | migration unit plus run/revert |
| ORBIT-75 | ORBIT-4 STT spike | manual browser plus spike doc evidence |
| ORBIT-81 | ORBIT-7 env | env schema/script tests |
| ORBIT-85 | ORBIT-8 auth | API service/controller tests |
| ORBIT-89 | ORBIT-9 invite | API integration tests |
| ORBIT-93 | ORBIT-10 project/upload | API unit/integration, web helper test, storage presign test, Playwright smoke |
| ORBIT-97 | ORBIT-11 jobs | API/worker tests |
| ORBIT-99 | ORBIT-14 deck schema | shared schema tests |
| ORBIT-102 | ORBIT-15 deck persistence | API service tests |
| ORBIT-104 | ORBIT-16 editor shell | web unit plus smoke |
| ORBIT-107 | ORBIT-18 object edit | editor-core unit plus Playwright |
| ORBIT-110 | ORBIT-19 undo/redo | editor-core history tests |
| ORBIT-113 | ORBIT-20 charts | shared/web tests |
| ORBIT-118 | ORBIT-17 PPTX import | Python fixture tests |
| ORBIT-123 | ORBIT-21 export | Python/API fixture tests |
| ORBIT-126 | ORBIT-24 document parse | Python fixture tests |
| ORBIT-129 | ORBIT-25 retrieval | API/Python embedding tests |
| ORBIT-135 | ORBIT-26 AI deck generation | AI provider fixture tests |
| ORBIT-139 | ORBIT-27 AI suggestions | shared validation, API approval/apply/reject, web panel/API helper tests |
| ORBIT-141 | ORBIT-30 WebSocket | realtime gateway tests |
| ORBIT-144 | ORBIT-31 sync | realtime integration tests |
| ORBIT-147 | ORBIT-32 locks | object lock service tests |
| ORBIT-151 | ORBIT-35 keywords | web/shared tests |
| ORBIT-156 | ORBIT-36 rehearsal report STT | API/Python retention tests |
| ORBIT-159 | ORBIT-37 metrics | Python metrics tests |
| ORBIT-163 | ORBIT-38 report UI | web report tests |
| ORBIT-167 | ORBIT-41 presentation session | API/Playwright tests |
| ORBIT-170 | ORBIT-42 slide sync | WebSocket tests |
| ORBIT-174 | ORBIT-43 emphasis sync | realtime tests |
| ORBIT-179 | ORBIT-44 live STT progress | web unit/manual browser tests |
| ORBIT-182 | ORBIT-46 auto advance | web unit tests |
| ORBIT-184 | ORBIT-45 load | load harness |
| ORBIT-188 | ORBIT-49 Q&A | API rate-limit tests |
| ORBIT-192 | ORBIT-52 AI answer | privacy/grounding tests |
| ORBIT-196 | ORBIT-53 grouping | grouping fixture tests |
| ORBIT-200 | ORBIT-50 polls | API/web poll tests |
| ORBIT-204 | ORBIT-51 surveys | API/web survey tests |
| ORBIT-209 | ORBIT-54 final report | API/Python report tests |
| ORBIT-213 | ORBIT-55 export/suggestions | export/report tests |
| ORBIT-215 | ORBIT-58 PR checks | workflow and smoke test |
| ORBIT-219 | ORBIT-59 privacy retention | API/Python privacy regression tests |
