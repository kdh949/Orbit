# ORBIT 1차 스프린트 공통 계약

## 목적

1차 스프린트에서는 구현 토론보다 팀 전체가 같은 데이터 모양과 연결 기준으로 개발하는 것이 우선이다. 이 문서는 편집기, AI 생성, 파일 업로드, Job, WebSocket, E2E 흐름에서 공통으로 사용할 계약을 정의한다.

확정 원칙:

- 1차 스프린트에서는 ORBIT-9를 제외한다.
- ORBIT-8부터 이메일/비밀번호 기반 인증을 제공한다.
- 인증이 필요한 기능으로 전환되기 전까지 기존 데모 프로젝트 흐름은 유지한다.
- 공통 구조가 바뀌면 반드시 전원에게 공유한다.
- API, WebSocket, Job, Deck 구조는 shared schema로 옮길 수 있게 작성한다.

## 인증과 세션 구조

ORBIT-8은 self-managed email/password 인증을 사용한다. 비밀번호 reset, social login, email verification은 MVP 범위에서 제외한다.

요청:

```json
{
  "email": "person@example.com",
  "password": "password-123"
}
```

응답:

```json
{
  "user": {
    "userId": "user_1",
    "email": "person@example.com",
    "createdAt": "2026-06-27T01:00:00+09:00"
  }
}
```

현재 세션 조회:

```json
{
  "user": {
    "userId": "user_1",
    "email": "person@example.com",
    "createdAt": "2026-06-27T01:00:00+09:00"
  },
  "authenticatedAt": "2026-06-27T01:00:00+09:00",
  "expiresAt": "2026-07-04T01:00:00+09:00"
}
```

API:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

결정 사항:

- email은 shared schema에서 trim/lowercase normalization 후 저장한다.
- password는 8자 이상, 128자 이하로 검증한다.
- password는 Argon2id hash로만 저장한다. 평문 password는 저장하거나 응답하지 않는다.
- session id는 signed HttpOnly cookie로 전달한다.
- cookie signing은 `COOKIE_SECRET`을 사용한다.
- session payload는 Redis에 저장하고 Redis key는 `SESSION_SECRET` 기반 HMAC digest를 사용한다.
- session TTL은 MVP 기준 7일이다.
- logout은 session 삭제 후 cookie를 지우며, 없는 session에 대한 logout은 성공으로 처리한다.

구현 위치:

