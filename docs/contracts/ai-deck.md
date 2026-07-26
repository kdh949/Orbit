# AI Deck 계약

> 인덱스: [ORBIT 공통 계약](../contracts.md)
>
> 런타임 source of truth는 `packages/shared` schema와 서비스 validation이다.

## AI 덱 생성 계약

AI 덱 생성은 사용자 입력과 참고자료 fileId를 받아 비동기 Job으로 실행한다. public 계약은 요청/응답과 최종 Deck JSON에 필요한 metadata/evidence만 포함하고, planner/layout 중간 모델은 Python worker 내부 구현으로 둔다.

요청:

```json
{
  "topic": "AI 덱 생성",
  "prompt": "참고자료 기반으로 핵심 메시지를 정리",
  "designPrompt": "테트리스 색감, 고전 게임, 픽셀 아트 느낌",
  "targetDurationMinutes": 10,
  "slideCountRange": {
    "min": 5,
    "max": 8
  },
  "template": "report",
  "metadata": {
    "audience": "technical",
    "purpose": "inform",
    "tone": "professional"
  },
  "design": {
    "profile": "technical",
    "stylePackId": "teal-professional-process",
    "visualRhythm": "technical",
    "densityTarget": "medium",
    "mediaPolicy": "balanced",
    "layoutDiversity": "stable"
  },
  "references": [{ "fileId": "file_1" }],
  "referenceKeywords": [{ "text": "실시간 발표 피드백" }],
  "referenceContext": [
    {
      "fileId": "file_1",
      "title": "reference.pdf",
      "content": "cleaned reference excerpt"
    }
  ]
}
```

응답/job result:

```json
{
  "deckId": "deck_ai_project_demo_1",
  "deck": "{ DeckSchema }",
  "warnings": [],
  "validation": {
    "passed": true,
    "layoutIssues": [],
    "contentIssues": [],
    "designIssues": [],
    "presentationIssues": []
  }
}
```

결정 사항:

