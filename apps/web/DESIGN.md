# ORBIT Web Design

이 문서는 현재 `apps/web`에 구현된 ORBIT 웹 제품의 시각 언어와 UI 작성 규칙을 설명한다. 공개 화면, 프로젝트 작업 공간, AI 발표자료 생성, 에디터, 리허설, 리포트, 청중 화면이 서로 다른 밀도를 가지면서도 하나의 제품처럼 보이게 하는 기준이다.

문서 기준일은 2026-07-19이다. 정확한 CSS 값의 최종 원본은 [`src/styles/tokens.css`](./src/styles/tokens.css), 공통 구현 규칙은 [`AGENTS.md`](./AGENTS.md)다. 이 문서는 그 값을 복제하는 목록이 아니라 어떤 역할에 왜 사용해야 하는지를 설명한다.

## 1. 제품 경험의 방향

ORBIT는 아이디어를 슬라이드로 만들고, 편집하고, 발표를 연습하고, 결과를 개선하는 흐름을 하나의 작업 환경으로 연결한다. 디자인은 다음 네 가지 원칙을 따른다.

### 밝고 정밀한 작업대

기본 화면은 흰색과 옅은 회색의 넓은 작업면을 사용한다. 구조는 얇은 경계와 표면의 명도 차이로 나누며, 무거운 그림자는 메뉴와 모달처럼 실제로 떠 있는 레이어에만 제한한다.

### 색은 장식보다 의도

Electric Blue는 핵심 행동과 활성 상태, Vivid Purple은 AI·창작 기능과 보조 선택, Neon Pink는 제한적인 강조에 사용한다. 성공, 경고, 오류는 별도의 semantic color를 사용한다. 한 화면에서 여러 accent가 같은 중요도로 경쟁하지 않게 한다.

### 맥락에 맞는 밀도

- 랜딩과 인증 화면은 큰 문장, 넓은 여백, 하나의 명확한 CTA에 집중한다.
- 프로젝트와 생성 화면은 카드와 목록을 빠르게 훑을 수 있는 중간 밀도를 사용한다.
- 에디터는 rail, canvas, inspector가 공존하는 고밀도 도구 화면이다.
- 리허설과 발표 화면은 슬라이드와 현재 행동을 가장 크게 보여준다.
- 청중 화면은 한 손 조작과 짧은 과업에 맞춘 좁고 단순한 흐름을 사용한다.

### 상태는 항상 설명 가능하게

선택, 진행, 성공, 경고, 실패를 색만으로 표현하지 않는다. 텍스트, 아이콘, 테두리, `aria-*` 상태 중 필요한 수단을 함께 사용한다.

## 2. 화면 체계

현재 웹은 하나의 고정 레이아웃을 모든 화면에 강제하지 않는다. 사용 목적에 따라 다음 shell을 사용한다.

| 화면군 | 대표 화면 | 구조 | 기본 theme |
| --- | --- | --- | --- |
| 공개 | 랜딩, 로그인, 회원가입 | 제한된 폭의 header + editorial content | Light |
| 제품 탐색 | 홈, 프로젝트, 리허설 목록, 리포트 목록 | `OrbitAppHeader` + `WorkspaceContainer` | Light |
| 생성·설정 | AI 발표자료 생성, 발표 brief, 연습 계획 | 단계 또는 form 중심의 content column | Light |
| 편집 | 슬라이드 에디터 | 전체 viewport top bar + slide rail + canvas + inspector | Dark |
| 발표·리허설 | presenter, rehearsal workspace | 큰 stage + 상태/제어 panel | 주로 Light |
| 분석 | 리허설 상세, 프로젝트 리포트 | KPI, chart, table의 dashboard | Light |
| 청중 | 입장, activity 응답 | 중앙 단일 panel, touch-first control | Light |

제품 탐색 화면의 공통 header는 64px 높이를 기준으로 하며 `홈`, `프로젝트`, `리허설`, `리포트`의 현재 위치를 밑줄과 text color로 표시한다. 에디터와 발표처럼 몰입이 필요한 화면은 이 header를 사용하지 않고 전용 shell을 갖는다.

## 3. 색상

### Light scheme

