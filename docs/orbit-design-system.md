# ORBIT Design System

## 목적

이 문서는 ORBIT의 공개 메인, 로그인 후 프로젝트 허브, AI 발표자료 생성, 에디터 화면에 공통으로 적용하는 현재 공식 시각·상호작용 기준이다. 기준 시안은 2026-07-10에 확정한 화면이며, 기존 `DESIGN.md`는 이 시스템의 입력으로 사용하지 않았다.

디자인 시스템의 핵심 문장은 다음과 같다.

> 흑백은 제품의 구조, 라일락은 핵심 작업, 라임과 크림은 보조 시작점을 표현한다.

## 제품 원칙

1. 화면당 Primary action은 하나만 둔다.
2. 라일락 대형 면은 생성·편집처럼 사용자가 집중해야 하는 핵심 작업에만 쓴다.
3. 템플릿 시작은 라임, 가져오기·변환은 크림으로 일관되게 구분한다.
4. 프로젝트 목록은 카드 묶음이 아니라 한 개의 표면과 행 구분선으로 표현한다.
5. 버튼·탭은 pill 형태, 입력·패널은 8–16px radius를 사용한다.
6. 그림자보다 여백, 정렬, 크기, 색면 순으로 위계를 만든다.
7. 공개 화면·로그인 후 화면·생성 화면의 top navigation 높이와 타이포 음성을 유지한다.
8. 에디터는 `슬라이드 목록 → 캔버스 → 작업 패널`의 3영역을 기본 골격으로 삼는다.

## Foundations

### Color roles

| Role | Value | Usage |
| --- | --- | --- |
| Ink | `#090909` | 본문, 제목, Primary action |
| Canvas | `#ffffff` | 기본 화면 배경 |
| Surface | `#f7f7f5` | hover, segmented control, 보조 표면 |
| Border | `#e6e6e6` | hairline과 행 구분선 |
| Lilac | `#c5b0f4` | 핵심 작업 공간 |
| Lilac strong | `#6846d8` | focus, active state, 짧은 eyebrow |
| Lime | `#dceeb1` | 템플릿 기반 시작 |
| Cream | `#f4ecd6` | PPTX 가져오기·전환 |
| Mint | `#c8e6cd` | 긍정적 보조 정보 |
| Navy | `#1f1d3d` | 제한적인 inverse surface |

Semantic color는 작은 status와 validation에만 쓴다. 큰 배경 면으로 사용하지 않는다.

### Typography

- Font family: 앱에 번들된 `Pretendard` variable webfont(45–920). 플랫폼 설치 폰트는 사용하지 않는다.
- Display: 86px, 650, line-height 0.98, letter-spacing -0.055em.
- Title: 64px, 620, line-height 1.05, letter-spacing -0.045em.
- Page title: 36–48px, 620, line-height 1.1, letter-spacing -0.04em.
- Heading: 26px, 600, line-height 1.35.
- Subheading: 20px, 600, line-height 1.4.
- Body large: 18px, 400–600, line-height 1.55.
- Body: 16px, 400, line-height 1.65.
- Body small: 14px, 400–600, line-height 1.5.
- UI text: 14px, 500–700, line-height 1.5.
- UI small: 13px, 500–700, line-height 1.45.
- Eyebrow/caption: 12px, 600–700. Eyebrow에만 mono와 letter-spacing 0.08em을 적용한다.

실제 읽거나 조작하는 UI 텍스트는 12px 미만으로 만들지 않는다. 12px은 짧은 표 머리글, 상태 badge, eyebrow처럼 보조적인 정보에만 사용하고, 날짜·설명·버튼·검색·필터처럼 사용자가 읽거나 조작해야 하는 텍스트는 13–14px 이상을 사용한다. 축소된 슬라이드 thumbnail과 편집 canvas 안의 비상호작용 콘텐츠만 이 하한의 예외로 둔다.

한 화면에서 가장 큰 제목과 핵심 본문의 크기 차이가 과도해지지 않도록 `Page title → Heading → Subheading → Body → UI` 단계를 우선 사용한다. Display와 Title은 landing hero나 중요한 빈 상태처럼 제한된 위치에서만 사용한다.

