# Shared src 파일 맵

`packages/shared/src`는 ORBIT의 공통 런타임 계약을 담는다. 프론트엔드, API, worker, editor-core, realtime 패키지는 여기서 export된 Zod schema와 TypeScript type을 재사용한다.

`coaching/`은 Adaptive Rehearsal Coach의 Brief/Lens, immutable Goal/Resolution,
Focused Practice, Challenge Q&A, identifier-only internal Job과 private audio
cleanup 계약을 소유한다. raw audio, transcript, typed answer, speaker notes는
canonical coaching result나 Job payload/result에 포함하지 않는다.

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
| `activity/activity-id.schema.ts` | Activity, question, option, run, response, text entry ID 계약. |
| `activity/activity-definition.schema.ts` | Deck에 저장하는 참여 장표 정의, 문항 union, 연결 결과 정의 계약. |
| `activity/activity-runtime.schema.ts` | PresentationSession별 run, 상태, answer, response 계약. |
| `activity/activity-results.schema.ts` | presenter/public/editor 결과 projection을 분리하는 strict 계약. |
| `activity/activity-api.schema.ts` | run 상태, supersede, 응답 upsert, moderation request/response 계약. |
| `auth/auth.schema.ts` | 회원가입, 로그인, 로그아웃, 현재 사용자 조회 API의 request/response와 session schema. |
| `common/demo-ids.ts` | 1차 스프린트 데모용 고정 사용자, 워크스페이스, 프로젝트, 덱, 세션 ID. |
| `common/time.schema.ts` | ISO datetime schema와 현재 시각 생성 유틸리티. |
| `coaching/*.schema.ts` | Adaptive Coaching aggregate, bounded result, private evidence 경계 계약. |
| `coaching/rehearsal-focus-profile.schema.ts` | 사용자 연습 목표 최대 3개, CAS revision, 실행 시점 frozen snapshot 계약. |
| `coaching/speech-evidence.schema.ts` | CPM v1, WPM 호환값, STT Quality Gate, pause v2, Owner-only 12초 Evidence Clip 계약. |
| `coaching/presenter-aid.schema.ts` | 전체 script 없이 남은 시간, keyword 최대 3개, 미해결 문제 최대 1개만 전달하는 P0 presenter aid 계약. |
| `coaching/rehearsal-analyze.schema.ts` | Worker에서 Python `/rehearsal/analyze`로 보내는 strict request DTO 계약. |
| `coaching/p0-core-contract.fixtures.json` | TypeScript와 Python 담당자가 함께 읽는 비민감·언어 중립 P0 경계 fixture 원본. |
| `coaching/p0-core-contract.fixtures.ts` | JSON fixture를 `@orbit/shared`에서 export하는 TypeScript wrapper. |
| `deck/deck-api.schema.ts` | 덱 저장/복원 API request, response, error, snapshot, patch log entry 계약. NestJS API와 web/editor/AI consumer가 같은 API 표면을 공유할 때 사용한다. |
| `deck/generate-deck.schema.ts` | AI 덱 생성 request, response, validation issue, job result 계약. API, worker, web이 같은 generate-deck payload를 검증할 때 사용한다. |
| `deck/deck-export.schema.ts` | Deck JSON을 PPTX로 export하는 request와 job result 계약. API, worker, web이 같은 export 결과 payload를 검증할 때 사용한다. |
| `deck/template-blueprint.schema.ts` | 활성 PPTX OOXML 경로의 TemplateBlueprint sidecar와 quality report 계약, historical-only `pptxImportJobResultSchema` parser. 활성 Job 결과는 `pptxOoxmlGenerationJobResultSchema`를 사용하며 notes page locator/preview metadata, bounded notes·render policy diagnostics, template slot 의미와 rectangular table cell locator를 관리한다. |
| `deck/deck.schema.ts` | deck top-level 구조, presenter timing, metadata, canvas preset, theme, slide layout/style, slide, keyword, slide action schema와 `Deck`, `DeckCanvas`, `DeckMetadata`, `Slide`, `SlideLayout`, `SlideStyle`, `Keyword` 타입. |
| `deck/id.schema.ts` | deck 내부 ID prefix schema와 `DeckId`, `DeckSlideId`, `DeckElementId`, `DeckAnimationId`, `DeckActionId`, `DeckKeywordId`, `DeckChangeId` 타입. |
| `deck/patch.schema.ts` | deck 변경 요청과 적용 이력 schema. AI, 편집기, import가 전체 Deck JSON을 다시 만들지 않고 patch operation으로 변경을 전달할 때 사용한다. |
| `deck/slide-action.schema.ts` | slide cue trigger와 keyword-authored action schema. cue 기반 animation 실행과 다음 슬라이드 이동 계약을 관리한다. |
| `deck/slide-object.schema.ts` | slide element schema, element type/role, 타입별 props, 좌표/크기/회전/투명도/z-index/잠금/표시 상태를 관리한다. |
| `deck/animation.schema.ts` | animation schema와 MVP animation type. 객체/슬라이드 애니메이션 계약을 관리한다. |
| `deck/chart.schema.ts` | chart type, 타입별 chart datum, chart style, chart schema. chart object props 검증에 사용한다. |
| `deck/theme.schema.ts` | deck theme schema. deck 전체 기본 디자인 토큰, palette, typography, effects 계약을 관리한다. |
| `files/file.schema.ts` | 파일 업로드 결과, file purpose, rehearsal audio MIME schema와 runtime size limit 주입 helper. |
| `jobs/job.schema.ts` | 비동기 Job 상태, 진행률, 결과/에러 schema. `historicalJobTypeSchema`/`jobTypeSchema`/`jobSchema`는 과거 row 조회를 보존하고, active/public creatable schema는 retired legacy type의 신규 실행을 거부한다. |
| `projects/project.schema.ts` | 프로젝트 생성/삭제 요청과 프로젝트 응답 schema. |
| `rehearsals/live-stt.schema.ts` | 발표/리허설 중 온디바이스 Live STT가 내보내는 local transcript, keyword, cue, slide advance event 계약. |
| `rehearsals/realtime-transcription.schema.ts` | 브라우저 Live STT가 OpenAI Realtime transcription에 연결할 때 API에서 받는 project-scoped client secret 응답 계약. |
| `rehearsals/rehearsal.schema.ts` | 리허설 run, upload-url/complete 요청, 후속 audio chunk begin/upload/complete, run meta, run 조회 API 계약. `completeRehearsalAudioUploadRequestSchema`는 `fileId`와 선택적인 `liveTranscript`를 받으며 chunk manifest는 `completeRehearsalAudioChunkUploadRequestSchema`를 사용한다. |
| `realtime/websocket.schema.ts` | WebSocket event envelope, companion authority/generation event, annotation·laser·signaling bound와 주요 payload schema. |
| `presentation/presentation.schema.ts` | Deck version, `presentation | rehearsal` purpose, opt-in audience access와 nullable audience URL을 고정한 발표 세션, 리허설 지표, 최종 보고서 schema. |
| `presentation/presenter-companion.schema.ts` | Safe Deck allowlist와 companion HTTP response/bootstrap/status 계약. |

