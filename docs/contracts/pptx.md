# PPTX 계약

> 인덱스: [ORBIT 공통 계약](../contracts.md)
>
> 런타임 source of truth는 `packages/shared` schema와 서비스 validation이다.

## PPTX import legacy, Template Blueprint, Quality Report 계약

PPTX import는 최종 편집/렌더링용 `Deck`과 템플릿 의미 sidecar인 `TemplateBlueprint`를 분리한다. `DeckElement` schema는 변경하지 않고, imported slide에는 optional `importRenderMode`만 additive하게 저장한다. 템플릿 의미와 notes page provenance 판단은 `packages/shared/src/deck/template-blueprint.schema.ts`의 sidecar를 원본으로 둔다.

`/pptx-imports`는 에디터의 활성 import 경로가 아니다. #339 PR 3부터 신규 요청과 Job 생성을 중단했고, PR 4에서 남은 API tombstone, queue/job constant, consumer, processor를 제거한다. `historicalJobTypeSchema`, `jobTypeSchema`, `jobSchema`는 과거 row 조회 호환을 유지하며 `pptxImportJobResultSchema`는 historical result parser로만 남긴다. `activeJobTypeSchema`와 `publicCreatableJobTypeSchema`는 `pptx-import`를 거부한다.

PR 4의 런타임 제거와 personal staging 자동 배포는 완료됐다. #339 종료 전 배포 환경의 `pptx-import` queue에서 queued/active 및 예약·repeat 잔여 Job과 관련 DB queued/running Job이 0인지 읽기 전용으로 확인한다. 사전 drain을 수행했다고 소급 주장하지 않으며 로컬 결과는 이 종료 증거를 대신하지 않는다.

제거된 Legacy API 계약:

- `POST /api/v1/projects/:projectId/pptx-imports`
- request: `{ "fileId": "file_1" }`
- response: `{ "job": "{ JobSchema }" }`
- Job type: `pptx-import`

controller와 module이 제거되어 이 경로는 `404`이며, queue/job constant와 `enqueuePptxImportJob` export도 존재하지 않는다. 활성 대체 경로는 `POST /api/v1/projects/:projectId/pptx-ooxml-generations`다.

Legacy PPTX import job result:

```json
{
  "deckId": "deck_import_file_1",
  "templateId": "template_file_1",
  "qualityReport": {
    "compositeScore": 82,
    "metrics": {
      "geometry": 90,
      "text": 80,
      "color": 80,
      "layer": 90,
      "editability": 60,
      "pixelSimilarity": null
    },
    "weights": {
      "geometry": 25,
      "text": 15,
      "color": 10,
      "layer": 10,
      "editability": 10,
      "pixelSimilarity": 30
    },
    "editabilityCoverage": 0.6,
    "appliedCap": null,
    "slideReports": [
      {
        "slideIndex": 1,
        "status": "not_evaluated",
        "ssim": null,
        "reasons": ["candidate renderer unavailable"],
        "fallback": "none"
      }
    ],
    "notes": ["pixel renderer unavailable"]
  },
  "warnings": []
}
```

TemplateBlueprint:

```json
{
  "templateId": "template_file_1",
  "sourceFileId": "file_1",
  "slides": [
    {
      "slideId": "slide_import_file_1_1",
      "slideIndex": 1,
      "sourceSlideIndex": 1,
      "slots": [
        {
          "elementId": "el_imported_1_slide_1_text",
          "usage": "content-slot",
          "slotRole": "title",
          "replaceMode": "replace",
          "confidence": 0.95,
          "bounds": { "x": 120, "y": 80, "width": 800, "height": 120 },
          "source": { "type": "placeholder", "placeholderType": "title" }
        }
      ]
    }
  ]
}
```

PPTX import preference와 slide render mode:

- 활성 OOXML generation request는 strict `{ fileId, importPreference }`이며 `importPreference`는 `appearance-first | editability-first`만 허용한다.
- rolling compatibility를 위해 `importPreference` 누락은 API schema에서 `editability-first`로 보정한다. 신규 Editor는 항상 값을 보내며 UI 기본 강조는 `appearance-first`다.
- `Slide.importRenderMode`는 imported deck 전용 optional `editable | hybrid | snapshot`이다. field가 없는 legacy Deck은 기존 element rendering을 유지한다.
- `snapshot`은 source slide render를 표시하지만 element tree를 삭제하지 않는다. selection, hit-test, 직접 mutation을 비활성화하는 동작은 후속 renderer policy가 같은 field를 기준으로 구현한다.

`TemplateBlueprint.slides[].notesPage`는 다음 strict sidecar다.

```json
{
  "status": "rendered",
  "sourceNotesPart": "ppt/notesSlides/notesSlide1.xml",
  "sourceNotesMasterPart": "ppt/notesMasters/notesMaster1.xml",
  "bodyShapeId": "2",
  "bodyWritable": true,
  "notesWidthEmu": 6858000,
  "notesHeightEmu": 9144000,
  "renderAssetFileId": "file_notes_preview_1",
  "hasNonBodyContent": true
}
```