- `packages/shared/src/auth/auth.schema.ts`
- `apps/api/src/auth`
- `apps/api/src/database/migrations/2026062702000-CreateAuthUsers.ts`
- `apps/web/src/features/auth/AuthPanel.tsx`

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
          "required": true
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
- AI 생성 deck은 `metadata.sourceType = "ai"`, `metadata.generatedBy = "ai"`, `metadata.audience`, `metadata.purpose`, `metadata.tone`, `metadata.createdFrom`을 선택적으로 포함할 수 있다.
- Imported PPTX OOXML decks may set `metadata.thumbnailSource = "import-render"` until the editor captures canvas thumbnails, then update it to `"canvas"`.
- `metadata.createdFrom.references`는 생성에 사용한 참고자료의 `{ fileId }[]`만 저장한다. URL ingestion과 원문 저장은 이번 계약에 포함하지 않는다.
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
- `slide.style.layout`은 `title`, `title-content`, `section`, `two-column`, `image-left`, `image-right`, `chart-focus`, `quote`, `closing`만 허용한다.
- `slide.style.backgroundImage`는 `src`, `alt`, `fit`, `opacity`를 사용하고, `fit`은 `contain`, `cover`, `stretch`만 허용한다.
- `slide.style`이 생략되면 schema parse 후 `{}`로 정규화하고, renderer/export/AI normalize 단계에서 필요한 값은 `deck.theme`에서 해석한다.
- 슬라이드 배경은 `slide.style.backgroundImage` > `slide.style.backgroundColor` > `deck.theme.backgroundColor` 순서로 해석한다.
- `theme` 변경은 기존 `slide.style`이나 object props를 자동으로 덮어쓰지 않는다. 전체 테마 적용은 별도의 apply theme 동작으로 처리한다.
- `slides`는 최소 1개 이상이어야 한다. 새 덱 생성 시에는 빈 덱 대신 기본 슬라이드 1장을 생성한다.
- SlideSchema 필드는 `slideId`, `order`, `title`, `thumbnailUrl`, `estimatedSeconds`, `style`, `speakerNotes`, `elements`, `keywords`, `animations`, `actions`를 유지한다. `thumbnailUrl`은 imported/image-only slide처럼 `elements`가 비어 있는 발표자 렌더링 fallback에 사용할 수 있다.
- `estimatedSeconds`는 슬라이드별 목표 발표 시간(초)이며 선택 필드다. 생략된 경우 presenter UI는 `targetDurationMinutes / slides.length` 기반 균등 분배로 폴백한다.
- AI 생성 slide는 선택적 `aiNotes`를 포함할 수 있다. `aiNotes`는 `emphasisPoints`와 검토용 `sourceEvidence`만 담고, 디자인 전용 배열은 만들지 않는다.
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
- AI가 생성한 배경, 장식, 강조 박스, 라인, 아이콘도 별도 `designElements` 배열을 만들지 않고 `slide.elements`에 넣는다.
- 객체 역할은 공통 `role` 필드로 표현하고, `background`, `decoration`, `title`, `subtitle`, `body`, `caption`, `media`, `chart`, `table`, `highlight`, `footer`만 허용한다.
- `role`은 렌더링 필수값이 아니라 AI 생성, 편집 UI, export, 접근성 보조를 위한 의미 정보다.
- `background`, `decoration` 역할의 element는 사용자가 기본 편집 중 실수로 움직이지 않도록 `locked: true`와 낮은 `zIndex`를 권장한다. schema에서는 강제하지 않는다.
- 객체 `props`는 object type별 schema로 검증한다. 전체 객체에 대해 `z.record(z.unknown())`를 열어두지 않는다.
- `text.props`는 `text`, `runs`, `paragraphs`, `bodyInset`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, `verticalAlign`, `lineHeight`, `bullet`을 사용한다. `runs`는 기존 단일 paragraph 호환 field이고, `paragraphs`는 PPTX OOXML import에서 paragraph별 run/font/color/spacing/indent/bullet을 보존하기 위한 optional field다. `bodyInset`은 PPT text box 내부 여백을 px 단위로 보존한다.
- `text.props.fontFamily`, `text.props.color`가 생략되면 renderer/export/AI normalize 단계에서 각각 `slide.style.fontFamily` > `deck.theme.fontFamily`, `slide.style.textColor` > `deck.theme.textColor` 순서로 기본값을 사용한다.
- `image.props`는 `src`, `alt`, `fit`, `focusX`, `focusY`, `crop`을 사용하고, `fit`은 `contain`, `cover`, `stretch`만 허용한다. `focusX`, `focusY`는 `cover` crop 기준점이며 0부터 1 사이 값이다. `crop`은 OOXML `srcRect`를 left/top/right/bottom 0..1 비율로 보존한다.
- `chart.props`는 `chart.schema.ts`의 chart schema를 그대로 사용한다.
- `table.props`는 `rows`, `columnWidths`, `rowHeights`, `borderColor`, `borderWidth`를 사용한다. 각 cell은 `text`, `fill`, `textColor`, `fontFamily`, `fontSize`, `fontWeight`, `align`, `verticalAlign`, `borderColor`, `borderWidth`, `colSpan`, `rowSpan`을 보존한다.
- `rect`, `ellipse`, `line`, `arrow`, `polygon`, `star`, `ring`은 공통 shape props인 `fill`, `stroke`, `strokeWidth`, `borderRadius`, `dash`, `lineCap`, `lineJoin`, `shadow`를 사용한다. `fill`/`stroke`는 `#RRGGBB`, `transparent`, linear gradient paint를 허용한다.
- `customShape.props`만 MVP 확장 지점으로 `record unknown`을 허용한다.
- `group.props`는 `childElementIds`만 가진다.
- group은 child element를 직접 중첩하지 않는다. 실제 child element는 `slide.elements` flat list에 그대로 두고, group은 `childElementIds`로 묶음 관계만 표현한다.
- group의 `childElementIds`는 `el_` prefix를 따르는 `elementId` 목록이다.
- group의 child element 좌표는 group-local 좌표가 아니라 slide canvas 기준 절대 좌표로 유지한다.
- 객체 좌표 `x`, `y`는 `0` 이상이어야 하고, `width`, `height`는 `0`보다 커야 한다.
- 1차 스프린트 MVP에서는 객체 기준점이 음수 좌표가 되는 것까지만 금지한다.
- `x + width > canvas.width`, `y + height > canvas.height`처럼 객체가 오른쪽/아래쪽으로 캔버스 밖에 일부 노출되는 경우는 현재 schema에서 막지 않는다.
- 캔버스 밖 일부 노출을 완전히 금지할지는 PPTX import/export 구현 중 실제 잘림, 누락, 위치 보정 필요성을 확인한 뒤 다시 결정한다.
- 객체 공통 상태 필드는 `rotation`, `opacity`, `zIndex`, `locked`, `visible`을 사용한다.
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
- `durationMs`, `delayMs`, `easing`은 입력에서 생략할 수 있지만, schema parse 후 normalized Deck JSON에는 각각 `400`, `0`, `"ease-out"` 기본값으로 포함한다.
- `easing`은 `linear`, `ease-in`, `ease-out`, `ease-in-out`만 허용한다.
- `slide.keywords[]`는 `required` boolean을 포함한다. 이 값은 발표 중 반드시 언급해야 하는 keyword 여부를 나타내며 기본값은 `true`다.
- 애니메이션 trigger, 다음 슬라이드 trigger 같은 발표 제어 분류는 keyword 필드에 중복 저장하지 않고 연결된 `slide.actions`로부터 파생한다.
- 키워드 기반 authored action은 `slide.actions` flat list에 저장한다.
- 각 action은 `act_` prefix를 따르는 `actionId`와 legacy `cue` 또는 `keywordId` 기반 trigger를 가진다.
- action effect는 `play-animation`, `go-to-next-slide`만 허용한다.
- `play-animation` effect는 같은 slide 안에 있는 `animationId`만 참조할 수 있다.
- `keyword` trigger는 같은 slide 안에 있는 `keywordId`만 참조할 수 있다.
- 밑줄 애니메이션은 1차 스프린트 MVP가 아니라 폴리싱 범위로 둔다.
- AI 생성 결과도 최종적으로 deck JSON으로 변환한다.
- 리허설은 `speakerNotes`, `keywords.text`, `keywords.synonyms`, `keywords.abbreviations`를 기준으로 연결한다.
- 협업/발표 동기화는 `deck_`, `slide_`, `el_`, `anim_` prefix를 따르는 `deckId`, `slideId`, `elementId`, `animationId` 기준으로 처리한다.

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

- `update_deck`: deck 제목 수정
- `add_slide`: slide 전체 추가
- `update_slide`: slide 제목 또는 thumbnail URL 수정
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
- `add_animation`: animation 추가
- `update_animation`: animation 부분 수정
- `delete_animation`: animation 삭제
- `add_slide_action`: slide action 추가
- `update_slide_action`: slide action 부분 수정
- `delete_slide_action`: slide action 삭제

patch 적용 규칙:

- `update_theme`, `update_slide_style`, `update_element_frame`, `update_animation`은 전달된 필드만 기존 값에 병합한다.
- `update_slide_style`에서 `layout`, `fontFamily`, `backgroundColor`, `textColor`, `accentColor`, `backgroundImage`에 `null`을 전달하면 해당 slide override를 제거한다.
- `update_theme.effects.shadow`에 `null`을 전달하면 theme shadow override를 제거한다.
- `update_element_frame.role`에 `null`을 전달하면 element role을 제거한다.
- `update_element_props.props`는 타입별 props의 부분 업데이트를 위해 `record unknown`으로 받는다. 다만 patch 적용 후 최종 element는 `deckElementSchema`가 검증해야 한다.
- `delete_slide`는 최소 1개 slide가 남아야 한다. 이 제약은 patch 적용 후 `deckSchema`의 `slides.min(1)` 검증으로 확인한다.
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

## 프로젝트 생성 구조

프로젝트는 워크스페이스 안에서 생성되며, 1차 스프린트에서는 데모 사용자와 데모 워크스페이스 boundary를 기준으로 접근을 제한한다.

생성 요청:

```json
{
  "title": "Demo Project"
}
```

응답 구조:

```json
{
  "projectId": "project_1",
  "workspaceId": "workspace_demo_1",
  "title": "Demo Project",
  "createdBy": "user_demo_1",
  "createdAt": "2026-06-27T01:00:00+09:00"
}
```

API:

- `POST /api/v1/workspaces/:workspaceId/projects`
- `GET /api/v1/workspaces/:workspaceId/projects`
- `DELETE /api/v1/workspaces/:workspaceId/projects/:projectId`

결정 사항:

- 인증 시스템이 완성되기 전까지는 `DEMO_WORKSPACE_ID`와 `DEMO_USER_ID`를 기준으로 project boundary를 검증한다.
- `workspaceId`가 데모 워크스페이스와 다르면 권한 실패로 처리한다.
- 프로젝트 삭제는 accepted owner만 수행할 수 있으며 응답은 `{ "projectId": "project_1" }` 구조다.
- 프로젝트 응답은 `packages/shared/src/projects/project.schema.ts`의 schema로 검증한다.

구현 위치:

- `packages/shared/src/projects/project.schema.ts`
- `apps/api/src/projects`

## 덱 저장/복원 API 계약

ORBIT-15에서 추가하는 저장/복원 API 계약은 deck 자체 구조를 다시 정의하지 않고, API request/response envelope만 정의한다. NestJS API, web/editor, AI 생성 결과 적용 흐름은 같은 shared schema를 기준으로 payload를 검증한다.

상세 endpoint, request/response, 실패 코드, DB 저장 범위는 [덱 저장/복원 API 명세](api/deck-persistence.md)를 따른다.

MVP API:

- `GET /api/v1/projects/:projectId/deck`
- `PUT /api/v1/projects/:projectId/deck`
- `POST /api/v1/projects/:projectId/deck/patches`
- `GET /api/v1/projects/:projectId/snapshots`
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
- `putDeckRequestSchema`: `deck`, `snapshotReason?`
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
- `SNAPSHOT_NOT_FOUND`
- `PROJECT_MISMATCH`
- `DECK_VALIDATION_FAILED`
- `PATCH_VALIDATION_FAILED`
- `STALE_BASE_VERSION`
- `SNAPSHOT_PROJECT_MISMATCH`
- `PATCH_APPLY_FAILED`

구현 위치:

- `packages/shared/src/deck/deck-api.schema.ts`

## AI 제안 검토/적용 계약

ORBIT-27의 AI 제안은 이미 생성된 slide-scoped `DeckPatch`를 저장하고, 사용자가 승인한 뒤에만 서버의 deck patch 적용 경로로 반영하는 흐름이다. 제안 생성과 목록 조회는 deck을 변경하지 않는다.

MVP API:

- `GET /api/v1/projects/:projectId/ai-suggestions?deckId=&slideId=&status=pending`
- `POST /api/v1/projects/:projectId/ai-suggestions`
- `POST /api/v1/projects/:projectId/ai-suggestions/:suggestionId/apply`
- `POST /api/v1/projects/:projectId/ai-suggestions/:suggestionId/reject`

제안 record:

```json
{
  "suggestionId": "suggestion_1",
  "projectId": "project_demo_1",
  "deckId": "deck_demo_1",
  "slideId": "slide_1",
  "baseVersion": 3,
  "title": "발표 메모 개선",
  "summary": "첫 문장을 더 명확하게 바꿉니다.",
  "patch": "{ DeckPatchSchema, source: ai }",
  "status": "pending",
  "createdAt": "2026-06-29T00:00:00+09:00",
  "updatedAt": "2026-06-29T00:00:00+09:00"
}
```

결정 사항:

- `suggestionId`는 `suggestion_` prefix를 강제한다.
- `status`는 `pending`, `applied`, `rejected`만 허용한다.
- `applied` 상태는 `appliedChangeId`를 반드시 포함하고, `rejected` 상태만 `rejectedReason`을 포함할 수 있다.
- `patch.source`는 반드시 `ai`여야 한다.
- `patch.deckId`와 `patch.baseVersion`은 suggestion의 `deckId`, `baseVersion`과 같아야 한다.
- 모든 operation은 suggestion의 `slideId`와 같은 슬라이드만 대상으로 해야 한다.
- 허용 operation은 `update_slide`, `update_slide_style`, element operation, `update_speaker_notes`, `replace_keywords`, animation operation이다.
- `update_deck`, `add_slide`, `delete_slide`, `reorder_slides`, `update_theme`처럼 deck/theme/slide 구조를 바꾸는 operation은 AI suggestion에서 거부한다.
- apply는 `pending` suggestion만 가능하며, 현재 deck version이 `baseVersion`과 다르면 stale conflict로 실패한다.
- apply는 `DecksService.appendPatch`와 같은 서버 patch 적용 경로를 사용하고 `snapshotReason: "patch-applied"`로 `deck_patches`, `deck_snapshots`를 만든다.
- reject는 `pending` suggestion만 가능하며, 이미 `applied` 또는 `rejected` 상태인 suggestion은 conflict로 실패한다.
- web/editor는 apply 응답이 오기 전 deck을 선반영하지 않고, 응답의 `deck`으로 query/cache를 갱신한다.

지원하는 API schema:

- `createAiSuggestionRequestSchema`: `deckId`, `slideId`, `baseVersion`, `title`, `summary?`, `patch`
- `aiSuggestionSchema`: 저장된 suggestion record
- `listAiSuggestionsQuerySchema`: `deckId?`, `slideId?`, `status?`
- `createAiSuggestionResponseSchema`: `suggestion`
- `listAiSuggestionsResponseSchema`: `projectId`, `suggestions`
- `applyAiSuggestionResponseSchema`: `suggestion`, `deck`, `changeRecord`, `snapshot`, `updatedAt`
- `rejectAiSuggestionResponseSchema`: `suggestion`
- `aiSuggestionErrorSchema`: `code`, `message`, `details`

MVP 실패 코드:

- `AI_SUGGESTION_VALIDATION_FAILED`
- `AI_SUGGESTION_NOT_FOUND`
- `AI_SUGGESTION_NOT_PENDING`
- `AI_SUGGESTION_SLIDE_DELETED`
- `AI_SUGGESTION_STALE_BASE_VERSION`
- `AI_SUGGESTION_PATCH_APPLY_FAILED`
- `AI_SUGGESTION_PROJECT_MISMATCH`

구현 위치:

- `packages/shared/src/deck/ai-suggestion.schema.ts`
- `apps/api/src/ai-suggestions`
- `apps/web/src/features/editor/suggestions`

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
    "slidePresetId": "process-cards-horizontal-6",
    "visualRhythm": "technical",
    "densityTarget": "medium",
    "mediaPolicy": "balanced",
    "layoutDiversity": "stable"
  },
  "references": [{ "fileId": "file_1" }],
  "designReferences": [{ "fileId": "file_design_1" }],
  "templateBlueprintId": "template_file_design_1",
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
- 요청의 `references`는 `{ fileId: string }[]`이며 비어 있으면 topic-only generation으로 처리한다.
- 요청의 `templateBlueprintId`는 선택 필드이며, AI 생성에 템플릿 의미 정보를 직접 넣지 않고 저장된 `TemplateBlueprint` sidecar만 참조한다.
- 요청의 `referenceKeywords`는 `{ text: string }[]` 선택 필드이며 기본값은 `[]`이다. 참고자료 처리 결과의 주요 키워드를 전달할 때 사용한다.
- `referenceContext`는 `{ fileId, title, content }[]` 형태의 선택 필드이며 기본값은 `[]`이다. `/documents/parse`의 정제된 excerpt를 `/ai/generate-deck` grounding 입력으로 직접 넘길 때 사용하고, Deck metadata에는 원문을 저장하지 않는다.
- 요청의 `designPrompt`는 선택 필드이며 기본값은 없다. 값이 있으면 콘텐츠 지시가 아니라 시각 스타일 지시로만 사용하고, LLM은 `visualIntent.paletteHint`에 `background:#RRGGBB` 같은 검증 가능한 theme token을 제안한다.
- 기존 클라이언트처럼 `designPrompt` 없이 `prompt`만 보내는 요청은 계속 허용한다. worker는 하위 호환을 위해 명확한 디자인 문구만 fallback으로 분리하고, 분리되지 않은 값은 기존 콘텐츠 prompt로 처리한다.
- MVP `metadata.audience`는 `general`, `executive`, `technical`, `sales`만 허용한다.
- MVP `metadata.purpose`는 `inform`, `persuade`, `teach`, `report`만 허용한다.
- MVP `metadata.tone`은 `professional`, `friendly`, `confident`, `concise`만 허용한다.
- 요청의 `design`은 선택 필드이며 생략 시 `{ visualRhythm: "auto", densityTarget: "medium", mediaPolicy: "balanced", layoutDiversity: "stable" }`로 정규화한다.
- `design.profile`은 선택 필드이며 `executive-report`, `startup-pitch`, `editorial`, `technical`, `training`만 허용한다. profile은 기존 `theme`, `slide.style`, `SlotPreset` 선택 가중치로만 매핑하고 최종 Deck에 별도 중간 구조를 저장하지 않는다.
- `design.stylePackId`는 선택 필드이며 worker 내부 curated style pack ID를 강제한다. 값이 없으면 worker selector가 자동 선택한다.
- `design.slidePresetId`는 선택 필드이며 worker 내부 slide recipe ID를 강제한다. 값이 없으면 worker selector가 slide intent와 step count를 기준으로 자동 선택한다.
- `design.visualRhythm`은 `auto`, `clean`, `editorial`, `bold`, `technical`만 허용한다.
- `design.densityTarget`은 `low`, `medium`, `high`만 허용한다.
- `design.mediaPolicy`는 `avoid`, `balanced`, `placeholder-ok`만 허용하며, source 없는 media placeholder는 `placeholder-ok`에서만 허용한다.
- `design.layoutDiversity`는 `stable`, `varied`만 허용한다.
- template은 `default`, `pitch`, `report`, `lesson`만 허용한다.
- Python worker의 `/ai/generate-deck`은 `projectId`와 요청 본문을 받아 최종 `DeckSchema`를 만든다.
- LLM/provider가 만드는 내용은 outline, message, design intent까지로 제한하고, 좌표/크기/zIndex는 코드 기반 layout engine이 계산한다.
- LLM은 좌표, 크기, zIndex를 만들지 않는다. layout preset 후보 탐색과 최종 좌표 계산은 worker 코드가 수행한다.
- `slotPreset`, `stylePackId`, `slidePresetId`, `visualIntent`, `mediaIntent`, `layoutCandidates` 같은 생성 중간 필드는 최종 `DeckSchema`에 저장하지 않는다.
- 생성 결과의 디자인은 새 배열 없이 기존 `deck.theme`, `slide.style`, `slide.elements`, chart props, `slide.animations`에 매핑한다.
- Python worker는 source data가 없는 chart 숫자를 임의 생성하지 않는다. 근거 데이터가 없으면 `chart.props.data: []`인 editable chart placeholder와 `warnings`/`validation.designIssues`를 남긴다.
- `validation.designIssues`는 overflow, contrast, collision, safe area, density, placeholder media, chart data provenance 같은 advisory warning을 담는다. 이 warning이 있어도 `validation.passed`가 true이면 worker는 deck을 저장한다.
- worker는 Python 응답을 shared `generateDeckResponseSchema`와 `deckSchema`로 검증한 뒤 `decks`에 저장하고 job result에 `{ deckId, deck, warnings, validation }`을 저장한다.
- 후속 AI 생성이 템플릿을 사용할 때는 `TemplateBlueprint.slots` 중 `usage`가 `content-slot` 또는 `media-slot`이고 `replaceMode`가 `replace`인 slot만 수정한다. `fixed-text`, `decoration`, `preserve`, 낮은 confidence slot은 수정하지 않는다.

구현 위치:

- `packages/shared/src/deck/generate-deck.schema.ts`
- `services/python-worker/app/ai/generate_deck.py`
- `apps/api/src/generate-deck`
- `apps/worker/src/generate-deck.processor.ts`

## PPTX import, Template Blueprint, Quality Report 계약

PPTX import는 최종 편집/렌더링용 `Deck`과 템플릿 의미 sidecar인 `TemplateBlueprint`를 분리한다. `Deck`/`DeckElement` schema는 변경하지 않고, 템플릿 의미 판단은 `packages/shared/src/deck/template-blueprint.schema.ts`의 sidecar를 원본으로 둔다.

API:

- `POST /api/v1/projects/:projectId/pptx-imports`
- request: `{ "fileId": "file_1" }`
- response: `{ "job": "{ JobSchema }" }`
- Job type: `pptx-import`

PPTX import job result:

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

결정 사항:

- Python worker의 `/design/import-pptx`는 기존 `blueprint`, `assets`, `warnings`와 함께 `templateBlueprint`, `qualityReport`를 반환한다.
- `ORBIT_PPTX_OOXML_VECTOR_IMPORT` 기본값은 `true`이며, Python worker는 OOXML XML 직접 파서 기반 visual tree를 먼저 사용한다. 지원하지 않는 OOXML 효과는 임의 변환하지 않고 `warnings`에 남기며, 파서 실패 시 기존 `python-pptx` importer로 fallback한다. `false`로 설정하면 기존 `python-pptx` importer를 사용한다.
- Worker는 imported image asset을 기존 `design-asset` 저장 흐름으로 저장하고 asset ref를 API asset content URL로 교체한 뒤 `DeckSchema`로 검증해 `decks`에 저장한다.
- `templateBlueprint`와 `qualityReport`는 `template_blueprints` 테이블에 저장한다.
- placeholder `p:ph`에서 온 텍스트/미디어는 `content-slot` 또는 `media-slot`과 `replace`로 분류한다.
- master/layout 유래 요소, 반복 텍스트, 직접 그린 애매한 텍스트 박스는 기본적으로 `decoration` 또는 `fixed-text`이며 `preserve`/`ignore`와 낮은 confidence를 사용한다.
- Quality composite score는 geometry 25, text 15, color 10, layer 10, editability 10, pixel similarity 30 가중치를 사용한다.
- pixel renderer가 없으면 `pixelSimilarity: null`로 두고 나머지 항목을 재가중한다. slide별 평가는 `qualityReport.slideReports[]`에 `passed`, `vectorization_failed`, `not_evaluated`와 `ssim`, 실패 사유, fallback 후보를 남긴다.
- `editabilityCoverage < 0.5`면 총점 cap 70, `< 0.2`면 cap 50을 적용해 whole-slide image 변환이 높은 점수를 받지 못하게 한다.