- API 시작점은 `POST /api/v1/projects/:projectId/jobs/generate-deck`이다.
- Job type은 기존 `ai-deck-generation`을 사용하고 상태값은 공통 `queued`, `running`, `succeeded`, `failed`만 사용한다.
- 로컬 `.env.example`의 기본 `AI_DECK_EXECUTION_MODE`는 `pg`다. `pg`는 기존 `ai_deck_generation_stages` checkpoint를 durable queue로 직접 사용하고 AI Deck BullMQ coordinator·stage enqueue/consume 없이 파일별 OCR, planning, slide별 image fan-out, semantic quality, rendered visual quality와 publication을 실행한다. `bullmq`와 `monolith`는 rollback·회귀 경로로 유지한다. staging·production 예제의 명시적 `monolith` 값과 `develop` 자동 배포 규칙은 별도 승인된 cutover 전까지 유지한다. `sqs`는 도입 취소된 미지원 값이며 API와 Worker 시작 시 즉시 거부한다.
- GenerateDeck public request에는 `generationMode`, `design.engineVersion`, `design.slidePresetId`, `designReferences`, `templateBlueprintId`가 없다. root request와 모든 중첩 request object는 strict하며 제거된 필드와 unknown field를 거부하고 ingress 호환 shim을 두지 않는다.
- `develop` merge는 `.github/workflows/deploy-personal-staging.yml`을 통해 personal staging에 자동 배포한다. #339 때문에 이 workflow를 변경·중단하거나 `personal-staging` required reviewer를 추가하지 않는다. workflow는 run 실행 시점에 `git pull --ff-only origin develop`로 동기화한 서버 HEAD에서 Web/API/Worker/Python worker 이미지를 모두 빌드·교체하고 API/root health check가 통과해야 성공한다.
- #339 종료 증거는 자동 배포 run 성공, 서버에서 확인한 `git rev-parse HEAD`, 배포 후 BullMQ `pptx-import`, `ai-template-deck-generation`, `generate-deck` 전체 상태와 관련 DB Job의 `queued`/`running`을 읽기 전용으로 확인하고 GenerateDeck smoke를 실행한 결과다. workflow trigger SHA와 실제 서버 HEAD를 구분하며, 성공한 배포 run만으로 queue/DB가 0이었다고 주장하지 않는다. production의 ingress 중단, drain, 동시 교체와 cache invalidation은 별도 승인된 배포 계획에서 다룬다.
- 유효한 GenerateDeck request는 내부적으로 항상 `design-pack + program-v2`로 실행한다. `generationMode`와 engine은 public selector가 아니라 내부 상수다.
- 요청의 `references`는 `{ fileId: string }[]`이고 기본값은 `[]`다. shared Zod와 Python 공개 호환 façade 모두 `references`와 `referenceFileIds`를 각각 최대 10개만 허용한다. non-empty `references`를 OCR selector로 우선 사용하고 비어 있을 때 `referenceFileIds`를 fallback으로 사용하며, OCR 실행 여부는 최종 reference policy가 결정한다.
- 요청의 `referenceKeywords`는 `{ text: string }[]` 선택 필드이며 기본값은 `[]`이다. 참고자료 처리 결과의 주요 키워드를 전달할 때 사용한다.
- `referenceContext`는 `{ fileId, title, content }[]` 형태의 선택 필드이며 기본값은 `[]`이다. `/documents/parse`의 정제된 excerpt를 `/ai/generate-deck` grounding 입력으로 직접 넘길 때 사용하고, Deck metadata에는 원문을 저장하지 않는다.
- 요청의 `designPrompt`는 선택 필드이며 기본값은 없다. 값이 있으면 콘텐츠 지시가 아니라 시각 스타일 지시로만 사용하고, LLM은 `visualIntent.paletteHint`에 `background:#RRGGBB` 같은 검증 가능한 theme token을 제안한다.
- 기존 클라이언트처럼 `designPrompt` 없이 `prompt`만 보내는 요청은 계속 허용한다. worker는 하위 호환을 위해 명확한 디자인 문구만 fallback으로 분리하고, 분리되지 않은 값은 기존 콘텐츠 prompt로 처리한다.
- MVP `metadata.audience`는 `general`, `executive`, `technical`, `sales`만 허용한다.
- MVP `metadata.purpose`는 `inform`, `persuade`, `teach`, `report`만 허용한다.
- MVP `metadata.tone`은 `professional`, `friendly`, `confident`, `concise`만 허용한다.
- 요청의 `design`은 선택 필드이며 생략 시 `{ visualRhythm: "auto", densityTarget: "medium", mediaPolicy: "balanced", layoutDiversity: "stable" }`로 정규화한다.
- `/createdeck`는 engine 선택 UI나 selector field를 노출하지 않는다. Job progress는 내용 구성, 디자인 방향, 슬라이드 구성, 이미지 준비, 시각 검토, 시각 보정, 최종 발행의 7단계로 표시한다.
- `design.profile`은 선택 필드이며 `executive-report`, `startup-pitch`, `editorial`, `technical`, `training`만 허용한다. profile은 presentation profile과 theme/design-token 계획에 반영하며, 최종 composition은 Art Director의 Design Program과 composition compiler가 결정한다. 최종 Deck에는 profile용 별도 중간 구조를 저장하지 않는다.
- `design.stylePackId`는 선택 필드이며 worker 내부 curated style pack을 선택하는 hint다. registry에 존재하는 ID는 해당 pack을 적용하고, 값이 없거나 알 수 없는 non-empty ID이면 안전한 자동 선택/fallback을 사용한다.
- recipe-v1 전용 `design.slidePresetId`, `layoutVariant`, `slotPreset`, slide-preset registry와 selector는 public request 및 내부 program-v2 content/layout 계약에 포함하지 않는다. program-v2의 슬라이드 구조는 Design Program의 `compositionId`로만 선택한다.
- `design.visualRhythm`은 `auto`, `clean`, `editorial`, `bold`, `technical`만 허용한다.
- `design.densityTarget`은 `low`, `medium`, `high`만 허용한다.
- `design.mediaPolicy`는 `avoid`, `balanced`, `placeholder-ok`, `provided-only`, `public-assets`, `ai-generated`, `hybrid`, `minimal`을 허용한다. `hybrid`는 evidence에는 사용자 제공 또는 공식 asset, atmosphere에는 AI 생성 asset, 구조화 시각물에는 native element를 사용한다. `program-v2` hybrid Deck은 실제 media asset 3~5개를 품질 목표로 삼는다. asset 수가 범위를 벗어나면 `MEDIA_BUDGET_UNDERSUPPLIED` 또는 `MEDIA_BUDGET_EXCEEDED`, official evidence와 AI-generated atmosphere 조합이 부족하면 `MEDIA_MIX_UNDERSUPPLIED`를 `validation.designIssues`의 `severity="warning"`, `blocking=false` issue로 기록하며, unresolved placeholder나 다른 blocking issue가 없으면 발행을 계속한다.
- `design.layoutDiversity`는 `stable`, `varied`만 허용한다.
- AI PPT wizard의 입력 UI는 `발표 주제`, `발표 내용`, `청중`, `발표 톤`, 복수 첨부파일, `웹 리서치 허용`, `AI 이미지 사용` 체크박스를 받는다. `prompt`는 발표 내용, `brief.audienceText`는 청중을 사용하고 `targetDurationMinutes=10`, `slideCountRange={ min: 5, max: 8 }`, 한글 추천 폰트 첫 항목, generic `general-novice` coaching context를 내부 기본값으로 사용한다.
- `/createdeck`는 체크박스와 첨부 상태를 기존 정책 enum으로 변환한다. 웹 리서치 해제 시 첨부가 없으면 `user-input-only`, 있으면 `references-only`, 허용 시 첨부가 없으면 `research-first`, 있으면 `references-first`를 사용한다. AI 이미지 해제 시 `minimal`, 허용 시 지원 이미지 첨부가 없으면 `ai-generated`, 있으면 `hybrid`를 사용하고 JPEG·PNG·WebP file ID만 `officialAssetFileIds`로 전달한다. 선택한 reference policy는 root/brief/design, media policy는 design/visual plan에 일관되게 전달한다. `provided-only`와 `public-assets`는 공용 계약 호환을 위해 유지하지만 이 wizard에는 노출하지 않는다. Web은 별도 reference extraction Job을 시작하지 않고 업로드된 `referenceFileIds`를 GenerateDeck request에 직접 전달하며 staged coordinator가 OCR fan-out을 소유한다.
- 표지 생성을 위한 별도 사용자 입력과 public `coverMetadata` request는 추가하지 않는다. Python worker는 기존 Content Planner 응답의 내부 `coverContent`에서 제목·부제·kicker·문서 라벨과 선택적 발표자/소속/날짜/장소/보고 기간을 구성하며, 사실성 필드는 사용자 prompt 또는 추출된 참고자료에 명시된 값만 유지한다. 첫 슬라이드의 `contentItems`는 비우고 발표자용 설명은 `speakerNotes`에만 둔다.
- Art Director는 표지 내용, presentation profile, media policy, 실제 사용 가능한 첨부 asset을 기준으로 위 6종 중 하나를 선택한다. `cover-research-author`는 발표자 정보와 명시적으로 확인된 프로필 이미지 asset이 모두 있을 때만 허용한다. 이미지 기반 표지의 asset 해석이 실패하면 unresolved placeholder를 발행하지 않고 무이미지 표지 composition으로 재컴파일한다.
- AI PPT wizard는 `design.stylePackId = "brandlogy-modern"`를 기본값으로 사용한다. 이는 PPTX 템플릿이 아니라 worker 내부 Design Pack preset이며, 최종 Deck JSON에는 style pack 중간 필드를 저장하지 않는다.
- 내부 `program-v2` 경로는 Art Director가 만든 Design Program과 composition compiler로 좌표, 크기, zIndex, 구조 요소를 계산한다.
- AI PPT 1차 wizard는 자연어 색상 요청을 `design.colorIntent`와 `design.constraints`로 구조화한다. `designPrompt`는 설명용 보조 필드이며, 흰 배경/금지 스타일 같은 강제 규칙은 `design.constraints`가 source of truth다.
- `design.colorIntent`는 색상 추천 기준을 담는 선택 필드이며 `mood`, `trustLevel`, `energyLevel`, `formality`, `preferredHue`, `backgroundPreference`, `forbiddenStyles`를 사용한다.
- `design.constraints`는 `canvasBackground`와 `forbiddenStyles`를 사용한다. 1차에서 `canvasBackground`는 `auto`, `white`만 허용하고 `forbiddenStyles`는 `gradient`, `pastel`만 허용한다.
- 사용자가 선택한 색상은 `design.paletteOverride`에 저장해서 생성 요청에만 전달한다. 허용 key는 `primary`, `secondary`, `background`, `surface`, `muted`, `border`, `text`, `accentColor`이며 `theme.palette.accent`는 추가하지 않는다. 적용 우선순위는 schema/profile fallback < Design Pack < `designPrompt`/LLM palette hint < `paletteOverride` < `design.constraints`다.
- 색상 후보 API는 `POST /api/v1/ai/deck-color-options`를 사용한다. 요청은 `{ topic, colorMood, stylePackId, colorIntent?, constraints? }`, 응답은 `{ options: [{ optionId, name, palette, rationale }] }`이며 `options`는 정확히 3개다.
- AI PPT wizard는 `brandlogy-blue`, `executive-slate`, `modern-violet`, `resort-blue`, `calm-green`, `energetic-coral`, `warm-amber`, `editorial-rose`, `graphite-night` 9개 기본 팔레트를 제공한다. 기존 3개 색상 후보 API는 호환성을 위해 유지한다.
- 단일 AI 팔레트 변경은 `POST /api/v1/ai/deck-color-customization`을 사용한다. strict 요청은 `{ topic, instruction, basePalette, stylePackId, tone }`, strict 응답은 `{ option: { optionId, name, palette, rationale } }`이다. `basePalette`와 응답 `palette`는 `primary`, `secondary`, `background`, `surface`, `muted`, `border`, `text`, `accentColor` 8개 `#RRGGBB` 값을 모두 요구한다. LLM 또는 계약 검증 실패 시 API는 오류를 반환하고 Web은 기존 선택 팔레트를 변경하지 않는다.
- PPTX export API는 `POST /api/v1/projects/:projectId/deck/exports`를 사용한다. 요청은 `{ format: "pptx" }`, job type은 `deck-export`, job result는 `{ deckId, fileId, url, format: "pptx", warnings: [] }`다. API는 현재 Deck JSON snapshot을 worker payload에 넣고, worker는 patch replay를 하지 않는다.
- template은 `default`, `pitch`, `report`, `lesson`만 허용한다.
- Python worker의 `/ai/generate-deck`은 `projectId`와 요청 본문을 받아 최종 `DeckSchema`를 만든다.
- LLM/provider가 만드는 내용은 outline, message, design intent까지로 제한하고, 좌표/크기/zIndex는 코드 기반 layout engine이 계산한다.
- LLM은 좌표, 크기, zIndex를 만들지 않는다. Art Director가 curated `compositionId`를 선택하고 최종 좌표 계산은 composition compiler가 수행한다.
- `stylePackId`, `visualIntent`, `mediaIntent` 같은 생성 입력·중간 필드는 최종 `DeckSchema`에 저장하지 않는다. 선택된 program-v2 구조는 slide별 `aiNotes.compositionPlan`과 Deck의 `metadata.designProgramSnapshot`으로 추적한다.
- 생성 결과의 디자인은 새 배열 없이 기존 `deck.theme`, `slide.style`, `slide.elements`, chart props, `slide.animations`에 매핑한다.
- Python worker는 source data가 없는 chart 숫자를 임의 생성하지 않는다. program-v2에서 숫자 근거가 없는 `chart` intent는 `feature-grid` 의미로 재분류해 native editable element로 구성하며 chart element를 만들지 않는다. 근거 있는 수치는 curated data composition의 editable text/shape로 표현한다.
- `validation.designIssues`는 overflow, contrast, collision, safe area, density, placeholder media 같은 issue를 담는다. issue가 하나라도 있으면 `validation.passed=false`이며, repair 이후 blocking issue가 없으면 worker는 non-blocking issue를 `validation`에 남기고 Deck을 저장한다. validation issue 전체를 `warnings`에 일괄 중복하지 않는다. Python diagnostics가 명시적으로 승격한 issue·summary와 validation과 독립적으로 생성된 generation/provider/repair warning만 `warnings`에 기록한다.
- `monolith` worker는 Python 응답을 shared `generateDeckResponseSchema`와 `deckSchema`로 검증한 뒤 `decks`에 저장하고 job result에 `{ deckId, deck, warnings, validation, diagnostics }`을 저장한다.

