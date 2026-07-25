# 슬라이드 리디자인 구현 계획 (에이전트 실행용) — v3

작성일: 2026-07-21 (v3 개정)
상위 문서: `docs/plans/slide-redesign-visual-upgrade.md` (배경·아키텍처 판단)
범위: **MVP = PR0~PR11.** 재배치 + 장식 도형 + 이미지·배경 생성 + 배색 선택 + 비동기 진행표시.

> **v2 대비 변경 (v3)** — 원래 요구사항이 "재배치 + AI 이미지·요소·배경 생성 + 색감 선택"이었는데
> v2 MVP는 재배치만 담고 있었다. 나머지를 MVP 안으로 들여왔다.
> 1. PR7 신설 — 기본 도형 조합 장식 (`ellipse`/`line`/`polygon`)
> 2. PR8 신설 — 사용자 기존 이미지를 새 레이아웃 미디어 슬롯으로 재배치
> 3. PR9 신설 — AI 이미지·배경 생성 (gpt-image-1 / Openverse)
> 4. PR10 신설 — 배색안 3개 제시 후 사용자 선택
> 5. PR11 신설 — 비동기 Job + 단계별 진행표시 + 2단계 프리뷰
> 6. D4 개정 — `required` 컴포지션도 허용 (PR8 이후)
> 7. D6 개정 — 동기 응답 → 비동기 Job (PR11)
> 8. §3.2 개정 — capability version은 **PR7에서 "2"로 올린다** (v2의 "동결"은 PR0~PR6 구간에만 유효)

> **v1 대비 변경 (v2)** — 두 차례 설계 리뷰에서 발견된 데이터 보존 결함을 반영했다.
> 1. `None` 반환이 fail-closed가 아니었다 → 3분기 결과 타입 도입 (§2)
> 2. bullet split이 원본 기준 1:N을 만든다 → segment provenance 도입 (PR2, PR4)
> 3. chart/table이 조용히 삭제될 수 있었다 → PR0 요소 정책 신설
> 4. `ElementPropsPatch.font_weight` 누락 → PR1에 추가
> 5. `mediaRequirement == "none"` 필터가 과했다 → `required`만 제외
> 6. 안전성 검사가 LLM 선택 이후였다 → 선택 **이전**으로 이동

## 출시 구간

MVP는 하나지만 내부적으로 두 구간으로 나뉜다. **PR6 종료 시점이 독립 출시 가능 지점이다.**

| 구간 | 범위 | 기간 | 사용자가 얻는 것 |
| --- | --- | --- | --- |
| **M1** | PR0~PR6 | 10일 | 레이아웃 재배치 + 대비 보정. 이미지·아이콘 없음 |
| **M2** | PR7~PR11 | 11.5일 | 장식 도형, 이미지·배경 생성, 배색 선택, 진행표시 |
| | **합계** | **21.5일** | |

M1을 먼저 내보내 배치 품질을 실사용자로 검증한 뒤 M2를 얹는 것을 권한다. M2의 이미지·배색은 배치가 신뢰할 만해진 다음에야 의미가 있다.

---

## 0. 이 문서를 실행하는 에이전트를 위한 규칙

1. **PR 단위로만 작업한다.** PR N을 머지하기 전에 PR N+1을 시작하지 않는다. 각 PR은 독립적으로 머지 가능하고, 머지 후에도 기존 동작이 깨지지 않아야 한다.
2. **`AGENTS.md`가 최우선이다.** `main` 직접 커밋 금지, 브랜치명은 `feature/<작업명>`, 요청 범위 밖 리팩터링·파일 이동·대량 포맷팅 금지.
3. **공통 계약이 먼저다.** `packages/shared`의 Zod schema가 Deck JSON의 원본이다. Python 모델이 shared와 다르면 **Python을 shared에 맞춘다** (반대 방향 금지).
4. **각 PR의 "완료 조건"에 적힌 검증 명령이 전부 통과해야 머지한다.** 하나라도 실패하면 완료로 처리하지 않는다.
5. 이 문서에 적힌 경로·함수명·라인번호는 2026-07-21 기준 실제 코드베이스에서 확인된 것이다. 불일치를 발견하면 문서를 고치지 말고 **작업을 멈추고 보고**한다.
6. **§2의 안전성 규칙은 성능·커버리지보다 우선한다.** 커버리지를 높이려고 안전 조건을 완화하지 않는다.

---

## 1. 확정된 설계 결정

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | 리디자인 단위는 **현재 슬라이드 1장** | 기존 `designAgentContextSchema`가 이미 slide 단위 |
| D2 | 레이아웃은 **`composition_library`의 19개 프리셋을 강제**. LLM은 좌표를 찍지 않고 **안전 후보 중 1개를 고르기만** 한다 | 결과 편차 제거, 세이프에어리어·그리드 자동 준수 |
| D3 | 결과는 **3분기**: `applicable` / `fallback-allowed` / `refused-unsafe` | `None` 하나로는 "폴백 가능"과 "폴백 금지"를 구분할 수 없다 (§2) |
| D4 | **M1**: `required` 제외, `optional`은 `assetRole="none"`으로 강제 (후보 14개)<br>**M2(PR8~)**: `required`도 허용 (후보 19개) | M1은 미디어 소스가 없으므로 플레이스홀더 노출을 막아야 한다 |
| D5 | **16:9(`wide-16-9`) 덱만 지원.** 4:3은 `fallback-allowed` | `composition_library`가 `CANVAS_WIDTH = 1920` 하드코딩 |
| D6 | **M1**: 기존 `POST /ai/design-agent/propose` 동기 응답<br>**M2(PR11)**: `slide-redesign` Job 기반 비동기 + 진행표시 | 이미지 생성이 10~25초라 동기로는 클라이언트 60초 타임아웃에 근접한다 |
| D7 | provenance는 **`sourceElementId` 기준**으로 cardinality를 계산한다 | `contentItemId`는 segment 단위라 원본 관계를 표현하지 못한다 |
| D8 | 후보 안전성 검사는 **LLM 선택 이전**에 수행한다 | 선택 후 거부하면 안전한 대안이 있는데도 기능이 실패한다 |
| D9 | 장식 요소는 **기본 도형 조합**으로 만든다. 아이콘 파일 세트를 도입하지 않는다 | `icon-map.json`은 14개짜리 미사용 자산이고, `svgElementPropsSchema = imageElementPropsSchema`라 SVG도 결국 파일 업로드가 필요하다. `rect`/`ellipse`/`line`/`polygon`은 스키마·렌더러가 이미 지원한다 |
| D10 | 사용자가 넣은 **기존 이미지는 보존하고 미디어 슬롯으로 재배치**한다 | 이미지 있는 슬라이드가 흔하다. 거부하면 커버리지가 크게 준다 |
| D11 | 배색은 **3안을 제시하고 사용자가 고른다.** AI가 임의로 확정하지 않는다 | 슬라이드 한 장만 톤이 튀면 덱 전체가 어색해진다. 선택권을 주면 이 위험을 사용자가 판단한다 |
| D12 | AI 이미지는 컴포지션이 미디어 슬롯을 요구하고 **기존 이미지가 없을 때만** 생성한다 | 비용·지연이 있는 유일한 구간이므로 최후에 둔다 |

---

## 2. 안전성 모델 (이 절이 이 문서의 핵심이다)

### 2.1 3분기 결과 타입

```python
RedesignOutcome = Literal["applicable", "fallback-allowed", "refused-unsafe"]

@dataclass(frozen=True)
class RedesignResult:
    outcome: RedesignOutcome
    response: DesignAgentResponse | None   # applicable일 때만 non-None
    reason: str                            # 로그·사용자 메시지용
```

| outcome | 의미 | 후속 동작 |
| --- | --- | --- |
| `applicable` | 프리셋 리디자인 성공 | operations를 담아 반환 |
| `fallback-allowed` | 이 슬라이드는 프리셋 대상이 아니지만 **위험 요소도 없음** | 기존 LLM 자유 배치 경로로 진행 |
| `refused-unsafe` | 데이터 손실 위험이 있음 | **기존 LLM 경로로 보내지 않는다.** `operations=[]` + 설명 message 반환 |

**`fallback-allowed`라는 이름을 쓰는 이유**는 이름 자체에 후속 동작을 넣기 위해서다. v1의 `not-applicable`은 "적용 불가"만 뜻하는 것처럼 보이지만 실제로는 "LLM에 넘김"을 의미했고, 그래서 chart가 있는 슬라이드가 조용히 위험 경로로 흘렀다.

### 2.2 `refused-unsafe` 조건

아래 중 **하나라도** 해당하면 `refused-unsafe`다.

| 조건 | 구간 | 이유 |
| --- | --- | --- |
| 슬라이드에 `chart` / `table` 요소가 있다 | M1, M2 | extractor가 텍스트만 읽으므로 데이터가 재현되지 않는다 |
| 슬라이드에 `group` / `customShape` 요소가 있다 | M1, M2 | 컴포지션이 이들을 배치할 슬롯이 없다 |
| 슬라이드에 `ellipse` / `line` / `arrow` / `polygon` / `star` / `ring` 요소가 있다 | M1, M2 | **원본에 이미 있는** 도형은 의도를 알 수 없어 재배치할 수 없다. PR7이 새로 만드는 도형과는 별개다 |
| 슬라이드에 `image` / `svg` 요소가 있다 | **M1만** | M1은 미디어 슬롯을 못 쓴다. **PR8부터는 unsafe가 아니라 재배치 대상**이 된다 (D10) |
| 이미지가 2개 이상 있는데 후보 컴포지션의 미디어 슬롯이 1개뿐 | M2 | 이미지를 버려야 하므로 손실이다 |
| 요소에 `ooxmlOrigin`이 있고 편집 capability가 없다 | M1, M2 | imported OOXML의 원형 보존 |
| **안전 후보가 0개**이고, 위 요소 중 하나라도 존재 | M1, M2 | 아래 §2.3 참조 |

`refused-unsafe`일 때 사용자에게 보내는 message 예시:

> 이 슬라이드에는 차트가 포함되어 있어 전체 리디자인을 적용하지 않았습니다. 차트를 제외한 부분만 정리하시려면 해당 요소를 선택한 뒤 요청해 주세요.

### 2.3 `refused-unsafe`는 전체 리디자인 요청에만 적용한다

**이 규칙을 빠뜨리면 기능이 퇴행한다.** `refused-unsafe` 판정은 `_should_attempt_redesign()`이 True인 요청 — 즉 `intentPreset == "redesign-slide"`이거나 "예쁘게 해줘" 같은 광범위 요청 — 에만 적용된다.

"차트 제목 색만 바꿔줘", "이 텍스트 왼쪽으로 옮겨줘" 같은 국소 편집은 애초에 리디자인 파이프라인에 진입하지 않으므로 **기존 경로가 그대로 동작해야 한다.** chart가 있다는 이유로 모든 요청을 거부하면 지금 되던 일이 안 되게 된다.

### 2.4 비가역 매핑의 안전 조건

원본 요소와 컴파일 결과가 1:1이 아닌 관계(1:N, N:1)를 **비가역 매핑**이라 부른다. 비가역 매핑은 반드시 "기존 삭제 + 신규 추가"가 되므로 elementId가 보존되지 않는다.

비가역 매핑을 **허용**하려면 관련 원본 요소 전부가 아래를 **모두** 만족해야 한다.

```
1. animation / action / semanticCue / keyword 참조가 없다
2. locked !== true
3. 어떤 group 요소의 구성원이 아니다
4. ooxmlOrigin이 없거나, 편집 capability가 허용된다
5. 텍스트 보존 검증을 통과한다 (§2.5)
```

하나라도 실패하면 **해당 후보 컴포지션이 unsafe**다. 요청 전체가 실패하는 게 아니라 그 후보만 제외된다.

### 2.5 텍스트 보존 검증

