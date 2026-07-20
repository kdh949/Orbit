# 덱 저장/복원 API 명세

ORBIT-15의 덱 저장/복원 API는 `DeckSchema` 자체를 다시 정의하지 않고, API가 주고받는 request/response envelope과 저장 경계를 고정한다. 실제 덱 구조 검증은 `packages/shared/src/deck/deck.schema.ts`, patch 검증은 `packages/shared/src/deck/patch.schema.ts`, API envelope 검증은 `packages/shared/src/deck/deck-api.schema.ts`를 기준으로 한다.

## 범위

MVP에서 NestJS API는 덱 저장의 authoritative boundary다. web/editor, AI 생성 결과 적용 흐름, worker는 같은 shared schema를 사용해서 payload를 만든다.

ORBIT-10의 project DB 모델과 권한 모델이 확정되기 전까지 `projectId`는 FK가 아닌 문자열 boundary로 저장한다. API 계층은 URL의 `projectId`와 deck/snapshot의 project boundary를 검증한다.

## Base Path

```text
/api/v1/projects/:projectId
```

## Endpoints

| Method | Path | 목적 |
| --- | --- | --- |
| `GET` | `/deck` | project의 current deck 조회 |
| `PUT` | `/deck` | current deck 전체 교체 저장 및 snapshot 생성 |
| `POST` | `/deck/patches` | current deck에 patch 적용, version 증가, change record/snapshot 생성 |
| `GET` | `/snapshots` | project의 snapshot metadata 목록 조회 |
| `GET` | `/snapshots/:snapshotId` | snapshot metadata와 전체 deck 조회 |
| `POST` | `/snapshots/:snapshotId/restore` | snapshot을 current deck으로 복원 |

MVP 기준으로 별도의 patch log 조회, snapshot 삭제, snapshot 이름 변경 API는 추가하지 않는다. 필요하면 history UI 또는 운영 정책이 확정될 때 별도 이슈로 확장한다.

## 공통 규칙

- `projectId`는 URL path에서 받는다.
- `deck.deckId`는 `deck_`, `slide.slideId`는 `slide_`, `snapshotId`는 `snapshot_` prefix를 사용한다.
- `deck.version`은 양의 정수다.
- `metadata.language`는 `ko`, `metadata.locale`은 `ko-KR`만 허용한다.
- `canvas`는 `wide-16-9` 또는 `standard-4-3` preset만 허용한다.
- patch 요청의 `baseVersion`은 DB에 저장된 current deck version과 같아야 한다.
- 성공 응답의 `deck`, `snapshot`, `changeRecord` 사이의 `projectId`, `deckId`, `version`이 어긋나면 shared API schema validation에서 거부한다.
- 시간 값은 ISO datetime 문자열을 사용한다.

아래 JSON 예시는 API envelope 이해를 위한 축약 예시다. request에서는 `DeckSchema`의 default 필드를 생략할 수 있고, response의 `deck`은 schema parse 이후 default 값이 채워진 최종 Deck JSON을 따른다.

## Deck 저장

### `GET /api/v1/projects/:projectId/deck`

current deck을 조회한다.

Response 예시:

```json
{
  "projectId": "project_demo_1",
  "deck": {
    "deckId": "deck_demo_1",
    "projectId": "project_demo_1",
    "title": "ORBIT demo",
    "version": 1,
    "metadata": {
      "language": "ko",
      "locale": "ko-KR"
    },
    "canvas": {
      "preset": "wide-16-9",
      "width": 1920,
      "height": 1080,
      "aspectRatio": "16:9"
    },
    "theme": {
      "name": "Default",
      "fontFamily": "Inter",
      "backgroundColor": "#ffffff",
      "textColor": "#111827",
      "accentColor": "#2563eb",
      "palette": {
        "primary": "#2563eb",
        "secondary": "#7c3aed",
        "surface": "#ffffff",
        "muted": "#f3f4f6",
        "border": "#e5e7eb"
      },
      "typography": {
        "headingFontFamily": "Inter",
        "bodyFontFamily": "Inter",
        "titleSize": 56,
        "headingSize": 40,
        "bodySize": 24,
        "captionSize": 16
      },
      "effects": {
        "borderRadius": 8
      }
    },
    "slides": [
      {
        "slideId": "slide_intro",
        "order": 1,
        "title": "소개",
        "thumbnailUrl": "",
        "style": {},
        "speakerNotes": "",
        "elements": [],
        "keywords": [],
        "animations": []
      }
    ]
  },
  "updatedAt": "2026-06-27T00:00:00.000Z"
}
```

### `PUT /api/v1/projects/:projectId/deck`

current deck 전체를 교체 저장하고 snapshot을 생성한다. 최초 저장과 import 결과 저장에 사용한다.

Request 예시:

```json
{
  "deck": {
    "deckId": "deck_demo_1",
    "projectId": "project_demo_1",
    "title": "ORBIT demo",
    "version": 1,
    "metadata": {
      "language": "ko",
      "locale": "ko-KR"
    },
    "canvas": {
      "preset": "wide-16-9",
      "width": 1920,
      "height": 1080,
      "aspectRatio": "16:9"
    },
    "slides": [
      {
        "slideId": "slide_intro",
        "order": 1
      }
    ]
  },
  "baseVersion": 1,
  "snapshotReason": "deck-replaced"
}
```