구현 위치:

- `packages/shared/src/deck/generate-deck.schema.ts`
- `services/python-worker/app/ai/generate_deck.py`: 공개 request/response import와 얇은 façade
- `services/python-worker/app/ai/deck_generation/`: Pydantic stage DTO, 동기식 `pipeline.py`, source/content/design/layout/visual requirements/quality/diagnostics 구현
- `apps/api/src/generate-deck`
- `apps/worker/src/generate-deck.processor.ts`: payload 검증, Python 호출과 Job lifecycle adapter
- `apps/worker/src/generate-deck/pipeline.ts`: asset, semantic quality, rendered visual quality, publication 동기 orchestration
- `apps/worker/src/generate-deck/publication.ts`: 최종 Deck와 Job result 저장

### Saved Design Pack 계약

Saved Design Pack은 `/createdeck`의 Session Design Pack을 시스템 preset 또는 사용자 단위로 재사용하기 위한 Preference Rule 저장 계약이다.

- 저장 필드: `palette`, `typography`, `tone`, `density`, `titleStyle`, `layoutPreference`, `imageDensity`, `mediaPolicy`, `referencePolicy`, `qaStrictness`와 optional `preferredCompositionIds`, `avoidedCompositionIds`, `backgroundRhythm`, `imageTreatment`
- 소유권: `ownerType`은 `system`, `user` 중 하나이며 `ownerId`와 함께 접근 범위를 결정한다.
- 버전: 수정할 때마다 `version`을 증가시키며 생성 요청은 `savedDesignPack: { id, version }`으로 선택 버전을 고정한다.
- 재현성: 생성 결과의 `metadata.designPackSnapshot`에는 최종 적용된 pack 이름, version, base style pack과 preferences를 기록한다.
- Hard Rule 보호: contrast, overflow, safe area, 최소 본문 크기, visible font family 최대 개수는 Saved Design Pack에 저장하지 않으며 platform validator가 항상 적용한다.
- 적용 우선순위: `schema fallback < base Design Pack < Saved Design Pack < Session override < platform Hard Rules`
- 기존 저장 Deck과 imported Deck은 `savedDesignPack`과 `metadata.designPackSnapshot` 없이도 정상 parse된다.