## Activity Slides 계약 메모

- Deck에는 `ActivityDefinition`과 `sourceActivityId` 참조만 저장한다. 참여 QR을 일반 장표에 배치할 때도 전용 `activity-qr` 요소에 activity ID 참조만 저장하고, run, response, aggregate, QR 이미지, audience URL은 Deck이나 `slide.elements`에 넣지 않는다.
- `kind`가 없는 legacy slide는 parse 시 `content`로 정규화한다. `activity`와 `activity-results`가 하나라도 있으면 Deck canvas는 `wide-16-9`여야 한다.
- presenter/public/editor 결과는 서로 독립된 strict schema다. public 결과에는 선택 이름과 pending/hidden 주관식 원문이 존재할 수 없다.
- 응답은 HTTP transaction으로 저장하고 WebSocket은 commit 후 revision 알림과 public projection만 전달한다.

## ORBIT-14 작업 메모

ORBIT-14의 핵심 작업은 deck 계약을 더 엄격하게 만드는 것이다.

- `deck/deck.schema.ts`: top-level 필드는 `deckId`, `projectId`, `title`, `version`, `metadata`, `targetDurationMinutes`, `canvas`, `theme`, `slides`로 관리한다. `width`, `height`는 top-level이 아니라 `canvas` 안에서만 관리한다.
- `deck/deck.schema.ts`: `1920x1080` 16:9, `1024x768` 4:3, `metadata.language = "ko"`, `metadata.locale = "ko-KR"` 강제 대상. `metadata`, `theme`는 입력 생략 시 기본값으로 채우고, `slides`는 최소 1개 이상으로 검증한다.
- `deck/deck.schema.ts`: `theme`는 deck 전체 기본 디자인 토큰이다. `palette`, `typography`, `effects`를 포함하고, object props가 있으면 object props가 우선한다.
- `deck/deck.schema.ts`: slide 필드는 `slideId`, `order`, `title`, `thumbnailUrl`, `estimatedSeconds`, `style`, `speakerNotes`, optional imported-slide `importRenderMode`, `elements`, `keywords`, `animations`, `actions`를 유지한다. `importRenderMode`는 `editable | hybrid | snapshot`이며 field가 없는 legacy Deck은 기존 렌더링을 유지한다. `thumbnailUrl`은 imported/image-only slide처럼 `elements`가 비어 있는 발표자 렌더링 fallback에만 사용하며, 일반 편집 썸네일 캐시는 Deck에 저장하지 않는다. `estimatedSeconds`는 presenter 목표 시간 비교용 선택 필드이고, `slide.style.layout`은 AI 생성 결과의 레이아웃 preset으로 사용하며, 슬라이드별 크기 override는 허용하지 않는다.
- `rehearsals/rehearsal.schema.ts`: `full` run의 `evaluationSnapshot.slides[].thumbnailUrl`은 `rehearsal-slide-snapshot` 자산을 실행 단위로 고정한 리포트 이미지다. 리포트는 현재 Deck thumbnail보다 이 URL을 우선한다.
- `deck/id.schema.ts`: deck 내부 ID는 `deck_`, `slide_`, `el_`, `anim_`, `act_`, `kw_`, `change_` prefix를 강제한다. `projectId`, `fileId`, `jobId`, `sessionId`, `userId` 등 다른 도메인 소유 ID는 여기서 강제하지 않는다.
- `deck/patch.schema.ts`: `DeckPatchSchema`는 적용 요청, `DeckChangeRecordSchema`는 적용 완료 이력이다. patch는 `baseVersion` 기준으로 충돌을 확인하고, 적용 후 최종 Deck JSON은 반드시 `deckSchema`로 다시 검증한다.
- `deck/patch.schema.ts`: patch operation은 deck 제목, slide 추가/수정/삭제/정렬, theme 수정, slide style 수정, element 추가/좌표/props/삭제, speakerNotes, keywords, animation 추가/수정/삭제, slide action 추가/수정/삭제를 지원한다. element props patch는 타입별 부분 업데이트를 위해 `record unknown`으로 받고, 적용된 최종 element는 `deckElementSchema`가 검증한다.
- `deck/slide-object.schema.ts`: `text`, `rect`, `ellipse`, `line`, `arrow`, `polygon`, `star`, `ring`, `image`, `group`, `customShape`, `chart` object type을 허용한다. `shape`, `video`는 허용하지 않는다.
- `deck/slide-object.schema.ts`: `x`, `y`는 `-1,000,000` 이상 `1,000,000` 이하의 finite number, `width`, `height`는 `0` 초과로 검증한다. 캔버스 밖 좌표는 범위 안에서 보존한다. `rotation`, `opacity`, `zIndex`, `locked`, `visible`은 객체 공통 상태로 관리한다.
- `deck/slide-object.schema.ts`: `text`, `image`, `chart`, `group`, `customShape`는 타입별 props로 검증한다. `image`는 `fit`과 `cover` crop 기준점인 `focusX`, `focusY`를 가진다. 도형류는 공통 shape props를 사용하고, `customShape`는 `pathData`, `viewBoxWidth`, `viewBoxHeight`, `closed`, `nodes` 기반 편집 계약으로 관리한다. AI 디자인 의미는 공통 `role` 필드로 표현한다. 배경 이미지와 장식 요소는 `slide.elements` flat list에 유지하되, 신규 AI 생성 slide의 단색 canvas 배경은 `slide.style.backgroundColor`를 사용한다.
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