| 역할 | Token | 현재 값 | 사용 |
| --- | --- | --- | --- |
| 기본 배경 | `--redesign-color-background` | `#ffffff` | 페이지의 가장 낮은 면 |
| 낮은 container | `--redesign-color-surface-container-low` | `#f8f8fa` | field, 보조 panel |
| 중간 container | `--redesign-color-surface-container` | `#f1f1f4` | hover, 구조 구분 |
| 주요 text | `--redesign-color-on-surface` | `#111114` | 제목, 본문, 핵심 값 |
| 보조 text | `--redesign-color-on-surface-variant` | `#55555f` | 설명, metadata |
| 약한 경계 | `--redesign-color-outline-variant` | `#d6d6dc` | card, divider, field |
| 강한 경계 | `--redesign-color-outline` | `#8c8c96` | 강조된 구조, hover |
| Primary | `--redesign-color-primary` | `#0090ff` | 활성 상태, 브랜드 신호 |
| Primary emphasis | `--redesign-color-primary-emphasis` | `#0068b7` | 기능 text, primary button |
| Secondary | `--redesign-color-secondary` | `#8b3dff` | AI·창작 맥락 |
| Tertiary | `--redesign-color-tertiary` | `#ff2d9e` | 제한적인 고대비 강조 |

Primary button은 밝은 바탕에서 text contrast를 확보하기 위해 `primary`가 아니라 `primary-emphasis`를 사용한다. 큰 홍보 CTA에만 `GradientButton`의 Primary → Secondary gradient를 사용한다.

### Semantic feedback

| 의미 | Base token | Container token | 원칙 |
| --- | --- | --- | --- |
| 성공 | `--redesign-color-success` | `--redesign-color-success-container` | 완료, 정상, 연결 성공 |
| 경고 | `--redesign-color-warning` | `--redesign-color-warning-container` | 확인 필요, 부분 성공 |
| 정보 | `--redesign-color-info` | `--redesign-color-info-container` | 중립적인 진행 정보 |
| 오류 | `--redesign-color-error` | `--redesign-color-error-container` | 실패, 삭제 등 위험 행동 |

상태 배경에는 container token, text와 icon에는 해당 on-container 또는 base token을 사용한다. `primary`, `secondary`, `tertiary`를 성공·경고·오류의 대체 색으로 사용하지 않는다.

### Dark scheme

`.redesign-dark`를 subtree에 적용하면 같은 semantic token이 dark 값으로 전환된다. 현재 대표 사용처는 에디터 shell과 공개 화면 안의 에디터 preview다.

- 배경은 `#131316`, 가장 낮은 surface는 `#0e0e11`이다.
- 주요 text는 `#e4e1e6`, 보조 text는 `#bdc8d1`이다.
- dark Primary는 `#8dd4ff`로 밝아진다.
- dark theme에서도 구조는 검은 면 하나가 아니라 여러 surface 명도로 구분한다.

Dark 값을 feature CSS에 다시 선언하거나 페이지 전체에 무조건 적용하지 않는다. 필요한 subtree에 `.redesign-dark`를 두고 기존 role token을 그대로 소비한다.

## 4. Typography

모든 제품 UI는 bundled variable font인 Pretendard를 사용한다. typeface를 섞지 않고 크기, 무게, line height, tracking만으로 위계를 만든다.

| 역할 | 크기 / line height | 기본 weight | 사용 |
| --- | --- | --- | --- |
| Display XL | 96 / 104px | 800 | 매우 제한적인 hero |
| Display LG | 64 / 72px | 800 | desktop hero |
| Display MD | 48 / 56px | 800 | 주요 editorial title |
| Display SM | 40 / 48px | 750 | compact hero, mobile title |
| Headline LG | 32 / 40px | 700 | page title |
| Headline MD | 26 / 34px | 700 | section title, dialog title |
| Title LG | 20 / 28px | 700 | card·panel heading |
| Title MD | 18 / 26px | 650 | compact section heading |
| Body LG | 18 / 28px | 400 | hero description |
| Body MD | 16 / 24px | 400 | 기본 본문 |
| Body SM | 14 / 20px | 400 | 보조 본문, dense UI |
| Label MD | 14 / 20px | 600 | button, field label |
| Label SM | 12 / 16px | 600 | metadata, eyebrow, status |

- 큰 제목은 negative tracking으로 단단하게 묶고, 한글 문장은 가능한 경우 `word-break: keep-all`을 사용한다.
- `label-sm`의 넓은 tracking과 uppercase는 eyebrow, 영문 상태 label처럼 짧은 text에만 사용한다.
- 7px와 8px micro type token은 축소된 slide preview와 고밀도 metadata 전용이다. 일반 UI text에 사용하지 않는다.
- 새로운 `font-size` literal을 feature CSS에 추가하지 않는다. 적합한 role이 없으면 token의 필요성을 먼저 검토한다.

## 5. Spacing, size, shape

### Spacing

간격은 4px base scale을 사용한다. `--redesign-space-1`은 4px, `--redesign-space-2`는 8px이며 같은 방식으로 `--redesign-space-32`의 128px까지 이어진다.