한국어 display text는 2줄을 넘기지 않는다. 본문 한 줄은 데스크톱 기준 약 60자 이내로 유지한다.

### Brand logo

- 밝은 Canvas와 Surface에는 `apps/web/src/assets/orbit-logo.png`를 사용한다.
- Ink, Navy, presenter mode 같은 dark surface에는 `apps/web/src/assets/orbit-logo-white.png`를 사용한다.
- Dark surface에서 밝은 로고를 흰색 card나 pill 안에 넣지 않는다. 충분한 clear space를 두고 원본 비율 그대로 표시한다.
- 두 raster logo는 색상 반전, 재채색, outline 추가 없이 제공된 원본 자산을 사용한다.

### Spacing and shape

- Space scale: `4, 8, 12, 16, 24, 32, 48, 64, 96px`.
- Controls: compact 36px, default 44px, prominent 52px.
- Radius: control 8px, panel 16px, color block 24px, pill 999px.
- Focus ring: `0 0 0 3px rgba(104, 70, 216, 0.22)`.

## Components

### Button

- `primary`: 검은 배경, 흰 글자. 화면의 가장 중요한 완료·진입 행동.
- `secondary`: 흰 배경, 진한 테두리. 가져오기, 예시 보기 등 대안 행동.
- `quiet`: 배경 없음. 취소, 초안 저장, 보조 이동.
- Icon-only button은 44×44px 원형으로 만들고 반드시 `aria-label`을 제공한다.

### Form controls

- label은 control 위에 배치한다.
- 기본 높이는 46px이며 textarea만 내용에 따라 확장한다.
- validation은 border와 helper text를 함께 바꾼다. 색만으로 오류를 알리지 않는다.
- 파일 업로드는 dashed border 한 개의 면으로 표현하고 허용 형식과 최대 용량을 항상 노출한다.
- `OrbitField`는 label, hint/error, control의 접근성 연결을 소유한다. 실제 input/select/textarea는 `OrbitInput`, `OrbitSelect`, `OrbitTextarea`를 사용한다.

### Icon button

- `OrbitIconButton`은 visible text가 없는 44×44px action에 사용한다.
- `aria-label`은 필수이며 `surface`, `plain`, `inverse` 중 배경 맥락에 맞는 variant를 사용한다.
- 한 화면 안에서 icon family를 혼용하지 않고 신규 production UI는 Tabler outline icon을 사용한다.

### Tabs

- `OrbitTabs`는 같은 맥락 안의 panel 내용을 전환할 때만 사용한다.
- 선택 상태는 `aria-selected`, keyboard focus, white active surface를 함께 제공한다.
- 서로 다른 route로 이동하는 주 navigation에는 tabs를 사용하지 않는다.

### Dialog

- `OrbitDialog`는 현재 작업 맥락을 유지해야 하는 권한, 확인, 설정 flow에 사용한다.
- 열릴 때 dialog 내부로 focus를 이동하고, `Tab` focus trap, `Escape` 닫기, 닫힌 뒤 trigger focus 복귀를 지원한다.
- mobile에서는 viewport 하단 sheet로 전환하되 primary action이 viewport 밖으로 밀리지 않게 한다.

### Empty state

- `OrbitEmptyState`는 빈 화면을 icon, 제목, 짧은 설명, 선택적 단일 action으로 구성한다.
- 빈 상태에서 사용할 수 없는 filter/table chrome을 그대로 남기지 않는다.
- 실제 query의 empty state에만 사용하며 demo data를 fallback으로 채우지 않는다.

### Segmented control

동일한 목표를 시작하는 2–3개의 상호 배타적인 선택에만 사용한다. 선택 상태는 흰 면과 진한 글자로 표현하며, 탭처럼 별도 화면을 탐색하는 용도로 사용하지 않는다.

### Status

- Neutral: 초안 생성.
- Lilac: 편집 중.
- Warning: 리허설 중.
- Info: 피드백 반영.
- Success: 완료.