cardinality가 맞아도 문구가 잘리면 데이터 손실이다. `composition_library`에 실제 축약 지점이 있다.

- `composition_library.py:206` — `textwrap.shorten(caption, width=80, placeholder="...")` (미디어 캡션)
- `composition_library.py:1912` — `textwrap.shorten(hub_copy, width=80, placeholder="...")` (`diagram-hub`)
- `composition_library.py:2996` — `textwrap.shorten(message, width=24, placeholder="...")` (커버 경로)

검증 규칙:

```python
def text_preserved(source_text: str, compiled_texts: list[str]) -> bool:
    joined = normalize("".join(compiled_texts))
    if "..." in "".join(compiled_texts):
        return False                      # shorten placeholder 발견
    return normalize(source_text) in joined

# normalize: 공백 제거 + casefold + 구두점 제거 (composition_library._normalized_text와 동일 방침)
```

병합(N:1)은 구분자(`•`, `·`, `/`)로 join하므로 원문이 그대로 남는다 → 통과. 축약(shorten)은 실패.

### 2.6 요소 유형별 정책 요약표

| 요소 유형 | M1 정책 | M2 정책 |
| --- | --- | --- |
| `text` | 리디자인 대상. provenance 매칭 | 동일 |
| `rect` (role=`background`) | `update_slide_style`로 대체 | 동일 |
| `rect` (기타) | 장식으로 간주. 삭제 후 재생성 허용 (참조 없을 때만) | 동일 |
| `chart`, `table` | **refused-unsafe** | **refused-unsafe** |
| `group`, `customShape` | **refused-unsafe** | **refused-unsafe** |
| `ellipse`, `line`, `arrow`, `polygon`, `star`, `ring` | **refused-unsafe** | **refused-unsafe** (원본에 있는 것만. PR7이 새로 만드는 건 해당 없음) |
| `image`, `svg` | **refused-unsafe** | **미디어 슬롯으로 재배치** (PR8) |
| `locked === true` 인 모든 요소 | 매칭·삭제 대상에서 제외하고 그대로 둔다 | 동일 |

**`UNSAFE_ELEMENT_TYPES`는 상수 하나가 아니라 구간별 집합**으로 둔다. PR8이 `image`/`svg`를 빼낼 수 있어야 한다.

```python
UNSAFE_ELEMENT_TYPES_BASE = frozenset({
    "chart", "table", "group", "customShape",
    "ellipse", "line", "arrow", "polygon", "star", "ring",
})
MEDIA_ELEMENT_TYPES = frozenset({"image", "svg"})

def unsafe_element_types(*, media_slots_available: bool) -> frozenset[str]:
    return UNSAFE_ELEMENT_TYPES_BASE if media_slots_available \
        else UNSAFE_ELEMENT_TYPES_BASE | MEDIA_ELEMENT_TYPES
```

M1은 항상 `media_slots_available=False`로 호출한다. PR8이 True 경로를 연다.

---

## 3. 사전 확인된 사실 (재조사 불필요)

모두 2026-07-21에 실제 코드 실행으로 확인했다.

### 3.1 계약 불일치 — PR1의 근거

`composition_library`가 방출하는 값 vs `design_agent.py`가 받아들이는 값:

| 항목 | composition 방출 | design_agent 현재 | 위치 |
| --- | --- | --- | --- |
| text `role` | + `highlight` | `Literal["title","subtitle","body","caption","footer"]` | `design_agent.py` `TextElement` |
| rect `role` | + `media` | `Literal["background","decoration","highlight"]` | `design_agent.py` `RectElement` |
| `props.fontWeight` (add) | `"bold"` / `"semibold"` 등 문자열 | `int = Field(ge=100, le=900)` | `TextElementProps` (`design_agent.py:192`) |
| `props.fontWeight` (update) | 동일 | `int \| None = Field(ge=100, le=900)` | **`ElementPropsPatch` (`design_agent.py:160`)** |

> `TableCellProps.font_weight`(`design_agent.py:252`)도 `Literal["normal","bold"]`로 좁지만 **건드리지 않는다.** MVP 컴포지션은 table을 생성하지 않고, table 슬라이드는 `refused-unsafe`다.

실측 결과:

```
fontWeight='bold'    : 실패 -> ValidationError
fontWeight='semibold': 실패 -> ValidationError
fontWeight=600       : 통과
```

`packages/shared`의 `textFontWeightSchema`는 이미 문자열과 정수를 모두 허용하고, `deckElementRoleSchema`에도 `highlight`·`media`가 있다. **shared가 정답이고 design_agent.py가 좁은 쪽이다.**

### 3.2 capability version은 M1에서 올리지 않고, PR7에서 올린다

**M1 (PR0~PR6)** 에서는 `designAgentCapabilities`의 **필드 값이 하나도 바뀌지 않는다.**

- `addableElementTypes`: `["text","rect","chart","table"]` 유지 (`composition_library`는 `text`·`rect`만 생성한다)
- `canGenerateImages`: `false` 유지
- 나머지 필드도 동일

role·fontWeight 확장은 **내부 검증 범위**이지 광고되는 capability가 아니다. 따라서 M1 구간에서는 `version: "1"`을 그대로 두면 rolling deployment 문제가 발생하지 않는다.

**M2에서는 값이 바뀌므로 version을 "2"로 올린다.**

| PR | 바뀌는 필드 |
| --- | --- |
| PR7 | `addableElementTypes` += `ellipse`, `line`, `polygon` |
| PR8 | `addableElementTypes` += `image` |
| PR9 | `canGenerateImages` = `true` |

version 상승은 **PR7에서 한 번만** 수행하고, PR8·PR9는 이미 "2"인 상태에서 배열 항목만 늘린다. 배포는 **tolerant reader 순서**를 지킨다.

```
① Python이 version "1"과 "2"를 모두 수용하도록 먼저 배포
② API가 version "2"를 발행하도록 배포
③ 안정화 확인 후 "1" 수용 코드 제거 (별도 PR)
```

`DesignAgentCapabilities.version`을 `Literal["1"]`에서 `Literal["1", "2"]`로 바꾸는 것이 ①이다. ③은 M2 종료 후 정리 PR에서 한다.

### 3.3 provenance cardinality 실측

`compile_composition`에 **고유** `contentItemId`를 주면 composition library 자체는 1:N을 만들지 않는다. 그러나 **중복** `contentItemId`(= bullet split 결과)를 주면 1:N이 광범위하게 발생한다.

```
중복 contentItemId 입력 시 1:N 발생: 13개 중 11개 컴포지션
  hero-split, minimal-cover, statement-poster, editorial-split, metric-poster,
  kpi-strip-evidence, feature-comparison, process-horizontal, timeline,
  diagram-hub, cta-closing
```

N:1(여러 원본 → 1 element)은 `hero-split`, `minimal-cover`, `statement-poster`, `metric-poster`, `editorial-split` 등에서 발생한다. 병합 지점은 `composition_library.py`의 `:429`, `:573`, `:621`, `:1152`, `:1360`, `:1406` — 모두 `"  ·  ".join(...)` 또는 `"\n".join(f"• {value}" ...)` 패턴이고 `content_item_ids=[identifier for identifier, _ in items]`로 여러 원본을 한 요소에 묶는다.

> **이 숫자는 계약이 아니라 2026-07-21 시점의 테스트 관측값이다.** 컴포지션이나 eligibility가 바뀌면 달라진다. 회귀 테스트는 숫자가 아니라 §9의 불변식을 검증한다.

또한 중복 ID를 넣어도 composition library는 항목을 **손실 없이 전부 보존**한다(4항목 입력 → 4항목 출력). 즉 컴파일 단계에서는 증상이 없고 PR4 매칭에서만 드러난다. 테스트로 잡기 어려운 형태이므로 §9 불변식 테스트를 반드시 넣는다.

### 3.4 `_contentItemIds` 처리

`AddElementOperation.model_validate()` → `model_dump()` 왕복에서 pydantic이 unknown key를 버린다(실측 확인). 따라서 외부 유출 위험은 낮다.

그럼에도 **명시적으로 제거한다.** 이유는 보안이 아니라 (a) 내부 provenance와 공용 Deck 계약의 경계를 코드로 표현하고, (b) 테스트가 "우연히 schema가 버려준다"는 동작에 의존하지 않게 하기 위해서다.

### 3.5 `delete_element`의 연쇄 효과

`packages/editor-core/src/patches/applyPatch.ts:334`:

```ts
slide.animations = slide.animations.filter(a => a.elementId !== operation.elementId);
const removedActionIds = removeActionsForAnimations(slide, removedAnimationIds);
removeElementFromGroups(slide, operation.elementId);
removeElementReferences(slide, operation.elementId);
removeActionReferences(slide, removedActionIds);
if (isSemanticContentElement(removedElement)) markSemanticCuesStale(slide);
```

경고만 붙이고 삭제하는 것으로는 보존 요구를 만족하지 못한다. §2.4가 필요한 이유다.

### 3.6 빈 operations no-op이 성립하는 근거

- worker 응답 스키마는 빈 operations를 허용한다 (`designAgentWorkerResponseSchema.operations` = `.max(200).default([])`)
- 저장되는 proposal은 `operations: z.array(...).min(1)`이라 빈 배열을 거부한다
- `design-agent.service.ts:152` — `operations.length > 0`일 때만 `applyDeckPatch` 사전 검증을 돌린다
- `design-agent.service.ts:179` — `operations.length > 0`일 때만 proposal을 생성한다

따라서 `operations=[]` + message 반환 = **proposal 없이 챗 메시지만 표시**. 적용 버튼이 생기지 않는다. 기존 코드 수정 불필요.

### 3.7 컴포지션 미디어 요건 분포

전체 19개 = `none` 11 + `optional` 3 + `required` 5.

- `optional`: `hero-split`, `editorial-split`, `cta-closing` — 모두 `if direction.asset_role != "none":` 분기가 있어 이미지 없이 컴파일된다
- MVP 가용 후보 = 11 + 3 = **14개**

### 3.8 진입점·검증 명령

```
Python 라우트   services/python-worker/app/main.py:1055  @app.post("/ai/design-agent/propose")
API 클라이언트  apps/api/src/design-agent/design-agent-python.client.ts  (타임아웃 60초)
API 서비스      apps/api/src/design-agent/design-agent.service.ts        (applyDeckPatch로 사전 검증)
웹              apps/web/src/features/editor/shell/components/AiChatPanel.tsx
```

```bash
# Python
cd services/python-worker && uv sync --locked && uv run ruff check . && uv run mypy app && uv run pytest

# TypeScript (레포 루트)
pnpm --filter @orbit/shared test && pnpm --filter @orbit/api test && pnpm typecheck && pnpm lint
```

---

## 4. PR0 — 요소 보존 정책과 안전성 판정

브랜치: `feature/slide-redesign-safety-policy`
선행: 없음 / 예상: 1일

### 목표

§2의 안전성 모델을 코드로 고정한다. 이후 모든 PR이 이 모듈에 의존한다. **이 PR이 없으면 PR4·PR5가 데이터 손실 경로를 갖는다.**

### 신규 파일

```
services/python-worker/app/ai/slide_redesign/__init__.py
services/python-worker/app/ai/slide_redesign/safety.py
services/python-worker/tests/test_slide_redesign_safety.py
```

### 시그니처

