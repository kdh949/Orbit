# Deck·Editor 계약

> 인덱스: [ORBIT 공통 계약](../contracts.md)
>
> 런타임 source of truth는 `packages/shared` schema와 서비스 validation이다.

## Deck JSON 구조

덱의 원본 데이터는 Konva 상태가 아니라 deck JSON이다. 편집기, AI 생성, 협업, 발표, 리허설은 모두 이 deck JSON을 기준으로 연결한다.

```json
{
  "deckId": "deck_demo_1",
  "projectId": "project_demo_1",
  "title": "Demo Deck",
  "version": 1,
  "targetDurationMinutes": 10,
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
      "slideId": "slide_1",
      "order": 1,
      "title": "Opening",
      "thumbnailUrl": "/files/thumbnails/slide_1.png",
      "estimatedSeconds": 60,
      "transition": {
        "type": "fade",
        "durationMs": 700
      },
      "style": {
        "layout": "title-content",
        "backgroundColor": "#ffffff"
      },
      "speakerNotes": "발표자 노트",
      "keywords": [
        {
          "keywordId": "kw_1",
          "text": "ORBIT",
          "synonyms": ["발표 도우미"],
          "abbreviations": [],
          "required": true,
          "requiredOccurrenceIds": ["kwo_slide_1_kw_1_0_5"]
        }
      ],
      "elements": [
        {
          "elementId": "el_1",
          "type": "text",
          "role": "title",
          "x": 120,
          "y": 80,
          "width": 480,
          "height": 120,
          "props": {
            "text": "ORBIT",
            "fontSize": 48
          }
        }
      ],
      "animations": [
        {
          "animationId": "anim_1",
          "elementId": "el_1",
          "type": "fade-in",
          "order": 1,
          "startMode": "on-click",
          "durationMs": 400,
          "delayMs": 0,
          "easing": "ease-out"
        }
      ],
      "actions": [
        {
          "actionId": "act_1",
          "trigger": {
            "kind": "keyword",
            "keywordId": "kw_1"
          },
          "effect": {
            "kind": "play-animation",
            "animationId": "anim_1"
          }
        }
      ]
    }
  ]
}
```

결정 사항:

