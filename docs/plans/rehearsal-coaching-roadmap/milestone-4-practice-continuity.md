# Milestone 4 — 연습 지속 장치

> 선행 조건: Milestone 2 Gate G2, content 기반 추천을 포함하려면 Milestone 3 Gate G3  
> 목표: 발표일까지 남은 시간과 현재 준비도를 다음 행동으로 바꾸고, 앱 안에서 연습을 다시 시작하며, 발표 당일 필요한 정보만 빠르게 확인하게 한다.

## 1. 사용자 완료 상태

- project에 발표 일시와 timezone을 설정한다.
- 홈과 project에서 D-day와 권장 추가 연습 횟수를 확인한다.
- 도래한 인앱 reminder에서 바로 practice plan 또는 rehearsal을 시작한다.
- 발표 당일에는 약점 3가지와 slide별 목표 시간만 모은 private 요약 카드를 연다.

## 2. 아키텍처 결정

### 2.1 Project core schema와 schedule을 분리한다

기존 `Project` 응답에 optional 필드를 계속 추가하지 않고 별도 aggregate를 사용한다.

```ts
type ProjectPresentationSettings = {
  projectId: string;
  presentationAt: string | null;
  timezone: string;
  reminderEnabled: boolean;
  revision: number;
  updatedAt: string;
};
```

- project owner/editor가 CAS로 수정한다.
- viewer는 읽을 수 있지만 수정할 수 없다.
- `presentationAt`은 UTC ISO datetime으로 저장하고 표시·D-day 계산에 timezone을 사용한다.
- 일정 원문을 외부 Calendar에 전송하지 않는다.

### 2.2 권장 연습 횟수는 결정론적으로 계산한다

AI readiness 결과를 입력으로 사용하지만 횟수 자체를 AI가 자유 생성하지 않는다.

초기 정책 v1:

```text
ready:
  기본 0회, 발표까지 3일 이상이면 선택 1회

needs-practice:
  기본 1회
  persistent high/medium goal이 2개 이상이면 +1
  Q&A가 미완료이거나 high content issue가 있으면 +1

unmeasured:
  측정 가능한 기준선을 위한 전체 리허설 1회

최종:
  0..3 범위
  남은 calendar day보다 크게 권장하지 않음
  발표 당일에는 최대 1회
```

결과에는 횟수와 함께 사용된 reason code를 제공한다. 정책 변경 시 `recommendationPolicyVersion`을 올린다.

### 2.3 Reminder는 사용자별 server state다

인앱 reminder는 browser localStorage를 canonical source로 사용하지 않는다.

```ts
type PracticeReminder = {
  reminderId: string;
  projectId: string;
  userId: string;
  dueAt: string;
  state: "pending" | "snoozed" | "completed" | "dismissed";
  reason: "scheduled" | "needs-practice" | "day-before" | "day-of";
  sourceCoachingRevision: number | null;
  snoozedUntil: string | null;
};
```

- presentation settings 또는 readiness revision이 바뀌면 idempotent하게 다시 계산한다.
- dueAt 이후 사용자가 앱을 열 때 보여준다.
- 새 성공 rehearsal이 reminder 생성 시점 이후 완료되면 관련 reminder를 completed로 수렴시킨다.

## 3. 구현 순서

```text
M4.1 schedule contract·migration
  └─ M4.2 schedule API·settings UI
       └─ M4.3 recommendation model·D-day
            ├─ M4.4 reminder contract·migration
            │    └─ M4.5 reminder state·API
            │         └─ M4.6 home/project reminder UI
            └─ M4.7 day-of summary card
```

M4.4와 M4.7은 M4.3 이후 병렬 진행할 수 있다.

## 4. 작업 목록

### M4.1 — Presentation settings 계약과 migration

**설명:** project별 발표 일시, timezone, reminder 설정을 저장하는 별도 table과 strict shared schema를 만든다. revision CAS와 project tenant FK를 포함한다.

**수용 기준:**

- [ ] valid IANA timezone과 UTC ISO datetime만 허용한다.
- [ ] first write revision 0, 이후 current revision만 update할 수 있다.
- [ ] project 삭제 시 settings가 cascade되고 다른 project 설정을 참조할 수 없다.

**검증:**

- [ ] schema timezone/datetime/revision negative test
- [ ] migration up/down/up, unique project, tenant FK test
- [ ] DST 전환 날짜 fixture에서 UTC 저장값이 변하지 않는지 확인한다.

**의존성:** G2

**예상 파일:**

- `packages/shared/src/projects/project-presentation-settings.schema.ts`
- `packages/shared/src/projects/project-presentation-settings.schema.test.ts`
- `apps/api/src/database/migrations/<timestamp>-CreateProjectPresentationSettings.ts`
- `apps/api/src/database/migrations/<timestamp>-CreateProjectPresentationSettings.spec.ts`
- `apps/api/src/database/data-source.ts`

**예상 규모:** M

### M4.2 — Presentation settings API와 설정 UI

**설명:** read/put endpoint와 project settings form을 만든다. form은 date, time, timezone, in-app reminder on/off만 포함한다.