구현 위치:

- `packages/shared/src/deck/saved-design-pack.schema.ts`
- `packages/shared/src/deck/generate-deck.schema.ts`
- `packages/shared/src/deck/deck.schema.ts`

### AI PPT 이미지 asset 계약

`design-pack` 생성에서 `mediaPolicy`가 `ai-generated` 또는 `public-assets`이고 `visualPlan.imageNeeded=true`인 슬라이드만 실제 이미지 asset 후보가 된다.

- `aiNotes.visualPlan.imagePrompt`, `imageAlt`, `imagePlacement`는 선택 필드다. Python content plan의 `mediaIntent`와 `visualIntent.mediaStyle`을 실제 이미지 provider와 최종 image element까지 전달한다.
- 기존 Deck은 세 필드 없이 정상 parse되며, provider는 `imagePrompt`가 없을 때만 slide title과 `reason` 기반 prompt로 fallback한다.

- AI 생성 provider와 공개 이미지 검색 provider는 `@orbit/ai` interface 뒤에 둔다.
- 생성·검색 결과는 MIME, byte size, 공개 이미지 source URL과 license를 검증한 뒤 기존 `StoragePort`에 `design-asset`으로 저장한다.
- `project_assets`에는 provider, source URL, author, license, 확인 시각, 생성 prompt와 비용 scope를 기록한다.
- `program-v2` asset은 원문 페이지 `source_url`과 실제 이미지 `source_asset_url`을 분리하고 `source_authority`, `usage_basis`를 기록한다. `usage_basis = official-reference`는 공식 페이지에서 가져온 참고 이미지라는 뜻이며 재사용 라이선스 보장을 의미하지 않는다.
- Deck의 placeholder는 내부 `/api/v1/projects/:projectId/assets/:fileId/content` URL을 쓰는 editable image element로 교체한다.
- `aiNotes.visualPlan.asset`에는 file ID와 공개 가능한 provenance를 기록한다.
- Editor의 현재 슬라이드 출처 패널은 image asset의 provider, usage basis, author, license, 원문 페이지와 실제 asset URL을 구분해 표시한다.
- provider timeout, 제한된 재시도 실패, deck·user 비용 한도 초과가 발생해도 다른 slide의 asset 해소는 계속한다. unresolved optional asset은 `dropOptionalMediaSlideIds`를 통해 호환 가능한 no-media composition으로 전환하며, placeholder와 blocking issue가 남지 않을 때만 발행한다. required asset 실패, no-media fallback 실패 또는 unresolved placeholder 잔존은 terminal failure다. no-media fallback request 자체의 실패는 `GENERATE_DECK_OPTIONAL_IMAGE_FALLBACK_FAILED` terminal error로 분리한다.
- 기본 한도는 deck 4개, user 일 30개이며 환경변수로 조정한다.
- PPTX export worker는 저장된 내부 image asset을 일시적인 data URL로 hydrate해 Python exporter에 전달한다. 원본 Deck JSON의 내부 URL은 변경하지 않는다.
- Side AI는 구조화 capability 상태를 받아 실제 provider가 사용 가능한 경우에만 실제 이미지 삽입을 안내한다.