상태 문구는 6자 내외로 유지하고 표 내부에서는 pill 크기를 28px로 고정한다.

### Project table

- 프로젝트는 하나의 table surface 안에서 행으로 구분한다.
- 기본 열은 이름, 단계, 최근 수정, 발표 시간, 슬라이드, 작업이다.
- 행 전체 이동과 개별 작업이 충돌하지 않도록 작업 버튼에는 구체적인 접근성 label을 제공한다.
- 모바일에서는 표를 임의로 카드로 바꾸지 않고 핵심 열 우선순위를 정의한 별도 패턴을 설계한다.

### Color block

- Lilac: `AI로 만들기`처럼 핵심 작업으로 진입.
- Lime: `템플릿에서 시작`.
- Cream: `PPTX 가져오기`.
- 한 화면에 3개를 초과하지 않고, block 내부에 중첩 카드를 만들지 않는다.

## 화면별 적용

### 로그인 전 메인

- 공개 navigation과 `로그인`, 검은 pill `무료로 시작`을 사용한다.
- 라일락 hero에서 제품의 생성·편집·리허설 흐름을 한 번에 설명한다.
- 개인 프로젝트, 알림, 사용자 정보는 노출하지 않는다.

### 로그인 후 홈

- 동일한 navigation 높이와 타입을 유지한다.
- Primary action은 `AI 발표자료 만들기`다.
- 최근 프로젝트는 table 한 개로 묶고 템플릿·PPTX는 하단 색면으로 분리한다.

### AI 발표자료 생성

- 생성 흐름은 `내용 입력 → Style & Color → 슬라이드 구성 미리보기` 순서로 표시한다. Story Review 화면은 표시하지 않는다.
- 첨부파일은 선택 즉시 병렬 업로드하고 각 파일에 `업로드 중 | 업로드 완료 | 업로드 실패` 상태를 표시한다. 업로드 중에는 Primary action을 비활성화하고 실패 파일에는 재시도와 제거를 제공한다.
- 생성 미리보기는 시간 기반 연출이 아니라 서버에서 검증 완료된 slide의 1번부터 연속된 prefix를 즉시 표시한다. 아직 완료되지 않았거나 앞 순서가 준비되지 않은 slide는 목차와 skeleton만 유지한다.
- 내용 입력 화면은 발표 주제, 발표 내용, 청중, 발표 톤 4개와 복수 참고자료 첨부를 한 면에 둔다. 발표 시간과 슬라이드 수는 노출하지 않는다.
- Style & Color 화면은 기존 추천 폰트 선택과 live preview, 기본 팔레트 9개를 제공하고, 열 번째 AI 타일에서 선택 팔레트의 일부 변경 또는 새 분위기 추천을 자연어로 요청한다.
- AI 팔레트 요청이 실패하면 선택 표시와 기존 색상은 유지하고 타일 가까이에 오류를 표시한다.
- 내용 입력 Primary action은 `다음 단계`, Style & Color Primary action은 `슬라이드 생성`이다. 다음 단계 클릭 직후 content planning을 백그라운드에서 시작한다.
- 생성 미리보기의 표지는 Style 확정 직후 서버가 우선 생성한다. content plan 전에는 `5~8장 예정`과 번호가 있는 8개 skeleton을 먼저 표시하고, 1~5번은 생성 예정, 6~8번은 구성에 따라 추가되는 슬롯으로 구분한다. 이후 실제 목차로 교체하고 검증된 slide는 1번부터 약 500ms 간격으로 공개한다. 화면 상단에는 Vision QA 중 내용과 디자인이 변경될 수 있음을 계속 안내하며, “모든 슬라이드를 만들었습니다” 문구는 quality-check 단계에서만 표시한다.
- 생성 미리보기는 편집 도구 없이 왼쪽에 전체 목차와 장 번호를 먼저 표시한다. 미완성 장표는 blur skeleton과 `생성 중 | 생성 예정` 상태를 사용하고, 완료된 연속 순서의 장표만 중앙 읽기 전용 canvas에 공개한다.
- 최종 품질 확인 중에는 결과가 달라질 수 있다는 amber 안내를 표시하고, publication 완료 후에만 일반 editor로 전환한다. `prefers-reduced-motion`에서는 순차 fade 효과를 생략한다.