- DeckSchema 최상위 필드는 `deckId`, `projectId`, `title`, `version`, `metadata`, `targetDurationMinutes`, `canvas`, `theme`, `slides`로 구성한다.
- `deckId`, `projectId`, `title`, `version`, `canvas`, `slides`는 필수로 검증한다.
- `metadata`, `theme`는 생성 입력에서 생략할 수 있지만, schema parse 후 normalized Deck JSON에는 항상 포함한다.
- `targetDurationMinutes`는 발표 전체 목표 시간(분)이며 양의 정수만 허용한다. 생략 시 AI 덱 생성 요청 기본값과 같은 `10`으로 정규화한다.
- `width`, `height`는 top-level에 두지 않고 반드시 `canvas.width`, `canvas.height`로 둔다.
- 지원하는 deck canvas preset은 `wide-16-9`와 `standard-4-3`이다.
- `wide-16-9`는 `1920x1080`, `standard-4-3`은 `1024x768`만 허용한다.
- `aspectRatio`는 preset에 맞는 문자열 literal로 검증한다.
- 모바일 세로형 `1080x1920`은 1차 스프린트 계약에 포함하지 않고, 필요 시 `portrait-9-16` preset으로 추가한다.
- `metadata.language`는 `"ko"`만 허용한다.
- `metadata.locale`은 `"ko-KR"`만 허용한다. STT, 날짜/시간, 지역별 포맷이 필요한 기능은 `locale`을 기준으로 처리한다.
- `metadata.language`와 `metadata.locale`은 생략 시 각각 `"ko"`, `"ko-KR"`로 기본값을 채운다.
- AI 생성 deck은 `metadata.sourceType = "ai"`, `metadata.generatedBy = "ai"`, `metadata.audience`, `metadata.purpose`, `metadata.tone`, `metadata.presentationProfile`, `metadata.createdFrom`을 선택적으로 포함할 수 있다. 생성 QA 결과가 있으면 `metadata.generationQuality`에 `passed | advisory | unavailable` 상태와 `{ code, message, severity, slideId?, slideOrder? }[]`를 저장하며 Editor AI 코치의 검사 패널이 이를 표시한다.
- `/createdeck`의 design-pack deck은 `metadata.presentationProfile`에 `proposal`, `executive-report`, `product-launch`, `education`, `technical`, `research`, `general-inform` 중 하나를 저장한다. 기존 legacy/import deck은 이 필드를 생략할 수 있다.
- `program-v2` deck은 `metadata.designProgramSnapshot`에 visual concept, palette role, typography, background sequence, image/surface style과 사용한 composition ID를 기록한다. 기존 Deck은 이 필드를 생략할 수 있다.
- 신규 AI 생성 Deck의 첫 슬라이드는 `cover-classic-corporate`, `cover-visual-impact`, `cover-immersive-background`, `cover-research-author`, `cover-structured-report`, `cover-modern-high-tech` 중 하나를 사용한다. `minimal-cover`, `hero-full-bleed` 등 기존 composition ID는 저장된 Deck과 진행 중인 과거 Job의 호환을 위해 계속 parse한다.
- Imported PPTX OOXML decks may set `metadata.thumbnailSource = "import-render"`. The editor keeps current-slide thumbnails in browser memory and does not update Deck versions only to refresh thumbnails.
- `metadata.createdFrom.references`는 생성에 사용한 참고자료의 `{ fileId }[]`만 저장한다. URL ingestion과 원문 저장은 이번 계약에 포함하지 않는다.
- 과거 AI 생성 Deck의 `metadata.createdFrom.designReferences`는 `{ fileId }[]`로 계속 parse한다. 신규 GenerateDeck request에는 이 필드가 없으며 새 Deck은 빈 배열로 저장한다.
- `theme`는 생략 시 기본 theme token 값으로 채운다.
- `theme`는 deck 전체의 기본 디자인 토큰이다.
- MVP `theme` 필드는 `name`, `fontFamily`, `backgroundColor`, `textColor`, `accentColor`, `palette`, `typography`, `effects`로 제한한다.
- `theme.palette`는 `primary`, `secondary`, `surface`, `muted`, `border`를 사용한다.
- `theme.typography`는 `headingFontFamily`, `bodyFontFamily`, `titleSize`, `headingSize`, `bodySize`, `captionSize`를 사용한다.
- `theme.effects`는 `borderRadius`, `shadow`를 사용한다. 복잡한 blur, blend mode, gradient token은 1차 스프린트 MVP에서 제외한다.
- object와 slide의 실제 스타일 값은 `theme`를 기본값으로 삼되, 개별 object props에 명시된 값이 있으면 object props가 우선한다.
- 스타일 해석 우선순위는 `object props` > `slide style` > `deck.theme` > `schema fallback`이다.
- 1차 스프린트 MVP부터 AI 생성 결과가 슬라이드별 디자인을 지정할 수 있도록 `slide.style`을 허용한다.
- MVP `slide.style` 필드는 `layout`, `fontFamily`, `backgroundColor`, `textColor`, `accentColor`, `backgroundImage`로 제한한다.
- `slide.style.layout`은 `title`, `title-content`, `agenda`, `section`, `two-column`, `image-left`, `image-right`, `chart-focus`, `quote`, `closing`만 허용한다.
- `slide.style.backgroundImage`는 `src`, `alt`, `fit`, `opacity`를 사용하고, `fit`은 `contain`, `cover`, `stretch`만 허용한다.
- `slide.style`이 생략되면 schema parse 후 `{}`로 정규화하고, renderer/export/AI normalize 단계에서 필요한 값은 `deck.theme`에서 해석한다.
- 슬라이드 배경은 `slide.style.backgroundImage` > `slide.style.backgroundColor` > `deck.theme.backgroundColor` 순서로 해석한다.
- 신규 AI 생성 slide의 단색 canvas 배경 원본은 `slide.style.backgroundColor`다. 같은 색을 full-canvas `background` element로 중복 생성하지 않는다.
- PPTX import와 기존 Deck 호환을 위해 이미 존재하는 full-canvas `background` element는 보존할 수 있으며, 이 경우 배경 변경 동작은 `slide.style.backgroundColor`와 element fill을 함께 동기화한다.
- `theme` 변경은 기존 `slide.style`이나 object props를 자동으로 덮어쓰지 않는다. 전체 테마 적용은 별도의 apply theme 동작으로 처리한다.
- `slides`는 최소 1개 이상이어야 한다. 새 덱 생성 시에는 빈 덱 대신 기본 슬라이드 1장을 생성한다.
- SlideSchema 필드는 `slideId`, `order`, `title`, `thumbnailUrl`, `estimatedSeconds`, `transition`, `style`, `speakerNotes`, `elements`, `keywords`, `animations`, `actions`를 유지한다. `thumbnailUrl`은 imported/image-only slide처럼 `elements`가 비어 있는 발표자 렌더링 fallback에만 사용하고, 일반 편집 썸네일 캐시는 Deck에 저장하지 않는다.
- `slide.transition`은 destination slide가 소유하는 optional `{ type: "fade", durationMs }` 상태다. field가 없으면 transition 없음이며, 첫 slide와 transition이 없는 slide는 즉시 표시한다. `durationMs`는 양의 정수다.
- `estimatedSeconds`는 슬라이드별 목표 발표 시간(초)이며 선택 필드다. 생략된 경우 presenter UI는 `targetDurationMinutes / slides.length` 기반 균등 분배로 폴백한다.
- AI 생성 slide는 선택적 `aiNotes`를 포함할 수 있다. `aiNotes`는 `emphasisPoints`와 검토용 `sourceEvidence`만 담고, 디자인 전용 배열은 만들지 않는다.
- design-pack slide의 `aiNotes.timingPlan`은 선택적으로 `speakingTimeRatio`와 `targetSpokenSeconds`를 포함할 수 있다. `targetSeconds`는 전환을 포함한 장표 점유 시간이고 `targetSpokenSeconds`는 해당 장표의 발화 목표 시간이다. 기존 Deck은 두 필드를 생략할 수 있다.
- `program-v2` slide는 `aiNotes.compositionPlan`에 검증된 composition ID, variant, background mode, focal type, primary focal element ID, asset role과 필수 asset 여부를 기록한다. `primaryFocalElementId`가 있으면 같은 slide의 element를 가리켜야 한다.
- 신규 `program-v2` 결과에서 배경 모드의 canonical source는 slide order 순 `slide.aiNotes.compositionPlan.backgroundMode`이며, `metadata.designProgramSnapshot.backgroundSequence`는 같은 길이와 값을 유지하는 파생값이다. Art Director 응답의 중복 표현이 다르면 Python worker가 `slides[].backgroundMode`에서 `backgroundSequence`를 재구성한 뒤 검증하며, 이 불일치는 provider 재시도나 Job 실패 사유가 아니다.
- `order`는 사용자에게 보이는 슬라이드 번호와 맞춰 `1`부터 시작하는 양의 정수로 관리한다. 배열 index가 필요하면 애플리케이션 내부에서 `order - 1`로 변환한다.
- 1차 스프린트 MVP에서는 슬라이드별 크기 override를 허용하지 않는다. 모든 슬라이드는 deck top-level의 `canvas` 크기와 비율을 따른다.
- SlideSchema에는 `width`, `height`, `canvas`, `aspectRatio` 같은 슬라이드별 크기 필드를 두지 않는다.
- 슬라이드 식별자는 `slideId`, 객체 식별자는 `elementId`로 통일한다.
- Deck 내부 ID는 prefix를 강제한다. `deckId`는 `deck_`, `slideId`는 `slide_`, `elementId`는 `el_`, `animationId`는 `anim_`, `actionId`는 `act_`, `keywordId`는 `kw_`, `changeId`는 `change_`로 시작해야 한다.
- prefix 뒤에는 영문, 숫자, `_`, `-`만 허용한다.
- `projectId`, `fileId`, `jobId`, `sessionId`, `userId`, `runId`, `reportId`, `roomId`는 다른 도메인 소유 ID이므로 ORBIT-14 deck schema에서는 prefix를 강제하지 않고 non-empty string만 검증한다.
- 좌표 단위는 `px` 기준으로 한다.
- 지원하는 객체 타입은 `text`, `rect`, `ellipse`, `line`, `arrow`, `polygon`, `star`, `ring`, `image`, `group`, `customShape`, `chart`, `table`이다.
- 기존 임시 타입인 `shape`, `video`는 1차 스프린트 deck schema에서 허용하지 않는다.
- AI가 생성한 배경 이미지나 시각 요소, 장식, 강조 박스, 라인, 아이콘은 별도 `designElements` 배열을 만들지 않고 `slide.elements`에 넣는다. 단색 canvas 배경은 `slide.style.backgroundColor`를 사용한다.
- 객체 역할은 공통 `role` 필드로 표현하고, `background`, `decoration`, `title`, `subtitle`, `body`, `caption`, `media`, `chart`, `table`, `highlight`, `footer`만 허용한다.
- `role`은 렌더링 필수값이 아니라 AI 생성, 편집 UI, export, 접근성 보조를 위한 의미 정보다.
- `background`, `decoration` 역할의 element는 `role`과 낮은 `zIndex`로 의미를 표현한다. 기존 Deck 호환을 위해 `locked` 필드는 유지하지만 현재 에디터와 AI는 해당 값으로 편집을 차단하지 않는다.
- 객체 `props`는 object type별 schema로 검증한다. 전체 객체에 대해 `z.record(z.unknown())`를 열어두지 않는다.
- `text.props`는 `text`, `runs`, `paragraphs`, `bodyInset`, `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `italic`, `underline`, `color`, `align`, `verticalAlign`, `lineHeight`, `bullet`, `autoFit`, `fontScale`, `lineSpaceReduction`을 사용한다. paragraph와 run도 `letterSpacing`, `italic`, `underline`을 optional 값으로 보존한다. `letterSpacing`, `autoFit`, `fontScale`, `lineSpaceReduction`, `italic`, `underline`에는 schema default를 두지 않으므로 생략된 기존 Deck을 parse할 때 값을 materialize하거나 Deck version을 증가시키지 않는다. `letterSpacing`은 canvas px 단위다. `autoFit`은 `none | shrink-text | resize-shape`, `fontScale`은 원래 font size에 곱할 `0 < scale <= 1`, `lineSpaceReduction`은 percentage line spacing에서 뺄 `0..1` 비율이다. `runs`는 기존 단일 paragraph 호환 field이고, `paragraphs`는 PPTX OOXML import에서 paragraph별 run/font/color/spacing/indent/bullet을 보존하기 위한 optional field다. `bodyInset`은 PPT text box 내부 여백을 px 단위로 보존한다. 텍스트 element는 고정 frame을 사용하며 캔버스와 PPTX export는 frame 밖 내용을 clip한다. inline 편집기는 같은 frame 안에서 overflow 내용을 scroll한다. 품질 검사는 plain/rich/`vertical-270` 텍스트의 전체 측정 높이가 frame을 넘으면 `TEXT_OVERFLOW`로 보고한다.
- rich text의 canonical source는 `paragraphs` field가 존재할 때의 `paragraphs[]`다. paragraph에 `runs`가 하나 이상 있으면 해당 paragraph의 plain text는 run 순서대로 `run.text`를 이어 만든 값이고, 그렇지 않으면 `paragraph.text`다. 저장 전 각 `paragraph.text`를 이 값으로 동기화하고, top-level `text`는 모든 paragraph plain text를 순서대로 newline(`\n`) 하나로 이어 만든 projection으로 동기화한다.
- canonical paragraph가 하나이면 top-level `runs`는 그 paragraph의 `runs`와 내용·순서·style이 같은 compatibility mirror로 유지할 수 있다. paragraph가 둘 이상이면 newline 경계를 중복 표현하지 않도록 top-level `runs`를 제거한다. canonical source를 읽는 renderer, editor, exporter는 top-level `text`나 `runs`의 불일치 값을 우선하지 않는다.
- `paragraphs`가 없는 legacy text는 edit session 진입 시 in-memory adapter로 정규화한다. top-level `runs`가 있으면 run 순서와 style을 보존한 단일 paragraph를 만들고 그 run text를 이어 `paragraph.text`와 top-level `text`를 동기화한다. `runs`도 없으면 top-level `text`를 가진 단일 paragraph를 만든다. 이 adapter는 조회만으로 저장하거나 Deck version을 올리지 않으며, 사용자가 해당 element의 편집을 commit할 때만 canonical `paragraphs`를 해당 element에 저장한다.
- `text.props.fontFamily`, `text.props.color`가 생략되면 renderer/export/AI normalize 단계에서 각각 `slide.style.fontFamily` > `deck.theme.fontFamily`, `slide.style.textColor` > `deck.theme.textColor` 순서로 기본값을 사용한다.
- `image.props`는 `src`, `alt`, `fit`, `focusX`, `focusY`, `crop`을 사용하고, `fit`은 `contain`, `cover`, `stretch`만 허용한다. `focusX`, `focusY`는 `cover` crop 기준점이며 0부터 1 사이 값이다. `crop`은 OOXML `srcRect`를 left/top/right/bottom 0..1 비율로 보존한다.
- `chart.props`는 `chart.schema.ts`의 chart schema를 그대로 사용한다.
- `table.props`는 `rows`, `columnWidths`, `rowHeights`, `borderColor`, `borderWidth`를 사용한다. 각 cell은 `text`, `fill`, `textColor`, `fontFamily`, `fontSize`, `fontWeight`, `align`, `verticalAlign`, `borderColor`, `borderWidth`, `colSpan`, `rowSpan`을 보존한다. 병합은 직사각형 범위의 좌상단 cell에 실제 `colSpan`·`rowSpan`을 기록하고 범위 안의 나머지 raw cell은 `colSpan=1`, `rowSpan=1` 상태로 보존한다. renderer와 exporter는 좌상단 anchor만 표시하며 병합 해제 시 보존된 raw cell의 내용과 style을 복원한다. 범위를 벗어나거나 서로 겹치는 span은 편집·내보내기에서 fail-closed한다.
- `rect`, `ellipse`, `line`, `arrow`, `polygon`, `star`, `ring`은 공통 shape props인 `fill`, `stroke`, `strokeWidth`, `borderRadius`, `dash`, `lineCap`, `lineJoin`, `shadow`를 사용한다. `fill`/`stroke`는 `#RRGGBB`, `transparent`, linear gradient paint를 허용한다.
- `customShape.props`만 MVP 확장 지점으로 `record unknown`을 허용한다.
- `group.props`는 `childElementIds`만 가진다.
- group은 child element를 직접 중첩하지 않는다. 실제 child element는 `slide.elements` flat list에 그대로 두고, group은 `childElementIds`로 묶음 관계만 표현한다.
- group의 `childElementIds`는 `el_` prefix를 따르는 `elementId` 목록이다.
- group의 child element 좌표는 group-local 좌표가 아니라 slide canvas 기준 절대 좌표로 유지한다.
- 객체 좌표 `x`, `y`는 finite number여야 하고, `width`, `height`는 `0`보다 커야 한다.
- `x`, `y`의 허용 범위는 `-1,000,000` 이상 `1,000,000` 이하이며, 범위를 벗어난 Deck과 frame patch는 거부한다.
- 사용자가 객체를 캔버스 밖에 일부 또는 전체 배치할 수 있도록 음수 좌표와 canvas 크기를 넘는 좌표를 허용하며, 저장 시 해당 좌표를 보존한다.
- renderer와 exporter는 canvas 경계 밖의 객체 영역을 표시 영역에서 clip한다.
- 캔버스 밖 좌표는 편집과 저장에서 보존하며, PPTX import/export에서도 임의로 안쪽 좌표로 보정하지 않는다.
- 객체 공통 상태 필드는 `rotation`, `opacity`, `zIndex`, `locked`(하위 호환용), `visible`을 사용한다.
- `opacity`는 `0`부터 `1`까지만 허용하고, `zIndex`는 `0` 이상의 정수만 허용한다.
- `chart` 객체의 `props`는 `chart.schema.ts`로 검증하며, 지원하지 않는 chart type은 거부한다.
- 지원하는 chart type은 `bar`, `line`, `pie`, `doughnut`, `scatter`이다.
- 모든 chart type은 사용자가 빈 차트에서 직접 데이터를 채울 수 있도록 `data: []`를 허용한다.
- `bar`, `line`의 data는 `{ label, value }[]` 구조를 사용하고, `value`는 음수와 양수를 모두 포함한 finite number만 허용한다.
- `pie`, `doughnut`의 data는 `{ label, value }[]` 구조를 사용하고, `value`는 `0` 이상의 finite number만 허용한다.
- `scatter`의 data는 `{ label?, x, y }[]` 구조를 사용하고, `x`, `y`는 finite number만 허용한다.
- chart 디자인 필드는 `style.colors`, `style.backgroundColor`, `style.textColor`, `style.fontFamily`, `style.titleFontSize`, `style.axisLabelFontSize`, `style.legendFontSize`, `style.dataLabelFontSize`, `style.showLegend`, `style.legendPosition`, `style.showDataLabels`, `style.showGrid`, `style.xAxisTitle`, `style.yAxisTitle`, `style.unit`을 사용한다.
- `chart.style.fontFamily`가 생략되면 renderer/export/AI normalize 단계에서 `slide.style.fontFamily` > `deck.theme.typography.bodyFontFamily` > `deck.theme.fontFamily` 순서로 기본값을 사용한다.
- `chart.style.titleFontSize`, `axisLabelFontSize`, `legendFontSize`, `dataLabelFontSize`가 생략되면 renderer/export/AI normalize 단계에서 `deck.theme.typography` 값을 기준으로 해석한다.
- multi-series chart 구조는 1차 스프린트 MVP 계약에 포함하지 않고, import/export와 편집 UI 구현 중 필요성이 확인되면 별도 확장한다.
- 지원하는 애니메이션 타입은 `appear`, `disappear`, `fade-in`, `fade-out`, `zoom-in`, `zoom-out`, `rotate`이다.
- `slide-in`, `none`은 1차 스프린트 MVP animation type에 포함하지 않는다. animation이 없으면 animation 객체를 만들지 않는다.
- 애니메이션은 element 단위를 기본으로 하고, `slide.animations` flat list에 저장한다.
- `element.animations`에는 저장하지 않는다.
- 각 animation은 `anim_` prefix를 따르는 `animationId`와 `el_` prefix를 따르는 `elementId`를 필수로 가지고 대상 객체를 참조한다. slide 단위 animation은 1차 스프린트 MVP에서 제외한다.
- animation `order`는 `1`부터 시작하는 양의 정수로 관리한다.
- animation `startMode`는 `on-slide-enter | on-click | with-previous | after-previous` 중 하나다. `order`는 stable logical sequence만 나타내며 같은 `order` 자체는 동시 실행 의미를 갖지 않는다. `on-slide-enter`와 `on-click`은 root를 만들고, `with-previous`는 직전 logical effect와 같은 base reference, `after-previous`는 직전 effect 종료를 base reference로 사용한다. root 앞의 첫 `with-previous`는 slide entry, 첫 `after-previous`는 destination slide transition end를 기준으로 한다.
- 새 animation authoring의 기본 `startMode`는 `on-click`이다. 기존 raw Deck에서 `startMode`가 생략된 animation은 editor-core가 schema parse 전에 같은 legacy `order`별로 묶어 one-time 정규화한다. group 안에 `play-animation` action 참조가 하나라도 있으면 누락된 root는 `on-click`, 없으면 `on-slide-enter`, 나머지 누락 follower는 `with-previous`가 된다. 이미 명시된 `startMode`와 legacy `order` 값은 변경하지 않으며 다음 저장 시 정규화된 mode가 Deck JSON에 영속화된다.
- `durationMs`, `delayMs`, `easing`은 입력에서 생략할 수 있지만, schema parse 후 normalized Deck JSON에는 각각 `400`, `0`, `"ease-out"` 기본값으로 포함한다.
- `easing`은 `linear`, `ease-in`, `ease-out`, `ease-in-out`만 허용한다.
- `slide.keywords[]`는 `required` boolean을 포함한다. 이 값은 발표 중 반드시 언급해야 하는 keyword 여부를 나타내며 기본값은 `true`다.
- `slide.keywords[].requiredOccurrenceIds`는 선택 필드이며, 필수 발화로 표시할 speaker notes 내 특정 keyword occurrence ID만 저장한다. 값이 있으면 같은 slide의 현재 `speakerNotes`에서 재계산 가능한 occurrence이고 해당 keyword에 속해야 한다.
- 애니메이션 trigger, 다음 슬라이드 trigger 같은 발표 제어 분류는 keyword 필드에 중복 저장하지 않고 연결된 `slide.actions`로부터 파생한다.
- 키워드 기반 authored action은 `slide.actions` flat list에 저장한다.
- 각 action은 `act_` prefix를 따르는 `actionId`와 `cue`, legacy `keyword`, 또는 `keyword-occurrence` 기반 trigger를 가진다.
- action effect는 `play-animation`, `go-to-next-slide`만 허용한다.
- `play-animation` effect는 같은 slide 안에 있는 `animationId`만 참조할 수 있다.
- `play-animation` action은 `on-click` root chain만 가리킬 수 있다. follower를 가리켜도 해당 root chain 전체를 실행하며, action trigger는 main timeline을 대체하지 않고 이미 계획된 root를 실행하는 overlay로 동작한다.
- `keyword` trigger는 같은 slide 안에 있는 `keywordId`만 참조할 수 있다.
- `keyword-occurrence` trigger는 같은 slide 안에 있는 `keywordId`와 현재 `speakerNotes`에서 재계산 가능한 `occurrenceId`를 함께 참조해야 한다.
- `keyword-occurrence.occurrenceId`는 `kwo_` prefix를 따르고, opaque string으로 취급한다. 현재 권장 형식은 `kwo_<slideId>_<keywordId>_<start>_<end>`이며 `start`, `end`는 `speakerNotes` UTF-16 index 기준이다.
- 밑줄 애니메이션은 1차 스프린트 MVP가 아니라 폴리싱 범위로 둔다.
- AI 생성 결과도 최종적으로 deck JSON으로 변환한다.
- 리허설은 `speakerNotes`, `keywords.text`, `keywords.synonyms`, `keywords.abbreviations`를 기준으로 연결한다.
- 협업/발표 동기화는 `deck_`, `slide_`, `el_`, `anim_` prefix를 따르는 `deckId`, `slideId`, `elementId`, `animationId` 기준으로 처리한다.

