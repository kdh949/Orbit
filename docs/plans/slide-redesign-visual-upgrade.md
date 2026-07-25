# 슬라이드 리디자인 시각 품질 고도화 실행 계획

작성일: 2026-07-21
범위: 에디터 AI 챗봇의 `redesign-slide` 인텐트 (현재 슬라이드 1장)

> **이 문서는 배경과 아키텍처 판단만 유효하다.** 실행 계획은 `docs/plans/slide-redesign-implementation.md` (v3)를 따른다.
> 아래 §3의 Phase 구성과 §4 일정은 v3에서 대체되었다. 특히 다음은 v3 기준이 맞다.
> - 미디어 필터: M1은 `required`만 제외(후보 14개), M2(PR8~)는 전부 허용(19개)
> - chart/table 포함 슬라이드는 폴백이 아니라 **변경 거부**(`refused-unsafe`)
> - 사용자가 넣은 image는 거부가 아니라 **미디어 슬롯으로 재배치**(PR8)
> - 벡터 요소는 `icon-map.json`이 아니라 **기본 도형 조합**으로 만든다 — 해당 파일은 14개짜리 미사용 자산
> - 이미지·배경 생성, 배색 3안 선택, 비동기 진행표시는 **MVP에 포함**(PR7~PR11)
> - 일정 7.5일 → **M1 10일 + M2 11.5일 = 21.5일**

---

## 1. 진단: 왜 지금은 "요약"만 나오는가

문제는 모델 성능이 아니라 **계약(contract) 제약**이다. Orbit에는 이미 두 개의 디자인 엔진이 있는데, 좋은 쪽이 챗봇에 연결되어 있지 않다.

### 엔진 A — 덱 생성 파이프라인 (강력함, 챗봇에서 사용 불가)

| 모듈 | 역할 |
| --- | --- |
| `services/python-worker/app/ai/design_program.py` | 아트디렉터 LLM. `paletteRoles`, `typography`, `backgroundSequence`, `imageStyle` 결정 |
| `services/python-worker/app/ai/composition_library.py` (3,011줄) | **19개 컴포지션 레시피**. `hero-split`, `hero-full-bleed`, `editorial-split`, `statement-poster`, `metric-poster`, `kpi-strip-evidence`, `image-evidence`, `feature-comparison`, `process-horizontal`, `timeline`, `diagram-hub`, `cta-closing`, 커버 6종. 각각 `light`/`dark`/`image` 변형과 `mediaRequirement`를 가짐 |
| `services/python-worker/app/ai/color_options.py` | 무드 기반 팔레트 생성 + `contrast_ratio()`, `accessible_text_color()` 접근성 보정 |
| `services/python-worker/app/ai/design_library/style-packs/*.json` | 5종 스타일팩 (테마·이펙트·카드·배지 토큰) |
| `apps/worker/src/image-asset-pipeline.ts` | `resolveDeckImageAssets()`, `replaceSlideImagePlaceholder()`. gpt-image-1 / Openverse / 업로드 자산으로 미디어 플레이스홀더를 실제 이미지로 교체. 일일 예산 가드 포함 |
| `services/python-worker/app/ai/visual_qa.py` | 렌더 후 시각 검사 + 자동 수리 |

### 엔진 B — 챗봇 design-agent (빈약함, 현재 사용 중)

`services/python-worker/app/ai/design_agent.py`

```python
# packages/shared/src/deck/design-agent.schema.ts
canGenerateImages: false                                  # ← 이미지 생성 원천 차단
addableElementTypes: ["text", "rect", "chart", "table"]   # ← image/svg/ellipse 추가 불가
```

```python
# design_agent.py — _slide_style_operation_json_schema()
"fontFamily", "backgroundColor", "textColor", "accentColor"
# ← backgroundImage, layout이 JSON schema에서 누락. patch.schema.ts는 이미 지원하는데도 LLM이 낼 수 없음
```

그리고 "예쁘게 해줘" 같은 광범위 요청은 `_build_deterministic_preset_proposal()`로 라우팅되는데, 이 함수가 참조하는 프리셋은 `design_library/slide-presets/`의 **JSON 4개뿐**이고 내용은 SmartArt 힌트에 불과하다.

```json
{ "id": "metric-cards-3", "intent": "metrics", "cardCount": 3, "layout": "two-column", "maxElements": 28 }
```

→ 결과적으로 "리디자인"이 **텍스트를 박스에 나눠 담는 SmartArt 변환**이 되고, 사용자에겐 "요약해준 것"으로 보인다.

### 추가 발견: 이미지 기능은 이미 있으나 분리되어 있음