구현 위치:

- `packages/shared/src/deck/template-blueprint.schema.ts`
- `services/python-worker/app/ai/pptx_design_importer.py`
- `apps/api/src/pptx-imports`
- `apps/worker/src/pptx-import.processor.ts`

## PPTX OOXML generation contract

PPTX OOXML generation is legacy. New deck creation starts from
`pptx-import`, which imports editable `DeckElement` objects and keeps the
OOXML package in `TemplateBlueprint` sidecar fields. Rendered PNGs are
thumbnail/fallback/sync verification assets, not the default editing layer.

API:

- `POST /api/v1/projects/:projectId/pptx-ooxml-generations`
- request: `{ "fileId": "file_1", "topic": "optional", "prompt": "optional" }`
- response: `{ "job": "{ JobSchema }" }`
- Job type: `pptx-ooxml-generation`
- Queue name: `pptx-ooxml-generation`

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
- `slides[].elementSources[]`
- `slides[].elementSources[]`: `{ elementId, slidePart, shapeId, relationshipId?, sourceType, writable, fallbackReason? }`
- `slots[].source.slidePart`
- `slots[].source.shapeId`
- `slots[].source.relationshipId`

## AI template deck generation contract

Home screen AI generation uses one master job to combine content references
with a PPTX design template. The worker runs content extraction and PPTX OOXML
template conversion in parallel, then generates a deck, applies generated text
back into the PPTX package, and saves the final deck for the editor.

API:

- `POST /api/v1/projects/:projectId/jobs/ai-template-deck-generation`
- Job type: `ai-template-deck-generation`
- Queue name: `ai-template-deck-generation`

Request:

```json
{
  "topic": "발표 주제",
  "prompt": "내용 지시사항",
  "designPrompt": "디자인 지시사항",
  "targetDurationMinutes": 10,
  "slideCountRange": { "min": 5, "max": 8 },
  "template": "default",
  "metadata": {
    "audience": "general",
    "purpose": "inform",
    "tone": "professional"
  },
  "design": {
    "visualRhythm": "auto",
    "densityTarget": "medium",
    "mediaPolicy": "balanced",
    "layoutDiversity": "stable"
  },
  "assets": [
    { "fileId": "file_content_1", "role": "content" },
    { "fileId": "file_design_1", "role": "design" }
  ]
}
```

Rules:

- `assets[].role` is `content`, `design`, or `both`.
- Exactly one `design` or `both` asset is required.
- The design asset must be an uploaded PPTX with `purpose: "pptx-import"`.
- Content assets are sent through `/documents/parse` and become
  `references`/`referenceKeywords` for `/ai/generate-deck`.
- A `both` PPTX is sent through both `/documents/parse` and
  `/ai/pptx-ooxml-generation`; its extracted text is forwarded to
  `/ai/generate-deck` as `referenceContext` so speaker notes and keywords can
  be grounded without depending on reference search availability.
- A `design`-only PPTX is never added to `references`, `referenceKeywords`, or
  `referenceContext`.
- The design PPTX is sent through `/ai/pptx-ooxml-generation`; the final
  generated text is applied through `/ai/pptx-ooxml-apply-slot-texts`.
- The worker saves the final Deck and creates an initial `deck-replaced`
  snapshot from that same Deck, including generated `thumbnailUrl` values.
- Final AI template deck thumbnails come from the generated PPTX render assets;
  every generated slide must have a matching render asset, and the saved deck
  sets `metadata.thumbnailSource = "import-render"`.
- `slideCountRange` is the authoritative user-requested generation range.
  The reference PPTX page count never overrides it.
- `referenceSlideCount` means the number of slides imported from the design
  PPTX. It is only the size of the reusable layout pool.
- `requestedSlideCountRange` is the exact `{ min, max }` forwarded from the
  home request to `/ai/generate-deck`.
- `targetSlideCount` is the Python worker's selected count inside
  `requestedSlideCountRange`; `generatedSlideCount` is the final
  `deck.slides.length` and must stay inside that requested range.
- `templateSelection` maps each generated slide to a reference layout:
  `{ generatedOrder, sourceSlideIndex, selectionReason }`. The API worker uses
  this mapping to filter/reorder `TemplateBlueprint.slides` before slot text
  extraction, PPTX apply, render asset linking, and sidecar save.
- If a reference layout is reused or selected out of source order, the API
  worker saves generated slides as sequential `sourceSlideIndex` values and
  stores the original PPTX page in `cloneSourceSlideIndex` and the actual
  OOXML part in `cloneSourceSlidePart`. The Python worker clones that source
  part into the generated slide part before applying text, so the saved PPTX
  package and sidecar have the same slide count and order.
- `TemplateBlueprint.slides[]` may include semantic selection metadata:
  `slideRole`, `layoutType`, `contentCapacity`, and `selectionReason`.

Job result:

```json
{
  "deckId": "deck_ai_project_1",
  "templateId": "template_file_design_1",
  "sourceFileId": "file_design_1",
  "currentPackageFileId": "file_current_package",
  "contentReferenceFileIds": ["file_content_1"],
  "qualityReport": "{ QualityReport }",
  "warnings": []
}
```

## PPTX OOXML sync contract

Deck patch storage succeeds immediately. If the deck has an OOXML-backed
`TemplateBlueprint`, `POST /api/v1/projects/:projectId/deck/patches` enqueues
a background sync job and may include `ooxmlSyncJob` in the response.

Job:

- Job type: `pptx-ooxml-sync`
- Queue name: `pptx-ooxml-sync`

Job result:

```json
{
  "deckId": "deck_import_file_1",
  "templateId": "template_file_1",
  "currentPackageFileId": "file_current_package",
  "renderAssetFileIds": ["file_slide_1"],
  "syncedDeckVersion": 2,
  "warnings": []
}
```

