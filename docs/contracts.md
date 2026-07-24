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
- `activity` Slide는 strict `ActivityDefinition` 하나를 소유하고, `activity-results` Slide는 strict `{ sourceActivityId, display: "live", layout }` 참조만 소유한다.
- Activity가 하나라도 있는 Deck은 `canvas.preset = "wide-16-9"`여야 한다. `activityId`는 Deck 안에서 유일하다.
- 정의에는 `pre-question | poll | satisfaction` template과 `rating | single-choice | multiple-choice | free-text` 문항만 허용한다.
- 만족도 조사는 최대 5문항, 사전 질문은 `free-text` 1~5문항, 투표는 선택지 2~8개의 `single-choice` 1문항이다.
- 평점 문항 aggregate는 `average`와 1~5점의 `value`, `count`, `ratio`를 모두 담은 `ratingDistribution`을 제공한다. 비평점 문항의 `ratingDistribution`은 빈 배열이다.
- 응답, aggregate, QR 이미지, audience URL, response count는 Deck JSON과 `slide.elements`에 저장하지 않는다. 일반 장표의 참여 QR 요소는 `type: "activity-qr"`, `props: { activityId }`로 activity ID만 참조하고, editor·live renderer가 현재 `PresentationSession`에서 QR을 동적으로 만든다. activity run 생성은 발표 시작에서 명시적으로 수행하며, 편집·썸네일·미리보기 렌더링은 읽기 전용 조회만 한다. Deck 복제는 이 참조를 remap하고, 원본 활동 장표 삭제는 연결된 QR 요소를 함께 제거한다. 정적 PPTX/PNG export에서는 이 요소를 안내 텍스트로 바꾼다.
- 결과 장표의 dangling `sourceActivityId`는 parse를 허용하고 editor/renderer에서 `source-missing` 복구 상태로 표시한다.
- Deck patch는 `update_activity_definition`, `update_activity_result_definition` 전용 operation을 사용하며 적용 후 전체 Deck을 다시 검증한다.

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
  이른 시점이다.
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
고정 `presentation:error`다.

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
- `PATCH /api/v1/workspaces/:workspaceId/projects/:projectId/pin`
- `PATCH /api/v1/workspaces/:workspaceId/projects/:projectId/tags`
- `DELETE /api/v1/workspaces/:workspaceId/projects/:projectId`

결정 사항:

- 인증 시스템이 완성되기 전까지는 `DEMO_WORKSPACE_ID`와 `DEMO_USER_ID`를 기준으로 project boundary를 검증한다.
- `workspaceId`가 데모 워크스페이스와 다르면 권한 실패로 처리한다.
- 프로젝트 목록의 각 항목은 로그인 사용자의 `project_members.is_pinned` 값을 `isPinned`으로 포함한다.
- 프로젝트 목록의 각 항목은 `tags`와 최신 활성 `ai-deck-generation` 또는 `pptx-ooxml-generation` 작업의 `generation` 요약을 포함한다. 요약은 `jobId`, `type`, `status`, `progress`, `message` 구조이며 활성 작업이 없으면 `generation`은 `null`이다.
- 프로젝트 고정 변경 요청은 `{ "isPinned": true }`, 응답은 `{ "projectId": "project_1", "isPinned": true }` 구조이며 accepted member 본인의 상태만 변경한다.
- 프로젝트 태그 변경 요청은 `{ "tags": ["중요", "완료"] }` 구조다. 태그는 프로젝트당 최대 12개, 각 20자 이하이며 중복을 허용하지 않는다.
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

## Project access 오류 계약

프로젝트 권한과 구성원 조회는 `projectAccessResponseSchema`를 사용한다. 데이터베이스
schema drift 또는 일시적인 저장소 장애는 빈 500 대신 `projectApiErrorSchema`의
`code`, `message`, `details` 구조와 HTTP 503으로 응답한다.

지원하는 실패 코드는 다음과 같다.

- `PROJECT_ACCESS_UNAVAILABLE`
- `PROJECT_MEMBERS_UNAVAILABLE`
- `PROJECT_SCHEMA_NOT_READY`

API는 pending migration 또는 필수 `project_members.is_pinned` 컬럼 누락을 확인한 뒤
schema가 준비되지 않았으면 listen 전에 기동을 중단한다. `/health/readiness`도 동일한
검사를 사용한다.

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

## AI template deck generation historical contract

#339 PR 3부터 신규 `ai-template-deck-generation` Job 생성을 중단했고, PR 4에서 남은 API tombstone, request/result schema, queue/job constant, consumer, processor를 제거한다. 제거 대상 historical endpoint는 `POST /api/v1/projects/:projectId/jobs/ai-template-deck-generation`이며 controller와 module이 없으므로 `404`다.

`historicalJobTypeSchema`, `jobTypeSchema`, `jobSchema`는 `ai-template-deck-generation` 과거 row와 generic `result`를 계속 읽는다. `activeJobTypeSchema`와 `publicCreatableJobTypeSchema`는 이 type을 거부하고, `packages/job-queue`와 Worker에는 해당 runtime dispatch가 없다.

신규 AI PPT 생성은 `/createdeck`의 `generate-deck` `program-v2` 경로만 사용한다. `TemplateBlueprint`, `template_blueprints` 테이블, `purpose: "pptx-import"`, Python `/design/import-pptx`, PPTX OOXML generation/sync/export 경로는 활성 PPTX round-trip 계약이므로 이 레거시 제거 범위에 포함하지 않는다.

PR 4의 personal staging 자동 배포는 완료됐다. #339 종료 전 배포 환경의 `ai-template-deck-generation` queue와 관련 DB에 queued/running 잔여 Job이 0인지 읽기 전용으로 확인해야 한다.

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
- `rehearsal-transcript-json`
- `rehearsal-transcript-text`
- `export-result`
- `report-result`
- `thumbnail`
- `profile-avatar`
- `rehearsal-slide-snapshot`
- `design-asset`

`rehearsal-transcript-json`과 `rehearsal-transcript-text`는 리허설 처리 과정에서만
생성하는 Owner 전용 내부 자산이다. 공통 업로드, 일반 자산 목록 및 공개 content
API에서는 노출하지 않는다. `rehearsal_runs.transcript_json_file_id`와
`rehearsal_runs.transcript_text_file_id`가 각 `project_assets.file_id`를 참조한다.

리허설 STT 성공 시 Worker는 run의 `created_at`을 Asia/Seoul 날짜로 변환하고
`rehearsals/{date}/{projectId}/{runId}/transcript.json`과 `transcript.txt`를 저장한다.
JSON은 `text`, `liveTranscript`, `slideTranscriptSnapshots`, `language`, `duration`, `provider`,
`segments[{ text, start, end }]` 구조다. `text`는 서버의 리포트 STT 결과이며
`liveTranscript`는 브라우저가 리허설 중 누적한 실시간 인식 문장이다. 실시간 인식을
사용하지 않았거나 전달되지 않은 경우 `liveTranscript`는 `null`이다. speaker와
word-level segment는 보관하지 않는다. 두 `project_assets` row와
`rehearsal_runs` 참조 갱신은 하나의 DB transaction으로 처리하고, DB 반영 실패 시
이번 시도에서 새로 생성한 storage object만 보상 삭제한다.

리포트 지표 중 `liveTranscript`를 데이터 원본으로 사용하는 항목은 전체 `습관어`
횟수와 단어별 횟수뿐이다. 말하기 속도, 키워드 포함률, 침묵, 의미 평가 등 나머지
지표는 서버 STT와 오디오 분석 결과를 유지한다. `liveTranscript`가 비어 있으면
습관어도 기존 서버 분석 결과를 사용한다.

리허설 소유자는 `GET /api/v1/rehearsals/:runId/downloads/transcript`와
`GET /api/v1/rehearsals/:runId/downloads/audio`를 통해 각각 보존된
`transcript.txt`와 원본 `rehearsal.webm`을 attachment로 내려받을 수 있다. 두 API는
run의 project read 권한을 검사하며 일반 asset content API로 우회 노출하지 않는다.
원본 audio는 `raw_audio_delete_deadline_at` 이전이고 실제 삭제되지 않은 경우에만
제공한다.

리포트 조회 응답의 `transcriptDownloadAvailable`은 owner-only transcript asset metadata와
Object Storage의 실제 `transcript.txt` 존재 여부를 확인한 다운로드 가능 상태다.
리포트 원문 노출 정책을 나타내는 `report.transcriptRetained`와 구분해서 사용한다.

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
- browser engine env: `LIVE_STT_ENGINE=openai-realtime | web-speech`
- 기본 browser engine: `web-speech`
- OpenAI model env: `OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper`
- 실행 위치: web 또는 device-local runtime
- 목적: 애니메이션 cue, 강조 표시, 키워드 누락 체크, 다음 슬라이드 전환 제안/실행
- 입력: 마이크 스트림
- 출력: partial transcript, keyword detection, cue event, slide advance signal
- 원칙: raw audio를 서버 리포트용 storage에 업로드하지 않는다.
- OpenAI Realtime 경로는 raw OpenAI API key를 브라우저에 노출하지 않고, API가 project read 권한을 확인한 뒤 ephemeral client secret만 반환한다.
- API runtime config 경로는 `LIVE_STT_ENGINE`만 노출한다. web은 이 값을 presenter localStorage의 `sttEngine`보다 우선하며, `web-speech`가 미지원이면 OpenAI로 자동 fallback하지 않는다.
- 구현 위치: `packages/shared/src/rehearsals/live-stt.schema.ts`, `packages/shared/src/rehearsals/realtime-transcription.schema.ts`, `apps/api/src/realtime-transcription`, `apps/web/src/features/rehearsal`

Runtime config API:

- `GET /api/v1/runtime-config`
  - 인증: 없음. secret 값을 포함하지 않는 공개 런타임 설정만 반환한다.
  - response: `{ "liveSttEngine": "openai-realtime" }`

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
- 원칙: 업로드 완료 시점부터 raw audio object를 14일 보관한 뒤 삭제하고 삭제 시각을 기록한다. 분석 실패와 Job enqueue 실패는 기존처럼 즉시 삭제를 요청한다.

## 리포트용 리허설 Run 및 STT 계약

리포트용 리허설 녹음은 run 단위로 생성하고, 현재 구현된 upload-url 기반 `rehearsal-audio` 업로드가 완료된 뒤 `rehearsal-stt` Job을 시작한다. 이 계약은 실시간 발표 제어용 Live STT 계약이 아니다.

Run 상태:

- `created`
- `uploading`
- `processing`
- `succeeded`
- `failed`
- `cancelled`

Run 응답 구조:

```json
{
  "runId": "run_1",
  "projectId": "project_demo_1",
  "deckId": "deck_demo_1",
  "audioFileId": "file_audio_1",
  "jobId": "job_1",
  "deckVersion": 7,
  "evaluationSnapshot": {
    "deckId": "deck_demo_1",
    "deckVersion": 7,
    "capturedAt": "2026-07-10T08:00:00.000Z",
    "pronunciationLexicon": {
      "schemaVersion": 1,
      "generatorVersion": "deterministic-v1",
      "deckId": "deck_demo_1",
      "deckVersion": 7,
      "sourceHash": "0123456789abcdef",
      "entries": []
    },
    "slides": []
  },
  "semanticEvaluationMode": "full",
  "status": "processing",
  "error": null,
  "rawAudioDeleteDeadlineAt": "2026-07-11T01:00:00+09:00",
  "rawAudioDeletedAt": null,
  "createdAt": "2026-06-27T01:00:00+09:00",
  "updatedAt": "2026-06-27T01:00:00+09:00"
}
```

API:

- `POST /api/v1/projects/:projectId/rehearsals`
  - request: `{ "deckId": "deck_demo_1", "expectedDeckVersion": 7, "semanticEvaluationMode": "full", "slideSnapshots": [{ "slideId": "slide_1", "fileId": "file_1" }] }`
  - `expectedDeckVersion`은 optional이며 `full` run에서 현재 서버 deck version과 다르면 `REHEARSAL_DECK_VERSION_MISMATCH` 충돌로 거부한다.
  - `semanticEvaluationMode`는 `full | delivery-only`이고 기본값은 `full`이다.
  - `slideSnapshots`는 optional이며 `rehearsal-slide-snapshot` purpose로 업로드 완료된 현재 Deck 이미지의 `slideId/fileId` 매핑만 허용한다. API는 이 매핑을 run의 immutable `evaluationSnapshot.slides[].thumbnailUrl`로 고정한다.
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/cancel`
  - audio processing 시작 전 `created/uploading` run만 `cancelled`로 바꾼다.
  - response: `{ "run": RehearsalRun }`
- `POST /api/v1/rehearsals/:runId/audio/upload-url`
  - request: `{ "originalName": "rehearsal.webm", "mimeType": "audio/webm", "size": 1048576 }`
  - `size`는 service runtime schema에서 `REPORT_STT_PROVIDER`와 `REHEARSAL_AUDIO_MAX_BYTES` 기준으로 검증한다.
  - response: `{ "run": RehearsalRun, "upload": AssetUploadUrlResponse }`
- `POST /api/v1/rehearsals/:runId/audio/complete`
  - request: `{ "fileId": "file_audio_1", "recordingDurationSeconds": 90.25 }`
  - `recordingDurationSeconds`는 생략하거나 `null`일 수 있고, 값이 있으면 양수 finite number여야 한다.
  - run에 연결된 `fileId`만 허용하고, 업로드 완료 확인 뒤 `rehearsal-stt` Job을 enqueue한다. Web/API producer는 enqueue 전에 `recordingDurationSeconds`를 Run meta에 저장한다.
  - response: `{ "run": RehearsalRun, "job": Job }`
- `GET /api/v1/rehearsals/:runId`
  - response: `{ "run": RehearsalRun }`
- `GET /api/v1/rehearsals/:runId/report`
  - response: `{ "run": RehearsalRun, "report": RehearsalReport | null }`
  - run이 아직 `processing`이거나 과거 run에 `report_json`이 없으면 `report`는 `null`이다.
- `GET /api/v1/projects/:projectId/rehearsal-summary`
  - response: `{ "summary": RehearsalProjectSummary | null }`
  - 성공한 리허설이 없으면 `summary=null`을 반환한다.
  - `runMetricSeries`는 성공 회차별 총 소요시간, 긴 침묵, 핵심 키워드 전달률, 시간 초과 슬라이드 비율과 각 항목의 `measurementState`를 제공한다.
  - `slidePerformanceSummaries`는 최신 성공 회차의 immutable `evaluationSnapshot`을 기준으로 슬라이드 순서·제목·썸네일·권장 시간을 제공하고, 같은 slide ID의 측정 가능한 과거 결과만 평균·비율에 집계한다.
- `POST /api/v1/rehearsals/:runId/audio/clip`
  - request: `{ "startSeconds": 10, "endSeconds": 12.5 }`; 0초보다 길고 최대 60초인 구간만 허용한다.
  - 프로젝트 read 권한, `succeeded` run, 원본 보관기한과 녹음 길이를 확인한다.
  - 최초 요청은 Python worker가 원본을 mono 16kHz PCM WAV로 자르고, 원본과 같은 `rehearsals/{date}/{projectId}/{runId}/` 폴더에 `volume-{startMs}-{endMs}.wav`로 저장한다. 같은 구간의 후속 요청은 저장된 파일을 재사용한다.
  - response는 `audio/wav` binary이며 Web origin의 API proxy를 통해 전달한다. 파생 파일 삭제는 원본 `rawAudioDeleteDeadlineAt`에 맞춰 `storage_deletion_outbox`로 처리한다.
  - 만료·삭제된 원본은 HTTP 410 `REHEARSAL_AUDIO_EXPIRED`, 잘못된 구간은 HTTP 400/422로 응답한다.- `GET /api/v1/rehearsals/:runId/audio/playback-url`
  - 프로젝트 read 권한, `succeeded` run, `rehearsal-audio` purpose, uploaded·미삭제 상태를 확인한다.
  - response: `{ "playbackUrl": "short-lived-signed-url", "expiresAt": "2026-07-11T00:15:00.000Z", "retentionExpiresAt": "2026-07-25T00:00:00.000Z" }`
  - signed URL은 최대 15분이며 `rawAudioDeleteDeadlineAt` 이후까지 유효하게 발급하지 않는다.
  - 처리 중인 run은 HTTP 409 `REHEARSAL_AUDIO_NOT_READY`, 만료·삭제된 음성은 HTTP 410 `REHEARSAL_AUDIO_EXPIRED`로 응답한다.
  - signed URL, storage key, 파일명, 음성 데이터는 DB·리포트·로그에 저장하지 않는다.
- `GET /api/v1/projects/:projectId/rehearsals/:runId/coaching-report`
  - response: `CoachingReportView`
  - 프로젝트 read 권한과 run 소속을 확인한 뒤 여러 담당자의 저장 결과를 재계산하지 않고 조립한다.
  - 일부 결과만 준비됐으면 HTTP 200과 `viewState=partial`을 반환한다. P0 조립 결과가 없는 과거 run은 HTTP 404 `COACHING_REPORT_NOT_FOUND`를 반환하며 Web은 기존 report 응답으로 대체한다.
  - 기존 `GET /api/v1/rehearsals/:runId/report`의 경로와 응답 구조는 변경하지 않는다.
  - 현재 연습 목표는 이 응답에 중복하지 않고 `GET /api/v1/projects/:projectId/practice-plan?sourceFullRunId=:runId`에서 조회한다.
- `GET /api/v1/projects/:projectId/rehearsals/:runId/comparison`
  - 현재 run과 같은 프로젝트의 직전 `succeeded` run을 비교하며, 프로젝트 read 권한과 run 소속을 모두 검증한다.
  - response: `RehearsalRunComparison`
  - 현재 report가 준비되지 않았으면 `REHEARSAL_COMPARISON_NOT_READY`, 현재 report 계약이 유효하지 않으면 `REHEARSAL_COMPARISON_REPORT_INVALID` 충돌을 반환한다.
- `POST /api/v1/rehearsals/:runId/semantic-evaluation/retry`
  - response: `{ "job": Job }`
  - 성공한 `full` run에 retryable semantic report, immutable evaluation snapshot, Redis semantic evidence cache가 모두 있을 때만 `rehearsal-semantic-evaluation` Job을 enqueue한다.
  - cache가 만료됐으면 HTTP 409 `{ "code": "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED", "retryable": false }`를 반환한다.
  - Job payload에는 `jobId`, `projectId`, `runId`만 포함하고 transcript/segment 원문은 넣지 않는다.
- `PATCH /api/v1/rehearsals/:runId/meta`
  - request: `{ "recordingDurationSeconds": 90.25, "slideTimeline": [{ "slideId": "slide_1", "enteredAt": "2026-07-02T00:00:00.000Z" }], "missedKeywords": [{ "slideId": "slide_1", "keywordId": "kw_1" }], "adviceEvents": [{ "type": "pace-too-fast", "at": "2026-07-02T00:00:30.000Z" }] }`
  - 기존 Run meta는 `recordingDurationSeconds=null`로 읽는다. 값이 있으면 양수 finite number만 허용하며 `0`을 자료 없음 sentinel로 사용하지 않는다.
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
  - request: `{ "chunkCount": 3, "totalDurationMs": 90000, "totalSizeBytes": 1048576, "sha256": "<64 hex>", "recordingDurationSeconds": 90.25 }`
  - `recordingDurationSeconds`는 legacy upload complete와 같은 nullable 양수 finite number 계약을 사용한다.
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
  "volumeAnalysis": {
    "metricDefinitionVersion": 2,
    "measurementState": "measured",
    "reasonCode": null,
    "averageDbfs": -22.4,
    "baselineDbfs": -21.8,
    "variationDb": 8.3,
    "activeRatio": 0.76,
    "issueSegments": [
      {
        "kind": "quiet",
        "startSeconds": 8.1,
        "endSeconds": 10.2,
        "durationSeconds": 2.1,
        "meanDeviationDb": -7.4
      }
    ]
  },
  "silenceAnalysis": {
    "metricDefinitionVersion": 2,
    "measurementState": "measured",
    "reasonCode": null,
    "detector": "silero-vad",
    "detectorVersion": "6.2.1",
    "speechThreshold": 0.5,
    "minimumSilenceMs": 250,
    "longSilenceMs": 5000,
    "analysisWindowStartSeconds": 0.42,
    "analysisWindowEndSeconds": 89.31,
    "totalSilenceSeconds": 6.74,
    "silenceRatio": 0.0758,
    "longSilenceCount": 1,
    "detectedSegmentCount": 3,
    "segmentsTruncated": false,
    "segments": [
      {
        "category": "long",
        "startSeconds": 8.12,
        "endSeconds": 13.46,
        "durationSeconds": 5.34
      }
    ]
  },
  "metrics": {
    "durationSeconds": 90,
    "charactersPerMinute": 318,
    "wordsPerMinute": 120,
    "fillerWordCount": 2,
    "longSilenceCount": 1,
    "keywordCoverage": 0.75,
    "measurements": {
      "duration": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "charactersPerMinute": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "wordsPerMinute": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "fillerWordCount": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      },
      "longSilenceCount": {
        "measurementState": "measured",
        "metricDefinitionVersion": 2,
        "reasonCode": null
      },
      "keywordCoverage": {
        "measurementState": "measured",
        "metricDefinitionVersion": 1,
        "reasonCode": null
      }
    },
    "sttQualityGate": {
      "version": 1,
      "state": "passed",
      "reasonCode": "CONFIDENCE_ACCEPTED",
      "confidence": 0.91,
      "threshold": 0.8,
      "policyId": "stt_quality_v1"
    },
    "analysisCapabilities": {
      "recordingDuration": { "state": "available", "source": "recording" },
      "providerDuration": { "state": "available", "source": "provider" },
      "segmentTimestamps": { "state": "available", "source": "provider" },
      "sttConfidence": { "state": "available", "source": "provider" },
      "sentenceBoundaries": { "state": "available", "source": "provider" }
    },
    "keywordCoverageMeasurement": {
      "state": "measured"
    }
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
  "slideInsights": [
    {
      "slideId": "slide_1",
      "fillerWordCount": 2,
      "longSilenceCount": 1,
      "speakingRate": {
        "metricDefinitionVersion": 1,
        "measurementState": "measured",
        "reasonCode": null,
        "charactersPerSecond": 4.62,
        "baselineCharactersPerSecond": 4.24,
        "relativeRateRatio": 1.0896,
        "paceCategory": "similar",
        "activeSpeechSeconds": 12.4,
        "characterCount": 57
      }
    }
  ],
  "qnaSummary": {
    "questionCount": 0,
    "questionSummary": "",
    "unclearTopics": []
  },
  "semanticEvaluation": {
    "state": "unavailable",
    "measurementMode": "none",
    "reasons": ["evaluation_not_run"],
    "retryable": false
  },
  "semanticCueOutcomes": [],
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
- `recordingDurationSeconds`는 Web recorder가 측정한 실제 전체 경과시간의 canonical transport다. legacy upload와 chunk upload 모두 분석 enqueue 전에 같은 값을 Run meta에 저장한다.
- worker는 Run meta의 `recordingDurationSeconds`를 v2 분석 요청에 그대로 전달하며 provider duration으로 덮어쓰지 않는다. 이 runtime 연결은 P1 sender/parser PR에서 구현한다.
- worker는 시작 시 run을 `processing`으로 갱신하고, 성공 시 `succeeded`, 실패 시 `failed`로 갱신한다.
- 업로드 완료 시 `rawAudioDeleteDeadlineAt=완료 시각+14일`을 저장한다. 기존 성공 음성은 migration에서 `project_assets.uploaded_at+14일`로 backfill한다.
- 성공한 raw audio는 deadline까지 보관한다. 30초 deletion reconciler가 만료 대상을 `storage_deletion_outbox`에 멱등 등록하고 기존 삭제 처리를 수행한다.
- STT·지표·리포트 처리 실패와 Job enqueue 실패는 보관 기간을 적용하지 않고 즉시 raw audio 삭제를 요청한다.
- raw audio 삭제 성공은 `rawAudioDeletedAt`과 `project_assets.status=deleted`, `deleted_at`으로 남긴다.
- 삭제 실패는 `RAW_AUDIO_DELETE_FAILED` error로 run/job 양쪽에 남긴다.
- 공식 보고서 원본은 `jobs.result`가 아니라 `rehearsal_runs.report_json`이다.
- `full` run은 생성 시점의 materialized deck으로 owner-only `evaluationSnapshot`을 저장한다. snapshot에는 slide identity/order/title/estimatedSeconds, run-scoped `thumbnailUrl`, keyword 요약, `approved/excluded` Semantic Cue, 그리고 대본에서 추출한 `pronunciationLexicon`만 포함한다. `speakerNotes` 원문, elements, transcript, raw audio는 포함하지 않는다.
- `pronunciationLexicon`은 `schemaVersion=1`, generator/source version, 전체 Deck source hash, canonical entry와 원본 `speakerNotes` UTF-16 occurrence를 가진 immutable run 계약이다. deterministic generator는 원문을 한국어 발음으로 치환하지 않으며 source/alias는 canonical term evidence를 만들기 위한 비교용 값이다.
- live 처리는 전체 사전 중 현재·다음 장표의 active high-confidence entry만 사용한다. Report Worker는 같은 snapshot에서 최대 32개 source/대표 alias를 `pronunciationContext`로 만들며, 지원하는 STT provider에만 prompt 또는 phrase hint로 전달한다. 지원 여부가 확인되지 않은 provider에는 no-op으로 처리한다.
- transcript 원문은 저장·표시·evidence excerpt와 timestamp의 기준으로 유지한다. alias matcher는 별도의 canonical evidence만 생성하며, 동일 alias가 여러 canonical source와 충돌하면 자동 귀속하지 않는다.
- alias evidence는 term/keyword 언급 증거다. 문장 관계, 방향, 부정까지 전달했다는 의미 증거가 아니므로 full Semantic Cue 평가는 alias match가 있어도 semantic grader를 통과해야 한다. grader가 unavailable이면 alias만으로 `covered`를 확정하지 않는다.
- 에디터 썸네일은 현재 Deck JSON을 렌더링한 browser-memory Blob URL이며 Deck patch/version 또는 `project_assets`를 생성하지 않는다. 영속 이미지는 리허설 시작 준비 시에만 `rehearsal-slide-snapshot`으로 업로드하고 리포트는 현재 Deck의 `thumbnailUrl`보다 run snapshot URL을 우선한다.
- `freshness=stale`인 reviewed cue도 snapshot에 유지해 최종 결과를 `unmeasured(stale_cue)`로 설명할 수 있게 한다.
- snapshot은 생성 후 수정하지 않는다. `deckVersion`과 cue `revision`은 해당 run의 immutable 평가 기준이다.
- `delivery-only`와 legacy run은 `deckVersion=null`, `evaluationSnapshot=null`이며 Semantic Cue 최종 평가는 각각 `evaluation_snapshot_mismatch`, `evaluation_not_run`으로 구분한다.
- 기본 run 목록은 `cancelled`를 제외한다. processing이 시작된 run은 cancel할 수 없다.
- `transcript_retained` 기본값은 `false`이며, `false`일 때 `report.transcript`는 반드시 `null`이다.
- `GET /api/v1/rehearsals/:runId/report` 접근은 현재 프로젝트 접근 경계(`ProjectsService.getAccessibleProject`)를 재사용한다.
- ORBIT-37의 고급 0-100 점수 산식은 이 계약에 포함하지 않으며, 실제 산식이 확정되기 전까지 UI에서도 점수를 표시하지 않는다.
- `score`, `deliveryScore`, `speedScore`처럼 산식이 확정되지 않은 점수 필드는 `RehearsalReport`에 저장하지 않는다.
- `/audio/transcribe`는 원본 음성을 한 번만 읽고 PyAV 디코딩도 한 번만 수행한다. 같은 `AudioContent`는 STT에, 같은 mono float32 16kHz `DecodedAudio`는 음량 분석과 Silero VAD 침묵 분석에 전달한다. `/audio/transcribe-private`는 STT 전용 계약을 유지한다.
- `volumeAnalysis`는 현재 녹음 내부의 상대 음량 변화만 나타내며 절대적인 `적정·작음·큼` 판정으로 사용하지 않는다. 신규 `metricDefinitionVersion=2`는 2초 이상 구간만 사용하고, 같은 종류의 1초 이하 간격을 병합한 뒤 `durationSeconds * abs(meanDeviationDb)`가 큰 최대 5개를 시작 시간순으로 저장한다. `metricDefinitionVersion=1`은 과거 리포트 읽기 호환을 유지하며, 음량 분석 실패는 STT를 실패시키지 않고 `unmeasured`와 제한된 `reasonCode`로 기록한다.
- 리포트 음량 카드는 `quiet/loud` 문제 구간의 상대적인 개수·위치·시간만 표시하고 dBFS·RMS 수치를 노출하지 않는다. 사용자가 구간 재생을 요청하면 `POST /api/v1/rehearsals/:runId/audio/clip`이 동일 회차 폴더에 WAV 구간 파일을 생성·재사용하고, Web은 same-origin binary 응답을 Blob URL로 재생한다.
- `silenceAnalysis`는 Silero VAD가 찾은 발화 사이의 비발화 구간만 나타낸다. 앞뒤 무음은 제외하고 250ms 이상을 원천 구간으로 저장하며, 정확히 5초 이상을 `long`으로 분류한다. 의도한 멈춤, 말막힘, 긴장 여부는 추정하지 않는다.
- public report는 `metrics.longSilenceCount`, `silenceAnalysis`, `measurements.longSilenceCount`, `slideInsights[].longSilenceCount`를 사용한다. `pauseCount`, `pauseDetails`, `pauseV2Details`, `measurements.pauseV1`, `measurements.pauseV2`는 신규 계약에 저장하지 않는다.
- legacy report는 읽기 경계에서 과거 pause 필드를 제거하고 `silenceAnalysis=unmeasured/LEGACY_REPORT`, `metrics.longSilenceCount=null`, `measurements.longSilenceCount=unmeasured/LEGACY_MEASUREMENT_STATE_UNKNOWN`으로 정규화한다. 과거 pause 결과는 새 침묵 결과와 비교하거나 PracticeGoal 평가에 사용하지 않는다.
- measurement version은 긴 침묵이 2이고, duration·CPM·WPM·filler·keyword coverage는 1이다. `longSilenceCount`는 `silenceAnalysis.measurementState=measured`인 새 회차에서만 사용한다.
- `sttQualityGate.state=failed`이어도 VAD 침묵 분석은 독립적으로 성공할 수 있다. Gate 실패는 CPM·WPM·filler·keyword coverage와 해당 STT 상세만 차단하며 `silenceAnalysis`와 `longSilenceCount`를 차단하지 않는다.
- 말 속도 변화는 `speedSamples`, 습관어 상세는 `fillerWordDetails`, 비발화 상세는 `silenceAnalysis.segments`, 누락 필수 키워드 상세는 `missedKeywords`를 공식 필드로 사용한다. UI는 `long` 구간만 문제 구간으로 표시하고 `brief`는 원천 통계에만 사용한다.
- 필수 키워드 평가는 Deck의 `slide.keywords[].required=true` 항목만 대상으로 한다. 각 STT segment의 midpoint를 canonical slide timeline에 배정한 뒤 해당 슬라이드 발화에서 키워드 원문·유의어·약어를 NFKC/casefold 정규화해 부분 문자열로 비교한다. 다른 슬라이드에서의 언급은 충족으로 인정하지 않으며, slide timeline 또는 timestamped segment가 없으면 `keywordCoverageMeasurement=unmeasured/transcript-incomplete`로 표시한다.
- 장표별 상대 말하기 속도는 `slideInsights[].speakingRate`를 사용한다. NFKC 정규화 후 Unicode Letter·Number 수를 STT segment timestamp 합집합 시간으로 나누고, segment midpoint가 속한 canonical slide timeline에 배정한다. 같은 장표 재방문은 하나로 합산한다.
- 장표별 속도는 한국어(`ko`, `ko-*`)에서만 측정한다. 유효 발화 5초 이상·20자 이상인 장표가 3개 이상일 때 해당 장표들의 CPM 중앙값 대비 비율을 계산하며 `0.85` 미만은 `slower`, `0.85~1.15`는 `similar`, `1.15` 초과는 `faster`다. 리포트 UI는 장표 CPM과 이번 발표 기준 대비 차이를 표시한다.
- 장표별 속도 측정 불가 reason code는 `UNSUPPORTED_LANGUAGE`, `SEGMENT_TIMESTAMPS_UNAVAILABLE`, `INSUFFICIENT_SLIDE_SPEECH`, `BASELINE_UNAVAILABLE`, `LEGACY_REPORT`로 제한한다. 기존 리포트는 `unmeasured/LEGACY_REPORT`로 정규화하며 회차 비교·PracticeGoal·Top 3 평가에는 사용하지 않는다.
- 슬라이드별 목표/실제 시간은 `slideTimings`를 공식 필드로 사용한다. `targetSeconds`는 deck의 `estimatedSeconds` 또는 `targetDurationMinutes` 기반 목표값이고, `actualSeconds`는 `PATCH /api/v1/rehearsals/:runId/meta`의 `slideTimeline`에서 연속된 slide 진입 시각 차이로 계산한다. 종료 시각이 없는 마지막 slide는 실제 시간을 추정하지 않는다.
- 청중 QnA 기반 피드백은 질문 원문을 저장하지 않고 `qnaSummary.questionCount`, `qnaSummary.questionSummary`, `qnaSummary.unclearTopics[].topic`, optional `slideId`만 report에 저장한다. 현재 audience 질문 저장 API가 없으면 기본값은 질문 수 0과 빈 요약이다.

### 프로젝트 리허설 요약 집계 계약

`RehearsalProjectSummary`는 성공 회차의 공식 `rehearsal_runs.report_json`과 각 run의 immutable `evaluationSnapshot`에서 계산하는 owner-only 파생 응답이며 별도 DB 원본이나 종합 점수로 저장하지 않는다.

- 총 소요시간은 `metrics.measurements.duration.measurementState=measured`인 회차의 `metrics.durationSeconds`만 사용한다. 미측정·유효하지 않은 report는 `0`으로 대체하지 않고 `unmeasured`로 반환한다.
- 긴 침묵은 `silenceAnalysis.measurementState=measured`인 회차의 `longSilenceCount`와 `metricDefinitionVersion`을 사용한다. UI는 서로 다른 버전을 같은 추세로 직접 비교하지 않는다.
- 핵심 키워드 전달률은 각 run의 immutable `evaluationSnapshot.slides[].keywords`를 분모로 사용하고, 같은 `(slideId, keywordId)`가 `report.missedKeywords`에 없으면 전달된 것으로 계산한다. 원문·유의어·약어·발음 보정 별칭의 일치 여부는 report 생성 단계에서 판정하며, 이 지표는 키워드 언급 여부만 나타내고 설명의 의미 정확성은 평가하지 않는다.
- `metrics.measurements.keywordCoverage` 또는 `metrics.keywordCoverageMeasurement`가 미측정이거나 snapshot에 키워드가 없으면 `0%`가 아니라 `unmeasured`와 `KEYWORD_COVERAGE_UNMEASURED | NO_MEASURABLE_KEYWORDS` reason code를 반환한다. 최신 회차는 직전 측정 가능 회차와 개수가 아니라 전달률의 percentage point 차이로 비교한다.
- 슬라이드별 `keywordCoverage`는 같은 slide ID의 측정 가능 성공 회차에서 당시 snapshot 키워드를 누적한다. 직전 두 측정 가능 회차에 같은 `(slideId, keywordId)` 누락이 반복되면 `repeatedMissedKeywordCount`에 기록한다. 최신 snapshot에서 삭제된 슬라이드는 현재 요약에서 제외한다.
- 기존 `coreMessageCoverage`는 호환성을 위해 유지하는 deprecated 필드다. 이는 Semantic Cue의 의미 전달 평가 결과이며 핵심 키워드 전달률로 재해석하거나 UI 지표에 사용하지 않는다.
- 시간 초과 슬라이드는 `targetSeconds > 0`인 `slideTimings` 중 `actualSeconds > targetSeconds * 1.2`인 항목이다. 실제 시간이 없는 마지막 슬라이드와 측정 불가 항목은 분모에서 제외한다.
- 슬라이드별 평균 소요시간은 같은 slide ID의 측정 가능한 `actualSeconds` 산술평균이며 `sampleCount`를 함께 반환한다. 최신 snapshot에 없는 과거 슬라이드는 현재 표에서 제외한다.
- 최신 snapshot이 없는 legacy/delivery-only 회차는 슬라이드 메타데이터의 기준으로 사용하지 않는다. 측정 가능한 report가 없으면 해당 수치는 `N/A`로 표시한다.

### 리허설 회차 비교와 브리핑 계약

`RehearsalRunComparison`은 owner-only report 파생 응답이며 별도 DB 원본으로 저장하지 않는다.

`silenceComparison`은 현재·직전 회차의 `silenceAnalysis`가 모두 `measured`이고 `metricDefinitionVersion`이 같을 때만 `comparable`이다. 이때 `longSilenceCount`와 `totalSilenceSeconds`의 현재값, 이전값, delta를 함께 제공한다. 첫 회차, legacy, 측정 실패, 버전 불일치는 `unavailable`과 reason code로 반환하며 과거 pause 결과를 대신 사용하지 않는다.

```json
{
  "currentRunId": "run_2",
  "previousRunId": "run_1",
  "improved": [],
  "repeated": [],
  "newIssues": [],
  "incomparable": [],
  "briefing": []
}
```

각 배열 항목은 `{ category, slideId, cueId?, cueRevision?, label, severity, reason }` 구조다. `category`는 `semantic-cue | timing | delivery`, `severity`는 `high | medium | low`이며 `briefing`은 최대 3개다.

- Semantic Cue는 동일한 `cueId + cueRevision`일 때만 직접 비교한다. revision이 다르거나 어느 회차라도 `unmeasured | excluded`이면 `incomparable`로 분류하고 부정적 결과나 브리핑 우선순위에 포함하지 않는다.
- 직전 `missed | partial`이 현재 `covered`이면 `improved`, 두 회차 모두 `missed | partial`인 core Cue이면 `repeated`, 현재 이슈 중 반복 core가 아닌 항목은 `newIssues`다.
- 첫 성공 run은 `previousRunId=null`이며 현재 측정 이슈를 `newIssues`, 측정 불가 항목을 `incomparable`로 설명한다.
- 브리핑 우선순위는 반복 core 의미 누락, 현재 core 의미 누락, 반복 시간 초과, 반복 전달 이슈 순서이며 최대 3개만 제공한다.
- 응답에는 transcript, Semantic Cue evidence excerpt, speaker notes, raw audio, presenter script를 포함하지 않는다. 서버 로그와 audience channel에도 비교/브리핑 내용을 전송하지 않는다.
- 슬라이드 진입 알림은 `repeated`의 high-severity `semantic-cue`만 대상으로 하며 한 리허설 세션에서 항목별 한 번만 표시하고 사용자가 닫을 수 있다.

### Semantic Cue 측정·fallback 계약

live `semanticCueDecisions`는 provisional/debug 호환 필드이며 canonical report 결과는 `semanticCueOutcomes`다. legacy decision은 `matchedBy=nli`, `measurementMode=full`, `fallbackUsed=false`로 정규화하고 기존 required `provider`는 optional로 완화한다.

- capability: `stt | semantic_runtime | embedding | nli | server_evaluation | cue_freshness | transcript_evidence`
- capability state: `available | degraded | unavailable`
- measurement mode: `full | basic | none`
- decision match: `lexical | alias | embedding | nli`
- outcome match: decision match 값과 `post_run_semantic`
- outcome status: `covered | partial | missed | unmeasured | excluded`
- fallback reason: `user_disabled | permission_denied | stt_unavailable | network_error | provider_unavailable | model_not_ready | model_load_failed | timeout | runtime_error | server_evaluation_failed | stale_cue | transcript_incomplete | no_transcript | insufficient_evidence | slide_not_visited | evaluation_not_run | evaluation_snapshot_mismatch | queue_dropped | needs_confirmation`

`semanticCapabilityEvents`는 owner-only run meta에 최대 100개를 저장한다. event의 `cueIds`는 중복 제거 후 최대 50개이며 transcript, speaker notes, premise 원문을 넣지 않는다. `degraded/unavailable` event는 `reason`이 필수고 `available` 복구 event는 `fromState`와 `at`이 필수다.

`semanticCueOutcomes`는 cue마다 `cueRevision`, meaning/report label snapshot, importance, measurement 상태, fallback 상태, covered/missing concept를 저장한다. evidence는 정규화된 300자 이하 excerpt 하나와 `startMs/endMs`만 허용한다.

- `unmeasured`는 `measurementMode=none`과 `unmeasuredReason`이 필수다.
- `excluded`는 `measurementMode=none`이며 evidence를 가질 수 없다.
- `missed`는 정상 full 평가가 완료된 경우에만 허용한다.
- `fallbackUsed=true`이면 `fallbackReason`이 필수다.
- `basic` mode는 positive evidence가 있는 `covered/partial`만 허용하며 absence를 `missed`로 바꾸지 않는다.
- legacy report는 `semanticEvaluation=unavailable/none/evaluation_not_run`, `semanticCueOutcomes=[]`, `keywordCoverageMeasurement.state=measured`로 parse한다.
- 새 report의 keyword 분모가 0이면 숫자 `keywordCoverage=0`은 계산 placeholder로만 두고 `keywordCoverageMeasurement={ state: "unmeasured", reason: "no-keywords" }`를 저장한다. UI는 숫자 대신 `N/A`를 표시한다.
- timestamped transcript segment는 DB나 Job payload에 저장하지 않고 `rehearsal:semantic-evidence:<runId>` Redis key에 최대 30분만 보존한다. cache key와 server log에는 segment text를 넣지 않는다.
- semantic retry worker는 cache와 run snapshot으로 Python semantic endpoint만 다시 호출하며 `report_json.semanticEvaluation`과 `report_json.semanticCueOutcomes`만 멱등 교체한다. 기존 metrics, coaching, delivery 분석, generatedAt은 변경하지 않는다.
- retry가 다시 실패하거나 partial/unavailable이면 기존 report를 유지하고 Job을 실패 처리하며 `rehearsal.semantic_evaluation.retry_failed`에 ID와 reason만 기록한다.

구현 위치:

- `packages/shared/src/rehearsals/live-stt.schema.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.ts`
- `apps/api/src/rehearsals`
- `apps/worker/src/rehearsal-stt.processor.ts`

## Job 상태 구조

PPTX OOXML import/export, 참고자료 추출, AI 생성, 리허설 STT, 최종 보고서는 모두 동일한 Job 구조를 사용한다.

```json
{
  "jobId": "job_1",
  "projectId": "project_demo_1",
  "type": "pptx-ooxml-generation",
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

historical `type` 값:

- `pptx-import`
- `deck-export`
- `reference-extract`
- `ai-deck-generation`
- `ai-template-deck-generation`
- `semantic-cue-extraction`
- `pptx-ooxml-generation`
- `pptx-ooxml-sync`
- `worker-health-check`
- `rehearsal-stt`
- `rehearsal-semantic-evaluation`
- `final-report-generation`
- `report-pdf-export`
- `focused-practice-analysis`
- `challenge-qna-generation`
- `challenge-qna-answer-analysis`
- `private-audio-cleanup`

결정 사항:

- 오래 걸리는 작업은 전부 Job으로 처리한다.
- `historicalJobTypeSchema`, `jobTypeSchema`, `jobSchema`는 `pptx-import`, `ai-template-deck-generation` 과거 row를 계속 읽는다.
- `activeJobTypeSchema`와 `publicCreatableJobTypeSchema`는 두 historical-only type을 거부한다.
- `packages/job-queue`는 두 legacy queue/job constant와 enqueue helper를 export하지 않으며 Worker도 해당 queue를 구독하지 않는다.
- PR 4 제거 코드는 personal staging에 자동 배포됐고 #339 종료 시 배포 환경의 두 legacy queue와 관련 DB queued/running 잔여 상태가 0임을 읽기 전용으로 확인했다. 로컬 증거로 대신하지 않는다.
- 프론트는 `jobId`로 진행률을 조회한다.
- Job 조회 API는 `GET /jobs/:jobId`를 기본 경로로 사용하고, 기존/캐시된 web client 호환을 위해 `GET /api/v1/jobs/:jobId`도 같은 응답을 반환한다.
- 성공 결과는 `result`, 실패 이유는 `error`에 넣는다.
- `error`는 `{ code, message, failedStage?, retryable? } | null`이다. 기존 row는 두 optional field가 없어도 유효하다.
- `failedStage`는 AI Deck 부모 Job의 실패 stage 요약이며 shard 식별자는 `ai_deck_generation_stages` checkpoint key에만 저장한다.
- `retryable`은 부모 Job 실패 후 `POST /api/v1/projects/:projectId/jobs/:jobId/retry`를 허용할지 나타낸다. 자동 stage 재시도는 checkpoint의 `attempt < 5`로 별도 관리한다. 명시적 retry는 `failedStage`의 실패 checkpoint만 `queued`, `attempt=0`으로 초기화하고 성공한 upstream 및 같은 OCR/image stage의 성공 shard를 보존하며 downstream checkpoint와 artifact를 무효화한다. coordinator 자체 실패처럼 `reference-extract-file` checkpoint가 없을 때만 기존 failed BullMQ coordinator entry를 제거하고 ID-only coordinator를 다시 enqueue한다.
- `error`에는 provider raw response, token, cookie, 사용자 원문 등 민감하거나 과도한 데이터를 저장하지 않는다.

구현 위치:

- `packages/shared/src/jobs/job.schema.ts`

### AI Deck 내부 stage와 checkpoint

- staged BullMQ coordinator message는 strict `{ jobId, projectId }`만 담고 전체 request는 DB의 부모 `jobs.payload`에서 읽는다. `generate-deck` queue는 `job.name`의 `generate-deck`과 `generate-deck-staged-coordinator`, `reference-extract` queue는 `reference-extract`와 `reference-extract-file`을 구분해 기존 monolith/standalone OCR과 staged handler를 함께 안전하게 routing한다. 나머지 stage queue도 stage 이름과 `job.name`이 일치할 때만 실행한다.
- `AI_DECK_WORKER_QUEUE=all|reference-extract|research-content|design-layout|image|qa-finalize`를 실행할 수 있다. `research-content`는 `ai-deck-research-content`, `design-layout`은 `ai-deck-design-layout`, `image`는 `ai-deck-image`, `qa-finalize`는 `ai-deck-qa-finalize`만 소비한다. 지원되는 실행 모드는 `monolith|bullmq|pg`다. dedicated role은 `bullmq`에서만 허용하고 `pg`는 `all`만 허용한다. `AI_DECK_EXECUTION_MODE=sqs`는 도입 취소된 미지원 값이므로 Worker 시작 시 거부한다.
- 부모 `jobs.payload`는 strict `generateDeckStoredJobPayloadSchema`를 사용한다. 새 인증 요청은 `requestedByUserId`를 저장하고 Style 확정 후 strict `designSelection`과 deterministic `coverPlan`을 추가한다. 기존 payload에 `requestedByUserId`가 없으면 PostgreSQL claim에서 `projects.created_by`를 사용한다. raw source, OCR, provider 응답과 내부 prompt는 이 payload에 추가하지 않는다.
- stage enum은 `reference-extract-file`, `source-grounding`, `content-planning`, `cover-slide`, `design-planning`, `layout-compile`, `image-slide`, `semantic-quality`, `rendered-visual-quality`, `publication`의 정확한 10개다.
- queue envelope은 strict `{ pipelineJobId, projectId, stage, shardKey }`만 허용한다. binary, base64, 전체 Deck, provider raw response, 별도 checkpoint/asset ID는 금지한다.
- `reference-extract-file`과 `image-slide`은 colon 없는 non-empty `shardKey`를 사용하고 나머지 singleton stage는 정확히 `""`를 사용한다. stage 전용 `pipelineJobId`에도 colon을 허용하지 않으며 일반 historical `Job.jobId` 계약은 좁히지 않는다.
- BullMQ `opts.jobId`는 `${pipelineJobId}:${stage}:${shardKey}`로 만들어 정확히 세 segment를 유지한다. stage message에는 별도 `jobId` field를 넣지 않으며 duplicate delivery와 crash 복구는 DB checkpoint 전이로 수렴시킨다.
- repository는 parent row의 `jobs.job_id`, `jobs.project_id`, `jobs.type="ai-deck-generation"`을 envelope과 대조한다.
- `ai_deck_generation_stages`는 `(pipeline_job_id, stage, shard_key)` UNIQUE checkpoint다. `pipeline_job_id`는 `jobs(job_id) ON DELETE CASCADE`, `shard_key`는 `NOT NULL DEFAULT ''`, `status`는 `queued | running | succeeded | failed`, `attempt`는 `0..5`다.
- `source-grounding`과 `cover-slide`의 `input_ref_json`은 `{}`다. `content-planning`, `design-planning`, `layout-compile`, `image-slide`, `semantic-quality`의 input은 strict `{ planningArtifactId: UUID }`, `rendered-visual-quality`, `publication`의 input은 strict `{ executionArtifactId: UUID }`만 허용한다. 각 consumer는 같은 tenant·pipeline과 기대 upstream stage·shard의 artifact인지 다시 검증한다. `result_ref_json`은 기본적으로 `null | {}`이고 `reference-extract-file`은 strict `{ referenceExtractionArtifactId: UUID }`, 네 planning stage는 strict `{ planningArtifactId: UUID }`, cover를 포함한 다섯 execution stage는 strict `{ executionArtifactId: UUID }`만 허용한다. 전체 Deck·content·binary/base64·provider raw response는 checkpoint에 저장하지 않는다.
- `ai_deck_reference_extraction_artifacts`는 `(pipeline_job_id, file_id)` UNIQUE이며 `artifact_id` UUID를 primary key로 사용한다. `(pipeline_job_id, project_id)`는 부모 `jobs(job_id, project_id)`, `(project_id, file_id)`는 `project_assets(project_id, file_id)`, `(pipeline_job_id, stage, file_id)`는 해당 `ai_deck_generation_stages(pipeline_job_id, stage, shard_key)`를 각각 `ON DELETE CASCADE`로 참조한다. 같은 pipeline/file을 upsert할 때 기존 `artifact_id`를 바꾸지 않아 locator UUID가 안정적으로 유지된다.
- `ai_deck_planning_artifacts`는 `(pipeline_job_id, stage)` UNIQUE이며 `source-grounding`, `content-planning`, `design-planning`, `layout-compile`의 검증된 JSON object만 저장한다. `(pipeline_job_id, project_id)`는 부모 Job, `(pipeline_job_id, stage, shard_key='')`는 해당 singleton checkpoint를 `ON DELETE CASCADE`로 참조한다. 같은 pipeline/stage를 upsert해도 기존 `artifact_id`를 유지한다.
- `ai_deck_execution_artifacts`는 `(pipeline_job_id, stage, shard_key)` UNIQUE이며 `cover-slide`, `image-slide`, `semantic-quality`, `rendered-visual-quality`, `publication`의 shared schema 검증 결과만 저장한다. `(pipeline_job_id, project_id)`는 부모 Job, `(pipeline_job_id, stage, shard_key)`는 해당 checkpoint를 `ON DELETE CASCADE`로 참조한다. cover artifact는 선택 디자인의 1장 Deck, legacy image artifact는 한 slide와 warning을 저장한다. v2 completed slide artifact는 strict `{ artifactVersion:2, sourceOrder, order, slideId, slide, warnings, validation }`이며 identity가 manifest와 일치해야 한다. quality artifact는 검증된 worker payload만, publication artifact는 최종 Job result만 저장하며 locator UUID는 같은 stage/shard upsert에서 유지한다.
- 검증된 OCR 응답은 `usable=false`여도 artifact로 보존할 수 있다. transient/unusable 결과는 먼저 해당 shard만 재시도하고, 총 5번째 시도에도 unusable이면 `usable=false` artifact와 locator를 저장해 checkpoint를 `succeeded`로 끝낸 뒤 policy join이 부모의 계속/실패를 결정한다. provider raw response와 credential은 artifact나 Job error에 저장하지 않는다.
- claim은 `queued -> running` 조건부 update에 성공한 consumer만 허용하며 이때만 `attempt`를 증가시킨다. stable worker ID에 UUID를 붙인 opaque `lease_owner` token을 claim마다 새로 발급하고 `attempt`를 generation fencing token으로 함께 사용한다. claim이 반환한 `lease_owner`와 `attempt`가 모두 일치하고 lease가 만료되지 않은 heartbeat·성공·실패·retry release만 허용한다.
- `pg`는 `AI_DECK_WORKER_CONCURRENCY=5`의 process-wide slot을 모든 stage handler가 공유한다. 후보 사용자는 현재 running 수, 가장 오래 기다린 checkpoint, 사용자 ID 순으로 고른다. 사용자별 advisory transaction lock과 해당 `users` row의 `FOR UPDATE` lock을 획득한 뒤 running 수를 다시 확인하고, `AI_DECK_USER_CONCURRENCY=5` 이상이면 건너뛴다. 실제 checkpoint row는 `FOR UPDATE OF stages SKIP LOCKED LIMIT 1`로 claim한다. Worker replica가 늘어나도 사용자별 상한은 같은 transaction과 durable user row lock으로 유지된다.
- `pg`에서 checkpoint가 없는 active 부모 Job은 Worker maintenance가 기존 staged coordinator 함수를 직접 호출해 멱등 초기화한다. `bullmq` rollback 경로도 같은 durable stage chain을 유지한다.
- BullMQ dispatcher는 10개 stage checkpoint를 모두 enqueue한다. enqueue 후 BullMQ `getState()`가 `waiting | delayed | prioritized`일 때만 조회 당시 `attempt`를 대조해 `dispatched_at`을 기록한다. `active | completed | failed | unknown`은 durable dispatch로 인정해 mark하지 않으며, 늦은 이전 send가 새 retry generation을 덮지 못한다. `pg`에서는 dispatcher를 실행하지 않는다.
- BullMQ dispatcher는 매 회차 `listUndispatched` 전에 active parent의 10개 stage 중 `status='queued'`이고 `dispatched_at`이 15분 이상 지난 row를 최대 100개씩 `FOR UPDATE ... SKIP LOCKED`로 복구한다. 이 scan은 `idx_ai_deck_generation_stages_stale_dispatch (dispatched_at, pipeline_job_id, shard_key)` partial index를 사용한다.
- retryable failure는 현재 stage/shard만 지수 backoff로 최대 총 5회 시도한다. DB lease는 10분, heartbeat는 60초다. retry release와 expired lease의 1~4번째 복구는 `status='queued'`, `lease_owner=NULL`, `lease_expires_at=NULL`, `dispatched_at=NULL`로 전이하고 기존 `attempt`는 유지한다. OCR의 5번째 종료는 policy join이 부모의 계속/실패를 결정하고, 나머지 필수 stage의 5번째 실패·expired lease는 checkpoint와 부모를 함께 terminal 처리한다. 부모가 terminal이면 transaction commit 후 반환된 parent Job으로 표준 `job.failed` 업무 로그를 남긴다. 이 DB checkpoint `attempt`는 BullMQ transport의 `attemptsMade`와 별도 재시도 층이다. expired-lease reconciler는 `bullmq`와 `pg` 모두 Worker 시작 직후 한 번 실행한 뒤 주기적으로 실행하고 dispatcher는 `bullmq`에서만 실행한다.
- coordinator는 reference policy를 root `referencePolicy`, `design.referencePolicy`, `brief.referencePolicy` 순으로 선택한다. OCR selector 입력인 `references`와 `referenceFileIds`는 각각 최대 10개이며, non-empty `references`의 `{ fileId }[]`를 우선하고 비어 있을 때만 `referenceFileIds`를 fallback으로 사용한다. 첫 등장 순서로 중복 제거한 전체 선택 집합이 `selectedReferenceFileIds`이고, 여기서 `referenceContext.fileId`로 이미 covered된 file을 제외한 집합이 `uncoveredReferenceFileIds`다. `reference-extract-file` checkpoint와 OCR fan-out은 `uncoveredReferenceFileIds`에만 생성한다. Web의 인증된 `POST /api/v1/projects/:projectId/references/extractions` standalone OCR과 `referenceContext` 전달 경로는 계속 유지한다.
- `/documents/parse`는 정제된 전체 텍스트를 1,200~1,500자 chunk로 `reference_chunks`에 인덱싱한다. staged `source-grounding`은 주제, prompt, audience, reference keyword를 한 번 embedding하고 같은 project의 선택 file별 상위 3개를 조회한다. 파일당 최대 3개, 전체 최대 12개를 사용하며 동일 content와 인접 chunk의 150자 overlap은 제거하되 실제 `sourceId`와 `chunkId`는 유지한다.
- `references-only`는 모든 선택 file에서 chunk 1개 이상을 요구하고 검색 불가 또는 누락 시 `SOURCE_GROUNDING_REQUIRED`로 종료한다. `references-first`는 유효한 file별 최상위 chunk를 우선하고 남은 자리를 관련도순으로 채우며 누락 file은 direct OCR context로 degrade한다. `research-first`는 검증된 web source 최대 8개와 관련 첨부 chunk 최대 4개를 사용한다. `user-input-only`는 첨부 chunk를 검색하거나 Story evidence에 넣지 않으며, legacy `topic-only + referenceContext` direct 입력 호환은 유지한다.
- Story prompt는 topic/user input record와 별도로 evidence 최대 12개를 사용한다. indexed chunk는 최대 1,500자 전문이 포함되며 1,600자 source block 제한은 direct OCR fallback의 안전 상한이다. 검색 저하는 strict policy가 아닌 경우 `REFERENCE_CHUNK_RETRIEVAL_DEGRADED` warning code와 함께 계속한다.
- 별도 join stage는 만들지 않는다. 마지막 `reference-extract-file` child가 끝난 트랜잭션에서 예상 shard 전체와 artifact `usable`을 확인하고 `source-grounding` checkpoint를 멱등 생성한다. `references-only`는 `selectedReferenceFileIds`가 하나 이상이어야 하고 선택한 모든 file이 검증된 `referenceContext`로 covered됐거나 새 OCR artifact에서 `usable=true`여야 한다. 선택되지 않은 `referenceContext`만으로 이 조건을 대신할 수 없다. `references-first`는 기존 context와 새 artifact를 합쳐 usable source가 하나 이상이면 계속하고, `research-first`는 uploaded grounding이 없어도 계속한다. strict 조건을 만족하지 못하면 부모를 `SOURCE_GROUNDING_REQUIRED`, `retryable=false`로 terminal 처리한다.
- `PYTHON_WORKER_EXTRACT_INVALID_RESPONSE`처럼 schema가 유효하지 않은 non-retryable provider 응답은 artifact를 만들지 않고 해당 `reference-extract-file` checkpoint만 `failed`로 끝낸다. 이 오류는 `fatalParent=false`로 같은 policy join에 합류하며 artifact가 없는 shard는 `usable=false`로 판정한다. provider invalid 자체가 부모를 즉시 실패시키지 않고 reference policy가 계속 또는 terminal을 결정한다. 반면 project·asset identity 위반은 active sibling checkpoint와 부모를 함께 terminal 처리한다.
- BullMQ 최종 transport attempt가 실패하면 DB recovery를 원 오류 재throw 전에 await한다. 10개 stage는 DB `attempt`나 checkpoint terminal 상태를 변경하지 않고 active parent의 queued checkpoint에서 `dispatched_at=NULL`만 복구해 결정적 `opts.jobId`로 다시 enqueue할 수 있게 한다. `generate-deck-staged-coordinator`는 active parent의 queued/running checkpoint와 부모 Job을 한 transaction에서 `AI_DECK_COORDINATOR_FAILED`, `failedStage="reference-extract-file"`, `retryable=true`로 종료하고 반환된 terminal parent Job으로 commit 후 표준 `job.failed` 업무 로그를 남긴다.
- `generate-deck-staged-coordinator` BullMQ Job은 재시도 소진뿐 아니라 stall/started limit 초과로도 failed set에 들어갈 수 있다. failed entry는 `removeOnFail=false`로 cap 없이 보존한다. BullMQ의 정확한 transport-boundary `failedReason`인 `job stalled more than allowable limit` 또는 `job started more than allowable limit`이면 `attemptsMade`와 무관하게 coordinator transaction을 멱등 재실행한다. 그 외에는 `attemptsMade >= opts.attempts`일 때 active checkpoint와 부모를 terminal 복구하고, 그보다 작으면 역시 멱등 재실행해 commit 전 crash와 commit 후 ACK 유실을 모두 수렴시킨다. resume가 failed parent를 반환하거나 지연된 terminal DB recovery가 성공하면 DB commit 이후에만 failed entry 제거를 시도하고, reconciliation 결과를 받은 Worker가 같은 표준 `job.failed` 업무 로그를 남긴다. maintenance reconciler는 live rank offset 대신 Redis failed ZSET의 opaque `ZSCAN` cursor와 초과 batch의 `pendingJobIds`를 Worker에 보존하고 한 회차에 기본 25개, 최대 100개만 처리한다. concurrent cleanup으로 사라진 entry와 중복 scan은 멱등 처리하며, DB recovery가 실패한 entry는 제거하지 않아 다음 full cursor cycle에서 다시 방문한다.
- legacy `layout-compile` artifact는 검증된 worker payload와 visual requirements를 유지한다. v2 `layout-compile`은 전체 Deck을 미리 만들지 않고 strict `{ artifactVersion:2, deckShell, slides, warnings }` manifest를 저장한다. v2 manifest의 모든 slide는 `001-slide_1` 형식의 zero-padded `shardKey`로 기존 `image-slide` checkpoint에 fan-out한다. 각 shard가 content-planning 고정 필드 검증, slide 상세 생성, layout compile, asset resolution과 bounded QA를 끝낸 뒤에만 completed slide artifact를 저장한다.
- v2 fan-out은 한 shard의 최종 실패만으로 sibling을 중단하지 않는다. 모든 shard가 terminal이 될 때까지 join을 지연하고, 모두 성공하면 `semantic-quality`을 정확히 한 번 만들며 실패가 하나라도 있으면 성공 artifact를 보존한 채 부모 Job을 실패시킨다. 명시적 retry는 기존 성공 shard를 재사용하고 실패 shard만 다시 실행한다. `semantic-quality`은 manifest 전체 identity를 검증해 `sourceOrder` 순서로 Deck을 조립한다. 이후 global semantic/rendered quality는 공개된 slide를 변경하는 repair 없이 검증만 수행한다.
- `semantic-quality` → `rendered-visual-quality` → `publication`은 각각 독립 checkpoint이며 publication transaction이 execution artifact, checkpoint 성공, Deck upsert와 부모 Job `succeeded/progress=100`을 함께 commit한다. terminal failure에서는 Deck을 쓰지 않는다. `WEB_RESEARCH_QUALITY_FAILED`는 usable grounding 또는 사용자 입력이 있으면 warning으로 계속하고, usable grounding이 전혀 없는 strict policy의 `SOURCE_GROUNDING_REQUIRED`와 내부 재시도 후에도 유효하지 않은 Art Director 응답의 `ART_DIRECTOR_INVALID_RESPONSE`는 terminal이다.

### AI Deck 비동기 입력과 Design Selection gate

- Story Review UI/API/shared schema와 `ai_deck_story_reviews` 테이블은 제거한다. `POST /api/v1/projects/:projectId/jobs/generate-deck` 응답은 strict `{ job }`이며 content planning은 입력 화면의 **다음 단계** 클릭 직후 백그라운드에서 시작한다.
- 첨부파일을 선택하면 임시 project를 한 번만 만들고 파일을 병렬 업로드한다. Web은 파일 순서를 유지하며 `uploading | uploaded | failed`를 표시한다. 업로드 중이거나 실패 파일이 남아 있으면 다음 단계 진행을 막고, 실패 파일은 재시도 또는 제거할 수 있다.
- Style 상태는 `GET /api/v1/projects/:projectId/jobs/:jobId/design-selection`, 확정은 같은 경로의 strict `PUT`을 사용한다. selection은 `paletteOptionId`, 전체 `paletteOverride`, strict `fontOverride`, 선택 `designPrompt`만 받는다.
- `content-planning` 완료와 Style 확정은 순서와 관계없이 같은 Job row lock과 checkpoint UNIQUE 계약으로 합류하고 `design-planning`을 정확히 한 번 enqueue한다. 신규 Job은 `coverPlan`을 만들거나 `cover-slide` checkpoint를 enqueue하지 않는다.
- 신규 v2 `layout-compile` manifest는 1번을 포함한 모든 descriptor를 `image-slide`로 fan-out한다. 표지도 다른 slide와 같은 compose, asset resolution, Content/Fact/Semantic/Vision QA 경로를 통과한다.
- shared enum의 `cover-slide`, stored payload의 optional `coverPlan`, cover artifact/processor와 preview fallback은 이미 시작했거나 저장된 과거 Job의 재개를 위해 유지한다. 신규 생성 경로에서는 사용하지 않으며 이를 위한 DB migration이나 대규모 정리는 하지 않는다.

### AI Deck 시연 캐시

- 공개 `GenerateDeckRequest`, 응답, Job type/status에는 시연 전용 필드를 추가하지 않는다. 내부 설정 `DEMO_AI_DECK_CACHE_ENABLED`, `DEMO_AI_DECK_SOURCE_PROJECT_ID`, `DEMO_AI_DECK_TRIGGER_TOPIC`을 사용하고 기존 `ai-deck-generation` queued Job을 만든다.
- cache hit은 기능 활성화, production이 아닌 allowlisted `APP_ENV`, `DEMO_USER_ID` 요청자, 공백 정규화 후 정확히 일치하는 topic, 읽기 가능한 source project, `deckSchema`를 통과한 source Deck을 모두 요구한다. source가 없거나 유효하지 않으면 `DEMO_DECK_CACHE_UNAVAILABLE`로 실패하고 일반 AI 생성으로 fallback하지 않는다.
- hit Job은 Worker에 enqueue하지 않는다. Style 확정 transaction에서 source Deck을 다시 읽고 검증한 다음 target `projectId`, `deckId=deck_${jobId}`, `version=1`만 바꾸어 upsert한다. slide ID, elements, notes, design, animations와 asset URL은 보존하고 selection payload, 유효한 generation result, Job `succeeded/progress=100/error=null`을 같은 transaction에서 저장한다.
- cache 사용 로그 `ai_ppt.demo_cache.used`에는 `jobId`, target/source project ID, `deckId`, slide count만 남긴다. prompt, notes, transcript, asset 내용과 secret은 기록하지 않는다.

### AI Deck Progressive Preview

- 신규 Job은 `layout-compile` 이후 1번부터 연속으로 완료된 slide만 반환한다. 과거 Job에 `cover-slide` artifact가 있으면 기존 `layout-compile` 전 1번 slide fallback을 유지한다. 화면은 항상 “검증 중 변경될 수 있음”을 안내하고, 최종 rendered Vision QA와 publication 완료 뒤에만 editor로 전환한다.
- `GET /api/v1/projects/:projectId/jobs/:jobId/deck-preview`는 project read 권한과 `type='ai-deck-generation'` Job identity를 확인하고 strict `AiDeckPreviewResponse`를 반환한다. 응답은 `{ jobId, projectId, status, progress, expectedSlideCountRange, editable:false, outline, deck, completedSlideIds, pendingSlideIds, updatedAt, error }`만 포함하며 raw source, OCR, prompt, provider response, 내부 layout/visual requirement는 노출하지 않는다. status는 checkpoint를 기준으로 `planning`, `grounding`, `composing`, `rendering`, `quality-check`, `ready`, `failed`, `cancelled` 중 하나를 반환한다.
- content plan 전에는 `expectedSlideCountRange`로 5~8장 예정 skeleton을 표시한다. 과거 Job에 성공한 cover가 있으면 1번 슬롯에 표시하고, 실제 outline이 준비되면 임시 슬롯을 제목·핵심 메시지가 있는 실제 목차로 교체한다. `references-first` 웹 보강은 alias 계획, 검색, 출처 검증을 합쳐 최대 20초만 사용하고 SDK 재시도 없이 시간 초과 시 검증되지 않은 웹 citation을 버린 뒤 업로드 자료만으로 계속한다.
- `layout-compile` 전에는 승인된 `content-planning` artifact에서 `order`, `title`, `message`만 projection해 `outline`과 `deck=null`을 반환한다. legacy layout 이후에는 기존 full Deck과 image artifact 병합 규칙을 유지한다. v2에서는 성공한 completed slide artifact를 manifest `sourceOrder`로 검사해 1번부터 끊김 없는 prefix만 partial Deck으로 반환한다. out-of-order 완료 slide는 내부에는 보존하지만 앞 slide가 준비되기 전에는 `completedSlideIds`나 `deck`에 노출하지 않으며 나머지는 모두 `pendingSlideIds`다. 성공한 `semantic-quality` 또는 `rendered-visual-quality` artifact가 있으면 가장 최근 검증 Deck을 우선한다.
- 부모 Job이 `succeeded`이면 `decks.deck_json`의 canonical Deck을 `ready`로 반환한다. failed/cancelled는 마지막으로 검증 가능한 preview를 유지하되 일반화한 오류 문구와 retryable 여부만 제공한다. preview 조회는 canonical Deck이나 artifact를 수정하지 않는다.
- Web은 약 1.2초 polling을 사용하고 backend 완료 순서와 무관하게 `completedSlideIds`의 1번부터 연속된 prefix만 공개한다. 새 slide는 750ms 간격으로 fade-in하며 `prefers-reduced-motion`에서는 즉시 공개한다. backend가 먼저 `ready`여도 공개가 끝날 때까지 화면 status는 `rendering`, progress는 공개 비율 기준 12~96으로 표시한다. 사용자가 이전 slide를 선택하기 전까지만 최신 공개 slide를 자동 선택하고, 마지막 slide를 600ms 유지한 뒤 `["deck", projectId]` query를 invalidate하고 일반 editor route로 replace 이동한다.

구현 위치:

- `packages/shared/src/jobs/ai-deck-generation-stage.schema.ts`
- `packages/config/src/index.ts`
- `packages/job-queue/src/index.ts`
- `apps/api/src/generate-deck/generate-deck.service.ts`
- `apps/api/src/generate-deck/design-selection.controller.ts`
- `apps/api/src/generate-deck/design-selection.service.ts`
- `apps/api/src/database/migrations/2026071706000-ReplaceStoryReviewWithCoverPreview.ts`
- `apps/api/src/database/migrations/2026071502000-CreateAiDeckGenerationStages.ts`
- `apps/api/src/database/migrations/2026071503000-CreateAiDeckReferenceExtractionArtifacts.ts`
- `apps/api/src/database/migrations/2026071601000-CreateAiDeckPlanningArtifacts.ts`
- `apps/api/src/database/migrations/2026071601100-ExpandAiDeckStageDispatchRecovery.ts`
- `apps/api/src/database/migrations/2026071602000-CreateAiDeckExecutionArtifacts.ts`
- `apps/worker/src/worker.service.ts`
- `apps/worker/src/generate-deck/postgres-stage-runner.ts`
- `apps/worker/src/generate-deck/stage-checkpoint-repository.ts`
- `apps/worker/src/generate-deck/planning-stage.processor.ts`
- `apps/web/src/features/ai-ppt/AiPptMockupPage.tsx`
- `packages/shared/src/deck/generate-deck.schema.ts`
- `apps/worker/src/generate-deck/execution-stage.processor.ts`
- `apps/worker/src/generate-deck/execution-artifact-repository.ts`
- `apps/worker/src/reference-extract-python-client.ts`
- `apps/worker/src/reference-extract.processor.ts`
- `services/python-worker/app/ai/deck_generation/stage_runtime.py`
- `apps/worker/src/generate-deck/staged-coordinator.ts`
- `apps/worker/src/generate-deck/stage-checkpoint-repository.ts`
- `apps/worker/src/generate-deck/stage-dispatcher.ts`
- `apps/worker/src/generate-deck/stage-reconciler.ts`
- `apps/worker/src/generate-deck/coordinator-failure-reconciler.ts`
- `apps/worker/src/generate-deck/transport-failure-recovery.ts`
- `apps/worker/src/generate-deck/reference-extract-stage.ts`
- `apps/worker/src/generate-deck/reference-extraction-artifact-repository.ts`
- `apps/worker/src/generate-deck/reference-extraction-join.ts`

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

## Adaptive Rehearsal Coach Milestone 1 계약

상세 제품·DB·API·Job·Web 수용 기준은
[`docs/product/adaptive-rehearsal-coach-direction.md`](product/adaptive-rehearsal-coach-direction.md)의
19~31장을 따른다. 런타임 계약의 원본은 `packages/shared/src/coaching`이다.

### Aggregate와 snapshot 경계

- `RehearsalRun`, `FocusedPracticeSession`, `ChallengeQnaSession`은 서로 다른 aggregate다.
- 부분 연습 결과는 full-run comparison, trend, North Star 또는 `PracticeGoalResolution`을 만들지 않는다.
- `PracticeGoalSet`과 Question revision은 immutable이며 retry는 새 revision을 발행한다.
- `FocusedPracticeSession.snapshot.goalSetRef`는 세션 생성 당시 `PracticeGoalSet`의 `goalSetId`와 revision을 고정하며, 최상위 `sourceGoalSetId`와 같은 ID여야 한다.
- full run은 `deckContentHash`, Brief/Lens, criterion revision, metric definition version, approved reference hash를 evaluation snapshot에 고정한다.
- resolution과 comparison은 deck/Brief/Lens/criterion/scope가 호환되는 full run에서만 수행한다.

### Shared coaching schema

- `presentation-brief.schema.ts`: Brief CAS, requirement server revision, approved reference hash.
- `evaluator-lens.schema.ts`: revision 1 Lens registry와 immutable evaluation plan.
- `evaluation-criterion.schema.ts`: structure/semantic/timing/delivery criterion과 measurement.
- `practice-goal.schema.ts`: deterministic Top 3, immutable set, bounded resolution, practice plan.
- `focused-practice.schema.ts`: single target scope session, repeat attempt, timeline, bounded outcome.
- `challenge-qna.schema.ts`: checkpoint 1/final 3, frozen source/grounding, Question/AnswerGuide, bounded answer result.
- `private-audio-cleanup.schema.ts`: identifier-only Job payload/result와 idempotent cleanup.

모든 새 object schema는 `.strict()`이며 `packages/shared/src/index.ts`에서 export한다.

### C0 병렬 개발 공통 계약

C0는 목표 설정·evidence·집중 연습·추세·프롬프터·Q&A 구현이 같은 평가 결과를
공유하도록 만드는 additive read contract다. 기존 `RehearsalReport`,
`PracticeGoalResolution`, `FocusedPracticeAttempt` 저장 계약을 교체하지 않으며,
DB migration이나 API route를 추가하지 않는다. 후속 구현은 기존 aggregate의 bounded
결과를 아래 계약으로 조합한다.

| 계약                          | 소유 schema                      | 역할                                                                                     |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `CriterionResult`             | `evaluation-criterion.schema.ts` | criterion별 측정 가능 여부와 평가 결과를 분리해 표현한다.                                |
| `ReportObservation`           | `evaluation-criterion.schema.ts` | 수치·semantic 결과와 bounded ID/time-range evidence 참조를 표현한다.                     |
| `CoachingAction`              | `practice-goal.schema.ts`        | UI가 임의 URL을 만들지 않도록 실행 대상을 typed target으로 표현한다.                     |
| `PracticeVerificationSummary` | `focused-practice.schema.ts`     | 다음 full run에서 목표가 해결·반복·미측정·비교 불가인지 요약한다.                        |
| `TrendSeries`                 | `rehearsal.schema.ts`            | 최근 최대 5개 full run의 측정값과 비교 가능 여부를 표현한다.                             |
| `CoachingReportView`          | `rehearsal.schema.ts`            | criterion, observation, Top 3 action, verification, trend를 묶는 bounded read model이다. |

#### 상태 축

- `measurementState`는 데이터가 실제로 측정됐는지만 나타내며 `measured`, `unmeasured`만 허용한다.
- `evaluationStatus`는 criterion 평가 결과이며 `passed`, `partial`, `failed`, `not-evaluated`만 허용한다.
- `measurementState=measured`이면 `evaluationStatus`는 `not-evaluated`일 수 없고 `observationId`가 필요하다.
- `measurementState=unmeasured`이면 `evaluationStatus=not-evaluated`, `observationId=null`이어야 한다.
- `evaluationStatus`와 `reasonCode`는 고정 행렬을 사용한다. `passed=PASSED`, `partial=PARTIAL`, `failed=THRESHOLD_EXCEEDED|CONCEPT_MISSED`, `not-evaluated=NO_MEASUREMENT|NOT_APPLICABLE|SOURCE_INCOMPARABLE|EVALUATION_UNAVAILABLE`만 허용한다.
- `resolutionStatus`는 목표의 full-run 검증 결과인 `resolved`, `repeated`, `unmeasured`, `incomparable`이다.
- `verificationStatus`는 검증 summary의 UI 상태인 `verified`, `needs-follow-up`, `incomplete`, `incomparable`이다.
- `comparability`는 회차 간 비교 가능 여부인 `comparable`, `incomparable`이며 `measurementState`와 별도 축이다.
- `unmeasured` 또는 `incomparable` trend point는 bounded `reasonCode`를 반드시 제공한다.

#### `CriterionResult`와 `ReportObservation`

- `CriterionResult`는 `criterionRef`, category, scope, `measurementState`, `evaluationStatus`, `observationId`, `reasonCode`, `evaluatedAt`을 가진다.
- `ReportObservation`은 `observationId`, `criterionRef`, scope, `measurementState`, value, `evidenceRefs`, `observedAt`을 가진다.
- observation value는 duration seconds, filler/pause count, words per minute, bounded rate, semantic outcome, none만 허용한다.
- rate metric은 keyword/semantic coverage, timing balance, volume consistency, pronunciation confidence만 허용하고 값은 0~1이다.
- evidence ref는 `time-range`, `semantic-cue`, `issue`만 허용한다. time range는 `startMs <= endMs`여야 한다.
- 측정된 observation은 `none`을 사용할 수 없고 미측정 observation은 반드시 `none`을 사용한다.
- `CriterionResult.observationId`가 가리키는 observation은 같은 `criterionRef`와 scope를 가져야 한다.
- Focused Practice와 Q&A의 저장 aggregate 결과는 별도 형태를 유지할 수 있지만, 공통 리포트로 조합할 때는 같은 `CriterionResult`와 `ReportObservation` 계약으로 정규화한다.

#### `CoachingAction`

- action은 우선순위 1~3, `criterionRef`, bounded `observationIds`, 짧은 label/detail, audience impact, instruction, success condition, availability와 typed target을 가진다.
- target은 `focused-practice`, `full-rehearsal`, `report-evidence`, `deck-edit`, `challenge-qna`만 허용한다.
- action 계약에 `href`를 넣지 않는다. Web은 target ID로 route를 생성하고 API는 target ID로 권한을 다시 확인한다.
- `availability=available`이면 `unavailableReason=null`이고, `unavailable`이면 bounded reason이 필요하다.

#### `PracticeVerificationSummary`

- summary는 source goal set과 이를 검증한 full run을 명시하고 목표별 `CriterionResult`를 포함한다.
- item은 별도 `measurementState`를 복제하지 않고 내장 `CriterionResult.measurementState`를 단일 원본으로 사용한다.
- item은 비교 결과의 `resolutionReasonCode`를 별도로 가진다. `resolved=PASSED+measured/passed`, `repeated=FAILED+measured/partial|failed`, `unmeasured=NO_MEASUREMENT+unmeasured` 조합만 허용하며 `incomparable`은 bounded compatibility reason을 사용한다.
- counts는 items의 resolution status별 실제 개수와 일치해야 하며 같은 `goalId`를 중복할 수 없다.
- `verificationStatus`는 item counts에서 파생한다. repeated가 있으면 `needs-follow-up`, 그다음 unmeasured가 있으면 `incomplete`, 그다음 incomparable이 있으면 `incomparable`, 모두 resolved이면 `verified`다.
- summary의 next action은 summary와 같은 `projectId`를 사용한다.
- 부분 연습 attempt만으로 summary를 만들지 않는다. `evaluatedFullRunId`의 full run에서만 발행한다.

#### `TrendSeries`

- metric은 filler count, duration seconds, characters per minute, words per minute, timing balance, semantic coverage, volume consistency, pronunciation confidence를 허용한다.
- 모든 series는 양의 `metricDefinitionVersion`을 가진다.
- metric별 단위와 방향은 고정한다. filler는 `count/lower-is-better`, duration과 WPM은 각 단위의 `target-range`, CPM은 `characters-per-minute/neutral`, 나머지 ratio metric은 `ratio/higher-is-better`다.
- `target-range` metric은 `{ minimum, maximum }`을 필수로 가지며 다른 metric은 target range를 갖지 않는다.
- CPM trend는 `targetRange=null`인 설명형 series이며 WPM과 같은 series에 섞거나 pass/fail·적정 범위를 파생하지 않는다.
- point는 `runId`, `createdAt`, `measurementState`, `comparability`, nullable value, nullable `reasonCode`를 가진다.
- measured point만 numeric value를 가질 수 있다. unmeasured point의 value는 `null`이다.
- 한 series 안에서 `runId`는 중복될 수 없으며 최근 최대 5개 point만 포함한다.

#### `CoachingReportView`

- view는 readiness, `criterionResults`, `observations`, `topActions`, nullable `practiceVerification`, `trendSeries`, timeline events, nullable Q&A assessment, next practice plan을 조합한다.
- Top action은 최대 3개, criterion result는 최대 100개, observation은 최대 500개, trend series는 최대 7개다.
- measured criterion result의 `observationId`는 같은 view의 observations에 반드시 존재하고 같은 criterion/scope를 사용해야 한다.
- Top action은 하나 이상의 observation을 참조하고 action의 `criterionRef`와 observation criterion이 일치해야 한다.
- timeline event는 같은 view의 observation을 참조하며 Q&A assessment는 같은 project/source full run에 속한다.
- action, verification, trend는 view와 같은 `projectId`에 속해야 하고 verification은 같은 `runId`를 평가해야 한다.
- 이 view는 server-generated bounded read model이며 프론트엔드가 공식 평가 상태나 추세를 재계산하지 않는다.

#### Privacy와 확장 규칙

- 여섯 계약에는 transcript 원문, typed answer 원문, speaker notes, script, raw audio, audio bytes/URL/key, `audioFileId`를 넣지 않는다.
- evidence 재생이 필요한 후속 구현은 `ReportObservation.evidenceRefs`의 bounded ID/time range로 owner-only evidence API를 조회한다.
- provider raw response나 자유 형식 `unknown` payload를 계약에 추가하지 않는다.
- 네 병렬 스트림은 C0 schema를 import해 사용하고 같은 enum이나 결과 shape를 각 앱에 다시 정의하지 않는다.
- 새 metric, action target, reason code가 필요하면 shared schema test와 이 문서를 같은 PR에서 먼저 변경한다.
- 기존 필드의 의미·타입을 바꾸거나 제거하지 않고 additive enum/variant 확장으로 호환성을 유지한다.

### Privacy와 public boundary

- `rehearsal-audio`, `focused-practice-audio`, `slide-practice-audio`, `qna-answer-audio`는 private purpose다.
- generic file upload/list/get/content는 private purpose를 생성하거나 반환하지 않는다.
- `focused-practice-analysis`, `slide-practice-analysis`, `challenge-qna-generation`, `challenge-qna-answer-analysis`, `private-audio-cleanup`은 internal Job type이다.
- public `POST /jobs`는 `publicCreatableJobTypeSchema`만 받으며 internal coaching Job과 historical-only `pptx-import`, `ai-template-deck-generation`을 거부한다.
- Job payload/result에는 canonical ID와 bounded result만 넣고 audio key/URL/bytes, transcript, typed answer, Question/AnswerGuide 원문, reference chunk 원문, speaker notes, provider raw error를 넣지 않는다.
- Worker는 Job 완료 결과를 generic `z.record(z.unknown())`에 직접 저장하지 않고 해당 Job type의 shared result schema로 검증한 값만 저장한다.
- Question과 AnswerGuide 원문은 project-private canonical table에만 저장한다.
- transcript와 typed answer는 non-persistent private-evidence Redis에서 최대 30분만 보존한다.
- raw audio cleanup 실패는 분석 결과를 실패로 되돌리지 않고 최대 5회 idempotent retry 후 exhausted를 관측한다.

### 권한과 상태

- owner/editor만 Brief·Focused·Q&A command를 실행한다.
- viewer는 bounded project result만 읽을 수 있다.
- audience와 non-member는 coaching resource에 접근할 수 없다.
- project 삭제는 Brief, Goal, Resolution, Focused, Q&A child row를 cascade delete한다.
- Focused session은 사용자의 explicit `complete` command로만 완료한다.
- checkpoint Q&A는 정확히 1문항, final Q&A는 정확히 3문항이다.
- 첫 succeeded answer 전에는 full AnswerGuide를 응답하지 않는다.

### Migration 기준

- Migration A `CreateAdaptiveCoachingCore`는 `cancelled` run CHECK, analysis revision, asset content hash, durable Job dispatch, Brief/Goal/Resolution/outbox를 추가한다.
- Migration B `CreateFocusedPractice`는 single-scope session/attempt와 non-terminal partial unique를 추가한다.
- Migration C `CreateChallengeQna`는 session/question revision/progress/answer attempt와 tenant-safe composite FK를 추가한다.
- 세 migration은 각각 `down()`을 제공하고 A/B/C up → C/B/A down → A/B/C up으로 검증한다.

### P0 병렬 구현 선행 계약

P0 담당자는 아래 계약과 `p0-core-contract.fixtures.json`을 단일 원본으로 사용한다.
앱별 enum, DTO, fixture를 별도로 만들기 전에 shared schema를 import한다.

#### RehearsalFocusProfile과 snapshot

- `RehearsalFocusProfile`은 `PresentationBrief`와 분리된 project-level aggregate다.
- `PUT /api/v1/projects/:projectId/rehearsal-focus-profile` 요청은 `expectedRevision`을 사용한다. 최초 생성은 `0`, 이후 수정은 현재 양의 revision을 보낸다.
- CAS 충돌 응답은 `REHEARSAL_FOCUS_PROFILE_REVISION_CONFLICT`, 요청 revision, 현재 revision, 현재 profile을 반환한다. 앱별 임의 충돌 payload를 만들지 않는다.
- focus item은 최대 3개이며 priority는 1부터 연속돼야 한다. `targetScope=null`은 전체 run 목표다.
- run 시작 시 `profileId`, revision, focus item 값을 `evaluationSnapshot.focusProfileSnapshot`에 함께 동결한다. mutable profile을 나중에 다시 읽어 과거 run을 재평가하지 않는다.
- `rehearsal_focus_profiles`는 프로젝트 삭제 시 cascade 삭제한다.

#### 문장 Target

- Focused Practice target은 기존 `slide`, `slide-range`, `opening`, `closing`에 additive `sentence`를 허용한다.
- sentence target은 `scopeId`, `slideId`, 0부터 시작하는 `sentenceIndex`, SHA-256 `textSnapshotHash`를 가진다.
- sentence 분리는 `speakerNotes`를 NFC로 정규화한 뒤 명시적 줄 또는 `.`, `!`, `?`, `。`, `！`, `？`, `…` 경계 순서로 계산한다. 소수점의 `.`은 경계에서 제외한다.
- `textSnapshotHash` 입력은 선택된 문장의 NFC 문자열에서 연속 공백을 한 칸으로 줄이고 앞뒤 공백과 끝 문장부호를 제거한 UTF-8 문자열이다.
- 현재 문장 hash가 snapshot과 다르면 stale이며 자동 실행하거나 과거 결과와 비교하지 않는다.
- `slide-range`는 source evaluation snapshot의 deck order에서 연속된 2~3장이어야 하며 attempt timeline은 같은 slide ID 순서를 정확히 따라야 한다. `opening`, `closing` timeline은 빈 배열이다.
- 30~60초는 권장 연습 길이이고 기존 Focused Practice 5분은 hard maximum이다.
- 권장 연습 시간은 정수 초로 올림한 뒤 30~60초로 제한한다. `sentence`는 NFC 정규화 후 공백·문장부호를 제외한 글자 수를 초당 4자로 계산한다.
- `slide`, `slide-range`, `opening`, `closing`은 장표별 `targetSpokenSeconds`, `targetSeconds`, `estimatedSeconds`, `targetSecondsPerSlide` 순서로 기존 시간 데이터를 사용한다. 시간 데이터가 없으면 같은 방식으로 센 대본 글자 수를 초당 3.5자로 계산한다.
- `slide-range`는 범위 내 장표 시간을 합산하며, `opening`과 `closing`은 각각 Deck 순서의 첫 장표와 마지막 장표를 사용한다. 이 권장 시간은 Criterion threshold와 `successCondition`을 변경하지 않는다.

#### CPM, STT Quality Gate, pause v2

- 한국어 말하기 속도의 canonical 지표는 `characters-per-minute` v1이다. 공백을 제외한 글자 수를 실제 전체 녹음 시간으로 나누고, 전체 시간이 없을 때만 유효 segment 시작~종료 범위를 사용한다.
- `wordsPerMinute`는 기존 report 호환값이며 CPM과 서로 환산하지 않는다. `speechRate`가 없는 과거 report는 legacy CPM 미측정으로 취급하고, 새 분석에서 근거가 없을 때는 bounded reason code를 사용한다.
- STT provider가 confidence를 제공할 때만 normalized confidence를 전달한다. 제공하지 않으면 `sttQualityGate`는 `unavailable/CONFIDENCE_NOT_PROVIDED`이며, text·timestamp·duration 근거가 있는 지표 계산은 계속한다.
- normalized confidence는 승인된 `normalizationProfileId`가 있을 때만 허용한다. 현재 승인 profile registry는 비어 있으며 임의 평균·변환값이나 공통 threshold를 만들지 않는다.
- pause v2는 v1을 교체하지 않는다. `metricDefinitionVersion=2`로 위치와 분류 capability를 기록하며 provider 근거가 없으면 classification은 반드시 `unknown`이다.
- CPM·WPM·pause v1·pause v2는 metric definition version이 다르면 같은 trend로 비교하지 않는다.

#### Rehearsal analysis DTO v2

- `POST /rehearsal/analyze`의 canonical request와 response는 숫자 literal `contractVersion: 2`를 사용한다.
- request는 `language`, `provider`, `model`, `sttConfidence`, `recordingDurationSeconds`, `providerDurationSeconds`를 분리한다. 두 duration은 `null` 또는 양수 finite number이며 `0`을 자료 없음 sentinel로 사용하지 않는다.
- request의 optional `pronunciationContext`는 최대 32개 `{ source, aliases }` term이며 alias는 term당 최대 8개다. 이는 immutable run snapshot에서 생성한 STT/keyword 보조 컨텍스트이고 transcript를 canonical source로 치환하는 계약이 아니다.
- request의 `sttConfidence`와 segment confidence는 `value`, `source`, `normalizationProfileId`를 가진 normalized 값이다. 승인되지 않은 profile은 거부하고 confidence object 전체를 `null`로 보내야 한다.
- segment의 `startSeconds`와 `endSeconds`는 둘 다 `null`이거나 둘 다 finite number여야 한다. timed segment와 `slideTimeline`은 시간 비감소 순서이며 연속 중복 slide entry는 sender가 제거한다.
- response는 nullable metric value와 `measurements`를 함께 보낸다. `measured`는 non-null value와 `reasonCode=null`, `unmeasured`는 null value와 bounded reason code를 요구한다.
- response의 `durationSource`는 `recording`, `provider`, `segment-window`, `null` 중 하나이며 `durationSeconds`와 함께 존재하거나 함께 `null`이다.
- `sttQualityGate`는 `passed/CONFIDENCE_ACCEPTED`, `failed/LOW_TRANSCRIPTION_CONFIDENCE`, `unavailable/CONFIDENCE_NOT_PROVIDED|QUALITY_POLICY_NOT_CONFIGURED`만 허용한다. `failed`이면 STT 의존 지표는 모두 `unmeasured/LOW_TRANSCRIPTION_CONFIDENCE`이고 detail 결과는 비어 있다.
- response는 `capabilities`, filler occurrence, pause v1, pause v2를 strict nested object로 제공한다. filler 합계, pause v1 개수, detail 시간 순서와 duration 차이를 schema에서 검증한다.
- request/response의 root와 모든 nested object는 알 수 없는 field를 거부한다. ID는 trim 후 1~128자이며 모든 숫자는 finite여야 한다.
- 신규 공통 fixture는 `rehearsalAnalyzeRequest`와 `rehearsalAnalyzeResponse` v2다. `rehearsalAnalyzeRequestV1`은 배포 전환 중인 Python v1 reader 회귀 검증만 위한 합성 compatibility fixture다.
- 신규 sender/parser는 `rehearsalAnalyzeRequestV2Schema`, `rehearsalAnalyzeResponseV2Schema`를 직접 사용한다. 기존 `rehearsalAnalyzeRequestSchema`의 v1/v2 dual-read는 retry Job drain과 Python cutover 뒤 제거한다.

#### Evidence Clip과 Presenter Aid

- Evidence Clip은 raw audio 원본이 아니라 분석 완료 직전에 파생하는 별도 문제 구간 최대 12초 음성 계약이다. 리포트의 음량 구간 재생 파일은 Evidence Clip 계약과 분리되며, 사용자 요청 시 동일 회차 MinIO 폴더에 최대 60초 WAV로 생성하고 원본 보관 만료 시 함께 삭제한다.
- clip은 `retentionPolicyVersion=1`, `retentionDays=7`을 저장하고 생성 후 정확히 7일에 만료한다. P0에서는 연장하지 않는다. project Owner만 매 요청 권한 재검사 후 짧게 만료되는 signed URL을 받을 수 있다.
- Evidence 재생은 `GET /api/v1/projects/:projectId/rehearsals/:runId/evidence-clips/:clipId/playback`을 사용한다. API는 로그인 사용자, project Owner 역할, project·run·clip 소속을 매 요청 확인한다. Editor·Viewer는 HTTP 403, 소속이 다른 run·clip은 HTTP 404로 거부한다.
- 성공 응답은 `evidenceClipPlaybackResponseSchema`를 따른다. `available`만 최대 15분의 `signedUrl`과 URL 만료 시각 `expiresAt`을 포함하고, `failed`, `expired`, `deleted`, `not-found`는 상태와 `clipId`만 반환한다. 이 `expiresAt`은 clip의 7일 보관 만료 시각과 다른 임시 URL 만료 시각이다.
- signed URL은 응답 직전에 만들고 데이터베이스·로그·Job 결과·장기 Web 상태에 저장하지 않는다.
- report와 observation에는 `clipId`, `observationId`만 넣는다. signed URL, storage key, `audioFileId`, transcript는 report, Job result, 로그에 넣지 않는다.
- clip 실패·만료·삭제는 report 실패가 아니다. 텍스트·수치·time range evidence는 계속 표시한다.
- `rehearsal_evidence_clips`는 project/run tenant FK와 expiry index를 사용하고 project 삭제 시 cascade 삭제한다. object 삭제는 기존 `storage_deletion_outbox` 처리 경계를 재사용한다.
- P0 Presenter Aid는 `scriptVisible=false`, 남은 시간, 현재 slide keyword 최대 3개, 미해결 문제 최대 1개만 허용한다.
- 12초 Evidence Clip은 사용자 자신의 문제 근거다. 제품 Later 후보인 30~60초 모범 발화 audio와 목적·보존 정책이 다르며 서로 재사용하지 않는다.

#### Python 요청 경계

- `/rehearsal/analyze`의 top-level, segment, keyword, slide timeline Pydantic model은 `extra="forbid"`를 사용한다.
- TypeScript DTO에 없는 필드는 HTTP 422로 거부한다. provider raw payload를 통과시키지 않는다.
- 언어 중립 공통 fixture 원본은 `packages/shared/src/coaching/p0-core-contract.fixtures.json`이다. TypeScript는 같은 경로의 wrapper를 import하고 Python test는 JSON을 직접 읽는다. 현재 Python v1 reader는 compatibility fixture를 읽고, Python v2 경계 전환 PR에서 canonical v2 fixture로 바꾼다.
- 현재 Worker의 v1 new-write가 제거되기 전까지 compatibility union을 통과할 수 있다. v2 sender는 반드시 `rehearsalAnalyzeRequestV2Schema`로 검증하고 Python response는 `rehearsalAnalyzeResponseV2Schema`로 검증한다.
- 현재 v1 compatibility request도 STT 결과의 `language`를 전달한다. 필드가 없는 과거 fixture는 `und`로 읽어 장표별 속도를 `UNSUPPORTED_LANGUAGE`로 처리한다.

#### Migration D

- `CreateP0CoachingContracts`는 `rehearsal_focus_profiles`, `rehearsal_evidence_clips`, expiry/observation index를 추가한다.
- migration은 `down()`에서 clip index/table을 먼저 제거한 뒤 focus profile table을 제거한다.

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