`design-image-generation` Job, `DesignImageGenerationService`, `image-asset-pipeline.ts`가 이미 동작한다. 다만 `AiChatPanel.tsx`에서 **`design` 모드와 `image` 모드가 분리된 별개 경로**다. 사용자가 직접 이미지 모드로 전환 → 프롬프트 입력 → 대기 → "슬라이드에 추가" 클릭해야 한다. 디자인 에이전트가 스스로 "여기엔 배경 이미지가 필요하다"고 판단해 호출할 수 없다.

> **결론: 새로 만들 게 아니라, 엔진 A를 단일 슬라이드용으로 재진입시키는 것이 핵심 작업이다.**

---

## 2. 목표 아키텍처

```
사용자: "이 슬라이드 예쁘게 만들어줘"
   │
   ▼
[POST /design-agent/redesign] → Job 생성 (slide-redesign), 즉시 202 반환
   │
   ├─ Stage 1  슬라이드 해석      Slide.elements → SlidePlan summary   ★신규
   ├─ Stage 2  구성 선택          후보 컴포지션 필터 → LLM이 1개 선택   ↺재사용
   ├─ Stage 3  배색 결정          color_options + 접근성 보정          ↺재사용
   │           └─▶ 여기서 1차 프리뷰 전송 (플레이스홀더 상태, ~2초)
   ├─ Stage 4  이미지 채우기      벡터 → 그라디언트 → Openverse → AI    ↺재사용
   ├─ Stage 5  검증              visual_qa 단일 슬라이드 모드          ↺재사용
   └─▶ 최종 proposal 전송 → 사용자 적용 (undo 1회로 복구)
```

★ 표시 = 신규 개발. 나머지는 기존 모듈 재사용.

---

## 3. 단계별 구현

### Phase 0 — 계약 확장 (0.5일)

기존 계약을 **수정하지 않고 추가만** 한다 (`AGENTS.md`: 공통 계약 우선).

**`packages/shared/src/deck/design-agent.schema.ts`**

```ts
export const designAgentCapabilities = designAgentCapabilitiesSchema.parse({
  version: "2",
  // ...
  addableElementTypes: ["text", "rect", "ellipse", "line", "image", "svg", "chart", "table"],
  canGenerateImages: true,
});
```

**`services/python-worker/app/ai/design_agent.py`** — `_slide_style_operation_json_schema()`에 `backgroundImage`, `layout` 추가. `patch.schema.ts`의 `slideStylePatchSchema`가 이미 두 필드를 받으므로 API 쪽 변경은 불필요.

**`packages/shared/src/jobs/job.schema.ts`** — `historicalJobTypeSchema`에만 `"slide-redesign"` 추가한다. `publicCreatableJobTypeSchema`에는 넣지 않는다 — 기존 `design-image-generation`과 동일하게, 범용 Job 생성 엔드포인트가 아니라 design-agent 전용 엔드포인트로만 생성되어야 한다 (`DesignImageGenerationService`가 선례).

**신규 `packages/shared/src/deck/slide-redesign.schema.ts`**

```ts
export const slideRedesignStageSchema = z.enum([
  "interpreting", "composing", "coloring", "illustrating", "verifying",
]);

export const slideRedesignPlanSchema = z.object({
  compositionId: z.string().min(1),
  backgroundMode: z.enum(["light", "dark", "image"]),
  palette: z.object({
    dominant: themeColorSchema, surface: themeColorSchema, text: themeColorSchema,
    focal: themeColorSchema, secondary: themeColorSchema,
  }),
  mediaSlots: z.array(z.object({
    elementId: deckElementIdSchema,
    assetRole: z.enum(["evidence", "atmosphere", "decoration", "none"]),
    prompt: z.string().max(2_000),
    source: z.enum(["vector", "gradient", "public-search", "ai-generated"]),
  })).max(3).default([]),
  rationale: z.string().max(1_000),
});
```

`designAgentProposalSchema`에 `redesignPlan: slideRedesignPlanSchema.optional()` 추가 (optional이므로 기존 프로포절과 호환).

---

### Phase 1 — 역어댑터: Slide → SlidePlan (2일, ★신규·최중요)

`composition_library.compile_composition()`은 `SlidePlan`에서 파생된 summary dict를 입력으로 받는다. 하지만 리디자인은 **이미 존재하는 `Slide`(요소 배열)**에서 출발한다. 이 방향의 어댑터가 지금 없고, 이게 유일한 진짜 신규 코드다.

**신규 `services/python-worker/app/ai/slide_redesign/slide_extractor.py`**

