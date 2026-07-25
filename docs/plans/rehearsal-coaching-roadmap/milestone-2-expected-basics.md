# Milestone 2 — 기본 기대 기능과 준비도

> 선행 조건: Milestone 0 Gate G0, PDF·readiness UI는 Milestone 1 Gate G1  
> 목표: 마지막 장표까지 시간을 측정하고, transcript와 전체 audio를 30일 동안 안전하게 조회하며, 점수 없는 AI 준비도와 PDF 저장을 제공한다.

## 1. 사용자 완료 상태

Milestone 2가 끝나면 사용자는 다음을 할 수 있다.

- 마지막 장표를 포함한 전체 slide timing을 확인한다.
- 리허설 후 30일 동안 실제 전사본을 화면에서 읽는다.
- 전체 녹음을 재생하고 특정 장표 구간으로 이동한다.
- `발표해도 되겠어요`, `한 번 더 연습하는 게 좋아요`, `판단할 근거가 부족해요` 중 하나와 근거를 확인한다.
- 민감 원문을 제외한 리포트를 browser print 기반 PDF로 저장한다.

## 2. 데이터와 보존 결정

### 2.1 Canonical recording duration

`RehearsalRunMeta.recordingDurationSeconds`를 마지막 장표 종료 시각의 canonical 입력으로 사용한다.

- `MediaRecorder` session이 녹음 시작·pause·resume·stop을 기준으로 active duration을 계산한다.
- P3 speech session duration은 MediaRecorder duration이 없을 때만 fallback으로 사용한다.
- audio provider duration은 report metric 검증에 사용할 수 있지만 slide timeline 종료를 덮어쓰지 않는다.
- Web이 `recordingDurationSeconds`만 가진 경우에도 run meta를 API에 전송한다.

### 2.2 30일 retention

- raw audio: `rehearsal_runs.raw_audio_delete_deadline_at = audio complete + 30 days`
- transcript JSON/TXT: `project_assets.retention_expires_at = artifact uploaded + 30 days`
- semantic private Redis: 기존 짧은 retry TTL을 유지하며 사용자 transcript 조회에 사용하지 않는다.
- 이미 삭제된 audio는 복구하지 않는다.
- 아직 남아 있는 기존 audio deadline은 원래 upload 시각 + 30일로 backfill한다.
- 기존 transcript artifact는 artifact `uploaded_at + 30 days`로 backfill하고 이미 만료된 것은 reconciler가 삭제한다.

deadline이 지나면 Object 삭제 성공 여부와 관계없이 API 접근을 먼저 차단한다. Object 삭제는 기존 `storage_deletion_outbox`와 reconciler를 재사용한다.

### 2.3 Coaching read model

기존 `rehearsal_runs.report_json`은 수정하지 않고 다음 additive column을 사용한다.

```text
rehearsal_runs.coaching_report_json jsonb null
rehearsal_runs.coaching_report_revision integer not null default 0
rehearsal_runs.coaching_report_updated_at timestamptz null
```

기존 `CoachingReportView`에는 다음 설명 필드를 additive로 추가한다.

```ts
type ReadinessExplanation = {
  headline: string;
  reasons: string[]; // 1..4, 각 240자 이하
  basedOn: Array<
    "timing" | "semantic" | "delivery" | "practice-history" | "content" | "qna"
  >;
  sourceAnalysisRevision: number;
};
```

`CoachingReportView.readiness` enum은 그대로 유지하고 `readinessExplanation`을 추가한다. Q&A와 content가 아직 없으면 `basedOn`에 넣지 않는다.

## 3. 구현 순서

```text
M2.1 recording duration producer
  └─ M2.2 final slide timing

M2.3 retention contract·migration
  └─ M2.4 transcript cleanup
       └─ M2.5 transcript read API
            └─ M2.6 transcript·audio Web

M2.7 coaching report contract·storage
  └─ M2.8 AI readiness generation
       └─ M2.9 readiness Web
            └─ M2.10 PDF save
```

M2.1~M2.2와 M2.3~M2.4는 파일 충돌이 없으면 병렬 진행할 수 있다. M2.8은 `rehearsal-stt.processor.ts`를 변경하므로 M2.2 병합 후 시작한다.

