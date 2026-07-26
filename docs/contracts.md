# ORBIT 공통 계약 인덱스

## 목적

ORBIT의 런타임 계약 원본은 `packages/shared`의 Zod schema와 각 서비스의
runtime validation이다. 이 문서들은 사람이 계약을 찾고 변경 영향을 판단하기 위한
설명이며, 코드와 문서가 다르면 schema를 우선하고 같은 PR에서 문서를 정합화한다.

## Domain 계약

| 문서 | 범위 | 주요 코드 원본 |
| --- | --- | --- |
| [공통 플랫폼](./contracts/common.md) | 인증, Project, File, Job, WebSocket, 공통 E2E | `packages/shared/src/auth`, `packages/shared/src/files`, `packages/shared/src/jobs`, `packages/shared/src/websocket` |
| [Deck·Editor](./contracts/deck-editor.md) | Deck JSON, Activity Slide, Patch, 저장, template, slide practice, Design Agent | `packages/shared/src/deck`, `packages/shared/src/activities`, `packages/shared/src/slide-practice` |
| [AI Deck](./contracts/ai-deck.md) | 생성 request, staged generation, design-pack, program-v2 | `packages/shared/src/deck/generate-deck.schema.ts`, `packages/shared/src/jobs/ai-deck-generation-stage.schema.ts` |
| [PPTX](./contracts/pptx.md) | import, OOXML generation, sync, storage compatibility | `packages/shared/src/deck/pptx-*` |
| [Rehearsal](./contracts/rehearsal.md) | STT provider, run, report, semantic evidence, adaptive coach | `packages/shared/src/rehearsals`, `packages/shared/src/coaching` |

## 변경 규칙

- 공통 구조를 바꾸면 `packages/shared` schema, schema test, 관련 domain 문서를
  같은 PR에서 변경한다.
- domain manifest는 이 index 전체가 아니라 작업에 필요한 domain 문서와
  `common.md`만 선택한다.
- Deck, File, Job, WebSocket payload를 바꾸기 전에는 해당 schema의 직접·전이
  consumer를 `pnpm agent:context --path <path>`로 확인한다.
- 완료된 실행 계획과 `docs/plans`의 역사 자료는 계약 원본으로 사용하지 않는다.
  최종 결정은 이 index, domain 계약, `packages/shared`, [decision log](./decision-log.md)
  순서로 확인한다.
- 문서의 예시 값은 credential이나 실제 사용자 데이터를 포함하지 않는다.