### Semantic Cue lifecycle 계약

`slide.semanticCues`가 Semantic Cue의 canonical 저장 위치다. 기존 cue의 `required`, `priority`는 호환 필드로 유지하고, 사용자 검토와 최종 평가에는 다음 lifecycle 필드를 사용한다.

- `importance`: `core | supporting | optional`, 기본값 `supporting`
- `reviewStatus`: `suggested | approved | excluded`, 기본값 `suggested`
- `freshness`: `current | stale`, 기본값 `current`
- `origin`: `ai | manual | imported`, 기본값 `imported`
- `revision`: 1부터 시작하는 양의 정수, 기본값 `1`
- `cueType`: `definition | problem | cause | solution | result | warning | lesson | transition | closing`
- `reportLabel`: 최대 80자, `presenterTag`: 최대 40자
- `sourceDeckVersion`: source가 확정된 양의 deck version
- `sourceFingerprint`: 8~128자의 source identity hash
- `sourceRefs`: 최대 16개의 `{ kind, refId?, sourceHash }`
- `qualityWarnings`: 최대 12개의 80자 이하 warning

의미 판정 보조 필드는 다음 책임을 가진다.

- `candidateKeywords`: cue 후보 검색을 위한 1~4개의 구별력 있는 표면 표현이며, 단독으로 의미 전달 완료를 증명하지 않는다.
- `aliases`: 하나의 canonical term에 대한 발음, 약어, 번역, STT 변형의 any-of 그룹이다. 기술 용어, 코드 식별자, 약어, 영문 용어는 대체 표현이 있으면 반드시 같은 그룹에 둔다.
- `requiredConcepts`: 발표자가 모두 전달해야 하는 1~4개의 중복 없는 canonical concept이다. 번역어나 약어를 별도 concept으로 중복 저장하지 않는다.
- `nliHypotheses`: 같은 cue 전체를 동등하게 표현하는 1~3개의 발표자 중심 문장이다. 각 문장은 모든 required concept과 그 관계를 독립적으로 포함해야 하며 cue 일부를 hypothesis별로 나누지 않는다.
- `negativeHints`: cue의 핵심 관계를 뒤집거나 대체하는 0~3개의 완전한 hard-negative 문장이다. live pairwise NLI와 post-run semantic evaluator의 close false-positive 방지 문맥으로 사용하며, 단순 단어 조각이나 관련 없는 주제를 저장하지 않는다.

`sourceRefs[].kind`는 `slide-title | speaker-notes | element | table | chart | image-analysis`이며 `sourceHash`는 8~128자다. source text는 NFC 정규화, 연속 공백 축소, trim 후 SHA-256을 계산한다. `sourceFingerprint`는 정렬된 `(kind, refId, sourceHash)` 목록과 cue type, normalized required concept의 stable JSON SHA-256이다.

legacy cue는 parse 시 `suggested/current/imported/revision=1`로 정규화한다. 기존 `required=true`만으로 `approved`로 승격하지 않으며 승인 전 최종 coverage 분모에 포함하지 않는다. 검토 UI 저장 시 호환값은 `core → required=true, priority=1`, `supporting → required=false, priority=2`, `optional → required=false, priority=3`으로 함께 기록한다. 표시 label fallback은 `reportLabel ?? meaning`, presenter tag fallback은 `presenterTag ?? reportLabel ?? meaning`이며 AI 분석 결과가 아닌 UI 표시 fallback이다.

구현 위치:

- `packages/shared/src/deck/deck.schema.ts`: deck, slide style, slide, keyword schema와 타입
- `packages/shared/src/deck/id.schema.ts`: deck 내부 ID prefix schema와 타입
- `packages/shared/src/deck/patch.schema.ts`: deck patch operation, patch request, change record schema와 타입
- `packages/shared/src/deck/slide-object.schema.ts`: slide element schema와 element type
- `packages/shared/src/deck/animation.schema.ts`: animation schema와 animation type
- `packages/shared/src/deck/chart.schema.ts`: chart object props에서 사용할 chart schema
- `packages/shared/src/deck/theme.schema.ts`: deck/theme 기본 schema
- `packages/shared/src/index.ts`: shared public export만 담당

ORBIT-14 진행 중에는 위 구현 위치를 기준으로 계약을 변경한다. schema 파일의 의미와 유지보수 규칙은 `packages/shared/src/README.md`를 따른다.

## 참여 장표(Activity Slides) 계약

참여 장표는 Deck에 저장되는 정의와 PresentationSession별 DB runtime을 분리한다.

- Slide `kind`는 `content | activity | activity-results`다. 기존 `kind` 없는 Slide는 `content`로 정규화한다.
- `activity` Slide는 strict `ActivityDefinition`과 `activityAppearance: { mode: "system" | "editable" }`을 소유하고, `activity-results` Slide는 strict `{ sourceActivityId, display: "live", layout }` 참조만 소유한다. 기존 Activity slide에서 `activityAppearance`이 생략되면 `{ mode: "system" }`으로 정규화한다.
- Activity가 하나라도 있는 Deck은 `canvas.preset = "wide-16-9"`여야 한다. `activityId`는 Deck 안에서 유일하다.
- 정의에는 `pre-question | poll | satisfaction` template과 `rating | single-choice | multiple-choice | free-text` 문항만 허용한다.
- 만족도 조사는 최대 5문항, 사전 질문은 `free-text` 1~5문항, 투표는 선택지 2~8개의 `single-choice` 1문항이다.
- 평점 문항 aggregate는 `average`와 1~5점의 `value`, `count`, `ratio`를 모두 담은 `ratingDistribution`을 제공한다. 비평점 문항의 `ratingDistribution`은 빈 배열이다.
- 응답, aggregate, QR 이미지, audience URL, 입장 코드 숫자, response count는 Deck JSON과 `slide.elements`에 저장하지 않는다. 참여 QR 요소는 `type: "activity-qr"`, `props: { activityId }`로 activity ID만 참조하고, 질문 문구 요소는 `type: "activity-copy"`, `props: { activityId, field, fallbackText, textStyle }`로 `title | description`을 참조한다. 입장 코드 요소는 `type: "presentation-passcode"`이며 label과 placeholder style만 저장한다. editor·live renderer가 현재 `PresentationSession`에서 동적 값을 주입한다. activity run 생성은 발표 시작에서 명시적으로 수행하며, 편집·썸네일·미리보기 렌더링은 읽기 전용 조회만 한다. Deck 복제는 Activity-bound 참조를 remap하고, 원본 활동 장표 삭제는 연결된 QR와 copy 요소를 함께 제거한다. 정적 PPTX/PNG export에서는 runtime 요소를 안전한 안내 텍스트로 바꾼다.
- 결과 장표의 dangling `sourceActivityId`는 parse를 허용하고 editor/renderer에서 `source-missing` 복구 상태로 표시한다.
- semantic 정의 변경은 `update_activity_definition`, `update_activity_result_definition` 전용 operation을 사용한다. 참여 장표의 appearance, style, elements 전체 교체는 `replace_activity_design` 하나로 원자 적용하며 적용 후 전체 Deck을 다시 검증한다.

PresentationSession은 `deckId`, server가 읽은 `deckVersion`,
`sessionPurpose: presentation | rehearsal`, `audienceAccessEnabled`,
`passcode | public` 접근 방식, `startsAt`, `expiresAt`, active run과 retention
시각을 명시한다. 기존 row와 하위 호환 payload는
`sessionPurpose=presentation`, `audienceAccessEnabled=true`로 해석한다. 신규
session 생성 request는 `audienceAccessEnabled`가 없으면 fail-closed인
`false`로 정규화하되, 기존 `accessMode`가 있는 하위 호환 payload는 청중 접근
의 명시적 신호로 보고 `true`로 정규화한다. request는 `deckVersion`이나
Activity 정의를 받지 않는다.

- `audienceAccessEnabled=false`이면 `audienceUrl=null`이며 passcode hash 없이
  생성할 수 있다. `accessMode`는 저장되더라도 audience 접근 권한을 만들지
  않는다.
- `audienceAccessEnabled=true`이면 `sessionPurpose=presentation`이어야 하고
  `audienceUrl=/audience/:sessionId`를 반환한다. `passcode` mode는 4자리
  passcode가 필수이고 `public` mode는 passcode를 허용하지 않는다.
- `sessionPurpose=rehearsal`은 항상 `audienceAccessEnabled=false`이며 일반
  audience HTTP 진입, access cookie, audience Socket.IO room,
  `PresentationRun`, Activity Run을 허용하지 않는다.
- active session uniqueness, current 조회, replacement close, exact Deck version
  reuse는 `(projectId, sessionPurpose)` 범위에서 수행한다. 같은 project의
  presentation/rehearsal session은 동시에 유지할 수 있다.
- 동일 presenter, purpose, `deckId`, `deckVersion`의 active session만
  `reuseCurrent` 대상이다. companion-only presentation 요청이 이미 audience가
  활성화된 같은 presentation session을 만나면 기존 opt-in을 보존한다.
- audience entry, public info, join, access 검증은 DB의
  `audience_access_enabled=true`를 매 요청마다 다시 확인한다.
- 기본 접근 기간은 audience-enabled server command가 14일로 채우며
  companion-only session은 4시간으로 채운다. schema와 DB는 30일을 초과하는
  기간을 거절한다.
- 실전 발표와 리허설 preflight는 각각 `presentation`, `rehearsal` purpose의
  companion-only session을 exact `deckId`/`deckVersion`으로 ensure한다. 실전
  `PresentationRun`은 사용자가 실제 발표 시작을 선택할 때만 생성하며 같은
  session의 재시도는 기존 run을 반환한다. 리허설은 `PresentationRun`을
  생성하지 않는다.