```python
def extract_slide_summary(slide: dict[str, Any], theme: dict) -> dict[str, Any]:
    """Deck Slide → program_v2_slide_summary()와 동일한 형태의 dict"""
    return {
        "title": ...,          # role == "title" 우선, 없으면 최상단·최대 폰트 텍스트
        "message": ...,        # role == "message" 또는 두 번째 위계 텍스트
        "contentItems": [...], # 나머지 텍스트를 y좌표 → x좌표 순으로 정렬
        "slideType": ...,      # 아래 분류 참조
        "visualIntent": {...},
        "mediaIntent": {...},
    }
```

위계 추론 규칙 (LLM 호출 없이 결정론적으로):

1. `element.role` (`title` / `message` / `body` / `caption`)이 있으면 최우선
2. 없으면 `props.fontSize` 내림차순 → 동률이면 `frame.y` 오름차순
3. 읽기 순서는 `y` 밴드로 묶은 뒤 각 밴드 내 `x` 오름차순
4. 불릿/번호 텍스트는 개별 `contentItem`으로 분할

`slideType` 분류는 LLM 1회 호출 (저렴한 모델). `cover` / `problem` / `solution` / `feature-grid` / `process` / `architecture` / `data` / `chart` / `comparison` / `quote` / `summary` 중 택1. 기존 `design_agent._extract_preset_items()`의 항목 추출 로직을 그대로 재활용할 수 있다.

**보존 대상 (반드시 유지):** `keywords`, `semanticCues`, `animations`, `actions`, `speakerNotes`. 이들은 `elementId`를 참조하므로 Phase 3의 ID 매핑 테이블에 의존한다.

---

### Phase 2 — 구성 선택 + 배색 (1.5일, 대부분 재사용)

**후보 필터링** — LLM에게 좌표를 맡기지 않고 프리셋을 강제한다.

```python
from app.ai.composition_library import COMPOSITION_SPECS, content_supports_composition

item_count = len(summary["contentItems"])
candidates = [
    spec.composition_id
    for spec in COMPOSITION_SPECS.values()
    if summary["slideType"] in spec.purposes
    and spec.min_items <= item_count <= spec.max_items
    # 숫자 포함 여부 등 콘텐츠 조건까지 검사 (kpi-strip-evidence, metric-poster 등)
    and content_supports_composition(spec.composition_id, summary)
]
```

**LLM의 역할은 선택뿐이다.** 후보 목록(보통 3~6개)을 주고 `compositionId`, `backgroundMode`, `assetRole`, `rationale`만 고르게 한다. 좌표·크기·zIndex는 `compile_composition()`이 결정론적으로 계산한다. → 결과 편차가 사라지고, 항상 그리드·세이프에어리어를 지킨다.

**배색** — `color_options.py` 재사용.

```python
palette = customize_deck_color_palette(request)   # 기존 테마를 시드로
palette = ensure_accessible_options([palette])[0] # WCAG 대비 강제
```

덱 테마와 완전히 어긋나지 않도록 `color_role_distance()` (design_planning.py:801)로 기존 accent와의 거리를 제한한다.

**컴파일**

```python
compiled = compile_composition(direction, summary, program)
# → CompiledComposition(elements, primary_focal_element_id, layout, background_color)
```

> **제약 확인 필요:** `composition_library.py`는 `CANVAS_WIDTH = 1920` / `CANVAS_HEIGHT = 1080` 하드코딩이다. 덱 캔버스는 `wide-16-9`(1920×1080)와 `standard-4-3`(1024×768) 두 종류다. **1차 릴리스는 16:9 덱만 지원**하고, 4:3은 기존 자유 배치 경로로 폴백시킨다. (좌표 스케일 어댑터는 후속 과제)

---

### Phase 3 — Diff → Patch Operations (1.5일, ★신규)

`compile_composition()`은 새 `elementId`(`el_{order}_program_v2_{name}`)를 가진 요소 배열을 낸다. 이걸 그대로 적용하면 기존 요소를 전부 지우고 새로 만드는 셈이라 **애니메이션·시맨틱큐·키워드가 전부 끊긴다.**

**매칭 전략** (신규 `slide_redesign/diff.py`)

1. 텍스트 요소: 정규화 문자열 완전 일치 → 부분 일치 → 위계(role) 일치 순으로 기존 `elementId`에 매핑
2. 매핑된 요소 → `update_element_frame` + `update_element_props` (**ID 유지**)
3. 매핑 안 된 신규 요소 → `add_element`
4. 남은 기존 요소 → `delete_element`
5. 배경 → `update_slide_style` (`backgroundColor` 또는 `backgroundImage`)

