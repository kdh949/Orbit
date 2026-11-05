# 참여 장표 운영 Runbook

## 전체 흐름 smoke

기존 개발 volume과 분리된 Compose project에서 API, Web, Worker, Python worker를 모두 실행한다.

```bash
docker compose -p orbit-activity-e2e up -d --build

ACTIVITY_E2E_DATABASE_URL=postgres://orbit:orbit@127.0.0.1:5432/orbit \
pnpm test:activity-slides:e2e

docker compose -p orbit-activity-e2e down -v
```

이 테스트는 fixture project와 Deck을 만들고 다음 흐름을 한 번에 검증한다.

- passcode 세션에서 390x844 청중 입장, 응답, 새로고침 영수증 복원
- 미승인 주관식과 표시 이름의 audience API/DOM 비노출
- 발표자 archive의 승인, 공개 결과 reveal, 연결 결과 장표 편집기
- 세션 snapshot을 사용한 PPTX export와 ZIP signature
- 같은 project의 public 세션과 기존 audience cookie 격리
- 1024x768 public 입장과 passcode 미요구
- 실제 Worker retention Job의 snapshot 선행, raw response 삭제, aggregate-only archive

실패하면 `test-results/`의 screenshot, `error-context.md`, `trace.zip`을 먼저 확인한다. trace에는 테스트 데이터가 들어갈 수 있으므로 저장소에 커밋하지 않는다.

## 200명 부하 검증

```bash
docker compose -p orbit-activity-load up -d --build api

ACTIVITY_LOAD_TEST_BASE_URL=http://127.0.0.1:3000 \
ACTIVITY_LOAD_TEST_DATABASE_URL=postgres://orbit:orbit@127.0.0.1:5432/orbit \
pnpm --filter @orbit/api test:activity-load

docker compose -p orbit-activity-load down -v
```

성공 기준은 200개 고유 audience의 실패·유실·중복 0, 최종 count 200, HTTP p95 2초 이하다. 상세 기준과 기준 측정치는 `docs/qa/activity-slides/h4-200-audience-load.md`를 따른다.

## Retention 확인

세션 종료 시 `rawResponsesDeleteAfter`는 종료 시각부터 90일 뒤로 설정된다. dispatcher는 due session마다 `activity-response-retention` Job을 만들며 processor는 다음 순서를 지킨다.

1. 각 run의 aggregate snapshot을 생성하거나 기존 snapshot을 확인한다.
2. 모든 snapshot이 준비된 뒤 raw response와 주관식 원문을 삭제한다.
3. `rawResponsesDeletedAt`을 기록한다.

재실행에는 같은 Job ID를 사용하고, snapshot upsert와 삭제 상태 조건을 적용한다. 운영 확인에서는 row 수와 timestamp 존재 여부만 조회하고 원문은 출력하지 않는다.

## 장애 판별

- audience 401: 다른 세션 cookie인지, passcode join을 먼저 했는지 확인한다.
- audience 429: join은 session+IP 기준 분당 10회, 응답 mutation은 audience+run 기준 분당 30회 제한을 확인한다.
- archive가 aggregate-only: `rawResponsesDeletedAt`이 있으면 정상 retention 완료 상태다.
- export 실패: Job 상태와 오류 code를 확인하고 signed URL이나 query string은 로그에 남기지 않는다.
- 실시간 갱신 지연: Socket.IO 이벤트의 revision을 확인한 뒤 HTTP로 서버의 현재 상태를 다시 조회하는지 확인한다. 재접속과 polling fallback도 같은 조회 경로를 사용한다.