- 청중 링크를 활성화하거나 비활성화할 때는 기존 presentation session의
  `PATCH .../:sessionId/access`를 사용해 companion identity를 보존한다.
  audience access가 꺼진 상태에서 Activity Run을 자동 생성하지 않으며,
  presenter UI는 먼저 청중 링크/QR에서 접근을 활성화하도록 안내한다.
- 실전 발표 종료와 리허설 종료는 자신이 ensure한 persisted session ID만
  명시적으로 close한다. rehearsal 종료는 presentation session이나 사용자가
  켠 presentation audience opt-in을 변경하지 않으며, presentation 종료는
  해당 presentation session의 audience entry도 함께 닫는다.

### iPad presenter companion HTTP 계약

Companion은 일반 audience identity와 분리된 presenter 보조 화면이다. runtime
flag `IPAD_PRESENTER_COMPANION_ENABLED=false`이면 아래 모든 endpoint는 인증
상태와 무관하게 고정 404로 닫히고 기존 발표·리허설·audience API에는 영향을
주지 않는다.

```text
POST   /api/v1/projects/:projectId/presentation-sessions/:sessionId/companion-pairings
GET    /api/v1/projects/:projectId/presentation-sessions/:sessionId/companion-status
DELETE /api/v1/projects/:projectId/presentation-sessions/:sessionId/companion
POST   /api/v1/presentation-companion/pairings/:code/exchange
GET    /api/v1/presentation-companion/:sessionId/bootstrap
GET    /api/v1/presentation-companion/:sessionId/assets/:fileId/content
```

- presenter endpoint는 project write 권한과 active session의 정확한
  `projectId`, `deckId`, `deckVersion`을 확인한다. pairing 생성과 disconnect는
  configured `WEB_ORIGIN`과 정확히 같은 origin에서만 허용한다.
- pairing 생성은 공개 HTTPS 기본 포트 origin만 허용한다. localhost,
  `.local`, loopback, link-local, private IP literal, 비기본 port에서는 code를
  발급하지 않는다. 응답은 `{ pairingUrl, expiresAt }`만 포함하고 raw code를
  별도 field로 반환하지 않는다.
- pairing code는 256-bit CSPRNG base64url이며 TTL은 2분이다. Redis key에는
  `SESSION_SECRET` HMAC digest만 저장하고 Lua GET+DEL로 원자 소비한다.
- exchange는 exact same-origin `application/json` POST와 trust-proxy 적용 후의
  client address HMAC rate limit를 통과해야 한다. 성공 시 code는 재사용할 수
  없고 새 `pairingGeneration`이 이전 companion credential을 즉시 무효화한다.
- companion credential은 `orbit_presentation_companion` signed HttpOnly,
  Secure, SameSite=Lax cookie다. payload는 `companionId`, `sessionId`,
  `projectId`, `deckId`, `deckVersion`, `pairingGeneration`, `scopes`,
  `expiresAt`, user-agent HMAC을 포함한다. TTL은 4시간과 session expiry 중
  이른 시점이다. 현재 scope는 `view-audience-output`,
  `write-annotation`, `view-prompter`, `control-presentation`이다.
- bootstrap과 asset은 매 요청마다 cookie signature와 user-agent,
  Redis 최신 generation, DB active session, exact Deck version을 모두 다시
  확인한다. session close, active session replacement, presenter disconnect는
  generation과 lease를 revoke한다.
- `CompanionDeckSnapshot`은 Deck alias가 아닌 strict allowlist다. 포함 field는
  `deckId`, `projectId`, `version`, `canvas`, `theme`와 slide의 audience
  rendering용 `slideId`, `kind`, `order`, `thumbnailUrl`, `transition`,
  `style`, `importRenderMode`, `elements`, `animations`, action 원문 없이
  파생한 `triggerAnimationIds`, 공개 activity projection뿐이다.
  `speakerNotes`, `keywords`, `semanticCues`, `actions`, `aiNotes`, Deck
  metadata, transcript, raw audio, script, run/report는 포함하지 않는다.
- companion의 activity, activity-results, activity-qr 렌더링은 presenter
  project API를 호출하지 않는다. companion credential로 보호되는
  `GET /api/v1/presentation-companion/:sessionId/activities/:activityId`가
  현재 run의 공개 `status`, audience URL, `ActivityPublicResult`만 반환한다.
  run이 없거나 session의 `audienceAccessEnabled=false`이면 이를 생성하지 않고
  URL과 결과가 모두 null인 공개 projection을 반환하며, presenter result와
  moderation 상태는 포함하지 않는다.
- 내부 render asset URL은 companion asset endpoint로 치환한다. 현재 exact
  Deck의 allowlisted render field가 실제 참조한 같은 project image만 읽을 수
  있다. canonical 상대 asset path와 configured `WEB_ORIGIN` 또는
  `API_BASE_URL`의 absolute URL만 내부 asset으로 인정한다. 같은 pathname을
  가진 다른 origin은 external URL로 유지하며 asset allowlist에 넣지 않는다.
  미참조 파일, owner-only purpose, audio, PDF는 404다. 기존 external HTTPS
  image는 그대로 허용하지만 server-side fetch proxy는 제공하지 않으며
  `data:`, `blob:`, `javascript:` 및 알 수 없는 scheme은 projection에서
  제거한다.

`passcode` 접근 방식은 검증용 Argon2id hash와 발표 화면 표시용
AES-256-GCM ciphertext를 별도로 저장한다. ciphertext는 `sessionId`를 AAD로
묶고 key version을 함께 보관하며 원문 입장 코드는 저장하지 않는다. 로그인 및
프로젝트 쓰기 권한을 통과한 발표자만
`GET /api/v1/projects/:projectId/presentation-sessions/:sessionId/presenter-access`
에서 `{ accessMode, displayPasscode }`를 조회할 수 있다. 기존 session처럼 표시용
ciphertext가 없거나 현재·이전 key로 복호화할 수 없으면 `displayPasscode`는
`null`이며 청중 입장 검증은 기존 Argon2id hash로 계속 동작한다.

실전 발표의 음성 실행 기록은 `presentation_runs`에 저장하며 `presentation_sessions`와 1:1 관계를 가진다. 이 기록은 `rehearsal_runs`, 리허설 비교·요약·집중 연습 계약과 분리한다.

- `recordingMode`는 `microphone | none`이며 마이크 없이 시작한 run도 청중 참여 세션을 그대로 사용한다.
- 상태는 `created | uploading | processing | succeeded | failed | cancelled`다.
- run 생성과 음성 완료는 동일한 `sessionId`, `runId`, `fileId`에 대해 멱등 동작한다.
- 음성 파일 purpose는 owner-only `presentation-audio`이며 전용 업로드 command를 통해서만 생성한다.
- 음성 분석은 internal `presentation-analysis` Job으로 실행하고 결과는 `presentation_runs.voice_report_json`에만 저장한다.
- 실전 발표 분석은 리허설 목표, 비교 기록, 프로젝트 연습 요약을 생성하거나 갱신하지 않는다.

실전 발표 run API는 다음 presenter-only 경로를 사용한다.

```text
POST /api/v1/projects/:projectId/presentation-sessions/:sessionId/runs
POST /api/v1/projects/:projectId/presentation-sessions/:sessionId/runs/:runId/audio-upload
POST /api/v1/projects/:projectId/presentation-sessions/:sessionId/runs/:runId/audio-complete
POST /api/v1/projects/:projectId/presentation-sessions/:sessionId/runs/:runId/retry-analysis
GET  /api/v1/projects/:projectId/presentation-sessions/:sessionId/runs
GET  /api/v1/projects/:projectId/presentation-sessions/:sessionId/runs/:runId
GET  /api/v1/projects/:projectId/presentation-sessions/:sessionId/runs/:runId/report
```

Activity Run 상태는 `draft | open | closed | results`이며 `version`은 정의 세대, `revision`은 상태·응답·moderation 변경 순서다. presenter/public/editor 결과는 별도 strict schema를 사용한다. public 결과에는 선택 이름, pending/hidden 주관식 원문, audience identity가 존재할 수 없다.

presentation WebSocket room은 다음처럼 project room과 분리한다.

```text
presentation:{sessionId}:presenter
presentation:{sessionId}:audience
presentation:{sessionId}:companion-authority:{authorityEpochId}
presentation:{sessionId}:companion:{pairingGeneration}
presentation:{sessionId}:companion:{pairingGeneration}:scope:{scope}
```

추가 event는 `active-activity-changed`, `activity-state-changed`, `activity-results-updated`다. 응답 write는 HTTP transaction에서 수행하고, WebSocket은 commit 후 `revision`, refetch marker, 공개 가능한 aggregate와 승인된 익명 text만 전달한다. audience event의 `userId`는 raw audience ID 대신 `system`을 사용한다.

Companion room은 일반 audience room과 cookie를 공유하지 않는다. presenter는
project write 권한을 확인한 뒤 10초 Redis authority lease를 얻은 tab 하나만
authority room에 들어간다. iPad는 companion cookie의 최신 generation을
확인한 뒤 해당 generation room 하나에 들어간다. server는 client payload의
room, role, `userId`를 신뢰하지 않고 인증된 socket state로 덮어쓴다.

Companion server event는 공통 strict envelope
`{ type, roomId, sessionId, userId, payload, sentAt }`을 사용한다.
`userId`는 `system`, HMAC pseudonym인 `presenter:<opaque>`,
`companion:<companionId>` 중 하나다. 주요 event는 authority
claim/change, join/heartbeat/presence, output state, annotation
command/ack/snapshot/request, volatile laser, WebRTC signal, revoke,
고정 `presentation:error`와 아래 프롬프터·이동 event다.

```text
presentation:companion:prompter-state
presentation:companion:navigation-command
presentation:companion:navigation-ack
```

- `output-state`는 `canGoPrevious`, `canGoNext`를 포함한다. 이전은 이전
  슬라이드로 이동하면서 animation step을 0으로 초기화하고, 다음은 남은
  animation step을 먼저 진행한 뒤 다음 슬라이드로 이동한다.
- `prompter-state`는 bootstrap/Deck projection과 분리된
  `view-prompter` scope 전용 self-contained snapshot이다. 현재 슬라이드의
  `slideId`, `slideIndex`, `prompterRevision`, `trackingStatus`,
  `progressPercent`, `focusSentenceId`와 `{ sentenceId, text, status }[]`만
  포함한다. raw transcript, raw audio, 전체 Deck script, timer/STT 설정은
  포함하지 않는다.
- prompter row는 최대 256개, row text는 최대 2,048자, 전체 JSON은 UTF-8
  128KiB 이하다. 비어 있거나 제한을 넘으면 row를 전송하지 않고
  `availability=empty | too-large`로 표시한다.
- `navigation-command`는 `control-presentation` scope, active authority,
  최신 `authorityEpochId`, 예상 `outputRevision`을 모두 확인한다. 한 iPad
  socket당 초당 6개, burst 6개로 제한하고 client는 한 번에 명령 하나만
  전송한다. presenter는 `clientOperationId`를 dedupe하고
  `accepted | at-boundary | stale-output | not-authority | rate-limited`
  ack를 반환한다.
- iPad는 승인 ack만으로 다음 명령을 열지 않고 더 높은 `outputRevision`을
  수신한 뒤 pending을 해제한다. 2초 안에 상태 변화가 없으면 고정 지연
  안내를 표시하며 데스크톱 발표 상태는 변경하지 않는다.
- 프롬프터 펼침 여부만 iPad localStorage
  `orbit.companion.prompter.expanded.v1`에 저장한다. 대본 row와 진행 위치는
  저장하지 않는다. 수동 스크롤 중에는 자동 따라가기를 멈추고 사용자가
  `현재 대본으로`를 선택하면 현재 문장으로 복귀한다.

- annotation normalized coordinate와 pressure는 `0..1`, relative time은
  `0..120000ms`, point batch는 64개, stroke는 4,096 points로 제한한다.
- surface snapshot은 500 strokes와 총 50,000 points를 넘을 수 없다.
  color는 제품 palette enum, normalized width는 `0.001..0.05`만 허용한다.
- Socket.IO message buffer는 위 bounded surface snapshot을 수용하도록 8MiB로
  제한한다. iPad annotation command queue는 최대 256개이며 한 번에 하나만
  ack 대기 상태로 전송한다. 1.5초 ack timeout, queue overflow, rejected ack는
  pending command를 폐기하고 current surface snapshot 재동기화로 전환한다.