`delete_element` 대상이 애니메이션/시맨틱큐에 참조되어 있으면 `warnings`에 명시한다. 기존 `design-agent.service.ts:143`의 SmartArt 중복 타겟 검증 로직과 동일한 패턴을 쓴다.

**적용은 기존 경로 그대로:** `applyDesignAgentProposal` → `deckChangeRecord` 1건 → undo 1회로 전체 복구. 신규 트랜잭션 로직 불필요.

---

### Phase 4 — 이미지 채우기 (2일, 대부분 재사용)

`compile_composition()`의 `_media()`는 `*_media_placeholder` rect + 캡션을 만든다. 이걸 실제 이미지로 교체한다.

**소스 우선순위 — `assetRole` 기반 라우팅**

| assetRole | 소스 | 근거 |
| --- | --- | --- |
| `decoration` | 벡터 도형 / 아이콘 (`design_library/icon-map.json`) | 비용 0, 지연 0, 실패 없음 |
| `atmosphere` | AI 생성 배경·그라디언트 (gpt-image-1) | 사실성 불필요, 리스크 최저 |
| `evidence` | Openverse 검색 → 업로드 공식 자산 | 사실과 다른 이미지를 만들면 안 됨 |
| (커버 등 임팩트) | gpt-image-1 전체 생성 | 슬라이드당 최대 1장 |

**핵심: 기본값은 벡터·아이콘이다.** 체감 "예쁨"의 대부분은 여백·정렬·대비·타이포에서 나오고, 이건 Phase 2에서 이미 해결된다. AI 이미지는 비용·지연·실패 위험이 있으므로 컴포지션이 `mediaRequirement: "required"`일 때만 호출한다.

**재사용 지점** — `apps/worker/src/image-asset-pipeline.ts`

```ts
export async function resolveSlideImageAssets(   // 신규 export, 기존 함수 재사용
  deck: Deck, slideId: DeckSlideId, runtime: ImageAssetRuntime, scope: ImageAssetScope
)
// 내부에서 기존 replaceSlideImagePlaceholder(), storeImageAsset(),
// remainingDailyBudget(), classifyImageAssetError() 그대로 호출
```

**예산·실패 정책**

- `remainingDailyBudget()` 기존 가드 사용. 초과 시 벡터 폴백 + `warnings` 안내
- 이미지 생성 실패 = 리디자인 실패 아님. 플레이스홀더를 스타일된 도형으로 대체하고 proposal은 그대로 전달
- 슬라이드당 AI 이미지 최대 1장, 참조 이미지 최대 3장 (기존 스키마 제한)

---

### Phase 5 — 품질 검증 + 폴백 (1일)

```
compile_composition() 성공
   └─▶ 프리셋 결과 채택
CompositionCompileError (항목 수 불일치, 4:3 캔버스, 변형 미지원 등)
   └─▶ 기존 LLM 자유 배치 경로로 폴백  ← 지금 코드 그대로 유지
        └─▶ visual_qa.review_deck_visuals() 단일 슬라이드 모드로 검사
             └─▶ 이슈 발견 시 자동 수리 1회, 그래도 실패하면 warnings와 함께 전달
```

두 경로 모두 최종적으로 `validate_design_proposal()`을 통과해야 한다 (캔버스 이탈, 프레임 유효성, locked 요소 정책 검사 — 기존 코드).

**테스트**

- 골든 픽스처: 슬라이드 20종 × 컴포지션 컴파일 결과 스냅샷
- `slide_extractor` 단위 테스트: 위계 추론이 role 없는 슬라이드에서도 동작하는지
- diff 테스트: 애니메이션이 걸린 요소의 elementId가 보존되는지
- E2E: 리디자인 → 적용 → undo 1회 → 원본 완전 복구

---

### Phase 6 — 비동기 Job + UX (2일)

**진행 단계 노출** — `RUNNING` 중 WebSocket으로 stage 전송 (공통 envelope 사용: `roomId`, `sessionId`, `userId`, `payload`, `sentAt`)

```
슬라이드를 읽는 중          (~0.5s)
구성을 고르는 중            (~1.5s)
배색을 맞추는 중            (~0.5s)   ──▶ 1차 프리뷰 전송
이미지를 만드는 중          (~10-25s)
마무리 검토 중              (~2s)     ──▶ 최종 프리뷰
```

**2단계 프리뷰** — 배색까지 끝난 시점(~2.5초)에 플레이스홀더 상태의 proposal을 먼저 보낸다. 사용자는 레이아웃·색을 바로 보고, 이미지는 완성되면 교체된다. 체감 속도가 크게 달라진다.

