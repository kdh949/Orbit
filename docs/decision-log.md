# Decision Log

이 문서는 자동 구현 세션에서 생긴 비자명한 정책, 아키텍처, 데이터 보관, 접근제어, 저장 결정의 기록이다.

## kdh home project fixture removal

- Context: 사용자가 `kdh@orbit.com` 홈에 고정으로 떠 있는 10개 발표자료 카드를 `develop`과 `main` 모두에서 제거하도록 요청했다. 두 브랜치의 관련 코드는 동일하다. `ensureKdhHomeProjects()`가 `list()` 호출마다 실행되므로 DB row만 지우면 다음 목록 조회에서 즉시 재생성된다.
- Options considered:
  - DB row만 삭제한다.
  - seed 코드만 제거하고 기존 row는 방치한다.
  - seed 코드·자산·테스트를 제거하고, 남은 row를 지우는 일회성 script를 함께 추가한다.
- Final decision: `kdh-home-project-seed.ts`와 spec, `home-project-covers` WebP 10개, `projects.service.ts`의 `ensureKdhHomeProjects()` 호출·정의를 제거한다. **접근 가드는 유지한다**: cleanup script는 배포 뒤 수동 실행이라 그 사이 고정 10개 row가 남아 있고 ID가 예측 가능하므로, 가드를 지우면 fixture 격리가 cleanup 성공 여부에 의존하게 된다. ID 목록과 `isKdhHomeProjectId()`는 `apps/api/src/projects/kdh-home-project-ids.ts`로 옮겨 service와 script가 함께 참조하며, cleanup 완료 후 후속 PR에서 이 모듈과 가드를 삭제한다. 남은 row는 신규 `apps/api/src/scripts/cleanup-kdh-home-projects.ts`로 정리하며, script는 production에서 거부하고 `KDH_HOME_CLEANUP_CONFIRM` 토큰을 요구하며 dry-run이 기본값이다. 삭제 대상은 고정 10개 project ID 리터럴로 한정하고, 실행 전 각 project의 소유자 email이 `kdh@orbit.com`인지 검증한다.
- Production 실행 경로: fixture는 AWS production DB에도 생성되어 있었다(`kdh_account=1`, `fixture_projects=10`, `live_assets=0`). production 전면 금지 가드를 유지하면 정리 자체가 불가능하고, 표지 자산만 삭제된 상태로 배포되어 카드는 남고 이미지만 깨진다. 따라서 금지를 해제하는 대신 **두 번째 잠금**을 추가한다: `APP_ENV=production`에서는 `KDH_HOME_CLEANUP_CONFIRM`에 더해 `KDH_HOME_CLEANUP_ALLOW_PRODUCTION`까지 있어야 실행된다. "실수로는 불가능하되 의도하면 가능"이라는 원래 취지는 유지된다.
- Storage 안전장치: `project_assets`는 `storage_key`를 들고 있고 `storage_deletion_outbox`는 worker의 `reconcileStorageDeletionOutbox`가 `removeObject`를 호출하게 만드는 유일한 근거다. 두 row를 객체 삭제 전에 지우면 S3/MinIO에 객체만 남는다. 따라서 apply 단계에서 `status`가 `deleted`가 아닌 asset이나 미완료 outbox row가 있으면 거부한다. 우회 flag는 두지 않는다 — 올바른 해결은 일반 파일 삭제 경로로 객체까지 지우는 것이다.
- Rationale: `decks`는 `projects`를 FK로 참조하지 않아 project 삭제만으로는 orphan이 남고, deck을 참조하는 4개 테이블이 `ON DELETE RESTRICT`라 삭제 순서가 동작에 영향을 준다. 따라서 순서를 명시한 script가 필요하다. `project_id` 컬럼을 가진 모든 테이블을 `pg_attribute`로 훑는 잔여 스캔을 commit 직전에 두어, 이 script 작성 이후 추가된 테이블이 있으면 반쪽 삭제를 commit하지 않고 rollback한다. `activity_runs`는 자기 참조 RESTRICT가 있어 bulk delete 전에 `supersedes_activity_run_id`를 NULL로 푼다.
- Affected files: `apps/api/src/projects/projects.service.ts`, `apps/api/src/scripts/cleanup-kdh-home-projects.ts`, `apps/api/package.json`, `package.json`, 삭제된 `apps/api/src/projects/kdh-home-project-seed.ts`·`apps/web/public/assets/home-project-covers/**`, 관련 테스트.
- Follow-up review notes: script는 코드 제거가 배포된 **뒤에** 실행해야 한다. 구버전 seeder가 살아 있으면 row가 다시 생긴다. dry-run에서 연습·리허설 테이블 건수가 0이 아니면 누군가 fixture deck으로 실제 작업을 한 것이므로 실행을 중단하고 확인받는다. `isKdhHomeProjectId` 가드 제거로 해당 10개 ID는 일반 project와 동일하게 동작하지만, row 삭제 후에는 `NotFound`로 수렴한다.
- Runbook: personal staging의 `DATABASE_URL` host는 compose 내부 service 이름 `postgres`라 외부에서 접속할 수 없다. 따라서 script는 staging host의 api container 안에서 실행한다. dry-run은 아래에서 `-e KDH_HOME_CLEANUP_APPLY=true`를 뺀 형태다.
  ```bash
  doppler run -- docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T \
    -e KDH_HOME_CLEANUP_CONFIRM=delete-kdh-home-projects \
    -e KDH_HOME_CLEANUP_APPLY=true \
    api pnpm --filter @orbit/api cleanup:kdh-home-projects
  ```

## kdh home project fixture access policy

- Context: 운영 홈 화면에서 `kdh@orbit.com` 계정에만 이미지 표지의 실제 프로젝트 카드 10개가 필요하며, 다른 계정의 프로젝트 목록이나 덱 접근에는 노출되면 안 된다.
- Options considered:
  - Web 클라이언트에만 카드 mock을 표시한다.
  - 모든 계정이 공유하는 demo 프로젝트를 만든다.
  - `kdh@orbit.com`이 프로젝트 목록을 조회할 때만 실제 프로젝트, accepted owner membership, 한 장 덱을 멱등 생성한다.
- Final decision: 고정 project/deck ID 10개를 사용해 `projects`, `project_members`, `decks`를 같은 transaction에서 `ON CONFLICT DO NOTHING`으로 생성한다. 각 membership은 `kdh`의 accepted `owner`만 생성하며, 덱의 첫 슬라이드는 공개 HTTPS 이미지 URL을 배경으로 사용한다. 이 고정 ID는 비멤버의 access 조회·접근 요청에서도 `NotFound`로 처리한다.
- Rationale: 기존 membership 기반 목록·덱 권한 경계를 유지하고, 새 schema나 전역 demo fixture 없이 실제 홈 카드와 편집 경로를 제공한다. 홈은 생성 카드와 함께 최대 10개의 최근 프로젝트를 표시해 fixture 전체가 보이며, 실패 후 재시도해도 중복 프로젝트가 생기지 않는다.
- Affected files: `apps/api/src/projects/kdh-home-project-seed.ts`, `apps/api/src/projects/projects.service.ts`, 관련 테스트.
- Follow-up review notes: 실제 운영 배포 후 `kdh@orbit.com`과 다른 테스트 계정에서 각각 목록과 덱 API 권한을 확인하고, 외부 이미지 제공자의 가용성·사용 정책이 바뀌면 관리형 asset 저장으로 전환한다.

## kdh home project presentation cover assets

- Context: 기존 KDH 전용 프로젝트는 외부 Unsplash 사진을 첫 슬라이드 배경으로 사용해 홈이 일반 비즈니스 자료 목록처럼 보였고, 외부 제공자의 가용성과 정책에도 의존했다. 사용자는 PPT 제작 서비스임이 바로 드러나는 크리에이티브 표지 10종을 `develop`에 먼저 적용하도록 승인했다.
- Options considered:
  - 홈 카드에서만 별도 mock 이미지를 표시하고 실제 Deck은 유지한다.
  - 새 외부 이미지 URL로 교체한다.
  - 텍스트 없는 16:9 표지 자산을 Web 정적 자산으로 관리하고 실제 Deck 배경에서 사용한다.
- Final decision: 10개의 1600x900 WebP 표지를 `apps/web/public/assets/home-project-covers`에 저장하고, KDH 고정 Deck의 `backgroundImage.src`가 same-origin 경로를 사용하게 한다. 실제 제목과 부제는 Deck text element로 유지한다. 기존 행은 알려진 legacy Unsplash URL을 계속 사용하는 경우에만 첫 슬라이드의 `backgroundImage`와 Deck version을 한 번 갱신하며, 사용자가 배경을 바꾼 Deck은 덮어쓰지 않는다. `kdh@orbit.com`의 accepted owner membership과 비멤버 `NotFound` 경계는 유지한다.
- Rationale: 홈 카드와 편집 화면이 같은 실제 Deck을 렌더링하고, 외부 이미지 장애 없이 선명한 표지를 제공한다. legacy URL 조건은 기존 운영 fixture를 갱신하면서 사용자 변경을 보존한다.
- Affected files: `apps/web/public/assets/home-project-covers/**`, `apps/web/src/features/projects/workspace-home.css`, `apps/api/src/projects/kdh-home-project-seed.ts`, `apps/api/src/projects/projects.service.ts`, 관련 테스트.
- Follow-up review notes: `develop` 반영 후 `kdh@orbit.com`에서 10개 표지와 편집 화면을 확인하고, 다른 계정에서 목록·직접 project ID·access request가 계속 차단되는지 검증한다. `main` 반영과 운영 배포는 별도 승인 범위로 둔다.

## ORBIT-8 self-managed auth policy

- Context: ORBIT-8은 회원가입, 로그인, 로그아웃, 현재 사용자 조회를 self-managed email/password auth로 구현한다. 기존 문서는 1차 스프린트에서 ORBIT-8을 제외하고 Demo ID를 사용한다고 정의했으나, 이번 구현 승인으로 인증 계약을 추가해야 한다.
- Options considered:
  - 기존 Demo ID 흐름만 유지하고 인증 구현을 보류한다.
  - 외부 auth provider를 붙인다.
  - email/password, Argon2id, signed HttpOnly cookie, Redis session으로 자체 인증을 구현한다.
- Final decision: ORBIT-8은 email/password 인증을 추가하되, 기존 Demo ID 기반 기능은 즉시 제거하지 않는다. 비밀번호는 Argon2id hash로만 저장하고, session id는 signed HttpOnly cookie로 전달하며 session payload는 Redis에 저장한다.
- Rationale: self-managed auth 요구를 충족하면서 기존 데모 흐름과 다른 작업의 project boundary를 갑자기 깨지 않는다.
- Affected files: `packages/shared/src/auth/**`, `apps/api/src/auth/**`, `apps/api/src/database/migrations/2026062702000-CreateAuthUsers.ts`, `apps/web/src/features/auth/**`, `docs/contracts.md`, `docs/demo-standards.md`.
- Follow-up review notes: 프로젝트/워크스페이스 membership 모델이 확정되면 Demo ID boundary를 session user 기반 authorization으로 교체한다.

## ORBIT-8 session and password bounds

- Context: 세션 유지 시간과 비밀번호 정책은 사람이 최종 확정해야 하지만, 이번 자동 구현 세션에서는 보수적인 MVP 기본값이 필요하다.
- Options considered:
  - 세션 TTL과 password length 제한을 두지 않는다.
  - 짧은 세션 TTL을 사용한다.
  - MVP 사용성을 고려한 7일 TTL과 최소 8자 password 정책을 둔다.
- Final decision: session TTL은 7일로 두고, password는 8자 이상 128자 이하로 검증한다. Redis key는 raw session id가 아니라 `SESSION_SECRET` 기반 HMAC digest를 사용한다.
- Rationale: 너무 짧은 세션으로 데모 흐름이 자주 끊기는 것을 피하면서, 무제한 password/session surface를 두지 않는다.
- Affected files: `packages/shared/src/auth/auth.schema.ts`, `apps/api/src/auth/auth.constants.ts`, `apps/api/src/auth/auth-session.store.ts`, `docs/contracts.md`.
- Follow-up review notes: 제품 보안 정책에서 MFA, password complexity, session inactivity timeout, refresh policy가 확정되면 shared schema와 API/session store를 갱신한다.

## ORBIT test automation gate policy

- Context: 기능 완료 기준을 PR 리뷰에서 추적하기 쉽게 만들고, PR과 merge 후 모두 상황에 맞는 자동 검증을 실행해야 한다.
- Options considered:
  - PR과 `main`/`develop` push 모두 빠른 unit/API/Python/Compose/Playwright smoke를 실행한다.
  - PR에서는 unit/API만 실행하고 merge 후 Playwright smoke를 실행한다.
  - PR에서는 수동 체크리스트만 사용하고 merge 후 자동 테스트를 실행한다.
- Final decision: PR과 `main`/`develop` push 모두 기존 TypeScript/Python/Compose 검증과 얇은 Playwright smoke를 실행한다. 무거운 full E2E, STT 품질 측정, 1000명 load test는 manual 또는 scheduled 검증으로 분리한다.
- Rationale: 기능 구현 누락과 기본 화면/API 회귀를 merge 전에 막되, 환경 의존적이고 오래 걸리는 검증은 필수 PR gate에서 분리해 flaky risk를 낮춘다.
- Affected files: `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `docs/testing/test-matrix.md`, `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `package.json`.
- Follow-up review notes: 실제 기능별 Playwright flow와 load harness가 안정화되면 branch protection required checks에 추가할지 별도로 검토한다.

## ORBIT smoke CI output policy

- Context: Playwright smoke 검증은 Docker Compose로 API/Web 서비스를 띄우지만, CI 실패 디버깅용 로그 출력은 애플리케이션 로그에 민감값이 섞일 경우 노출 위험을 만든다.
- Options considered:
  - 실패 시 `docker compose logs api web`을 출력한다.
  - 실패 시 서비스 상태만 출력하고 상세 로그는 로컬/권한 있는 환경에서 재현한다.
  - smoke 디버깅 출력을 모두 제거한다.
- Final decision: smoke job은 실패 여부와 관계없이 `docker compose ps`로 서비스 상태만 출력한다.
- Rationale: CI에서 환경 파일 내용이나 secret 값을 직접 출력하지 않는 보안 원칙을 우선하면서도, 서비스 기동 여부는 최소한으로 확인할 수 있다.
- Affected files: `.github/workflows/ci.yml`.
- Follow-up review notes: 추후 CI 로그 마스킹과 애플리케이션 로그 정책이 정리되면 제한된 로그 아티팩트 업로드 방식을 재검토한다.

## ORBIT path-scoped PR CI policy

- Context: 모든 PR에서 TypeScript/Python/Compose/Playwright smoke를 실행하면 docs-only 또는 automation-only PR도 제품 회귀 테스트를 기다려야 한다. 반대로 workflow 전체를 path filter로 스킵하면 branch protection에서 required check가 pending으로 남을 수 있다.
- Options considered:
  - 기존처럼 모든 PR에서 전체 빠른 gate를 실행한다.
  - workflow-level `paths-ignore`로 docs-only PR 전체 CI를 스킵한다.
  - 선행 변경 파일 분류 job을 두고 job-level `if`로 관련 검증만 실행한다.
- Final decision: PR에서는 `detect-changes` job으로 docs-only, automation-only, CI workflow, product/API/shared/worker/compose/env/lockfile 변경을 분류하고 관련 job만 실행한다. `main`/`develop` push에서는 merge 후 조합 검증을 위해 전체 빠른 gate를 유지한다. 자동 리뷰 코드, prompt, schema, workflow, root automation 파일이 바뀐 PR에서는 Codex review job을 실행하지 않는다.
- Rationale: 구현과 무관한 PR의 대기 시간을 줄이면서도 required check pending 문제를 피한다. 또한 PR이 변경한 automation code가 `OPENAI_API_KEY` 또는 `GITHUB_TOKEN`과 함께 실행되는 경로를 차단한다.
- Affected files: `.github/workflows/ci.yml`, `docs/testing/test-matrix.md`.
- Follow-up review notes: branch protection에서 개별 job을 required check로 쓰는 경우 skipped job 표시가 팀 기대와 맞는지 확인하고, 필요하면 별도 aggregate required check를 추가한다.

## ORBIT Playwright smoke CI temporary suspension

- Context: Playwright smoke gate가 PR과 `main`/`develop` push 자동 검증에 포함되어 있지만, 현재는 안정성 재검토 전까지 자동화 테스트에서 임시로 제외해야 한다.
- Options considered:
  - Playwright smoke 테스트 파일과 `test:smoke` 스크립트를 삭제한다.
  - `playwright-smoke` job 정의는 유지하되 job-level 조건으로 항상 skip한다.
  - 변경 경로 분류에서만 `playwright_smoke` 출력을 끈다.