- `status`는 `absent | preserved | rendered | render-unavailable`이다.
- `preserved`, `rendered`, `render-unavailable`은 canonical `sourceNotesPart`를 요구하고 `rendered`만 `renderAssetFileId`를 가질 수 있다.
- `bodyWritable=true`는 stable `bodyShapeId`를 요구하며 notes width/height는 함께 존재해야 한다.
- sidecar에는 speaker notes 원문, notes XML, preview image base64, header/footer 실제 문구를 저장하지 않는다. 원문은 `Slide.speakerNotes`, package bytes는 current package, preview bitmap은 보호된 project asset이 소유한다.

신규 `QualityReport.slideReports[]`는 기존 field를 유지하며 다음 optional policy 진단을 함께 검증한다.

```json
{
  "selectedRenderMode": "snapshot",
  "recommendedRenderMode": "snapshot",
  "pixelEvaluation": "not-evaluated",
  "unsupportedObjectCount": 2,
  "fontSubstitutionCount": 1
}
```

- render mode는 `editable | hybrid | snapshot`, pixel 평가는 `passed | failed | not-evaluated`만 허용한다.
- object/font count는 각각 `0..10,000`이다. 다섯 policy 진단은 함께 존재하거나 모두 생략되어야 하고 `pixelEvaluation`은 기존 `status`와 일치해야 한다. `not-evaluated`는 `ssim: null`만, `passed`는 실제 `ssim` 값만 허용한다. renderer 실행 실패를 뜻하는 `failed`는 측정값이 없을 수 있다. 신규 field가 없는 legacy quality result도 그대로 parse한다.
- `qualityReport.notesDiagnostics`는 `total`, `imported`, `rendered`, `writable`의 `0..10,000` count와 최대 100개의 enum warning code/count만 저장한다. 각 subset count는 `total` 이하여야 하고 warning code는 중복될 수 없다.
- notes diagnostics와 slide report에는 speaker notes 원문, notes XML, image base64를 저장하지 않는다.

결정 사항:

- Python worker의 `/design/import-pptx`는 기존 `blueprint`, `assets`, `warnings`와 함께 `templateBlueprint`, `qualityReport`를 반환한다.
- `ORBIT_PPTX_OOXML_VECTOR_IMPORT` 기본값은 `true`이며, Python worker는 OOXML XML 직접 파서 기반 visual tree를 먼저 사용한다. 지원하지 않는 OOXML 효과는 임의 변환하지 않고 `warnings`에 남기며, 파서 실패 시 기존 `python-pptx` importer로 fallback한다. `false`로 설정하면 기존 `python-pptx` importer를 사용한다.
- Worker는 imported image asset을 기존 `design-asset` 저장 흐름으로 저장하고 asset ref를 API asset content URL로 교체한 뒤 `DeckSchema`로 검증해 `decks`에 저장한다.
- `templateBlueprint`와 `qualityReport`는 `template_blueprints` 테이블에 저장한다.
- 편집기 재접속 시 `GET /api/v1/projects/:projectId/deck/import-quality`가 현재 Deck과 연결된 최신 `quality_report_json`을 `{ importQuality: { qualityReport } | null }`로 반환한다. 이 read-only sidecar는 Deck JSON이나 Deck version을 변경하지 않으며, 누락되었거나 schema가 유효하지 않으면 `null`을 반환한다.
- 현재 slide의 notes page preview는 `GET /api/v1/projects/:projectId/deck/slides/:slideId/notes-preview`로 조회한다. owner/editor 권한만 허용하며 응답은 strict `{ notesPreview: { slideId, status, assetUrl } }`다. `status`는 `available | absent | sync-pending | stale | render-unavailable | unavailable`이고 `available`일 때만 같은 project의 보호된 `/assets/:fileId/content` URL을 반환한다. 다른 project, 누락·비업로드·비이미지 asset은 `unavailable`과 `assetUrl: null`로 수렴한다.
- notes preview API는 `fileId`를 별도 field로 노출하지 않고 speaker notes 원문, notes XML locator/content, image base64, TemplateBlueprint 전체를 반환하지 않는다. audience/public projection에는 이 endpoint나 URL을 추가하지 않는다.
- placeholder `p:ph`에서 온 텍스트/미디어는 `content-slot` 또는 `media-slot`과 `replace`로 분류한다.
- master/layout 유래 요소, 반복 텍스트, 직접 그린 애매한 텍스트 박스는 기본적으로 `decoration` 또는 `fixed-text`이며 `preserve`/`ignore`와 낮은 confidence를 사용한다.
- Quality composite score는 geometry 25, text 15, color 10, layer 10, editability 10, pixel similarity 30 가중치를 사용한다.
- pixel renderer가 없으면 `pixelSimilarity: null`로 두고 나머지 항목을 재가중한다. slide별 평가는 `qualityReport.slideReports[]`에 `passed`, `vectorization_failed`, `not_evaluated`와 `ssim`, 실패 사유, fallback 후보를 남긴다.
- 품질 UI는 `editabilityCoverage`를 “편집 가능한 객체 비율”로 표시하고 pixel/text fidelity와 분리한다. slide별 selected/recommended mode, pixel 평가 여부, unsupported/font count, notes import/render/writable 상태와 모든 bounded warning을 접을 수 있는 상세 항목으로 제공한다.
- CI accuracy gate는 appearance-first source snapshot에 SSIM `>= 0.99`, editability candidate에 `>= 0.95`를 요구한다. editability가 `0.80..0.95`이면 pixel 통과로 기록하지 않고 `fallback_required`와 explicit `hybrid`/`snapshot` recommendation을 남긴다. `0.80` 미만은 fallback으로도 통과시키지 않는다. runtime quality report에 CI SSIM을 복사하지 않는다.
- `editabilityCoverage < 0.5`면 총점 cap 70, `< 0.2`면 cap 50을 적용해 whole-slide image 변환이 높은 점수를 받지 못하게 한다.