Supported first-pass patch operations:

- `update_element_frame`
- `update_element_props`
- `add_element`
- `delete_element`

`zIndex` sync can warn without reverting the saved `DeckPatch`.

Implementation locations:

- `packages/shared/src/deck/pptx-ooxml-generation.schema.ts`
- `apps/api/src/pptx-ooxml-generations`
- `apps/worker/src/pptx-ooxml-generation.processor.ts`
- `apps/worker/src/pptx-ooxml-sync.processor.ts`
- `services/python-worker/app/ai/pptx_ooxml_generation.py`

## 파일 업로드 결과 구조

파일 업로드는 공통 API로 제공하고, 각 기능은 `fileId`와 `purpose`를 기준으로 업로드 결과를 사용한다.

```json
{
  "fileId": "file_1",
  "projectId": "project_demo_1",
  "originalName": "sample.pptx",
  "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "size": 1024000,
  "url": "/uploads/file_1",
  "purpose": "pptx-import",
  "createdAt": "2026-06-27T01:00:00+09:00"
}
```

`purpose` 값:

- `pptx-import`
- `reference-material`
- `rehearsal-audio`
- `export-result`
- `report-result`
- `thumbnail`
- `design-asset`

결정 사항:

- 업로드 후 API 응답은 위 구조로 통일한다.
- PPTX import, 참고자료 추출, 리포트용 리허설 STT는 모두 `fileId`를 받아 시작한다.
- `url`은 임시로 로컬 경로를 쓰되, 이후 S3 signed URL로 교체할 수 있게 유지한다.
- 업로드 요청은 `POST /api/v1/projects/:projectId/assets/upload-url`로 시작한다.
- 업로드 완료 처리는 `POST /api/v1/projects/:projectId/assets/complete`에서 `fileId`를 받아 위 구조를 반환한다.
- 1차 구현에서 허용하는 mime type은 purpose별로 제한한다. 문서/이미지 purpose는 PDF, PPTX, DOCX, JPEG, PNG, WebP를 허용하고 최대 크기는 50MiB다. `rehearsal-audio`는 MP3, MP4, MPEG, MPGA, M4A, FLAC, WAV, WebM 계열만 허용한다. `REPORT_STT_PROVIDER=openai` 경로에서는 `REHEARSAL_AUDIO_MAX_BYTES` 기본값과 최대값을 25MB로 유지한다. WhisperX는 현재 별도 provider 최대 크기 계약을 정의하지 않는다.
- upload URL을 발급한 뒤 complete가 호출되지 않은 파일은 `pending` metadata로 남기고, 정리 정책은 후속 작업에서 결정한다.
- 분석이 끝난 `rehearsal-audio` raw object는 삭제하고, metadata는 `status=deleted`, `deletedAt`으로 추적한다.

구현 위치:

- `packages/shared/src/files/file.schema.ts`
- `apps/api/src/files`

## 리허설 STT/AI provider 구분

리허설에는 서로 다른 두 종류의 음성/AI 처리가 있다. 두 흐름은 provider, latency 요구사항, 데이터 보존 정책이 다르므로 하나의 `STT_PROVIDER`로 표현하지 않는다.

### Live STT

발표/리허설 중 사용자의 발화를 실시간으로 인식해 화면 제어에 사용한다.

- device-local provider env: `LIVE_STT_PROVIDER=sherpa`
- 기본 browser engine: `openai-realtime`
- OpenAI model env: `OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper`
- 실행 위치: web 또는 device-local runtime
- 목적: 애니메이션 cue, 강조 표시, 키워드 누락 체크, 다음 슬라이드 전환 제안/실행
- 입력: 마이크 스트림
- 출력: partial transcript, keyword detection, cue event, slide advance signal
- 원칙: raw audio를 서버 리포트용 storage에 업로드하지 않는다.
- OpenAI Realtime 경로는 raw OpenAI API key를 브라우저에 노출하지 않고, API가 project read 권한을 확인한 뒤 ephemeral client secret만 반환한다.
- 구현 위치: `packages/shared/src/rehearsals/live-stt.schema.ts`, `packages/shared/src/rehearsals/realtime-transcription.schema.ts`, `apps/api/src/realtime-transcription`, `apps/web/src/features/rehearsal`

OpenAI Realtime client secret API:

- `POST /api/v1/projects/:projectId/realtime-transcription/client-secret`
  - 인증: signed session cookie 필수
  - 권한: `projectId`에 대한 read 권한 필요
  - response: `{ "clientSecret": "ek_...", "expiresAt": 1790000000, "model": "gpt-realtime-whisper", "delay": "minimal" }`
  - 서버 로그에는 OpenAI API key, client secret, raw audio, transcript 원문을 남기지 않는다.

### Report STT/AI

리허설 종료 뒤 녹음 파일을 전사하고 코칭 리포트를 생성한다.

- STT provider env: `REPORT_STT_PROVIDER=openai | whisperx`
- WhisperX env: `WHISPERX_API_URL`, `WHISPERX_API_KEY`, `WHISPERX_MODEL`, `WHISPERX_TIMEOUT_MS`
- rehearsal audio limit env: `REHEARSAL_AUDIO_MAX_BYTES=25000000`
- LLM provider env: `LLM_PROVIDER=openai`
- 실행 위치: API/worker/Python worker
- 목적: 억양, 말 속도, 톤, 발음, 키워드 누락, 청중 반응 등을 종합한 리포트와 코칭 생성
- 입력: `rehearsal-audio` fileId, deck JSON, 키워드, 청중 반응 데이터
- 출력: transcript, metrics, coaching/report result
- 원칙: 분석 완료 직후 raw audio object를 삭제하고 삭제 시각을 기록한다.

## 리포트용 리허설 Run 및 STT 계약

리포트용 리허설 녹음은 run 단위로 생성하고, 현재 구현된 upload-url 기반 `rehearsal-audio` 업로드가 완료된 뒤 `rehearsal-stt` Job을 시작한다. 이 계약은 실시간 발표 제어용 Live STT 계약이 아니다.

Run 상태:

- `created`
- `uploading`
- `processing`
- `succeeded`
- `failed`

Run 응답 구조:

```json
{
  "runId": "run_1",
  "projectId": "project_demo_1",
  "deckId": "deck_demo_1",
  "audioFileId": "file_audio_1",
  "jobId": "job_1",
  "status": "processing",
  "error": null,
  "rawAudioDeletedAt": null,
  "createdAt": "2026-06-27T01:00:00+09:00",
  "updatedAt": "2026-06-27T01:00:00+09:00"
}
```

API:

- `POST /api/v1/projects/:projectId/rehearsals`
  - request: `{ "deckId": "deck_demo_1" }`
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/audio/upload-url`
  - request: `{ "originalName": "rehearsal.webm", "mimeType": "audio/webm", "size": 1048576 }`
  - `size`는 service runtime schema에서 `REPORT_STT_PROVIDER`와 `REHEARSAL_AUDIO_MAX_BYTES` 기준으로 검증한다.
  - response: `{ "run": RehearsalRun, "upload": AssetUploadUrlResponse }`
- `POST /api/v1/rehearsals/:runId/audio/complete`
  - request: `{ "fileId": "file_audio_1" }`
  - run에 연결된 `fileId`만 허용하고, 업로드 완료 확인 뒤 `rehearsal-stt` Job을 enqueue한다.
  - response: `{ "run": RehearsalRun, "job": Job }`
- `GET /api/v1/rehearsals/:runId`
  - response: `{ "run": RehearsalRun }`
- `GET /api/v1/rehearsals/:runId/report`
  - response: `{ "run": RehearsalRun, "report": RehearsalReport | null }`
  - run이 아직 `processing`이거나 과거 run에 `report_json`이 없으면 `report`는 `null`이다.
- `PATCH /api/v1/rehearsals/:runId/meta`
  - request: `{ "slideTimeline": [{ "slideId": "slide_1", "enteredAt": "2026-07-02T00:00:00.000Z" }], "missedKeywords": [{ "slideId": "slide_1", "keywordId": "kw_1" }], "adviceEvents": [{ "type": "pace-too-fast", "at": "2026-07-02T00:00:30.000Z" }] }`
  - transcript, speaker notes, raw audio, script 원문은 받지 않는다.
  - response: `{ "run": RehearsalRun }`

후속 구현 예정 API:

- `POST /api/v1/rehearsals/:runId/audio-begin`
  - request: `{ "codec": "flac", "sampleRate": 16000, "channels": 1, "chunkDurationMs": 30000 }`
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/audio-chunks/:index`
  - params: `index`는 `0`부터 시작하는 정수다. route segment로 들어오는 문자열 숫자는 shared schema에서 정수로 변환한다.
  - body: `audio/flac` chunk binary. 서버는 chunk별 hash 검증과 중복 업로드 멱등 처리를 담당한다.
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/audio-complete`
  - request: `{ "chunkCount": 3, "totalDurationMs": 90000, "totalSizeBytes": 1048576, "sha256": "<64 hex>" }`
  - 청크 수, 전체 길이, runtime 크기 한도, 조립 결과 sha256을 검증한 뒤 `rehearsal-stt` Job을 enqueue한다.
  - response: `{ "run": RehearsalRun, "job": Job }`

Report 응답 구조:

리허설 Report 계약은 `rehearsal_runs.report_json`에 저장되는 서버 생성 결과만 공식 값으로 본다. MVP 단계의 공식 지표는 `metrics`의 원시 측정값과 `coaching` 요약이며, 프론트엔드는 이 계약에 없는 0-100 점수나 상세 평가값을 별도로 계산해 공식 점수처럼 표시하지 않는다.

```json
{
  "reportId": "report_run_1",
  "runId": "run_1",
  "projectId": "project_demo_1",
  "deckId": "deck_demo_1",
  "transcriptRetained": false,
  "transcript": null,
  "metrics": {
    "durationSeconds": 90,
    "wordsPerMinute": 120,
    "fillerWordCount": 2,
    "pauseCount": 1,
    "keywordCoverage": 0.75
  },
  "speedSamples": [
    {
      "startSecond": 0,
      "endSecond": 5,
      "wordsPerMinute": 120
    }
  ],
  "fillerWordDetails": [
    {
      "word": "음",
      "count": 2
    }
  ],
  "pauseDetails": [
    {
      "startSecond": 2,
      "endSecond": 3.5,
      "durationSeconds": 1.5
    }
  ],
  "missedKeywords": [
    {
      "slideId": "slide_1",
      "keywordId": "kw_1",
      "text": "핵심 메시지"
    }
  ],
  "slideTimings": [
    {
      "slideId": "slide_1",
      "targetSeconds": 60,
      "actualSeconds": 52
    }
  ],
  "qnaSummary": {
    "questionCount": 0,
    "questionSummary": "",
    "unclearTopics": []
  },
  "coaching": {
    "status": "succeeded",
    "summary": "핵심 메시지가 분명합니다.",
    "strengths": ["키워드를 언급했습니다."],
    "improvements": ["불필요한 filler를 줄이세요."],
    "nextPracticeFocus": "도입부를 더 짧게 연습하세요.",
    "message": ""
  },
  "generatedAt": "2026-06-27T01:00:10+09:00"
}
```

결정 사항:

- `audio/complete`는 run에 연결된 `fileId`만 허용한다.
- worker는 시작 시 run을 `processing`으로 갱신하고, 성공 시 `succeeded`, 실패 시 `failed`로 갱신한다.
- STT와 코칭 분석이 끝난 직후 raw audio object를 삭제한다.
- raw audio 삭제 성공은 `rawAudioDeletedAt`과 `project_assets.status=deleted`, `deleted_at`으로 남긴다.
- 삭제 실패는 `RAW_AUDIO_DELETE_FAILED` error로 run/job 양쪽에 남긴다.
- 공식 보고서 원본은 `jobs.result`가 아니라 `rehearsal_runs.report_json`이다.
- `transcript_retained` 기본값은 `false`이며, `false`일 때 `report.transcript`는 반드시 `null`이다.
- `GET /api/v1/rehearsals/:runId/report` 접근은 현재 프로젝트 접근 경계(`ProjectsService.getAccessibleProject`)를 재사용한다.
- ORBIT-37의 고급 0-100 점수 산식은 이 계약에 포함하지 않으며, 실제 산식이 확정되기 전까지 UI에서도 점수를 표시하지 않는다.
- `score`, `deliveryScore`, `speedScore`처럼 산식이 확정되지 않은 점수 필드는 `RehearsalReport`에 저장하지 않는다.
- 말 속도 변화는 `speedSamples`, 습관어 상세는 `fillerWordDetails`, pause 상세는 `pauseDetails`, 누락 키워드 상세는 `missedKeywords`를 공식 필드로 사용한다. 값이 부족하면 빈 배열을 저장하며, UI는 deck 또는 평균값만으로 상세 지표를 추정하지 않는다.
- 슬라이드별 목표/실제 시간은 `slideTimings`를 공식 필드로 사용한다. `targetSeconds`는 deck의 `estimatedSeconds` 또는 `targetDurationMinutes` 기반 목표값이고, `actualSeconds`는 `PATCH /api/v1/rehearsals/:runId/meta`의 `slideTimeline`에서 연속된 slide 진입 시각 차이로 계산한다. 종료 시각이 없는 마지막 slide는 실제 시간을 추정하지 않는다.
- 청중 QnA 기반 피드백은 질문 원문을 저장하지 않고 `qnaSummary.questionCount`, `qnaSummary.questionSummary`, `qnaSummary.unclearTopics[].topic`, optional `slideId`만 report에 저장한다. 현재 audience 질문 저장 API가 없으면 기본값은 질문 수 0과 빈 요약이다.

구현 위치:

- `packages/shared/src/rehearsals/live-stt.schema.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.ts`
- `apps/api/src/rehearsals`
- `apps/worker/src/rehearsal-stt.processor.ts`

## Job 상태 구조

PPTX import/export, 참고자료 추출, AI 생성, 리허설 STT, 최종 보고서는 모두 동일한 Job 구조를 사용한다.

```json
{
  "jobId": "job_1",
  "projectId": "project_demo_1",
  "type": "pptx-import",
  "status": "queued",
  "progress": 0,
  "message": "작업 대기 중",
  "result": null,
  "error": null,
  "createdAt": "2026-06-27T01:00:00+09:00",
  "updatedAt": "2026-06-27T01:00:00+09:00"
}
```

`status` 값:

- `queued`
- `running`
- `succeeded`
- `failed`

`type` 값:

- `pptx-import`
- `deck-export`
- `reference-extract`
- `ai-deck-generation`
- `ai-template-deck-generation`
- `pptx-ooxml-generation`
- `pptx-ooxml-sync`
- `worker-health-check`
- `rehearsal-stt`
- `final-report-generation`
- `report-pdf-export`

결정 사항:

- 오래 걸리는 작업은 전부 Job으로 처리한다.
- 프론트는 `jobId`로 진행률을 조회한다.
- 성공 결과는 `result`, 실패 이유는 `error`에 넣는다.

구현 위치:

- `packages/shared/src/jobs/job.schema.ts`

## WebSocket 이벤트 구조

실시간 협업과 발표 동기화는 WebSocket 공통 envelope을 사용하고, 이벤트별 `payload`는 shared schema로 검증한다.

```json
{
  "type": "slide-changed",
  "roomId": "project_demo_1",
  "sessionId": "session_demo_1",
  "userId": "user_demo_1",
  "payload": {
    "deckId": "deck_demo_1",
    "slideId": "slide_1",
    "slideIndex": 0
  },
  "sentAt": "2026-06-27T01:00:00+09:00"
}
```

최소 이벤트:

- `project-joined`
- `project-presence`
- `deck-updated`
- `slide-changed`
- `highlight-changed`
- `presentation-started`
- `audience-joined`
- `question-created`
- `poll-voted`
- `survey-submitted`

결정 사항:

- `roomId`는 `projectId` 기준으로 시작한다.
- 서버 내부 Socket.IO project room key는 `project:${projectId}` 형식을 사용한다.
- `project:join`은 signed session cookie로 인증하고, 프로젝트 읽기 권한을 확인한 뒤 해당 project room에 입장시킨다.
- `project-presence` payload에는 `projectId`와 현재 project room 접속자 목록을 넣는다.
- 발표 세션은 `sessionId`로 구분한다.
- `slide-changed` payload에는 `deckId`, `slideId`, `slideIndex`를 넣는다.
- `highlight-changed` payload에는 `slideId`, `elementId`, `state`를 넣는다.

`project-presence` payload:

```json
{
  "projectId": "project_demo_1",
  "users": [
    {
      "id": "socket_demo_1",
      "userId": "user_demo_1",
      "email": "user@example.com",
      "connectedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

구현 위치:

- `packages/shared/src/realtime/websocket.schema.ts`

## Shared schema 파일 배치 원칙

`packages/shared`는 프론트엔드, API, worker, realtime, AI 패키지가 함께 사용하는 런타임 계약을 관리한다.

원칙:

- `packages/shared/src/index.ts`에는 구현을 두지 않고 export만 둔다.
- 새 공통 schema는 기능 영역별 폴더에 둔다.
- deck 편집과 직접 관련된 계약은 `packages/shared/src/deck`에 둔다.
- 파일 업로드 계약은 `packages/shared/src/files`에 둔다.
- Job 계약은 `packages/shared/src/jobs`에 둔다.
- WebSocket event 계약은 `packages/shared/src/realtime`에 둔다.
- 발표/리허설/보고서 계약은 `packages/shared/src/presentation`에 둔다.
- schema를 변경하면 이 문서와 `packages/shared/src/README.md`도 함께 갱신한다.

## E2E 체크리스트

- [ ] [1번] 프로젝트 생성 가능
- [ ] [1번] PPTX 또는 참고자료 파일 업로드 가능
- [ ] [2번] PPTX 파일을 편집 가능한 덱으로 가져오기 가능
- [ ] [2번] 슬라이드 목록과 캔버스 표시 가능
- [ ] [2번] 텍스트/객체 수정 후 저장/복원 가능
- [ ] [3번] 참고자료 텍스트 추출 가능
- [ ] [3번] 참고자료 기반 AI 덱 생성 가능
- [ ] [3번] AI 제안을 기존 덱에 적용 가능
- [ ] [4번] 다른 브라우저에서 같은 덱 접속 가능
- [ ] [4번] 한쪽 편집 내용이 다른 쪽에 동기화됨
- [ ] [5번] 슬라이드별 발표 키워드 편집 가능
- [ ] [5번] 리허설 녹음/STT 가능
- [ ] [5번] 기본 리허설 보고서 확인 가능
- [ ] [4번] 발표 세션 생성 가능
- [ ] [4번] 청중 입장 가능
- [ ] [4번] 현재 슬라이드가 청중 화면에 동기화됨
- [ ] [4번] 강조/애니메이션 상태가 청중 화면에 반영됨
- [ ] [5번] 청중 질문 등록 가능
- [ ] [5번] 라이브 투표 참여 가능
- [ ] [5번] 질문/투표/세션 로그 기반 최종 보고서 확인 가능
- [ ] [전원] 처음부터 끝까지 한 번의 데모 흐름으로 이어짐

E2E 시작점은 로그인부터가 아니라 임시 사용자 기반 프로젝트 생성부터다.

## 미해결 질문과 담당자

미확정 항목이 생기면 아래 형식으로 기록하고, 결정 시각과 담당자를 반드시 남긴다.

| 항목 | 담당자 | 결정 시각 | 상태 | 결정 내용 |
| ---- | ------ | --------- | ---- | --------- |
| -    | -      | -         | -    | -         |