```python
# safety.py
RedesignOutcome = Literal["applicable", "fallback-allowed", "refused-unsafe"]

UNSAFE_ELEMENT_TYPES_BASE: frozenset[str] = frozenset({
    "chart", "table", "group", "customShape",
    "ellipse", "line", "arrow", "polygon", "star", "ring",
})
MEDIA_ELEMENT_TYPES: frozenset[str] = frozenset({"image", "svg"})

def unsafe_element_types(*, media_slots_available: bool = False) -> frozenset[str]:
    """M1은 항상 기본값(False). PR8이 True 경로를 연다."""

@dataclass(frozen=True)
class ElementConstraints:
    """원본 요소별 보존 제약."""
    referenced_element_ids: frozenset[str]   # animation/action/semanticCue/keyword가 참조
    locked_element_ids: frozenset[str]
    grouped_element_ids: frozenset[str]
    ooxml_element_ids: frozenset[str]

def collect_element_constraints(slide: dict[str, Any]) -> ElementConstraints: ...

def find_unsafe_elements(
    slide: dict[str, Any], *, media_slots_available: bool = False,
) -> list[str]:
    """unsafe_element_types()에 해당하는 요소의 elementId 목록."""

def can_replace(element_id: str, constraints: ElementConstraints) -> bool:
    """비가역 매핑 대상이 될 수 있는지. §2.4의 1~4번."""

def normalize_text(value: str) -> str:
    """공백 제거 + casefold + 구두점 제거."""

def text_preserved(source_text: str, compiled_texts: list[str]) -> bool:
    """§2.5."""

def unsafe_refusal_message(unsafe_element_ids: list[str], slide: dict[str, Any]) -> str:
    """사용자용 한국어 안내. 요소 유형에 따라 문구를 고른다."""
```

### `collect_element_constraints` 수집 대상

```
slide["animations"][].elementId
slide["actions"][]  → 연결된 animationId를 통해 간접 참조되는 elementId
slide["semanticCues"][] → elementId 참조 필드
slide["keywords"][] → requiredOccurrenceIds가 가리키는 요소
slide["elements"][] 중 locked === True
slide["elements"][] 중 type == "group" → props의 구성원 elementId
slide["elements"][] 중 ooxmlOrigin 존재
```

정확한 참조 필드명은 `packages/shared/src/deck/deck.schema.ts`와 `packages/editor-core/src/patches/applyPatch.ts`의 `removeElementReferences`를 읽고 맞춘다. **추측하지 말고 실제 필드를 확인한다.**

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T0.1 | chart 포함 슬라이드 | `find_unsafe_elements`가 chart id 반환 |
| T0.2 | table 포함 | 동일 |
| T0.3 | group / customShape / ellipse 포함 | 동일 |
| T0.4 | text·rect만 있는 슬라이드 | 빈 목록 |
| T0.4b | image 포함, `media_slots_available=False` | image id 반환 |
| T0.4c | image 포함, `media_slots_available=True` | **빈 목록** (PR8 대비) |
| T0.5 | animation이 걸린 요소 | `can_replace` False |
| T0.6 | locked 요소 | `can_replace` False |
| T0.7 | group 구성원 | `can_replace` False |
| T0.8 | ooxmlOrigin 요소 | `can_replace` False |
| T0.9 | 제약 없는 요소 | `can_replace` True |
| T0.10 | `text_preserved("항목 A", ["항목 A · 항목 B"])` | True (병합은 보존) |
| T0.11 | `text_preserved("긴 문장...", ["긴 문..."])` | False (shorten 감지) |
| T0.12 | `text_preserved` 공백·구두점 차이만 | True |

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest tests/test_slide_redesign_safety.py -v
```

- `unsafe_element_types(media_slots_available=False)`가 `deckElementTypeSchema`의 값 중 `text`·`rect`를 제외한 전부를 덮는지 확인하는 테스트 포함 (스키마에 새 타입이 추가되면 이 테스트가 깨져서 알려준다)
- 이 PR은 아직 호출되지 않는다 (dead code 상태로 머지)

---

## 5. PR1 — design_agent 요소 모델을 shared와 정합화

브랜치: `feature/design-agent-element-model-alignment`
선행: 없음 (PR0과 병렬 가능) / 예상: 0.5일

### 목표

`composition_library`가 만든 요소가 `design_agent`의 검증을 통과하게 한다. 사용자 눈에 보이는 변화는 없다.

### 변경 파일

**`services/python-worker/app/ai/design_agent.py`**

```python
FontWeight = int | Literal["normal", "medium", "semibold", "bold"]

def _validate_font_weight(value: FontWeight | None) -> FontWeight | None:
    if isinstance(value, int) and not 100 <= value <= 900:
        raise ValueError("fontWeight must be between 100 and 900")
    return value

# 1) TextElement.role
role: Literal["title", "subtitle", "body", "caption", "footer", "highlight"]

# 2) RectElement.role
role: Literal["background", "decoration", "highlight", "media"]

# 3) TextElementProps.font_weight — add_element 경로
font_weight: FontWeight = Field(alias="fontWeight")

# 4) ElementPropsPatch.font_weight — update_element_props 경로 (v1에서 누락했던 부분)
font_weight: FontWeight | None = Field(default=None, alias="fontWeight")

# 3)4) 모두 field_validator로 _validate_font_weight 적용

# 5) SlideStylePatch — backgroundImage / layout 추가
class SlideBackgroundImagePatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    src: str = Field(min_length=1)
    alt: str = ""
    fit: Literal["contain", "cover", "stretch"] = "cover"
    opacity: float = Field(default=1, ge=0, le=1)

class SlideStylePatch(BaseModel):
    ...
    layout: str | None = Field(default=None, min_length=1)
    background_image: SlideBackgroundImagePatch | None = Field(
        default=None, alias="backgroundImage"
    )
```

**JSON schema 동기화** (빼먹으면 LLM이 새 값을 낼 수 없다):

- `_text_element_json_schema()` — `role` enum에 `highlight`, `fontWeight`를 `["string","integer"]`로
- `_rect_element_json_schema()` — `role` enum에 `media`
- `_props_operation_json_schema()` — `fontWeight` 타입 확장 (**v1 누락분**)
- `_slide_style_operation_json_schema()` — `layout`, `backgroundImage` 추가

**변경하지 않는 것:**

- `designAgentCapabilities.version` — `"1"` 유지 (§3.2)
- `addableElementTypes` — `["text","rect","chart","table"]` 유지
- `packages/shared/src/deck/design-agent.schema.ts` — **변경 없음**
- `packages/shared/src/deck/patch.schema.ts` — `slideStylePatchSchema`가 이미 `layout`·`backgroundImage`를 받는다

즉 **이 PR은 Python만 바꾼다.** TypeScript 변경이 없으므로 배포 순서 문제가 없다.

### 테스트

`services/python-worker/tests/test_design_agent.py`에 추가:

| # | 케이스 | 기대 |
| --- | --- | --- |
| T1.1 | `add_element`, text `role="highlight"` | 통과 |
| T1.2 | `add_element`, rect `role="media"` | 통과 |
| T1.3 | `add_element`, `fontWeight="semibold"` | 통과 |
| T1.4 | `add_element`, `fontWeight=600` | 통과 (하위호환) |
| T1.5 | `add_element`, `fontWeight=950` | `ValidationError` |
| T1.6 | **`update_element_props`, `fontWeight="bold"`** | 통과 (v1 누락분) |
| T1.7 | **`update_element_props`, `fontWeight=950`** | `ValidationError` |
| T1.8 | `update_slide_style`에 `backgroundImage` | 통과 |
| T1.9 | `DESIGN_AGENT_RESPONSE_FORMAT`에 `highlight`/`media`/`backgroundImage` 포함 | 문자열 검사 |
| T1.10 | `designAgentCapabilities.version == "1"` | 통과 (동결 확인) |

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest
pnpm --filter @orbit/shared test && pnpm --filter @orbit/api test && pnpm typecheck
```

- 기존 `test_design_agent.py`가 **하나도 깨지지 않는다**
- T1.6/T1.7이 통과해야 PR4의 `update_element_props`가 동작한다

---

## 6. PR2 — 슬라이드 해석기와 provenance map

브랜치: `feature/slide-redesign-extractor`
선행: PR0, PR1 / 예상: 2일 / **신규 코드 비중 최대**

### 목표

`Slide`(요소 배열)에서 `program_v2_slide_summary()`와 동일한 형태의 dict를 만들되, **원본 elementId와의 관계를 별도 map으로 보존**한다.

### 신규 파일

```
services/python-worker/app/ai/slide_redesign/slide_extractor.py
services/python-worker/tests/test_slide_redesign_extractor.py
```

### 핵심 변경 — segment ID (v1에서 이 부분이 틀렸다)

v1은 `contentItemId`에 원본 `elementId`를 그대로 넣었다. 그 결과 불릿 3개짜리 텍스트 요소 하나가 `contentItemId: "el_body"`인 항목 3개가 되고, 컴파일하면 **원본 하나가 결과 요소 3개에 연결되는 1:N**이 만들어진다 (§3.3, 13개 중 11개 컴포지션에서 발생).

```python
# 잘못된 방식 (v1)
{"contentItemId": "el_body", "text": "A"}
{"contentItemId": "el_body", "text": "B"}
{"contentItemId": "el_body", "text": "C"}

# 올바른 방식 (v2)
{"contentItemId": "el_body::segment::1", "text": "A"}
{"contentItemId": "el_body::segment::2", "text": "B"}
{"contentItemId": "el_body::segment::3", "text": "C"}

# 원본 관계는 Deck JSON이 아니라 별도 map으로 관리
provenance = {
    "el_body::segment::1": "el_body",
    "el_body::segment::2": "el_body",
    "el_body::segment::3": "el_body",
}
```

**`sourceElementId`를 Deck element에 넣지 않는다.** provenance map은 파이프라인 내부에서만 오간다.

> `_items()`는 `str(item.get("contentItemId") or f"item-{index}")`로 읽으므로 형식 제약이 없다. `::segment::` 표기는 안전하다.

### 시그니처

```python
SlideType = Literal[
    "cover", "title", "problem", "solution", "feature-grid", "process",
    "architecture", "data", "chart", "comparison", "quote", "summary",
]

@dataclass(frozen=True)
class ExtractedText:
    element_id: str
    text: str
    role: str | None
    font_size: float
    x: float
    y: float
    z_index: int

@dataclass(frozen=True)
class SlideHierarchy:
    title: ExtractedText | None
    message: ExtractedText | None
    items: list[ExtractedText]
    leftovers: list[ExtractedText]        # 푸터/페이지번호 등 리디자인 제외

@dataclass(frozen=True)
class ExtractedSlide:
    summary: dict[str, Any]               # compile_composition 입력
    provenance: dict[str, str]            # contentItemId -> sourceElementId
    hierarchy: SlideHierarchy

def collect_text_elements(slide) -> list[ExtractedText]: ...
def infer_hierarchy(texts) -> SlideHierarchy: ...
def split_bullets(text: str) -> list[str]: ...
def classify_slide_type(hierarchy, *, model, api_key, client=None) -> SlideType: ...
def heuristic_slide_type(hierarchy) -> SlideType: ...
def extract_slide(slide, *, slide_type, hierarchy) -> ExtractedSlide: ...
```

`extract_slide`가 `ExtractedSlide`를 반환한다는 점이 v1과 다르다. summary만 반환하면 provenance가 사라진다.

### 위계 추론 알고리즘

```
1. role이 있는 요소를 먼저 배치
     role == "title"                    → title
     role == "highlight" | "subtitle"   → message
     role in {"body", "caption"}        → items
     role == "footer"                   → leftovers
2. role 없는 요소: fontSize 내림차순
     - 1위이고 title이 비었으면                          → title
     - 2위이고 message가 비었고 fontSize >= title*0.5    → message
     - 나머지                                            → items
3. items 읽기 순서 = y 밴드 클러스터링 후 밴드 내 x 오름차순
     밴드 경계: 정렬된 y의 인접 간격이 (평균 height * 0.6) 초과 시 새 밴드
4. 각 item에 split_bullets() 적용, segment ID 부여, provenance에 기록
5. 캔버스 하단 12% 이내 && fontSize <= 20 → leftovers
```

### heuristic_slide_type 규칙

