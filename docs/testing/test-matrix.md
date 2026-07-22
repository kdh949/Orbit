# Test Matrix

이 문서는 기능 범위와 자동/수동 검증을 연결한다. PR에서는 이 표의 "검증 앵커"와 실제 테스트 결과를 함께 확인한다.

이 문서의 `ORBIT-*` 값은 기존 기능과 테스트를 찾기 위한 레거시 식별자다. 현재 프로젝트는 Jira를 사용하지 않으며, 새 브랜치·커밋·PR·테스트에 Jira 이슈 키를 요구하지 않는다.

## Verification Policy

| 시점 | 실행 항목 | 목적 |
| --- | --- | --- |
| docs-only PR | 변경 Markdown UTF-8 읽기 확인 | 구현과 무관한 PR에서 코드 테스트 미실행 사유를 PR 본문에 남김 |
| 모든 PR | Environment Contract CI: wrapper `bash -n`, `node infra/scripts/check-env.mjs`, `node --test infra/scripts/personal-staging-env.test.mjs infra/scripts/personal-staging-wrapper.test.mjs` | 환경 예시 파일의 키 누락·불일치·중복·필수값 공백, 개인 서버 source/delivery 정책·Compose 전달 누락과 자동 동기화 wiring, root wrapper의 문법·절대경로·인자 전달·최소 권한 계약을 빠르게 차단 |
| automation-only PR | Environment Contract CI와 automation JSON 확인, Node script syntax check, 필요한 경우 `pnpm lint` | workflow/script/schema 변경 자체를 검증 |
| app/API/shared/worker/compose/env/lockfile PR | Environment Contract CI; TypeScript CI: `pnpm build`, `pnpm lint`, `pnpm test`; 수동: Python `ruff/mypy/pytest`, `docker compose config --quiet` 중 변경 경로와 관련된 명령 | 환경 계약과 빠른 TypeScript 회귀를 자동 확인하고, Python/Compose 계층은 필요 시 수동 확인 |
| `develop` push | Environment Contract CI direct job과 TypeScript CI 자동 실행, 안전한 repo default의 Doppler 동기화, 개인 서버 full 배포, 공통 `personal-staging-deploy` concurrency | merge 후 환경 계약과 base branch TypeScript 조합을 검증하고 reusable secret 경계 없이 누락된 일반 설정을 적용한 뒤 전체 배포를 직렬화 |
| personal staging 수동 복구 | 기존 `Deploy Personal Staging`을 `develop`, `full`, `manual`로 새 실행해 Doppler sync와 full 배포 | 기본 브랜치의 기존 dispatch entrypoint로 새 run ID를 만들고 갱신된 Environment secret 주입과 전체 배포를 동일 concurrency group에서 검증 |
| Doppler `orbit / stg` 변경 | `Deploy Personal Staging`의 `environment-only` 실행, stable wrapper의 mode·SHA 전달, 서버 env preflight, Compose config, API/root health check | 유효한 secret 변경만 앱 컨테이너에 재적용하고 누락·공백이면 기존 컨테이너 유지 |
| `main` push | 자동 CI 없음 | release branch 조합 검증은 필요 시 수동으로 실행 |
| 수동 또는 scheduled | `pnpm test:smoke`, 전체 Playwright E2E, 1000명 load test, 실제 브라우저 STT 측정 | 무겁거나 환경 의존적인 검증 |

현재 GitHub Actions CI는 모든 PR의 Environment Contract CI와 변경 경로 기반 TypeScript CI를 자동 실행한다. Python worker, Docker Compose, Playwright smoke처럼 환경 의존성이 큰 검증이 필요하면 로컬 또는 별도 실행 환경에서 실행하고 PR 본문에 결과를 남긴다.

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

## AI PPT OOXML reference fidelity mode

이 표의 `자동 통과`는 해당 구현 task의 fixture/contract 검증 상태이며 checkpoint 승인과
동일하지 않다. private managed storage, 승인된 annotation, 실제 7개 full-deck artifact와
사람 검수가 필요한 항목은 자동 테스트가 통과해도 `승인 보류`로 유지한다.

| 범위 | 현재 상태 | 자동 검증 앵커 | 남은 승인 증거 |
| --- | --- | --- | --- |
| Task 1 source inventory/security | 자동 통과 | `test_ooxml_reference_inventory.py`와 실제 7개 source dry-run | private storage upload/ACL과 권리 승인 |
| Task 2 strict 공통 계약 | 자동 통과 | shared Zod/Python mirror contract test | 없음 |
| Task 3 private catalog | 자동 통과, 전체 disabled | registry/catalog test | preview asset와 checksum, managed storage |
| Task 4 annotation pipeline | 자동 통과 | annotation candidate/locator/locked inventory test | 실제 139장 annotation과 사람 승인 |
| Checkpoint A | 승인 보류 | inventory/schema/security fixture | 승인된 manifest/preview/license/private ACL |
| Task 5 raw clone | 자동 통과 | clone/package validator test, 10장 LibreOffice/PowerPoint reopen | 승인된 Checkpoint A |
| Checkpoint B1 | 기술 spike 통과, 승인 보류 | 10장 relationship warning 0, source/layout diversity, pixel identity | Checkpoint A와 사람 검수 |
| Task 6 text/image slot | 자동 통과 | text/image capacity·style·media preservation test | 실제 승인 slot fixture |
| Task 7 materialization | 자동 통과 | Python materialization과 Worker transaction test | 실제 private storage publication |
| Task 8 fidelity harness | 자동 통과 | identity/masked comparison과 known drift test | 7개 renderer baseline과 threshold 승인 |
| Checkpoint B2 | 자동 경로 통과, 승인 보류 | Postgres round-trip integration 6 tests, `ai-ppt-ooxml-editor-roundtrip-spike.md` | 실제 slot montage와 사람 승인 |
| Task 9 content/sequence planner | 자동 통과 | 7-family table-driven role/capacity/evidence/repetition tests | 승인된 7개 annotation fixture |
| Task 10 table slot | 자동 통과 | reference table replacement + 기존 table sync 26 tests | 실제 template table fixture/reopen |
| Task 11a chart package replacement | 자동 통과 | chart/workbook atomic replacement test, PowerPoint/LibreOffice fixture reopen | 실제 template chart montage와 사람 검수 |
| Task 14 Python option projection | 자동 통과, API 미연결 | options + registry 18 tests | Task 13 Job과 authenticated API/preview 연결 |

최종 gate는 계획 문서의 전체 검증 매트릭스를 따른다. LibreOffice 결과를 Microsoft
PowerPoint QA로 대체하지 않으며, `not-run` 환경 증거를 `passed`로 승격하지 않는다.