- annotation command JSON은 UTF-8 32KiB 이하이며 socket별 Redis token
  bucket은 초당 120개, burst 180개다. laser는 초당 60개, burst 60개다.
- SDP는 32KiB, ICE candidate는 4KiB 이하의 strict union이다. signaling,
  annotation, laser payload는 로그에 남기지 않는다.
- `screen-share` output은 capture마다 새 opaque `shareEpochId`를 반드시
  포함하고, `slide`와 `black` output에는 이를 포함하지 않는다. 같은
  `shareEpochId`의 signaling은 offer, answer, ICE, end가 하나의
  `signalId`를 공유하며 다른 epoch 또는 negotiation ID는 폐기한다.
- `slide`와 `screen-share` output만 `surfaceId`, `surfaceRevision`을
  포함한다. `black` output에는 drawable surface가 없으며 annotation,
  snapshot request, laser command를 모두 거부한다.
- screen-share media는 same-origin audience stream bridge가 현재 capture를
  desktop authority에 전달하고 WebRTC sender에는 첫 video track만
  추가한다. audio track은 전송하지 않으며 `RTCPeerConnection`은 TURN
  server 없이 생성한다. peer 연결이 2초 안에 완료되지 않거나 실패해도
  desktop capture와 main audience output은 유지하고 iPad의 해당 share
  surface 쓰기만 비활성화한다.
- screen-share annotation 좌표는 source video content-local `0..1`이다.
  iPad 입력 canvas와 main audience overlay는 각 viewport에서 같은
  `contain` rect를 계산해 letterbox를 제외한다. capture 종료나 새
  `shareEpochId` 시작 시 이전 share surface state는 폐기하지만 slide
  surface state는 authority epoch 동안 보존해 slide 복귀 시 복원한다.
- annotation과 companion signaling은 body `sessionId`, 최신 generation,
  active `authorityEpochId`를 relay 직전에 다시 확인한다. annotation
  command는 presenter room 전체가 아니라 authority epoch room 하나에만
  전달한다.
- companion socket disconnect는 generation을 유지하고 matching generation의
  presence만 지운다. session close, replacement, presenter disconnect API는
  `revoked`를 generation room에 보낸 뒤 Redis adapter를 통해 해당 socket을
  끊는다.
- session close와 explicit revoke는 generation을 단조 증가하는 invalidation
  floor로 올리고 authority, presence와 아직 교환되지 않은 session별 pending
  pairing key를 단일 Redis 연산으로 즉시 정리한다. generation floor는 기존
  credential TTL 동안 유지해 같은 번호가 재발급되지 않게 한다. session
  expiry는 credential/session TTL, authority 10초,
  presence 15초, pending pairing 2분의 상한 안에서 같은 상태를 정리하며
  그 전에도 모든 credential 검증은 fail-closed한다. presenter socket만
  끊기면 authority lease만 만료시키고 companion generation은 credential
  TTL 안에서 reconnect할 수 있게 유지한다.

구현 위치:

- `packages/shared/src/activity`
- `packages/shared/src/deck/deck.schema.ts`
- `packages/shared/src/deck/patch.schema.ts`
- `packages/shared/src/presentation/presentation.schema.ts`
- `packages/shared/src/realtime/websocket.schema.ts`
- `packages/editor-core/src/patches/activitySlideOperations.ts`

## Deck 변경 요청과 변경 기록 구조

Deck JSON은 현재 덱의 최종 상태이고, DeckPatch는 덱에 적용할 변경 요청이다. AI 생성, 편집기, PPTX import는 전체 Deck JSON을 매번 다시 만들지 않고 patch operation을 생성한다. 서버나 editor-core는 patch를 현재 Deck에 적용한 뒤 최종 결과를 다시 `deckSchema`로 검증한다.

```json
{
  "deckId": "deck_demo_1",
  "baseVersion": 3,
  "source": "ai",
  "actorUserId": "user_demo_1",
  "operations": [
    {
      "type": "update_element_props",
      "slideId": "slide_1",
      "elementId": "el_1",
      "props": {
        "text": "핵심 메시지만 남긴 문장"
      }
    }
  ]
}
```

DeckPatch 결정 사항:

- `DeckPatchSchema`는 변경 요청이며, 실제 적용 완료 이력이 아니다.
- `deckId`, `baseVersion`, `operations`는 필수다.
- `source`는 `user`, `ai`, `import`, `system`만 허용하고, 생략 시 `user`로 정규화한다.
- `actorUserId`는 사용자 주체가 있을 때만 넣고, ORBIT-14에서는 prefix를 강제하지 않는다.
- `operations`는 1개 이상이어야 한다.
- `baseVersion`은 patch가 만들어진 시점의 Deck version이다. 현재 Deck version과 다르면 충돌로 보고 재시도하거나 병합 정책을 적용한다.
- patch 적용 후 `deck.version`은 애플리케이션 계층에서 증가시키고, 최종 Deck JSON은 `deckSchema`로 다시 검증한다.
- AI는 초기 덱 생성/import를 제외하고 전체 Deck JSON을 반환하지 않는다. 기존 덱 수정은 DeckPatch operation으로 반환한다.

지원하는 patch operation:

- `update_deck`: deck 제목, 전체 발표 목표 시간(`targetDurationMinutes`) 또는 metadata 수정
- `add_slide`: slide 전체 추가
- `update_slide`: slide 제목, thumbnail URL 또는 목표 발표 시간(`estimatedSeconds`) 수정. `estimatedSeconds=null`이면 개별 목표 시간을 제거한다.
- `update_slide_transition`: destination slide의 fade transition 전체 설정 또는 `null`로 제거
- `delete_slide`: slide 삭제
- `reorder_slides`: slide order 재정렬
- `update_theme`: deck theme token 부분 수정
- `update_slide_style`: slide style 부분 수정
- `add_element`: slide에 element 추가
- `update_element_frame`: element의 좌표, 크기, 회전, 투명도, zIndex, 잠금, 표시 상태, role 수정
- `update_element_props`: element props 부분 수정
- `delete_element`: element 삭제
- `update_speaker_notes`: 발표자 노트 교체
- `replace_keywords`: slide keyword 목록 전체 교체
- `replace_semantic_cues`: slide Semantic Cue 목록 전체 교체
- `add_animation`: animation 추가
- `update_animation`: animation 부분 수정
- `delete_animation`: animation 삭제
- `add_slide_action`: slide action 추가
- `update_slide_action`: slide action 부분 수정
- `delete_slide_action`: slide action 삭제
- `replace_activity_design`: Activity slide의 appearance, style, elements를 원자 교체
- `update_activity_definition`: Activity 질문 정의 전체 교체
- `update_activity_result_definition`: Activity 결과 장표 참조와 표시 설정 전체 교체

Semantic Cue cascade 규칙:

- `update_speaker_notes`와 text/table/chart의 의미 내용 변경은 기존 `reviewStatus`를 보존하고 해당 slide cue의 `freshness`만 `stale`로 바꾼다.
- frame 좌표, z-index, text/table/chart의 장식 style만 바뀌면 cue를 stale 처리하지 않는다.
- `delete_element`는 `targetElementIds`와 같은 element를 가리키는 `sourceRefs`를 제거하고, `delete_slide_action` 및 연쇄 삭제된 action은 `triggerActionIds`에서 제거한다.
- element/action reference가 제거된 cue는 stale이 되며, 최종 Deck은 다시 `deckSchema`로 검증한다.

Semantic Cue extraction 동시성 계약:

- public request는 `{ deckId?, force }`를 유지하고 `baseVersion`은 client 입력으로 받지 않는다.
- API는 enqueue transaction에서 deck row와 pending patch를 잠그고 patch를 replay한 checkpoint를 저장한 뒤, queue payload의 `request.baseVersion`에 materialized deck version을 고정한다.
- queue payload는 `{ jobId, projectId, request: { deckId, force, baseVersion } }` 구조를 사용한다.
- extraction slide result는 `succeeded | skipped | failed` 상태와 `semanticCues`, `warnings`를 포함하며 전체 result는 `sourceDeckVersion`을 포함한다.
- worker는 `succeeded` slide만 병합하고 skipped/failed/누락 slide의 기존 Cue를 보존한다.
- `force=false`는 manual/approved Cue 및 current imported Cue를 보존하고 stale 또는 AI suggested 후보만 교체한다. `force=true`도 manual/approved Cue는 보존한다.
- 저장은 deck `version=baseVersion`이고 `after_version > baseVersion`인 pending patch가 없을 때만 성공하는 compare-and-set을 사용한다.
- compare-and-set이 실패하면 job을 `SEMANTIC_CUE_DECK_VERSION_CONFLICT`로 종료하며 최신 사용자 편집을 덮어쓰지 않는다.
- 업무 이벤트 `semantic_cue.extraction.queued|succeeded|failed|version_conflict`에는 ID, version, count, reason만 기록하고 Cue 문구나 speaker notes는 기록하지 않는다.

patch 적용 규칙:

- `update_theme`, `update_slide_style`, `update_element_frame`, `update_animation`은 전달된 필드만 기존 값에 병합한다. `animationPatch.startMode`는 네 가지 explicit mode 중 하나만 허용한다.
- `update_slide_transition`은 transition full-state를 교체하고 `null`이면 field를 제거한다.
- `update_slide_style`에서 `layout`, `fontFamily`, `backgroundColor`, `textColor`, `accentColor`, `backgroundImage`에 `null`을 전달하면 해당 slide override를 제거한다.
- `update_theme.effects.shadow`에 `null`을 전달하면 theme shadow override를 제거한다.
- `update_element_frame.role`에 `null`을 전달하면 element role을 제거한다.
- `update_element_props.props`는 타입별 props의 부분 업데이트를 위해 `record unknown`으로 받는다. 다만 patch 적용 후 최종 element는 `deckElementSchema`가 검증해야 한다.
- `delete_slide`는 최소 1개 slide가 남아야 한다. 마지막 slide 삭제 요청은 적용 전에 `LAST_SLIDE_DELETE_FORBIDDEN`으로 거부한다.
- `reorder_slides`는 현재 slide ID 전체와 `1..N` order 전체를 각각 정확한 permutation으로 전달해야 한다. 누락·중복·알 수 없는 ID 또는 order는 `INVALID_SLIDE_REORDER`로 거부하고, 성공 시 order를 연속된 `1..N`으로 정규화한다.
- group의 child 삭제, animation 대상 element 삭제처럼 참조 무결성이 걸린 작업은 patch 적용 계층에서 정리한 뒤 최종 Deck 검증과 별도 참조 검사를 수행한다.

DeckChangeRecord는 검증된 patch가 실제 Deck에 적용된 뒤 저장하는 변경 이력이다.

```json
{
  "changeId": "change_1",
  "deckId": "deck_demo_1",
  "beforeVersion": 3,
  "afterVersion": 4,
  "source": "ai",
  "actorUserId": "user_demo_1",
  "createdAt": "2026-06-27T01:00:00+09:00",
  "operations": [
    {
      "type": "update_element_props",
      "slideId": "slide_1",
      "elementId": "el_1",
      "props": {
        "text": "핵심 메시지만 남긴 문장"
      }
    }
  ]
}
```

DeckChangeRecord 결정 사항:

- `DeckChangeRecordSchema`는 적용 완료된 변경 기록이다.
- `changeId`는 `change_` prefix를 강제한다.
- `beforeVersion`, `afterVersion`은 필수이고, `afterVersion`은 `beforeVersion`보다 커야 한다.
- `createdAt`은 offset이 포함된 ISO datetime 문자열을 사용한다.
- `operations`는 실제 적용된 patch operation 목록을 저장한다.
- undo/redo, history UI, 협업 동기화, 디버깅은 이 change record를 기준으로 확장한다.

구현 위치:

- `packages/shared/src/deck/patch.schema.ts`
- `packages/shared/src/deck/id.schema.ts`

## 덱 저장/복원 API 계약

ORBIT-15에서 추가하는 저장/복원 API 계약은 deck 자체 구조를 다시 정의하지 않고, API request/response envelope만 정의한다. NestJS API, web/editor, AI 생성 결과 적용 흐름은 같은 shared schema를 기준으로 payload를 검증한다.