```
items 없음 && title만                → "cover"
items >= 3 && 순서표현               → "process"     ("단계", "→", "①", r"^\d+\.")
items >= 2 && 숫자 포함 비율 >= 0.5  → "data"
items == 2 && 대비표현               → "comparison"  ("vs", "대비", "전/후", "장점/단점")
items >= 3                           → "feature-grid"
items <= 1 && 인용부호               → "quote"
그 외                                → "summary"
```

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T2.1 | role이 전부 있는 슬라이드 | role대로 배치 |
| T2.2 | role이 없는 슬라이드 | fontSize 순 추론 |
| T2.3 | 2×2 그리드 | items 순서 좌상→우상→좌하→우하 |
| T2.4 | `"• A\n• B\n• C"` 단일 요소 | contentItems 3개, **ID가 서로 다름** |
| T2.5 | T2.4의 provenance | 3개 모두 `"el_body"`로 매핑 |
| T2.6 | `visible: false` 요소 | 제외 |
| T2.7 | 하단 페이지번호 | leftovers |
| T2.8 | 텍스트 요소 0개 | 빈 hierarchy, 예외 없음 |
| T2.9 | `classify_slide_type` LLM 예외 | heuristic 폴백, 예외 전파 안 함 |
| T2.10 | LLM이 enum 밖 문자열 | heuristic 폴백 |
| T2.11 | **contentItemId 전역 유일성** | summary 내 중복 없음 |
| T2.12 | 5종 골든 픽스처 | summary + provenance 스냅샷 일치 |

LLM 호출 테스트는 `test_design_agent.py`의 `FakeClient` / `FakeResponses` 패턴을 재사용한다.

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest tests/test_slide_redesign_extractor.py -v
```

- **T2.11(contentItemId 유일성)이 통과해야 한다.** 이게 깨지면 PR4가 조용히 잘못된 매칭을 만든다
- `extract_slide().summary`를 `compile_composition()`에 넣었을 때 `_items()`가 정상 동작하는 통합 확인 1건

---

## 7. PR3 — 컴포지션 후보와 팔레트

브랜치: `feature/slide-redesign-composer`
선행: PR2 / 예상: 1.5일

### 신규 파일

```
services/python-worker/app/ai/slide_redesign/palette.py
services/python-worker/app/ai/slide_redesign/composer.py
services/python-worker/tests/test_slide_redesign_composer.py
```

### palette.py

```python
def derive_palette(theme: dict[str, Any], background_mode: Literal["light","dark"]) -> PaletteRoles:
    """덱 테마에서 PaletteRoles 생성.
    - dominant: light면 theme.background, dark면 어두운 계열로 반전
    - focal:    theme.accent 유지 (덱 톤 유지 최우선)
    - text:     accessible_text_color(dominant, theme.text)로 보정
    """

def ensure_palette_contrast(roles: PaletteRoles) -> PaletteRoles:
    """contrast_ratio(text, dominant) >= 4.5 보장."""
```

`focal`은 기존 `theme.accent`를 그대로 쓴다. 슬라이드 한 장만 색이 튀면 덱 전체가 어색해진다.

### composer.py

```python
@dataclass(frozen=True)
class CompositionCandidate:
    composition_id: str
    background_mode: Literal["light", "dark"]
    asset_role: Literal["none"]           # MVP는 항상 "none"

def eligible_candidates(summary: dict[str, Any]) -> list[CompositionCandidate]:
    """slideType / 항목수 / 콘텐츠조건 / 미디어요건을 만족하는 (조합) 목록."""

def build_single_slide_program(
    theme: dict[str, Any], roles: PaletteRoles, candidate: CompositionCandidate,
) -> DeckDesignProgram: ...

def select_composition(
    summary: dict[str, Any],
    candidates: list[CompositionCandidate],     # 이미 안전성 필터를 통과한 목록
    question: str,
    *, model: str, api_key: str | None, client: Any | None = None,
) -> CompositionCandidate:
    """LLM은 주어진 목록에서 하나를 고르기만 한다.
    출력 스키마: {"compositionId": <목록 중 하나>, "rationale": str}
    실패하거나 목록 밖 값을 내면 candidates[0]으로 폴백.
    """

def compile_redesign(
    summary, candidate, program,
) -> CompiledComposition:
    """compile_composition 래핑. CompositionCompileError를 그대로 전파."""
```

> **`select_composition`은 이미 안전한 후보만 받는다.** 안전성 필터(PR4의 `filter_safe_candidates`)는 PR5 파이프라인에서 이 함수 **앞에** 호출된다 (D8). PR3 시점에는 필터가 없으므로 `eligible_candidates` 결과를 그대로 넘긴다.

### 후보 필터 순서

```python
item_count = len(summary["contentItems"])
result: list[CompositionCandidate] = []
for spec in COMPOSITION_SPECS.values():
    if summary["slideType"] not in spec.purposes:
        continue
    if not (spec.min_items <= item_count <= spec.max_items):
        continue
    if spec.media_requirement == "required":
        continue                                    # D4: optional은 허용
    if not content_supports_composition(spec.composition_id, summary):
        continue                                    # 숫자 포함 여부 등, 반드시 마지막
    for mode in spec.variants:
        if mode == "image":
            continue                                # MVP는 이미지 배경 미지원
        result.append(CompositionCandidate(spec.composition_id, mode, "none"))
```

`optional` 컴포지션은 `asset_role="none"`, `required_asset=False`로 `SlideCompositionDirection`을 만들면 미디어 없이 컴파일된다(`hero-split`의 `if direction.asset_role != "none":` 분기).

후보가 0개면 `CompositionCompileError`를 던진다. PR5가 이를 `fallback-allowed`로 변환한다.

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T3.1 | slideType="process", items 4개 | `process-horizontal`, `timeline` 포함 |
| T3.2 | 미디어 필터 | `hero-full-bleed`, `image-evidence` 제외 |
| T3.3 | **`optional` 컴포지션** | `hero-split`, `editorial-split`, `cta-closing` **포함** |
| T3.4 | items 10개 | 후보 0개 → `CompositionCompileError` |
| T3.5 | 숫자 없는 콘텐츠 | `metric-poster`, `kpi-strip-evidence` 제외 |
| T3.6 | `build_single_slide_program` | `DeckDesignProgram` validator 통과 |
| T3.7 | `select_composition` 목록 밖 ID | `candidates[0]` 폴백 |
| T3.8 | `select_composition` LLM 예외 | `candidates[0]` 폴백 |
| T3.9 | `derive_palette` 저대비 테마 | `contrast_ratio(text, dominant) >= 4.5` |
| T3.10 | `derive_palette` | `focal == theme["accent"]` |
| T3.11 | 전 후보 × 항목수 경계 스모크 | 예외 없이 컴파일, 모든 요소가 캔버스 안 |

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest tests/test_slide_redesign_composer.py -v
```

- T3.11에서 모든 요소가 `0 <= x`, `0 <= y`, `x+width <= 1920`, `y+height <= 1080`

---

## 8. PR4 — provenance 매칭, 안전성 필터, patch 생성

브랜치: `feature/slide-redesign-diff`
선행: PR3 / 예상: 2.5일 / **가장 위험한 구간**

### 목표

후보별로 provenance와 cardinality를 분석해 **안전하지 않은 후보를 선택 이전에 제거**하고, 선택된 후보를 patch operation으로 변환한다.

### 신규 파일

```
services/python-worker/app/ai/slide_redesign/diff.py
services/python-worker/tests/test_slide_redesign_diff.py
```

### 시그니처

```python
@dataclass(frozen=True)
class CandidateAnalysis:
    candidate: CompositionCandidate
    compiled: CompiledComposition
    matching: ElementMatching
    safe: bool
    unsafe_reason: str | None

@dataclass(frozen=True)
class ElementMatching:
    reused: dict[str, str]          # compiled elementId -> original elementId (1:1만)
    added: list[str]                # compiled elementId
    deleted: list[str]              # original elementId
    irreversible: list[str]         # 비가역 매핑에 관여한 original elementId

def analyze_candidate(
    summary: dict[str, Any],
    provenance: dict[str, str],
    slide: dict[str, Any],
    candidate: CompositionCandidate,
    program: DeckDesignProgram,
    constraints: ElementConstraints,
) -> CandidateAnalysis:
    """후보 하나를 실제로 컴파일하고 안전성을 판정한다."""

def filter_safe_candidates(
    summary, provenance, slide, candidates, theme, constraints,
) -> list[CandidateAnalysis]:
    """안전한 후보만 반환. 전부 unsafe면 빈 리스트."""

def match_elements(
    original_elements: list[dict[str, Any]],
    compiled_elements: list[dict[str, Any]],
    provenance: dict[str, str],
) -> ElementMatching: ...

def build_operations(
    slide_id: str, original_elements, compiled, matching,
) -> list[dict[str, Any]]: ...
```

### 매칭 알고리즘 (원본 기준 cardinality)

```
0. locked 요소는 매칭·삭제 대상에서 제외

1. compiled 요소마다 sourceElementIds 계산
     source_ids(el) = { provenance[cid] for cid in el["_contentItemIds"] }

2. 원본 기준 cardinality 집계
     for src in 모든 원본 elementId:
         targets = [compiled el | src in source_ids(el)]
         len(targets) == 1 이고 그 el의 source_ids == {src}  → 1:1
         len(targets) >= 2                                    → 1:N (비가역)
         len(source_ids(el)) >= 2                             → N:1 (비가역)

3. 1:1 → reused[compiled_id] = src  (elementId 보존)

4. 비가역(1:N, N:1) → 관여한 원본 전부에 대해:
     can_replace(src, constraints) 가 False면        → 후보 unsafe
     text_preserved(원본 텍스트, 대상 compiled 텍스트들)가 False면 → 후보 unsafe
     둘 다 통과하면 → 원본은 deleted, compiled는 added

5. provenance가 없는 compiled 요소(제목·장식·번호 등)
     → 정규화 텍스트 완전 일치로 1:1 매칭 시도
     → 실패하면 added

6. 남은 원본 요소 → deleted
     단 can_replace(src, constraints) 가 False면 → 후보 unsafe
```

**핵심: cardinality는 `contentItemId`가 아니라 `provenance[contentItemId]` = `sourceElementId` 기준으로 센다.** segment ID를 유일하게 만들어도 원본 기준 1:N은 그대로 존재한다 (§3.3).

### 안전성 필터가 LLM 선택보다 앞서는 이유 (D8)

선택 후에 unsafe를 판정하면, 안전한 대안 후보가 있는데도 요청 전체가 실패한다. §3.3에서 확인했듯 1:N은 13개 중 11개 컴포지션에서 발생하므로, 참조가 있는 슬라이드에서 **후보를 통째로 배제하면 기능이 사실상 죽는다.** 후보별로 실제 컴파일해서 `비가역 매핑 ∩ 제약 요소` 교집합을 계산해야 한다.

비용은 후보 수만큼의 `compile_composition` 호출인데, 이 함수는 결정론적이고 LLM을 부르지 않으므로 후보 14개를 전부 컴파일해도 밀리초 단위다.

### operation 생성 순서

```python
[
  {"type": "update_slide_style", "slideId": ..., "style": {"backgroundColor": compiled.background_color}},
  # 재사용 — 프레임
  {"type": "update_element_frame", "slideId": ..., "elementId": <original>, "frame": {...}},
  # 재사용 — props (text는 넣지 않는다)
  {"type": "update_element_props", "slideId": ..., "elementId": <original>, "props": {...}},
  # 추가
  {"type": "add_element", "slideId": ..., "element": {...}},
  # 삭제 (반드시 마지막)
  {"type": "delete_element", "slideId": ..., "elementId": <original>},
]
```

**규칙 4개:**

