# Shared src 파일 맵

`packages/shared/src`는 ORBIT의 공통 런타임 계약을 담는다. 프론트엔드, API, worker, editor-core, realtime 패키지는 여기서 export된 Zod schema와 TypeScript type을 재사용한다.

## 원칙

- `index.ts`는 public export만 담당한다.
- schema 구현은 기능 영역별 폴더에 둔다.
- 파일 이름은 `<domain>.schema.ts` 형식을 우선한다.
- 계약이 바뀌면 `docs/contracts.md`도 같이 갱신한다.
- 특정 앱 내부에서만 쓰는 타입은 여기에 두지 않는다.

## 파일별 역할

| 파일 | 역할 |
| --- | --- |
| `index.ts` | `@orbit/shared`의 public barrel export. 구현 로직을 두지 않는다. |
| `auth/auth.schema.ts` | 회원가입, 로그인, 로그아웃, 현재 사용자 조회 API의 request/response와 session schema. |
| `common/demo-ids.ts` | 1차 스프린트 데모용 고정 사용자, 워크스페이스, 프로젝트, 덱, 세션 ID. |
| `common/time.schema.ts` | ISO datetime schema와 현재 시각 생성 유틸리티. |
| `deck/deck-api.schema.ts` | 덱 저장/복원 API request, response, error, snapshot, patch log entry 계약. NestJS API와 web/editor/AI consumer가 같은 API 표면을 공유할 때 사용한다. |
| `deck/ai-suggestion.schema.ts` | 저장된 AI 제안의 request/response, 상태, error, slide-scoped patch validation 계약. 생성/목록 조회는 deck을 바꾸지 않고, apply 응답은 deck patch 적용 결과를 포함한다. |
| `deck/generate-deck.schema.ts` | AI 덱 생성 request, response, validation issue, job result 계약. API, worker, web이 같은 generate-deck payload를 검증할 때 사용한다. |
| `deck/template-blueprint.schema.ts` | PPTX import TemplateBlueprint sidecar, quality report, import job result 계약. Deck/DeckElement schema 변경 없이 template slot 의미를 관리한다. |
| `deck/deck.schema.ts` | deck top-level 구조, presenter timing, metadata, canvas preset, theme, slide layout/style, slide, keyword, slide action schema와 `Deck`, `DeckCanvas`, `DeckMetadata`, `Slide`, `SlideLayout`, `SlideStyle`, `Keyword` 타입. |
| `deck/id.schema.ts` | deck 내부 ID prefix schema와 `DeckId`, `DeckSlideId`, `DeckElementId`, `DeckAnimationId`, `DeckActionId`, `DeckKeywordId`, `DeckChangeId` 타입. |
| `deck/patch.schema.ts` | deck 변경 요청과 적용 이력 schema. AI, 편집기, import가 전체 Deck JSON을 다시 만들지 않고 patch operation으로 변경을 전달할 때 사용한다. |
| `deck/slide-action.schema.ts` | slide cue trigger와 keyword-authored action schema. cue 기반 animation 실행과 다음 슬라이드 이동 계약을 관리한다. |
| `deck/slide-object.schema.ts` | slide element schema, element type/role, 타입별 props, 좌표/크기/회전/투명도/z-index/잠금/표시 상태를 관리한다. |
| `deck/animation.schema.ts` | animation schema와 MVP animation type. 객체/슬라이드 애니메이션 계약을 관리한다. |
| `deck/chart.schema.ts` | chart type, 타입별 chart datum, chart style, chart schema. chart object props 검증에 사용한다. |
| `deck/theme.schema.ts` | deck theme schema. deck 전체 기본 디자인 토큰, palette, typography, effects 계약을 관리한다. |
| `files/file.schema.ts` | 파일 업로드 결과, file purpose, rehearsal audio MIME schema와 runtime size limit 주입 helper. |
| `jobs/job.schema.ts` | 비동기 Job 상태, type, 진행률, 결과/에러 schema. |
| `projects/project.schema.ts` | 프로젝트 생성/삭제 요청과 프로젝트 응답 schema. |
| `rehearsals/live-stt.schema.ts` | 발표/리허설 중 온디바이스 Live STT가 내보내는 local transcript, keyword, cue, slide advance event 계약. |
| `rehearsals/realtime-transcription.schema.ts` | 브라우저 Live STT가 OpenAI Realtime transcription에 연결할 때 API에서 받는 project-scoped client secret 응답 계약. |
| `rehearsals/rehearsal.schema.ts` | 리허설 run, legacy upload-url/complete 요청, 후속 audio chunk begin/upload/complete, run meta, run 조회 API 계약. `completeRehearsalAudioUploadRequestSchema`는 `{ fileId }` legacy complete 요청이며 chunk manifest는 `completeRehearsalAudioChunkUploadRequestSchema`를 사용한다. |
| `realtime/websocket.schema.ts` | WebSocket event envelope과 주요 payload schema. |
| `presentation/presentation.schema.ts` | 발표 세션, 리허설 지표, 최종 보고서 schema. |