구현 위치:

- `packages/shared/src/deck/template-blueprint.schema.ts`
- `packages/shared/src/deck/deck-api.schema.ts`
- `services/python-worker/app/ai/pptx_design_importer.py`
- `apps/worker/src/pptx-ooxml-generation.processor.ts`
- `apps/api/src/decks/decks.service.ts`
- `apps/web/src/features/editor/shell/api/deckPersistenceApi.ts`

## PPTX OOXML generation contract

PPTX OOXML generation은 에디터의 활성 PPTX import 경로다. 에디터는 `purpose=pptx-import`로 업로드한 asset의 `{ fileId, importPreference }`를 전달하고 공통 Job을 polling한다. 성공하면 OOXML result schema를 검증한 뒤 `result.deckId`와 재조회한 Deck의 `deckId`가 일치할 때만 편집 상태를 갱신한다.

이 활성 에디터 경로는 원본 문구를 AI로 교체하지 않는 OOXML visual tree 변환이며, 실패하면 `python-pptx` importer로 fallback한다. 변환된 `DeckElement`가 기본 편집 layer이고 rendered PNG는 thumbnail, 비가역 요소 fallback, sync 검증에 사용한다. `importPreference`는 Worker의 render policy 입력이며 Python AI/provider 입력이 아니다.

API:

- `POST /api/v1/projects/:projectId/pptx-ooxml-generations`
- strict request: `{ "fileId": "file_1", "importPreference": "appearance-first" }`
- rolling compatibility default: 누락된 `importPreference`는 `editability-first`
- `importPreference`는 `appearance-first`, `editability-first` 외 값을 거부한다.
- `topic`, `prompt`를 포함한 모든 unknown field는 `400 Bad Request`로 거부한다.
- response: `{ "job": "{ JobSchema }" }`
- Job type: `pptx-ooxml-generation`
- Queue name: `pptx-ooxml-generation`

Worker는 Python `/ai/pptx-ooxml-generation`에 multipart `file_id`, `file`만 전달한다. 이 경로는 OpenAI client나 다른 LLM provider를 호출하지 않고 업로드된 PPTX의 package bytes와 원본 문구를 보존한 채 visual tree와 mapping을 추출한다. `/ai/pptx-ooxml-apply-slot-texts`는 등록하지 않는다. TemplateBlueprint의 slot metadata는 OOXML source mapping과 후속 sync를 위한 정보이며 AI 문구 생성 입력이 아니다.

Job result:

```json
{
  "deckId": "deck_ooxml_file_1",
  "templateId": "template_file_1",
  "sourceFileId": "file_1",
  "currentPackageFileId": "file_current_package",
  "qualityReport": "{ QualityReport }",
  "warnings": []
}
```

TemplateBlueprint optional OOXML tracking fields:

- `sourcePackageFileId`
- `currentPackageFileId`
- `ooxmlSyncedDeckVersion`
- `slides[].renderAssetFileId`
- `slides[].fallbackRenderAssetFileId`
- `slides[].notesPage`: notes locator, writable 여부, notes size, protected preview asset ID만 저장하는 strict sidecar
- `slides[].elementSources[]`
- `slides[].sourceSlidePart`, `slides[].ooxmlOrigin`
- `slides[].slideId`: Deck의 opaque slide ID와 `sourceSlidePart`를 직접 연결한다. 신규 import는 반드시 기록하며 숫자 suffix로 slide part를 추론하지 않는다. legacy blueprint는 OOXML 변경을 적용하기 전 현재 Deck의 유일한 slide order와 `slideIndex`를 대응해 복구한 뒤 저장한다.
- `slides[].ooxmlMotionCapabilities`: `{ transitionWritable, importedMainSequenceCoverage }`를 사용한다. `importedMainSequenceCoverage`는 `unknown | absent | partial | complete`이며, writable motion capability는 유일한 `sourceSlidePart`가 있을 때만 유효하다. 여러 slide가 같은 locator를 공유하면 motion authoring을 활성화하지 않는다.
- `slides[].elementSources[]`: `{ elementId, elementType?, ooxmlOrigin?, ooxmlEditCapabilities?, slidePart, shapeId, relationshipId?, sourceType, writable, tableCellLocators?, fallbackReason? }`. 신규 importer/sync 결과는 `elementType`을 기록하며, 이 값이 없거나 실제 patch 대상 type과 다르면 property sync를 fail-closed한다.
- table source의 optional `tableCellLocators[]`는 `{ rowIndex, columnIndex, fingerprint }`이며 0-based `(0, 0)`에서 시작하는 완전한 직사각형 grid를 row-major 순서로 모두 기록한다. 각 index는 `0..999`, locator는 `1..10,000`개이고 `fingerprint`는 lowercase SHA-256 64자리다. fingerprint는 canonical `a:tc`에서 DrawingML `a:t`의 text와 그 `xml:space`만 제외해 셀 문구 변경에는 안정적이되 formatting·extension·구조 drift는 탐지한다. locator 존재만으로 `tableCellText` capability를 부여하지 않으며 direct table, unmerged rectangular grid, track 정합성, writable source mapping을 함께 증명한 경우에만 targeted sync gate가 활성화된다.
- `slots[].source.slidePart`
- `slots[].source.shapeId`
- `slots[].source.relationshipId`