Response 예시:

```json
{
  "deck": {
    "deckId": "deck_demo_1",
    "projectId": "project_demo_1",
    "title": "ORBIT demo",
    "version": 1,
    "metadata": {
      "language": "ko",
      "locale": "ko-KR"
    },
    "canvas": {
      "preset": "wide-16-9",
      "width": 1920,
      "height": 1080,
      "aspectRatio": "16:9"
    },
    "slides": [
      {
        "slideId": "slide_intro",
        "order": 1
      }
    ]
  },
  "snapshot": {
    "snapshotId": "snapshot_018f3a4b-1111-2222-3333-444455556666",
    "projectId": "project_demo_1",
    "deckId": "deck_demo_1",
    "version": 1,
    "reason": "deck-replaced",
    "createdAt": "2026-06-27T00:00:00.000Z"
  },
  "updatedAt": "2026-06-27T00:00:00.000Z"
}
```

기본 `snapshotReason`은 `deck-replaced`다.

`baseVersion`이 있으면 current deck version과 일치해야 하며, 없으면 `deck.version`을 current deck version으로 검증한다. undo/restore처럼 이전 version deck을 저장하는 경로는 저장 직전 current deck version을 `baseVersion`으로 보내 stale full save를 막는다.

## Patch 적용

### `POST /api/v1/projects/:projectId/deck/patches`

current deck에 patch operation을 적용한다. API는 DB row를 잠근 뒤 current deck version과 patch `baseVersion`을 비교한다. 일치하면 `applyDeckPatch`를 통해 patch를 적용하고, deck version을 1 증가시킨 뒤 change record와 snapshot을 저장한다.

Request 예시:

```json
{
  "patch": {
    "deckId": "deck_demo_1",
    "baseVersion": 1,
    "source": "user",
    "operations": [
      {
        "type": "update_deck",
        "title": "ORBIT demo updated"
      }
    ]
  },
  "snapshotReason": "patch-applied"
}
```

Response 예시:

```json
{
  "deck": {
    "deckId": "deck_demo_1",
    "projectId": "project_demo_1",
    "title": "ORBIT demo updated",
    "version": 2,
    "metadata": {
      "language": "ko",
      "locale": "ko-KR"
    },
    "canvas": {
      "preset": "wide-16-9",
      "width": 1920,
      "height": 1080,
      "aspectRatio": "16:9"
    },
    "slides": [
      {
        "slideId": "slide_intro",
        "order": 1
      }
    ]
  },
  "changeRecord": {
    "changeId": "change_018f3a4b-1111-2222-3333-444455556666",
    "deckId": "deck_demo_1",
    "beforeVersion": 1,
    "afterVersion": 2,
    "source": "user",
    "createdAt": "2026-06-27T00:00:00.000Z",
    "operations": [
      {
        "type": "update_deck",
        "title": "ORBIT demo updated"
      }
    ]
  },
  "snapshot": {
    "snapshotId": "snapshot_018f3a4b-1111-2222-3333-444455556667",
    "projectId": "project_demo_1",
    "deckId": "deck_demo_1",
    "version": 2,
    "reason": "patch-applied",
    "createdAt": "2026-06-27T00:00:00.000Z"
  },
  "updatedAt": "2026-06-27T00:00:00.000Z"
}
```

`responseMode`을 생략하면 기존처럼 전체 `deck`을 포함한 응답을 반환한다. EditorShell autosave처럼 요청한 patch를 로컬 persisted deck에도 동일하게 적용할 수 있는 경로는 `responseMode: "ack"`를 선택할 수 있다.

Ack request 예시:

```json
{
  "patch": {
    "deckId": "deck_demo_1",
    "baseVersion": 1,
    "source": "user",
    "operations": [
      {
        "type": "update_deck",
        "title": "ORBIT demo updated"
      }
    ]
  },
  "responseMode": "ack"
}
```

Ack response에는 전체 deck JSON을 포함하지 않는다. snapshot을 생성하지 않았거나 OOXML sync job이 없으면 해당 필드는 생략한다.

```json
{
  "deckId": "deck_demo_1",
  "version": 2,
  "changeRecord": {
    "changeId": "change_018f3a4b-1111-2222-3333-444455556666",
    "deckId": "deck_demo_1",
    "beforeVersion": 1,
    "afterVersion": 2,
    "source": "user",
    "createdAt": "2026-06-27T00:00:00.000Z",
    "operations": [
      {
        "type": "update_deck",
        "title": "ORBIT demo updated"
      }
    ]
  },
  "updatedAt": "2026-06-27T00:00:00.000Z"
}
```

기본 `snapshotReason`은 `patch-applied`다.

## Snapshot

### `GET /api/v1/projects/:projectId/snapshots`

project의 snapshot metadata 목록을 최신순으로 조회한다. 목록 응답에는 deck JSON을 포함하지 않는다.