**stale 처리** — Job 진행 중 사용자가 슬라이드를 편집하면 `baseVersion`이 밀린다. `designAgentProposalStatusSchema`에 이미 `stale`이 있으므로, Job 완료 시 `baseVersion`을 재확인하고 불일치 시 `stale` 처리 후 "슬라이드가 변경되어 다시 시도해야 합니다" 안내.

**UI 재사용** — `AiChatPanel`의 `DesignProposalPreview`(before/after diff)를 그대로 쓴다. `design` / `image` 모드 분리는 유지하되, `design` 모드가 필요 시 내부적으로 이미지 생성을 호출하게 된다.

---

## 4. 일정 요약

| Phase | 내용 | 기간 | 신규 코드 비중 |
| --- | --- | --- | --- |
| 0 | 계약 확장 | 0.5일 | 낮음 |
| 1 | 역어댑터 Slide → SlidePlan | 2일 | **높음** |
| 2 | 구성 선택 + 배색 | 1.5일 | 낮음 (재사용) |
| 3 | Diff → Patch | 1.5일 | **높음** |
| 4 | 이미지 채우기 | 2일 | 낮음 (재사용) |
| 5 | 검증 + 폴백 | 1일 | 중간 |
| 6 | 비동기 Job + UX | 2일 | 중간 |
| | **합계** | **10.5일** | |

**최소 기능 데모(MVP)는 Phase 0~3 + 5로 5.5일.** 이미지 없이 컴포지션·배색만 바꿔도 현재 SmartArt 변환 대비 체감 품질 차이가 가장 크다. Phase 4(이미지)는 그 위에 얹는 게 안전하다.

---

## 5. 주요 리스크

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| **elementId 매핑 실패** | 애니메이션·시맨틱큐·키워드 유실 | Phase 3 매핑 테이블 필수. 참조 끊김 시 `warnings` 명시. E2E에서 undo 복구 검증 |
| **4:3 캔버스 미지원** | `standard-4-3` 덱에서 컴파일 불가 | 1차 릴리스는 16:9 한정, 4:3은 자유 배치 폴백. 좌표 스케일 어댑터는 후속 |
| **AI 이미지 비용** | gpt-image-1 장당 과금 | `remainingDailyBudget()` 가드 + 슬라이드당 1장 제한 + `mediaRequirement: required`일 때만 호출 |
| **지연 시간** | 이미지 포함 시 20~30초 | 2단계 프리뷰로 체감 완화. 이미지 타임아웃 시 벡터 폴백 |
| **baseVersion 충돌** | 적용 시점에 stale | 기존 `stale` 상태값 활용, Job 완료 시 재검증 |
| **덱 톤 불일치** | 슬라이드 1장만 튀어 보임 | `color_role_distance()`로 기존 테마와의 거리 제한. 후속으로 "덱 전체 적용" 버튼 검토 |

---

## 6. 후속 과제 (범위 밖)

- 덱 전체 일괄 리디자인 (Job 배치 + 대량 프리뷰 UI)
- `composition_library` 캔버스 비율 일반화 (4:3, 세로형)
- 사용자 브랜드 컬러·로고 주입
- 리디자인 결과 A/B 제시 (컴포지션 2안 동시 컴파일)

---

## 7. 참고 파일

| 경로 | 비고 |
| --- | --- |
| `services/python-worker/app/ai/design_agent.py` | 현행 챗봇 에이전트. capabilities·JSON schema 수정 대상 |
| `services/python-worker/app/ai/composition_library.py` | 19개 컴포지션 레시피. 재사용 핵심 |
| `services/python-worker/app/ai/design_program.py` | `SlideCompositionDirection`, `DeckDesignProgram` |
| `services/python-worker/app/ai/color_options.py` | 팔레트 생성·접근성 보정 |
| `services/python-worker/app/ai/deck_generation/design_planning.py` | `program_v2_slide_summary()` — 어댑터 출력 형태의 기준 |
| `services/python-worker/app/ai/deck_generation/layout_compiler.py` | `assemble_program_v2_slide()` — 조립 참고 |
| `services/python-worker/app/ai/visual_qa.py` | 렌더 검사·수리 |
| `apps/worker/src/image-asset-pipeline.ts` | 이미지 해석 파이프라인 |
| `apps/api/src/design-agent/design-agent.service.ts` | 프로포절 생성·적용 |
| `apps/web/src/features/editor/shell/components/AiChatPanel.tsx` | 챗봇 UI |
| `packages/shared/src/deck/design-agent.schema.ts` | 계약 |
| `packages/shared/src/deck/patch.schema.ts` | `slideStylePatchSchema`가 이미 `backgroundImage` 지원 |
| `docs/contracts.md` | 공통 계약 문서 (변경 시 동반 수정) |