구현 위치:

- `packages/ai/src/image-providers.ts`
- `apps/worker/src/generate-deck/asset-resolution.ts`
- `apps/worker/src/image-asset-pipeline.ts`
- `apps/worker/src/deck-export.processor.ts`
- `apps/api/src/database/migrations/2026071103000-AddImageAssetProvenance.ts`

### AI PPT 실제 렌더링 시각 QA 계약

`program-v2`는 asset이 연결된 후보 Deck을 실제 PPTX로 export하고 LibreOffice로 PNG 렌더링한 뒤 Vision QA를 수행한다.

- 내부 endpoint는 `POST /ai/review-deck-visuals`, `POST /ai/repair-deck-visuals`를 사용한다.
- review는 rendered slide PNG와 montage를 기준으로 시각 issue와 허용된 repair action만 반환한다.
- 허용 issue는 `FOCAL_POINT_WEAK`, `BALANCE_WEAK`, `IMAGE_CONTENT_MISMATCH`, `IMAGE_CROP_WEAK`, `LAYOUT_REPETITIVE`, `BACKGROUND_RHYTHM_FLAT`, `CARD_OVERUSED`, `COLOR_HARMONY_WEAK`, `VISUAL_STYLE_INCONSISTENT`다.
- repair는 `changeComposition`, `increaseFocalScale`, `replaceImage`, `changeCrop`, `switchBackgroundMode`, `reduceCards`, `promoteMetric`, `shortenCopy`, `moveSupportingContent`만 허용하며 모델이 Deck JSON을 직접 수정하지 않는다.
- `repair-deck-visuals`는 repair 이후 Deck과 결정론적 `validation`을 함께 반환한다. 선택 이미지가 해소되지 않은 slide는 `dropOptionalMediaSlideIds`로 전달하며, `requiredAsset=false`인 경우에만 호환 가능한 no-media composition으로 재컴파일한다.
- Node Worker는 저장된 image asset을 Vision 검토 요청에만 data URL로 주입하며, 원본 Deck JSON의 project asset URL은 유지한다.
- 시각 검토는 최초 1회와 최대 2회의 bounded repair 후 재검토로 제한한다. repair가 새 이미지 슬롯을 만들면 해당 slide만 asset을 다시 해소한다.
- rendered Visual QA의 모든 issue는 code와 영향 slide 수에 관계없이 advisory이며 Deck 발행을 차단하지 않는다. `program-v2`는 각 image-slide shard에서 Vision QA를 한 번만 수행하고 동기 repair는 하지 않으며, 그 결과를 validation에 보존한다. 마지막 전체 Deck Vision 재검사는 생략한 뒤 이를 `metadata.generationQuality`와 diagnostics로 집계한다. 렌더 또는 Vision provider를 사용할 수 없더라도 구조적으로 유효한 Deck은 `visualQaStatus="unavailable"` warning과 함께 발행한다. unresolved placeholder, schema 위반, 누락된 slide artifact처럼 편집 가능한 Deck 자체를 만들 수 없는 계약 오류는 QA 결과가 아니므로 terminal로 유지한다.
- `AI_PPT_VISUAL_QA_MODEL`이 비어 있으면 `OPENAI_MODEL`을 사용한다. Vision QA를 실행할 수 없으면 `program-v2`를 `recipe-v1`로 fallback하지 않는다.

구현 위치:

- `apps/worker/src/generate-deck/rendered-visual-quality.ts`
- `services/python-worker/app/ai/visual_qa.py`

### AI PPT Content/Fact QA 내부 계약

- `content-planning`은 별도 stage나 선행 LLM 호출을 추가하지 않고 기존 Story 응답에서 내부 `criticalFacts`, `evidenceObligations`, `communicationContract`를 함께 받는다. 이 필드는 Python planning artifact 내부 계약이며 공개 Deck/API schema를 확장하지 않는다. Story 전체 구성은 계속 grounded source chunk를 사용한다.
- Typed Critical Fact `kind`는 `identifier`, `product-name`, `amount`, `date`, `actor-relation`, `metric`, `condition`, `required-phrase`다. 금액·지표는 값과 단위, 승인 관계는 actor 집합과 공동 여부, 조건은 부정·예외·비교값·기한을 로컬에서 비교한다. 모든 kind의 불일치·누락은 같은 repair 우선순위 계층으로 취급한다.
- 임의 분야의 핵심 주장·제약·예외는 `domain-claim` Evidence Obligation으로 보존한다. `evidenceText`가 지정 `sourceRefs`에 없으면 obligation을 제거하고 `EVIDENCE_OBLIGATION_SOURCE_INVALID` advisory를 남긴다. `obligationRefs`와 기존 `sourceRefs`·`aiNotes.sourceLedger`가 최종 slide를 연결한다.
- Story 검증 후 repair 가능 order는 위험도 기준 최대 3개로 고정한다. 우선순위는 user-required/placement/forbidden claim, 모든 Typed Critical Fact, decision-critical, source-emphasized 순이다. Story batch repair와 각 image-slide detail repair는 각각 최대 한 번이며 title/message/slideType/sourceRefs/obligationRefs 또는 해당 slide detail만 변경한다.
- image-slide는 detail 생성, Content/Fact 검증·선택적 repair, assembly, asset resolution, Semantic/Vision QA 순서다. 따라서 Content/Fact repair는 이미지 provider보다 먼저 끝나며 이미지를 재생성하지 않는다.
- `FACT_REQUIRED_MISSING`, `FACT_PLACEMENT_MISMATCH`, `FACT_AMOUNT_MISMATCH`, `FACT_APPROVAL_RELATION_MISMATCH`, `FACT_EXACT_PHRASE_MISMATCH`, `FACT_FORBIDDEN_CLAIM`, `EVIDENCE_OBLIGATION_MISSING`, `EVIDENCE_OBLIGATION_DISTORTED`, `EVIDENCE_OBLIGATION_SOURCE_INVALID`는 모두 `blocking=false`인 `contentIssues`다. 한 번 repair 후 남은 이슈도 publication을 막지 않고 `metadata.generationQuality`로 집계되어 Editor AI 코치에서 해당 slide에만 표시된다. schema·artifact·필수 asset 같은 구조 오류의 기존 terminal 계약은 유지한다.
- 빠른 cover는 주제만으로 먼저 공개한다. 최종 1번 artifact 승격 시 명시적인 `cover.title`·`cover.subtitle` placement만 기존 text element와 sourceLedger에 반영하며 추가 LLM·이미지 호출을 하지 않는다.
- 구조화된 본문은 기존 editable composition을 우선한다. 프로세스는 `process-horizontal`, 로드맵·일정은 `timeline`, 아키텍처는 `diagram-hub`, 지표·예산은 `metric-poster` 또는 `kpi-strip-evidence`, 비교는 `feature-comparison`을 사용하고 해당 slide의 `requiredAsset`은 false다.
- `ai-ppt.fact-validation.completed`, `ai-ppt.fact-repair.attempted` 업무 이벤트에는 duration, issue code, slide order, repair 수와 성공 여부만 기록하며 source/OCR/prompt/provider response/발표 메모 원문을 기록하지 않는다.

### AI PPT 기본 의미 기반 QA 계약

`metadata.presentationProfile`이 있는 `design-pack` Deck은 Worker 저장 전과 Editor AI 검증에서 같은 shared semantic QA를 사용한다. legacy/import Deck에는 적용하지 않는다.

- issue code: `SLIDE_MESSAGE_MULTIPLE`, `NARRATIVE_FLOW_WEAK`, `EVIDENCE_MISMATCH`, `IMAGE_RELEVANCE_WEAK`, `IMAGE_LICENSE_MISSING`
- Worker는 다중 핵심 메시지와 이미지 대체 텍스트 관련 항목만 결정론적으로 최대 1회 보정한 뒤 전체 issue를 다시 계산한다.
- 이미지 관련성은 `role=media`인 실제 본문 이미지에만 적용한다.
- 공개 이미지는 `aiNotes.visualPlan.asset`의 원본 URL과 license가 없으면 `IMAGE_LICENSE_MISSING`을 남긴다.
- semantic issue는 모두 `severity=warning`, `blocking=false`다. Deck 저장은 허용하지만 하나라도 남으면 `validation.passed=false`이며 Worker와 Editor가 같은 code를 표시한다.

구현 위치:

- `packages/shared/src/deck/semantic-qa.ts`
- `apps/worker/src/generate-deck/semantic-quality.ts`
- `apps/web/src/features/editor/ai/quality/editorValidation.ts`

## AI template deck generation historical contract

#339 PR 3부터 신규 `ai-template-deck-generation` Job 생성을 중단했고, PR 4에서 남은 API tombstone, request/result schema, queue/job constant, consumer, processor를 제거한다. 제거 대상 historical endpoint는 `POST /api/v1/projects/:projectId/jobs/ai-template-deck-generation`이며 controller와 module이 없으므로 `404`다.

`historicalJobTypeSchema`, `jobTypeSchema`, `jobSchema`는 `ai-template-deck-generation` 과거 row와 generic `result`를 계속 읽는다. `activeJobTypeSchema`와 `publicCreatableJobTypeSchema`는 이 type을 거부하고, `packages/job-queue`와 Worker에는 해당 runtime dispatch가 없다.

신규 AI PPT 생성은 `/createdeck`의 `generate-deck` `program-v2` 경로만 사용한다. `TemplateBlueprint`, `template_blueprints` 테이블, `purpose: "pptx-import"`, Python `/design/import-pptx`, PPTX OOXML generation/sync/export 경로는 활성 PPTX round-trip 계약이므로 이 레거시 제거 범위에 포함하지 않는다.

PR 4의 personal staging 자동 배포는 완료됐다. #339 종료 전 배포 환경의 `ai-template-deck-generation` queue와 관련 DB에 queued/running 잔여 Job이 0인지 읽기 전용으로 확인해야 한다.

## AI PPT 2차 Design-Pack 계약 메모