`templateBlueprintSchema`, `templateBlueprintIdSchema`, `template_blueprints` 테이블은 PPTX OOXML generation/sync/export round-trip 전용 계약으로 유지한다. 일반 AI GenerateDeck call graph는 이 schema, 테이블, importer를 참조하지 않는다.

`sourcePackageFileId`는 업로드한 불변 원본 asset을 가리킨다. `currentPackageFileId`는 import 시 별도 `design-asset`으로 저장한 writable package를 가리키며, 이후 OOXML sync와 imported Deck export의 기준이다. 초기 import 결과에서는 `sourceFileId === sourcePackageFileId`이고 `currentPackageFileId`는 원본과 구분되는 저장 asset ID여야 한다. slide의 `renderAssetFileId`도 저장된 `design-asset` ID다.

OOXML provenance와 요소 편집 capability는 다음 계약을 사용한다.

- `ooxmlOrigin`은 `imported` 또는 `authored`이며 기존 Deck JSON과의 호환을 위해 optional이다.
- `ooxmlEditCapabilities.richText`는 `none`, `style-only`, `full`, `crop`은 `none`, `picture`, `picture-fill`만 허용한다.
- `tableCellText`는 필수 boolean이고 `frame`, `delete`, `imageSource`는 optional boolean이다. 필드가 없거나 `false`이면 해당 targeted sync를 지원한다고 추정하지 않는다.
- import 시 slide와 element source에 provenance를 기록하고, Deck element에도 동일 capability를 복사한다. source가 중복 shape를 가리키거나 group 내부이거나 writable하지 않으면 frame capability는 `false`다.
- 새 요소·새 슬라이드·복제본은 `authored`로 전환하며 원본 imported capability를 승계하지 않는다.
- Crop capability는 relationship이 일치하는 direct `p:pic`을 `picture`, direct picture-filled `p:sp`를 `picture-fill`로 판정한다. capability와 실제 shape locator가 일치할 때만 normalized crop을 OOXML `srcRect`에 기록하고 `null`은 기존 `srcRect`를 제거한다. 새로 작성한 image는 `picture` capability를 갖는다.
- generic exporter와 OOXML sync는 동일한 normalized crop edge와 최소 가시 영역 규칙을 사용한다. imported image의 locator 또는 capability가 불완전하면 원본 package를 유지하고 fail-closed 처리한다.
- Rich text와 Table capability는 각 보존 serializer 계약을 따른다. Motion은 transition과 imported main sequence coverage를 import 시 판정하고, 불완전 locator 또는 `partial`/`unknown` coverage에서는 보수적으로 비활성화한다.

OOXML importer는 지원되는 fade transition과 main-sequence entrance effect를 Deck `transition`/`animations`로 변환하고 bounded `qualityReport.motionDiagnostics`에 unsupported, downgraded, unresolved, excluded 집계를 기록한다. detail은 정해진 `PPTX_MOTION_*` code, slide index, count만 포함하고 최대 500개다. Generic exporter는 같은 canonical motion을 직렬화하며, group animation은 지원되는 flattened target fallback을 warning으로 반환한다. 그 외 motion 손실 진단이 있으면 export Worker는 결과 asset을 저장하기 전에 fail-closed한다.

구현 위치:

- `apps/web/src/features/editor/shell/EditorShell.tsx`
- `packages/shared/src/deck/pptx-ooxml-generation.schema.ts`
- `apps/api/src/pptx-ooxml-generations`
- `apps/worker/src/pptx-ooxml-generation.processor.ts`
- `services/python-worker/app/ai/pptx_ooxml_generation.py`
## PPTX OOXML sync contract

Deck 저장은 OOXML sync와 분리해 먼저 완료한다. OOXML-backed `TemplateBlueprint`가 있는 Deck은 operation 종류와 관계없이 `PUT /api/v1/projects/:projectId/deck`과 `POST /api/v1/projects/:projectId/deck/patches`의 모든 version 전이마다 background sync Job을 enqueue하고 response에 optional `ooxmlSyncJob`을 포함한다. 단, `ASYNC_JOB_ADMISSION_MODE=drain` 중에는 Deck 저장과 snapshot restore를 계속 완료하되 Job row와 BullMQ Job을 만들지 않고 `ooxmlSyncJob`을 생략한다. 이 경우 sync state는 `stale`, `retryable: true`로 남아 admission 재개 후 수동 retry할 수 있다.