- Final decision: `playwright-smoke` job은 그대로 보존하고 job-level `if: ${{ false }}`로 임시 skip한다. 로컬 또는 수동 검증용 `pnpm test:smoke` 스크립트와 Playwright 테스트 파일은 유지한다.
- Rationale: 자동 gate에서만 제외하면 flaky 또는 환경 의존 이슈가 PR merge를 막지 않으면서도, smoke 재활성화와 수동 회귀 검증 경로를 잃지 않는다.
- Affected files: `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `docs/testing/test-matrix.md`.
- Follow-up review notes: smoke 안정화 원인이 정리되면 기존 path-scoped 조건을 복구하고 branch protection에서 skipped check 처리가 팀 기대와 맞는지 다시 확인한다.

## ORBIT-90 API project and asset boundary

- Context: ORBIT-90은 프로젝트 생성과 project-scoped asset upload URL/complete API를 구현한다. 저장소 문서는 1차 스프린트가 임시 사용자 기반 프로젝트 생성에서 시작한다고 정의하며, 인증/워크스페이스 초대 흐름은 별도 선행/인접 작업이다.
- Options considered:
  - 실제 인증/멤버십 모델을 새로 만든다.
  - 모든 workspaceId와 projectId를 허용한다.
  - 기존 `DEMO_USER_ID`, `DEMO_WORKSPACE_ID` 기준으로 임시 boundary를 적용한다.
- Final decision: ORBIT-90에서는 `DEMO_WORKSPACE_ID`만 접근 가능한 workspace로 보고, 생성자는 `DEMO_USER_ID`로 저장한다. project asset API는 project가 이 workspace 안에 있을 때만 허용한다.
- Rationale: 현재 문서화된 1차 스프린트 E2E 시작점과 demo ID 기준을 유지하면서, workspace member가 아닌 사용자 접근을 허용하지 않는다.
- Affected files: `apps/api/src/projects/**`, `apps/api/src/files/**`, `packages/shared/src/projects/project.schema.ts`, `docs/contracts.md`.
- Follow-up review notes: 실제 인증/워크스페이스 membership 구현이 들어오면 demo boundary를 세션 사용자와 membership repository 검증으로 교체한다.

## ORBIT-90 asset upload policy

- Context: ORBIT-10/ORBIT-90은 PDF/DOCX/PPTX/image upload complete와 지원하지 않는 mime type 실패를 요구하지만, 저장소에 명시된 파일 크기 정책은 없다.
- Options considered:
  - 파일 형식과 크기를 제한하지 않는다.
  - 모든 image mime type을 허용한다.
  - MVP 시나리오에 필요한 문서 형식과 주요 이미지 형식만 허용하고 보수적인 크기 제한을 둔다.
- Final decision: PDF, PPTX, DOCX, JPEG, PNG, WebP만 허용하고 단일 파일 최대 크기는 50MiB로 제한한다.
- Rationale: 문서의 검증 시나리오를 충족하면서 저장 비용과 예기치 않은 binary upload surface를 제한한다.
- Affected files: `packages/shared/src/files/file.schema.ts`, `apps/api/src/files/**`, `docs/contracts.md`.
- Follow-up review notes: 제품 정책에서 허용 파일 형식, 이미지 범위, 파일 크기 제한이 확정되면 shared schema와 UI 안내 문구를 함께 갱신한다.

## ORBIT-90 pending asset retention

- Context: upload URL 발급 후 complete가 호출되지 않는 실패 케이스가 명시되어 있다.
- Options considered:
  - upload URL 발급 시 metadata를 저장하지 않는다.
  - pending metadata를 저장하고 complete 시 uploaded로 전환한다.
  - complete 요청에서만 metadata를 최초 저장한다.
- Final decision: upload URL 발급 시 `pending` asset metadata를 저장하고, complete 호출 시 `uploaded`로 전환한다.
- Rationale: complete 누락 상태를 API/DB에서 추적할 수 있고 후속 cleanup job을 붙이기 쉽다.
- Affected files: `apps/api/src/files/**`, `apps/api/src/database/migrations/2026062703000-CreateProjectsAndProjectAssets.ts`.
- Follow-up review notes: pending asset TTL, object existence check, cleanup job은 작업큐 또는 storage adapter 기능이 준비된 뒤 별도 결정한다.

## ORBIT-92 browser upload environment

- Context: ORBIT-91 화면은 브라우저에서 `PUT uploadUrl`을 직접 호출한다. 기존 local storage adapter는 공개 object URL만 반환해 실제 upload URL 흐름을 재현하지 못했다.
- Options considered:
  - API가 파일 binary를 proxy로 받아 MinIO에 저장한다.
  - 기존 공개 object URL을 유지하고 upload complete만 처리한다.
  - 모든 환경에서 S3-compatible presigned PUT URL을 발급한다.
- Final decision: local MinIO 모드에서는 API가 같은-origin upload proxy URL을 발급하고, proxy endpoint가 MinIO에 object를 저장한다. S3 모드에서는 `@orbit/storage`의 AWS SDK presigner 기반 S3-compatible adapter를 사용한다.
- Rationale: 로컬/CI 브라우저 smoke에서 CORS와 host signature mismatch를 피하면서도, staging/production S3 전환 시 같은 `StoragePort`와 upload-url/complete 계약을 유지할 수 있다.
- Affected files: `packages/storage/src/index.ts`, `packages/storage/package.json`, `apps/api/src/files/**`, `docker-compose.yml`, `pnpm-lock.yaml`.
- Follow-up review notes: staging/production에서는 S3 bucket CORS origin을 실제 web origin으로 제한하고, S3 credentials는 secret store로만 주입한다.

## ORBIT develop Codex review automation policy

- Context: `develop` 대상 PR마다 Codex standard review를 실행해 diff, 관련 계약 문서, 주변 코드, CI 결과를 함께 검토해야 한다. 리뷰는 파일/라인, 레포 규칙, 계약/API, 테스트/CI, 실제 위험, 공식 기술스택 문서 근거를 남겨야 한다.
- Options considered:
  - GitHub 내장 Codex 리뷰만 사용한다.
  - GitHub Actions에서 diff만 Codex에 전달한다.
  - GitHub Actions에서 diff, 레포 규칙, 계약 문서, 기술스택 공식문서 요약, CI 결과를 묶어 Codex standard review를 실행한다.
- Final decision: `pull_request`의 `opened`, `synchronize`, `reopened`, `ready_for_review` 이벤트에서 base branch가 `develop`이고 same-repository PR이며 draft가 아닐 때만 Codex review를 실행한다. Codex가 읽는 context는 secret-like path와 lockfile/binary/generated full diff를 제외하고, 생성된 리뷰는 diff line 검증 후 GitHub PR review로 게시한다.
- Rationale: 비용을 통제하면서도 계약/API와 테스트 누락을 확인할 충분한 맥락을 제공하고, fork PR 또는 secret 노출 위험을 기본적으로 차단한다.
- Affected files: `.github/workflows/ci.yml`, `.github/codex/**`, `infra/scripts/build-codex-review-context.mjs`, `infra/scripts/post-codex-review.mjs`, `docs/review/official-tech-stack-references.md`, `.gitignore`.
- Follow-up review notes: GitHub Actions에서 첫 실행 결과를 확인한 뒤 Codex model/effort, inline comment cap, fork PR 정책, branch protection required check 포함 여부를 별도 검토한다.

## ORBIT Korean Codex review output policy

- Context: Codex standard review는 ORBIT 팀 PR에 직접 게시되는 리뷰이므로, 한국어 협업 흐름과 맞아야 한다. 기존 prompt와 게시 스크립트 문구는 영어 summary와 inline comment를 만들었다.
- Options considered:
  - Codex action의 기본 영어 출력에 맡긴다.
  - GitHub에 게시하기 직전에 번역 단계를 별도로 추가한다.
  - prompt에서 사람이 읽는 필드를 한국어로 요구하고, 게시 스크립트의 고정 문구도 한국어로 바꾼다.
- Final decision: `summary`, `title`, `body`, `followUps`는 한국어로 작성하게 하고, severity/category enum, 파일 경로, line reference, command, schema key는 원문을 유지한다. 게시 스크립트의 fixed heading과 evidence label도 한국어로 표시한다.
- Rationale: 별도 번역 단계 없이 리뷰 품질과 schema 안정성을 유지하면서, 팀원이 PR에서 바로 읽을 수 있는 한국어 리뷰를 만든다.
- Affected files: `.github/codex/prompts/develop-standard-review.md`, `infra/scripts/post-codex-review.mjs`, `docs/decision-log.md`.
- Follow-up review notes: 첫 한국어 자동 리뷰 결과에서 용어가 어색하거나 severity/category가 번역되어 schema 검증을 깨는지 확인한다.

## ORBIT develop Codex review automation removal

- Context: `OPENAI_API_KEY` 기반 Codex PR review automation이 `develop`에 적용되었지만, 운영 정책 재검토를 위해 일단 제거해야 한다.
- Options considered:
  - GitHub repository secret만 제거하고 workflow는 남긴다.
  - Codex review job만 조건으로 비활성화한다.
  - OpenAI key를 사용하는 Codex review job, prompt/schema/context/posting scripts, review-only docs를 제거하고 기존 CI 분기 검증은 유지한다.
- Final decision: `develop` PR에서 OpenAI Codex review를 실행하거나 PR review comment를 게시하는 GitHub Actions 경로를 제거한다. PR 유형별 CI 검증과 `pnpm lint` 실행 방식은 유지한다.
- Rationale: secret 의존 자동리뷰를 중단하면서도 기존 CI 비용 절감/검증 분기와 로컬 lint 안정성은 보존한다.
- Affected files: `.github/workflows/ci.yml`, `.github/codex/**`, `infra/scripts/build-codex-review-context.mjs`, `infra/scripts/post-codex-review.mjs`, `docs/review/official-tech-stack-references.md`, `.gitignore`, `docs/decision-log.md`.
- Follow-up review notes: 자동리뷰를 다시 도입할 경우 모델, 비용, secret 권한, fork PR 정책, required check 포함 여부를 별도 승인 후 새 결정으로 기록한다.

## ORBIT GitHub Codex Korean review guidance

- Context: GitHub 내장 Codex 코드 리뷰는 저장소의 `AGENTS.md` review guidance를 읽을 수 있지만, 저장소에는 리뷰 출력 언어를 고정하는 지침이 없었다. 팀 협업 흐름은 한국어 PR 리뷰를 기대하며, 이전 `OPENAI_API_KEY` 기반 자동리뷰 제거 결정과 충돌하지 않는 방식이 필요하다.
- Options considered:
  - Codex 기본 출력 언어에 맡긴다.
  - GitHub Actions 기반 Codex review automation을 다시 도입한다.
  - `AGENTS.md`에 GitHub PR 리뷰용 한국어 출력 지침을 추가한다.
- Final decision: `AGENTS.md`에 `Review guidelines`를 추가해 Codex가 GitHub PR 리뷰 요약과 inline comment를 한국어로 작성하게 한다. 코드 식별자, 파일 경로, 명령어, schema key, enum, severity label은 원문을 유지하고, secret 값은 출력하지 않는다.
- Rationale: 별도 secret이나 GitHub Actions 자동리뷰 경로를 되살리지 않고도, GitHub 내장 Codex 리뷰가 저장소 협업 언어와 보안 원칙을 따르게 할 수 있다.
- Affected files: `AGENTS.md`, `docs/decision-log.md`.
- Follow-up review notes: 다음 Codex PR 리뷰에서 요약과 inline comment가 한국어로 작성되는지, technical identifier가 불필요하게 번역되지 않는지 확인한다.

## ORBIT Jira retirement

- Context: 팀이 Jira를 더 이상 사용하지 않기로 하면서, PR마다 Jira key를 요구하거나 merge 후 Jira Automation webhook을 호출하는 저장소 규칙과 자동화가 불필요해졌다.
- Options considered:
  - `jira-link` check만 제거하고 Jira key 팀 규칙과 merge-time Jira 완료 workflow는 유지한다.
  - Jira 관련 workflow만 비활성화하고 문서 규칙은 나중에 정리한다.
  - Jira key 팀 규칙, PR template 항목, Jira webhook workflow, 관련 helper scripts, Jira 전용 문서를 함께 제거한다.
- Final decision: Jira 관련 GitHub Actions workflow와 helper scripts를 제거하고, 브랜치/PR/커밋에 Jira key를 요구하는 팀 규칙을 삭제한다. 기존 Jira test matrix는 일반 test matrix로 전환한다.
- Rationale: 사용하지 않는 외부 서비스 규칙과 secret 의존 자동화를 남기면 새 PR 작성과 branch protection 운영에 혼선을 만든다.
- Affected files: `.github/workflows/jira-link.yml`, `.github/workflows/jira-complete-issue.yml`, `.github/pull_request_template.md`, `AGENTS.md`, `docs/git-rules.md`, `docs/conventions/jira.md`, `docs/runbooks/jira-webhook-self-hosted-runner.md`, `docs/testing/test-matrix.md`, `infra/scripts/validate-jira-link.mjs`, `infra/scripts/build-jira-webhook-payload.mjs`, `docs/decision-log.md`.
- Follow-up review notes: GitHub branch protection의 `main`, `develop` required status checks에서 `jira-link`가 남아 있으면 제거한다. Repository secrets에 `JIRA_AUTOMATION_WEBHOOK_URL`이 남아 있으면 삭제한다. Self-hosted runner label `jira-access`가 Jira 전용이었다면 정리한다.

## ORBIT-228 personal server develop deployment boundary

- Context: 공식 production 배포 경로가 완성되기 전에 `develop` 브랜치를 개인 서버에서 staging/demo로 검증할 수 있는 반복 가능한 절차가 필요하다.
- Options considered:
  - 개인 서버를 production 환경으로 취급한다.
  - 수동 Docker Compose 명령을 계속 사용한다.
  - Doppler secret, Nginx reverse proxy, Docker Compose override를 사용해 개인 서버 staging/demo 경로를 정의한다.
- Final decision: 개인 서버는 `develop` staging/demo 환경으로만 취급한다. Doppler `orbit / stg`, host Nginx public entrypoint, localhost-bound app services, Docker Compose staging override를 사용한다.
- Rationale: 실제 서버에서 `develop`을 검증할 수 있게 하면서도, 문서화된 AWS ECS Fargate production 목표와 경계를 분리한다.
- Affected files: `docker-compose.staging.yml`, `infra/scripts/deploy-personal-server.sh`, `docs/runbooks/personal-server-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: 수동 배포 스크립트가 서버에서 검증된 뒤 GitHub Actions 자동 배포를 별도 결정으로 추가한다. TLS를 설정하기 전까지 이 endpoint를 production으로 취급하지 않는다.

## ORBIT-228 personal server runtime override policy

- Context: 개인 서버 배포는 Doppler `orbit / stg` secret을 사용하지만, 저장소의 staging 예시는 S3, AWS Transcribe, AWS Textract를 전제로 한다. 개인 서버 override는 같은 서버 안의 Redis, MinIO, Python worker를 올리므로 staging secret 값을 그대로 주입하면 web 부팅, queue 처리, asset 접근, 인증 검증, STT demo가 깨질 수 있다.
- Options considered:
  - Doppler `stg` 값을 개인 서버 토폴로지에 맞춰 수동으로 계속 관리한다.
  - staging 예시 값을 그대로 사용하고 실패 항목을 runbook troubleshooting으로만 설명한다.
  - Docker Compose override에서 개인 서버 전용 runtime driver와 localhost-bound service mapping을 고정하고, runbook은 HTTPS와 Nginx `/assets/` proxy 요구를 명시한다.
- Final decision: 개인 서버 compose override에서 web `WEB_PORT`, MinIO storage, BullMQ queue, OpenAI STT, Python OCR, Textract disabled 값을 명시적으로 고정한다. MinIO object API는 host Nginx가 `/assets/`를 proxy할 수 있도록 localhost에만 bind하고, staging 인증 흐름 검증은 HTTPS origin을 요구한다.
- Rationale: 개인 서버 배포가 Doppler staging 값의 AWS 전제에 흔들리지 않게 하고, asset URL과 secure cookie 동작을 실제 브라우저 검증 경로와 맞춘다. MinIO object API는 외부 공개 포트가 아니라 localhost Nginx upstream으로 제한한다.
- Affected files: `docker-compose.staging.yml`, `docs/runbooks/personal-server-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: 개인 서버 Nginx 설정이 실제 서버에 반영된 뒤 `/assets/<bucket>/<key>` 접근, 인증 cookie 저장, reference extraction/job 처리, rehearsal STT demo를 서버에서 수동 검증한다.

## ORBIT-228 personal server automatic deploy policy

- Context: 개인 서버 배포 절차가 수동 스크립트로 정리되었지만, `develop` merge 뒤 사람이 서버에 접속해 실행해야 하면 staging/demo 검증이 누락될 수 있다. 또한 `APP_ENV=staging` validation은 local default인 `S3_BUCKET=orbit-local`을 금지하므로 개인 서버 MinIO bucket도 staging 전용 이름을 사용해야 한다.
- Options considered:
  - 수동 배포 스크립트만 유지한다.
  - GitHub-hosted runner에서 SSH secret으로 개인 서버에 접속한다.
  - 개인 서버 self-hosted runner가 최소 sudo wrapper만 실행하고, 서버 내부 checkout과 Doppler token으로 배포한다.
- Final decision: `develop` push와 수동 `workflow_dispatch`에서 `orbit-personal-staging` self-hosted runner가 `/usr/local/sbin/orbit-deploy-personal-staging` wrapper를 실행한다. 개인 서버 MinIO bucket은 `orbit-personal-staging`으로 고정한다. GitHub repository secret은 사용하지 않고, Doppler token과 deploy key는 서버에만 둔다.
- Rationale: GitHub에 서버 SSH secret을 저장하지 않고, runner 권한을 단일 wrapper 실행으로 제한하면서 merge 후 배포를 자동화한다. staging validation의 local-default 금지 정책도 유지한다.
- Affected files: `.github/workflows/deploy-personal-staging.yml`, `docker-compose.staging.yml`, `docs/runbooks/personal-server-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: 첫 merge 후 GitHub Actions에서 runner label 매칭, sudoers wrapper 실행, `db:migration:run`, `/api/health`, `/assets/orbit-personal-staging/` 접근을 확인한다. 완전 자동 배포가 목표면 GitHub Environment `personal-staging`에 required reviewer를 설정하지 않는다.

## ORBIT personal HTTP demo auth cookie exception

- Context: 개인 서버 develop demo가 HTTP origin으로 운영되는 동안 `APP_ENV=staging`의 secure auth cookie가 브라우저에 저장되지 않아 로그인 후 `/api/v1/auth/me`가 401을 반환한다.
- Options considered:
  - 즉시 HTTPS 도메인과 TLS 인증서를 붙인다.
  - `APP_ENV=local`로 내려서 staging validation을 우회한다.
  - 명시적 `AUTH_COOKIE_SECURE=false` override를 개인 서버 staging에만 허용한다.
- Final decision: `AUTH_COOKIE_SECURE` optional env를 추가하고, 명시된 경우 auth cookie의 `secure` 값을 override한다. 단, `AUTH_COOKIE_SECURE=false`는 `APP_ENV=staging`에서 `WEB_ORIGIN`과 `API_BASE_URL`이 모두 `http://`인 개인 서버 HTTP demo에만 허용하고, `APP_ENV=production` 또는 `https://` staging origin에서는 금지한다.
- Rationale: 개인 서버 HTTP demo의 인증 흐름을 검증할 수 있게 하면서도 HTTPS staging/prod에서 non-secure auth cookie가 실수로 남는 설정을 startup 단계에서 거부한다.
- Affected files: `packages/config/src/index.ts`, `apps/api/src/auth/auth-cookie.ts`, `apps/api/src/config/env.schema.spec.ts`, `.env.example`, `.env.staging.example`, `.env.production.example`, `docker-compose.staging.yml`, `docs/conventions/environment.md`, `docs/runbooks/personal-server-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: HTTPS 적용 후 Doppler `orbit / stg`의 `AUTH_COOKIE_SECURE` 값을 비우거나 `true`로 되돌린다. 값이 남아 있으면 HTTPS staging startup이 실패해야 한다.

## ORBIT-38 rehearsal report retention and access policy

- Context: ORBIT-38은 리허설 결과 보고서 화면과 report API를 단독 완료형으로 구현한다. ORBIT-37의 고급 0-100 점수 산식은 아직 확정되지 않았고, transcript 원문은 발표자 발화 민감 데이터가 될 수 있다.
- Options considered:
  - `jobs.result`만 조회해 보고서를 표시한다.
  - `rehearsal_runs.report_json`을 공식 보고서 저장 위치로 둔다.
  - transcript를 기본 보존하거나, 사용자가 별도 보존을 선택하기 전까지 저장하지 않는다.
  - 현재 demo/project boundary를 재사용하거나 완전한 workspace member role 모델을 새로 추가한다.
- Final decision: 공식 보고서는 `rehearsal_runs.report_json`에 저장하고 `GET /api/v1/rehearsals/:runId/report`에서 조회한다. `transcript_retained=false`를 기본값으로 두며, 이때 `report.transcript`는 `null`이어야 한다. 접근 제어는 현재 프로젝트 접근 경계를 재사용하고, 고급 0-100 점수는 ORBIT-37 후속으로 남긴다.
- Rationale: report API가 Job 기록에 덜 묶이고, 민감 발화 원문 보존을 최소화하며, ORBIT-38 범위 안에서 presenter-only 기본 접근을 현재 구조와 충돌 없이 제공할 수 있다.
- Affected files: `packages/shared/src/rehearsals/rehearsal.schema.ts`, `apps/api/src/rehearsals/**`, `apps/api/src/database/migrations/2026062903000-AddRehearsalReportColumns.ts`, `apps/worker/src/rehearsal-stt.processor.ts`, `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: ORBIT-37에서 실제 점수 산식과 transcript 보존 opt-in 정책이 확정되면 `RehearsalReport` schema, worker 저장 정책, UI 노출 조건을 함께 재검토한다.

## ORBIT-113 rehearsal report score boundary

- Context: 리허설 리포트 화면이 `RehearsalReport.metrics`의 기본 지표를 바탕으로 종합 발표 점수, 전달력, 속도 안정성, 키워드 회수 점수를 프론트엔드에서 계산해 표시하고 있었다. 하지만 `docs/contracts.md`는 ORBIT-37의 고급 0-100 점수 산식이 확정되기 전까지 점수를 계약과 UI에 포함하지 않는다고 정의한다.
- Options considered:
  - 기존 UI 계산 점수를 임시 점수로 유지한다.
  - `RehearsalReport`에 `score` 계열 필드를 추가하고 현재 프론트 산식을 공식화한다.
  - ORBIT-37 전까지 점수 필드를 계약에서 거부하고 UI는 공식 `report_json`의 원시 지표와 coaching만 표시한다.
- Final decision: `score`, `deliveryScore`, `speedScore` 같은 0-100 점수 필드는 ORBIT-37 전까지 `RehearsalReport` 계약에서 거부한다. UI는 점수 블록을 제거하고 `durationSeconds`, `wordsPerMinute`, `keywordCoverage`, `fillerWordCount`, `pauseCount`, `coaching`처럼 worker가 저장한 공식 값만 표시한다.
- Rationale: 산식 없는 점수를 공식 리포트처럼 보여주면 사용자와 팀이 분석 품질을 과신할 수 있다. 계약을 먼저 고정해 worker, API, UI가 같은 데이터 원본을 따르게 한다.
- Affected files: `packages/shared/src/rehearsals/rehearsal.schema.ts`, `packages/shared/src/rehearsals/rehearsal.schema.test.ts`, `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`, `apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: ORBIT-37에서 점수 산식과 평가 기준이 확정되면 shared schema에 공식 점수 필드를 추가하고, worker에서 계산해 `report_json`에 저장한 뒤 UI가 그 필드만 표시하도록 재검토한다.

## ORBIT-114 rehearsal report detail generation

- Context: ORBIT-113에서 산식 없는 0-100 점수는 계약과 UI에서 제거했지만, 리허설 리포트에는 말 속도 변화, 습관어 상세, pause 상세, 누락 키워드 상세처럼 UI가 추정하지 않고 공식 `report_json`에서 읽을 수 있는 상세 재료가 필요하다.
- Options considered:
  - UI가 평균값과 deck keyword를 사용해 상세 지표를 계속 추정한다.
  - Python worker가 상세 지표를 만들고 TS worker가 shared `RehearsalReport` schema 검증 후 `report_json`에 저장한다.
  - 상세 지표를 별도 테이블에 저장한다.
- Final decision: `speedSamples`, `fillerWordDetails`, `pauseDetails`, `missedKeywords`를 `RehearsalReport` 공식 필드로 추가한다. Python worker가 가능한 값만 계산하고 값이 부족하면 빈 배열을 반환하며, TS worker는 분석 응답을 safe fallback으로 검증한 뒤 shared schema를 통과한 리포트만 저장한다.
- Rationale: 상세 지표를 `report_json`에 함께 저장하면 API, worker, UI가 같은 공식 원본을 공유하고, UI가 평균값이나 deck만으로 누락 키워드와 속도 변화를 추정하지 않아도 된다. 점수 산식은 여전히 ORBIT-37 전까지 제외한다.
- Affected files: `packages/shared/src/rehearsals/rehearsal.schema.ts`, `packages/shared/src/rehearsals/rehearsal.schema.test.ts`, `services/python-worker/app/main.py`, `services/python-worker/app/rehearsal.py`, `services/python-worker/tests/test_rehearsal_analyze.py`, `apps/worker/src/rehearsal-stt.processor.ts`, `apps/worker/src/rehearsal-stt.processor.spec.ts`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: UI 후속 작업은 `speedSamples`, `fillerWordDetails`, `pauseDetails`, `missedKeywords`만 사용해 상세 섹션을 렌더링하고, 필드가 빈 배열이면 추정값 대신 empty state를 보여준다.

## ORBIT-116 rehearsal run meta and slide timing policy

- Context: 리허설 리포트에 슬라이드별 실제 체류 시간을 표시하려면 녹음 완료 전에 web이 slide 진입 이벤트를 API에 저장해야 한다. 기존 계약에는 `PATCH /api/v1/rehearsals/:runId/meta`가 설계되어 있었지만 DB 저장, API 구현, worker 조회, web 업로드 순서가 연결되어 있지 않았다.
- Options considered:
  - web이 리포트 화면에서 deck과 평균 발표 시간으로 slide timing을 추정한다.
  - `rehearsal_runs.meta_json`에 원문 없는 사건 정보만 저장하고, worker가 report 생성 시 공식 `slideTimings`를 계산한다.
  - Python worker에 slide timing 계산을 위임한다.
- Final decision: `rehearsal_runs.meta_json`을 공식 run meta 저장 위치로 추가하고, web은 `audio/complete` 전에 `slideTimeline`, `missedKeywords`, `adviceEvents`만 PATCH한다. worker는 `slideTimeline`의 연속된 slide 진입 시각 차이로 `slideTimings`를 계산하며, 종료 시각이 없는 마지막 slide는 실제 시간을 추정하지 않는다.
- Rationale: transcript, speaker notes, raw audio, script 원문 없이도 리포트에 필요한 사건 정보만 저장할 수 있고, deck 목표 시간과 run meta를 함께 읽을 수 있는 TS worker가 공식 report JSON을 일관되게 조립할 수 있다.
- Affected files: `packages/shared/src/rehearsals/rehearsal.schema.ts`, `apps/api/src/rehearsals/**`, `apps/api/src/database/migrations/2026070301000-AddRehearsalRunMetaJson.ts`, `apps/worker/src/rehearsal-stt.processor.ts`, `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: chunked audio upload이 구현되면 meta PATCH와 audio-complete 사이의 ordering을 동일하게 유지하고, 녹음 종료 시각을 별도 meta 필드로 추가할지 검토한다.

## ORBIT-117 QnA report minimal contract

- Context: 청중 QnA 기반 피드백을 리허설 리포트에 표시해야 하지만, 현재 audience 기능은 입장/검증 중심이고 질문 원문 저장 API가 아직 없다. 계약 문서는 질문 원문을 report에 저장하지 않는 정책을 이미 정의한다.
- Options considered:
  - 질문 원문 배열을 report에 저장한다.
  - 기존 `packages/shared/src/presentation/presentation.schema.ts`의 레거시 `reportSchema.questionCount`를 리허설 report로 재사용한다.
  - `RehearsalReport`에 원문 없는 `qnaSummary`만 추가하고 실제 질문 데이터 소스는 후속 작업으로 둔다.
- Final decision: `RehearsalReport.qnaSummary`는 `questionCount`, `questionSummary`, `unclearTopics[].topic`, optional `slideId`만 포함한다. 현재 PR에서는 기본값으로 질문 수 0과 빈 요약을 저장하고, UI는 empty state를 표시한다. 레거시 presentation report schema는 외부 참조 가능성을 고려해 이번 범위에서 삭제하지 않는다.
- Rationale: 질문 원문과 발표자 발화 원문을 리포트에 섞지 않는 보안/보존 정책을 지키면서, 후속 audience 질문 저장 API가 생겼을 때 연결할 최소 계약을 먼저 고정한다.
- Affected files: `packages/shared/src/rehearsals/rehearsal.schema.ts`, `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`, `apps/worker/src/rehearsal-stt.processor.ts`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: audience 질문 생성/저장 API가 구현되면 원문 보존 범위, 요약 생성 위치, slideId 매핑 정책을 별도 결정으로 기록한 뒤 `qnaSummary` 생성 로직을 연결한다.

## ORBIT GitHub Actions CI removal policy

- Context: 기존 CI workflow의 `typescript` job이 실패하고 있으며, 사용자는 이미지에 표시된 CI job(`detect-changes`, `automation-check`, `typescript`, `python-worker`, `compose-config`, `playwright-smoke`)에 해당하는 CI 코드를 일단 모두 제거하도록 승인했다.
- Options considered:
  - 실패한 `typescript` job만 임시 비활성화한다.
  - `playwright-smoke`처럼 전체 CI job을 skip 상태로 보존한다.
  - `.github/workflows/ci.yml`을 제거하고 PR 검증은 수동 체크리스트로 전환한다.
- Final decision: `.github/workflows/ci.yml`을 삭제해 GitHub Actions CI job을 제거한다. 개인 서버 배포용 `.github/workflows/deploy-personal-staging.yml`은 CI가 아니라 staging deploy workflow이므로 유지한다.
- Rationale: 사용자가 요청한 CI 코드 삭제 범위를 이미지의 CI job 전체로 해석하고, 배포 자동화까지 함께 제거하는 과도한 변경은 피한다. PR 검증은 수동 명령과 PR 본문 증거로 남긴다.
- Affected files: `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `docs/testing/test-matrix.md`, `README.md`, `docs/decision-log.md`.
- Follow-up review notes: GitHub branch protection에 삭제된 CI job이 required check로 남아 있으면 GitHub 설정에서 제거해야 한다. CI를 다시 도입할 때는 `pnpm test:smoke` 범위와 Python worker OS/Python 버전 차이를 먼저 정리한다.

## ORBIT TypeScript CI restore policy

- Context: 전체 CI 제거 뒤 사용자는 삭제된 CI 중 `typescript` 자동 검증만 다시 되살리도록 요청했다. 기존 `typescript` job은 `check-env`, `pnpm build`, `pnpm lint`, `pnpm test`를 실행했다.
- Options considered:
  - 기존 `.github/workflows/ci.yml` 전체를 복원한다.
  - `typescript` job만 별도 workflow로 복원한다.
  - build/lint만 실행하고 test는 제외한다.
- Final decision: `.github/workflows/typescript-ci.yml`을 새로 추가해 TypeScript 관련 path의 PR과 `develop` push에서 `check-env`, `pnpm build`, `pnpm lint`, `pnpm test`만 실행한다. Python worker, Compose, Playwright smoke, automation-check, detect-changes job은 복원하지 않는다.
- Rationale: 사용자가 요청한 복구 범위를 TypeScript 자동 검증으로 제한하면서, 기존 `typescript` job의 핵심 회귀 검증은 유지한다. 별도 workflow로 분리해 전체 CI 삭제 결정과 충돌하지 않도록 한다.
- Affected files: `.github/workflows/typescript-ci.yml`, `.env.staging.example`, `.env.production.example`, `apps/web/src/features/editor/shell/EditorShell.test.tsx`, `docs/testing/test-matrix.md`, `README.md`, `docs/decision-log.md`.
- Follow-up review notes: GitHub branch protection required check로 `typescript`를 다시 지정할지는 첫 PR 실행 결과를 확인한 뒤 별도 결정한다. Python worker/Compose/Playwright smoke 자동화 재도입은 별도 안정화 PR에서 검토한다.

## ORBIT rehearsal filler and long-pause detection heuristic

- Context: 리허설 리포트의 `fillerWordCount`, `fillerWordDetails`, `pauseCount`, `pauseDetails`는 이미 공식 계약에 있지만, Python worker의 filler 감지는 정확한 단어 매칭에 치우쳐 있고 긴 침묵 감지는 segment timestamp가 있을 때만 확인된다.
- Options considered:
  - `RehearsalReport`에 새 분석 필드를 추가한다.
  - LLM으로 transcript에서 filler를 재추출한다.
  - 기존 report 계약은 유지하고 Python worker의 보수적 휴리스틱과 회귀 테스트만 강화한다.
- Final decision: 기존 `RehearsalReport` 계약을 유지한다. Python worker는 `으음`, `음음`, `umm`, `uhh`처럼 늘어난 filler 토큰과 `뭐 랄까`, `you know`, `i mean`, `kind of`, `sort of` 같은 phrase filler를 canonical 표현으로 묶어 계산한다. 긴 침묵은 기존 `pauseDetails`의 segment gap 계산을 공식 경로로 유지하고 회귀 테스트로 고정한다.
- Rationale: 계약과 UI를 흔들지 않고 현재 report STT 분석 품질을 개선할 수 있다. transcript에 남지 않은 filler나 timestamp가 없는 침묵은 서버 분석만으로 복원할 수 없으므로, 이번 변경은 STT provider가 제공한 transcript와 segment metadata 안에서 안전하게 개선한다.
- Affected files: `services/python-worker/app/rehearsal.py`, `services/python-worker/tests/test_rehearsal_analyze.py`, `docs/decision-log.md`.
- Follow-up review notes: report STT provider가 word-level timestamp 또는 더 원본에 가까운 disfluency transcript를 제공하면 audio/segment 기반 pause와 filler 분석을 별도 결정으로 재검토한다.

## ORBIT local report STT model uses whisper-1

- Context: 리허설 리포트의 긴 침묵/발표 속도(WPM)/구간 속도는 STT가 준 segment timestamp와 duration으로 계산한다. 그런데 기존 로컬 기본 모델 `gpt-4o-transcribe`는 `response_format="json"`만 지원해 transcript 텍스트만 반환하고 duration·segment를 주지 않는다. 그 결과 로컬에서 리허설을 녹음해도 WPM은 `-`, 긴 침묵은 0으로만 나와 해당 지표를 테스트할 수 없었다.
- Options considered:
  - `gpt-4o-transcribe`를 유지하고 Python worker에서 오디오 길이를 별도 측정(ffprobe 등)해 duration만 확보한다. (WPM은 복구되나 segment timestamp가 없어 긴 침묵/구간 속도는 여전히 불가.)
  - report STT provider를 hosted WhisperX로 교체한다. (정밀한 word-level alignment를 얻지만 별도 추론 서버 운영이 필요.)
  - 로컬 기본 report STT 모델을 `whisper-1`로 바꿔 `verbose_json` 경로로 duration과 segment timestamp를 확보한다.
- Final decision: 로컬 설정(`.env.example`, `docker-compose.yml`)의 `OPENAI_TRANSCRIPTION_MODEL` 기본값만 `whisper-1`로 바꾼다. `_openai_response_format`은 이미 whisper-1에 대해 `verbose_json`을 반환하므로 파싱 로직 변경은 없다. staging/production 예시 설정은 이번 결정 범위에서 제외한다.
- Rationale: 코드 변경 없이 로컬에서 긴 침묵·filler·WPM 지표를 실제 데이터로 검증할 수 있다. whisper-1의 `verbose_json`만이 duration과 segment timestamp를 동시에 제공한다. 전사 텍스트 정확도는 gpt-4o 계열보다 소폭 낮을 수 있으나, 시간 기반 지표 복구가 우선이다.
- Affected files: `.env.example`, `docker-compose.yml`, `services/python-worker/tests/test_audio_transcribe.py`, `docs/decision-log.md`.
- Follow-up review notes: staging/production report STT 모델을 어떤 값으로 고정할지는 전사 정확도와 시간 지표 요구를 함께 저울질해 별도 결정으로 확정한다. 정밀한 침묵 분석이 필요하면 WhisperX provider 전환을 재검토한다.

## ORBIT staging report STT model uses whisper-1

- Context: 로컬 리허설 report STT 기본 모델을 `whisper-1`로 바꾼 뒤, 개인 서버 staging에서도 같은 긴 침묵·WPM·segment timestamp 기반 지표를 확인해야 한다. 기존 staging 예시는 `gpt-4o-transcribe`를 사용하고, `docker-compose.staging.yml`은 Doppler/staging secret의 `OPENAI_TRANSCRIPTION_MODEL` 값을 그대로 받아서 Python worker가 시간 정보 없는 transcript만 받을 수 있었다.
- Options considered:
  - staging secret 값만 수동으로 바꾼다.
  - `.env.staging.example`만 `whisper-1`로 바꾸고 compose override는 그대로 둔다.
  - `.env.staging.example`과 개인 서버 staging compose override에서 report STT 모델을 `whisper-1`로 명시한다.
- Final decision: staging 예시와 개인 서버 staging compose override의 API, worker, python-worker env에서 `OPENAI_TRANSCRIPTION_MODEL=whisper-1`을 사용한다. `REPORT_STT_PROVIDER=openai`는 유지하고 WhisperX provider로 전환하지 않는다.
- Rationale: staging에서도 local과 같은 report STT 시간 지표를 재현할 수 있고, Doppler/staging secret에 이전 모델 값이 남아 있어도 개인 서버 staging report STT 실행 경로가 흔들리지 않는다. 표준 OpenAI API key는 계속 서버 환경에만 두며 브라우저에 노출하지 않는다.
- Affected files: `.env.staging.example`, `docker-compose.staging.yml`, `docs/conventions/environment.md`, `docs/decision-log.md`.
- Follow-up review notes: production의 report STT 모델은 전사 정확도, 비용, 시간 기반 지표 요구를 따로 검토한 뒤 확정한다. staging 배포 뒤 실제 리허설 녹음에서 `durationSeconds`, `speedSamples`, `pauseDetails`가 채워지는지 확인한다.

## ORBIT AWS production deploy safety ordering

- Context: PR #232는 `main` push를 AWS production 배포로 연결하지만, `main`이 앱 workspace를 포함하지 않으면 `pnpm install`과 Docker Compose build가 실패한다. 또한 frontend S3 publish가 backend 배포보다 먼저 일어나면 실패한 backend와 새 frontend가 섞일 수 있고, CloudFront distribution-level `CustomErrorResponses`는 API 403/404를 `/index.html` 200으로 바꿀 수 있다.
- Options considered:
  - 기존 순서처럼 static web을 먼저 publish하고 distribution-level error response로 SPA fallback을 처리한다.
  - web publish를 backend 성공 후로 미루되, distribution-level error response는 유지한다.
  - production deploy branch에 앱 workspace를 포함하고, backend 배포/검증 후 web을 publish하며, SPA fallback은 default static behavior의 CloudFront Function으로 제한한다.
- Final decision: PR branch에 `origin/develop`을 merge해 production deploy branch가 앱 workspace를 포함하게 한다. EC2 wrapper는 `GitHubOwner`, `GitHubRepo`, `GitHubDeployBranch` parameter를 clone target으로 사용하고, 빈 `/opt/orbit/source`만 최초 clone 대상으로 허용한다. GitHub Actions는 SSM command를 직접 polling해 긴 Docker build/migration을 기다리고, CloudFront API/socket 검증 후 static web S3 sync와 invalidation을 수행한다. SPA fallback은 default static behavior의 CloudFront Function으로만 처리한다.
- Rationale: 같은 branch에서 web build와 EC2 deploy가 일어나야 frontend/backend contract가 맞고, backend 실패 시 새 frontend가 먼저 노출되는 상황을 피할 수 있다. API/socket behavior를 distribution-level error rewrite에서 분리해야 인증 실패나 누락 route 같은 backend 오류 의미를 유지할 수 있다.
- Affected files: `.github/workflows/deploy-aws-production.yml`, `infra/aws/main-production-bootstrap.yaml`, `docs/runbooks/aws-main-auto-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: 첫 production stack update 뒤 CloudFront Function association, `/api/health`, `/socket.io/?EIO=4&transport=polling`, `/missing-api-route`의 HTTP status, S3 static publish, EC2 `/opt/orbit/source` clone branch를 실제 AWS에서 확인한다. 장기 production 목표인 ECS Fargate 전환은 `docs/deployment.md` 기준으로 별도 PR에서 다시 검토한다.

## ORBIT AWS production EC2 bootstrap refresh

- Context: PR #237로 CloudFormation UserData에서 `/opt/orbit/source` 선생성은 제거됐지만, 기존 EC2 인스턴스의 root disk와 `/usr/local/sbin/orbit-deploy-aws-production` wrapper는 그대로 남아 있어 첫 배포가 같은 non-git checkout 방어 로직에서 다시 실패했다. CloudFormation change set은 UserData 변경을 기존 `AWS::EC2::Instance`의 in-place update로 처리했고 새 bootstrap을 실행하지 않았다.
- Options considered:
  - 기존 EC2에서 `/opt/orbit/source`만 수동 삭제한다.
  - 기존 EC2의 `/usr/local/sbin/orbit-deploy-aws-production`만 수동 교체한다.
  - EC2 logical resource id를 바꿔 새 인스턴스를 만들고 최신 bootstrap을 처음부터 실행한다.
- Final decision: production template의 EC2 logical resource를 `AppInstance`에서 `AppServerInstance`로 바꿔 CloudFormation이 새 EC2 인스턴스를 생성하도록 한다. CloudFront origin, GitHub Actions deploy role SSM target, EC2 output 참조는 새 logical id로 함께 갱신한다. RDS와 S3 bucket logical id 및 retention policy는 변경하지 않는다.
- Rationale: 운영 서버 내부 파일을 수동으로 고쳐 drift를 만들기보다, 저장소의 최신 bootstrap template을 source of truth로 삼아 재현 가능한 상태를 만든다. RDS/S3는 유지하면서 앱 서버만 새 bootstrap 상태로 교체하는 것이 이번 장애의 실제 경계에 가장 좁게 맞다.
- Affected files: `infra/aws/main-production-bootstrap.yaml`, `docs/decision-log.md`.
- Follow-up review notes: merge 후 CloudFormation change set에서 `AppServerInstance` 생성, `AppInstance` 삭제, `WebDistribution` origin 갱신, `GitHubActionsDeployRole` SSM target 갱신만 발생하고 RDS/S3 변경이 없는지 확인한다. stack update 뒤 새 `Ec2InstanceId`, SSM managed status, deploy key, `/opt/orbit/source` clone, CloudFront `/api/health`와 `/socket.io/?EIO=4&transport=polling`을 검증한다.

## ORBIT P0 parallel coaching contract boundary

- Context: 네 담당자가 평가기, 음성 측정, 집중 연습, report 통합을 병렬 구현하려면 기존 C0 read contract만으로는 사용자 focus revision, 한국어 CPM, STT confidence 부재, pause v2, 문장 target, 짧은 음성 근거의 보존·권한 경계가 고정되지 않는다. 현재 raw audio는 분석 뒤 삭제되고, 30~60초 모범 발화 audio는 Later 후보이므로 P0 Evidence Clip과도 구분해야 한다.
- Options considered:
  - 각 담당 브랜치가 필요한 enum, DTO, fixture, 저장 구조를 자체 정의한다.
  - 문서에 shape만 적고 schema와 migration은 담당 구현 PR에서 나중에 합친다.
  - shared schema, 공통 fixture, strict Python 요청 경계, focus/clip migration을 선행 PR로 고정하고 담당 구현은 이를 import한다.
- Final decision: `RehearsalFocusProfile`은 Brief와 분리된 project-level CAS aggregate로 두고 run snapshot에 revision과 item 값을 동결한다. 한국어 속도는 공백 제외 CPM v1을 canonical로, WPM을 호환값으로 둔다. STT confidence는 provider가 준 경우만 사용하고, pause v2 분류 근거가 없으면 `unknown`을 강제한다. sentence target은 text snapshot hash를 가진다. 문제 근거용 Evidence Clip은 raw audio와 별개인 최대 12초 파생물로 기본 7일 보관하고 Owner만 재생한다. report에는 clip ID만 포함하고 URL·storage key·audio file ID를 넣지 않는다. Presenter Aid는 전체 script를 숨기고 남은 시간·keyword 최대 3개·미해결 문제 최대 1개만 허용한다.
- Rationale: 계약과 fixture를 먼저 고정하면 네 구현 스트림이 같은 상태·단위·보안 경계를 사용하고, confidence·timestamp·audio가 없을 때 값을 추측하지 않는다. 12초 사용자 근거와 30~60초 모범 audio를 분리해 기존 raw audio 삭제 정책과 Later 범위를 보존한다.
- Affected files: `packages/shared/src/coaching/*`, `packages/shared/src/rehearsals/*`, `packages/shared/src/index.ts`, `packages/shared/src/README.md`, `apps/api/src/database/migrations/2026071301000-CreateP0CoachingContracts.ts`, `apps/api/src/database/data-source.ts`, `apps/worker/src/rehearsal-stt.processor.ts`, `services/python-worker/app/main.py`, `services/python-worker/app/audio/transcribe.py`, `services/python-worker/app/rehearsal.py`, `services/python-worker/tests/test_rehearsal_analyze.py`, `docs/contracts.md`, `docs/product/adaptive-rehearsal-coach-direction.md`, `docs/decision-log.md`.
- Follow-up review notes: API 구현은 focus PUT에서 CAS conflict를 HTTP 409로 매핑하고 Evidence playback마다 project Owner를 재검사한다. clip storage key는 DB 내부와 StoragePort에만 두고 로그에 남기지 않는다. 만료·조기 삭제·project 삭제는 기존 deletion outbox를 재사용한다. Editor 접근 확대, 30일 연장, 30~60초 모범 audio는 별도 제품·개인정보·권한 결정 전에는 구현하지 않는다.

## ORBIT rehearsal analysis DTO v2 contract

- Context: 기존 `/rehearsal/analyze` DTO는 `durationSeconds=0`으로 근거 없음과 실제 값을 구분하지 못하고, language/provider/model, normalized confidence, response measurement state가 없다. TypeScript sender와 Python boundary를 순차 배포하려면 양쪽이 구현할 strict v2 shape와 짧은 v1 호환 표면을 먼저 고정해야 한다.
- Options considered:
  - 기존 v1 필드에 optional field만 추가하고 `durationSeconds=0` 의미를 유지한다.
  - v1/v2 endpoint를 장기간 병행한다.
  - 같은 endpoint에서 `contractVersion: 2` request/response를 canonical로 고정하고, 기존 v1은 배포 전환 동안만 dual-read한다.
- Final decision: request와 response는 `contractVersion: 2`를 사용한다. recording/provider duration을 nullable 양수로 분리하고, segment time pair·시간 순서·finite number·ID 길이를 strict Zod schema로 검증한다. response는 Quality Gate, measurement state, capability, filler occurrence, pause v1·v2와 합계·정렬 불변식을 포함한다. confidence 미제공은 `unavailable/CONFIDENCE_NOT_PROVIDED`이며 지표 계산 자체를 차단하지 않는다. 현재 normalization profile registry는 비어 있어 알 수 없는 profile은 거부한다. v1 request schema와 합성 fixture는 Python cutover 및 retry Job drain이 끝날 때까지만 유지한다.
- Rationale: 값과 측정 상태를 함께 전달하면 `0`을 측정 실패로 오해하지 않고, 양쪽 runtime이 동일한 nested strict 계약을 독립적으로 구현할 수 있다. version literal과 명시적 compatibility schema는 부분 배포 중 신규 write와 legacy read 경계를 드러낸다.
- Affected files: `packages/shared/src/coaching/rehearsal-analyze.schema.ts`, `packages/shared/src/coaching/p0-core-contract.fixtures.json`, `packages/shared/src/coaching/p0-core-contract.schema.test.ts`, `services/python-worker/tests/test_rehearsal_analyze.py`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: Python은 canonical v2 fixture를 읽는 strict Pydantic v2 request/response와 안전한 HTTP 422 body를 구현한다. TypeScript worker는 그 다음 v2만 새로 쓰고 response를 shared schema로 parse한다. 두 runtime 배포와 retry Job drain을 확인한 뒤 v1 schema와 fixture를 별도 cleanup PR에서 제거한다.

## ORBIT rehearsal recording duration transport contract

- Context: v2 분석 DTO는 실제 녹음 전체 시간과 Provider duration을 분리하지만, 기존 Run meta와 audio-complete 요청에는 Web recorder가 측정한 실제 경과시간을 전달하는 공통 필드가 없다. 기존 worker는 Provider duration이 없으면 `0` sentinel을 만들어 실제 0과 근거 없음을 구분하지 못한다.
- Options considered:
  - Provider duration을 실제 녹음 시간으로 계속 사용한다.
  - legacy upload와 chunk upload가 서로 다른 duration 필드를 사용한다.
  - `recordingDurationSeconds` nullable 양수 계약을 audio-complete와 Run meta가 함께 사용하고 기존 payload는 `null`로 읽는다.
- Final decision: `recordingDurationSeconds`는 생략 또는 `null`, 값이 있으면 양수 finite number만 허용한다. legacy upload complete, chunk upload complete, Run meta가 같은 shared schema를 사용하며 `0`, 음수, `NaN`, `Infinity`를 거부한다. Web/API producer는 분석 enqueue 전에 값을 Run meta에 저장하고, worker는 후속 P1에서 같은 값을 v2 분석 요청에 전달하되 Provider duration으로 덮어쓰지 않는다.
- Rationale: 실제 전체 녹음 시간을 별도 canonical transport로 보존하면 duration resolver와 마지막 slide timing이 같은 근거를 사용하고, 배포 전 저장된 Run meta와 기존 complete 요청은 `null` default로 계속 읽을 수 있다.
- Affected files: `packages/shared/src/rehearsals/rehearsal.schema.ts`, `packages/shared/src/rehearsals/rehearsal.schema.test.ts`, `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`, `apps/web/src/features/rehearsal/speech/rehearsalLogCollector.ts`, `apps/web/src/features/rehearsal/speech/rehearsalLogCollector.test.ts`, `apps/web/src/features/rehearsal/speech/p3RehearsalSession.test.ts`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: Web/API producer는 legacy와 chunk upload 모두 실제 recorder 경과시간을 보내고 Run meta 저장 성공 뒤에만 분석 Job을 enqueue한다. P1 worker sender는 Run meta 값을 `recordingDurationSeconds`로 전달하고 STT Provider 값은 `providerDurationSeconds`에만 둔다.

## ORBIT environment contract CI and personal staging deployment gate

- Context: 기존 환경 검증은 TypeScript CI 내부에서 예시 파일의 key 존재와 집합만 비교했다. 허용되지 않은 빈 값·중복·잘못된 선언 형식을 잡지 못했고, `develop` push의 개인 서버 배포 workflow도 CI 결과와 독립적으로 시작했다.
- Options considered:
  - 기존 TypeScript CI 안에서만 `check-env.mjs`를 강화하고 배포 workflow는 그대로 둔다.
  - 별도 Environment Contract CI를 모든 PR과 `develop` push에서 실행하고 성공한 `develop` run만 개인 서버 배포를 시작한다.
  - 실제 Doppler 값을 PR CI에 전달해 한 번에 검사한다.
- Final decision: 환경 계약을 의존성 설치가 없는 별도 `environment-contract` job으로 분리한다. 예시 파일은 key 누락·집합 불일치·중복·형식 오류·환경별로 허용되지 않은 빈 값을 검사한다. 실제 개인 서버 값은 secret을 출력하지 않는 배포 전 Bash preflight로 검사한다. `develop` push의 자동 배포는 같은 workflow의 후속 `needs` job이 reusable deploy workflow를 호출해 검증한 `github.sha`를 wrapper에 전달하고, 서버의 실제 `develop` HEAD가 다르면 build 전에 거부한다. 상위 workflow concurrency는 PR run만 `cancel-in-progress`하고 `develop` push run은 취소하지 않는다.
- Rationale: PR에는 실제 secret을 노출하지 않으면서 환경 계약 오류를 빠르게 확인하고, merge 뒤에도 환경 검증 실패나 검증되지 않은 최신 commit이 서비스 교체까지 진행되는 것을 막는다. PR 검증은 최신 commit만 남기되, `develop` 배포가 build·migration·service 교체 도중 새 push 때문에 중간 취소되는 것은 방지한다. 수동 배포는 CI를 우회할 수 있지만 동일한 서버 환경 preflight와 Compose interpolation 검증은 반드시 거친다.
- Affected files: `.github/workflows/environment-contract-ci.yml`, `.github/workflows/typescript-ci.yml`, `.github/workflows/deploy-personal-staging.yml`, `infra/scripts/check-env.mjs`, `infra/scripts/check-personal-staging-env.sh`, `infra/scripts/deploy-personal-server.sh`, `docs/conventions/environment.md`, `docs/runbooks/personal-server-deployment.md`, `docs/testing/test-matrix.md`, `README.md`, `docs/decision-log.md`.
- Follow-up review notes: PR의 `environment-contract` check가 생성되면 GitHub `main dev protect` ruleset에 required status check로 등록해야 merge 차단이 활성화된다. PR merge 전에 개인 서버의 `/usr/local/sbin/orbit-deploy-personal-staging` wrapper를 runbook의 mode와 SHA 전달 버전으로 갱신하고, 첫 자동 배포에서 환경 오류가 key 이름만 출력되는지와 검증 SHA·서버 HEAD 일치를 확인한다.

## ORBIT personal staging Doppler environment-only redeploy

- Context: 개인 서버 컨테이너는 Doppler 값을 시작 시 읽으므로 `orbit / stg` secret만 수정·삭제하면 실행 중인 프로세스에는 반영되지 않는다. 기존 `develop` 전체 배포를 다시 실행하면 불필요한 image build가 발생하고, 필수값 삭제나 잘못된 값이 서비스 교체 뒤에 발견될 수 있다.
- Options considered:
  - Doppler 변경마다 기존 `full` build/migration 배포를 다시 실행한다.
  - 서명 검증 relay service를 추가해 GitHub App installation token을 동적으로 발급한다.
  - Doppler Webhook이 최소 권한 fine-grained token으로 기존 workflow의 `environment-only` mode를 직접 dispatch한다.
- Final decision: personal staging에만 직접 workflow dispatch를 사용한다. `environment-only` mode는 현재 `develop` SHA와 서버 HEAD 일치, 필수값·Compose 검증, 기존 이미지의 Node/Python runtime schema 검증을 모두 통과한 뒤에만 앱 컨테이너 네 개를 `--no-build --force-recreate`한다. 전체 코드 배포는 기존 `full` mode와 Environment Contract CI gate를 유지한다.
- Rationale: 앱 secret과 서버 credential을 GitHub로 복사하지 않고 기존 self-hosted runner·Doppler read-only token·배포 lock을 재사용한다. 검증 실패를 서비스 교체 전에 확정하고, 코드 변경이 없는 secret 갱신에는 image build를 생략한다. 짧은 수명의 GitHub App installation token은 relay가 없는 정적 Webhook 인증에 사용하지 않는다.
- Affected files: `.github/workflows/environment-contract-ci.yml`, `.github/workflows/deploy-personal-staging.yml`, `infra/scripts/deploy-personal-server.sh`, `docs/conventions/environment.md`, `docs/runbooks/personal-server-deployment.md`, `docs/testing/test-matrix.md`, `README.md`, `docs/decision-log.md`.
- Follow-up review notes: merge 전에 서버 wrapper를 mode와 SHA를 받되 `full`은 기존 script 호환을 위해 SHA-only로 전달하는 버전으로 갱신하고, PR #264의 단순 full redeploy 경로는 중복으로 merge하지 않는다. merge 뒤 Doppler `stg` Webhook과 `Actions: write` fine-grained token을 저장소 범위로 설정한다. 첫 변경에서 preflight 실패 시 기존 컨테이너가 유지되는지, 성공 시 네 앱 컨테이너만 재생성되는지, 중복 delivery가 직렬화되는지 확인한다.
## ORBIT AWS production private evidence Redis isolation

- Context: `main` 자동 배포가 API migration의 production 환경 검증에서 `PRIVATE_EVIDENCE_REDIS_URL must not use the local default in production`으로 중단됐다. private evidence 원문은 최대 30분만 보존하고 작업큐 Redis의 persistence·volume·backup 경계와 분리해야 하지만, AWS Compose에는 전용 서비스와 URL 주입이 없었다. 기존 EC2의 `/etc/orbit/production.env`는 저장소 template 변경으로 자동 갱신되지 않는다.
- Options considered:
  - 기존 작업큐 Redis를 private evidence에도 공유하고 production 검증을 완화한다.
  - 기존 `/etc/orbit/production.env`에 전용 URL만 수동 추가하고 같은 Redis를 사용한다.
  - AWS Compose에 volume·RDB·AOF·host port가 없는 별도 Redis를 추가하고 API/Worker에 내부 URL을 직접 주입한다.
- Final decision: `docker-compose.aws.yml`에 `private-evidence-redis`를 추가하고 `--save "" --appendonly no`로 실행한다. API와 Worker는 `PRIVATE_EVIDENCE_REDIS_URL=redis://private-evidence-redis:6379`을 Compose `environment`에서 직접 받고 `service_healthy`를 기다린다. EC2 deploy wrapper는 작업큐 Redis와 private evidence Redis를 최대 120초 기다린 뒤 migration을 실행한다. 현재 EC2 env 파일에 새 키가 없어도 첫 복구가 가능하도록 `required_keys`에는 추가하지 않는다.
- Rationale: 작업큐 데이터의 영속성과 발표 원문의 비영속 보존 정책을 분리하고, 기존 운영 env 파일을 수동 변경해야만 배포되는 순서 의존성을 없앤다. production에서 로컬 기본값을 거부하는 기존 검증은 유지하며, PR CI가 정확한 URL·비영속 설정·health dependency·CloudWatch stream·AWS template 동기화를 검사한다.
- Affected files: `docker-compose.aws.yml`, `infra/scripts/deploy-aws-ec2.sh`, `infra/aws/ec2-production.env.example`, `infra/aws/main-production-bootstrap.yaml`, `infra/scripts/check-aws-production-compose.mjs`, `.github/workflows/environment-contract-ci.yml`, `docs/runbooks/aws-main-auto-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: Redis `maxmemory`와 CloudWatch memory alarm은 실제 사용량을 측정한 뒤 별도 결정한다. ElastiCache 또는 managed Redis 전환과 SSM 기반 전체 production env 자동 동기화는 이번 장애 복구 범위에 포함하지 않는다. merge 후 두 Redis health, migration, API/Socket.IO, static web 배포를 새 `main` workflow에서 확인한다.

## ORBIT personal staging env source policy and safe Doppler sync

- Context: 새 env key가 예시 파일에 추가돼도 Doppler key 생성과 개인 서버 Compose 전달은 별개여서, 운영자가 key를 하나씩 만들고 서버 배포 script를 다시 실행했다. 모든 예시 값을 Doppler에 일괄 복사하면 secret placeholder나 환경별 URL을 실제 값처럼 저장하고 기존 secret을 덮어쓸 위험이 있다.
- Options considered:
  - `.env.staging.example` 전체를 매번 Doppler에 bulk upload한다.
  - 새 key를 계속 수동 등록하고 서버 배포 script를 직접 실행한다.
  - 각 key의 source와 개인 서버 delivery를 정책 파일로 분류하고, 누락된 안전한 일반 설정만 추가한 뒤 기존 webhook으로 재배포한다.
- Final decision: `infra/env/personal-staging-env-policy.json`에서 모든 staging key를 `repo-default`, `doppler-optional`, `doppler-required`와 `compose`, `code-default` 조합으로 분류한다. Environment Contract CI는 정책 누락·추가 key·안전하지 않은 repo default·Compose 전달 불일치를 차단한다. `develop` full 배포는 GitHub Environment의 config-scoped `DOPPLER_STG_SYNC_TOKEN`으로 기존 값을 덮어쓰지 않고 누락된 `repo-default` + `compose` key만 한 번에 추가한 뒤 개인 서버를 배포한다. 환경별 값과 secret은 자동 생성하지 않고 누락 시 배포를 차단한다.
- Rationale: 일반 설정은 저장소의 검토 가능한 기본값으로 자동화하면서 secret 값의 출처와 변경 권한은 Doppler에 남긴다. 동기화가 기존 값을 수정하지 않고 하나의 Doppler 변경으로 처리되므로 webhook 재배포도 key 수만큼 반복되지 않는다. 개인 서버 runtime의 read-only Doppler token과 GitHub-hosted sync job의 `orbit / stg` 전용 read/write token을 분리하며, full 배포와 webhook 후속 배포는 같은 concurrency group에서 직렬화한다.
- Affected files: `.github/workflows/deploy-personal-staging.yml`, `.github/workflows/environment-contract-ci.yml`, `infra/env/personal-staging-env-policy.json`, `infra/scripts/personal-staging-env.mjs`, `infra/scripts/personal-staging-env.test.mjs`, `infra/scripts/sync-personal-staging-doppler.mjs`, `infra/scripts/check-env.mjs`, `docker-compose.staging.yml`, `package.json`, `docs/conventions/environment.md`, `docs/runbooks/personal-server-deployment.md`, `docs/testing/test-matrix.md`, `docs/decision-log.md`.
- Follow-up review notes: merge 전에 GitHub Environment `personal-staging`에 `DOPPLER_STG_SYNC_TOKEN`을 등록한다. 첫 `develop` push에서 key 이름만 출력되는지, sync job 성공 뒤 full 배포가 실행되는지, Doppler Webhook Logs와 `trigger_source=doppler-stg-secrets-update` 후속 실행이 직렬화되는지 확인하고 실제 값 또는 token은 로그에 남기지 않는다.

## ORBIT editor one-slide practice privacy and retention

- Context: 편집기에서 현재 슬라이드를 바로 연습하고 습관어와 목소리 스타일을 즉시 분석하되, 발표 음성과 전사 원문은 민감 데이터이며 기존 공식 리허설 리포트와 권한·수명주기가 다르다.
- Options considered:
  - raw audio와 transcript를 서버에 저장해 재분석한다.
  - 모든 결과를 기존 `rehearsal_runs.report_json`에 합친다.
  - 브라우저에서 원음과 전사를 일시 처리하고 파생 지표만 creator-private 전용 테이블에 저장한다.
- Final decision: raw audio와 transcript는 브라우저 메모리에서만 처리하고 서버에는 저장하지 않는다. 파생 연습 보고서는 `slide_practice_reports`에 90일, user/device voice baseline은 `user_voice_baselines`에 180일 보관한다. 연습 보고서는 생성 사용자만 조회하고 공식 `RehearsalReport`와 분리한다.
- Rationale: 즉시 피드백과 기록 비교를 제공하면서 민감한 원문 보존을 최소화하고 공식 리허설 계약을 흔들지 않는다.
- Affected files: `packages/shared/src/slide-practice/**`, `apps/api/src/slide-practice/**`, `apps/web/src/features/editor/practice/**`, `apps/api/src/database/migrations/2026071701000-CreateSlidePracticeAndQuestionGuides.ts`, `docs/contracts.md`.
- Follow-up review notes: worker의 주기적 retention cleanup은 구현했다. 사용자의 즉시 삭제 UI는 후속 운영 작업으로 남기고, 원음 보존이 필요해지면 별도 opt-in·암호화·삭제 정책 승인을 먼저 받는다.

## ORBIT editor practice voice classifier v2

- Context: 실제 한 장 연습의 파생 지표 분포에서 `classifierVersion: 1`의 pitch·음량·속도·리듬 조건이 지나치게 좁고, `turbo`의 `pauseRatio < 0.12` 조건은 전체 연습 구간 무음 비율의 의미와 맞지 않아 대부분 `neutral`로 저장됐다. 측정 분량이 부족한 결과에도 `neutral` 유형이 붙어 판정 결과처럼 보였다.
- Options considered:
  - UI의 유형 이름만 바꾸고 기존 판정식을 유지한다.
  - 과거 보고서를 조회할 때마다 새 기준으로 재분류한다.
  - 과거 v1 결과는 보존하고 신규 결과에만 완화된 v2 기준과 측정 보류 정책을 적용한다.
- Final decision: shared report schema는 `classifierVersion: 1 | 2`를 읽고 신규 Web 보고서는 v2로 저장한다. v2는 pitch, 속도, 음량, 리듬 경계를 실제 파생 지표 범위에 맞게 완화하고 `lullaby -> announcer -> turbo -> cloud -> neutral` 순서로 판정한다. `unmeasured`는 호환 가능한 neutral mode와 confidence 0으로 저장하지만 UI에서는 `판단 보류`로 표시하고 voice baseline 갱신에서도 제외한다. 판단 근거와 `loudnessDb`는 즉시 결과와 저장 기록에서 함께 보여준다.
- Rationale: 저장된 결과의 의미를 소급 변경하지 않으면서 신규 연습에서 구분 가능한 피드백을 늘리고, 측정되지 않은 결과를 안정형으로 오해하는 문제를 막는다. 원음이나 전사 원문을 추가 저장하지 않고 기존 파생 지표만 사용한다.
- Affected files: `packages/shared/src/slide-practice/slide-practice.schema.ts`, `apps/web/src/features/editor/practice/voiceStyleClassifier.ts`, `apps/web/src/features/editor/practice/useSlidePracticeSession.ts`, `apps/web/src/features/editor/practice/SlidePracticePanel.tsx`, `apps/web/src/features/editor/practice/SlidePracticeHistoryPanel.tsx`, 관련 테스트와 스타일, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: staging에서 classifier v2의 유형별 aggregate 분포와 `quality.state`만 확인한다. raw audio, transcript, 사용자별 상세 음성 지표는 운영 로그에 남기지 않는다. 데이터가 충분히 쌓이면 경계값 변경은 새 classifier version으로 관리한다.

## ORBIT editor slide question guide canonical storage

- Context: 현재 슬라이드의 예상 질문과 추천 답변은 project-private 원문이며, 공통 계약은 Question·AnswerGuide·발표 메모·참고자료 원문을 generic Job payload/result에 저장하지 못하게 한다.
- Options considered:
  - Job result에 질문과 추천 답변을 직접 넣는다.
  - 질문 생성 전체를 브라우저에서 수행한다.
  - Job은 `guideId` 같은 식별자만 운반하고 canonical 질문은 권한이 적용되는 전용 table에서 조회한다.
- Final decision: `slide-question-guide-generation` Job payload/result는 bounded identifier와 상태 메타데이터만 가진다. 질문과 추천 답변은 `slide_question_guides`와 `slide_question_guide_items`에 저장하며 project read 권한 API를 통해서만 반환한다. 생성 시 deck version과 slide canonical hash를 고정하고, 같은 private guide row에 해당 버전의 최소 텍스트 snapshot을 저장한다. worker는 Presentation Brief에서 승인되고 file hash가 유지된 reference chunk만 strict Python/OpenAI provider 경계로 전달하며, 반환된 source ID·version·hash를 allowlist로 재검증한다. source가 바뀌면 stale failure로 처리하고 과거 guide 원문은 UI에서 숨긴다.
- Rationale: 기존 Job privacy 계약을 지키고, 저장된 checkpoint보다 앞선 live deck patch를 worker가 잘못 읽는 경쟁 조건을 피하며, 승인되지 않은 참고자료나 덱 수정 전 질문이 최신 근거처럼 노출되는 것을 방지한다.
- Affected files: `packages/shared/src/slide-practice/slide-question-guide.schema.ts`, `packages/shared/src/jobs/job.schema.ts`, `packages/job-queue/src/index.ts`, `apps/api/src/slide-question-guides/**`, `apps/worker/src/slide-question-guide-generation.processor.ts`, `services/python-worker/app/slide_question_guides.py`, `docs/contracts.md`.
- Follow-up review notes: OpenAI model이나 prompt를 바꿀 때도 worker의 allowlisted source reference 검증과 insufficient remediation을 유지하고, `prompt_version`을 올려 별도 cache identity로 취급한다.

## ORBIT editor slide question official web research

- Context: 슬라이드와 승인 참고자료만으로는 외부 프로그램·기관·제품의 구체적인 사실을 답하기 어려워 `insufficient`가 반복되지만, 무제한 검색이나 웹 원문 저장은 비용·privacy·prompt injection·출처 위조 위험을 만든다.
- Options considered:
  - 검색 결과 전체와 본문을 guide 또는 Job에 저장한다.
  - 검색 결과를 검증하지 않고 질문 생성 모델에 그대로 전달한다.
  - 제한된 slide title·Brief 용어만 최대 2회 검색하고, 별도 strict 판정에서 official로 확인된 cited excerpt만 생성 중 메모리에서 사용한다.
- Final decision: 신규 guide는 `schemaVersion: 2`, `promptVersion: slide-question-guide-v2`를 사용하며 과거 v1 guide는 계속 읽는다. OpenAI Responses `web_search`는 slide title과 bounded `challengeTopics`·terminology만 질의에 사용하고 최대 2회 실행한다. 검색 citation은 공급된 source ID만 반환할 수 있는 strict vetting을 거쳐 정부·학교·회사·표준기관·프로그램 운영 주체의 official source만 최대 5개 허용한다. worker는 Python response의 별도 web source allowlist와 item source ref의 URL·제목·hash·조회시각을 정확히 대조한다. DB에는 검색 상태·시도 횟수·공식 출처 수·issue code·조회시각과 표시용 source metadata만 저장하고 검색어·웹 원문·cited excerpt는 저장하거나 로그에 남기지 않는다. 검색이 실패하면 기존 slide·승인 참고자료 생성으로 degrade한다.
- Rationale: 예상 질문의 외부 사실 근거를 보강하면서도 검색 질의로 전송되는 project-private 텍스트와 영구 보존 데이터를 최소화하고, 모델이 임의 URL을 출처처럼 추가하지 못하게 한다. 검색 장애가 기존 질문 생성을 막지 않으며 사용자에게 fallback 여부와 클릭 가능한 공식 출처를 명확히 보여준다.
- Affected files: `packages/shared/src/slide-practice/slide-question-guide.schema.ts`, `apps/api/src/database/migrations/2026071702000-AddSlideQuestionGuideWebResearch.ts`, `apps/api/src/slide-question-guides/slide-question-guides.service.ts`, `apps/worker/src/slide-question-guide-generation.processor.ts`, `services/python-worker/app/slide_question_web_research.py`, `services/python-worker/app/slide_question_guides.py`, `apps/web/src/features/editor/practice/SlideQuestionGuidePanel.tsx`, `docs/contracts.md`.
- Follow-up review notes: 실제 provider 비용과 official source 성공률은 staging에서 aggregate event의 `status`, `attempts`, `officialSourceCount`, `issueCodes`만으로 점검한다. URL, 질의, slide/reference 원문은 운영 로그에 추가하지 않는다. domain allowlist가 필요한 regulated project는 별도 정책과 UI 승인을 거쳐 도입한다.

## ORBIT slide question guide bounded fast path

- Context: 로컬 성공 Job도 약 33초가 걸리고 provider가 응답하지 않으면 Python request 단계에서 약 129초 뒤 실패했다. 기존 경로는 web search, 별도 official source vetting, 질문·답변 생성의 OpenAI 호출 3개를 직렬 실행하며 대상 외 slide와 승인 참고자료도 큰 transient prompt로 전달했다.
- Options considered:
  - UI polling 간격만 줄인다.
  - official source 판정을 생략하거나 URL suffix만으로 official 여부를 결정한다.
  - web search는 유지하되 official source 판정을 질문 생성 strict output에 합치고, provider 단계별 timeout과 bounded context를 적용한다.
- Final decision: 예상 질문 provider 경로는 최대 1회의 `web_search`와 1회의 strict 질문 생성 호출만 사용한다. 생성 output의 `officialSourceIds`는 검색 candidate allowlist에 존재해야 하고, item의 web source ref는 해당 ID의 canonical URL·제목·hash·조회시각과 정확히 일치해야 한다. 검색은 12초 뒤 slide/reference fallback, 생성은 45초, Worker 요청은 70초로 제한한다. 대상 slide는 content 4,000자와 speaker notes 6,000자, 나머지 slide는 각 600자, 승인 reference는 최대 4개와 각 1,200자로 제한한다. `webSearchMs`, `generationMs`, `totalProviderMs`는 로그용 transient metadata로만 반환하고 저장하지 않는다.
- Rationale: source allowlist와 official 판정 경계를 유지하면서 provider 호출을 3회에서 2회로 줄이고, 긴 검색 장애가 전체 질문 생성을 막지 않게 한다. 대상 slide의 근거는 유지하고 주변 slide는 흐름 파악에 필요한 bounded context만 전달해 입력 처리 시간을 줄인다.
- Affected files: `services/python-worker/app/slide_question_web_research.py`, `services/python-worker/app/slide_question_guides.py`, `apps/worker/src/slide-question-guide-generation.processor.ts`, 관련 테스트, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: staging에서는 단계별 duration과 research status aggregate만 확인한다. 검색어, cited excerpt, slide/reference 원문, speaker notes, provider response는 로그에 남기지 않는다. 공식 source 성공률이 하락하면 호출 수를 다시 늘리기 전에 prompt와 candidate 품질을 먼저 검토한다.

## ORBIT editor practice rollout and transcription fallback

- Context: 브라우저별 온디바이스 Web Speech 지원이 다르고, 기존 per-session 체크박스가 연습 시작 흐름을 복잡하게 만들었다. 외부 실시간 전사로 전환하더라도 raw audio와 transcript를 영구 저장하지 않는 기존 privacy boundary는 유지해야 한다.
- Options considered:
  - 모든 브라우저에서 OpenAI Realtime을 기본 사용한다.
  - 온디바이스 전사가 실패하면 연습 전체를 막는다.
  - 온디바이스를 우선하고 실패 시 OpenAI Realtime으로 자동 fallback하며, 전사가 없어도 PCM 음성 분석은 계속한다.
- Final decision: `SLIDE_PRACTICE_ENABLED`와 `SLIDE_QUESTION_GUIDES_ENABLED`를 독립 runtime flag로 둔다. 사용자가 연습 시작을 선택하면 온디바이스 Web Speech를 우선하고, 사용할 수 없을 때 별도 체크 없이 OpenAI Realtime으로 자동 fallback한다. 전사가 모두 실패하면 `stt-unavailable` 품질 reason을 남기고 음성 파생 측정만 계속한다. raw audio와 transcript는 브라우저 메모리에서만 처리하고 서버 저장소에는 보관하지 않는다.
- Rationale: 한 번의 연습 시작 동작으로 브라우저 capability 차이를 흡수하면서도 원음과 전사 원문을 영구 저장하지 않는 최소 보존 원칙을 유지한다.
- Affected files: `packages/config/src/index.ts`, `packages/shared/src/config/runtime-config.schema.ts`, `apps/api/src/runtime-config/runtime-config.controller.ts`, `apps/web/src/features/editor/shell/components/EditorBottomDock.tsx`, `apps/web/src/features/editor/practice/useSlidePracticeSession.ts`, environment examples, `docker-compose.yml`.
- Follow-up review notes: staging에서 Chrome/Edge 언어팩 지원율, 자동 fallback 비율, `quality.reason` 분포를 확인한 뒤 production flag를 활성화한다. 개인정보 처리방침에는 서버 실시간 전사로 자동 전환될 수 있다는 점과 원문 비보존 정책을 일관되게 반영한다.

## ORBIT editor slide practice server analysis cutover

- Context: 브라우저 Web Speech와 Web Audio를 동시에 사용하면 브라우저별 지원·마이크 처리 차이 때문에 말 속도, pitch, 음량, 습관어 결과가 불안정했다. 사용자는 바로 연습 원본을 서버에 임시 전송하는 것을 허용했고, 저장소에는 이미 Report STT, private audio upload, BullMQ, Storage deletion outbox 경계가 있다.
- Options considered:
  - 기존 Web Speech + Web Audio 분석을 유지하고 임계값만 다시 조정한다.
  - 공식 리허설 run/report를 바로 연습에도 그대로 생성한다.
  - `MediaRecorder`로만 녹음하고 별도 creator-private analysis aggregate에서 기존 Report STT와 서버 PCM 분석을 실행한다.
- Final decision: 신규 바로 연습은 `slide-practice-audio` private purpose, `slide_practice_audio_analyses`, `slide-practice-analysis` Job을 사용한다. Web은 `MediaRecorder`만 사용한다. Python worker는 기존 Report STT provider와 16kHz PCM decoder를 재사용하고, 서버 metric v2에서 기존 60ms frame·`-48 dBFS`·70~420Hz·correlation 0.55 기준을 적용한다. TypeScript worker는 transcript를 메모리에서만 사용해 습관어와 음절 속도를 계산하고 파생 report만 90일 저장한다. raw audio는 성공·실패 직후 삭제하고 실패 시 deletion outbox로 재시도하며, transcript는 API·Job·DB·report·로그에 저장하지 않는다. classifier v2 임계값과 유형 우선순위는 변경하지 않는다. 이 결정은 앞선 브라우저 메모리 전용 및 Web Speech fallback 결정을 신규 바로 연습 경로에 한해 대체한다.
- Rationale: 공식 리허설 aggregate와 바로 연습 기록을 분리한 채 검증된 서버 STT·storage lifecycle을 재사용하고, 브라우저 capability 차이를 제거한다. 원음 보존 시간을 분석 처리 구간으로 제한하고 transcript 영구 저장을 막아 서버 분석 도입에 따른 개인정보 범위를 최소화한다.
- Affected files: `packages/shared/src/files/file.schema.ts`, `packages/shared/src/slide-practice/**`, `packages/shared/src/coaching/private-audio-cleanup.schema.ts`, `packages/shared/src/jobs/job.schema.ts`, `packages/job-queue/src/index.ts`, `apps/api/src/slide-practice/**`, `apps/api/src/database/migrations/2026071703000-CreateSlidePracticeAudioAnalyses.ts`, `apps/worker/src/slide-practice-analysis.processor.ts`, `apps/worker/src/storage-deletion-reconciler.ts`, `services/python-worker/app/audio/slide_practice.py`, `services/python-worker/app/main.py`, `apps/web/src/features/editor/practice/**`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: staging에서 analysis latency, bounded error code, raw audio deletion retry 상태만 aggregate로 확인한다. transcript, storage URL/key, audio file ID, 사용자별 세부 음성 지표는 운영 로그에 추가하지 않는다. 30분 만료 upload의 삭제 outbox enqueue와 project/user 삭제 cascade를 운영 점검한다.

## ORBIT editor practice voice classifier v3 two-style rollout

- Context: 바로 연습 결과에서 아나운서형·구름형·기본형을 신규 판정으로 계속 제공하기보다 사용자가 요청한 자장가형·터보형 두 피드백에 집중하고, 자장가형에는 작은 음량과 낮은 pitch 폭뿐 아니라 실제 느린 발화 근거가 필요하다. 기존 v1·v2 보고서에는 제거 대상 유형이 이미 저장될 수 있어 enum을 물리적으로 삭제하면 creator-private 연습 기록 조회가 깨진다.
- Options considered:
  - shared enum에서 `announcer`, `cloud`, `neutral`을 제거하고 과거 기록을 읽지 못하게 한다.
  - classifier v2 의미를 제자리에서 바꾸고 과거 결과도 조회 시 재분류한다.
  - 과거 enum과 결과는 읽기 호환으로 유지하고 신규 classifier v3만 자장가형·터보형을 생성하며 나머지는 유형 없는 판단 보류로 표시한다.
- Final decision: 신규 server report는 `classifierVersion: 3`을 저장한다. v3는 `lullaby -> turbo -> neutral` 순서로 평가하며 `announcer`와 `cloud`를 생성하지 않는다. `lullaby`는 `loudnessDb < -38`, 낮은 pitch 폭, `syllablesPerSecond < 3.2` 또는 사용자 baseline보다 `0.8` 이상 느린 조건을 모두 요구한다. `turbo`의 `syllablesPerSecond > 4.8` 또는 baseline보다 `0.8` 초과와 `pauseRatio < 0.70` 기준은 유지한다. 어느 조건도 만족하지 않거나 측정 분량이 부족하면 저장 호환용 `neutral`, `confidence: 0`을 사용하고 UI에는 `판단 보류`로 표시한다. v1·v2의 `announcer`, `cloud`, `neutral`은 과거 보고서 읽기 전용으로 유지한다.
- Rationale: 사용자에게 노출되는 신규 유형을 두 개로 제한하면서도 과거 보고서와 공통 API 계약을 깨지 않는다. 느린 속도를 자장가형의 필수 근거로 추가해 작고 단조롭지만 빠른 발화를 자장가형으로 분류하는 오판을 줄인다.
- Affected files: `packages/shared/src/slide-practice/slide-practice-analysis.ts`, `packages/shared/src/slide-practice/slide-practice.schema.ts`, `apps/worker/src/slide-practice-analysis.processor.ts`, `apps/web/src/features/editor/practice/SlidePracticePanel.tsx`, 관련 테스트, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: staging에서는 유형별 aggregate count와 판단 보류 비율만 확인한다. 사용자별 음량·pitch·속도 원값, transcript, raw audio는 운영 로그에 남기지 않는다. 실제 분포상 자장가형이 지나치게 적으면 기존 결과를 재분류하지 않고 classifier v4로만 임계값을 조정한다.

## ORBIT editor practice voice classifier v4 pitch-and-slow lullaby

- Context: 정상 측정된 바로 연습에서도 v3의 음량·낮은 pitch 폭·느린 속도 결합 조건 때문에 자장가형이 거의 생성되지 않았다. 실제 저장 지표에서 낮은 pitch 폭은 충족했지만 속도가 기존 절대 경계에 근소하게 미달했고, 사용자는 음량을 자장가형 판정에서 제외하기를 원했다.
- Options considered:
  - v3의 음량 임계값만 완화하고 세 조건 결합을 유지한다.
  - 음량 조건을 제거하고 기존 pitch·속도 경계를 그대로 유지한다.
  - 음량 조건을 제거하고 낮은 pitch 폭을 유지하면서 절대 속도 경계를 완화한다.
- Final decision: 신규 server report는 `classifierVersion: 4`를 저장한다. v4 `lullaby`는 `pitchSpanHz < max(45, baselinePitchSpanHz * 0.80)`와 `syllablesPerSecond < 3.5` 또는 사용자 baseline보다 `0.8` 이상 느린 조건을 함께 요구하며 `loudnessDb`는 판정에 사용하지 않는다. `turbo` 기준, `lullaby -> turbo -> neutral` 우선순위, 측정 부족 시 판단 보류 정책은 유지한다. v1·v2·v3 결과는 조회 시 재분류하지 않는다.
- Rationale: 음량 측정 차이가 자장가형 판정을 막지 않게 하면서도 낮은 억양 변화와 느린 속도라는 두 근거를 유지한다. 새 classifier version으로 저장해 과거 보고서의 판정 의미와 API 읽기 호환성을 보존한다.
- Affected files: `packages/shared/src/slide-practice/slide-practice-analysis.ts`, `packages/shared/src/slide-practice/slide-practice.schema.ts`, `apps/worker/src/slide-practice-analysis.processor.ts`, 관련 테스트, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: staging에서는 v4의 자장가형·터보형·판단 보류 aggregate count만 확인한다. 사용자별 음량·pitch·속도 원값, transcript, raw audio는 운영 로그에 남기지 않는다. 경계 변경이 다시 필요하면 기존 결과를 재분류하지 않고 새 classifier version으로 관리한다.

## ORBIT editor slide practice graph and AI coaching report

- Context: 슬라이드별 바로 연습 리포트는 aggregate 음성 지표와 유형만 보여서 어느 시간대에 음량·속도가 달라졌는지 알기 어려웠다. 사용자는 데시벨 세로 막대, 속도 선 그래프, 습관어·속도·쉼·pitch·음량을 함께 보는 대본 기반 개선점만 리포트에 표시하기를 요청했다.
- Options considered:
  - Web Audio를 다시 사용해 브라우저에서 그래프와 조언을 만든다.
  - raw audio 또는 transcript를 저장하고 별도 비동기 코칭 Job에서 다시 분석한다.
  - 기존 server PCM/STT 분석에서 bounded numeric sample을 만들고, 같은 분석 Job이 private deck version의 발표 메모와 파생 지표만 OpenAI에 보내 코칭을 생성한다.
- Final decision: 신규 `reportVersion: 2`는 1초 `loudnessSamples`와 5초 `speedSamples`, `coaching.policyVersion: 1` 결과를 creator-private `slide_practice_reports.report_json`에 저장한다. 원음은 STT/PCM 응답 검증 직후 삭제하고 코칭 provider에는 보내지 않는다. Report STT transcript도 코칭 입력·Job·DB·로그에 넣지 않는다. 대본 수정 원문은 frozen deck version의 `speakerNotes`와 완전히 일치할 때만 최대 1,000자로 저장한다. deterministic policy에 issue가 없으면 OpenAI 호출 없이 승인 문구를 저장하고, provider 실패는 코칭만 `unavailable`로 처리한다. UI는 데시벨 세로 막대, 속도 선 그래프, 개선할 점 세 영역만 보여주며 v1 기록은 빈 그래프/코칭 상태로 읽는다.
- Rationale: 기존 Report STT와 PCM 분석을 재사용해 브라우저별 차이를 다시 만들지 않고, 원음·전사 원문 보존 범위를 넓히지 않으면서 시간별 피드백과 대본 수정 조언을 제공할 수 있다. deterministic gate가 개선 필요 여부를 소유하므로 LLM 결과의 변동성과 과도한 판단을 제한한다.
- Affected files: `packages/shared/src/slide-practice/**`, `services/python-worker/app/audio/slide_practice.py`, `services/python-worker/app/slide_practice_coaching.py`, `services/python-worker/app/main.py`, `apps/worker/src/slide-practice-analysis.processor.ts`, `apps/web/src/features/editor/practice/**`, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: staging에서는 graph sample 개수, coaching status·issue code·latency aggregate만 확인한다. transcript, 전체 speaker notes, raw audio, storage URL, 사용자별 원시 sample 값은 로그에 남기지 않는다. 임계값 변경은 기존 report를 재분류하지 않고 새 policy version으로 관리한다.

## ORBIT slide question guide single-item carousel

- Context: 예상 질문 3개 목록과 답변 영역을 동시에 보여주면 작은 editor dock에서 질문·답변의 대응 관계를 따라가기 어렵다. 사용자는 한 번에 질문과 답변 한 세트만 보고 좌우 화살표로 이동하기를 요청했다.
- Options considered:
  - 기존 왼쪽 질문 목록을 유지한다.
  - 질문만 carousel로 바꾸고 추천 답변은 접힌 상태를 유지한다.
  - 질문·추천 답변을 하나의 card로 묶고 이전/다음 화살표와 현재 번호를 제공한다.
- Final decision: 예상 질문 UI는 한 번에 하나의 질문, 핵심 개념, 추천 답변 또는 근거 부족 remediation, 공식 출처를 표시한다. `이전 질문`·`다음 질문` 버튼과 `현재/전체` 번호를 제공하고 첫·마지막 버튼은 비활성화한다. focus된 carousel에서는 좌우 방향키도 같은 이동을 수행한다. 저장/API/Job 계약은 변경하지 않는다.
- Rationale: question-guide privacy와 생성 계약을 건드리지 않고 작은 화면에서 한 질문과 답변에 집중할 수 있으며, 버튼 label과 disabled state로 접근 가능한 순차 탐색을 제공한다.
- Affected files: `apps/web/src/features/editor/practice/SlideQuestionGuidePanel.tsx`, `apps/web/src/features/editor/practice/SlideQuestionGuidePanel.test.tsx`, `apps/web/src/features/editor/editor-shell.css`.
- Follow-up review notes: 실제 dock 폭에서 답변 길이, keyboard focus, 공식 출처 링크가 화살표 탐색 후 올바른 질문에 맞춰 바뀌는지 확인한다.

## ORBIT slide question guide current deck reconstruction

- Context: 예상 질문 API는 `DecksService`를 통해 `decks` checkpoint와 이후 `deck_patches`를 재생한 최신 deck version으로 guide를 고정하지만, Worker는 `decks` row만 읽었다. checkpoint가 v1이고 유효한 patch tail이 v2를 만든 상태에서 guide v2를 실제 변경으로 오인해 `SLIDE_QUESTION_GUIDE_SOURCE_STALE`로 실패했다.
- Options considered:
  - 예상 질문 생성 전에 API가 항상 전체 deck checkpoint를 다시 저장하고 patch tail을 compact한다.
  - Worker가 질문 생성 Job의 identifier-only payload에 전체 Deck을 추가한다.
  - Worker가 같은 DB snapshot에서 checkpoint와 patch tail을 읽고 canonical `applyDeckPatch`로 최신 deck을 재구성한다.
- Final decision: `slide-question-guide-generation` Worker는 단일 DB query snapshot에서 `decks` checkpoint와 정렬된 `deck_patches` tail을 읽고 `@orbit/editor-core`의 `applyDeckPatch`로 최신 Deck을 재구성한다. 재구성된 version과 slide canonical hash가 frozen guide source와 다를 때만 기존 stale failure를 유지한다. Job payload/result와 guide 저장 계약은 변경하지 않는다.
- Rationale: 일반 편집마다 전체 Deck checkpoint를 강제하지 않고 기존 persistence 구조를 유지하며, 전체 Deck을 Job에 복제하지 않아 privacy 계약을 지킨다. API와 같은 canonical patch 적용기를 사용해 element, notes, style 등 모든 patch operation을 빠짐없이 반영한다.
- Affected files: `apps/worker/src/slide-question-guide-generation.processor.ts`, `apps/worker/src/slide-question-guide-generation.processor.spec.ts`, `apps/worker/package.json`, `pnpm-lock.yaml`, `docs/decision-log.md`.
- Follow-up review notes: checkpoint v1 + patch tail v2 + guide v2 회귀 테스트를 유지한다. 향후 다른 Worker에서도 current Deck 전체가 필요하면 중복 SQL을 늘리지 말고 공용 server-side deck state reader 경계를 별도 검토한다.

## ORBIT stable privileged shim and Git-managed deploy implementation

- Context: 개인 서버의 root 소유 wrapper가 mode와 expected SHA 인자를 전달하지 않는 오래된 형태로 남아 있었다. 그 결과 `environment-only` workflow도 Git 관리 deploy script의 기본값인 `full`로 실행되어 Git pull을 시도했고, 검증된 SHA 고정도 우회했다. 저장소의 배포 계약과 `/usr/local/sbin`의 설치 상태가 서로 달라지는 drift를 자동 테스트로 감지할 수 없었다.
- Options considered:
  - root wrapper에 mode·SHA 검증과 호환 분기를 계속 복제한다.
  - 배포가 실행될 때마다 현재 checkout의 wrapper를 root 경로에 자동 복사한다.
  - root wrapper는 사용자 전환과 `"$@"` 전달만 담당하는 stable privileged shim으로 고정하고, 변경 가능한 검증·배포 구현은 Git 관리 script 한 곳에 둔다.
- Final decision: `infra/scripts/orbit-deploy-personal-staging-wrapper.sh`를 `/usr/local/sbin/orbit-deploy-personal-staging`의 검토 가능한 원본으로 관리한다. 설치된 파일은 `root:root 0750`을 유지하고 `/usr/bin/sudo -iu orbit -- /bin/bash /var/www/orbit/infra/scripts/deploy-personal-server.sh "$@"`만 실행한다. wrapper는 배포 중 자동 갱신하지 않으며, 변경이 필요할 때 검토된 원본을 root 전용 백업 후 원자적으로 한 번 교체한다. mode·SHA 검증과 실제 배포 정책은 `infra/scripts/deploy-personal-server.sh`가 단독 소유한다.
- Rationale: sudoers가 허용하는 root 진입점을 작고 안정적으로 유지하면서 정책 중복과 stale wrapper drift를 제거한다. `bash -lc` 문자열 조합 없이 인자 경계를 보존하고, checkout의 검토된 deploy script가 `full`과 `environment-only`의 유일한 구현이 된다. 배포가 자기 root wrapper를 자동 변경하지 않으므로 권한 상승 경계도 별도 운영 승인 아래 유지된다.
- Affected files: `infra/scripts/orbit-deploy-personal-staging-wrapper.sh`, `infra/scripts/personal-staging-wrapper.test.mjs`, `.github/workflows/environment-contract-ci.yml`, `package.json`, `docs/runbooks/personal-server-deployment.md`, `docs/testing/test-matrix.md`, `docs/decision-log.md`.
- Follow-up review notes: PR merge 전에 개인 서버에서 검토된 wrapper를 root 전용 백업 후 원자적으로 설치하고 `root:root 0750`, `bash -n`, 저장소 원본과 checksum 일치, 잘못된 mode probe의 `Invalid deployment mode.` 응답을 확인한다. 서버 HEAD가 최신 `develop`과 일치하는지 확인한 뒤 새 `environment-only` run에서 Git pull, image build, migration이 실행되지 않는지 검증한다.

## ORBIT personal staging fresh-run recovery

- Context: GitHub Environment의 `DOPPLER_STG_SYNC_TOKEN`을 교체한 뒤 기존 `develop` workflow run을 재실행해도 called workflow의 `DOPPLER_TOKEN`이 빈 문자열로 해석되었다. 같은 run ID의 attempt만 반복하면 token 등록 시점 문제와 reusable workflow 경계 문제를 구분할 수 없다. sync job만 상위 workflow로 옮기면 Doppler webhook의 `environment-only` 배포가 sync와 full 배포 사이에 끼어들 수 있고, 기본 브랜치가 `main`인 저장소에서 `develop`에만 새 `workflow_dispatch`를 추가하면 GitHub가 수동 trigger를 제공하지 않는다.
- Options considered:
  - 기존 실패 run의 failed job을 계속 재실행한다.
  - Doppler sync job만 상위 Environment Contract CI로 옮긴다.
  - `develop`의 Environment Contract CI에 새 `workflow_dispatch`를 추가한다.
  - 기본 브랜치에도 이미 존재하는 `Deploy Personal Staging` 수동 entrypoint의 `develop + full + manual` 실행을 복구 경로로 사용한다.
- Final decision: 기존 `Deploy Personal Staging` workflow를 `develop`, `full`, `manual`로 수동 실행하면 `develop-push`와 같은 Doppler sync를 먼저 실행한다. 자동 push, 수동 full 복구, Doppler webhook 배포는 모두 `personal-staging-deploy` concurrency group을 유지한다. 새 top-level dispatch, Repository secret, `secrets: inherit`는 추가하지 않는다.
- Rationale: 기본 브랜치에 이미 등록된 수동 entrypoint로 완전히 새로운 run ID를 만들면서 sync와 서버 배포 사이의 순서를 보존한다. Environment secret 경계를 유지하고 token이 비어 있으면 self-hosted runner 배포 전에 중단한다.
- Affected files: `.github/workflows/deploy-personal-staging.yml`, `infra/scripts/personal-staging-env.test.mjs`, `docs/runbooks/personal-server-deployment.md`, `docs/testing/test-matrix.md`, `docs/decision-log.md`.
- Follow-up review notes: PR merge push로 생성된 새 run ID에서 token 존재 확인, Doppler sync, full 배포를 순서대로 확인한다. 계속 빈 문자열이면 reusable workflow 경계를 원인으로 확정하고 환경 계약, sync, full deploy 전체 체인을 하나의 workflow 및 같은 concurrency 경계로 이동한다. 성공하면 기존 run 재실행 또는 secret 등록 시점 문제로 분류하고 현재 구조를 유지한다. 이후 수동 `develop + full + manual` run도 같은 검증에 사용할 수 있다.

## ORBIT personal staging direct Environment secret boundary

- Context: token을 다시 교체한 뒤 생성한 새 `develop` push run `29559013580`에서도 called workflow의 `sync-personal-staging-env` job은 `personal-staging` Environment deployment로 실행됐지만 `DOPPLER_TOKEN`이 빈 문자열이었다. 따라서 기존 run 재실행이나 token 등록 시점 문제는 제외됐고, 실제 자동 배포에서 reusable workflow 경계를 통과할 때 Environment secret을 읽지 못하는 동작이 재현됐다. sync job만 상위 workflow로 옮기면 수동·webhook 배포가 sync와 full 배포 사이에 끼어들 수 있다.
- Options considered:
  - Repository secret 또는 `secrets: inherit`로 token을 called workflow에 전달한다.
  - sync job만 Environment Contract CI로 이동하고 full deploy 호출은 그대로 둔다.
  - 자동 환경 계약, Doppler sync, full deploy 전체를 Environment Contract CI의 direct jobs로 실행하고 workflow 전체를 공통 deploy concurrency로 묶는다.
- Final decision: `develop` push의 `environment-contract → sync-personal-staging-env → deploy-personal-staging` 체인을 `.github/workflows/environment-contract-ci.yml`의 direct jobs로 실행한다. 이 push run의 concurrency group은 `personal-staging-deploy`로 고정하고, PR run만 기존 ref별 environment-contract group과 취소 정책을 유지한다. `.github/workflows/deploy-personal-staging.yml`은 `workflow_dispatch` 전용으로 남겨 수동 full과 Doppler webhook `environment-only`를 처리하며 `workflow_call` entrypoint는 제거한다.
- Rationale: GitHub Environment secret을 실제 job이 선언된 workflow에서 직접 읽고, 자동 환경 계약부터 서버 full 배포까지 수동·webhook 배포와 겹치지 않게 한다. token scope를 넓히거나 secret을 Repository 수준으로 내리지 않으며, sync 실패 시 self-hosted runner를 시작하지 않는다.
- Affected files: `.github/workflows/environment-contract-ci.yml`, `.github/workflows/deploy-personal-staging.yml`, `infra/scripts/personal-staging-env.test.mjs`, `docs/runbooks/personal-server-deployment.md`, `docs/testing/test-matrix.md`, `docs/decision-log.md`.
- Follow-up review notes: merge push로 생성된 새 run에서 direct sync job의 token 존재 확인과 Doppler sync 성공을 확인하고, 이어지는 full 배포의 검증 SHA·서버 HEAD·health check를 확인한다. 별도 `environment-only` run에서는 Git pull, image build, migration 로그가 없고 앱 컨테이너 재생성 및 health check만 실행되는지 확인한다.

## ORBIT editor rehearsal UI and server practice integration

- Context: 최신 `develop` 에디터는 마이크 버튼으로 한 장 리허설 모드에 들어가 별도 live STT 세션을 시작하지만, 기존 슬라이드 연습 기능은 `MediaRecorder` 녹음과 서버 `slide-practice-analysis` Job을 통해 DB 리포트를 생성한다. 두 마이크 경로를 동시에 시작하면 브라우저별 장치 점유와 서로 다른 분석 결과가 다시 발생하며, 최신 QnA·리포트 탭은 아직 placeholder였다.
- Options considered:
  - 최신 live STT와 서버 저장형 연습 녹음을 동시에 시작한다.
  - 최신 리허설 UI를 제거하고 병합 전 별도 하단 도크를 복원한다.
  - 마이크 버튼은 리허설 모드 진입에만 사용하고, `연습 시작`부터 기존 서버 저장형 연습 세션 하나만 실행하며 QnA·리포트 탭에 기존 기능을 연결한다.
- Final decision: 마이크 버튼은 현재 슬라이드를 한 장 연습 모드로 전환하지만 오디오 캡처를 시작하지 않는다. 사용자가 `연습 시작`을 누르면 pending deck save를 먼저 flush한 뒤 기존 `useSlidePracticeSession`의 `MediaRecorder`·private upload·서버 분석 경로만 실행한다. 녹음 중 마이크 버튼으로 나가려 하면 같은 세션을 정상 종료하고, 분석 완료 후 하단 패널을 펼쳐 `리포트` 탭으로 자동 이동한다. QnA 탭은 기존 `SlideQuestionGuidePanel`, 리포트 탭은 DB에서 해당 슬라이드의 최신 1개를 읽는 `SlidePracticeHistoryPanel`을 사용한다. API, Job, 저장 기간, raw audio·transcript 보존 계약은 변경하지 않는다.
- Rationale: 최신 에디터 레이아웃을 유지하면서 이미 검증된 서버 분석과 DB 리포트를 단일 오디오 경로로 재사용한다. 별도 live STT를 함께 실행하지 않아 마이크 중복 점유와 브라우저 파생 지표의 재도입을 피하고, 생성 결과를 사용자가 찾는 QnA·리포트 탭에 일관되게 배치한다.
- Affected files: `apps/web/src/features/editor/shell/EditorShell.tsx`, `apps/web/src/features/editor/shell/components/EditorSlideRehearsal.tsx`, `apps/web/src/features/editor/shell/components/SpeakerNotesPanel.tsx`, `apps/web/src/features/editor/shell/components/SpeakerNotesQnaTab.tsx`, `apps/web/src/features/editor/shell/components/SpeakerNotesReportTab.tsx`, `apps/web/src/features/editor/practice/useSlidePracticeSession.ts`, 관련 테스트와 `apps/web/src/features/editor/editor-shell.css`.
- Follow-up review notes: 로컬 Chrome에서 마이크 진입 전 권한 요청이 발생하지 않는지, `연습 시작` 한 번에 하나의 MediaStream만 생성되는지, 종료 후 서버 분석 지연 동안 버튼이 중복 실행되지 않는지, 완료 뒤 현재 슬라이드의 최신 DB 기록이 리포트 탭에 표시되는지 확인한다. 운영 로그에는 raw audio, transcript, 발표 메모 원문을 추가하지 않는다.

## ORBIT editor rehearsal shared-stream script tracking

- Context: 서버 저장형 한 장 연습만 실행하면 DB 리포트는 생성되지만, 최신 리허설 UI의 대본 진행률·문장 자동 이동·프롬프터 자동 스크롤은 live transcript가 없어 항상 첫 문장에 머물렀다. 별도 `getUserMedia`를 다시 호출하면 하나의 연습에서 마이크 입력을 중복 획득하고 종료 시점이 달라질 수 있다.
- Options considered:
  - 서버 분석이 끝난 뒤 최종 transcript로만 대본 진행을 표시한다.
  - 서버 녹음과 live STT가 각각 별도 `MediaStream`을 획득한다.
  - 서버 녹음이 획득한 하나의 `MediaStream`을 live STT에도 전달하고, 종료 시 live STT를 먼저 마무리한 뒤 같은 stream의 `MediaRecorder`를 종료한다.
- Final decision: `연습 시작`은 `useSlidePracticeSession`이 획득한 단일 `MediaStream`으로 private server-report 녹음을 시작하고 같은 stream을 `useEditorSlideRehearsal`의 live STT 입력으로 공유한다. live STT transcript는 브라우저 메모리에서 대본 문장 진행·체크포인트에만 사용하고 API, Job, DB, 로그에 추가하지 않는다. 사용자가 종료하면 live STT의 마지막 final/interim을 먼저 확정한 뒤 녹음을 닫고 기존 서버 분석·DB 저장을 수행한다. 자동 따라가기를 끄면 이전·다음 버튼이 로컬 UI 상태만 변경하며, 서버 리포트 값에는 영향을 주지 않는다.
- Rationale: 한 번의 마이크 권한과 동일한 오디오 입력으로 실시간 프롬프터와 기존 서버 리포트를 함께 제공한다. 서버의 말 속도·쉼·pitch·음량·습관어 분석 및 저장 계약은 그대로 유지하고, live transcript의 보존 범위를 넓히지 않는다.
- Affected files: `apps/web/src/features/coaching/useFocusedPracticeAudio.ts`, `apps/web/src/features/editor/practice/useSlidePracticeSession.ts`, `apps/web/src/features/editor/shell/hooks/useEditorSlideRehearsal.ts`, `apps/web/src/features/editor/shell/EditorShell.tsx`, `apps/web/src/features/editor/shell/components/EditorSlideRehearsal.tsx`, 관련 테스트와 `apps/web/src/features/editor/editor-shell.css`, `docs/decision-log.md`.
- Follow-up review notes: 로컬 Chrome에서 `연습 시작` 한 번에 `getUserMedia`가 한 번만 호출되는지, 확정 문장마다 진행률과 중앙 스크롤이 이동하는지, 수동 이전·다음과 자동 복귀가 동작하는지, 종료 직전 발화가 누락되지 않는지, 완료 뒤 리포트 탭의 최신 DB 기록이 표시되는지 확인한다. live transcript, raw audio, 발표 메모 원문은 운영 로그에 남기지 않는다.

## ORBIT editor one-slide rehearsal prompter tracker reuse

- Context: 한 장 연습의 프롬프터가 누적 transcript 안에 대본 문장 전체가 포함되는지만 비교해, STT가 한 문장을 여러 partial/final 조각으로 나누면 문장 완료와 다음 문장 focus 이동을 놓쳤다. 반면 전체 리허설은 조각난 lexical evidence를 누적하고 final 경계에서만 문장을 확정하는 `createSpeechTracker`를 이미 사용한다.
- Options considered:
  - 한 장 연습의 문자열 포함 조건만 완화한다.
  - 한 장 연습 전용 누적 matcher를 새로 만든다.
  - 기존 `createSpeechTracker`와 `createRehearsalScriptPrompterRows`를 한 장 연습에서도 재사용한다.
- Final decision: 한 장 연습의 live STT 결과를 기존 `createSpeechTracker`에 그대로 전달하고, tracker snapshot의 `prompterProgress`를 공용 프롬프터 row 변환에 사용한다. partial은 lexical evidence만 누적하고 final에서 확정된 경우에만 다음 문장으로 focus를 옮긴다. 수동 이전·다음도 같은 tracker의 manual API를 사용한다. 마지막 문장 완료 시 슬라이드 자동 전환은 하지 않으며 현재 한 장 연습의 slide별 녹음·리포트 경계를 유지한다.
- Rationale: 전체 리허설에서 검증된 final deduplication, 조각 누적, 문장 commit 규칙을 재사용해 서로 다른 진행 판정 기준을 만들지 않는다. live transcript는 계속 브라우저 메모리의 프롬프터 제어에만 사용하고 API, Job, DB, 로그에는 추가하지 않는다.
- Affected files: `apps/web/src/features/editor/shell/hooks/useEditorSlideRehearsal.ts`, `apps/web/src/features/editor/shell/components/EditorSlideRehearsal.tsx`, `apps/web/src/features/editor/shell/EditorShell.tsx`, 관련 테스트, `docs/decision-log.md`.
- Follow-up review notes: 조각난 partial 뒤 final에서 정확히 한 문장만 진행하는지, 같은 final 재수신이 두 번 진행되지 않는지, focus 변경 시 중앙 스크롤이 실행되는지, 마지막 문장 완료 후 현재 슬라이드가 유지되는지 브라우저에서 확인한다.

## ORBIT editor one-slide rehearsal wheel sentence navigation

- Context: 한 장 리허설의 마우스 휠과 트랙패드는 대본 영역을 픽셀 단위로만 스크롤해, 음성 인식과 화살표가 사용하는 `SpeechTracker` 문장 위치와 화면 위치가 서로 달라질 수 있었다. 트랙패드는 한 동작에서도 여러 wheel event를 연속 발생시킨다.
- Options considered:
  - 브라우저 기본 픽셀 스크롤을 유지한다.
  - 휠마다 즉시 문장을 이동한다.
  - 한 휠 gesture의 delta를 누적해 임계값을 넘을 때 문장 하나만 이동하고, 기존 manual prompter API를 호출한다.
- Final decision: 한 장 리허설에서만 휠 아래를 다음 문장, 휠 위를 이전 문장으로 연결한다. pixel·line·page delta를 정규화하고 24px 임계값과 180ms gesture 종료 기준을 적용해 한 gesture가 여러 문장을 건너뛰지 않게 한다. 문장 이동은 화살표와 같은 `manualNextPrompter`·`manualPreviousPrompter` 경로를 사용하며 마지막 문장에서 슬라이드를 전환하지 않는다.
- Rationale: 입력 수단과 관계없이 하나의 tracker snapshot을 기준으로 진행률·focus·자동 중앙 스크롤을 동기화하고, 트랙패드 과다 입력으로 문장을 건너뛰는 것을 막는다. 공용 프롬프터에는 optional callback만 추가해 전체 리허설의 기존 wheel 동작은 바꾸지 않는다.
- Affected files: `apps/web/src/features/rehearsal/presenter/RehearsalScriptTeleprompter.tsx`, `apps/web/src/features/editor/shell/components/EditorSlideRehearsal.tsx`, 관련 테스트, `docs/decision-log.md`.
- Follow-up review notes: Windows 마우스 휠과 노트북 트랙패드에서 한 gesture당 한 문장만 이동하는지, 첫·마지막 문장 경계와 화살표·음성 자동 이동 복귀가 일관적인지 확인한다.

## ORBIT editor slide practice graph version diagnostics

- Context: 현재 소스는 `reportVersion: 2`에서 시간별 `loudnessSamples`와 `speedSamples`를 생성·저장·표시하지만, 5174 로컬 스택의 API·Worker·Python Worker는 이전 이미지였다. DB의 최근 기록은 모두 `reportVersion: 1`이고 두 sample이 없어서 Web은 그래프를 그릴 수 없었다. v1 원본 음성은 계약에 따라 이미 삭제돼 재분석할 수 없다.
- Options considered:
  - 그래프 재계산을 위해 raw audio 보관 기간을 늘린다.
  - v1 기록에 평균값을 복제해 가짜 시간별 그래프를 만든다.
  - 원본 삭제 계약을 유지하고 분석 서비스를 v2 이미지로 맞추며, v1과 v2 분석 실패의 empty state를 구분한다.
- Final decision: raw audio와 transcript 보존 범위를 넓히거나 v1 기록을 추정 backfill하지 않는다. `orbit-editor-report-qa`의 API·Worker·Python Worker를 현재 v2 코드로 재빌드하고 새 연습부터 실제 sample을 저장한다. UI는 v1 기록, v2 audio 분석 실패, v2 STT 실패, 발화량 부족을 서로 다른 문구로 표시한다.
- Rationale: 그래프는 원본이 아니라 분석 중 계산한 bounded 파생 sample만 필요하다. 개인정보 보존 정책을 바꾸지 않고도 신규 기록을 정확히 표시할 수 있으며, 과거 형식과 실제 분석 실패를 구분해 사용자가 재시도 방법을 알 수 있다.
- Affected files: `apps/web/src/features/editor/practice/PracticeReportContent.tsx`, 관련 테스트, `docs/decision-log.md`. 런타임에서는 `orbit-editor-report-qa`의 `api`, `worker`, `python-worker`, `web` 이미지를 현재 소스와 맞춘다.
- Follow-up review notes: 10초 이상 새 연습 후 DB에서 `reportVersion: 2`, `loudnessSamples > 0`, `speedSamples > 0`인지 확인한다. v2에서도 speed sample이 비면 Report STT segment timestamp 반환을, loudness sample이 비면 PCM decoder 경로를 별도로 진단한다.

## ORBIT editor slide practice same-origin upload proxy

- Context: 5174 side-port에서 한 장 연습 분석 생성은 성공했지만, API가 local MinIO upload proxy 주소를 고정 `WEB_ORIGIN`인 5173으로 반환해 브라우저의 녹음 `PUT`이 API에 도달하지 못했다. 일반 파일 업로드는 이미 요청 `Origin`을 정규화해 같은 브라우저 origin으로 upload proxy URL을 만들지만, slide practice 생성 경로는 이 값을 전달하지 않았다.
- Options considered:
  - 5174 테스트 스택의 `WEB_ORIGIN`만 수동 변경한다.
  - Web이 API가 반환한 upload URL의 host와 port를 현재 location으로 다시 쓴다.
  - API가 검증된 요청 `Origin`을 `FilesService.createUploadUrl`에 전달해 기존 same-origin upload proxy 규칙을 재사용한다.
- Final decision: `SlidePracticeController`는 요청 `Origin`을 `normalizeHttpOrigin`으로 제한한 뒤 `SlidePracticeService.createAnalysis`에 전달한다. 서비스는 이 값을 `FilesService.createUploadUrl`의 `requestOrigin`으로 넘기고, Web은 API가 발급한 private upload command를 그대로 사용한다. Origin이 없거나 http/https가 아니면 기존 `WEB_ORIGIN` fallback을 유지한다.
- Rationale: `localhost`와 `127.0.0.1`, 기본 포트와 side-port의 차이를 API 경계에서 한 번만 처리하고, 브라우저가 인증 cookie를 같은 origin의 private upload endpoint에 보낼 수 있게 한다. Web에서 signed 또는 proxy URL을 임의 재작성하지 않아 운영 S3 경로와 local MinIO 경로의 분리를 보존한다.
- Affected files: `apps/api/src/slide-practice/slide-practice.controller.ts`, `apps/api/src/slide-practice/slide-practice.service.ts`, `apps/api/src/slide-practice/slide-practice.controller.spec.ts`, `apps/web/src/features/editor/practice/slidePracticeApi.ts`, `apps/web/src/features/editor/practice/slidePracticeApi.test.ts`, `apps/web/src/features/editor/shell/components/EditorSlideRehearsal.tsx`, 관련 UI 테스트, `docs/decision-log.md`.
- Follow-up review notes: 5174의 `127.0.0.1`과 `localhost`에서 각각 분석 생성 뒤 `PUT /api/v1/projects/:projectId/assets/:fileId/content`가 같은 origin으로 204를 반환하는지 확인한다. 연결 자체가 실패하면 Web에 단계별 한국어 오류가 표시되는지 확인하고 raw audio, upload URL, cookie는 로그에 추가하지 않는다.

## ORBIT editor slide practice single script-linked coaching

- Context: 한 장 연습 리포트의 코칭은 대본과 전체 파생 지표를 함께 입력했지만 최대 2개 개선 item과 별도 30초 계획을 A·B·C 카드처럼 표시했다. 시간별 STT segment와 실제 대본 문장이 연결되지 않아 특정 대본 구간에 속도, 음량, 쉼 근거를 적용할 수 없었고, 여러 조언 중 무엇을 먼저 실행해야 하는지도 불분명했다.
- Options considered:
  - 전체 평균 지표만 LLM에 보내 대본 문장을 임의로 선택하게 한다.
  - timestamp transcript 원문을 LLM과 report에 함께 저장한다.
  - transcript segment는 Worker 메모리에서만 실제 대본 문장과 정렬하고, 원문을 제거한 bounded 파생 근거 후보 중 LLM이 하나만 선택하게 한다.
- Final decision: Python worker는 timestamp transcript segment 최대 100개와 인접 segment 사이 250ms 이상 pause 구간을 Worker 메모리에만 반환한다. Worker는 실제 `speakerNotes` 문장과 순서 기반 lexical 정렬을 수행하고 속도, 음량, 쉼, pitch 폭, 습관어, 음량 변화폭, 리듬 규칙성을 포함한 후보를 최대 8개 만든다. OpenAI는 후보 ID 하나와 단일 개선 item만 반환한다. Worker는 ID, issue category, 실제 대본 포함 여부를 재검사하고 `promptVersion: 2`, item 1개, `practicePlan: null`로 저장한다. UI는 한 카드 안에 실제 대본, 7개 근거, 대본 적용 방법, 다른 연습 방법을 표시한다.
- Rationale: transcript와 raw audio 보존 범위를 넓히지 않으면서 측정 근거를 실제 대본에 연결하고, 사용자에게 가장 중요한 행동 하나만 제시한다. 정렬이 부족한 fallback은 `practice-target`으로 구분해 실제 오류 구간으로 단정하지 않는다.
- Affected files: `docs/contracts.md`, `packages/shared/src/slide-practice`, `services/python-worker/app/audio/slide_practice.py`, `services/python-worker/app/slide_practice_coaching.py`, `apps/worker/src/slide-practice-analysis.processor.ts`, `apps/web/src/features/editor/practice/PracticeReportContent.tsx`, 관련 테스트와 `docs/decision-log.md`.
- Follow-up review notes: 실제 10초 이상 연습에서 transcript 원문이 코칭 요청, report JSON, Job 결과, 로그에 없는지 확인한다. 선택된 대본이 frozen deck version의 `speakerNotes`에 포함되는지, 신규 report가 item 하나만 가지는지, matched와 practice-target 문구가 구분되는지 확인한다.

## ORBIT editor one-slide rehearsal automatic wheel skip fallback

- Context: 한 장 연습 시 문장을 실제로 말했지만 live STT가 완료 경계를 놓치면 자동 프롬프터가 현재 문장에 머물 수 있다. 기존 휠 아래 동작은 `manualNextPrompter`로 현재 문장을 완료 처리하고 UI를 수동 모드로 전환해, 시연자가 자동 인식을 계속 사용하려는 의도와 달랐다.
- Options considered:
  - 휠을 화면 미리보기로만 처리하고 잠시 후 기존 문장으로 복귀한다.
  - 기존 manual commit을 유지한 채 자동 모드 표시만 유지한다.
  - 현재 문장을 완료하지 않고 `skippedSentenceIds`에 기록한 뒤 다음 문장을 새 자동 인식 대상으로 설정한다.
- Final decision: 자동 따라가기 상태에서 휠 아래는 `skipCurrentPrompter`를 사용한다. 현재 문장은 committed/covered 처리하지 않고 skipped로만 기록하며, revision과 lexical evidence를 초기화한 뒤 다음 문장부터 자동 STT를 계속한다. 휠 위는 이전 문장으로 돌아가되 자동 모드를 유지한다. 명시적으로 수동 모드를 선택한 경우 기존 manual API를 유지하고, 마지막 문장에서는 skip을 거부해 잘못된 100% 진행이나 슬라이드 전환 신호를 만들지 않는다.
- Rationale: 시연자가 STT 누락을 즉시 복구하면서도 읽지 않은 문장을 완료했다고 기록하지 않고, 화면 포커스와 다음 음성 판정을 같은 문장에 맞춘다.
- Affected files: `apps/web/src/features/rehearsal/speech/prompterProgressTracker.ts`, `apps/web/src/features/rehearsal/speech/speechTracker.ts`, `apps/web/src/features/editor/shell/hooks/useEditorSlideRehearsal.ts`, `apps/web/src/features/editor/shell/components/EditorSlideRehearsal.tsx`, `apps/web/src/features/editor/shell/EditorShell.tsx`, 관련 테스트와 `docs/decision-log.md`.
- Follow-up review notes: 자동 모드에서 첫 문장을 skip한 뒤 진행률이 오르지 않는지, 다음 문장 final STT만 commit되는지, 마지막 문장 skip이 거부되는지, 수동 모드의 화살표 동작과 전체 리허설 wheel 동작이 유지되는지 확인한다.

## ORBIT editor slide question guide runtime flag guard

- Context: `SLIDE_QUESTION_GUIDES_ENABLED=false`인 배포 환경에서도 Editor QnA 탭은 `질문 생성` 버튼을 노출했다. 사용자가 버튼을 누르면 API가 의도대로 403 `Slide question guides are not enabled.`를 반환하지만, UI는 사용할 수 없는 기능을 실행 가능한 것처럼 보이게 했다.
- Options considered:
  - API의 feature flag 검사를 제거하고 항상 Job을 생성한다.
  - UI는 그대로 두고 API 오류 문구만 바꾼다.
  - UI가 공개 runtime config의 `slideQuestionGuidesEnabled`를 먼저 확인하고 비활성 상태에서는 조회·생성 요청을 보내지 않는다.
- Final decision: `SlideQuestionGuidePanel`은 mount 시 `/api/v1/runtime-config`를 확인한다. 확인 전과 비활성 상태에서는 생성 버튼을 disabled로 유지하고, 비활성 상태에서는 guide 목록 조회와 생성 API 호출도 하지 않는다. API의 feature flag 검사는 계속 최종 권한 경계로 유지한다.
- Rationale: 배포별 기능 활성화 결정은 API runtime config가 소유하고, Web은 이를 따라 사용 불가능한 작업을 시작하지 않는다. 네트워크 지연이나 설정 조회 실패 중에도 생성 요청을 낙관적으로 보내지 않아 사용자에게 403을 노출하지 않는다.
- Affected files: `apps/web/src/features/editor/practice/SlideQuestionGuidePanel.tsx`, `apps/web/src/features/editor/practice/SlideQuestionGuidePanel.test.tsx`, `docs/decision-log.md`.
- Follow-up review notes: enabled 환경에서는 runtime config 확인 뒤 버튼이 활성화되고 기존 guide 목록·생성 polling이 동작하는지, disabled 환경에서는 QnA 탭을 열어도 slide question guide API 요청이 발생하지 않는지 확인한다.

## ORBIT editor slide question guide automatic batch snapshot

- Context: 예상 질문은 사용자가 QnA 탭을 열고 slide별 생성 버튼을 눌러야만 예약됐고, Worker가 처리 시점의 live Deck을 재구성해 enqueue 뒤 편집으로 정상 작업이 stale 실패할 수 있었다. UI도 전체 `deckVersion`으로 freshness를 판단해 다른 slide 편집만으로 현재 slide 질문을 숨겼다.
- Options considered:
  - Web이 기존 단일 생성 API를 slide 수만큼 직접 호출하고 Worker가 계속 live Deck을 읽는다.
  - 전체 Deck을 새 Job payload에 넣거나 전용 batch Queue와 전역 진행 UI를 추가한다.
  - API가 Deck을 한 번 검증해 기존 Job을 slide별 예약하고, 기존 `deck_snapshots`를 frozen source로 참조하며 UI는 target slide hash만 비교한다.
- Final decision: write 권한과 `SLIDE_QUESTION_GUIDES_ENABLED`가 유효한 editor mount는 persisted Deck 최초 로드 후 `POST /slide-question-guides/auto`를 한 번 호출한다. API는 current target hash와 `slide-question-guide-v2`의 active/succeeded guide를 재사용하고, deterministic batch·slide request ID로 나머지만 기존 Queue에 예약한다. 신규 guide의 `source_snapshot_json.deckSnapshotId`는 같은 version의 재사용 가능한 `deck_snapshots` row를 가리키며 Worker는 ID·project·deck·version·target hash를 검증한 frozen Deck을 사용한다. `deckSnapshotId`가 없는 guide는 checkpoint와 patch tail 재구성 경로를 유지한다. UI는 target slide canonical hash로 current guide를 선택하고 자동 생성 실패를 반복 재시도하지 않는다.
- Rationale: 새 Queue·테이블·payload 원문 없이 기존 순차 Worker와 privacy 경계를 유지하면서 editor 진입 시 전체 slide를 준비한다. frozen snapshot은 live 편집과 생성 source를 분리하고, target hash freshness는 관련 없는 slide 수정으로 질문이 사라지는 문제를 막는다.
- Affected files: `packages/shared/src/common/canonical-json.ts`, `packages/shared/src/slide-practice/slide-question-guide.schema.ts`, `apps/api/src/decks/decks.service.ts`, `apps/api/src/slide-question-guides/**`, `apps/worker/src/slide-question-guide-generation.processor.ts`, `apps/web/src/features/editor/practice/**`, `apps/web/src/features/editor/shell/**`, `docs/contracts.md`.

## ORBIT slide question text freshness and bounded parallelism

- Context: 전체 slide JSON hash는 도형 색상·위치 같은 질문 근거와 무관한 시각 변경에도 기존 질문을 stale 처리했고, QnA Worker 기본 동시성 1은 여러 slide를 모두 준비하는 시간을 선형으로 늘렸다.
- Final decision: API·Worker·Web은 shared `slideQuestionGuideTextHashInput`으로 title·text·alt·speaker notes만 canonical hash 입력에 포함한다. 신규 source snapshot은 `contentHashVersion: slide-text-v1`을 기록하고, version이 없는 기존 guide는 Worker에서 전체 slide hash 검증을 유지한다. 기존 `slide-question-guide-generation` Queue의 BullMQ Worker에만 `concurrency: 2`를 적용한다.
- Rationale: 실제 질문 생성 입력이 달라질 때만 stale 처리하면서 새 Queue·dependency·전역 설정 없이 전체 준비 시간을 줄인다. 동시성 2는 provider 부하를 제한하면서 뒤쪽 Job의 120초 Web polling 초과 가능성도 낮춘다.
- Affected files: `packages/shared/src/slide-practice/slide-question-guide.schema.ts`, `apps/api/src/slide-question-guides/**`, `apps/worker/src/slide-question-guide-generation.processor.ts`, `apps/worker/src/worker.service.ts`, `apps/web/src/features/editor/practice/**`, `docs/contracts.md`.

## ORBIT project rehearsal keyword coverage summary

- Context: 프로젝트 리허설 요약은 Semantic Cue의 `coreMessageCoverage`를 “핵심 메시지 전달률”로 표시했지만, 실제 프로젝트의 Deck과 과거 성공 회차에는 Semantic Cue가 없고 keyword snapshot과 `missedKeywords`만 있어 3회차 이후에도 지표가 `N/A`였다. Keyword 언급 여부와 의미 설명 정확성은 서로 다른 측정이다.
- Options considered:
  - 기존 `coreMessageCoverage`에 keyword 결과를 넣어 필드 의미를 바꾼다.
  - Semantic Cue 생성과 과거 STT 재분석을 선행한다.
  - 새 `keywordCoverage` 계약을 추가하고 저장된 snapshot·report에서 파생 집계하며 기존 Semantic Cue 필드는 호환용으로 유지한다.
- Final decision: `keywordCoverage`는 각 성공 회차의 immutable `evaluationSnapshot.slides[].keywords`에서 `(slideId, keywordId)` 분모를 만들고 `report.missedKeywords`에 없는 항목을 전달로 계산한다. STT 또는 keyword 측정이 불가능하거나 키워드가 없으면 `0%` 대신 `unmeasured`를 반환한다. 회차 비교는 분모 변화에 안전하도록 전달률의 percentage point 차이를 사용하고, 슬라이드 상태는 누적 전달률과 직전 두 측정 가능 회차의 동일 keyword 반복 누락을 함께 사용한다. 기존 `coreMessageCoverage`는 deprecated 호환 필드로 유지한다.
- Rationale: DB migration, transcript 복원, STT 재분석 없이 당시 Deck 기준의 저장 증거로 과거 회차를 즉시 계산할 수 있다. Keyword 언급과 Semantic Cue 의미 평가의 계약을 분리해 소비자가 두 지표를 혼동하지 않으며 API와 Web을 단계적으로 배포할 수 있다.
- Affected files: `packages/shared/src/rehearsals/rehearsal.schema.ts`, `apps/api/src/rehearsals/rehearsal-project-summary.ts`, `apps/web/src/features/rehearsal/rehearsalProjectSummaryModel.ts`, `apps/web/src/features/rehearsal/RehearsalProjectSummaryDashboard.tsx`, 관련 테스트, `docs/contracts.md`, `docs/decision-log.md`.
- Follow-up review notes: 실제 프로젝트의 1·2·3회차가 각각 `0/39`, `1/42`, `3/42`로 집계되는지 확인한다. STT 품질 gate 실패와 keyword 없는 Deck에서 `N/A`가 유지되는지, 사용자 데이터가 쌓인 뒤 70%·90% 상태 임계값을 재검토한다.

## ORBIT production editor QnA and slide practice rollout

- Context: `main` production의 실제 env와 저장소 template에서 `SLIDE_PRACTICE_ENABLED`, `SLIDE_QUESTION_GUIDES_ENABLED`가 누락되거나 `false`여서 QnA가 정상적으로 사전 차단됐고, 부분 슬라이드 연습은 녹음 종료 뒤 API 403을 사용자에게 노출했다. 두 flag의 코드 기본값은 `false`이며 현재 project allowlist 계약은 없다.
- Options considered:
  - API의 feature flag 검사를 제거하고 production에서 항상 두 기능을 실행한다.
  - 실제 EC2 env만 수동 수정하고 저장소 template와 deploy 검증은 그대로 둔다.
  - 코드 기본값과 API 방어선을 유지하면서 production template와 실제 env에 두 flag를 명시하고, Web이 runtime config를 녹음 전에 확인하도록 한다.
- Final decision: AWS `main` production의 모든 project에서 두 flag를 `true`로 명시한다. `.env.production.example`, EC2 env example, CloudFormation bootstrap example을 동기화하고 deploy wrapper에서 두 key를 필수로 검사한다. 부분 슬라이드 연습 Web은 `checking`, `enabled`, `disabled`, `unavailable`을 구분하며 `enabled` 전에는 저장 준비, device ID 확인, microphone 시작을 모두 막고 조회 실패에 `설정 다시 확인`을 제공한다. API 403 검사는 최종 방어선으로 유지한다.
- Rationale: 기능 공개 정책과 실제 배포 계약을 일치시키고, 누락된 env가 조용히 기능을 끄는 상태를 방지한다. runtime config 조회 실패와 명시적 비활성을 분리하면 사용자가 연결 문제를 기능 종료로 오해하지 않으며, rollback 후에도 헛녹음과 raw 403 노출을 막을 수 있다.
- Affected files: `.env.production.example`, `.env.staging.example`, `infra/aws/ec2-production.env.example`, `infra/aws/main-production-bootstrap.yaml`, `infra/scripts/deploy-aws-ec2.sh`, `infra/scripts/check-aws-production-compose.mjs`, `apps/web/src/features/editor/practice/**`, `apps/web/src/features/editor/shell/**`, `docs/conventions/environment.md`, `docs/runbooks/aws-main-auto-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: PR CI 이후 SSM으로 실제 `/etc/orbit/production.env`의 두 flag만 안전하게 갱신하고, `main` 자동 배포 뒤 runtime config, QnA Job, 10초 이상 연습 report, raw audio 삭제 event를 확인한다. 장애 시 두 flag를 `false`로 되돌리고 재배포한다.

## ORBIT slide practice and QnA content-hash freshness

- Context: 부분 슬라이드 연습 시작 직전 저장과 QnA 자동 생성 사이에 Deck version이 바뀌면, 대상 슬라이드의 실제 질문·연습 입력이 그대로여도 API가 전체 `deckVersion` 불일치로 요청을 거부했다. 저장 controller도 acknowledged Deck을 ref에는 반영하면서 React state와 version이 잠시 달라질 수 있었다.
- Options considered:
  - 모든 Deck 변경을 계속 충돌로 취급하고 사용자에게 새로고침을 요구한다.
  - 연습 시작 version의 전체 Deck을 별도 예약 API로 영구 고정한다.
  - 저장 완료 Deck을 Web의 단일 source로 동기화하고, API freshness는 title·text·alt·speaker notes canonical hash를 우선한다.
- Final decision: 신규 Web은 저장 queue를 flush한 acknowledged Deck으로 연습 session snapshot과 QnA hash를 만든다. 부분 연습과 수동 QnA는 target slide hash, 자동 QnA는 slide ID·order·text hash로 만든 Deck text hash가 같으면 version 차이를 허용하고 현재 server Deck snapshot/version으로 처리한다. 실제 text hash 충돌만 409로 거부하며 자동 QnA는 최신 Deck으로 한 번만 재시도한다. hash가 없는 과거 client는 strict version 검증을 유지한다.
- Rationale: 시각 변경과 다른 슬라이드 편집으로 녹음·질문 생성을 잃지 않으면서, 실제 발표 텍스트나 대본이 바뀐 경우에는 오래된 입력으로 분석하지 않는다. DB migration이나 raw slide 원문 로그 없이 기존 frozen snapshot과 provenance 계약을 유지한다.
- Affected files: `packages/shared/src/slide-practice`, `apps/api/src/slide-practice`, `apps/api/src/slide-question-guides`, `apps/web/src/features/editor/practice`, `apps/web/src/features/editor/shell`, `docs/contracts.md`, 관련 테스트.
- Follow-up review notes: 다른 slide/visual-only edit 뒤 연습 종료와 QnA 생성이 성공하는지, target speaker notes 변경은 upload·Job 생성 전에 한국어 안내로 중단되는지, 로그에 원문 없이 requested/resolved version과 freshness resolution만 남는지 확인한다.

## ORBIT personal staging app image preflight before container replacement

- Context: Doppler webhook의 `environment-only` 배포에서 `IMAGE_TAG`와 `WEB_IMAGE_TAG`가 설정되지 않아 Compose가 `orbit-web:latest`를 선택했다. 해당 이미지가 없었지만 `docker compose up --force-recreate`가 API 재생성을 먼저 시작한 뒤 Web image 오류로 중단되어 nginx `/api/*`가 지속적으로 502를 반환했다.
- Options considered:
  - `orbit-web:latest`를 항상 publish해 기존 환경 재배포를 유지한다.
  - Web만 `environment-only` 재생성 대상에서 제외한다.
  - 모든 배포 모드가 동일한 backend branch tag와 Web commit SHA tag를 먼저 확정하고, 앱 이미지 네 개가 로컬에 모두 존재할 때만 pull 없는 컨테이너 교체를 시작한다.
- Final decision: `deploy-personal-server.sh`는 mode 분기 전에 `IMAGE_TAG=develop`과 `WEB_IMAGE_TAG=<server HEAD>`를 확정한다. `environment-only`는 Compose가 해석한 API, Worker, Python worker, Web image reference 네 개를 `docker image inspect`로 모두 확인하고 schema preflight까지 성공한 뒤에만 `--no-build --pull never --force-recreate`를 실행한다. `full`도 pull 또는 build 뒤 같은 image preflight를 통과하고 최종 `up`에서 추가 pull을 금지한다.
- Rationale: mutable `latest`에 의존하지 않고 검증된 코드 SHA와 Web bundle을 일치시킨다. 누락 이미지가 있으면 실행 중인 앱 컨테이너를 건드리기 전에 실패하므로 환경변수 재배포 한 번이 전체 API 장애로 확대되지 않는다.
- Affected files: `infra/scripts/deploy-personal-server.sh`, `infra/scripts/personal-staging-deploy.test.mjs`, `package.json`, `docs/runbooks/personal-server-deployment.md`, `docs/decision-log.md`.
- Follow-up review notes: 누락 Web image fixture에서 `docker compose up`이 호출되지 않는지, 정상 fixture에서는 네 image inspect 뒤 `--pull never --force-recreate`가 실행되는지 확인한다. 병합 후 새 `environment-only` run과 full run 모두 API/root health check를 통과하는지 검증한다.

## ORBIT single-workload-AZ ECS migration foundation

- Context: 기존 production은 하나의 EC2 Compose 경로가 API, Worker, Python Worker와 local Redis를 함께 소유한다. 무중단에 가까운 ECS 전환을 위해서는 기존 CloudFront·EC2·RDS를 즉시 교체하지 않고, Job admission과 Socket.IO presence, 민감 오디오 저장소, digest 기반 배포 및 rollback 경계를 먼저 마련해야 한다.
- Options considered:
  - 기존 bootstrap stack에서 EC2를 ECS로 한 번에 교체하고 local Redis 및 assets bucket도 동시에 전환한다.
  - 별도 ECS 환경을 만든 뒤 DNS를 즉시 ECS 100%로 전환한다.
  - 기존 리소스를 유지한 채 shared-services, ECS compute, edge WAF를 additive stack으로 만들고 ALB 가중치와 admission drain을 사용해 단계적으로 전환한다.
- Final decision: production entry CloudFront와 기존 EC2/RDS는 기존 bootstrap stack이 계속 소유한다. 새 stack은 public ALB용 2개 subnet과 단일 workload AZ의 NAT·ECS·Redis를 만들며, 초기 ALB 가중치는 EC2 100/ECS 0으로 고정한다. 신규 비동기 Job은 `ASYNC_JOB_ADMISSION_MODE`로 drain하고, Socket.IO presence는 adapter-wide `fetchSockets()`를 사용한다. private audio는 운영의 기존 storage stack이 소유한 bucket과 IAM policy를 재사용하고 신규 원음은 `raw/`, evidence 파생물은 `evidence/`에 저장한다. prefix 없는 legacy key는 assets bucket에서 계속 읽는다. 기존 SSE-S3를 SSE-KMS로 강화하는 변경은 storage-owning stack의 별도 검토 PR로 분리한다. 이미지와 task definition은 ECR digest로 고정하고, 모든 인프라 변경은 비실행 Change Set 검토와 production environment 승인 후에만 적용한다.
- Rationale: 기존 서비스와 데이터 경로를 rollback 대상으로 보존하면서 API traffic, Worker ownership, Redis, private storage를 서로 다른 단계로 검증할 수 있다. 운영 bucket의 14일 raw/7일 evidence lifecycle 계약을 그대로 사용해 보존 기간 누락을 막고, 소유권이 다른 stack에서 같은 bucket을 중복 생성하거나 암묵적으로 import하는 위험을 피한다. CloudFormation replacement/delete 방지 검사와 수동 승인 경계가 기존 stateful resource의 우발적 손실을 차단한다.
- Affected files: `apps/api/src/jobs/async-job-admission.ts`, Deck·slide question guide·realtime·file service와 관련 tests, `apps/worker/src/storage.ts`, `packages/config`, `packages/shared`, `packages/storage`, `infra/aws/*single-az.yaml`, `infra/aws/edge-waf-count-mode.yaml`, AWS infrastructure workflows, environment examples/contracts, `docs/runbooks/ecs-single-az-cutover.md`, `docs/decision-log.md`.
- Follow-up review notes: AWS account root session에서는 Change Set을 생성하거나 실행하지 않는다. GitHub OIDC plan/apply 역할을 최소 권한으로 분리한 뒤, 실제 적용 전 Change Set에서 기존 `AWS::RDS::DBInstance`, `AWS::S3::Bucket`, `AWS::CloudFront::Distribution`, `AWS::EC2::Instance`의 delete/replace가 없는지 확인한다. storage-owning stack을 저장소의 canonical template로 복구하고 SSE-KMS 전환 영향과 rollback을 별도로 검토한다. candidate smoke test, queue/DB active count 0, raw/evidence 및 legacy audio read, Socket.IO multi-task presence를 확인한 뒤 ECS traffic을 5→25→50→100%로 올린다.

## ORBIT ECS cutover review hardening

- Context: ECS 전환 기반 리뷰에서 CloudFormation의 `Modify` replacement 판정, CloudFront viewer `Host`, 기존 EC2/RDS 보안 그룹, ECS production feature flag, Service Connect namespace가 실제 배포 시 canary와 rollback 경로를 차단할 수 있음이 확인됐다.
- Options considered:
  - 기존 bootstrap stack에 ECS/ALB 리소스를 직접 편입하고 보안 그룹 전체 소유권을 옮긴다.
  - CloudFront viewer `Host`를 ALB에서 public domain wildcard로 허용한다.
  - 기존 stack 소유권을 유지하고 compute stack이 필요한 cross-stack ingress rule만 추가하며, application origin 사용 시 CloudFront가 origin host를 재생성하게 한다.
- Final decision: compute stack은 기존 EC2/RDS security group ID를 명시적으로 받아 ALB→EC2 80과 ECS client→RDS 5432 ingress rule만 소유한다. bootstrap stack은 `ApplicationOriginDomainName`이 설정된 경우에만 API/auth/Socket.IO behavior를 `AllViewerExceptHostHeader`로 전환한다. ECS API와 Worker에는 production의 slide practice/QnA flag를 명시하고 Service Connect에는 namespace ARN을 전달한다. protected resource의 `Modify`는 `Replacement: False`가 명시된 경우에만 허용한다. CI의 Guard validator는 unauthenticated GitHub raw installer 대신 AWS가 지원하는 Cargo 경로로 고정 버전 `3.1.2`를 설치한다.
- Rationale: 기존 stateful resource의 stack 소유권과 direct-EC2 rollback을 유지하면서도 ECS candidate의 DB, legacy target, service discovery, runtime capability를 배포 전에 결정적으로 검증할 수 있다. origin verification header와 CloudFront prefix-list 제한은 그대로 유지한다.
- Affected files: `infra/scripts/assert-cfn-change-set-safe.mjs`, 관련 test/workflow, `infra/aws/ecs-compute-single-az.yaml`, `infra/aws/main-production-bootstrap.yaml`, `docs/runbooks/ecs-single-az-cutover.md`, `docs/decision-log.md`.
- Follow-up review notes: 실제 Change Set에서 두 ingress rule이 add-only인지, CloudFront distribution `Modify`가 `Replacement: False`인지, ALB access log의 host가 origin domain인지, ECS runtime config의 두 flag가 `true`인지, Service Connect endpoint가 `python-worker:8000`으로 해석되는지 확인한다.

## ORBIT CloudFormation execution role boundary

- Context: ECS 전환용 Plan/Apply workflow가 서로 다른 GitHub OIDC role을 사용하지만 `create-change-set`에 CloudFormation service role을 지정하지 않았다. 이 상태에서는 CloudFormation이 호출자의 임시 자격 증명을 사용하므로 Apply role이 ECS, EC2, ElastiCache, IAM 등 실제 리소스 생성 권한까지 직접 가져야 한다.
- Options considered:
  - Apply OIDC role에 모든 리소스 provisioning 권한을 직접 부여한다.
  - Plan/Apply role을 하나로 합치고 `AdministratorAccess`를 부여한다.
  - GitHub OIDC 역할은 Change Set 제어와 특정 역할에 대한 `iam:PassRole`만 담당하고, 실제 provisioning은 별도 CloudFormation execution role로 분리한다.
- Final decision: repository variable `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN`을 필수 계약으로 추가하고 Plan workflow의 `create-change-set --role-arn`으로 고정한다. `DescribeChangeSet` 응답에는 execution role ARN이 없으므로 artifact parser에서 존재하지 않는 값을 검사하지 않는다. 대신 Plan role의 `iam:PassRole`을 execution role ARN 하나와 `iam:PassedToService=cloudformation.amazonaws.com`으로 제한하고, Apply role에는 Change Set 생성 권한과 `iam:PassRole`을 부여하지 않는다. `AWS_INFRA_PLAN_ROLE_ARN`, `AWS_INFRA_APPLY_ROLE_ARN`, `AWS_ECR_PUBLISH_ROLE_ARN`은 repository variable로 관리하되 역할은 서로 재사용하지 않는다. Pull request 정적 검증 job에는 OIDC token 권한을 주지 않고, Plan job은 `refs/heads/main` dispatch로 분리한다. Plan role trust는 `aud=sts.amazonaws.com`과 exact main-ref subject만 허용한다. Apply job은 `production` environment 승인을 유지하고 Apply role trust는 해당 environment의 OIDC subject만 허용한다. Apply의 Change Set ARN과 region은 job environment로 전달하고 형식을 검증한 뒤 shell에서만 참조한다.
- Rationale: GitHub workflow 자격 증명이 직접 가질 수 있는 blast radius를 줄이고, Apply workflow가 임의의 service role을 새로 연결할 권한을 갖지 못하게 한다. production 승인자는 성공한 Plan workflow가 만든 Change Set ARN과 artifact를 함께 검토한다. CloudFormation service role은 stack에 연결된 이후 해당 stack의 후속 작업에도 사용되므로, 실행 역할 자체도 템플릿에 필요한 최소권한과 별도 변경 검토를 유지한다.
- Affected files: `.github/workflows/aws-infrastructure-plan.yml`, `.github/workflows/aws-infrastructure-apply.yml`, `infra/scripts/assert-cfn-change-set-safe.mjs`, 관련 테스트, `docs/runbooks/ecs-single-az-cutover.md`, `docs/decision-log.md`.
- Follow-up review notes: AWS에서 역할 네 개의 trust/permissions를 각각 검토하고 GitHub 변수를 등록한 뒤에만 실제 Change Set을 생성한다. 특히 Plan trust의 wildcard subject 부재와 main-ref exact match를 확인한다. `production` required reviewer를 지정하고 self-review 방지 정책을 확인한다. 기존 stack에 이미 service role이 연결되어 있다면 역할을 바꾸기 전 권한과 rollback 영향을 별도 검토한다.