### 에디터

- 화면은 슬라이드 목록, 편집 캔버스, AI·디자인·메모 패널의 3영역으로 구성한다.
- 상단은 문서 header와 둥근 tool dock의 2단 chrome으로 구성한다.
- 문서 header 왼쪽에는 제목·저장 상태와 파일/수정/보기/삽입 등의 메뉴를 두고, 오른쪽에는 버전·댓글·공유·리허설·발표 같은 문서 수준 작업만 둔다.
- 저장 상태는 제목과 같은 baseline의 작은 icon+text로 표시하며 status pill을 사용하지 않는다.
- Tool dock은 neutral surface와 14px radius를 사용하고, 실행 취소·다시 실행 다음에 선택·텍스트·이미지·차트·레이아웃 도구를 배치한다.
- 오른쪽 패널의 기본 탭은 `AI 코치`다. `디자인`, `발표 메모`는 같은 위치에서 전환한다.
- Primary action은 `발표하기`이며 `리허설`과 `공유`는 secondary action이다.
- `공유`는 에디터 맥락을 유지하는 modal로 열고, `함께 작업 중`과 `승인 요청`을 tab으로 구분한다.
- 공유 modal은 이메일 초대, 보기/편집 권한, 참여자 권한 변경, 승인/거절, 권한이 포함된 링크 복사를 한 흐름에서 제공한다.
- 프로젝트 소유자만 공유 설정을 변경할 수 있다는 관리 범위를 modal 하단에 명시한다.
- AI 제안은 원문, 제안 내용, 적용 결과가 한 카드 안에서 이해되어야 한다.
- 캔버스 바깥 작업 공간에는 Surface를 사용하고 실제 슬라이드 색상은 Lilac, Lime, Cream, Navy, Canvas 안에서 선택한다.
- 고밀도 에디터에서도 panel body는 12px, list title은 13px, section title은 14px보다 작게 사용하지 않는다. Thumbnail 보조 문구는 예외적으로 6px까지 허용한다.

### 리허설

- 리허설 진입 전에는 별도 `마이크 확인` 화면에서 권한, 입력 장치, 입력 음량을 순서대로 점검한다.
- 권한 요청 전에는 개인정보 안내와 단일 Primary action을 제공하고, 허용 후에는 장치 선택과 음량 테스트를 한 화면에 노출한다.
- 권한이 차단된 경우 브라우저 설정 복구 방법과 `다시 확인하기`를 제공하며 사용자를 막힌 상태로 방치하지 않는다.
- 마이크 확인 완료 후 Primary action은 `리허설로 이동` 하나로 유지한다.
- 현재 슬라이드와 발표 스크립트가 주 작업이며, AI 코치는 오른쪽 340–360px 보조 panel에 둔다.
- 상단에는 현재 음성 상태, 전체 시간, 슬라이드 진행률만 노출한다.
- 실시간 코칭은 전체 진행, 말하기 속도, 핵심 키워드, 짧은 행동 조언 순으로 구성한다.
- 발표 스크립트의 감지된 키워드는 Lime highlight로 표시하고, 자동 따라가기 상태를 함께 제공한다.
- Header의 `화면 설정`은 발표 화면 선택 panel을 열며, `발표자 모드`와 `슬라이드쇼 화면`을 하나의 radiogroup으로 제공한다.
- 발표자 모드는 현재 슬라이드·다음 슬라이드·메모·타이머를 유지하고, 슬라이드쇼 화면은 발표 자료만 청중용 전체화면에 표시한다.
- 화면 선택 후에는 선택한 모드를 이름에 반영한 단일 Primary action으로 실행한다. 화면 장치 상태는 별도 summary row로 짧게 노출한다.
- Primary action은 `리허설 시작/일시정지`이고 `다시 시작`은 quiet action이다.
- 완료 시 시간·키워드·속도를 요약한 뒤 리포트로 이동한다.

### 리허설 리포트