## 4. 작업 목록

### M2.1 — 녹음 session에서 실제 duration 수집

**설명:** Live STT/P3 성공 여부와 관계없이 MediaRecorder session이 active recording duration을 제공하도록 확장한다. pause 시간은 제외하고 stop 시점의 값을 run meta에 합친다.

**수용 기준:**

- [ ] start→stop, start→pause→resume→stop에서 active duration을 양수 finite number로 계산한다.
- [ ] P3 meta가 없거나 stop에 실패해도 MediaRecorder duration만으로 run meta를 전송한다.
- [ ] Web이 `recordingDurationSeconds`만 있는 meta를 optional-empty로 버리지 않는다.

**검증:**

- [ ] fake clock 기반 recording session unit test
- [ ] P3 available/unavailable, pause/resume, one-slide rehearsal test
- [ ] `pnpm --filter @orbit/web test -- RehearsalWorkspace`

**의존성:** G0

**예상 파일:**

- `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`
- `apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx`
- `apps/web/src/features/rehearsal/speech/p3RehearsalSession.ts`
- `apps/web/src/features/rehearsal/speech/p3RehearsalSession.test.ts`

**예상 규모:** M

### M2.2 — 마지막 장표 timing 확정

**설명:** Worker의 기존 `buildSlideTimings`를 canonical duration 기준으로 검증하고, duplicate visit·역전 timestamp·unknown slide를 안전하게 제외한다. 마지막 장표의 `exitedAt`은 첫 valid entry + recording duration으로 계산한다.

**수용 기준:**

- [ ] 한 장짜리 deck과 여러 장 deck 모두 마지막 장표 timing을 생성한다.
- [ ] 마지막 timing 종료가 recording duration을 넘지 않고 전체 합계가 허용 오차 안에 있다.
- [ ] duration이 없으면 마지막 장표만 `unmeasured`로 두고 앞 장표 timing은 유지한다.

**검증:**

- [ ] one-slide, duplicate visit, pause-adjusted duration, invalid timestamp Worker test
- [ ] report schema parse와 legacy meta compatibility test
- [ ] 합성 3-slide 녹음 integration에서 마지막 slide가 report에 존재하는지 확인한다.

**의존성:** M2.1

**예상 파일:**

- `apps/worker/src/rehearsal-stt.processor.ts`
- `apps/worker/src/rehearsal-stt.processor.spec.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.test.ts`
- `docs/contracts.md`

**예상 규모:** M

### Checkpoint M2-A — Timing

- [ ] 마지막 slide timing unit/integration test가 통과한다.
- [ ] timing이 Live STT provider 성공 여부에 의존하지 않는다.
- [ ] legacy run은 기존처럼 읽히며 없는 값을 0초로 표시하지 않는다.

### M2.3 — 30일 retention 계약과 migration

**설명:** audio deadline을 14일에서 30일로 전환하고 transcript artifact의 per-asset retention deadline을 추가한다. 신규 file API response 구조는 바꾸지 않고 내부 metadata에 nullable `retention_expires_at`을 추가한다.

**수용 기준:**

- [ ] 신규 audio와 transcript artifact가 upload 시각 기준 정확히 30일 deadline을 가진다.
- [ ] existing uploaded asset을 안전하게 backfill하고 이미 deleted인 asset은 되살리지 않는다.
- [ ] migration `up → down → up`과 deadline index가 실제 PostgreSQL에서 동작한다.

**검증:**

- [ ] migration SQL spec와 PostgreSQL migration harness
- [ ] Asia/Seoul 표시와 무관하게 DB 계산은 timestamptz 절대 시각을 사용한다.
- [ ] 29일 23:59:59, 30일, 30일+1초 경계 test

**의존성:** G0

**예상 파일:**

- `apps/api/src/database/migrations/<timestamp>-ExtendRehearsalMediaRetention.ts`
- `apps/api/src/database/migrations/<timestamp>-ExtendRehearsalMediaRetention.spec.ts`
- `apps/api/src/database/data-source.ts`
- `apps/api/src/files/project-asset.entity.ts`
- `docs/contracts.md`

**예상 규모:** M

### M2.4 — Transcript artifact 만료 삭제

