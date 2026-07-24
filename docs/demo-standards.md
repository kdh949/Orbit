# 임시 사용자/데모 프로젝트 기준

## 목적

1차 스프린트에서는 ORBIT-9 초대 흐름을 제외한다. ORBIT-8 인증 기능이 추가되었지만, 기존 기능은 고정 임시 사용자, 고정 워크스페이스, 고정 데모 프로젝트 기준으로 계속 연결한다.

## 고정 Demo ID

| 구분 | 값 |
| --- | --- |
| 임시 사용자 ID | `user_demo_1` |
| 임시 워크스페이스 ID | `workspace_demo_1` |
| 임시 프로젝트 ID | `project_demo_1` |
| 임시 덱 ID | `deck_demo_1` |
| 발표 세션 ID | `session_demo_1` |

## 적용 범위

- 프로젝트 생성, 파일 업로드, 덱 편집, AI 생성, 협업, 발표, 리허설, 보고서 기능은 위 Demo ID를 기본값으로 사용한다.
- API 요청/응답, WebSocket 이벤트, Job, Deck JSON에는 필요한 Demo ID를 명시적으로 포함한다.
- 초대 플로우가 없어도 전체 E2E 흐름이 연결되어야 한다.
- 인증 기능과 Demo ID 기반 기능은 분리해 관리하고, Demo ID 제거가 쉽도록 상수 또는 fixture 형태를 유지한다.

## 기본 연결 규칙

```json
{
  "userId": "user_demo_1",
  "workspaceId": "workspace_demo_1",
  "projectId": "project_demo_1",
  "deckId": "deck_demo_1",
  "sessionId": "session_demo_1"
}
```

## 주의 사항

- Demo ID 기반 E2E 시작점은 임시 사용자 기반 프로젝트 생성이다.
- Demo ID 값이 바뀌면 프론트, 백엔드, WebSocket, AI 생성, 리허설/보고서 담당자에게 즉시 공유한다.
- Demo ID는 개발 편의를 위한 임시 계약이며, 실제 권한 모델이나 DB 스키마 확정으로 해석하지 않는다.

## AI PPT 시연 캐시 운영

캐시할 PPT는 별도 파일명이 아니라 `DEMO_AI_DECK_SOURCE_PROJECT_ID`가 가리키는 project의 현재 canonical Deck이다. 발표 전에 실제 AI 생성 흐름으로 한 번 만들고 내용, 표지, 폰트, 이미지 URL과 편집기 진입을 검수한 뒤 그 project를 source로 지정한다. source project는 삭제하지 않으며 `DEMO_USER_ID`가 읽을 수 있어야 한다.

1. 시연용 source project에서 최종 덱을 생성하고 편집기에서 검수한다.
2. `DEMO_AI_DECK_SOURCE_PROJECT_ID`에 source project ID를 설정한다.
3. `DEMO_AI_DECK_TRIGGER_TOPIC`에 발표자가 입력할 정확한 주제를 설정한다. 앞뒤 공백과 연속 공백은 정규화되지만 다른 문구는 일치하지 않는다.
4. `DEMO_FIXTURE_ENV_ALLOWLIST`에 현재 `APP_ENV`를 포함하고 `DEMO_AI_DECK_CACHE_ENABLED=true`로 설정한다.
5. 발표에서는 source 덱을 만들 때 사용한 것과 같은 palette/font를 선택한다. 캐시 덱은 재색칠하지 않는다.
6. 시연 계정이 source project와 새 target project를 모두 읽을 수 있는지 확인한다.

로컬 Compose 시연에서는 `.env.local`의 값을 interpolation에도 사용하도록 `docker compose --env-file .env.local up --build`로 실행한다.

조건이 맞으면 기존 `ai-deck-generation` Job을 그대로 사용하되 Worker에는 보내지 않는다. Style 확정 시 source 덱을 target project에 새 `deck_${jobId}`로 복제하고, 미리보기 화면은 750ms 간격으로 한 장씩 공개한 뒤 마지막 장을 600ms 유지하고 편집기로 이동한다. source 덱이 없거나 schema가 유효하지 않으면 `DEMO_DECK_CACHE_UNAVAILABLE`로 명시적으로 실패하며 일반 AI 생성으로 자동 전환하지 않는다.

초기 운영에서는 asset을 복사하지 않고 source 덱의 URL을 유지한다. 따라서 이 기능은 인증된 미리보기와 편집기 시연에만 사용하고 source project와 asset을 보존한다.

production에서는 기본적으로 캐시를 거부한다. 예외적으로 운영 시연에 사용할 때는
`DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION=true`를 두 번째 잠금으로 명시하고
`DEMO_FIXTURE_ENV_ALLOWLIST`에 `production`을 exact 값으로 포함한다. 이 승인은
source project, 시연 사용자 멤버십과 asset 접근을 production에서 검증한 뒤에만
적용하며, 시연 종료 또는 문제 발생 시 두 cache flag를 모두 `false`로 되돌린다.