상세 endpoint, request/response, 실패 코드, DB 저장 범위는 [덱 저장/복원 API 명세](api/deck-persistence.md)를 따른다.

MVP API:

- `GET /api/v1/projects/:projectId/deck`
- `PUT /api/v1/projects/:projectId/deck`
- `POST /api/v1/projects/:projectId/deck/patches`
- `GET /api/v1/projects/:projectId/snapshots`
- `GET /api/v1/projects/:projectId/snapshots/:snapshotId`
- `POST /api/v1/projects/:projectId/snapshots/:snapshotId/restore`

결정 사항:

- current deck payload는 기존 `DeckSchema`를 재사용한다.
- patch append request는 기존 `DeckPatchSchema`를 재사용한다.
- patch append response의 적용 완료 이력은 기존 `DeckChangeRecordSchema`를 재사용한다.
- `DeckChangeRecordSchema`에는 `projectId`를 추가하지 않는다. project 단위 저장/조회가 필요한 API/DB 계층에서는 `projectId`와 `changeRecord`를 wrapper로 묶는다.
- `snapshotId`는 `snapshot_` prefix를 강제한다.
- snapshot reason은 `auto-save`, `deck-replaced`, `patch-applied`, `snapshot-restore`만 허용한다.
- ORBIT-10의 project DB 모델이 확정되기 전까지 ORBIT-15 저장 API는 `projectId`를 FK가 아닌 문자열 boundary로 다룬다. API 계층에서 URL의 `projectId`와 deck/snapshot의 project boundary를 검증한다.
- response envelope 내부의 `projectId`, `deckId`, `version`이 서로 어긋나면 shared API schema validation에서 거부한다.
- NestJS API는 TypeORM migration으로 `decks`, `deck_patches`, `deck_snapshots` 테이블을 생성한다. `project_id`는 ORBIT-10 확정 전까지 `text`로 저장하고 project FK는 걸지 않는다.

지원하는 API schema:

- `getDeckResponseSchema`: `projectId`, `deck`, `updatedAt`
- `putDeckRequestSchema`: `deck`, `baseVersion?`, `snapshotReason?`
- `putDeckResponseSchema`: `deck`, `snapshot`, `updatedAt`
- `appendDeckPatchRequestSchema`: `patch`, `snapshotReason?`
- `appendDeckPatchResponseSchema`: `deck`, `changeRecord`, `snapshot`, `updatedAt`
- `deckSnapshotSchema`: `snapshotId`, `projectId`, `deckId`, `version`, `reason`, `createdAt`
- `deckSnapshotDetailSchema`: snapshot metadata와 `deck`
- `deckPatchLogEntrySchema`: `projectId`, `changeRecord`
- `listDeckSnapshotsResponseSchema`: `projectId`, `snapshots`
- `restoreDeckSnapshotResponseSchema`: `deck`, `restoredSnapshot`, `updatedAt`
- `deckApiErrorSchema`: `code`, `message`, `details`

MVP 실패 코드:

- `DECK_NOT_FOUND`
- `DECK_MISMATCH`
- `SNAPSHOT_NOT_FOUND`
- `PROJECT_MISMATCH`
- `DECK_VALIDATION_FAILED`
- `PATCH_VALIDATION_FAILED`
- `STALE_BASE_VERSION`
- `SNAPSHOT_PROJECT_MISMATCH`
- `PATCH_APPLY_FAILED`

구현 위치:

- `packages/shared/src/deck/deck-api.schema.ts`

## 커뮤니티 템플릿 계약

커뮤니티 템플릿은 source project의 공개 상태나 원본 `Deck` JSON이 아니라 개인정보가
제거된 immutable `CommunityTemplateSnapshot`이다. source project와 owner가 삭제되어도
저장된 snapshot의 조회와 사용은 유지된다.

대표 주제는 관리형 `community_categories`에서 하나를 필수 선택한다.

```text
business, education, design, technology, marketing, data-research,
portfolio, career, event, culture-lifestyle, other
```

사용자 태그는 게시물당 최대 5개이며 trim 후 1~30자다. 태그 이름은
`lower(btrim(name))` 기준으로 고유하고, 기존 태그를 재사용한다.

- `templateId`는 `community_template_` prefix를 사용한다.
- snapshot `schemaVersion`은 literal `1`이다.
- 공개 title은 trim 후 1~60자다.
- list query의 `query`는 최대 60자, `page`는 양의 정수, `limit`은 기본 24·최대 48이다.
- use request의 `clientRequestId`는 UUID이며 `(userId, clientRequestId)` 범위의 멱등성 key다.
- 정제 snapshot은 최대 100장, UTF-8 JSON 10 MiB 이하다.

snapshot 구조:

```ts
type CommunityTemplateSnapshot = {
  schemaVersion: 1;
  canvas: DeckCanvas;
  theme: CommunityTemplateTheme;
  targetDurationMinutes: number;
  slides: CommunityTemplateSlide[];
};
```

`CommunityTemplateSlide`는 `content`만 허용하고 `slideId`, `order`, literal
`슬라이드 제목`, 정제된 `style`, 안전한 `elements`만 저장한다. snapshot과 preview의
object schema는 strict하며 다음 정보는 구조적으로 허용하지 않는다.

- `projectId`, `deckId`, Deck title/version/metadata
- `thumbnailUrl`, `speakerNotes`, `keywords`, `semanticCues`, `aiNotes`
- `activity`, `activityResult`, transition, animation, action
- `backgroundImage`, `image`, `svg`, `src`, `url`, `fileId`
- slide/element OOXML origin, source part, edit capability

text는 role에 따라 `제목을 입력하세요` 또는 `내용을 입력하세요`만 허용하고 rich text
`runs`와 `paragraphs`는 저장하지 않는다. image와 SVG는 같은 frame의 neutral `rect`로
바뀐다. table cell은 `내용`, chart는 type과 style만 유지한 deterministic sample data를
사용한다. activity 또는 activity-results slide가 하나라도 있으면 공개를 거절한다.
font family는 ORBIT catalog 값만 허용하며 알 수 없는 값은 `Pretendard`로 정규화한다.

preview는 full snapshot을 반환하지 않고 다음 첫 slide projection만 사용한다.

```ts
type CommunityTemplatePreview = {
  canvas: DeckCanvas;
  theme: CommunityTemplateTheme;
  slide: CommunityTemplateSlide;
};
```

API:

- `GET /api/v1/community-templates`
- `GET /api/v1/community-templates/recent`
- `GET /api/v1/workspaces/:workspaceId/community-templates/sources`
- `POST /api/v1/workspaces/:workspaceId/community-templates`
- `POST /api/v1/workspaces/:workspaceId/community-templates/:templateId/use`
- `GET /api/v1/community-templates/discover`
- `GET /api/v1/community-templates/categories`
- `GET /api/v1/community-templates/tags`
- `GET /api/v1/community-templates/:templateId`
- `PUT|DELETE /api/v1/community-templates/:templateId/like`
- `POST /api/v1/community-templates/:templateId/view`
- `POST /api/v1/community-templates/:templateId/share`
- `GET|POST /api/v1/community-templates/:templateId/comments`
- `PATCH|DELETE /api/v1/community-templates/:templateId/comments/:commentId`

커뮤니티 공개는 사용자가 소유한 프로젝트 중 하나를 명시적으로 선택한 뒤 해당
프로젝트 전체를 immutable snapshot으로 저장한다. 다른 프로젝트는 공개되지 않으며
원본 프로젝트의 이후 변경도 이미 공개된 snapshot을 변경하지 않는다. 공개 요청은
300자 이하 `description`과 최대 5개의 `tags`를 선택적으로 포함할 수 있다.
게시물과 태그는 `community_template_tags` N:M 관계로 저장한다. 태그 조회는 사용 횟수
기반 인기순과 이름순을 제공하며, 갤러리에는 실제 공개 게시물에서 사용 중인 태그만
노출한다.

좋아요는 `(template_id, user_id)` unique 상태이며 PUT/DELETE를 멱등 처리한다. 조회는
로그인 사용자·템플릿·날짜별 한 번만 집계하고, 공유는 실제 공유 동작마다 event row를
추가한다. 댓글은 1~500자이고 작성자만 수정·삭제할 수 있다. 목록의 인기·추천 정렬은
좋아요, 댓글, 사용, 조회, 공유와 생성 시각을 서버에서 계산하며 모든 count와
`likedByMe`, `ownedByMe`는 인증 사용자 기준 응답이다.

모든 endpoint는 signed session 인증을 요구한다. list/recent/use는 모든 로그인 사용자가
사용할 수 있다. sources는 현재 사용자가 accepted owner인 project만 반환하며 publish는
source project owner만 성공한다. publish request는 `sourceProjectId`, `title`,
`categoryId`, `tags`, literal `rightsConfirmed: true`를 허용한다. client가 snapshot,
preview, Deck JSON,
`ownerUserId`, source version을 전달할 수 없다.

public card DTO는 `templateId`, `title`, `category`, 정제된 `preview`, `createdAt`만 갖고
`ownerUserId`, `sourceProjectId`, `sourceDeckId`, full snapshot을 포함하지 않는다. 공개 시
서버가 현재 source Deck을 다시 읽고 `deckSchema`와 sanitizer를 통과시킨 뒤 snapshot을
저장한다.

use는 하나의 database transaction에서 다음을 원자적으로 처리한다.

1. 사용자와 `clientRequestId` 범위의 advisory transaction lock과 기존 결과 확인
2. 저장 snapshot을 shared schema로 검증
3. 새 project와 accepted owner membership 생성
4. 새 `deck_`, `slide_`, `el_` ID와 group reference를 발급한 Deck 생성
5. current Deck과 초기 `deck_snapshots` row 생성
6. `community_template_usages` upsert
7. `community_template_use_requests` 결과 저장

같은 사용자와 `clientRequestId`가 같은 template에 재전송되면 기존 project와 `deckId`를
반환한다. 다른 template에 재사용하면 HTTP 409
`COMMUNITY_TEMPLATE_USE_CONFLICT`를 반환한다. 생성 Deck은 `version: 1`,
`metadata.sourceType: "manual"`이며 `deckSchema`를 통과한다.

bounded 실패 code:

- `COMMUNITY_TEMPLATE_NOT_FOUND`
- `COMMUNITY_TEMPLATE_SOURCE_NOT_FOUND`
- `COMMUNITY_TEMPLATE_OWNER_REQUIRED`
- `COMMUNITY_TEMPLATE_CATEGORY_NOT_FOUND`
- `COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED`
- `COMMUNITY_TEMPLATE_SANITIZATION_FAILED`
- `COMMUNITY_TEMPLATE_SNAPSHOT_TOO_LARGE`
- `COMMUNITY_TEMPLATE_USE_CONFLICT`
- `COMMUNITY_TEMPLATE_SCHEMA_NOT_READY`

구현 위치:

- `packages/shared/src/community-templates/community-template.schema.ts`
- `packages/shared/src/community-templates/community-template-api.schema.ts`
- `packages/editor-core/src/community-templates`
- `apps/api/src/community-templates`

## Design Agent 계약