- `update_element_props`에 **`text`를 넣지 않는다.** 리디자인은 배치를 바꾸는 것이지 문구를 고치는 게 아니다.
- `delete_element`는 항상 마지막. `applyDeckPatch`가 순차 적용하므로 삭제가 앞에 오면 뒤 연산의 elementId가 사라진다.
- `add_element` 방출 전에 **`_contentItemIds`를 명시적으로 제거한다** (§3.4).
- `add_element`의 `elementId`가 원본과 충돌하면 `_r2` 접미사를 붙인다.

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T4.1 | 텍스트 3개 1:1 | `reused` 3개, elementId 보존 |
| T4.2 | 불릿 분할 → 1:N, 참조 없음 | 비가역 허용, deleted+added |
| T4.3 | **불릿 분할 → 1:N, animation 있음** | 후보 unsafe |
| T4.4 | N:1 병합, 참조 없음 | 비가역 허용 |
| T4.5 | **N:1 병합, semanticCue 참조** | 후보 unsafe |
| T4.6 | 1:N인데 shorten으로 축약 | 후보 unsafe (텍스트 보존 실패) |
| T4.7 | locked 요소 | 매칭·삭제 제외 |
| T4.8 | group 구성원이 비가역 대상 | 후보 unsafe |
| T4.9 | `filter_safe_candidates` — 일부만 unsafe | 안전 후보만 반환, 빈 리스트 아님 |
| T4.10 | `filter_safe_candidates` — 전부 unsafe | 빈 리스트 |
| T4.11 | operation 순서 | `delete_element`가 전부 마지막 |
| T4.12 | `update_element_props`에 `text` 키 | **없음** |
| T4.13 | `add_element`에 `_contentItemIds` 키 | **없음** |
| T4.14 | compiled ID 충돌 | `_r2` 접미사 |
| T4.15 | 동일 텍스트 2개 (중복 문구) | 1:1 매칭, 중복 매칭 없음 |
| T4.16 | **라운드트립** | operations를 순차 적용하면 compiled와 동일 배치 |
| T4.17 | **cardinality가 sourceElementId 기준** | segment ID가 달라도 같은 원본이면 1:N으로 집계 |

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest tests/test_slide_redesign_diff.py -v
```

- **T4.16(라운드트립)과 T4.17(cardinality 기준)이 통과해야 한다. 실패하면 PR5를 시작하지 않는다.**
- T4.3, T4.5, T4.6, T4.8 — 참조 보존 검사가 전부 통과해야 한다

---

## 9. PR5 — 파이프라인 결선

브랜치: `feature/slide-redesign-endpoint`
선행: PR4 / 예상: 1일

### 신규 파일

```
services/python-worker/app/ai/slide_redesign/pipeline.py
services/python-worker/tests/test_slide_redesign_pipeline.py
```

### 시그니처

```python
def redesign_slide(
    request: DesignAgentRequest,
    *, model: str, api_key: str | None, client: Any | None = None,
) -> RedesignResult:
    """예외를 던지지 않는다. 항상 RedesignResult를 반환한다."""
```

### 파이프라인 순서 (D8 반영)

```
 1. _should_attempt_redesign(request)          False → fallback-allowed
 2. canvas가 1920x1080이 아님                        → fallback-allowed
 3. unsafe_ids = find_unsafe_elements(slide, media_slots_available=MEDIA_ENABLED)
    # M1: MEDIA_ENABLED = False / PR8 이후: True
    비어있지 않음                                    → refused-unsafe
 4. texts = collect_text_elements(slide)
    비어있음                                         → fallback-allowed
 5. hierarchy = infer_hierarchy(texts)
 6. slide_type = classify_slide_type(hierarchy, ...)
 7. extracted = extract_slide(slide, ...)      # summary + provenance
 8. candidates = eligible_candidates(summary)
    0개                                              → fallback-allowed
 9. constraints = collect_element_constraints(slide)
10. analyses = filter_safe_candidates(...)     # ★ LLM 선택 이전
    0개이고 제약 요소가 존재                          → refused-unsafe
    0개이고 제약 요소가 없음                          → fallback-allowed
11. chosen = select_composition(summary, [a.candidate for a in analyses], ...)
12. analysis = analyses에서 chosen에 해당하는 항목 (재컴파일 불필요)
13. operations = build_operations(...)
14. applicable + DesignAgentResponse 반환
```

10번의 분기가 중요하다. 안전 후보가 없더라도 **위험 요소 자체가 없으면** 기존 LLM에 넘겨도 손실이 없으므로 `fallback-allowed`다. 참조·잠금 등 제약이 실제로 존재해서 후보가 전멸한 경우에만 `refused-unsafe`다.

### `generate_design_proposal` 훅

`design_agent.py` `generate_design_proposal()` 안, 애니메이션 분기 **바로 다음**:

```python
result = redesign_slide(request, model=model, api_key=api_key, client=client)
if result.outcome == "applicable":
    assert result.response is not None
    return validate_design_proposal(
        request, normalize_design_proposal(request, result.response)
    )
if result.outcome == "refused-unsafe":
    return DesignAgentResponse(
        message=result.reason,
        interpretedIntent=DesignAgentIntent(target="current-slide", action="refused", alignment=None),
        operations=[],            # proposal이 생성되지 않는다 (§3.6)
        affectedElementIds=[],
        warnings=[],
        smartArtRequest=None,
        uiAction=None,
    )
# fallback-allowed → 기존 LLM 자유 배치 경로로 진행 (아래 기존 코드 그대로)
```

**기존 코드는 한 줄도 지우지 않는다.** `_build_deterministic_preset_proposal()`도 호출부 없는 상태 그대로 둔다 (테스트가 직접 참조 중). 정리는 별도 PR.

### 트리거 조건

```python
def _should_attempt_redesign(request) -> bool:
    if request.intent_preset == "redesign-slide":
        return True
    return _is_broad_preset_request(request.question)   # design_agent.py:963, 기존 함수
```

§2.3 — 이 함수가 False면 `refused-unsafe` 판정 자체를 하지 않는다. "차트 제목 색만 바꿔줘"는 chart가 있어도 기존 경로로 정상 처리되어야 한다.

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T5.1 | 정상 텍스트 슬라이드 + `redesign-slide` | `applicable`, operations 있음 |
| T5.2 | 캔버스 1024×768 | `fallback-allowed` |
| T5.3 | 텍스트 0개 | `fallback-allowed` |
| T5.4 | **chart 포함 + "예쁘게 해줘"** | `refused-unsafe`, operations 빈 배열 |
| T5.5 | **chart 포함 + "차트 제목 색 바꿔줘"** | 파이프라인 미진입 → 기존 경로 |
| T5.6 | table 포함 + 전체 리디자인 | `refused-unsafe` |
| T5.7 | 후보 0개, 위험 요소 없음 | `fallback-allowed` |
| T5.8 | 후보 전멸(참조 때문), 제약 존재 | `refused-unsafe` |
| T5.9 | `compile_composition` 예외 | 예외 전파 없음 |
| T5.10 | `intentPreset="recommend-animation"` | 애니메이션 경로 우선 |
| T5.11 | `applicable` 결과가 `validate_design_proposal` 통과 | 예외 없음 |
| T5.12 | `refused-unsafe` 응답이 worker 스키마 통과 | 빈 operations 허용 확인 |

### 구조화 로그

원문·질문 텍스트는 남기지 않고 다음만 기록한다.

```
outcome                  applicable | fallback-allowed | refused-unsafe
slide_type_source        llm | heuristic
candidate_count          eligible 후보 수
safe_candidate_count     안전 후보 수
chosen_composition_id
operation_count
irreversible_count       비가역 매핑에 관여한 원본 수
unsafe_reason            refused-unsafe일 때만
duration_ms              단계별
```

`safe_candidate_count == 0` 비율과 `refused-unsafe` 비율이 운영 지표다. 이 수치를 보고 후보 재시도 로직이나 프리셋 추가가 필요한지 판단한다. **실측 없이 재시도 로직부터 만들지 않는다.**

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest
pnpm --filter @orbit/api test && pnpm typecheck
```

- **기존 `test_design_agent.py` 전체 통과** (회귀 없음이 이 PR의 핵심)
- T5.4와 T5.5가 **둘 다** 통과해야 한다. 하나만 통과하면 안전성이나 기존 기능 중 하나가 깨진 것이다

---

## 10. PR6 — 통합 검증

브랜치: `feature/slide-redesign-verification`
선행: PR5 / 예상: 1.5일

### 불변식 회귀 테스트 (숫자가 아니라 성질을 검증한다)

§3.3의 "13개 중 11개" 같은 수치는 컴포지션이 바뀌면 달라진다. 회귀 테스트는 아래 **불변식**을 검증한다.

| # | 불변식 |
| --- | --- |
| I1 | 중복 `contentItemId`를 넣어도 provenance가 손실되지 않는다 |
| I2 | cardinality는 `sourceElementId` 기준으로 계산된다 |
| I3 | unsafe 후보는 LLM 선택 목록에 포함되지 않는다 |
| I4 | 안전 후보가 하나라도 있으면 unsafe 후보 때문에 요청 전체를 거부하지 않는다 |
| I5 | `refused-unsafe` 응답은 항상 `operations == []`이다 |
| I6 | 방출된 어떤 operation에도 `_` 로 시작하는 내부 키가 없다 |
| I7 | `update_element_props`에 `text` 키가 없다 |
| I8 | `delete_element`가 항상 operation 목록의 끝에 모여 있다 |

### 골든 픽스처 (14종)

`services/python-worker/tests/fixtures/slide_redesign/`

| 픽스처 | 기대 outcome |
| --- | --- |
| 커버 (제목+부제) | `applicable` |
| 3항목 프로세스 | `applicable` |
| 5항목 타임라인 | `applicable` |
| 2열 비교 | `applicable` |
| 숫자 KPI 3개 | `applicable` |
| 인용문 | `applicable` |
| 불릿 1개 요소에 5항목 | `applicable` (1:N, 참조 없음) |
| 불릿 + animation | `refused-unsafe` |
| 롱텍스트 1개 | `applicable` 또는 `fallback-allowed` |
| **chart 포함** | **`refused-unsafe`** |
| **table 포함** | **`refused-unsafe`** |
| **image 포함** | **M1: `refused-unsafe` → PR8에서 `applicable`로 갱신** |
| 잠금 요소 포함 | `applicable` (잠금 요소는 불변) |
| 4:3 캔버스 | `fallback-allowed` |

**chart/table 픽스처의 기대값은 "기존 LLM 폴백"이 아니라 "변경 거부"다.** v1은 이를 폴백으로 적어 데이터 손실 경로를 열어두었다.

### 그 외

1. **API 통합 테스트** — `apps/api/src/design-agent/design-agent.service.spec.ts`에 (a) 리디자인 응답이 `applyDeckPatch` 검증 통과, (b) 빈 operations 응답 시 proposal이 생성되지 않음
2. **E2E** — 리디자인 → 적용 → `Ctrl+Z` 1회 → 원본 완전 복구. `pnpm test:smoke`
3. **수동 시각 QA** — 항목별 평가표로 기록 (`design-qa.md` 형식)

| 평가 항목 | 기준 |
| --- | --- |
| 텍스트 overflow | 프레임 밖으로 나간 글자 없음 |
| 요소 겹침 | 의도하지 않은 겹침 없음 |
| 원문 보존 | 모든 원본 문구가 결과에 존재 |
| 참조 보존 | 애니메이션·시맨틱큐 유실 없음 |
| 대비 | 본문 텍스트 대비 4.5:1 이상 |
| 전반 인상 | 원본 대비 개선/동등/악화 |

"12개 중 10개가 나아 보인다" 같은 총평 대신 항목별로 기록한다.

### 완료 조건

```bash
cd services/python-worker && uv run pytest
pnpm --filter @orbit/api test && pnpm typecheck && pnpm lint
pnpm test:smoke --grep "slide redesign"
```

- I1~I8 불변식 전부 통과
- 14종 픽스처가 기대 outcome과 일치
- undo 1회 복구가 모든 `applicable` 픽스처에서 성립
- 평가표에서 "원문 보존"과 "참조 보존"은 **전 항목 통과 필수** (다른 항목과 달리 타협 불가)