- 리허설 종료 후에는 완료 확인, 핵심 지표, AI 한 줄 피드백을 먼저 보여주고 `리포트 확인하기`를 Primary action으로 제공한다.
- 리포트 목록은 최근 결과를 강조한 summary와 회차별 table을 함께 사용한다. 검색과 향상 회차 filter는 같은 toolbar에 둔다.
- 리포트 상세는 `종합 점수 + AI 총평`, 핵심 지표, `핵심 피드백 · 슬라이드 분석 · 발표 기록`의 3단 정보 구조를 사용한다.
- 상세 화면의 마지막 행동은 막연한 조언이 아니라 다음 연습 목표와 `다시 리허설`로 연결한다.
- 좋은 점은 Success, 개선점은 Warning, AI 분석은 Lilac/Lime surface를 사용하되 점수만으로 성공을 단정하지 않는다.
- 프로젝트 종합 리포트는 최근 점수, AI 종합 요약, 핵심 지표, 회차별 변화, 반복 강점, 다음 연습 목표, 회차별 리포트 순으로 구성한다.
- 리허설 리포트 목록의 상단 요약 카드는 프로젝트 종합 리포트의 진입점으로 사용하고, 회차별 목록 행은 개별 리포트로 연결해 정보 수준을 구분한다.
- 리포트 목록·상세·프로젝트 종합 리포트의 상단 navigation은 `홈 → 프로젝트 → 리허설 → 리포트` 순서를 유지하며 `홈`은 실제 작업 공간 `/`으로 연결한다.
- 상단 종합 리포트 카드의 Lilac 배경은 hover에도 고정하고, hover 피드백은 `종합 리포트 보기` action 안에서만 제공한다.
- 점수와 발표 시간 추세는 같은 위치에서 전환하고, 각 회차의 실제 값과 진행 수준을 함께 표시한다.

### 프로젝트 접근 요청

- 비공개 프로젝트 접근 화면은 프로젝트 맥락과 권한 요청 작업을 2열로 분리해 요청 전에 대상 프로젝트를 명확히 확인하게 한다.
- 요청 권한은 `편집 가능`과 `보기 전용` 중 하나만 선택하며, 각 권한의 결과를 짧은 설명으로 함께 제공한다.
- 단일 선택 옵션은 선택하지 않았을 때 내부를 비운 회색 테두리 원으로 표시하고, 선택했을 때만 브랜드 컬러 채움과 체크 아이콘을 사용한다.
- 요청 완료 후에는 요청 권한, 시간, 승인 상태와 처리 순서를 보여주고 `승인 여부 다시 확인`을 Primary action으로 제공한다.
- 승인 대기 상태에서도 요청 취소와 프로젝트 목록 복귀 경로를 유지한다.

### 발표자 모드

- Ink 기반 dark surface를 사용해 현재 슬라이드가 가장 밝고 큰 면이 되도록 한다.
- 현재 슬라이드, 다음 슬라이드, 발표 메모, 현재 큐, 타이머를 한 화면에 유지한다.
- 하단 command dock의 중심에는 이전·일시정지·다음 제어를 두고 화면 가리기와 전체화면은 보조 action으로 둔다.
- 연결 상태는 작은 green dot과 text로 함께 표시한다.
- Dark surface logo는 반드시 `orbit-logo-white.png` 원본을 container 없이 사용한다.
- 슬라이드 자체의 foreground color는 presenter dark theme를 상속하지 않고 각 slide theme가 명시적으로 소유한다.

### 실전 발표

- 청중용 실전 발표 화면은 Ink background 위에 현재 슬라이드를 가장 크게 두고, `LIVE`, 연결 상태, 슬라이드 이동과 전체화면만 최소 chrome으로 제공한다.
- 실전 발표자 모드는 현재·다음 슬라이드, 발표 메모, 경과 시간과 발표 종료를 한 화면에 유지한다.
- 리허설의 AI 코치와 자동 평가 정보는 실전 화면에서 제거한다. 청중 수, 질문, 발언 요청, 기록 저장은 실제 presentation session 계약이 추가되기 전까지 노출하지 않는다.
- 동기화 slide window는 정상 연결 시 슬라이드를 최우선으로 보여주고, 연결 전·실패·stale 상태에서만 복구 안내와 fallback chrome을 제공한다.
- 청중 입장 화면은 기존 access/passcode 계약만 사용하고 발표자 script, transcript, raw audio를 전달하거나 DOM에 포함하지 않는다.