- `deck/generate-deck.schema.ts`: `topic`, `prompt`, `designPrompt`, `targetDurationMinutes`, `slideCountRange`, `template`, `metadata`, `design`, `references` 요청 계약을 관리한다. public selector 없이 내부 `design-pack + program-v2`만 사용하며 `generationMode`, `design.engineVersion`, `design.slidePresetId`, `designReferences`, `templateBlueprintId`와 unknown field를 거부한다.
- `deck/generate-deck.schema.ts`: 1차 AI PPT 생성은 `brief`, `design.paletteOverride`, color option request/response를 추가해 설문 기반 Session Design Pack을 표현한다. `paletteOverride`는 기존 `theme.palette.accentColor` 구조를 유지하고 `theme.palette.accent`를 만들지 않는다.
- `deck/generate-deck.schema.ts`: 생성 결과는 `deck`, `warnings`, `validation`이며 job result는 여기에 `deckId`를 더한다. 최종 `deck`은 기존 `deckSchema`를 그대로 통과해야 한다.
- `deck/generate-deck.schema.ts`: research diagnostics는 `not-run | complete | partial | unavailable` 등급과 안전한 limitation code, 공식·독립 출처 수, 핵심 사실 충족 여부를 전달하며 기존 payload에는 기본값을 적용한다.
- `deck/generate-deck.schema.ts`: rendered Visual QA diagnostics는 `passed | advisory | failed | unavailable`을 구분하며 advisory 결과의 issue code와 영향 slide order를 함께 전달한다.
- `deck/generate-deck.schema.ts`: `generateDeckStoredJobPayloadSchema`는 부모 Job에 저장하는 request, design pack snapshot, image asset scope와 선택적 `requestedByUserId`만 strict하게 허용한다. 기존 Job은 사용자별 PostgreSQL claim에서 `projects.created_by`를 fallback으로 사용한다.
- `deck/generate-deck.schema.ts`: LLM은 좌표, 크기, zIndex를 만들지 않으며 recipe-v1 `slotPreset`/`layoutVariant` 계약은 제거한다. program-v2의 `visualIntent`, `mediaIntent` 같은 생성 중간 필드는 최종 `DeckSchema`에 저장하지 않고 Art Director `compositionId`와 compiler가 최종 구조를 만든다.
- `deck/deck-export.schema.ts`: 1차 PPTX export는 `format: "pptx"`만 허용하고, job result는 `deckId`, `fileId`, `url`, `format`, `warnings`를 담는다.
- `deck/deck.schema.ts`: 생성 deck metadata는 선택적으로 `sourceType`, `generatedBy: "ai"`, `audience`, `purpose`, `tone`, `createdFrom`을 담는다. 과거 Deck의 `createdFrom.designReferences`는 historical read를 위해 `{ fileId }[]`로 계속 parse한다.
- `deck/deck.schema.ts`: slide에는 선택적 `aiNotes`를 두고 `emphasisPoints`, `sourceEvidence`만 저장한다. 디자인 방향은 별도 배열 없이 기존 `theme`, `slide.style`, `slide.elements`, `chart`, `animations`로 표현한다.

## ORBIT-27 작업 메모

ORBIT-27의 공유 타입 작업은 저장된 AI 제안과 승인 후 적용 흐름을 고정한다. LLM 생성 payload가 아니라 이미 만들어진 `DeckPatch`를 저장/검토/적용하는 public 계약이다.

## AI PPT 2차 계약 메모

- `deck/generate-deck.schema.ts`: 생성 요청은 선택적으로 `design.fontOverride`, 확장된 `design.mediaPolicy`, `design.referencePolicy`, `visualPlanPolicy`, `referencePolicy`, `referenceFileIds`를 받는다. 생략해도 내부 `program-v2` 기본 경로를 유지한다.
- `deck/deck.schema.ts`: generated slide의 `aiNotes`는 기존 `emphasisPoints`, `sourceEvidence`에 더해 선택적 `visualPlan`과 `sourceLedger`를 담을 수 있다.