---

## 11. PR7 — 장식 도형 레이어

브랜치: `feature/slide-redesign-ornaments`
선행: PR6 (M1 출시 후) / 예상: 2일

### 목표

컴파일 결과 위에 **기본 도형으로 만든 장식**을 얹는다. 번호 배지, 구분선, 강조 블록, 화살표 같은 것들이다. `composition_library`는 `rect`만 쓰므로 결과가 다소 밋밋한데, 이 레이어가 "디자인된 느낌"의 상당 부분을 만든다.

**`composition_library`를 수정하지 않는다.** 후처리 레이어로 얹는다.

### 왜 아이콘 파일이 아니라 도형인가 (D9)

- `design_library/icon-map.json`은 14개 항목짜리 매핑이고 **코드베이스에서 아무도 참조하지 않는다.** 특정 파이프라인 도식용으로 만들어진 죽은 자산이다
- `svgElementPropsSchema = imageElementPropsSchema` — SVG도 인라인이 아니라 `src` 기반 파일 참조다. 아이콘을 쓰려면 에셋 세트를 스토리지에 올리고 매핑 테이블과 업로드 파이프라인을 새로 만들어야 한다
- `rect` / `ellipse` / `line` / `polygon`은 **스키마와 렌더러가 이미 지원**한다. 파일 저장도, 비용도, 실패 경로도 없다

### 신규 파일

```
services/python-worker/app/ai/slide_redesign/ornament.py
services/python-worker/tests/test_slide_redesign_ornament.py
```

### 시그니처

```python
@dataclass(frozen=True)
class OrnamentPlan:
    elements: list[dict[str, Any]]      # 추가할 도형 요소
    z_index_base: int

def build_ornaments(
    compiled: CompiledComposition,
    candidate: CompositionCandidate,
    style_roles: PaletteRoles,
) -> OrnamentPlan:
    """컴포지션 유형별 장식 도형을 생성한다."""

def ornaments_for(composition_id: str) -> list[OrnamentKind]:
    """컴포지션 → 장식 종류 매핑 (결정론적 테이블)."""
```

### 장식 카탈로그

| 종류 | 도형 | 적용 컴포지션 | 배치 규칙 |
| --- | --- | --- | --- |
| `step-badge` | `ellipse` + `text` | `process-horizontal`, `timeline` | 각 항목 카드 좌상단, 지름 56px, fill=`focal`, 내부에 번호 |
| `connector` | `line` | `process-horizontal`, `timeline` | 인접 항목 중심을 잇는 수평선, strokeWidth 2, `focal` 40% 불투명 |
| `arrow-head` | `polygon` | `process-horizontal` | connector 끝, 한 변 12px 삼각형 |
| `accent-bar` | `rect` | `statement-poster`, `minimal-cover`, `cta-closing` | 제목 위 폭 72px·높이 6px, `focal` |
| `divider` | `line` | `editorial-split`, `feature-comparison` | 컬럼 사이 수직선, `border` 색 |
| `metric-ring` | `ellipse` (fill=transparent, stroke) | `metric-poster`, `kpi-strip-evidence` | 숫자 뒤 지름 = 텍스트 높이×1.6, strokeWidth 3 |
| `corner-accent` | `polygon` | `hero-split`, `diagram-hub` | 캔버스 우상단 삼각형, `secondary` 12% 불투명 |

### 배치 제약 (반드시 지킬 것)

```
1. 장식은 zIndex를 본문 최소값보다 낮게 두거나(배경 장식),
   본문 최대값보다 높게 둔다(배지·링). 중간에 끼우지 않는다.
2. 장식은 텍스트 요소의 bounding box와 겹치면 안 된다.
   단 metric-ring / step-badge는 의도적 겹침이므로 예외 목록으로 관리한다.
3. 모든 장식은 세이프에어리어(SAFE_X=120, SAFE_Y=88, 1680×904) 안에 둔다.
   corner-accent만 예외 (의도적 블리드).
4. 장식 총 개수는 슬라이드당 12개 이하. 초과하면 우선순위 낮은 것부터 버린다.
5. 장식 요소의 role은 "decoration"으로 고정한다.
6. elementId는 "el_orn_{kind}_{index}" 규칙. 본문 요소와 충돌하지 않는다.
```

### 계약 변경

**`services/python-worker/app/ai/design_agent.py`**

```python
class EllipseElement(BaseModel):     # RectElement와 동일 구조, type만 다름
    type: Literal["ellipse"]
    role: Literal["background", "decoration", "highlight"]
    props: ShapeElementProps         # RectElementProps와 동일 필드

class LineElement(BaseModel):
    type: Literal["line"]
    role: Literal["decoration"]
    props: ShapeElementProps

class PolygonElement(BaseModel):
    type: Literal["polygon"]
    role: Literal["decoration"]
    props: ShapeElementProps         # + sides: int (3~12)

AddableElement = Annotated[
    TextElement | RectElement | EllipseElement | LineElement | PolygonElement
    | ChartElement | TableElement,
    Field(discriminator="type"),
]

# capabilities
version: Literal["1", "2"] = "2"     # tolerant reader (§3.2)
addable_element_types: list[Literal[
    "text", "rect", "ellipse", "line", "polygon", "chart", "table"
]]
```

> `shapeElementPropsSchema`(`packages/shared/src/deck/slide-object.schema.ts:119`)는 `fill`·`stroke`·`strokeWidth`·`borderRadius`·`sides`·`dash`·`lineCap`·`lineJoin`·`shadow`를 갖는다. `rect`/`ellipse`/`line`/`polygon`이 **모두 같은 props 스키마**를 쓰므로 Python 쪽도 하나의 모델을 재사용한다.

**`packages/shared/src/deck/design-agent.schema.ts`**

```ts
version: z.enum(["1", "2"]),
addableElementTypes: z.array(
  z.enum(["text", "rect", "ellipse", "line", "polygon", "chart", "table"])
),
// designAgentCapabilities 상수의 version을 "2"로, 배열에 3종 추가
```

`_add_element_operation_json_schema()`에 세 요소의 JSON schema를 추가한다.

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T7.1 | `process-horizontal` 4항목 | `step-badge` 4개, `connector` 3개 생성 |
| T7.2 | `statement-poster` | `accent-bar` 1개 |
| T7.3 | `metric-poster` | `metric-ring` 생성, 숫자 텍스트와 중심 정렬 |
| T7.4 | 장식이 텍스트와 겹침 (예외 목록 밖) | 해당 장식 제외 |
| T7.5 | 장식 20개가 계산됨 | 12개로 절삭 |
| T7.6 | 모든 장식 | 세이프에어리어 안 (corner-accent 제외) |
| T7.7 | 모든 장식 | `role == "decoration"`, elementId 접두사 `el_orn_` |
| T7.8 | zIndex | 본문 최소보다 낮거나 최대보다 높음 |
| T7.9 | `add_element`로 ellipse/line/polygon | 검증 통과 |
| T7.10 | `version: "1"` 요청 수신 | Python이 거부하지 않음 (tolerant reader) |
| T7.11 | 전 컴포지션 × 장식 스모크 | 예외 없음, 캔버스 이탈 없음 |

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest
pnpm --filter @orbit/shared test && pnpm --filter @orbit/api test && pnpm typecheck
```

- **T7.10이 통과해야 한다.** version "1"을 거부하면 rolling deployment 중 요청이 실패한다
- 배포 시 §3.2의 ①②③ 순서를 지킨다

---

## 12. PR8 — 미디어 슬롯과 기존 이미지 재배치

브랜치: `feature/slide-redesign-media-slots`
선행: PR7 / 예상: 2일

### 목표

사용자가 이미 넣어둔 이미지를 **버리지 않고** 새 레이아웃의 미디어 슬롯으로 옮긴다 (D10). 이 PR로 `image`/`svg` 요소가 `refused-unsafe`에서 빠진다.

### 배경

`composition_library`의 `_media()`는 `*_media_placeholder` rect + 캡션 텍스트를 만든다. 미디어를 쓰는 컴포지션은 5개(`required`)와 3개(`optional`)다.

| 요건 | 컴포지션 |
| --- | --- |
| `required` | `cover-visual-impact`, `cover-immersive-background`, `cover-research-author`, `hero-full-bleed`, `image-evidence` |
| `optional` | `hero-split`, `editorial-split`, `cta-closing` |

`optional`은 `direction.asset_role != "none"`일 때만 미디어 슬롯을 만든다.

### 신규 파일

```
services/python-worker/app/ai/slide_redesign/media.py
services/python-worker/tests/test_slide_redesign_media.py
```

### 시그니처

```python
@dataclass(frozen=True)
class MediaSlot:
    placeholder_element_id: str        # el_1_program_v2_media_placeholder
    caption_element_id: str | None
    x: float; y: float; width: float; height: float
    aspect_ratio: Literal["landscape", "portrait", "square"]

@dataclass(frozen=True)
class MediaAssignment:
    slot: MediaSlot
    source_element_id: str | None      # 기존 이미지를 옮기는 경우
    needs_generation: bool             # True면 PR9가 채운다

def find_media_slots(compiled: CompiledComposition) -> list[MediaSlot]:
    """elementId가 '_media_placeholder'로 끝나는 요소를 슬롯으로 해석."""

def collect_source_images(slide: dict[str, Any]) -> list[dict[str, Any]]:
    """type이 image/svg인 요소를 면적 내림차순으로."""

def assign_media(
    slots: list[MediaSlot], sources: list[dict[str, Any]],
) -> list[MediaAssignment] | None:
    """면적이 큰 이미지를 큰 슬롯에 배정. 슬롯보다 이미지가 많으면 None(=unsafe)."""

def build_media_operations(
    slide_id: str, assignments: list[MediaAssignment],
) -> list[dict[str, Any]]:
    """기존 이미지를 슬롯 위치로 옮기는 update_element_frame/props 생성."""
```

### 배정 규칙

```
1. 슬롯 수 >= 이미지 수  → 배정 가능
   슬롯 수 <  이미지 수  → 이 후보는 unsafe (이미지를 버리게 되므로)
2. 면적 큰 이미지 → 면적 큰 슬롯
3. 배정된 이미지는 elementId를 유지하고 frame만 바꾼다 (update_element_frame)
   props.fit은 슬롯 종횡비에 맞춰 cover/contain 선택
4. 배정 안 된 슬롯 → needs_generation = True (PR9가 채움)
   PR9 이전에는 플레이스홀더 rect가 그대로 남는다
5. 원본 이미지에 참조(animation 등)가 있어도 elementId를 유지하므로 안전하다
   → can_replace 검사 불필요
```

**4번이 중요하다.** 기존 이미지 재배치는 `delete + add`가 아니라 `update_element_frame`이므로 elementId가 그대로다. 따라서 애니메이션·시맨틱큐가 살아남는다. PR4의 비가역 매핑 정책이 적용되지 않는다.

### 계약 변경

- `AddableElement`에 `ImageElement` 추가 (`props`: `src`/`alt`/`fit`/`focusX`/`focusY`)
- `addableElementTypes` += `"image"` (version은 이미 "2")
- `unsafe_element_types(media_slots_available=True)` 경로 활성화

### PR3 `eligible_candidates` 수정

```python
# 변경 전 (M1)
if spec.media_requirement == "required":
    continue
for mode in spec.variants:
    if mode == "image":
        continue

# 변경 후 (M2)
source_image_count = len(collect_source_images(slide))
if spec.media_requirement == "required" and not MEDIA_ENABLED:
    continue