### 인증

- 데스크톱 인증 화면은 ORBIT 가치 제안과 form을 2열로 분리한다. 모바일에서는 가치 제안 영역을 접고 form을 첫 화면에 우선한다.
- 로그인은 현재 인증 계약에 맞춰 이메일·비밀번호와 회원가입 전환을 제공한다. 로그인 유지와 비밀번호 찾기는 해당 API 계약이 추가된 뒤 제공한다.
- 회원가입은 현재 인증 계약에 맞춰 이메일·비밀번호를 받고 최소 비밀번호 조건을 입력 중 보여준다. 이름과 약관은 서버 계약이 추가되기 전까지 수집하지 않는다.
- 필수 입력과 서버 오류는 field 아래 Danger Soft 상태로 설명하고 사용자가 입력한 값은 유지한다.
- 비밀번호는 기본적으로 가리고, 같은 field 안의 Eye action으로 표시 상태를 전환한다.

## 현재 시스템 채택 규칙

- `apps/web/src/main.tsx`에서 token, foundation, global CSS를 순서대로 로드한다.
- 기존 화면의 `--surface-*`, `--text-*`, `--border-*`, `--action-*`, radius semantic token은 ORBIT token compatibility layer를 통해 해석한다.
- 신규 화면은 `apps/web/src/components/ui/index.ts`에서 primitive를 가져오고 `apps/web/src/styles/tokens.css`의 CSS 변수를 사용한다.
- scoped legacy stylesheet가 자체 색상 변수를 선언하는 경우에는 화면별 마이그레이션에서 제거한다. 기능 변경과 시각 마이그레이션은 분리한다.
- 디자인 시스템 source of truth는 이 문서, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/foundations.css`, `apps/web/src/components/ui`다.

## 구현 위치

- CSS tokens: `apps/web/src/styles/tokens.css`
- Global foundations: `apps/web/src/styles/foundations.css`
- Reusable primitives and component styles: `apps/web/src/components/ui`
- Public import surface: `apps/web/src/components/ui/index.ts`
- Browser preview implementation: `apps/web/src/features/design-system/RedesignSystemPage.tsx`
- Browser preview: `/design-system`
- Production public/auth: `/`, `/login`, `/signup`
- Production workspace/project: `/`, `/project`, `/createdeck`, `/project/:projectId/request`
- Production reports: `/reports`, `/reports/:projectId`, `/rehearsal/:projectId/report/:runId`
- Production editor/rehearsal: `/project/:projectId`, `/rehearsal/:projectId`
- Production presentation/audience: `/presentation/:projectId`, `/present/:deckId`, `/audience/:sessionId`
- Editor mockup: `/mockup/editor`
- Microphone permission check mockup: `/mockup/microphone-check`
- Project access request mockup: `/mockup/project-request`
- Rehearsal mockup: `/mockup/rehearsal`
- Presenter mockup: `/mockup/presenter`
- Rehearsal completion mockup: `/mockup/rehearsal-complete`
- Rehearsal report list mockup: `/mockup/reports`
- Rehearsal report detail mockup: `/mockup/report`
- Project rehearsal overview mockup: `/mockup/report-project`
- Live presentation mockup: `/mockup/live`
- Live presenter mockup: `/mockup/live-presenter`
- Login mockup: `/mockup/login`
- Signup mockup: `/mockup/signup`

새 제품 화면은 가능한 한 위 토큰과 primitive를 직접 사용한다. 기존 화면을 마이그레이션할 때는 기능 변경과 디자인 시스템 적용을 작은 PR로 분리한다.

Storybook에서 컴포넌트와 화면 상태를 추가하는 절차는
`docs/storybook-design-system.md`를 따른다.