**설명:** `rehearsal-transcript-json`과 `rehearsal-transcript-text` 만료 asset을 기존 outbox에 idempotent하게 등록한다. Object 삭제 성공 후 asset을 `deleted`로 만들고 두 transcript가 모두 사라지면 run의 `transcript_retained=false`를 반영한다.

**수용 기준:**

- [ ] 같은 asset을 여러 번 scan해도 outbox row가 중복 생성되지 않는다.
- [ ] Object 삭제 실패는 metadata를 uploaded로 유지하고 기존 retry 정책을 따른다.
- [ ] transcript cleanup이 raw audio나 다른 project asset을 삭제하지 않는다.

**검증:**

- [ ] due/not-due/already-deleted/wrong-purpose reconciler test
- [ ] storage failure 후 retry 성공 integration test
- [ ] log와 Job error에 transcript, storage key, signed URL이 없는지 확인한다.

**의존성:** M2.3

**예상 파일:**

- `apps/worker/src/storage-deletion-reconciler.ts`
- `apps/worker/src/storage-deletion-reconciler.spec.ts`
- `apps/worker/src/rehearsal-transcript-artifacts.ts`
- `apps/worker/src/rehearsal-transcript-artifacts.spec.ts`

**예상 규모:** M

### M2.5 — Transcript 화면 조회와 즉시 삭제 API

**설명:** attachment 다운로드와 분리된 owner/project-member read endpoint를 추가한다. 즉시 삭제 command는 owner/editor만 허용하고 audio와 transcript를 선택적으로 삭제할 수 있게 한다.

목표 endpoint:

```text
GET    /api/v1/rehearsals/:runId/transcript
DELETE /api/v1/rehearsals/:runId/artifacts/:artifact
artifact = audio | transcript
```

transcript response는 `available`, `expired`, `unavailable` 상태를 명시하고 available일 때만 `text`와 `expiresAt`을 포함한다. `Cache-Control: private, no-store`를 사용한다.

**수용 기준:**

- [ ] project reader는 available transcript를 읽고 non-member와 audience는 거부된다.
- [ ] deadline 이후에는 Object가 남아 있어도 `410 REHEARSAL_TRANSCRIPT_EXPIRED`를 반환한다.
- [ ] 즉시 삭제는 idempotent하고 삭제 후 transcript/audio availability를 즉시 false로 만든다.

**검증:**

- [ ] shared strict schema positive/negative test
- [ ] owner/editor/viewer/non-member role matrix controller test
- [ ] expired, missing object, partial artifact, repeat delete service test

**의존성:** M2.4

**예상 파일:**

- `packages/shared/src/rehearsals/rehearsal.schema.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.test.ts`
- `apps/api/src/rehearsals/rehearsals.controller.ts`
- `apps/api/src/rehearsals/rehearsals.service.ts`
- `apps/api/src/rehearsals/rehearsals.service.spec.ts`

**예상 규모:** M

### M2.6 — 전사본과 전체 audio player

**설명:** report active overview에 실제 전사본 panel과 전체 audio player를 추가한다. 전체 재생과 slide navigator 기반 seek가 같은 Audio instance와 signed URL cache를 사용한다.

**수용 기준:**

- [ ] available transcript를 파일 다운로드 없이 펼쳐 읽고 만료 시 정확한 빈 상태를 표시한다.
- [ ] 전체 audio를 처음부터 끝까지 재생하고 slide 선택 시 해당 timing 시작점으로 이동한다.
- [ ] signed URL 만료 30초 전 갱신하며 다른 segment 재생 시 기존 재생을 중단한다.

**검증:**

- [ ] transcript loading/available/expired/error component test
- [ ] audio play/pause/seek/URL refresh hook test
- [ ] 실제 MinIO 환경에서 browser seek와 HTTP Range smoke test

**의존성:** M2.2, M2.5

**예상 파일:**

- `apps/web/src/features/rehearsal/reportApi.ts`
- `apps/web/src/features/rehearsal/useRehearsalAudioPlayback.ts`
- `apps/web/src/features/rehearsal/RehearsalReportMediaPanel.tsx`
- `apps/web/src/features/rehearsal/RehearsalReportMediaPanel.test.tsx`
- `apps/web/src/features/rehearsal/RehearsalReportTestOverview.tsx`