- inline icon gap: 주로 4–8px
- compact control 내부 여백: 주로 8–12px
- card와 form 내부 여백: 주로 16–24px
- section 사이: 주로 32–64px
- hero와 큰 화면 구획: 64px 이상

좌표, canvas scale, viewport 계산처럼 실제로 동적인 값을 제외하고 임의의 spacing literal을 만들지 않는다.

### Controls and icons

| 항목 | Token / 크기 |
| --- | --- |
| Compact control | `--redesign-size-control-sm`, 32px |
| Default control | `--redesign-size-control-md`, 40px |
| Prominent control / field | `--redesign-size-control-lg`, 48px |
| Extra-large control | `--redesign-size-control-xl`, 56px |
| Icon | 16 / 20 / 24px token |
| Product header | 64px |

아이콘은 현재 설치된 Tabler icon을 기본으로 사용하고, 기존 feature가 Lucide를 사용하는 경우 그 feature 안에서 일관성을 유지한다. icon-only button에는 반드시 구체적인 `aria-label`을 제공한다.

### Shape

| 역할 | Token | Radius |
| --- | --- | --- |
| 작은 detail | `--redesign-radius-sm` | 2px |
| button, input | `--redesign-radius` | 4px |
| 중간 control | `--redesign-radius-md` | 6px |
| card, modal | `--redesign-radius-lg` | 8px |
| 큰 panel | `--redesign-radius-xl` | 12px |
| avatar, badge, timer | `--redesign-radius-full` | pill / circle |

기본 인상은 둥글고 부드러운 소비자 앱보다 정밀한 creative tool에 가깝다. Pill은 avatar, status, timer, floating control처럼 형태 자체에 이유가 있을 때만 사용한다.

## 6. Layout와 responsive behavior

### Width system

- Editorial / design-system content: 최대 1200px
- Product content: 최대 1640px
- Wide workspace: 최대 2240px
- Workspace 좌우 여백: viewport에 따라 24–64px
- Mobile 좌우 여백: 16px

`WorkspaceContainer`는 `wide`와 `content` 두 폭을 제공한다. 제품 shell 안의 홈, 프로젝트, 리허설 목록, 리포트 목록은 직접 max-width를 반복하지 말고 이 pattern을 사용한다.

현재 구현에는 공통 12-column grid primitive가 없다. 열 개수는 project card grid, dashboard, editor처럼 화면 목적에 맞게 feature에서 정하되, 공통 gutter와 width token을 사용한다.

### Breakpoint reference

기준 token은 Mobile 640px, Tablet 960px, Desktop 1200px이다. 실제 화면에는 콘텐츠가 깨지는 지점에 맞춘 520px, 760/767px, 820/860px 등의 feature breakpoint도 존재한다.

- 960px 전후: 다열 dashboard와 설정 panel을 축소하거나 한 열로 바꾼다.
- 760/767px 전후: product header는 brand/account와 navigation의 2행 구조로 전환되고 workspace padding은 compact해진다. 이때 header는 64px 고정 높이가 아니라 64px 이상의 content 높이를 사용한다.
- 640px 이하: dialog는 bottom sheet 형태로 내려가고 action은 full-width를 우선한다.
- 좁은 화면에서 전체 page가 가로로 밀리지 않게 한다. 넓은 table이 필요한 경우 table wrapper만 수평 scroll한다.
- Editor는 기능을 제거하기보다 rail을 줄이고 inspector를 bottom overlay로 전환한다.

CSS custom property는 media query 조건에 사용할 수 없으므로 breakpoint token은 참조값이다. media query에는 그 값과 일치하는 literal을 사용한다.

## 7. Surface, border, elevation

깊이는 다음 순서로 표현한다.

1. page background
2. 낮은 container surface
3. card 또는 panel surface + 1px border
4. dropdown, dialog, floating panel + 제한된 shadow

기본 card는 `surface-container-lowest`, `outline-variant`, 8px radius로 구성한다. 선택 card는 Primary border와 glow를 함께 사용하고, interactive card는 hover에서 최대 2px 정도만 이동한다.

`--redesign-shadow-raised`와 `--redesign-shadow-overlay`는 실제로 겹쳐지는 요소에 사용한다. 항상 떠 있는 것처럼 보이게 모든 card에 overlay shadow를 적용하지 않는다. Bloom glow는 Primary, Secondary, Tertiary, Error의 강조 상태에 제한한다.

## 8. 공통 components

공개 API는 [`src/components/ui/index.ts`](./src/components/ui/index.ts)에서 가져온다.

