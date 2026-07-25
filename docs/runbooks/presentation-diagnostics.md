# 발표·리허설 진단 세션 Runbook

발표, 전체 리허설, 에디터 부분 리허설에서 음성 인식부터 실제 슬라이드
transition 완료까지의 흐름을 브라우저 로컬 이벤트로 확인하는 방법을 정리한다.

진단 기록에는 transcript, speaker notes, STT bias phrase가 포함될 수 있다.
필요한 재현에서만 사용하고, 내보낸 파일을 이슈·PR·채팅 등에 첨부하기 전에
민감정보 포함 여부를 확인한다.

## 시작

Web 앱을 실행한다.

```bash
pnpm --filter @orbit/web dev
```

진단할 화면의 URL에 `animationDebug=1`을 추가한다.

```text
/presentation/{projectId}?animationDebug=1
/rehearsal/{projectId}?animationDebug=1
/project/{projectId}?animationDebug=1
```

기존 query parameter가 있다면 `?` 대신 `&animationDebug=1`을 붙인다.

관련 화면에 진입하면 `발표 진단 세션` drawer가 나타나고 `full 기록 중`
상태로 세션이 한 번 자동 시작된다. `animationDebug=1`이 없으면 기록은
`off`이며 drawer와 IndexedDB 쓰기가 활성화되지 않는다.

## 재현 절차

1. `animationDebug=1`이 포함된 URL로 진입한다.
2. drawer가 `full 기록 중`인지 확인한다.
3. 평소와 같은 방법으로 발표 또는 리허설을 진행하며 문제를 재현한다.
4. 문제가 발생한 직후 `세션 중지`를 누른다.
5. `stage`, `outcome`, `trace` 필터로 관련 이벤트를 좁힌다.
6. 필요한 경우 `JSONL 내보내기`로 선택한 세션을 저장한다.

발표 또는 리허설의 pause는 진단 세션을 유지한다. 발표·리허설 종료, 관련
route 이탈, drawer의 수동 중지 시 이벤트를 flush하고 세션을 종료한다.

수동으로 중지한 뒤에는 같은 페이지에서 자동 재시작하지 않는다. `새 세션
시작`을 누르거나 페이지를 다시 진입해야 새 세션이 열린다.

## Drawer 기능

| 기능 | 설명 |
| --- | --- |
| `세션 중지` | 현재 이벤트를 flush하고 세션을 종료한다. |
| `새 세션 시작` | 중지 상태에서 새로운 `full` 세션을 시작한다. |
| `최근 세션` | IndexedDB에 남아 있는 최근 세션을 선택한다. |
| `stage` | `stt`, `matcher`, `runtime`, `react`, `transition` 등의 처리 단계로 필터링한다. |
| `outcome` | `accepted`, `rejected`, `queued`, `settled`, `skipped`, `failed` 등의 결과로 필터링한다. |
| `trace` | `triggerTraceId`, `stateTransitionId`, `transitionId` 등의 trace ID를 검색한다. |
| `JSONL 내보내기` | 선택한 세션을 `.jsonl.gz` 또는 `.jsonl`로 저장한다. |
| `전체 삭제` | 이 브라우저에 저장된 모든 진단 세션을 삭제한다. |

`CompressionStream` 지원 브라우저에서는 `.jsonl.gz`가 생성된다. 지원하지
않으면 평문 `.jsonl`을 생성한다. File System Access API를 사용할 수 없는
환경에서는 일반 브라우저 download로 전환한다.

## 이벤트 추적

하나의 음성 트리거는 일반적으로 다음 순서로 이어진다.

```text
stt.result.normalized
→ matcher.occurrence.evaluated
→ runtime.intent.*
→ react.presenter_step.*
→ transition.*
```

같은 발화에서 파생된 이벤트는 `triggerTraceId`로 연결된다. React 상태 변경은
`stateTransitionId`, renderer의 실제 전환은 `transitionId`로 구분한다.

원인 분리 시 다음 순서로 확인한다.

1. `stt.result.normalized`가 기대한 전사와 trace를 생성했는지 확인한다.
2. `matcher.occurrence.evaluated`의 판정 결과와 거절 이유를 확인한다.
3. `runtime.intent.*`에서 queue, stale, duplicate, transition block 여부를 확인한다.
4. `react.presenter_step.requested`와 `react.presenter_step.committed`가 같은
   `stateTransitionId`로 이어지는지 확인한다.
5. `transition.planned`, `transition.raf_started`, `transition.settled` 또는
   `transition.skipped`의 이유를 확인한다.

## 저장과 보안

- 진단 이벤트는 API, WebSocket, telemetry 또는 서버 로그로 전송하지 않는다.
- 데이터는 현재 브라우저의 IndexedDB `diagnosticSessions`와
  `diagnosticEvents`에만 저장한다.
- 세션 시작 시 7일이 지난 로컬 세션을 정리한다.
- 저장 quota 또는 Worker 오류가 발생해도 발표 처리는 계속하며 최근 500개
  이벤트를 메모리에 유지한다. 이 경우 drawer에 로컬 저장 경고가 표시된다.
- credential, API key, `Authorization`, cookie, token, password, SDP, URL,
  raw audio, `MediaStream`, 파일 base64, 전체 오류 message와 stack은 저장하지
  않는다.
- 사용자가 내보낸 파일은 7일 자동 정리 대상이 아니다.

서버 로그와 브라우저 로컬 진단 로그의 상세 경계는
`docs/conventions/logging.md`의 `브라우저 로컬 발표 진단` 절을 따른다.

## 문제 해결

- drawer가 보이지 않으면 관련 route인지, query가 정확히
  `animationDebug=1`인지 확인한다.
- `기록 꺼짐` 상태라면 `새 세션 시작`을 누르거나 페이지를 다시 진입한다.
- 로컬 저장 경고가 보이면 발표 재현은 계속할 수 있지만 브라우저를 닫기 전에
  메모리 타임라인을 확인한다.
- 이벤트가 너무 많으면 먼저 `trace`를 검색하고, 그다음 `stage`와 `outcome`을
  조합해 범위를 줄인다.
- 내보내기 버튼이 비활성화되어 있으면 `최근 세션`에서 유효한 세션이 선택되어
  있는지 확인한다.