# image variant 허용, asset_role은 슬롯 필요 여부로 결정
asset_role = "atmosphere" if spec.media_requirement != "none" else "none"
```

후보 수: 14개 → **19개**.

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T8.1 | `hero-full-bleed` 컴파일 | 미디어 슬롯 1개 탐지 |
| T8.2 | 이미지 1개 + 슬롯 1개 | 배정, `source_element_id` 설정 |
| T8.3 | 이미지 2개 + 슬롯 1개 | `None` → 후보 unsafe |
| T8.4 | 이미지 0개 + 슬롯 1개 | `needs_generation=True` |
| T8.5 | 이미지 재배치 operation | `update_element_frame`, **`delete_element` 없음** |
| T8.6 | 애니메이션 걸린 이미지 | elementId 유지, 애니메이션 보존 |
| T8.7 | 세로 이미지 → 가로 슬롯 | `fit="cover"` |
| T8.8 | `unsafe_element_types(True)` | image가 unsafe 아님 |
| T8.9 | 후보 수 | 19개 (M1의 14개에서 증가) |
| T8.10 | 이미지 포함 슬라이드 전체 파이프라인 | `applicable`, 이미지 보존 |

### 완료 조건

```bash
cd services/python-worker && uv run ruff check . && uv run mypy app && uv run pytest
pnpm typecheck
```

- **T8.6이 통과해야 한다.** 이미지 재배치가 애니메이션을 끊으면 D10의 의미가 없다
- PR6의 "image 포함 → refused-unsafe" 픽스처 기대값을 `applicable`로 갱신한다

---

## 13. PR9 — AI 이미지·배경 생성

브랜치: `feature/slide-redesign-image-generation`
선행: PR8 / 예상: 2.5일

### 목표

`needs_generation=True`인 슬롯을 실제 이미지로 채운다. TypeScript worker 작업이 중심이다.

### assetRole 라우팅

| assetRole | 소스 | 판정 기준 |
| --- | --- | --- |
| `atmosphere` | gpt-image-1 (추상 배경·그라디언트·질감) | 컴포지션이 `image` variant이거나 커버 |
| `evidence` | Openverse 검색 → 업로드 공식 자산 | 슬라이드에 출처 참조(`sourceRefs`)가 있음 |
| `decoration` | **생성하지 않는다.** PR7의 도형으로 대체 | 그 외 |

**`evidence`에 AI 생성을 쓰지 않는다.** 근거로 제시되는 자리에 없는 것을 그려 넣으면 안 된다.

### 변경 파일

**`apps/worker/src/image-asset-pipeline.ts`** — 같은 파일 안에 export 추가

```ts
export async function resolveSlideImageAssets(
  deck: Deck,
  slideId: DeckSlideId,
  runtime: ImageAssetRuntime,
  scope: ImageAssetScope,
): Promise<{ deck: Deck; diagnostics: ImageAssetFallbackDiagnostic[] }>
```

내부적으로 기존 함수를 그대로 호출한다.

| 함수 | 위치 | 역할 |
| --- | --- | --- |
| `replaceSlideImagePlaceholder()` | :601 | 플레이스홀더 → image 요소 |
| `storeImageAsset()` | :505 | 스토리지 저장 + fileId 발급 |
| `remainingDailyBudget()` | :361 | 일일 예산 확인 |
| `classifyImageAssetError()` | :787 (export됨) | 실패 분류 |

**앞의 셋은 모듈 private이다. 새 함수도 반드시 같은 파일에 둔다.** export를 늘려 다른 모듈에서 호출하면 예산 집계를 우회하는 경로가 생긴다.

### 프롬프트 구성

`buildDesignImagePrompt()`(:166)를 재사용하되 슬라이드 컨텍스트를 넣는다. 기존 `designImageSlideContextSchema`가 이미 `title` / `text[]` / `theme{primaryColor, secondaryColor, accentColor, backgroundColor}`를 받는다.

`atmosphere`일 때 프롬프트에 다음을 고정 문구로 넣는다.

```
- 텍스트·글자·로고를 포함하지 않을 것 (슬라이드에 텍스트가 따로 올라감)
- 중앙부는 시각적으로 조용하게 (텍스트 가독성 확보)
- 팔레트: {focal}, {secondary}, {dominant}
```

### 예산·실패 정책

```
슬라이드당 AI 이미지 최대 1장
remainingDailyBudget() 초과      → 생성 생략, 플레이스홀더를 style된 rect로 대체 + warnings
생성 실패 / 타임아웃(25초)        → 동일
Openverse 결과 없음               → atmosphere로 강등 후 1회 재시도, 그래도 실패면 위와 동일
```

**이미지 생성 실패는 리디자인 실패가 아니다.** 레이아웃·배색·장식은 그대로 살려서 proposal을 보낸다.

### 계약 변경

- `designAgentCapabilities.canGenerateImages = true`
- `slideStylePatchSchema.backgroundImage` 사용 개시 (PR1에서 이미 뚫어둠)

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T9.1 | `needs_generation` 슬롯 1개 | provider 1회 호출 |
| T9.2 | 예산 초과 | provider 미호출, warnings 존재, operations는 유지 |
| T9.3 | provider 예외 | 동일 |
| T9.4 | 타임아웃 25초 초과 | 동일 |
| T9.5 | `evidence` 역할 | Openverse 호출, gpt-image-1 미호출 |
| T9.6 | Openverse 결과 없음 | atmosphere 재시도 1회 |
| T9.7 | 슬롯 2개 | AI 이미지는 1장만 (나머지는 플레이스홀더) |
| T9.8 | `atmosphere` 프롬프트 | "텍스트 미포함" 문구 포함 확인 |
| T9.9 | 생성 결과 | `purpose: "design-asset"`으로 저장 |
| T9.10 | 전체 파이프라인 | 이미지 포함 proposal이 `applyDeckPatch` 통과 |

### 완료 조건

```bash
pnpm --filter @orbit/worker test && pnpm --filter @orbit/api test && pnpm typecheck
cd services/python-worker && uv run pytest
```

- **T9.2/T9.3/T9.4가 전부 통과해야 한다.** 이미지 실패가 리디자인 전체를 죽이면 안 된다
- 수동 확인: 실제 API 키로 3종 슬라이드 생성 후 텍스트 가독성 육안 검사

---

## 14. PR10 — 배색안 제시와 선택

브랜치: `feature/slide-redesign-color-options`
선행: PR9 / 예상: 2.5일 (Python + API + 웹)

### 목표

강조색·배경을 AI가 임의로 확정하지 않고 **3안을 보여주고 사용자가 고르게** 한다 (D11). M1의 `derive_palette`는 기존 테마를 유지하기만 했다.

### 이미 있는 것

| 자산 | 위치 | 비고 |
| --- | --- | --- |
| `generate_deck_color_options()` | `services/python-worker/app/ai/color_options.py:297` | **정확히 3안** 반환. LLM 실패 시 `fallback_color_options()`로 자동 폴백 |
| `POST /ai/deck-color-options` | `services/python-worker/app/main.py` | 라우트 존재 |
| `POST /deck-color-options` | `apps/api/src/generate-deck/deck-color-options.controller.ts` | API 엔드포인트 존재 |
| `deckColorOptionsResponseSchema` | `packages/shared` | 계약 존재 |
| `ensure_accessible_options()` | `color_options.py:442` | 대비 보정 |

**웹 UI만 없다.** Python·API는 그대로 재사용한다.

`DeckColorOption` = `{ optionId, name, palette, rationale }`,
`DeckColorPalette` = `{ primary, secondary, background, surface, muted, border, text, accentColor }`.

### 흐름

```
리디자인 요청
  └→ 배색 3안 생성 (기존 테마 유지안 + 새 제안 2안)
       └→ 각 안으로 컴파일한 프리뷰 썸네일을 챗에 표시
            └→ 사용자가 선택
                 └→ 선택한 안으로 최종 proposal 생성
```

**첫 번째 안은 항상 "현재 테마 유지"다.** 사용자가 색을 안 바꾸고 배치만 바꾸고 싶을 수 있다.

### 변경 파일

```
services/python-worker/app/ai/slide_redesign/palette.py        # 확장
packages/shared/src/deck/slide-redesign.schema.ts              # 신규
apps/api/src/design-agent/design-agent.service.ts              # 선택 반영
apps/web/src/features/editor/design-agent/components/          # 신규 UI
```

```python
# palette.py 확장
def build_palette_options(
    theme: dict[str, Any], summary: dict[str, Any],
    *, model: str, api_key: str | None, client: Any | None = None,
) -> list[PaletteOption]:
    """[0]은 항상 기존 테마 유지안. [1][2]는 generate_deck_color_options 결과.
    모두 ensure_palette_contrast를 통과시킨다."""
```

```ts
// slide-redesign.schema.ts
export const slideRedesignPaletteOptionSchema = z.object({
  optionId: z.string().min(1),
  name: z.string().min(1),
  isCurrentTheme: z.boolean(),
  palette: z.object({
    dominant: themeColorSchema, surface: themeColorSchema,
    text: themeColorSchema, focal: themeColorSchema, secondary: themeColorSchema,
  }),
  rationale: z.string().max(500),
});
```

`createDesignAgentMessageRequestSchema`에 `selectedPaletteOptionId: z.string().optional()` 추가. 없으면 3안을 반환하고, 있으면 그 안으로 최종 proposal을 만든다.

### 웹 UI

`AiChatPanel`에 배색 선택 카드를 추가한다. 기존 `DesignProposalPreview`(before/after diff)를 그대로 쓰되 그 앞에 선택 단계를 둔다.

```
┌─ 배색을 골라주세요 ─────────────────┐
│ ○ 현재 테마 유지   [■][■][■]        │
│ ○ 차분한 블루      [■][■][■]        │
│ ○ 선명한 코럴      [■][■][■]        │
└─────────────────────────────────────┘
```

각 카드는 팔레트 스와치 3개(dominant / focal / secondary)와 한 줄 설명을 보여준다. 썸네일 렌더링은 비용이 크므로 **MVP는 스와치만** 표시하고, 실제 결과는 선택 후 기존 프리뷰로 확인한다.

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T10.1 | `build_palette_options` | 3개 반환, `[0].isCurrentTheme == True` |
| T10.2 | 모든 안 | `contrast_ratio(text, dominant) >= 4.5` |
| T10.3 | LLM 실패 | `fallback_color_options` 경로, 예외 없음 |
| T10.4 | `selectedPaletteOptionId` 없음 | proposal 없이 배색안만 반환 |
| T10.5 | `selectedPaletteOptionId` 있음 | 해당 팔레트로 proposal 생성 |
| T10.6 | 존재하지 않는 optionId | `BadRequestException` |
| T10.7 | `[0]` 선택 | 결과 팔레트의 `focal == theme.accent` |
| T10.8 | 웹 컴포넌트 | 3개 카드 렌더, 선택 시 콜백 |
| T10.9 | 접근성 | 카드가 라디오 그룹 role, 키보드 탐색 가능 |

### 완료 조건

```bash
cd services/python-worker && uv run pytest
pnpm --filter @orbit/shared test && pnpm --filter @orbit/api test && pnpm --filter @orbit/web test
pnpm typecheck && pnpm lint
```

- T10.7이 통과해야 한다. "현재 테마 유지"가 실제로 유지하지 않으면 선택지의 의미가 없다

---

## 15. PR11 — 비동기 Job과 진행표시

브랜치: `feature/slide-redesign-async-job`
선행: PR10 / 예상: 2.5일

### 목표

이미지 생성이 들어가면 응답이 10~25초가 된다. `design-agent-python.client.ts`의 타임아웃이 60초라 동기로도 "동작은" 하지만, 사용자에게 아무 피드백이 없고 실패 시 전부 날아간다. Job으로 옮기고 단계를 보여준다 (D6).

### 계약

**`packages/shared/src/jobs/job.schema.ts`**

```ts
// historicalJobTypeSchema에 "slide-redesign" 추가
// publicCreatableJobTypeSchema에는 넣지 않는다 —
// 기존 design-image-generation과 동일하게 design-agent 전용 엔드포인트로만 생성
```

**`packages/shared/src/deck/slide-redesign.schema.ts`** (PR10에서 만든 파일에 추가)

```ts
export const slideRedesignStageSchema = z.enum([
  "interpreting",   // 슬라이드를 읽는 중
  "composing",      // 구성을 고르는 중
  "coloring",       // 배색을 맞추는 중
  "ornamenting",    // 장식을 얹는 중
  "illustrating",   // 이미지를 만드는 중
  "verifying",      // 마무리 검토 중
]);