| Component | 역할과 variant |
| --- | --- |
| `OrbitBrand` | symbol + ORBIT wordmark |
| `OrbitButton` | `primary`, `secondary`, `quiet`, `danger`; `compact`, `default`, `prominent` |
| `GradientButton` | 랜딩·인증의 높은 우선순위 CTA |
| `OrbitIconButton` | `surface`, `plain`, `inverse`, `primary`; `aria-label` 필수 |
| `OrbitIconLabel` | 고정 20px icon slot과 text를 정렬하는 label |
| `OrbitCard` | 기본 border card; `data-interactive`, `data-selected` 상태 지원 |
| `OrbitColorBlock` | lilac, success, warning 계열의 큰 설명 block |
| `OrbitField` | label, hint, error와 control의 접근성 연결 |
| `OrbitInput`, `OrbitSelect`, `OrbitTextarea` | 48px form control과 invalid/disabled 상태 |
| `OrbitStatus` | neutral, lilac, success, warning, info, danger |
| `OrbitTabs` | keyboard arrow/Home/End 이동을 지원하는 tab set |
| `DropdownMenu` | white/black, start/end 정렬의 menu surface |
| `OrbitDialog` | focus trap, Escape, focus return을 포함한 modal |
| `OrbitEmptyState` | icon, title, description, action의 빈 상태 |

공통 primitive는 시각과 상호작용 계약을 제공한다. 프로젝트 카드, workspace header, report KPI처럼 도메인 의미가 있는 조합은 `components/patterns` 또는 각 `features/<feature-name>`에 둔다.

## 9. 반복되는 interaction pattern

### Primary action

한 영역에는 대표 Primary action을 하나만 둔다. 나머지는 `secondary` 또는 `quiet`로 낮춘다. 삭제처럼 되돌리기 어려운 행동은 `danger`와 확인 단계로 구분한다.

### Selection

선택 상태는 배경색만 바꾸지 않고 border, label, `aria-selected` 또는 `aria-pressed`를 함께 사용한다. slide thumbnail과 선택 card는 Primary outline을 공통 신호로 사용한다.

### Loading and progress

- button 내부 요청은 `loading`과 `aria-busy`를 사용하고 중복 제출을 막는다.
- page loading은 무엇을 불러오는지 `role="status"` 또는 `aria-label`로 설명한다.
- 긴 AI 작업은 단계, 현재 상태 문구, 완료/실패 결과를 유지한다.
- motion을 제거해도 진행 상태를 이해할 수 있어야 한다.

### Empty, error, recovery

상태 화면은 제목 → 원인 또는 다음 설명 → 가능한 행동 순서로 쓴다. 오류 문구만 노출하지 말고 `다시 시도`, `목록으로`, `리허설 시작`처럼 회복 가능한 다음 행동을 제공한다.

### Overlay

Dropdown은 trigger에 가깝게, dialog는 독립적인 결정에 사용한다. Mobile dialog는 화면 아래에 붙는 sheet로 바뀐다. Canvas 위 도구처럼 위치가 기능에 포함되는 경우에만 absolute/fixed layout을 사용한다.

## 10. Motion

기본 duration은 100ms, 150ms, 220ms, 320ms 단계다. 색상 변화는 빠르게, 위치와 scale 변화는 보통 속도로 처리한다.

- hover motion은 작업 대상을 확인하는 정도로만 사용한다.
- button active는 1px 이동처럼 즉각적인 물리 feedback을 준다.
- dropdown과 인증 card의 등장 animation은 짧고 한 번만 실행한다.
- 무한 animation은 spinner처럼 진행을 설명하는 경우에만 사용한다.
- `prefers-reduced-motion: reduce`에서는 duration token이 0ms로 전환되며, feature animation도 별도로 정지해야 한다.

새 duration이나 easing을 feature CSS에 직접 추가하지 않는다.

## 11. Accessibility와 content

- 클릭 가능한 요소는 `button` 또는 `a`를 사용한다.
- 모든 keyboard focus는 `--redesign-focus-ring`으로 보이게 유지한다.
- dialog는 focus를 가두고 닫힌 뒤 trigger로 focus를 돌려준다.
- tab, menu, dialog, status는 해당 semantic role과 `aria-*`를 사용한다.
- form error는 control과 연결하고 `role="alert"`를 사용한다.
- status와 선택은 색 외에 text, icon, border 또는 shape으로 구분한다.
- 일반 본문은 축소된 slide preview용 micro type을 사용하지 않는다.
- 기능 text와 control은 최소 WCAG AA 수준의 contrast를 실제 조합별로 검증한다. token을 사용했다는 사실만으로 contrast 준수를 가정하지 않는다.
- 발표자 script, raw audio, 내부 ID처럼 사용자에게 필요하지 않거나 노출하면 안 되는 정보는 UI copy에 포함하지 않는다.