**예상 규모:** M

### Checkpoint M2-B — Retention과 media

- [ ] 신규·backfill asset이 30일 정책을 따른다.
- [ ] deadline 이후 API 접근이 Object 삭제보다 먼저 차단된다.
- [ ] transcript와 audio를 report 안에서 사용할 수 있다.
- [ ] project role과 audience privacy 경계가 통과한다.

### M2.7 — CoachingReportView 저장·조회 기반

**설명:** 기존 shared `CoachingReportView`에 `readinessExplanation`을 additive로 추가하고 `rehearsal_runs`에 별도 coaching report column/revision을 만든다. legacy report endpoint는 바꾸지 않는다.

**수용 기준:**

- [ ] old `RehearsalReport` fixture와 endpoint response가 그대로 parse된다.
- [ ] coaching report는 project/run tenant와 source analysis revision을 검증한다.
- [ ] coaching report가 없는 old run은 `200 { report: null }`로 구분된다.

**검증:**

- [ ] shared schema compatibility/forbidden-reference test
- [ ] migration up/down/up과 stale revision CAS test
- [ ] viewer read, non-member/audience deny controller test

**의존성:** G0

**예상 파일:**

- `packages/shared/src/rehearsals/rehearsal.schema.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.test.ts`
- `apps/api/src/database/migrations/<timestamp>-AddCoachingReportView.ts`
- `apps/api/src/database/migrations/<timestamp>-AddCoachingReportView.spec.ts`
- `docs/contracts.md`

**예상 규모:** M

### M2.8 — AI 준비도 생성과 안전한 fallback

**설명:** full report 생성 후 구조화된 facts만 사용해 AI readiness를 생성한다. 입력은 timing, semantic outcome, delivery issue, practice goal history이며 transcript와 speaker notes 원문을 직접 prompt에 넣지 않는다. Python response를 strict schema로 검증한 뒤 coaching report revision을 CAS 저장한다.

**수용 기준:**

- [ ] 결과는 `ready`, `needs-practice`, `unmeasured` 중 하나이며 headline과 1~4개 근거를 가진다.
- [ ] 필수 facts가 부족하거나 provider/schema가 실패하면 `unmeasured`로 terminalize하고 legacy report 성공을 유지한다.
- [ ] 같은 source analysis revision retry는 deterministic ID와 CAS로 하나의 current coaching report에 수렴한다.

**검증:**

- [ ] Python ready/needs-practice/unmeasured/provider-failure test
- [ ] Worker stale retry, invalid provider output, DB CAS test
- [ ] prompt, log, Job result에 transcript/speaker notes/provider body가 없는지 검사한다.

**의존성:** M2.2, M2.7

**예상 파일:**

- `services/python-worker/app/rehearsal.py`
- `services/python-worker/tests/test_rehearsal_analyze.py`
- `apps/worker/src/rehearsal-stt.processor.ts`
- `apps/worker/src/rehearsal-stt.processor.spec.ts`
- `apps/worker/src/coaching/coaching-report-projection.ts`

**예상 규모:** M

### M2.9 — Coaching report API와 준비도 UI

**설명:** 문서화된 coaching report endpoint를 구현하고 active report에 준비도 card를 추가한다. AI 판단을 점수처럼 보이지 않게 headline, 근거, 근거 범위로 표현한다.

목표 endpoint:

```text
GET /api/v1/projects/:projectId/rehearsals/:runId/coaching-report
```

**수용 기준:**

- [ ] ready/needs-practice/unmeasured가 서로 다른 문구와 중립적 시각 상태로 표시된다.
- [ ] 근거가 없는 과거 run은 legacy report를 유지하고 준비도 card만 숨긴다.
- [ ] readiness API 실패가 report, transcript, audio, practice CTA를 실패시키지 않는다.

**검증:**

- [ ] API response parse와 project/run mismatch test
- [ ] 세 readiness 상태와 API partial failure component test
- [ ] `점수`, `%`, 순위 표현이 렌더되지 않는 assertion

**의존성:** M2.8, G1

**예상 파일:**