## ORBIT-14 작업 메모

ORBIT-14의 핵심 작업은 deck 계약을 더 엄격하게 만드는 것이다.

- `deck/deck.schema.ts`: top-level 필드는 `deckId`, `projectId`, `title`, `version`, `metadata`, `targetDurationMinutes`, `canvas`, `theme`, `slides`로 관리한다. `width`, `height`는 top-level이 아니라 `canvas` 안에서만 관리한다.
- `deck/deck.schema.ts`: `1920x1080` 16:9, `1024x768` 4:3, `metadata.language = "ko"`, `metadata.locale = "ko-KR"` 강제 대상. `metadata`, `theme`는 입력 생략 시 기본값으로 채우고, `slides`는 최소 1개 이상으로 검증한다.
- `deck/deck.schema.ts`: `theme`는 deck 전체 기본 디자인 토큰이다. `palette`, `typography`, `effects`를 포함하고, object props가 있으면 object props가 우선한다.
- `deck/deck.schema.ts`: slide 필드는 `slideId`, `order`, `title`, `thumbnailUrl`, `estimatedSeconds`, `style`, `speakerNotes`, `elements`, `keywords`, `animations`, `actions`를 유지한다. `thumbnailUrl`은 imported/image-only slide처럼 `elements`가 비어 있는 발표자 렌더링 fallback에 사용할 수 있다. `estimatedSeconds`는 presenter 목표 시간 비교용 선택 필드이고, `slide.style.layout`은 AI 생성 결과의 레이아웃 preset으로 사용하며, 슬라이드별 크기 override는 허용하지 않는다.
- `deck/id.schema.ts`: deck 내부 ID는 `deck_`, `slide_`, `el_`, `anim_`, `act_`, `kw_`, `change_` prefix를 강제한다. `projectId`, `fileId`, `jobId`, `sessionId`, `userId` 등 다른 도메인 소유 ID는 여기서 강제하지 않는다.
- `deck/patch.schema.ts`: `DeckPatchSchema`는 적용 요청, `DeckChangeRecordSchema`는 적용 완료 이력이다. patch는 `baseVersion` 기준으로 충돌을 확인하고, 적용 후 최종 Deck JSON은 반드시 `deckSchema`로 다시 검증한다.
- `deck/patch.schema.ts`: patch operation은 deck 제목, slide 추가/수정/삭제/정렬, theme 수정, slide style 수정, element 추가/좌표/props/삭제, speakerNotes, keywords, animation 추가/수정/삭제, slide action 추가/수정/삭제를 지원한다. element props patch는 타입별 부분 업데이트를 위해 `record unknown`으로 받고, 적용된 최종 element는 `deckElementSchema`가 검증한다.
- `deck/slide-object.schema.ts`: `text`, `rect`, `ellipse`, `line`, `arrow`, `polygon`, `star`, `ring`, `image`, `group`, `customShape`, `chart` object type을 허용한다. `shape`, `video`는 허용하지 않는다.
- `deck/slide-object.schema.ts`: `x`, `y`는 `0` 이상, `width`, `height`는 `0` 초과로 검증한다. 객체가 오른쪽/아래쪽으로 캔버스 밖에 일부 노출되는 경우는 MVP에서 막지 않고, PPTX import/export 구현 중 다시 결정한다. `rotation`, `opacity`, `zIndex`, `locked`, `visible`은 객체 공통 상태로 관리한다.
- `deck/slide-object.schema.ts`: `text`, `image`, `chart`, `group`, `customShape`는 타입별 props로 검증한다. `image`는 `fit`과 `cover` crop 기준점인 `focusX`, `focusY`를 가진다. 도형류는 공통 shape props를 사용하고, `customShape`는 `pathData`, `viewBoxWidth`, `viewBoxHeight`, `closed`, `nodes` 기반 편집 계약으로 관리한다. AI 디자인 의미는 공통 `role` 필드로 표현하고, 배경/장식 요소도 `slide.elements` flat list에 유지한다.
- `deck/chart.schema.ts`: unsupported chart type 거부 대상. `chart` object의 `props`는 이 schema로 검증한다. `data: []`는 빈 차트 편집을 위해 허용하고, `bar`/`line`, `pie`/`doughnut`, `scatter`는 타입별 data와 value 범위를 따로 검증한다. chart 내부 텍스트는 `style.fontFamily`와 title/axis/legend/data label font size 필드로 조정한다.
- `deck/animation.schema.ts`: `appear`, `disappear`, `fade-in`, `fade-out`, `zoom-in`, `zoom-out`, `rotate`만 MVP animation type으로 허용한다. animation은 `slide.animations` flat list에 저장하고 `elementId`로 대상 객체를 참조한다. `order`는 `1`부터 시작하며 `durationMs`, `delayMs`, `easing`은 기본값으로 정규화한다.
- `deck/deck.schema.ts`: `slide.keywords[]`는 `keywordId`, `text`, `synonyms`, `abbreviations`, `required`를 저장한다. `required`는 발표 중 반드시 언급해야 하는 keyword 여부를 나타내며 기본값은 `true`다. animation-trigger, next-slide 분류는 keyword 자체가 아니라 연결된 action으로부터 파생한다.
- `deck/slide-action.schema.ts`: keyword-authored action은 `slide.actions` flat list에 저장한다. trigger는 legacy `cue`와 신규 `keyword`를 모두 지원하고, effect는 `play-animation`, `go-to-next-slide`만 허용한다. `play-animation`은 같은 slide의 `animationId`만 참조하고, `keyword` trigger는 같은 slide의 `keywordId`만 참조할 수 있다.