imported Deck의 full PUT은 저장 version을 `current + 1`로 정규화하고, 변경된 요소를 `add_element`, `delete_element`, `update_element_frame`, `update_element_props` 형태의 synthetic patch로 기록한다. 일반 Deck의 full replacement와 snapshot 동작은 기존 계약을 유지한다.

Deck checkpoint는 일반 Deck patch를 기존처럼 compact한다. OOXML-backed Deck은 patch마다 `decks.deck_json`과 `decks.version`을 즉시 최신 상태로 저장하고, `ooxmlSyncedDeckVersion` 이하 patch만 compact한다. 아직 package에 반영되지 않은 patch는 sync 성공 전까지 보존한다.

OOXML-backed Deck의 snapshot restore는 historical snapshot의 내용을 복원하되 저장 version을 `current + 1`로 만들고 current state에서 복원 내용으로 가는 synthetic patch를 기록한 뒤 sync를 enqueue한다. admission drain 중에는 sync enqueue만 생략한다. response의 `restoredSnapshot.version`은 선택한 historical version을 유지하고 `deck.version`은 새 저장 version을 반환한다. 일반 Deck restore의 기존 version rewind 동작은 유지한다.

Job:

- Job type: `pptx-ooxml-sync`
- Queue name: `pptx-ooxml-sync`

클라이언트는 `GET /api/v1/projects/:projectId/deck/ooxml-sync-state`로 현재 Deck version과 PPTX package의 동기화 상태를 조회한다. 응답의 `ooxmlSyncState.status`는 `not-applicable`, `pending`, `synced`, `stale`, `failed` 중 하나이며 `deckId`, `deckVersion`, nullable `syncedDeckVersion`, `retryable`, optional 최신 `job`을 포함한다. `POST /api/v1/projects/:projectId/deck/ooxml-sync/retry`는 stale, retryable failure, 또는 현재 `PPTX_OOXML_SYNC_CAPABILITY_VERSION`보다 낮은 implementation에서 만들어진 failure에 대해 현재 Deck version 대상 sync Job을 enqueue한다. 같은 version의 queued/running Job이 있으면 기존 Job을 반환하며 중복 enqueue하지 않고, 현재 capability의 non-retryable failure는 HTTP 409로 거부한다.

Job result:

```json
{
  "deckId": "deck_import_file_1",
  "templateId": "template_file_1",
  "currentPackageFileId": "file_current_package",
  "renderAssetFileIds": ["file_slide_1"],
  "syncedDeckVersion": 2,
  "syncCapabilityVersion": 2,
  "rasterizedElements": [],
  "warnings": []
}
```

Worker에서 Python Worker로 보내는 `/ai/pptx-ooxml-sync` multipart 요청은 PPTX package를 `file` file part로, `TemplateBlueprint`, operation 배열, slide motion full-state 배열, Deck canvas, authored raster fallback 후보를 각각 `template_blueprint_file`, `operations_file`, `slide_motion_file`, `deck_canvas_file`, `authored_element_fallbacks_file`의 `application/json` file part로 전송한다. fallback part는 strict `{ theme, elements: [{ slideId, element }] }` 구조이며 현재 Deck의 최종 요소 상태만 포함한다. JSON을 일반 multipart text field로 보내지 않는다. 배포 중 rolling compatibility를 위해 Python Worker는 기존 `template_blueprint`, `operations`, `slide_motion`, `deck_canvas` text field도 소형 요청에 한해 읽지만, 신규 Worker는 file part만 사용한다.

전송 경계는 저장소의 50 MiB asset upload 제한과 image data URL의 base64 증가분, bounded OOXML metadata 규모를 기준으로 다음과 같이 제한한다.

- `file`: 50 MiB
- `template_blueprint_file`: 16 MiB
- `operations_file`: 72 MiB
- `slide_motion_file`: 16 MiB
- `deck_canvas_file`: 4 KiB
- `authored_element_fallbacks_file`: 72 MiB
- operation 배열: 최대 500개
- authored raster fallback 요소 배열: 최대 500개

Python Worker는 각 file part를 최대 크기보다 1 byte만 더 읽는 bounded read 후 JSON object/array 외형을 Pydantic으로 검증한다. 누락·중복, 잘못된 MIME type, 최대 크기 초과, malformed JSON, 잘못된 JSON 외형은 `PPTX_OOXML_SYNC_*` bounded code와 field 이름만 포함해 non-retryable로 실패한다. package/JSON 원문과 자유 형식 parser 오류는 Job 오류나 로그에 포함하지 않는다. 이 transport 단계가 실패하면 새 asset 저장, `currentPackageFileId`, `ooxmlSyncedDeckVersion`, patch compaction을 변경하지 않는다.

Supported first-pass patch operations:

- `update_element_frame`
- `update_element_props`
- `add_element`
- `delete_element`
- `add_slide`
- `reorder_slides`

Motion operation은 `update_slide_transition`, `add_animation`, `update_animation`, `delete_animation`을 지원한다. Worker는 해당 patch들을 최신 Deck의 slide별 full-state로 coalesce하여 `slide_motion_file`에 보낸다. transition은 `transitionWritable=true`인 경우만 허용하고, imported animation full-state 교체는 `importedMainSequenceCoverage`가 `absent` 또는 `complete`이며 Deck과 TemplateBlueprint capability가 일치할 때만 허용한다. `partial`, `unknown`, interactive sequence, media timing은 원본 OOXML subtree를 보존하고 authoring을 fail-closed한다. 이 mutation-disabled 상태에서는 애니메이션 inspector의 기존 효과 편집뿐 아니라 새 효과 picker와 최종 추가 동작도 같은 사유로 비활성화한다.

Python serializer는 transition 변경 시 기존 timing subtree bytes를 유지하고, main sequence 변경 시 지원되는 root chain만 교체하면서 interactive/media timing subtree를 보존한다. target은 `sourceSlidePart`와 authoritative element source의 shape identity로 해석하며, locator·coverage·target이 불완전하면 package 원본 bytes를 반환한다. element 삭제가 complete main sequence의 target을 제거하면 element operation과 최종 animation full-state를 같은 요청에서 원자적으로 적용한다.

ORBIT editor의 `group` element는 PPTX shape group이 아니라 interaction 전용 논리 그룹이다. `TemplateBlueprint.logicalGroupElementIds`는 이전 sync에서 존재했던 논리 group ID를 보존하며, Worker는 현재 Deck의 group ID와 합쳐 group 자체의 `add_element`, `update_element_frame`, `update_element_props`, `delete_element`를 package-neutral operation으로 제외한다. group 이동으로 함께 생성된 실제 자식 element frame operation은 기존 OOXML source에 정상 반영한다. sync 성공 후 sidecar는 현재 Deck의 논리 group ID로 갱신한다.

`reorder_slides`는 기존 DeckPatch의 `slideOrders` 계약을 재사용하며 operation이 실행되는 시점의 Deck slide ID 전체와 `1..N` order를 각각 정확히 한 번씩 포함해야 한다. Worker는 `ooxmlSyncedDeckVersion`의 `TemplateBlueprint.slides`를 시작 상태로 삼아 pending `add_slide`, `delete_slide`, `reorder_slides`를 저장 순서대로 replay하고 각 시점의 permutation을 검증한다. replay 결과가 stored Deck의 최종 순서와 정확히 일치해야 하며, 검증 후 transient add/delete와 과거 reorder는 최종 package mutation으로 compact한다. imported PPTX sync에서 Worker는 `TemplateBlueprint.slides[].slideId`로 각 opaque Deck slide ID를 유일한 `sourceSlidePart`에 대응시킨다. Python serializer는 전달된 `slideId ↔ sourceSlidePart`를 다시 검증하고 `ppt/presentation.xml`의 `p:sldIdLst` 자식 순서만 바꾸며 각 `p:sldId@id`, `r:id`, slide part 이름과 slide별 package entry를 유지한다. slide ID의 숫자 suffix 또는 `slideIndex`로 package part를 추론하지 않는다.

`add_slide`는 imported Deck에서 생성된 `ooxmlOrigin: authored` 슬라이드에 새 `ppt/slides/slideN.xml`, presentation relationship, content type override, 기존 slide layout relationship을 원자적으로 연결한다. 같은 sync batch의 `text`, `rect`, `image`, `table` authored element는 native OOXML로 추가하고, `ellipse`, `line`, `arrow`, `polygon`, `star`, `ring`, `svg`, `customShape`, `chart` authored element는 요소 단위 투명 PNG와 `p:pic`으로 추가한 뒤 `elementSources`를 반환한다. Worker는 생성한 opaque `slideId ↔ sourceSlidePart`를 TemplateBlueprint에 저장하므로 이후 이미지 추가와 재정렬도 동일한 locator를 사용한다.

authored raster fallback source는 원래 `elementType`을 유지하고 `ooxmlOrigin="authored"`, `sourceType="image"`, `writable=true`, `fallbackMode="rasterized"`, `fallbackReason="AUTHORED_ELEMENT_TYPE_RASTERIZED"`와 전용 picture relationship을 기록한다. 후속 frame/props 변경은 최종 Deck element를 다시 렌더링해 같은 media part를 교체한다. Deck JSON의 요소 타입과 편집성은 바뀌지 않는다. active raster source는 sync Job result의 bounded `rasterizedElements`와 사용자 warning에 계속 노출되며 Job은 `succeeded`로 완료한다.