Response 예시:

```json
{
  "projectId": "project_demo_1",
  "snapshots": [
    {
      "snapshotId": "snapshot_018f3a4b-1111-2222-3333-444455556667",
      "projectId": "project_demo_1",
      "deckId": "deck_demo_1",
      "version": 2,
      "reason": "patch-applied",
      "createdAt": "2026-06-27T00:00:00.000Z"
    }
  ]
}
```

### `GET /api/v1/projects/:projectId/snapshots/:snapshotId`

선택한 snapshot의 metadata와 저장 당시 전체 deck JSON을 조회한다. 읽기 권한이 필요하며, 응답은 `deckSnapshotDetailSchema`로 검증한다. URL의 `projectId`와 snapshot의 project boundary가 일치하지 않으면 `SNAPSHOT_NOT_FOUND`로 응답한다.

### `POST /api/v1/projects/:projectId/snapshots/:snapshotId/restore`

snapshot의 deck JSON을 current deck으로 복원한다. snapshot이 요청한 `projectId`에 속하지 않으면 거부한다.

Response 예시:

```json
{
  "deck": {
    "deckId": "deck_demo_1",
    "projectId": "project_demo_1",
    "title": "ORBIT demo updated",
    "version": 2,
    "metadata": {
      "language": "ko",
      "locale": "ko-KR"
    },
    "canvas": {
      "preset": "wide-16-9",
      "width": 1920,
      "height": 1080,
      "aspectRatio": "16:9"
    },
    "slides": [
      {
        "slideId": "slide_intro",
        "order": 1
      }
    ]
  },
  "restoredSnapshot": {
    "snapshotId": "snapshot_018f3a4b-1111-2222-3333-444455556667",
    "projectId": "project_demo_1",
    "deckId": "deck_demo_1",
    "version": 2,
    "reason": "patch-applied",
    "createdAt": "2026-06-27T00:00:00.000Z"
  },
  "updatedAt": "2026-06-27T00:00:00.000Z"
}
```

복원 자체를 별도 snapshot으로 남기는 정책은 MVP에서 확정하지 않는다. 필요하면 restore 후 snapshot 생성 또는 audit log를 별도 이슈로 추가한다.

## Error Response

Error body는 `deckApiErrorSchema`를 따른다.

```json
{
  "code": "STALE_BASE_VERSION",
  "message": "Patch baseVersion 1 does not match deck version 2",
  "details": []
}
```

| Code | HTTP | 발생 조건 |
| --- | --- | --- |
| `DECK_NOT_FOUND` | `404` | project의 current deck이 없음 |
| `DECK_MISMATCH` | `409` | full deck save가 기존 project deck과 다른 `deckId`를 요청함 |
| `SNAPSHOT_NOT_FOUND` | `404` | `snapshotId`에 해당하는 snapshot이 없음 |
| `PROJECT_MISMATCH` | `400` | URL `projectId`와 deck의 `projectId`가 다름 |
| `DECK_VALIDATION_FAILED` | `400` | request deck 또는 patch 적용 후 deck이 `DeckSchema`를 통과하지 못함 |
| `PATCH_VALIDATION_FAILED` | `400` | patch request가 `DeckPatchSchema`를 통과하지 못함 |
| `STALE_BASE_VERSION` | `409` | patch 또는 full deck save `baseVersion`이 current deck version과 다름 |
| `SNAPSHOT_PROJECT_MISMATCH` | `400` | snapshot이 요청한 project에 속하지 않음 |
| `PATCH_APPLY_FAILED` | `400` | schema validation은 통과했지만 patch 적용 중 도메인 오류 발생 |

## DB 저장 범위

TypeORM migration은 다음 테이블을 생성한다.

| Table | 목적 |
| --- | --- |
| `decks` | project별 current deck JSON 저장 |
| `deck_patches` | patch 적용 완료 이력 저장 |
| `deck_snapshots` | 복원 가능한 deck snapshot 저장 |

MVP 결정:

- `decks.project_id`는 primary key다.
- `deck_patches.change_id`는 primary key다.
- `deck_snapshots.snapshot_id`는 primary key다.
- `project_id` FK와 membership 권한 검증은 ORBIT-10 이후 연결한다.
- `deck_json`은 `jsonb`로 저장하고, API 입출력 시 shared schema로 검증한다.

## 구현 위치

- API module: `apps/api/src/decks`
- Migration: `apps/api/src/database/migrations/2026062701000-CreateDeckPersistenceTables.ts`
- Shared API schema: `packages/shared/src/deck/deck-api.schema.ts`
- Patch 적용 로직: `packages/editor-core/src/patches/applyPatch.ts`

## 검증

```bash
pnpm --filter @orbit/shared typecheck
pnpm --filter @orbit/shared test -- deck
pnpm --filter @orbit/api typecheck
pnpm --filter @orbit/api test -- decks
pnpm db:migration:run
pnpm db:migration:revert
```

`pnpm db:migration:run`과 `pnpm db:migration:revert`는 Postgres가 실행 중일 때 수행한다.
