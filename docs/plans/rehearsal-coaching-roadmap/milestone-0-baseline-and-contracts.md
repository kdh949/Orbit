# Milestone 0 — 기준선과 계약 정합화

> 선행 조건: 없음  
> 종료 후 해제되는 작업: Milestone 1 전체, Milestone 2 retention contract  
> 목표: 배포 화면과 `develop`의 차이를 재현 가능한 fixture로 고정하고 상충하는 보존·리포트 문서를 실제 코드 계약과 일치시킨다.

## 1. 범위

이 마일스톤은 사용자 기능을 새로 노출하지 않는다. 이후 구현이 잘못된 기준을 따라가지 않도록 현재 active report surface, adaptive coaching capability, transcript/audio lifecycle을 자동 테스트와 계약 문서로 고정한다.

완료 결과는 다음과 같다.

- 두 회차 이상인 demo project에서 report, practice plan, focused practice, Q&A 상태를 한 번에 재현할 수 있다.
- `report_json`, transcript artifact, audio retention의 canonical 정책이 문서 한 곳에서 충돌 없이 설명된다.
- Milestone 1이 UI-only 변경으로 가능한 범위와 Milestone 2가 계약 변경을 요구하는 범위가 분리된다.

## 2. 확정 기준선

| 영역                 | 기준선                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| active report        | `RehearsalReportTestView`와 `RehearsalReportTestOverview`                 |
| legacy hidden report | `rrd-panel-overview`, `rrd-panel-slides`                                  |
| report SSoT          | `rehearsal_runs.report_json`                                              |
| practice plan        | `GET /api/v1/projects/:projectId/practice-plan?sourceFullRunId=:runId`    |
| capability           | `GET /api/v1/projects/:projectId/coaching-capabilities`                   |
| transcript artifact  | `rehearsal-transcript-json`, `rehearsal-transcript-text` owner-only asset |
| audio playback       | `GET /api/v1/rehearsals/:runId/audio/playback-url`                        |
| 현재 audio retention | 14일, Milestone 2에서 30일로 전환                                         |

## 3. 작업 목록

### M0.1 — Adaptive coaching 기준 fixture 고정

**설명:** 두 번의 성공 full rehearsal, ready Top 3 goal set, focused practice 가능 goal, 완료 Q&A를 가진 합성 demo fixture를 재현 가능하게 고정한다. 실제 사용자 transcript나 음성은 fixture에 사용하지 않는다.

**수용 기준:**

- [ ] reset 후 같은 ID와 같은 상태의 두 report를 반복 생성할 수 있다.
- [ ] practice plan의 `ready`, `processing`, `no-goal`, `stale` 상태를 각각 fixture로 선택할 수 있다.
- [ ] Q&A capability on/off와 transcript/audio available/expired 상태를 합성 metadata로 재현할 수 있다.

**검증:**

- [ ] `pnpm --filter @orbit/api demo:coaching:reset`
- [ ] `pnpm test:coaching:integration`
- [ ] fixture JSON과 Job result에 transcript, answer, signed URL, storage key가 없는지 검사한다.

**의존성:** 없음

**예상 파일:**

- `apps/api/src/scripts/reset-coaching-demo.ts`
- `apps/api/src/scripts/reset-coaching-demo.spec.ts`
- `tests/e2e/adaptive-coaching-fixtures.spec.ts`
- `packages/shared/src/common/demo-ids.ts`
- `docs/demo-standards.md`

**예상 규모:** M

### M0.2 — 활성 리포트 화면 계약 테스트

**설명:** 현재 실제로 보이는 report surface와 숨겨진 legacy section을 source assertion이 아니라 DOM 결과로 구분한다. 이 테스트는 Milestone 1에서 의도적으로 갱신한다.

**수용 기준:**

- [ ] report의 active overview, slide navigation, audio issue playback을 DOM 기준으로 검증한다.
- [ ] `aiSummary`, `strengths`, practice goal이 API에 있지만 active report에 보이지 않는 기준선을 명시적으로 기록한다.
- [ ] 첫 회차와 두 번째 회차에서 이전 report load 여부를 검증한다.

**검증:**

- [ ] `pnpm --filter @orbit/web test -- RehearsalReportDocument`
- [ ] `pnpm test:smoke --grep "rehearsal report baseline"`
- [ ] 1440×900, 1024×768, 390×844 screenshot을 QA 문서에 연결한다.