`delete_slide`는 안정적인 `slideId ↔ sourceSlidePart` locator를 요구하고 `ppt/presentation.xml`의 slide ID 및 presentation relationship과 해당 content type override를 함께 제거한다. 마지막 슬라이드는 삭제하지 않는다. sync 성공 후 TemplateBlueprint는 최종 Deck에 남은 slide만 현재 order로 재구성한다. locator 누락, 두 Deck slide가 같은 source part를 가리키는 경우, 끊어진 presentation relationship, 중복·누락·unknown slide 또는 불완전 permutation은 bounded slide lifecycle reason으로 package 원본 bytes를 반환하고 freshness를 올리지 않는다.

`update_element_props`의 text serializer는 `text`, `runs`, `paragraphs`, `bodyInset`, `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `italic`, `underline`, `color`, `align`, `verticalAlign`, `writingMode`, `autoFit`, `fontScale`, `lineSpaceReduction`, `lineHeight`, `bullet`만 지원한다. targeted sync의 numeric `fontWeight`는 `600` 이상을 OOXML bold로 기록하고, `letterSpacing`은 canvas px와 OOXML 1/100 point 사이를 canvas scale로 변환한다. 미지원 field나 canonical projection 불일치는 fail-closed 대상이다.

table의 imported targeted sync는 authoritative source mapping의 `tableCellText=true`, complete row-major `tableCellLocators`, live fingerprint, direct unmerged rectangular `p:graphicFrame/a:tbl`을 모두 다시 검증한다. 정확히 한 cell의 `text`만 달라지고 기존 paragraph 수를 유지하는 `{ rows }` patch만 허용한다. Python은 target text node와 필요한 `xml:space`만 바꿔 기존 `a:tcPr`, paragraph/run property, 다른 cell, `a:tblPr`, `a:tblGrid`, frame transform을 보존한다. 빈 paragraph에 처음 문구를 넣을 때는 existing `a:endParaRPr`를 `a:rPr` template으로 복제한다. 두 cell 이상 변경, newline에 의한 paragraph 수 변경, style/span/track/row/column 변경, locator·fingerprint drift는 `TABLE_CELL_CAPABILITY_UNSAFE` 또는 `TABLE_STRUCTURE_UNSUPPORTED`로 package 전체를 fail-closed한다.

imported Deck에서 ORBIT가 새로 만든 `ooxmlOrigin=authored` table은 rectangular unmerged modeled table만 지원한다. add 시 `p:graphicFrame/a:tbl`과 authored source mapping을 만들고, 후속 cell 또는 row/column 변경은 owned `a:tbl` subtree만 재생성한 뒤 모든 `tableCellLocators`를 갱신한다. imported Deck의 table 병합·병합 해제와 imported table의 row/column 구조 변경은 원본 OOXML 보존을 위해 비활성화한다. native Deck의 generic PPTX export는 유효한 직사각형 `colSpan`·`rowSpan`을 DrawingML 병합 셀로 직렬화한다.

Python Worker의 sync 응답은 bounded array인 `appliedOperations`와 `unsupportedOperations`를 함께 반환한다. 각 항목은 `operationType`, optional `slideId`/`elementId`를 사용하고 unsupported 항목은 다음 bounded `reasonCode` 중 하나를 포함한다.

- `ADD_ELEMENT_FAILED`, `ADD_ELEMENT_TYPE_UNSUPPORTED`
- `CROP_CAPABILITY_UNSAFE`
- `DELETE_SLIDE_FAILED`, `DELETE_SLIDE_LOCATOR_UNSAFE`, `DELETE_SLIDE_RELATIONSHIP_UNSAFE`, `LAST_SLIDE_DELETE_FORBIDDEN`
- `RICH_TEXT_CAPABILITY_UNSAFE`
- `ELEMENT_TYPE_MISMATCH`, `FRAME_FIELDS_UNSUPPORTED`, `GROUPED_FRAME_UNSUPPORTED`
- `OPERATION_TYPE_UNSUPPORTED`, `PROPS_FIELDS_UNSUPPORTED`, `PROPS_UPDATE_FAILED`
- `SHAPE_MISSING`, `SLIDE_PART_MISSING`
- `SLIDE_REORDER_LOCATOR_UNSAFE`, `SLIDE_REORDER_PERMUTATION_INVALID`, `SLIDE_REORDER_RELATIONSHIP_UNSAFE`
- `SOURCE_MISSING`, `SOURCE_NOT_WRITABLE`, `SOURCE_PROVENANCE_UNSAFE`
- `SYNC_RESPONSE_INCOMPLETE`
- `TABLE_CELL_CAPABILITY_UNSAFE`, `TABLE_STRUCTURE_UNSUPPORTED`

Motion 응답은 별도의 bounded `appliedSlideMotion`과 `unsupportedSlideMotion` 배열을 사용한다. applied 항목은 요청 순서대로 `{ slideId, transition, animations }` scope 승인을 반환하며, unsupported 항목은 `slideId`, `transition | animations` scope와 bounded `SLIDE_MOTION_*`, `SLIDE_TRANSITION_*`, `SLIDE_ANIMATION_*` reason을 반환한다.

Worker는 전송한 operation과 `appliedOperations`의 순서·type·slide·element identity가 정확히 일치하는지 검증한다. 하나라도 unsupported이거나 응답 승인이 누락·추가·재정렬되면 non-retryable `PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION`으로 실패한다. 이때 새 asset을 저장하지 않고 `currentPackageFileId`, `ooxmlSyncedDeckVersion`, patch compaction을 변경하지 않는다. Python도 요청 안의 operation 하나라도 적용할 수 없으면 원본 package bytes를 반환하고 해당 요청의 applied 목록을 비운다.

Worker는 `slide_motion_file`과 `appliedSlideMotion`의 순서·slide ID·scope boolean도 정확히 비교한다. motion 거부 또는 승인 누락·추가·재정렬 역시 같은 freshness fail-closed 계약을 적용한다.

speaker notes, keywords, semantic cues, slide action처럼 package visual tree를 바꾸지 않는 operation은 package-neutral로 취급한다. 그 외 아직 지원하지 않는 slide/theme operation은 Python 호출 전에 같은 fail-closed 오류로 거부한다. 단순 fidelity warning은 사용자 변경이 실제로 적용된 경우에만 성공 응답과 함께 반환할 수 있다.

동시성·최신성 규칙:

- sync Worker는 `deckId` 기반 PostgreSQL advisory lock으로 같은 Deck의 package 쓰기를 직렬화한다.
- lock을 획득한 뒤 저장된 최신 Deck version을 다시 읽고, pending Job의 낮은 target을 최신 version으로 coalesce한다.
- `ooxmlSyncedDeckVersion >= deck.version`이면 provider와 asset 저장을 반복하지 않는 idempotent success로 종료한다.
- TemplateBlueprint update는 현재 저장된 `ooxmlSyncedDeckVersion`보다 높은 결과만 반영한다. 낮은 version의 완료가 최신 `currentPackageFileId`를 덮어쓰지 않는다.
- 성공한 sync version 이하의 patch만 compact한다.
- writable canonical rich text/frame, image source, image crop, supported authored table을 동기화한다. imported text는 writable direct text shape와 authoritative source mapping을 검사해 `richText=full | style-only | none`을 기록한다. `full`은 canonical paragraph/run content와 style을 동기화하고, `style-only`는 semantic text와 기존 paragraph 경계를 유지하면서 modeled style만 반영한다. 기존 run 경계와 target 경계를 합쳐 hyperlink relationship을 보존하며, 안전하게 reconcile할 수 없는 field·구조는 `RICH_TEXT_CAPABILITY_UNSAFE`로 package와 synced version을 갱신하지 않는다. 새로 추가된 text/rect/image/table 요소는 실제 OOXML `shapeId`와 writable authored source mapping을 만들고, table은 complete locator를 갱신한다. image에는 relationship과 media part를 함께 생성해 후속 편집도 같은 요소를 갱신한다. imported table cell text는 authoritative locator/fingerprint가 일치할 때만 갱신하고 imported table structure는 fail-closed한다. authored raster fallback은 package 구조·slide locator·relationship과 renderer 결과가 모두 안전할 때만 적용하며, 오류가 하나라도 있으면 원본 package bytes와 freshness를 보존한다.
- group 내부 child의 frame은 group-local 좌표 역변환을 지원하기 전까지 `GROUPED_FRAME_UNSUPPORTED`로 실패하고 원본 package bytes와 freshness를 보존한다. grouped child의 지원 가능한 text/image props 동기화는 계속 허용한다.

Imported Deck export 규칙:

- export Worker는 stored Deck과 TemplateBlueprint를 다시 읽어 `ooxmlSyncedDeckVersion === deck.version`을 확인한다.
- sync가 진행 중이면 제한된 대기·재확인 후 최신 package만 사용한다. 제한을 넘으면 명시적으로 실패하고 이전 package를 성공으로 반환하지 않는다.
- export에 사용하는 `currentPackageFileId`는 같은 project의 uploaded PPTX `design-asset`이어야 하며, package 복사 transaction 동안 asset row를 shared lock으로 보호한다.
- 사용자에게 제공하는 결과는 current package 원본 asset을 직접 노출하지 않고 별도 `export-result` asset으로 복사한다.
- TemplateBlueprint가 없는 일반 Deck은 기존 `/ai/export-deck-pptx` 경로를 유지한다.
- `POST /api/v1/projects/:projectId/deck/exports` enqueue가 실패하면 생성한 Job을 `failed`, `error.code=DECK_EXPORT_ENQUEUE_FAILED`, `retryable=true`로 먼저 저장하고 HTTP 503 `{ code, message, job }`을 반환한다. 응답과 Job의 code/message는 같으며 provider/Redis 원문 오류는 안전한 업무 로그에만 남긴다.

Implementation locations:

- `packages/shared/src/deck/deck-api.schema.ts`
- `apps/api/src/decks/decks.service.ts`
- `packages/shared/src/deck/pptx-ooxml-generation.schema.ts`
- `apps/api/src/pptx-ooxml-generations`
- `apps/worker/src/deck-export.processor.ts`
- `apps/worker/src/pptx-ooxml-generation.processor.ts`
- `apps/worker/src/pptx-ooxml-sync.processor.ts`
- `services/python-worker/app/ai/pptx_ooxml_generation.py`