- 편집기 디자인 에이전트 시작점은 `POST /api/v1/projects/:projectId/design-agent/messages`다.
- 디자인 변경안 적용은 `POST /api/v1/projects/:projectId/design-agent/proposals/:proposalId/apply`를 사용하며, 현재 Deck version과 제안의 `baseVersion`이 일치할 때만 `source = "ai"` patch로 저장한다.
- Design Agent capability manifest의 원본은 shared schema이며, worker가 직접 생성하는 1차 추가 범위는 `text`, `rect` 요소의 `add_element`, 기존 요소의 `delete_element`, frame/props/style update다. 스마트아트 DB 프리셋은 API가 검증된 공통 Deck element patch로 별도 확장한다.
- 요청은 현재 로컬 편집 상태의 `deckId`, `baseVersion`, `canvas`, 현재 `slide`, 선택한 `elementId`, `theme`을 포함한다.
- 대화는 `design_agent_messages`, 적용 전 디자인 변경안은 `design_agent_proposals`에 독립 저장한다. 기존 `ai_suggestions` 모듈과 테이블은 사용하지 않는다.
- Python worker 경계는 `/ai/design-agent/propose`이며 응답의 `operations`는 shared `deckPatchOperationSchema`를 통과해야 한다.
- 스마트아트형 변환은 worker가 `smartArtRequest.layoutType`, `sourceElementIds`, `items`를 반환하고, API가 항목 수와 정확히 일치하는 `smart_art_layouts` 프리셋을 조회해 공통 Deck patch로 확장한다.
- 지원 `layoutType`은 `list`, `process`, `card_grid`, `comparison`, `classification_grid`, `timeline`, `metric_cards`다. API는 생성한 프리셋 요소를 하나의 `group` 요소로 묶어 에디터에서 전체 SmartArt를 이동하거나 크기를 조절할 수 있게 한다.
- API는 SmartArt 프리셋 배치 영역과 겹치는 기존 visible 요소를 `delete_element`로 먼저 제거한 뒤 새 프리셋 요소를 추가한다. 기존 group과 겹치면 hidden 또는 배경 요소를 제외한 group 구성 요소를 함께 제거하며, `role = "background"` 또는 canvas 전체를 덮는 배경 요소도 자동 제거 대상에서 제외한다.
- `sourceElementIds`는 현재 선택된 visible 요소를 우선 사용한다. 선택이 없고 사용자가 현재 슬라이드의 보이는 목록·단계·비교 항목을 SmartArt 또는 다이어그램으로 바꾸도록 요청한 경우에는 visible 현재 슬라이드 요소를 원본으로 사용할 수 있으며, worker는 `interpretedIntent.target`을 `current-slide`로 정규화한다. 선택 대상을 명시한 요청은 선택된 visible 요소의 부분집합만 허용하고 unknown 또는 hidden 요소는 항상 거부한다. 지원 프리셋이 없는 layout type/항목 수 조합은 다른 크기의 프리셋으로 대체하거나 항목을 누락하지 않고 요청을 실패시킨다.
- `affectedElementIds`는 미리보기 강조용 비권위 메타데이터다. worker는 현재 슬라이드의 기존 요소 또는 검증된 작업이 추가한 요소만 남기며, 실제 작업 대상과 `sourceElementIds`의 유효성은 별도로 엄격하게 검증한다.
- 디자인 변경안 생성은 Deck을 변경하지 않는다. 실제 적용 단계에서만 공통 Deck patch 적용 경계를 사용하고 `deck_patches.source = "ai"`로 기록한다.
- 사용자 질문 원문이나 현재 slide JSON은 서버 업무 로그에 남기지 않는다.

## Editor slide practice and question guide contract

### Privacy and ownership boundary

- 한 장 바로 연습은 브라우저 `MediaRecorder`로 녹음하고 `slide-practice-audio` private purpose로 서버에 임시 업로드한다. 브라우저 `AudioContext`/Web Audio PCM 분석과 Web Speech 결과를 최종 근거로 사용하지 않는다.
- raw audio는 `slide_practice_audio_analyses.audio_file_id`로만 참조하고 분석 성공·실패 직후 삭제한다. 즉시 삭제가 실패하면 `storage_deletion_outbox`로 재시도하며, 업로드 후 분석이 시작되지 않은 원본도 생성 후 30분에 삭제 대상으로 넣는다.
- Report STT transcript 원문과 timestamp segment 원문은 Python worker 응답에서 TypeScript worker 메모리로만 전달한다. API response, Job payload/result, DB, report, 로그에 저장하지 않는다.
- `slide_practice_reports.report_json`에는 습관어 집계, 음성 파생 지표, bounded 시간별 음량·속도 sample, 품질 상태, classifier 결과, creator-private AI 코칭 결과만 저장한다. 시간별 sample에는 transcript text, raw audio, speaker note 원문을 넣지 않는다.
- AI 코칭은 현재 slide의 `speakerNotes` 최대 6,000자, 습관어 집계, 말 속도, 쉼 비율, pitch 폭, 음량, versioned issue code만 transient input으로 사용한다. `promptVersion: 2`는 Worker가 timestamp segment를 실제 대본 문장과 메모리에서 정렬한 뒤, transcript를 제거한 최대 8개 근거 후보만 코칭 provider에 보낸다. raw audio와 Report STT transcript는 코칭 provider에 보내지 않으며 generic Job payload/result와 로그에도 넣지 않는다.
- `promptVersion: 1` 저장 코칭은 과거 호환을 위해 최대 2개 개선 item과 30초 practice plan을 읽는다. 신규 `promptVersion: 2`는 개선 item 정확히 1개, `practicePlan: null`, model/prompt/policy version을 저장한다. item에는 실제 `speakerNotes`와 일치하는 대본 최대 1,000자와 속도, 음량, 인접 쉼, pitch 폭, 습관어, 음량 변화폭, 리듬 규칙성 파생 근거를 저장하며 Worker가 대본 포함 여부와 provider가 선택한 evidence ID를 재검증한다.
- 연습 기록은 생성 사용자만 조회할 수 있는 creator-private 데이터이며 기존 공식 `RehearsalReport`와 합치지 않는다.
- 연습 분석 상태와 파생 기록의 기본 보관 기간은 90일, 사용자/기기 voice baseline은 180일이다. project 또는 user 삭제 시 FK cascade로 함께 삭제한다.
- voice baseline은 원음이나 voice identity가 아니라 음량, pitch, 속도, 리듬의 파생 기준값만 저장한다.

### Slide practice API

- `POST /api/v1/projects/:projectId/slide-practice-analyses`
  - body는 session/deck/slide 식별자, 녹음 시작 시각, MIME/크기, nullable device hash만 허용한다.
  - API는 현재 deck ID와 slide ID를 다시 확인한 뒤에만 private upload를 만든다. 신규 client의 `deckVersion`이 현재 version과 달라도 대상 slide canonical text hash가 같으면 허용하고 analysis에는 server가 해석한 현재 `deckVersion`, `slideOrder`, hash를 저장한다.
  - 신규 client는 `contentHashVersion: "slide-text-v1"`와 `slideContentHash`를 함께 보낸다. API는 현재 slide에서 hash를 재계산하며 불일치는 `409 SLIDE_PRACTICE_CONTENT_HASH_MISMATCH`로 거부한다. hash 필드가 없는 과거 client는 기존처럼 deck version과 slide order가 모두 일치해야 하며 server hash를 analysis row에 저장한다.
  - 응답은 creator-private analysis 상태와 `slide-practice-audio` 전용 upload command를 반환한다.
- `POST /api/v1/slide-practice-analyses/:analysisId/audio/complete`
  - private upload 완료를 확인하고 `slide-practice-analysis` Job을 enqueue한다.
  - Job payload는 `{ jobId, projectId, analysisId }`, result는 `{ analysisId, reportId }`만 허용한다.
- `GET /api/v1/slide-practice-analyses/:analysisId`
  - 생성 사용자만 bounded 상태와 성공한 파생 report를 조회한다. `audioFileId`, storage URL/key, transcript는 반환하지 않는다.
- `POST /api/v1/projects/:projectId/slide-practice-reports`
  - 기존 브라우저 파생 report의 호환·오프라인 동기화 경로로 유지하며 신규 바로 연습은 server analysis API를 사용한다.
  - body: `{ clientRequestId, report }`
  - `report.projectId`는 URL project와 일치해야 한다.
  - `(projectId, createdBy, clientRequestId)`는 idempotency key다.
  - transcript, raw audio, audio URL, speaker note 원문을 추가 필드로 보내면 strict shared schema가 거부한다.
- `GET /api/v1/projects/:projectId/slide-practice-reports`
  - creator 본인의 만료되지 않은 기록만 반환한다.
  - `deckId`, `slideId`, `slideContentHash`, `cursor`, `limit` 필터를 지원한다.
  - `slideContentHash` 비교 조회는 `slide_practice_reports.slide_content_hash`가 같은 v3 기록만 포함한다. hash/version column은 v1/v2 row를 위해 nullable이며 `idx_slide_practice_comparable_history`가 creator-private 최신순 조회를 지원한다.
- `PUT|GET /api/v1/users/me/voice-baselines/:deviceIdHash`
  - 인증된 사용자 자신의 파생 baseline만 갱신하거나 조회한다.

### Slide practice voice classifier

- 저장된 `classifierVersion: 1 | 2 | 3` 보고서는 계속 읽고, 신규 보고서는 `classifierVersion: 4`로 저장한다. 과거 보고서의 유형은 조회 시 재분류하지 않는다.
- v4 판정 우선순위는 `lullaby -> turbo -> neutral`이다. `announcer`와 `cloud`는 과거 보고서 읽기 호환으로만 유지하고 신규 보고서에서는 생성하지 않는다. `neutral`은 사용자에게 유형으로 제시하지 않고 `판단 보류`로 표시한다.
- v4의 낮은 pitch 폭은 `pitchSpanHz < max(45, baselinePitchSpanHz * 0.80)`로 판단한다.
- v4의 느린 말은 `syllablesPerSecond < 3.5` 또는 사용자 baseline보다 `0.8` 이상 느린 경우다. `lullaby`는 낮은 pitch 폭과 느린 말을 모두 만족할 때 적용하며 `loudnessDb`는 판정 조건에 사용하지 않는다.
- v4의 빠른 말은 `syllablesPerSecond > 4.8` 또는 사용자 baseline보다 `0.8` 초과한 경우다. `turbo`는 빠른 말과 `pauseRatio < 0.70`이 함께 있을 때 적용한다. 현재 `pauseRatio`는 전체 연습 구간의 무음 비율이므로 이 판정 문구는 짧은 쉼을 단정하지 않고 빠른 발화 구간을 근거로 설명한다.
- `quality.state: unmeasured`인 신규 보고서는 유형을 판정하지 않는다. 저장 호환을 위해 `style.mode: neutral`, `confidence: 0`을 사용하되 UI는 `판단 보류`로 표시한다. 측정됐지만 두 유형의 조건이 모두 불충분한 경우도 같은 bounded 표현을 사용한다.
- `quality.state: unmeasured`인 보고서의 파생 지표는 사용자 voice baseline 갱신에 사용하지 않는다.
- `style.evidenceLabels`는 연습 종료 결과와 저장 기록 상세 화면에서 `판단 근거`로 노출한다. v4 `lullaby`는 낮은 pitch 폭과 느린 속도만 근거로 표시하고, `neutral`은 안정성을 단정하지 않고 자장가형·터보형 조건이 뚜렷하지 않아 판단을 보류했음을 설명한다.
- server `metricDefinitionVersion: 2`는 기존 브라우저 지표의 60ms frame, `-48 dBFS` active threshold, 70~420Hz pitch 범위, correlation `0.55` 기준을 서버 PCM에 적용한다. metric 정의는 유지하고 자장가형 구성과 속도 임계값 변경만 classifier v4로 구분한다.
- 말 속도와 습관어는 Report STT transcript를 worker 메모리에서만 계산한다. `syllablesPerSecond`는 전사 음절 수를 `activeSpeechMs`로 나누며 transcript 자체는 report에 넣지 않는다.
- 신규 `reportVersion: 2`는 1초 단위 `loudnessSamples` 최대 300개와 5초 단위 `speedSamples` 최대 60개를 저장한다. 음량 sample은 `dBFS`, 속도 sample은 `syllablesPerSecond`만 포함한다. Python worker는 대본 정렬을 위해 timestamp transcript segment 최대 100개와 인접 STT segment 사이 250ms 이상 pause 구간 최대 100개를 Worker 메모리에만 반환한다. `reportVersion: 1` 기록은 sample과 코칭이 없는 상태로 계속 읽는다.
- 신규 `reportVersion: 3`은 `metricDefinitionVersion: 3`, `contentHashVersion: "slide-text-v1"`, lowercase SHA-256 형식의 `slideContentHash`를 필수로 저장한다. v1/v2 report는 hash 없이 계속 읽는다. hash 입력은 `slideQuestionGuideTextHashInput(slide)`와 같아서 title·text·alt·speaker notes 변경에만 반응하고 시각 배치 변경에는 유지된다.
- metric definition v3의 비교 지표는 습관어/분(낮을수록 좋음), 말 속도 3.5~4.8 음절/초, 평균 음량 -45~-30 dBFS, 쉼 비율 12~55%, 음량 변화폭 `loudnessMadDb <= 3.0` 안정이다. `activeSpeechMs < 5_000`, STT 실패, nullable 측정값은 실제 0과 구분해 측정 불가로 유지한다.
- `coaching.policyVersion: 1`은 습관어 1회 이상, 속도 `< 3.5` 또는 `> 4.8` 음절/초, 쉼 비율 `< 0.12` 또는 `> 0.55`, pitch 폭 `< 45` 또는 `> 160` Hz, 음량 `< -45` 또는 `> -30` dBFS를 개선 후보로 판정한다. LLM은 이 판정을 새로 만들거나 뒤집지 않고 설명·대본 수정·연습 방법만 생성한다.
- report v3에서는 `loudnessMadDb > 3.0`도 `loudness-unstable` 개선 후보로 추가한다. 정확히 `3.0`은 안정이며 nullable 값은 개선 성공이나 실패로 단정하지 않는다.
- 측정된 모든 지표가 policy 범위 안이면 OpenAI를 호출하지 않고 `정말 잘했어요 개선점이 없어요!!`를 저장한다. 측정이 부족하거나 OpenAI 코칭이 실패해도 그래프와 파생 지표 report는 성공으로 저장하고 코칭만 `unavailable`로 표시한다.
- `promptVersion: 2` LLM은 근거 후보 중 청중 이해와 즉시 실행 가능성에 가장 큰 영향을 주는 하나만 선택한다. `action`은 실제 대본에 적용하는 말하기 방법, `practiceTip`은 같은 문제를 고치는 다른 연습 방법 하나다. transcript 정렬 신뢰도가 부족하면 `alignment: practice-target`으로 저장하고 실제 오류 구간이 아니라 연습 추천 구간으로만 표시한다.