**의존성:** M0.1

**예상 파일:**

- `apps/web/src/features/rehearsal/RehearsalReportDocument.test.tsx`
- `apps/web/src/features/rehearsal/RehearsalReportTestView.test.tsx`
- `tests/e2e/adaptive-coaching.spec.ts`
- `docs/qa/adaptive-coaching/report-baseline.md`

**예상 규모:** M

### M0.3 — report·transcript·audio 정책 문서 정합화

**설명:** 현재 서로 다른 시점의 문서가 `transcript 30분 cache`, `transcript 영속 미보관`, `transcript artifact 저장`, `audio 즉시 삭제`, `audio 14일 보관`을 동시에 설명하는 문제를 정리한다. Milestone 2의 30일 목표 정책과 현재 상태를 구분해 쓴다.

**수용 기준:**

- [ ] 현재 상태와 Milestone 2 목표 상태를 별도 표로 설명한다.
- [ ] `report.transcriptRetained`, `transcriptDownloadAvailable`, artifact 존재 여부의 의미를 구분한다.
- [ ] raw audio, transcript JSON/TXT, semantic evidence Redis 각각의 보존 주체와 삭제 책임을 명시한다.

**검증:**

- [ ] 문서의 endpoint와 schema key가 실제 controller/shared schema에 존재하는지 `rg`로 확인한다.
- [ ] `docs/contracts.md`와 rehearsal-report 문서 사이에 retention 수치가 충돌하지 않는지 검토한다.
- [ ] 공개 API가 transcript JSON과 storage key를 반환하지 않는지 API test를 확인한다.

**의존성:** M0.1

**예상 파일:**

- `docs/contracts.md`
- `docs/rehearsal-report/README.md`
- `docs/rehearsal-report/report-policy.md`
- `docs/yb/리허설/audio-transcript-retention-status.md`

**예상 규모:** M

### M0.4 — report API capability 회귀 테스트

**설명:** legacy report, practice plan, coaching capability, transcript/audio availability 응답이 서로 다른 실패를 빈 성공으로 숨기지 않도록 schema와 client mapping을 고정한다.

**수용 기준:**

- [ ] report 성공과 plan/capability 일부 실패를 독립적으로 표시한다.
- [ ] transcript와 audio의 available/expired/not-ready 상태가 서로 영향을 주지 않는다.
- [ ] project viewer는 read 가능하고 non-member와 audience는 거부된다.

**검증:**

- [ ] `pnpm --filter @orbit/shared test`
- [ ] `pnpm --filter @orbit/api test -- rehearsals.service`
- [ ] `pnpm --filter @orbit/web test -- reportApi`

**의존성:** M0.3

**예상 파일:**

- `packages/shared/src/rehearsals/rehearsal.schema.test.ts`
- `apps/api/src/rehearsals/rehearsals.service.spec.ts`
- `apps/web/src/features/rehearsal/reportApi.test.ts`
- `apps/api/src/runtime-config/coaching-capabilities.controller.spec.ts`

**예상 규모:** M

## 4. 마일스톤 종료 게이트 G0

- [ ] 합성 fixture reset이 idempotent하다.
- [ ] 배포와 local에서 같은 report route와 capability 상태를 재현했다.
- [ ] 현재 retention과 목표 30일 retention이 문서에서 명확히 구분된다.
- [ ] report, plan, capability 일부 실패 회귀 테스트가 통과한다.
- [ ] 민감 원문이 fixture, log, Job result, screenshot에 없다.
- [ ] `pnpm build`, `pnpm lint`가 통과한다.

## 5. Rollout과 rollback

이 마일스톤은 fixture, test, documentation만 변경하므로 사용자 기능 rollout은 없다. fixture reset이나 test가 기존 demo 흐름을 깨면 해당 fixture PR만 revert할 수 있어야 하며 runtime schema나 production data migration을 포함하지 않는다.

## 6. 다음 마일스톤 handoff

G0 종료 시 다음 자료를 Milestone 1과 2 PR에 첨부한다.

- active report DOM과 viewport별 baseline
- report/plan/capability 상태 fixture ID
- 현재/목표 retention 표
- project role별 API 접근 결과
- 변경하면 안 되는 legacy report compatibility fixture