목표 endpoint:

```text
GET /api/v1/projects/:projectId/presentation-settings
PUT /api/v1/projects/:projectId/presentation-settings
```

**수용 기준:**

- [ ] owner/editor write, viewer read, non-member/audience deny 권한을 적용한다.
- [ ] CAS conflict 시 사용자의 입력을 지우지 않고 current revision을 다시 확인하게 한다.
- [ ] presentationAt을 제거하면 pending reminder를 취소할 수 있는 domain event를 발행한다.

**검증:**

- [ ] role matrix와 revision conflict API test
- [ ] loading/empty/saved/conflict/error form component test
- [ ] Asia/Seoul과 다른 timezone 표시 Playwright test

**의존성:** M4.1

**예상 파일:**

- `apps/api/src/projects/project-presentation-settings.controller.ts`
- `apps/api/src/projects/project-presentation-settings.service.ts`
- `apps/api/src/projects/project-presentation-settings.service.spec.ts`
- `apps/web/src/features/projects/ProjectPresentationSettings.tsx`
- `apps/web/src/features/projects/ProjectPresentationSettings.test.tsx`

**예상 규모:** M

### M4.3 — D-day와 권장 연습 횟수 model

**설명:** settings, readiness, current goal history, Q&A/content 상태를 입력으로 받아 D-day label과 0~3회의 권장 횟수를 계산하는 pure model을 shared 또는 API domain에 구현한다.

**수용 기준:**

- [ ] 정책 v1 표와 같은 입력이 같은 횟수·reason code를 반환한다.
- [ ] presentationAt이 없거나 지난 경우 권장 횟수를 추측하지 않는다.
- [ ] timezone의 local calendar day를 사용하고 단순 24시간 나눗셈으로 D-day를 계산하지 않는다.

**검증:**

- [ ] D-30, D-3, D-1, D-day, past, DST 경계 pure model test
- [ ] ready/needs-practice/unmeasured와 goal/Q&A 조합 table test
- [ ] 정책 version과 reason code snapshot test

**의존성:** M4.2, Milestone 2 M2.9

**예상 파일:**

- `packages/shared/src/coaching/practice-recommendation.schema.ts`
- `packages/shared/src/coaching/practice-recommendation.schema.test.ts`
- `apps/api/src/coaching/practice-recommendation.ts`
- `apps/api/src/coaching/practice-recommendation.spec.ts`

**예상 규모:** M

### Checkpoint M4-A — Schedule과 recommendation

- [ ] project에서 발표 일시를 저장·수정·삭제할 수 있다.
- [ ] D-day가 project timezone 기준으로 정확하다.
- [ ] 권장 횟수가 0~3 범위와 reason code를 가진다.
- [ ] readiness API 실패 시 권장 횟수를 확정값으로 표시하지 않는다.

### M4.4 — 사용자별 reminder 계약과 migration

**설명:** 사용자별 reminder 상태, reason, dueAt, snooze를 strict shared schema와 별도 table로 고정한다. deterministic identity를 위한 unique key와 project/user tenant FK를 둔다.

**수용 기준:**

- [ ] pending/snoozed/completed/dismissed 상태별 필수 필드 불변식을 검증한다.
- [ ] 같은 project/user/reason/dueAt/source revision 조합이 중복 reminder를 만들지 않는다.
- [ ] project 삭제와 사용자 삭제 시 의도한 cascade가 적용되고 다른 사용자의 reminder를 참조할 수 없다.

**검증:**

- [ ] shared positive/negative state schema test
- [ ] migration up/down/up, unique constraint, tenant FK test
- [ ] DST 경계의 dueAt은 UTC 절대 시각으로 유지되는지 확인한다.

**의존성:** M4.3

**예상 파일:**

- `packages/shared/src/coaching/practice-reminder.schema.ts`
- `packages/shared/src/coaching/practice-reminder.schema.test.ts`
- `apps/api/src/database/migrations/<timestamp>-CreatePracticeReminders.ts`
- `apps/api/src/database/migrations/<timestamp>-CreatePracticeReminders.spec.ts`
- `apps/api/src/database/data-source.ts`

**예상 규모:** M

### M4.5 — Reminder 생성·상태 전이 API

**설명:** schedule/readiness 변화로 reminder를 생성·갱신하고 사용자 action을 저장한다. 기존 Job queue를 사용하는 주기 dispatcher 또는 API read-time reconciliation 중 하나를 선택하되 결과는 같은 deterministic reminder ID로 수렴해야 한다.

목표 endpoint:

```text
GET  /api/v1/reminders?state=pending
POST /api/v1/reminders/:reminderId/snooze
POST /api/v1/reminders/:reminderId/dismiss
POST /api/v1/reminders/:reminderId/complete
```

**수용 기준:**

- [ ] 같은 source revision의 반복 reconciliation이 같은 reminder row에 수렴한다.
- [ ] 다른 사용자의 reminder는 조회·수정할 수 없다.
- [ ] presentationAt 삭제, 새 성공 run, snooze 만료가 올바른 state transition으로 수렴한다.