- `apps/api/src/rehearsals/rehearsals.controller.ts`
- `apps/api/src/rehearsals/rehearsals.service.ts`
- `apps/web/src/features/rehearsal/reportApi.ts`
- `apps/web/src/features/rehearsal/RehearsalReadinessCard.tsx`
- `apps/web/src/features/rehearsal/RehearsalReadinessCard.test.tsx`

**예상 규모:** M

### M2.10 — 안전한 PDF 저장

**설명:** browser print를 이용한 1차 PDF 저장 경로를 제공한다. 인쇄 surface는 화면 DOM을 그대로 출력하지 않고 포함 section을 allowlist로 제어한다.

기본 포함:

- report 제목과 생성 시각
- AI 총평과 강점
- 직전 회차 변화
- 준비도와 근거
- slide timing과 bounded feedback
- 다음 연습 Top 3

기본 제외:

- 작성 대본
- 실제 전사본
- audio player와 playback URL
- 내부 ID, debug status, retry control

**수용 기준:**

- [ ] `PDF 저장`이 print 전용 layout을 열고 종료 후 원래 document title/style을 복구한다.
- [ ] 민감 section은 DOM visibility 설정과 관계없이 print tree에서 제외된다.
- [ ] A4 portrait에서 표와 card가 잘리지 않고 slide section은 가능한 한 page-break를 지킨다.

**검증:**

- [ ] print allowlist component test
- [ ] Chromium PDF snapshot에서 민감 키워드와 내부 ID 부재 확인
- [ ] ready/unmeasured/first-run PDF visual smoke test

**의존성:** M2.9, G1

**예상 파일:**

- `apps/web/src/features/rehearsal/RehearsalReportDocument.tsx`
- `apps/web/src/features/rehearsal/rehearsal-report-print.css`
- `apps/web/src/features/rehearsal/rehearsalReportPrint.ts`
- `apps/web/src/features/rehearsal/rehearsalReportPrint.test.ts`
- `tests/e2e/adaptive-coaching.spec.ts`

**예상 규모:** M

## 5. 마일스톤 종료 게이트 G2

- [ ] 한 장짜리 발표와 마지막 장표 timing이 측정된다.
- [ ] transcript와 audio의 30일 deadline/backfill/cleanup이 통과한다.
- [ ] 전체 audio와 slide seek가 실제 MinIO 환경에서 동작한다.
- [ ] AI provider 실패가 report 성공을 되돌리지 않는다.
- [ ] 준비도에 숫자 점수나 근거 없는 확신이 없다.
- [ ] PDF 기본 출력에 speaker notes, transcript, audio 정보가 없다.
- [ ] migration up/down/up, API/Worker/Python/Web test와 E2E가 통과한다.

## 6. Rollout

1. migration과 cleanup Worker를 배포하되 신규 deadline scan을 관찰 모드로 한 cycle 실행한다.
2. backfill 대상 수, due 대상 수, missing Object 수만 bounded business event로 확인한다.
3. transcript read와 full audio player를 allowlist project에 먼저 연다.
4. readiness는 `ADAPTIVE_REHEARSAL_COACH_ENABLED`와 project allowlist 뒤에서 노출한다.
5. PDF는 readiness가 꺼져도 legacy section만으로 사용할 수 있게 한다.

## 7. Rollback

- deadline 이후 access 차단을 완화하는 rollback은 하지 않는다. cleanup 오류 시 scan/enqueue만 중지한다.
- migration `down()`은 column을 제거하기 전에 신규 Worker와 API가 더 이상 해당 field를 쓰지 않는 상태에서만 수행한다.
- AI readiness를 끄면 `coaching_report_json`은 읽지 않되 legacy report는 유지한다.
- PDF와 Web media surface는 UI revert로 비활성화할 수 있으며 stored artifact를 변경하지 않는다.

## 8. 관찰 지표

- last-slide timing measured ratio
- transcript/audio availability API error ratio
- deadline due 대비 deletion completed ratio
- readiness `unmeasured` ratio와 provider failure ratio
- report PDF 요청 수
- report → practice plan 전환율 변화

모든 지표는 count/status만 사용하고 transcript, speaker notes, AI 근거 문장은 수집하지 않는다.