## ORBIT-15 작업 메모

ORBIT-15의 공유 타입 작업은 deck 구조를 다시 정의하지 않고, 저장/복원 API가 주고받는 request/response envelope을 고정한다.

- `deck/deck-api.schema.ts`: `GET /api/v1/projects/:projectId/deck`, `PUT /api/v1/projects/:projectId/deck`, `POST /api/v1/projects/:projectId/deck/patches`, snapshot 목록/복원 API의 request와 response schema를 관리한다.
- `deck/deck-api.schema.ts`: `DeckSchema`, `DeckPatchSchema`, `DeckChangeRecordSchema`를 재사용한다. API 계층은 최종 deck, patch 요청, 적용 완료 이력을 여기서 다시 만들지 않는다.
- `deck/deck-api.schema.ts`: `snapshotId`는 `snapshot_` prefix를 강제한다. snapshot reason은 `auto-save`, `deck-replaced`, `patch-applied`, `snapshot-restore`만 허용한다.
- `deck/deck-api.schema.ts`: API error code는 `DECK_NOT_FOUND`, `SNAPSHOT_NOT_FOUND`, `PROJECT_MISMATCH`, `DECK_VALIDATION_FAILED`, `PATCH_VALIDATION_FAILED`, `STALE_BASE_VERSION`, `SNAPSHOT_PROJECT_MISMATCH`, `PATCH_APPLY_FAILED`로 시작한다.
- `deck/deck-api.schema.ts`: response envelope 내부의 `projectId`, `deckId`, `version`이 서로 어긋난 경우 validation에서 거부한다.
- `deck/deck-api.schema.ts`: `DeckChangeRecordSchema` 자체에는 `projectId`를 추가하지 않는다. ORBIT-15 API/DB에서 project 단위 patch log를 다루기 위해 `deckPatchLogEntrySchema`가 `projectId`와 `changeRecord`를 묶는다.