**검증:**

- [ ] strict request/response parse와 invalid state transition mapping test
- [ ] idempotent generation, snooze, dismiss, auto-complete service test
- [ ] user A/B, project member removal security test

**의존성:** M4.4

**예상 파일:**

- `apps/api/src/reminders/reminders.service.ts`
- `apps/api/src/reminders/reminders.service.spec.ts`
- `apps/api/src/reminders/reminders.controller.ts`
- `apps/api/src/reminders/reminders.module.ts`

**예상 규모:** M

### M4.6 — 홈과 project 인앱 reminder UI

**설명:** due reminder를 home/project에 비차단 card로 표시한다. primary action은 current practice plan, fallback은 full rehearsal이다. `오늘 다시 알림`과 `닫기`를 제공한다.

**수용 기준:**

- [ ] pending/due reminder만 표시하고 snoozed/dismissed/completed reminder는 숨긴다.
- [ ] ready plan이면 plan으로, stale/no-goal/error이면 적절한 rehearsal fallback으로 이동한다.
- [ ] card가 modal로 작업을 막지 않고 keyboard와 screen reader로 모든 action을 사용할 수 있다.

**검증:**

- [ ] reminder state와 destination pure model test
- [ ] home/project loading/empty/error/partial component test
- [ ] reminder → practice plan → rehearsal 완료 → reminder 사라짐 E2E

**의존성:** M4.5

**예상 파일:**

- `apps/web/src/features/coaching/reminderApi.ts`
- `apps/web/src/features/coaching/practiceReminderViewModel.ts`
- `apps/web/src/features/coaching/practiceReminderViewModel.test.ts`
- `apps/web/src/features/coaching/PracticeReminderCard.tsx`
- `apps/web/src/features/projects/ProjectHub.tsx`

**예상 규모:** M

### M4.7 — 발표 당일 private 요약 카드

**설명:** current Practice Plan Top 3와 run/deck snapshot의 slide target time을 한 화면에 조합한다. route는 project read 권한 안에 두고 audience route와 분리한다.

권장 route:

```text
/rehearsal/:projectId/day-of
```

**수용 기준:**

- [ ] current Top 3를 약점/주의점 3개로 표시하고 없는 목표를 임의 생성하지 않는다.
- [ ] run snapshot 기준 slide 순서·제목·목표 시간을 표시하며 current deck mismatch를 명시한다.
- [ ] speaker notes, transcript, raw audio, Q&A answer는 포함하지 않고 `scriptVisible=false` 정책을 지킨다.

**검증:**

- [ ] ready/no-goal/stale/unmeasured day-of view model test
- [ ] owner/editor/viewer 접근과 audience/non-member deny E2E
- [ ] 390×844에서 한 손 스크롤과 큰 글자 설정 접근성 확인

**의존성:** M4.3, Milestone 1 M1.2

**예상 파일:**

- `packages/shared/src/coaching/presenter-aid.schema.ts`
- `apps/web/src/features/coaching/DayOfSummaryPage.tsx`
- `apps/web/src/features/coaching/dayOfSummaryViewModel.ts`
- `apps/web/src/features/coaching/dayOfSummaryViewModel.test.ts`
- `apps/web/src/App.tsx`

**예상 규모:** M

## 5. 마일스톤 종료 게이트 G4

- [ ] project별 presentationAt/timezone CAS가 동작한다.
- [ ] D-day와 권장 횟수가 정책 version과 reason code를 가진다.
- [ ] reminder가 사용자별로 격리되고 중복 생성되지 않는다.
- [ ] reminder action이 실제 practice plan/rehearsal로 이어진다.
- [ ] 새 성공 rehearsal 이후 관련 reminder가 완료된다.
- [ ] day-of card에 약점 3개와 slide target time만 안전하게 표시된다.
- [ ] migration/API/Web/E2E/timezone/security test가 통과한다.

## 6. Rollout

1. presentation settings 저장만 먼저 배포하고 reminder 생성은 비활성화한다.
2. D-day와 권장 횟수를 allowlist project에서 확인한다.
3. reminder를 owner 사용자부터 열고 중복·stale reminder 비율을 관찰한다.
4. project editor/viewer로 확대한다.
5. day-of card는 presentationAt의 local date가 오늘인 project에서 우선 노출한다.

## 7. Rollback

- reminder dispatcher를 중지해도 settings와 report 기능은 유지한다.
- reminder UI를 숨겨도 stored reminder state는 삭제하지 않는다.
- schedule API를 rollback할 때 presentation settings table을 즉시 drop하지 않고 reader/writer drain 후 migration down을 수행한다.
- 외부 알림이 없으므로 rollback 시 외부 provider 취소 작업은 없다.

## 8. 관찰 지표

- presentation settings 설정 project 수
- D-7/D-3/D-1/D-day reminder 노출·action count
- reminder → plan/rehearsal 시작 전환율
- 권장 횟수 대비 실제 성공 rehearsal count
- stale/duplicate reminder count
- day-of card open count

일정의 상세 문구, AI 근거, transcript, speaker notes는 계측하지 않는다.