한국어 문장은 짧고 직접적으로 쓴다. 버튼은 `만들기`, `다시 시도`, `리허설 시작`처럼 행동으로 명명하고, loading 문구는 `생성 중`, `불러오는 중`처럼 현재 상태를 말한다.

## 12. 구현 경계

```text
src/styles/tokens.css              모든 공통 시각 값의 단일 원본
src/styles/foundations.css         reset, base typography, focus, selection
src/components/ui/                 도메인을 모르는 primitive
src/components/patterns/           여러 feature가 재사용하는 조합 pattern
src/features/<feature-name>/       화면과 도메인 전용 UI
```

- `components/ui`는 `features`를 import하지 않는다.
- 새 primitive는 component별 `.tsx`와 `.css` 파일로 나누고 `index.ts`에서 export한다.
- 재사용 component는 `className`을 지원한다.
- literal color, 재사용 spacing, radius, font size, shadow, duration을 feature CSS에 추가하지 않는다.
- 동적 좌표 외의 inline style을 사용하지 않는다.
- 기존 `src/design-system` 방식이나 별도의 `--orbit-ds-*` token 체계를 다시 만들지 않는다.
- redesign은 API 호출, routing, Zustand state, report schema와 분리한다.

Token boundary는 [`src/styles/design-system-boundary.test.ts`](./src/styles/design-system-boundary.test.ts)가 검사한다.

## 13. 새 화면 작성 순서

1. 화면이 공개, product shell, editor, presenter, audience 중 어떤 맥락인지 정한다.
2. 기존 `OrbitAppHeader`, `WorkspaceContainer`, UI primitive로 구조를 먼저 조합한다.
3. 색상 이름이 아니라 semantic role token을 선택한다.
4. mobile에서 열 순서, action 폭, scroll 경계를 먼저 정한다.
5. loading, empty, error, disabled, selected 상태를 정상 상태와 함께 설계한다.
6. keyboard focus, icon label, form description, dialog focus return을 확인한다.
7. 새 값이 필요하면 feature literal을 추가하기 전에 기존 token과 pattern으로 해결 가능한지 확인한다.
8. 관련 test와 `design-system-boundary.test.ts`, typecheck, build를 실행한다.

## 14. 현재 상태와 문서 사용법

이 문서는 현재 production source를 기준으로 한 규범적 설명이다. `features/mockups`와 과거 QA screenshot은 구현 의도를 이해하는 보조 자료일 뿐 token과 primitive보다 우선하지 않는다.

현재 일부 복잡한 화면은 공통 primitive 이전에 만들어진 긴 feature CSS를 유지하고 있다. 새 작업에서 이를 별도 palette나 두 번째 design system의 근거로 삼지 않는다. 기존 화면을 수정할 때는 business logic을 보존하면서 가장 가까운 role token과 공통 component로 점진적으로 맞춘다.

개발 중인 design system specimen은 `/design-system` route의 `RedesignSystemPage`에서 확인할 수 있다. 이 화면은 palette, typography, button, status, field, tab, dialog의 빠른 회귀 확인용이며, 모든 product pattern을 대신하지는 않는다.

### 실제 렌더링 검증

2026-07-19에 local Vite와 API, 실제 workspace data를 사용해 다음 범위를 확인했다.

- Desktop 1440×900: `/design-system`, `/`, `/project`, `/createdeck`, 실제 `/project/:projectId` editor, 실제 `/rehearsal/:projectId` preflight, `/reports`
- Mobile 390×844: `/design-system`, `/createdeck`, 실제 `/project/:projectId` editor
- Light 화면에서 흰색 surface와 Pretendard가 적용되고, 실제 editor에서 `.redesign-dark`의 `#131316` shell과 rail/canvas/inspector 구조가 적용되는 것을 확인했다.
- Mobile product header의 2행 전환, 생성 form의 1열 전환, editor의 축소 rail과 fixed inspector control을 확인했다.
- 확인한 mobile 화면에서 page-level horizontal overflow가 발생하지 않았다.
- Mobile dialog가 bottom sheet로 열리고 initial focus, Escape close, trigger focus return이 동작하는 것을 확인했다.
- 확인 과정에서 browser console warning과 error는 발생하지 않았다.

마이크 권한이 필요한 실제 녹음 시작과 청중 기기 연동은 이번 시각 검증 범위에 포함하지 않았다. 이 기능은 permission과 외부 장치 상태를 포함하는 별도 interaction QA에서 검증한다.