export const slideRedesignProgressSchema = z.object({
  jobId: z.string().min(1),
  stage: slideRedesignStageSchema,
  completedStages: z.array(slideRedesignStageSchema),
  previewProposal: designAgentProposalSchema.optional(),   // 2단계 프리뷰
});
```

### 단계별 예상 시간

| stage | 소요 | 비고 |
| --- | --- | --- |
| `interpreting` | ~0.5s | 텍스트 추출 + slideType 분류(LLM 1회) |
| `composing` | ~1.5s | 후보 필터 + 안전성 분석 + LLM 선택 1회 |
| `coloring` | ~1.0s | 배색 3안 생성 |
| `ornamenting` | ~0.1s | 결정론적 |
| `illustrating` | 10~25s | AI 이미지. 슬롯 없으면 건너뜀 |
| `verifying` | ~0.5s | 검증 |

### 2단계 프리뷰

`ornamenting` 완료 시점(약 3초)에 **플레이스홀더 상태의 proposal을 먼저 보낸다.** 사용자는 레이아웃·배색·장식을 바로 보고, 이미지는 완성되면 교체된다.

```
3초  → previewProposal 전송 (미디어 슬롯은 스타일된 rect)
25초 → 최종 proposal 전송 (이미지 채워짐)
```

이미지 단계가 없는 슬라이드(대다수)는 3초에 최종 결과가 나오므로 사실상 즉시 응답이다.

### WebSocket

공통 envelope(`roomId`, `sessionId`, `userId`, `payload`, `sentAt`)을 사용한다. 새 이벤트 타입을 만들지 말고 기존 Job 진행 이벤트 규약을 따른다.

### stale 처리

Job 진행 중 사용자가 슬라이드를 편집하면 `baseVersion`이 밀린다.

```
Job 완료 시 현재 deck의 version과 payload.baseVersion 비교
불일치 → proposal.status = "stale" (기존 designAgentProposalStatusSchema에 이미 있음)
        → "슬라이드가 변경되어 다시 시도해야 합니다" 안내
```

### 테스트

| # | 케이스 | 기대 |
| --- | --- | --- |
| T11.1 | Job 생성 | `type == "slide-redesign"`, status `queued` |
| T11.2 | `publicCreatableJobTypeSchema` | `slide-redesign` **미포함** |
| T11.3 | 단계 진행 | 6개 stage가 순서대로 방출 |
| T11.4 | 이미지 없는 슬라이드 | `illustrating` 건너뜀 |
| T11.5 | `ornamenting` 완료 | `previewProposal` 전송됨 |
| T11.6 | 최종 완료 | previewProposal과 다른 최종 proposal |
| T11.7 | 진행 중 슬라이드 편집 | 완료 시 `stale` |
| T11.8 | Job 실패 | `failed` + 사용자 메시지, 부분 결과 없음 |
| T11.9 | `refused-unsafe` | Job 없이 즉시 메시지 (Job을 만들지 않는다) |

### 완료 조건

```bash
pnpm --filter @orbit/shared test && pnpm --filter @orbit/api test && pnpm --filter @orbit/worker test
cd services/python-worker && uv run pytest
pnpm typecheck && pnpm lint
pnpm test:smoke --grep "slide redesign"
```

- T11.9가 통과해야 한다. 거부 응답에 Job을 만들면 사용자가 25초를 기다린 뒤 거부를 보게 된다
- E2E: 이미지 포함 리디자인 → 2단계 프리뷰 확인 → 적용 → undo 1회 복구

---

## 16. 리스크와 중단 조건

### M1

| 리스크 | 신호 | 대응 |
| --- | --- | --- |
| **cardinality 오계산** | T4.17 실패 | **PR4에서 멈춘다.** `sourceElementId` 기준이 아니면 참조 보존이 무의미하다 |
| **라운드트립 불일치** | T4.16 실패 | PR4에서 멈춘다 |
| **안전성 검사 위치 오류** | T5.4는 통과하는데 I4 실패 | 필터가 선택 이후에 있다는 뜻. PR5 순서 재확인 |
| **국소 편집 퇴행** | T5.5 실패 | `_should_attempt_redesign` 게이트가 새고 있다. §2.3 재확인 |
| **후보 전멸 빈발** | `safe_candidate_count == 0` 비율이 높음 | 폴백이 동작하므로 기능은 안전. 로그 수집 후 프리셋 추가 검토. 재시도 로직은 실측 이후 |
| **4:3 덱** | D5로 폴백 | 1차 릴리스 수용 |
| **LLM 호출 2회 지연** | `duration_ms` 관측 | 실측 후 1회 통합 또는 heuristic 전용 검토. M1은 2회 유지 |
| **`_build_deterministic_preset_proposal` 잔존** | 호출부 없는 dead code | 의도적. 테스트가 참조 중이므로 삭제 금지 |

### M2

| 리스크 | 신호 | 대응 |
| --- | --- | --- |
| **capability version 배포 순서 위반** | T7.10 실패, 또는 배포 중 `DesignAgentCapabilities` 파싱 오류 | §3.2의 ①②③ 순서 강제. Python이 `Literal["1","2"]`를 수용하기 전에 API를 배포하지 않는다 |
| **장식이 텍스트를 가림** | T7.4 실패, 시각 QA "요소 겹침" 항목 | 겹침 검사를 통과 못한 장식은 버린다. 장식은 없어도 되는 것이므로 항상 양보한다 |
| **이미지 재배치가 참조를 끊음** | T8.6 실패 | **PR8에서 멈춘다.** `update_element_frame`이 아니라 `delete+add`가 되고 있다는 뜻 |
| **이미지 개수 > 슬롯 개수** | T8.3 | 해당 후보만 unsafe. 슬롯 많은 컴포지션이 후보에 남아있으면 정상 동작 |
| **AI 이미지 비용 폭증** | `remainingDailyBudget` 소진 빈도 | 슬라이드당 1장 상한 + `decoration`은 도형으로 대체. 초과 시 조용히 폴백 |
| **생성 이미지 위에 텍스트가 안 읽힘** | 시각 QA "대비" 항목 | `atmosphere` 프롬프트의 "중앙부 조용하게" 문구. 실패 시 배경 오버레이 rect 추가 검토 |
| **배색 선택이 덱 톤을 깸** | 사용자 이탈, "현재 테마 유지" 선택률 | `[0]`을 항상 첫 번째·기본 선택으로 둔다. 선택률을 로그로 수집 |
| **이미지 단계 지연으로 이탈** | `illustrating` 구간 취소율 | 2단계 프리뷰가 대응책. 3초 프리뷰가 안 나가면 PR11 구현 오류 |

---

## 17. 일정

| PR | 내용 | 기간 | 위험도 |
| --- | --- | --- | --- |
| **M1** | | | |
| PR0 | 요소 보존 정책·안전성 판정 | 1일 | 중간 |
| PR1 | design_agent 모델 정합화 | 0.5일 | 낮음 |
| PR2 | 슬라이드 해석기 + provenance | 2일 | **높음** |
| PR3 | 컴포지션 후보 + 팔레트 | 1.5일 | 중간 |
| PR4 | provenance 매칭·안전성 필터·patch | 2.5일 | **높음** |
| PR5 | 파이프라인 결선 | 1일 | 중간 |
| PR6 | 통합 검증 | 1.5일 | 낮음 |
| | **M1 소계 — 출시 가능 지점** | **10일** | |
| **M2** | | | |
| PR7 | 장식 도형 레이어 | 2일 | 중간 |
| PR8 | 미디어 슬롯·기존 이미지 재배치 | 2일 | **높음** |
| PR9 | AI 이미지·배경 생성 | 2.5일 | 중간 |
| PR10 | 배색안 제시·선택 | 2.5일 | 중간 |
| PR11 | 비동기 Job·진행표시 | 2.5일 | 중간 |
| | **M2 소계** | **11.5일** | |
| | **전체** | **21.5일** | |

PR0과 PR1은 서로 의존하지 않으므로 병렬 가능하다. 그 외에는 순차다.

**PR6 종료 시점에 한 번 멈추고 실사용자 피드백을 받는 것을 권한다.** M2의 이미지·배색은 배치 품질이 신뢰할 만해진 다음에야 의미가 있고, M1 로그(`safe_candidate_count`, `refused-unsafe` 비율)가 M2 우선순위를 바꿀 수 있다.

### 요구사항 대응표

| 원 요구사항 | 담당 PR | 구간 |
| --- | --- | --- |
| 슬라이드 내용 재배치 | PR2~PR5 | M1 |
| 적절한 색감 선택 | PR3(대비 보정) + **PR10(3안 선택)** | M1 + M2 |
| 적절한 요소 생성·배치 | **PR7** (기본 도형 조합) | M2 |
| 적절한 이미지 생성·배치 | **PR9** (gpt-image-1 / Openverse) | M2 |
| 적절한 배경 생성 | **PR9** (`atmosphere` 역할) | M2 |

---

## 18. 참조

| 경로 | 용도 |
| --- | --- |
| `services/python-worker/app/ai/design_agent.py` | PR1 수정, PR5 훅 |
| `services/python-worker/app/ai/composition_library.py` | 재사용 (수정 금지) |
| `services/python-worker/app/ai/design_program.py` | `DeckDesignProgram` 등 |
| `services/python-worker/app/ai/color_options.py` | 대비 계산 |
| `services/python-worker/app/ai/deck_generation/design_planning.py` | `program_v2_slide_summary()` 출력 형태 기준 |
| `services/python-worker/app/main.py:1055` | `/ai/design-agent/propose` 라우트 |
| `services/python-worker/tests/test_design_agent.py` | `FakeClient` 테스트 패턴 |
| `apps/api/src/design-agent/design-agent.service.ts` | `applyDeckPatch` 검증(:152), proposal 생성 분기(:179) |
| `packages/editor-core/src/patches/applyPatch.ts` | `delete_element` 연쇄 효과, `removeElementReferences` |
| `packages/shared/src/deck/design-agent.schema.ts` | **M1은 변경 없음.** PR7에서 version·addableElementTypes 확장 |
| `packages/shared/src/deck/patch.schema.ts` | `slideStylePatchSchema` (변경 불필요) |
| `packages/shared/src/deck/slide-object.schema.ts` | 요소 role·fontWeight 정답, `shapeElementPropsSchema:119` |
| `packages/shared/src/deck/deck.schema.ts` | 참조 필드 확인용 |
| `docs/contracts.md` | 계약 변경 시 동반 갱신 (**M1 해당 없음 / M2 PR7·PR8·PR9·PR11 해당**) |
| `AGENTS.md` | 브랜치·PR 규칙 |

### M2 전용 참조

| 경로 | 용도 |
| --- | --- |
| `services/python-worker/app/ai/color_options.py:297` | `generate_deck_color_options` — 정확히 3안 반환 |
| `services/python-worker/app/ai/color_options.py:442` | `ensure_accessible_options` |
| `apps/api/src/generate-deck/deck-color-options.controller.ts` | 배색 API 엔드포인트 (이미 존재) |
| `apps/worker/src/image-asset-pipeline.ts` | `:361` 예산, `:505` 저장, `:601` 플레이스홀더 교체, `:787` 오류 분류 |
| `packages/shared/src/deck/design-image-generation.schema.ts` | 이미지 생성 계약 (이미 존재) |
| `packages/shared/src/jobs/job.schema.ts` | PR11에서 `slide-redesign` 추가 |
| `services/python-worker/app/ai/design_library/icon-map.json` | **사용하지 않는다.** 14개짜리 미사용 자산 (D9) |