### Slide question guide API and Job boundary

- `POST /api/v1/projects/:projectId/slide-question-guides`
  - body: `{ clientRequestId, deckId, slideId, expectedDeckVersion, questionCount: 3, contentHashVersion?: "slide-text-v1", expectedSlideContentHash?: string }`. 두 hash 필드는 함께 보내거나 함께 생략한다.
  - 신규 client는 대상 slide의 title·text·alt·speaker notes canonical hash가 같으면 전체 deck version이 달라도 현재 server Deck snapshot으로 생성한다. 대상 hash가 달라졌으면 `409 SLIDE_QUESTION_CONTENT_HASH_MISMATCH`로 거부하고, hash가 없는 과거 client는 strict version 검증을 유지한다.
- `POST /api/v1/projects/:projectId/slide-question-guides/auto`
  - body: `{ clientRequestId, deckId, expectedDeckVersion, questionCount: 3, contentHashVersion?: "slide-text-v1", expectedDeckTextHash?: string }`. `expectedDeckTextHash`는 slide ID·order와 각 slide canonical text hash로 만들며 시각 속성은 제외한다.
  - response: `{ deckId, deckVersion, slides }`. `slides[]`는 `{ status: "accepted", slideId, guideId, job }` 또는 `{ status: "failed", slideId, errorCode }`다.
  - project write 권한과 `SLIDE_QUESTION_GUIDES_ENABLED`가 모두 유효할 때만 현재 server deck을 한 번 검증한다. text hash가 같으면 visual-only version 차이를 허용하고, 실제 text hash 충돌은 Web이 최신 Deck을 한 번만 다시 읽어 새 request ID/hash로 재시도한다. hash가 없는 과거 client는 strict version 검증을 유지한다. 같은 target slide canonical text hash와 `promptVersion`의 `queued | running | succeeded` guide는 재사용하고 나머지만 기존 `slide-question-guide-generation` Job으로 예약한다.
  - Web의 `clientRequestId`는 `{ projectId, deckId, deckVersion }` canonical JSON의 SHA-256으로 고정한다. 각 slide의 내부 request ID도 batch request ID와 `slideId`의 canonical SHA-256으로 고정해 effect 재실행과 새로고침이 실패 Job을 자동 재시도하거나 중복 Job을 만들지 않게 한다.
- `slide-question-guide-generation` Job payload는 `{ jobId, projectId, guideId }`만 허용한다.
- Job result는 `{ guideId, projectId, deckId, deckVersion, slideId, itemCount, generatedAt }`만 허용한다.
- `questionText`, `keyConcepts`, `suggestedAnswer`, remediation, slide/reference 원문은 generic Job payload/result에 넣지 않는다.
- 질문과 추천 답변의 canonical 원문은 project-private `slide_question_guides`와 `slide_question_guide_items`에만 저장한다.
- API가 검증한 최소 slide source snapshot은 `slide_question_guides.source_snapshot_json`에 project-private으로 고정하며 Job payload/result에는 복제하지 않는다. 신규 guide는 optional `deckSnapshotId`로 같은 deck version의 `deck_snapshots` row를 참조한다. 해당 version snapshot은 재사용하고 없을 때 `auto-save` 하나를 생성한다.
- 저장된 guide `schemaVersion: 1`은 `slide | reference` source ref만 가진 과거 계약으로 계속 읽고, 신규 `schemaVersion: 2`는 `slide | reference | web` source ref와 `research` summary를 가진다. `web` source ref는 `{ kind, sourceId, url, title, authority: "official", contentHash, retrievedAt }` 메타데이터만 저장하며 웹 원문과 검색 질의는 저장하지 않는다.
- `research`는 `{ status: succeeded | unavailable, attempts, officialSourceCount, issueCodes, researchedAt }`만 반환한다. 과거 v2 record 호환을 위해 schema는 `attempts` 최대 2를 읽지만 신규 생성은 1회만 시도하며, 공식 source는 최대 5개로 제한한다.
- `GET /api/v1/projects/:projectId/slide-question-guides/:guideId`는 project read 권한을 다시 검사한 뒤 succeeded guide만 반환한다.
- worker는 Presentation Brief에 승인된 reference snapshot과 일치하는 chunk만 AI 입력으로 사용하고, 반환된 모든 source ref의 ID·version·hash를 allowlist로 재검증한다.
- worker는 생성 대상인 현재 slide를 `targetSlideId`로 고정한다. `deckSnapshotId`가 있으면 snapshot ID·project·deck·version과 target slide canonical text hash를 검증한 frozen Deck을 사용하고, 없는 과거 guide만 기존 checkpoint와 patch tail 재구성 경로를 사용한다. `contentHashVersion`이 없는 과거 guide는 전체 slide canonical hash 검증을 유지한다. 대상 slide는 화면 텍스트 최대 4,000자와 `speakerNotes` 최대 6,000자, 나머지 slide는 각각 최대 600자로 축약해 같은 deck version의 bounded transient context를 구성한다. 승인 참고자료는 표시 순서 기준 최대 4개 chunk, chunk당 1,200자만 전달한다. 이 context는 Python worker 생성 입력에만 사용하며 generic Job payload/result와 로그에 복제하지 않는다.
- 예상 질문은 `targetSlideId`에 대해서만 생성하되, 전체 deck의 흐름과 대본을 답변 근거로 사용할 수 있다. 다른 slide를 인용하면 해당 slide의 ID·deck version·canonical text hash가 frozen deck context allowlist와 일치해야 한다.
- Python worker는 slide title과 Presentation Brief의 bounded `challengeTopics`·terminology만 OpenAI Responses `web_search` 질의에 사용한다. slide 본문, 승인 참고자료 원문, 파일명, speaker notes는 검색 질의에 포함하지 않는다.
- web citation은 검색 응답의 cited excerpt를 질문 생성 strict Structured Output 안에서 함께 판정한다. 모델은 공급된 candidate ID 중 해당 주제를 책임지는 정부·학교·회사·표준기관·프로그램 운영 주체의 source ID만 `officialSourceIds`로 반환할 수 있고, Python worker는 candidate allowlist와 item source ref를 다시 대조한다. cited excerpt는 생성 중 메모리에서만 사용하고 저장하거나 로그로 출력하지 않는다.
- web search·citation·vetting이 실패하거나 official source가 없으면 `research.status: unavailable`과 제한된 issue code를 기록하고, 기존 slide와 승인 참고자료만으로 질문 생성을 계속한다. UI는 이 fallback 상태를 알리고, 채택한 official web source는 제목과 클릭 가능한 URL로 표시한다.
- 응답 지연을 제한하기 위해 official web search는 한 번만 시도하고 `search_context_size: low`, 호출 제한 12초를 사용한다. 검색 실패 시 추가 검색 재시도 없이 slide·대본·승인 참고자료로 생성을 계속하며 질문 생성 호출은 45초, Worker의 Python 요청은 70초로 제한한다. provider 응답의 `webSearchMs`, `generationMs`, `totalProviderMs`는 업무 이벤트 로그에만 사용하고 Job·guide·DB에는 저장하지 않는다.
- `slide-question-guide-generation` BullMQ Worker는 한 인스턴스에서 최대 2개 Job을 병렬 처리한다. 별도 Queue·provider 동시성 설정은 추가하지 않으며 완료 순서는 slide 순서와 다를 수 있다.
- worker는 frozen source의 `deckVersion`과 target `slideContentHash`가 일치하지 않으면 생성 실패로 확정한다. UI freshness는 전체 `deckVersion`이 아니라 현재 target slide canonical text hash로 판정한다. title·text·alt·speaker notes 변경만 기존 질문을 숨기며 색상·위치·크기·도형 style 같은 시각 변경과 다른 slide 편집은 질문을 숨기지 않는다. `deckVersion`은 provenance로 유지한다.
- 근거가 부족할 때는 내용을 추측하지 않고 `supportState: insufficient`, `suggestedAnswer: null`, remediation action을 반환한다.

### Runtime rollout

- `SLIDE_PRACTICE_ENABLED`와 `SLIDE_QUESTION_GUIDES_ENABLED`는 각각 API와 editor tab을 제어한다.
- 바로 연습 Web은 `MediaRecorder`만 사용하고, 종료 후 private upload와 기존 Report STT provider를 통해 서버 분석한다. Web Speech/OpenAI Realtime fallback과 Web Audio PCM 분석은 이 경로에서 사용하지 않는다.
- 서버 전사 또는 PCM 분석을 사용할 수 없으면 analysis를 bounded error code로 실패시키고 raw audio 삭제를 계속한다. 성공 report에는 `quality.state`와 reason을 함께 기록한다.

## Design agent image generation

- `POST /api/v1/projects/:projectId/design-agent/image-generations`는 현재 Deck의 `deckId`, `slideId`, `baseVersion`과 사용자 `prompt`를 받아 내부 전용 `design-image-generation` Job을 만든다.
- 성공한 Job의 `result`는 `fileId`, `projectId`, `purpose: "design-asset"`, `url`, `mimeType`, `width`, `height`, 원본 `prompt`, `aspectRatio`를 포함한다.
- 생성 이미지는 적용 전에 프로젝트 asset으로 저장한다. 에디터는 결과 확인 후 최신 Deck version을 기준으로 별도의 `image` 요소 추가 patch를 적용한다.
# Slide transcript snapshots

`POST /api/v1/rehearsals/:runId/audio/complete`는 선택적으로
`slideTranscriptSnapshots[]`를 받는다. 각 항목은 다음 계약을 따른다.

- `slideId`: 불변 슬라이드 식별자
- `slideNum`: 방문 당시 1부터 시작하는 슬라이드 순서
- `visitedVer`: 같은 슬라이드의 방문 순번
- `transcript`: 캡처 시점까지 누적된 전체 live transcript
- `visitedAt`, `capturedAt`: ISO 8601 진입·캡처 시각
- `reason`: `slide-change` 또는 `rehearsal-end`

Worker는 이 배열을 MinIO의 `transcript.json`에 보존한다. `transcript.txt`의
기존 순수 대본 형식은 변경하지 않는다.

리포트 생성 시 Worker는 인접한 누적 `transcript`의 차이로 각 방문 구간 발화를
복원한다. 같은 `slideId`의 재방문 구간은 합산하며, 결과는
`slideInsights[].fillerWordCount`와 `slideInsights[].fillerWordDetails[]`에 저장한다.