## ORBIT-26 작업 메모

ORBIT-26의 공유 타입 작업은 AI 생성용 중간 모델을 public 계약으로 노출하지 않고, 요청/응답과 최종 Deck JSON 확장만 고정한다.

- `deck/generate-deck.schema.ts`: `topic`, `prompt`, `designPrompt`, `targetDurationMinutes`, `slideCountRange`, `template`, `metadata`, `design`, `references`, `designReferences`, `templateBlueprintId` 요청 계약을 관리한다. `designPrompt`는 선택적인 시각 스타일 지시이며, `templateBlueprintId`는 저장된 template sidecar의 ID만 참조한다.
- `deck/generate-deck.schema.ts`: 생성 결과는 `deck`, `warnings`, `validation`이며 job result는 여기에 `deckId`를 더한다. 최종 `deck`은 기존 `deckSchema`를 그대로 통과해야 한다.
- `deck/generate-deck.schema.ts`: LLM은 좌표, 크기, zIndex를 만들지 않으며 `slotPreset`, `visualIntent`, `mediaIntent`, `layoutCandidates` 같은 생성 중간 필드는 최종 `DeckSchema`에 저장하지 않는다.
- `deck/deck.schema.ts`: 생성 deck metadata는 선택적으로 `sourceType`, `generatedBy: "ai"`, `audience`, `purpose`, `tone`, `createdFrom`을 담고, `createdFrom.designReferences`는 디자인 참조 PPTX의 `{ fileId }[]`를 저장한다.
- `deck/deck.schema.ts`: slide에는 선택적 `aiNotes`를 두고 `emphasisPoints`, `sourceEvidence`만 저장한다. 디자인 방향은 별도 배열 없이 기존 `theme`, `slide.style`, `slide.elements`, `chart`, `animations`로 표현한다.

## ORBIT-27 작업 메모

ORBIT-27의 공유 타입 작업은 저장된 AI 제안과 승인 후 적용 흐름을 고정한다. LLM 생성 payload가 아니라 이미 만들어진 `DeckPatch`를 저장/검토/적용하는 public 계약이다.

- `deck/ai-suggestion.schema.ts`: `suggestion_` prefix, `pending | applied | rejected` 상태, suggestion record, create/list/apply/reject response envelope, error code를 관리한다.
- `deck/ai-suggestion.schema.ts`: suggestion patch는 `source: "ai"`여야 하고, suggestion의 `deckId`, `slideId`, `baseVersion`과 patch 내부 값이 일치해야 한다.
- `deck/ai-suggestion.schema.ts`: 허용 operation은 같은 slide를 대상으로 하는 `update_slide`, `update_slide_style`, element operation, speaker notes, keywords, animation operation만이다. deck/theme/slide add-delete-reorder operation은 거부한다.
- `deck/ai-suggestion.schema.ts`: apply 응답은 `deck`, `changeRecord`, `snapshot`, `updatedAt`을 포함해 서버 deck patch 적용 결과와 같은 후속 갱신 정보를 제공한다.