- `/createdeck` 요청은 선택적으로 `design.fontOverride`, 확장된 `design.mediaPolicy`, `design.referencePolicy`, `visualPlanPolicy`, `referencePolicy`, `references`, `referenceFileIds`, `referenceKeywords`, `referenceContext`, `officialAssetFileIds`를 보낼 수 있다. `officialAssetFileIds`는 일반 참고 자료와 분리된 사용자 제공 공식 이미지를 가리킨다. selector field 없이 모든 요청을 내부 `design-pack + program-v2` 경로로 실행한다.
- generated slide의 `aiNotes`는 `visualPlan`과 `sourceLedger`를 포함할 수 있다. 이는 검토/추적용 메타데이터이며, 최종 디자인 표현은 계속 `theme`, `slide.style`, `slide.elements`, chart props, `animations`가 담당한다.
- validation issue는 `{ code, scope, severity, blocking, path, message }` 구조를 사용한다. 기존 응답의 호환성을 위해 `code`, `severity`, `blocking`은 기본값을 허용하지만 새 design-pack 결과는 모든 필드를 명시한다.
- validation issue가 하나라도 있으면 `validation.passed`는 `false`다. repair 이후에도 blocking issue가 남으면 job을 실패시키고 Deck을 저장하지 않으며, non-blocking issue만 남으면 job은 성공하고 해당 issue를 `validation`에 노출한다. validation issue 전체를 `warnings`에 일괄 중복하지 않는다. Python diagnostics가 명시적으로 승격한 issue·summary와 validation과 독립적으로 생성된 generation/provider/repair warning만 `warnings`에 기록한다.
- Source Ledger의 `sourceType`은 `topic`, `uploaded`, `web`, `generated`, `none`을 허용한다. `sourceId`, `fileId`, `chunkId`, `url`, `title`은 provenance를 식별하기 위한 선택 필드다.
- Side AI는 로그인 사용자가 프로젝트 생성 전에 호출하는 `POST /api/v1/ai/ppt-advisor`를 사용한다. 질문과 대화 항목은 각각 최대 1,000자이고 최근 대화는 최대 6개만 전달한다.
- Side AI suggestion은 `duration`, `slides`, `tone`, `colorMood`, `fontMood`, `mediaPolicy`, `referencePolicy`의 discriminated union으로 검증한다. 응답은 최대 3개 suggestion을 반환하며 사용자가 적용 버튼을 누르기 전에는 wizard 값을 바꾸지 않는다.
- Side AI provider 호출 제한은 15초다. provider 미설정, timeout, 잘못된 응답이면 동일 response schema의 rule-based fallback을 반환하며 질문과 대화 원문은 서버 로그에 기록하지 않는다.
- generate-deck 응답과 Job result의 `diagnostics`에는 `referencePolicy`, `uploadedSourceCount`, `webSourceCount`, `researchAttempts`, `relevantWebSourceCount`, `officialWebSourceCount`, `independentWebSourceCount`, `researchQuality`, `researchIssueCodes`, `researchFactCoverageSatisfied`, `repairAttempted`, `repairReasons`, `uniqueCoreLayoutCount`, `validationIssueCount`, `warningCodes`를 저장한다. `researchQuality`는 `not-run | complete | partial | unavailable`이며 기본값은 `not-run`이다. `researchIssueCodes`는 `provider-unavailable | provider-call-failed | no-citations | vetting-failed | official-missing | independent-missing | fact-coverage`만 허용하고 기본값은 `[]`다. 출처 수의 기본값은 `0`, `researchFactCoverageSatisfied`의 기본값은 `false`다. `warningCodes`는 `^[A-Z][A-Z0-9_]*$` machine-readable code 배열이며 기본값은 `[]`다. rendered QA를 실행한 경우 `visualQaStatus`, `visualReviewAttempts`, `visualRepairAttempts`, `visualIssueCodes`, `visualIssueSlideOrders`를 추가할 수 있고 `visualQaStatus`는 `not-run | passed | advisory | failed | unavailable`을 허용한다. TypeScript Zod와 Python Pydantic mirror는 같은 값을 검증한다. 참고자료 원문, 검색 결과 원문, 발표 대본은 진단 정보에 포함하지 않는다. degraded research는 `WEB_RESEARCH_QUALITY_FAILED`, degraded reference chunk 검색은 `REFERENCE_CHUNK_RETRIEVAL_DEGRADED`, advisory publication은 `GENERATE_DECK_VISUAL_ADVISORY`, Visual QA unavailable degraded publication은 `GENERATE_DECK_VISUAL_QA_UNAVAILABLE`을 실제 emit한다.
- `diagnostics.repairReasons`는 장수 부족, 구조적 내용 중복, 출처에 없는 수치 주장을 각각 `SLIDE_COUNT_SHORT`, `CONTENT_DUPLICATED`, `UNSUPPORTED_NUMERIC_CLAIM`으로 기록할 수 있다.
- 참고자료 추출 시작점은 인증된 `POST /api/v1/projects/:projectId/references/extractions`다. 요청은 `{ fileIds: string[] }`이며 1개 이상 10개 이하의 중복 없는 project asset ID만 허용한다.
- 참고자료 asset은 해당 project 소유, `purpose=reference-material`, `status=uploaded`, 지원 MIME 조건을 모두 충족해야 한다. 추출 결과는 `cleanedText` 또는 `rawText`가 있으면 indexing 실패와 무관하게 generation context로 사용할 수 있다.
- `references-only`는 `selectedReferenceFileIds`가 하나 이상이고 선택한 모든 파일에 usable 추출 문맥이 있어야 하며 웹 검색을 사용하지 않는다. 선택되지 않은 `referenceContext`만으로 이 조건을 대신할 수 없다. `references-first`는 usable 첨부 문맥 1개 이상을 요구하고 웹 검색 실패 시 warning과 함께 첨부 문맥으로 계속한다.
- `research-first`는 OpenAI Responses `web_search`를 최초 1회와 최대 2회의 bounded retry로 덱당 최대 3회 실행하고 공식·독립 출처와 핵심 사실 충족을 목표로 한다. 기준을 모두 충족하면 `complete`, 검증된 관련 URL source가 하나 이상이면 가장 품질이 높은 source 집합을 보존해 `partial`, 검증 source가 없거나 provider를 사용할 수 없으면 `unavailable`이다. `partial`은 보존한 source가 직접 지원하는 사실만 사용하고, `unavailable`은 topic·prompt·Brief를 사용자 제공 framing으로만 사용하며 외부 날짜·수치·제품 출시 상태·플랫폼·기능을 생성하지 않는다. `partial | unavailable`에 usable grounding 또는 topic·prompt·Brief 사용자 입력이 있으면 `WEB_RESEARCH_QUALITY_FAILED` warning/degraded success로 계속하고, usable 입력이 전혀 없는 strict policy만 `SOURCE_GROUNDING_REQUIRED` terminal failure다. 검색 질의는 topic, Brief, 추출 keyword만 사용하며 첨부 원문, 파일명, speaker notes를 포함하지 않는다.
- Worker는 research 실행 결과가 `not-run`이 아닐 때 `ai-ppt.web-research.completed` 업무 이벤트에 등급, limitation code, 시도 횟수, 관련·공식·독립 출처 수, 핵심 사실 충족 여부만 기록한다. URL, 검색 결과 원문, 사용자 입력은 기록하지 않는다.
- `/createdeck`은 `researchQuality=complete` 결과를 기존처럼 에디터로 이동시키고, `partial | unavailable` 결과에는 제한 사유와 공식·독립 출처 수를 표시한 뒤 `에디터에서 계속`, `주제 수정`, `참고자료 추가`를 제공한다. 이전 Worker의 terminal `WEB_RESEARCH_QUALITY_FAILED` 오류 문구 mapping은 유지한다.
- content response는 슬라이드별 `contentItems`와 `sourceRefs`를 사용한다. `sourceRefs`는 worker가 제공한 source ID allowlist 안의 값만 허용하며 존재하지 않는 source ID는 Deck 조립 전에 거부한다.

## program-v2 Hybrid Media Contract

- `program-v2`의 `hybrid` media는 실제 asset 3~5개 안에 official evidence 1개 이상과 AI-generated atmosphere 1개 이상을 포함해야 한다.
- 같은 `sourceAssetUrl` 또는 `fileId`를 여러 media slide에서 반복하면 `MEDIA_ASSET_DUPLICATED`를 `validation.designIssues`의 `severity="warning"`, `blocking=false` issue로 기록한다. 다른 blocking issue나 unresolved placeholder가 없으면 발행은 계속한다.
