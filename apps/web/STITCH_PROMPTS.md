# ORBIT Google Stitch 화면별 프롬프트

이 문서는 현재 ORBIT 웹 제품을 Google Stitch에서 화면별로 디자인하기 위한 실행용 프롬프트 모음이다. 화면과 기능의 기준은 2026-07-19의 실제 라우트, 구현 코드, [`DESIGN.md`](./DESIGN.md)다.

## 1. 사용 순서

1. Stitch 프로젝트에 [`DESIGN.md`](./DESIGN.md)를 import한다.
2. 아래 `공통 제품 컨텍스트`를 프로젝트의 첫 지시로 입력한다.
3. 한 번에 전체 제품을 요청하지 말고 `P0` 화면부터 프롬프트 하나씩 입력한다.
4. 생성된 화면에서 같은 header, button, field, card, status, dialog를 재사용하도록 요청한다.
5. 각 프롬프트의 `연결`에 적힌 화면을 prototype interaction으로 연결한다.
6. Desktop 화면은 1440×1024, Mobile 청중 화면은 390×844를 기준으로 만든다. 핵심 제품 화면은 desktop 확정 후 390×844 responsive variant를 추가한다.

Stitch는 자연어와 이미지·코드 컨텍스트를 함께 사용할 수 있으므로, 실제 화면 캡처가 있다면 `DESIGN.md`와 함께 첨부한다. 첫 결과에서 모든 변형을 해결하려 하지 말고 기본 화면을 확정한 뒤 loading, empty, error, selected, dialog 상태를 후속 지시로 추가한다.

## 2. 공통 제품 컨텍스트

아래 블록을 Stitch 프로젝트의 첫 프롬프트로 사용한다.

```text
ORBIT는 아이디어를 AI 발표자료로 만들고, 편집하고, 발표를 연습하고, 리포트로 개선하는 한국어 웹 제품이다. 주요 사용자는 발표자료를 빠르게 완성하고 실제 발표 품질까지 높이려는 직장인, 창업자, 학생이다.

이 프로젝트에 import한 DESIGN.md를 단일 시각 기준으로 사용하라. 모든 제품 문구는 자연스럽고 간결한 한국어로 작성하라. Pretendard를 사용하고, 정밀한 creative tool의 인상을 유지하라. 기본 화면은 흰색과 옅은 회색의 밝은 작업면, 얇은 회색 경계, 제한적인 그림자를 사용한다. 핵심 행동은 Electric Blue, AI·창작 맥락은 Vivid Purple, 매우 제한적인 강조만 Neon Pink를 사용한다. editor만 #131316 계열의 dark workspace를 사용한다.

4px spacing scale, 4px button/input radius, 8px card/modal radius, 12px large panel radius를 지켜라. pill은 status, avatar, timer에만 사용하라. card 안에 불필요한 card를 중첩하지 말고 spacing과 typography로 먼저 그룹을 구분하라. 한 영역의 primary action은 하나만 둔다. 장식용 gradient, 과도한 blur, glassmorphism, 거대한 둥근 카드, 임의의 삽화, emoji icon을 사용하지 말라. 아이콘은 단순한 outline icon으로 통일하라.

제품 공통 header는 높이 64px이며 ORBIT brand, 홈, 프로젝트, 리허설, 리포트 navigation, 사용자 menu를 포함한다. 현재 위치는 글자색과 하단 indicator로 함께 표시한다. editor, rehearsal, presentation처럼 몰입이 필요한 화면은 전용 shell을 사용한다.

모든 상태를 색만으로 표현하지 말고 text, icon, border를 함께 사용하라. keyboard focus가 분명해야 하고, 일반 text는 WCAG AA 대비를 확보하라. loading, empty, error, disabled, selected 상태를 고려하라. 실제 제품처럼 구체적인 한국어 예시 데이터와 문구를 사용하고 lorem ipsum은 사용하지 말라.

Desktop frame은 1440×1024를 기준으로 하되 responsive 구조를 설계하라. Mobile은 390×844, 좌우 16px 여백, 44px 이상의 touch target, full-width 주요 action을 기준으로 한다. wide table만 자신의 wrapper 안에서 수평 스크롤하고 page 자체에는 horizontal overflow가 없어야 한다.
```

## 3. 화면 지도와 우선순위

### P0 — 핵심 end-to-end flow

| 번호 | 화면 | 핵심 목적 |
| --- | --- | --- |
| 01 | 공개 랜딩 | 제품 가치 이해와 가입 전환 |
| 02 | 로그인 | 기존 작업 공간 진입 |
| 03 | 회원가입 | 신규 계정 생성 |
| 04 | 작업 공간 홈 | 최근 작업과 다음 행동 확인 |
| 05 | 프로젝트 목록 | 프로젝트 검색·정렬·관리 |
| 06 | AI 발표자료 만들기 | 발표 내용 입력과 생성 시작 |
| 07 | 스토리·스타일·색상 선택 | AI 초안의 방향 확정 |
| 08 | AI 생성 진행 | 긴 작업의 진행과 결과 안내 |
| 09 | 슬라이드 에디터 | 발표자료 편집과 AI 보조 |
| 10 | 리허설 프로젝트 선택 | 연습할 발표자료 선택 |
| 11 | 리허설 사전 점검 | 마이크와 발표 조건 확인 |
| 12 | 리허설 실행 | 슬라이드·스크립트·발화 코칭 |
| 13 | 발표 제어 화면 | 실제 발표 진행과 청중 참여 제어 |
| 14 | 전체 화면 발표 | 프로젝터에 보이는 발표 화면 |
| 15 | 청중 입장·대기 | 모바일로 세션 참여 |
| 16 | 청중 응답 | 참여형 문항 제출 |
| 17 | 리포트 목록 | 분석 가능한 프로젝트 탐색 |
| 18 | 프로젝트 리포트 개요 | 여러 리허설의 추세 파악 |
| 19 | 리허설 상세 리포트 | 한 회차의 문제와 개선점 이해 |

### P1 — 완성도를 높이는 확장 flow

| 번호 | 화면 | 핵심 목적 |
| --- | --- | --- |
| 20 | 발표 brief | 발표 목적·청중·시간 설정 |
| 21 | 버전 기록 | 버전 비교·복원 |
| 22 | 프로젝트 접근 요청 | 권한이 없는 사용자의 요청 처리 |
| 23 | 공유·권한 관리 dialog | 초대·권한·승인 요청 관리 |
| 24 | 청중 링크·QR dialog | 세션 입장 방식과 링크 공유 |
| 25 | 발표 세션 결과 | 참여 결과·주관식 응답 관리 |
| 26 | 연습 계획 | 리포트 기반 개선 계획 수립 |
| 27 | 집중 연습 | 하나의 개선 목표 반복 연습 |
| 28 | 도전 Q&A | 예상 질문 대응 연습 |

## 4. 화면별 프롬프트

각 프롬프트는 위 `공통 제품 컨텍스트`를 적용한 같은 Stitch 프로젝트에서 독립적으로 실행한다.

### 01. 공개 랜딩 — P0

```text
ORBIT 공개 랜딩 페이지의 desktop high-fidelity UI를 디자인하라. 목표는 방문자가 5초 안에 “AI 발표자료 제작부터 리허설 코칭까지 연결하는 제품”임을 이해하고 무료 시작을 선택하게 하는 것이다.

상단에는 ORBIT brand, 제품 기능 anchor navigation, 로그인, “무료로 시작하기” primary CTA를 배치한다. Hero는 “발표의 시작부터 무대까지, 하나의 흐름으로” 같은 강한 한국어 headline, 짧은 설명, primary CTA와 secondary demo CTA를 포함한다. 오른쪽 또는 아래에는 실제 제품을 압축해 보여주는 editor와 rehearsal report의 현실적인 composite preview를 사용하되 가짜 통계나 장식용 chart를 과도하게 만들지 말라.

이어지는 section은 ① AI로 초안 만들기 ② 정밀하게 편집하기 ③ 실제처럼 리허설하기 ④ 리포트로 개선하기의 4단계 흐름, editor/rehearsal/audience 참여의 대표 기능, 마지막 가입 CTA로 구성한다. 기능 나열보다 사용자가 얻게 되는 결과를 중심으로 작성한다. 넓은 editorial spacing과 명확한 type hierarchy를 사용하고 card grid를 남발하지 말라.

상태와 기능: header sticky state, CTA hover/focus, mobile에서 navigation menu가 접히는 responsive variant를 고려한다.
연결: “무료로 시작하기”→회원가입, “로그인”→로그인, “데모 보기”→작업 공간 홈 preview.
```

### 02. 로그인 — P0

```text
ORBIT 로그인 화면의 desktop high-fidelity UI를 디자인하라. 사용자가 방해 없이 기존 작업으로 돌아가는 데 집중하게 한다.

제한된 폭의 중앙 auth panel에 ORBIT brand, “다시 만나서 반가워요.” 제목, “작업하던 발표자료와 리허설 기록을 이어서 확인하세요.” 설명을 둔다. 이메일 field, 비밀번호 field, 비밀번호 표시/숨기기 icon button, 비밀번호 찾기 link, “로그인” primary gradient button을 포함한다. 하단에는 “아직 ORBIT 계정이 없나요? 회원가입” 전환 link와 저작권 문구를 둔다.

배경은 밝고 조용하게 유지하고 marketing card나 불필요한 illustration을 추가하지 말라. field label을 placeholder로 대체하지 말라. normal, keyboard focus, invalid email, wrong password, submitting disabled 상태가 모두 자연스럽게 확장되는 구조로 만든다.

연결: 성공→작업 공간 홈, 회원가입 link→회원가입, brand→공개 랜딩.
```

### 03. 회원가입 — P0

```text
ORBIT 회원가입 화면의 desktop high-fidelity UI를 디자인하라. 로그인 화면과 같은 auth system을 사용하되 신규 사용자의 첫 발표 시작 기대감을 만든다.

중앙 auth panel에 ORBIT brand, “첫 발표를 시작해 볼까요?” 제목, 계정 생성의 이점을 한 문장으로 설명한다. 이름, 이메일, 비밀번호, 비밀번호 확인 field와 표시/숨기기 control을 제공한다. 비밀번호 조건은 입력 중 간결한 checklist로 보여주고 충족 여부를 text와 icon으로 함께 표현한다. 이용약관·개인정보 동의 checkbox와 “무료로 시작하기” primary CTA를 포함한다.

하단에는 “이미 계정이 있나요? 로그인” link를 둔다. validation error는 각 field 바로 아래에 표시하고, 긴 약관 문구가 주요 행동보다 시각적으로 강해지지 않게 한다. normal, focus, validation error, submitting, success 상태를 고려한다.

연결: 성공→작업 공간 홈 또는 첫 발표 만들기, 로그인 link→로그인, brand→공개 랜딩.
```

### 04. 작업 공간 홈 — P0

```text
로그인한 사용자의 ORBIT 작업 공간 홈 desktop 화면을 디자인하라. 목표는 최근 작업 상태를 빠르게 이해하고 가장 가능성 높은 다음 행동으로 이동하는 것이다.

공통 64px product header에서 “홈”을 active로 표시한다. 본문 상단에는 “동현님, 발표를 이어서 완성해 볼까요?”처럼 사용자 이름을 포함한 제목과 짧은 설명을 둔다. 가장 눈에 띄는 primary action은 “AI로 발표자료 만들기”이며, 별도의 큰 action panel 안에 기능 설명과 함께 둔다.

“최근 작업” section은 실제 presentation thumbnail, 프로젝트 제목, 마지막 수정 시각, slide 수, 현재 상태를 포함하는 가로 card 또는 적절한 grid로 만든다. 첫 3~4개만 보여주고 “모든 프로젝트 보기” link를 제공한다. 이어서 최근 리허설 결과가 있다면 점수 대신 핵심 개선 요약과 “리포트 보기”, “다시 리허설” 행동을 보여준다.

loading skeleton, 프로젝트가 없는 empty state, API error와 “다시 시도”를 고려한다. dashboard widget를 과도하게 만들지 말고 최근 작업과 다음 행동의 우선순위를 명확히 한다.

연결: 만들기→AI 발표자료 만들기, 프로젝트 card→에디터, 리포트→리허설 상세, header navigation→각 목록.
```

### 05. 프로젝트 목록 — P0

```text
ORBIT 프로젝트 목록 desktop 화면을 디자인하라. 많은 발표자료를 빠르게 찾고 열거나 관리할 수 있어야 한다.

공통 product header에서 “프로젝트”를 active로 표시한다. page title “프로젝트”, 프로젝트 개수, “새 발표자료” primary CTA를 한 줄 hierarchy로 구성한다. 그 아래에 검색 field, 최근 수정/이름 정렬 select, grid/list view toggle을 둔다.

프로젝트 card에는 16:9 slide thumbnail, 제목, 마지막 수정 날짜, slide 수, 소유/공유 status를 표시한다. card 전체는 editor로 열리며 more menu에는 이름 바꾸기, 복제, 리허설 시작, 삭제를 둔다. 삭제는 danger dialog로 확인한다. selected filter와 keyboard focus가 분명해야 한다.

loading skeleton, 검색 결과 없음, 프로젝트 없음, 불러오기 실패 상태를 설계한다. card마다 여러 색의 CTA를 만들지 말고 thumbnail과 제목이 주 정보가 되게 한다. mobile에서는 1열 list와 compact filter로 전환한다.

연결: 새 발표자료→AI 발표자료 만들기, card→에디터, 리허설 시작→사전 점검.
```

### 06. AI 발표자료 만들기 — P0

```text
ORBIT AI 발표자료 만들기의 첫 단계 desktop 화면을 디자인하라. 사용자가 발표 의도를 충분히 입력하면서도 복잡한 설정에 압도되지 않게 한다.

공통 product header 아래에 3단계 progress indicator를 둔다: 1 내용 입력, 2 스타일 선택, 3 생성. 현재 1단계를 text, number, border로 명확하게 표시한다. 중앙 최대 760px form column에 발표 제목, 핵심 주제와 전달할 내용의 큰 textarea, 발표 대상, 발표 목적, 목표 발표 시간, 원하는 slide 수를 배치한다. 파일 또는 기존 문서 업로드는 선택 기능으로 명확히 구분한다.

오른쪽 보조 panel이 필요하다면 “좋은 입력 예시”와 개인정보 주의만 간결하게 제공한다. sticky footer 또는 form 하단에 “취소” secondary와 “다음: 스타일 선택” 하나의 primary CTA를 둔다. 자동 저장 status를 작은 text로 알린다.

required validation, 너무 짧은 내용, file upload progress/failure, submitting 상태를 설계한다. mobile에서는 완전한 1열, 하단 full-width CTA로 전환한다.

연결: 다음→스토리·스타일·색상 선택, 취소→작업 공간 홈.
```

### 07. 스토리·스타일·색상 선택 — P0

```text
AI 발표자료 생성의 두 번째 단계인 스토리·스타일·색상 선택 desktop 화면을 디자인하라. 사용자가 결과물의 방향을 시각적으로 비교하고 자신 있게 선택하게 한다.

상단 3단계 progress에서 2단계를 active로 표시한다. 본문은 “발표의 분위기를 선택하세요” 제목과 짧은 설명, 다음 세 section으로 구성한다. ① 스토리 구조: 문제-해결, 데이터 중심, 내러티브 등 3개 preview option ② visual style: 미니멀, 에디토리얼, 테크 등 4~6개 16:9 miniature preview ③ color palette: 접근성 있는 4~5개 palette swatch.

각 option은 선택 card지만 card 중첩을 피하고, selected 상태를 blue border, check icon, text로 함께 표시한다. 한 화면에서 purple과 pink가 선택 신호와 경쟁하지 않게 한다. 선택 결과의 live sample slide를 오른쪽 preview panel에 보여준다.

하단에는 “이전” secondary와 “발표자료 생성” primary CTA를 둔다. 선택 미완료, preview loading, generation request error 상태를 고려한다.

연결: 생성→AI 생성 진행, 이전→내용 입력.
```

### 08. AI 생성 진행 — P0

```text
ORBIT AI 발표자료 생성 진행 desktop 화면을 디자인하라. 수십 초 이상 걸릴 수 있는 작업에서 현재 진행 상황과 다음 결과를 신뢰할 수 있게 설명한다.

공통 header 아래 중앙 progress workspace에 프로젝트 제목과 “발표자료를 만들고 있어요”를 보여준다. 세로 또는 가로 단계 목록으로 ① 내용 구조화 ② 스토리 구성 ③ 슬라이드 디자인 ④ 품질 확인을 표시하고, 완료/진행/대기 상태를 icon, text, border로 구분한다. 현재 단계에는 짧은 설명과 determinate progress bar를 둔다.

오른쪽 또는 아래에 생성되는 slide thumbnail이 순차적으로 나타나는 preview strip을 제공한다. 사용자가 page를 떠나도 작업이 계속된다는 안내와 “프로젝트 목록으로 이동” secondary action을 둔다. 생성 완료 시 “에디터에서 열기”가 단일 primary CTA가 된다.

queued, running, succeeded, failed 상태를 각각 설계한다. failed 상태에는 실패 이유를 짧게 설명하고 “다시 시도”와 “입력 수정” recovery action을 제공한다. 의미 없는 looping decoration으로 진행을 대신하지 말라.

연결: 완료→에디터, 입력 수정→AI 발표자료 만들기, 목록→프로젝트 목록.
```

### 09. 슬라이드 에디터 — P0

```text
ORBIT 슬라이드 에디터 desktop high-fidelity UI를 디자인하라. 이 화면만 dark theme를 사용하며, 전문적인 creative tool처럼 고밀도이지만 현재 slide와 핵심 편집 행동이 가장 분명해야 한다.

전체 viewport shell은 상단 tool bar, 왼쪽 slide rail, 중앙 16:9 canvas, 오른쪽 inspector, 하단 speaker notes 영역으로 구성한다. 상단에는 ORBIT/back, 프로젝트 제목과 저장 상태, undo/redo, 공유, 리허설, 발표 primary action을 둔다. slide rail에는 순서 번호, thumbnail, 선택 outline, 새 slide 추가, drag reorder를 제공한다.

중앙 canvas는 충분한 여백과 zoom controls를 갖고 text, image, shape, chart, activity object의 선택 box와 alignment guide를 지원한다. 오른쪽 inspector는 선택 대상에 따라 design/text/layout/AI 속성을 보여준다. 빈 선택 상태에서는 deck theme와 slide layout을 보여준다. speaker notes에는 글자 수 또는 권장 시간, “AI로 다듬기”를 제공한다.

왼쪽 또는 상단의 insert control에서 text, image, shape, chart, 청중 참여 장표를 추가할 수 있어야 한다. AI assistant는 보조 panel로 배치하고 primary editing canvas를 가리지 않게 한다. 저장 중/저장 완료/저장 실패, 공동 편집자 presence, readonly, object selected, dialog open 상태를 고려한다.

mobile 390px에서는 좁은 slide rail, canvas 중심, inspector bottom sheet로 전환하고 기능을 임의로 삭제하지 말라.

연결: 리허설→사전 점검, 발표→발표 제어, 공유→공유 dialog, history→버전 기록.
```

### 10. 리허설 프로젝트 선택 — P0

```text
ORBIT 리허설 프로젝트 선택 desktop 화면을 디자인하라. 사용자가 연습할 발표자료를 빠르게 골라 사전 점검으로 이동하게 한다.

공통 product header에서 “리허설”을 active로 표시한다. “어떤 발표를 연습할까요?” 제목과 발표자료를 선택하면 마이크 점검 후 리허설이 시작된다는 설명을 둔다. 검색과 최근 수정 정렬을 제공한다.

프로젝트 item에는 16:9 thumbnail, 제목, slide 수, 예상 발표 시간, 마지막 리허설 시각과 최근 개선 status를 표시한다. card의 가장 중요한 행동은 “리허설 시작”이며, editor 열기는 quiet link로 낮춘다. 최근 연습한 프로젝트를 위에 배치하되 별도의 dashboard로 복잡하게 만들지 않는다.

리허설 가능한 프로젝트 없음, 검색 결과 없음, loading, error 상태를 포함한다. mobile은 1열 list로 만든다.

연결: 리허설 시작→리허설 사전 점검, editor 열기→에디터.
```

### 11. 리허설 사전 점검 — P0

```text
ORBIT 리허설 사전 점검 desktop 화면을 디자인하라. 마이크 권한, 입력 장치, 발표 시간 같은 필수 조건을 확인하고 사용자가 안심하고 시작하게 한다.

몰입형 light shell의 상단에는 back, 프로젝트 제목, “리허설 준비” status를 둔다. 중앙 왼쪽에는 선택한 첫 slide preview와 slide 수·예상 시간, 오른쪽에는 순서가 있는 check panel을 둔다: ① 마이크 권한 ② 입력 장치 선택 ③ 실시간 음량 meter와 테스트 녹음 ④ 발표 목표 시간 확인.

각 항목은 확인 전, 확인 중, 통과, 경고, 실패 상태를 icon과 명확한 문구로 표시한다. microphone selector, live level meter, “테스트 녹음”, “다시 확인” control을 제공한다. 하단의 “리허설 시작” primary CTA는 필수 조건을 충족하기 전 disabled이며 이유를 설명한다.

권한 거부 시 browser 설정에서 허용하는 짧은 복구 안내를 보여주고, 장치 없음·입력 너무 작음 상태도 설계한다. 기술적인 모델명이나 내부 오류를 사용자에게 그대로 노출하지 말라.

연결: 시작→리허설 실행, back→리허설 프로젝트 선택.
```

### 12. 리허설 실행 — P0

```text
ORBIT 실시간 리허설 workspace desktop 화면을 디자인하라. 사용자가 slide와 발표 흐름에 집중하면서 시간, script, 핵심 메시지 누락 여부를 즉시 확인할 수 있어야 한다.

전체 viewport light shell에 중앙의 큰 16:9 current slide stage를 배치한다. 왼쪽에는 compact slide thumbnail rail, 오른쪽 coaching panel에는 현재 slide의 speaker notes, 반드시 말할 핵심 cue, 실시간 cue 충족 status를 둔다. 상단에는 프로젝트 제목, 녹음 status, elapsed/target timer, 연결 status를 표시한다.

하단 central controls에는 이전/다음 slide, 일시정지/계속, “리허설 종료” danger-secondary 행동을 둔다. 현재 slide number와 진행률을 명확히 표시한다. 실시간 feedback은 발표를 방해하지 않는 낮은 시각 강도로 제공하고, 오류·누락만 경고 색을 사용한다.

상태: 준비 중, recording, paused, speech recognition reconnecting, microphone error, finishing analysis. 종료 시 분석이 진행된다는 confirmation dialog를 제공한다. keyboard shortcut hint와 visible focus를 포함한다.

연결: 종료→분석 중 상태 후 리허설 상세 리포트, slide navigation→동일 workspace state.
```

### 13. 발표 제어 화면 — P0

```text
ORBIT 실제 발표용 presenter control desktop 화면을 디자인하라. 발표자는 현재 slide, 다음 slide, script, timer, 청중 참여 상태를 한눈에 보며 프로젝터 화면을 제어해야 한다.

전용 dark 또는 고대비 shell을 사용한다. 가장 큰 영역에 current slide, 오른쪽 위에 next slide preview, 오른쪽 아래에 speaker notes와 현재 slide 핵심 메시지를 배치한다. 상단에는 presentation live status, 연결된 audience 수, session code, 현재 시각을 표시한다. 하단에는 이전/다음, blackout, timer start/pause, presentation end control을 둔다.

참여형 slide일 때는 오른쪽 panel이 청중 응답 제어로 바뀐다: 입장 QR 열기, 응답 시작, 실시간 응답 수, 응답 마감, 결과 공개. “응답 마감”과 “결과 공개”는 순서가 분명해야 하며 잘못된 상태의 action은 disabled한다.

projector disconnected, audience session waiting/live/ended, timer running/paused 상태를 설계한다. controls는 빠르게 찾을 수 있게 하되 slide보다 시각적으로 강해지지 않게 한다.

연결: 발표 시작→전체 화면 발표, QR→청중 링크 dialog, 결과 보기→발표 세션 결과, 종료→에디터 또는 결과 요약.
```

### 14. 전체 화면 발표 — P0

```text
ORBIT의 프로젝터용 전체 화면 발표 UI를 디자인하라. 화면에는 slide content가 절대적인 주인공이어야 하며 발표자 전용 script나 내부 control은 노출하지 않는다.

16:9 viewport에 현재 slide를 edge-to-edge로 렌더링한다. 일반 slide에서는 cursor movement 또는 keyboard interaction 때만 매우 작은 navigation affordance가 나타나고 곧 사라지게 한다. 참여형 slide에서는 문항 제목, QR code, 짧은 session code, 참여 인원, 응답 대기/진행/마감/공개 결과 상태를 slide 디자인과 조화롭게 보여준다.

연결 끊김 같은 시스템 상태는 화면 모서리의 작은 status로만 표시한다. 발표자 script, raw audio, email, 내부 ID, debug 정보는 절대 표시하지 않는다. reduced motion과 projector 대비를 고려한다.

연결: presenter의 다음/이전 동작에 따라 slide state 변경, 참여 결과 공개 시 결과 visualization state로 전환.
```

### 15. 청중 입장·대기 — P0, Mobile first

```text
ORBIT 청중 세션 입장 및 대기 화면을 390×844 mobile high-fidelity UI로 디자인하라. 청중이 QR을 스캔한 뒤 설명 없이도 10초 안에 참여를 완료해야 한다.

상단에는 compact ORBIT brand와 “발표 참여”만 둔다. 중앙 single panel에 발표 제목, 발표자 또는 세션 이름, 입장 안내를 표시한다. 세션이 passcode 방식이면 4자리 code input을 큰 touch target으로 제공하고 “참여하기” full-width primary button을 둔다. 공개 입장이면 이름 입력 없이 바로 참여할 수 있게 한다.

입장 후에는 “참여가 완료되었어요”와 현재 참여 인원, “발표자가 첫 문항을 열면 자동으로 표시됩니다” 대기 안내를 보여준다. loading, 잘못된 code, 종료된 세션, 네트워크 재연결, 다음 문항 대기 상태를 같은 shell 안에서 설계한다.

한 손 조작, safe area, 16px side padding, 44px 이상 touch target을 지키고 작은 QR을 다시 보여주거나 desktop navigation을 넣지 말라.

연결: 참여 성공→청중 응답 또는 대기, 새 activity open→청중 응답.
```

### 16. 청중 응답 — P0, Mobile first

```text
ORBIT 청중 참여 문항 응답 화면을 390×844 mobile high-fidelity UI로 디자인하라. 사용자가 현재 질문을 읽고 실수 없이 빠르게 제출해야 한다.

상단 compact bar에 발표 제목과 “문항 1/3” progress를 둔다. 본문에는 질문 제목, 선택적인 설명, 응답 상태를 배치한다. 단일 선택은 큰 radio card, 복수 선택은 checkbox card, 척도는 1~5의 명확한 label, 주관식은 글자 수가 보이는 textarea를 사용한다. 선택 card는 색뿐 아니라 icon과 border로 selected 상태를 표시한다.

하단에는 safe area를 고려한 sticky “응답 제출” full-width primary button을 둔다. 제출 중 disabled, 필수 문항 미응답, 저장 실패와 다시 시도, 이미 마감된 상태를 설계한다. 제출 후에는 “응답이 저장되었습니다”, 수정본 번호, “응답 수정” action을 보여주는 receipt state로 전환한다.

발표자가 새 문항을 열었을 때 현재 작성 중인 응답을 버리지 않고 “계속 작성 / 새 문항으로 이동” 선택을 제공한다.

연결: 제출→receipt, 수정→form, 새 문항→next activity.
```

### 17. 리포트 목록 — P0

```text
ORBIT 리포트 목록 desktop 화면을 디자인하라. 사용자가 분석할 프로젝트와 최신 리허설 결과를 빠르게 찾게 한다.

공통 product header에서 “리포트”를 active로 표시한다. page title “리포트”, 전체 리허설 개요 문구, 프로젝트 검색과 최근 리허설/개선 필요/이름 정렬 filter를 둔다.

프로젝트별 row 또는 card에는 16:9 thumbnail, 프로젝트명, 리허설 횟수, 최근 리허설 날짜, 목표 시간 대비 발표 시간, 핵심 개선 항목 1개, 이전 회차 대비 변화 status를 보여준다. “프로젝트 리포트 보기”가 주 행동이며 “다시 리허설”은 secondary다. 점수 하나로 발표 품질 전체를 단순화하지 말라.

리허설 기록 없음, 검색 결과 없음, loading, error 상태를 제공한다. 여러 chart를 목록에 넣지 말고 비교 가능한 핵심 metadata만 사용한다.

연결: project item→프로젝트 리포트 개요, 최근 회차→리허설 상세, 다시 리허설→사전 점검.
```

### 18. 프로젝트 리포트 개요 — P0

```text
ORBIT 프로젝트 리허설 리포트 개요 desktop dashboard를 디자인하라. 여러 회차의 변화와 다음 개선 행동을 한 화면에서 이해하게 한다.

공통 header 아래 breadcrumb “리포트 / 프로젝트명”, 프로젝트 제목, “다시 리허설” primary CTA를 둔다. 상단 summary에는 최근 발표 시간, 말 속도, 불필요한 표현, 긴 침묵 등 4개 핵심 metric을 보여주되 각 값에 정의와 이전 회차 변화 label을 포함한다.

본문은 ① 회차별 발표 시간·말 속도 추세 chart ② 가장 반복되는 개선 항목 ③ slide별 개선이 필요한 위치 ④ 리허설 history table 순서로 구성한다. history row에는 회차, 날짜, 시간, 주요 상태, 상세 보기 action을 둔다. chart는 legend와 직접 label을 제공하고 색만으로 series를 구분하지 않는다.

데이터 1회만 존재, 부분 분석, 분석 실패, 기록 없음 상태를 설계한다. dashboard를 작은 card로 지나치게 분할하지 말고 section 단위의 넓은 surface와 clear hierarchy를 사용한다.

연결: 회차→리허설 상세, 개선 계획 만들기→연습 계획, 다시 리허설→사전 점검.
```

### 19. 리허설 상세 리포트 — P0

```text
ORBIT 한 회차 리허설 상세 리포트 desktop 화면을 디자인하라. 사용자가 분석 결과를 이해하고 구체적인 다음 연습으로 이동하게 한다.

상단 hero에는 “3회차 리허설 리포트”, 생성 시각, AI 코칭 완료 status, “다시 리허설” primary CTA를 둔다. 그 아래 분석 tab은 종합 분석, 전달 내용, 발화 분석처럼 명확히 구분한다.

종합 분석에는 발표 시간, 평균 말 속도, 불필요한 표현, 긴 침묵의 metric과 이전 회차 대비를 보여준다. 이어서 AI 핵심 요약, 잘한 점, 먼저 개선할 점을 우선순위 순으로 제공한다. 발화 분석에는 시간축 기반 음량·속도 변화, 긴 침묵 구간, 해당 구간 재생 control을 둔다. 전달 내용에는 slide별 핵심 메시지 충족 여부와 개선 문장을 제공한다.

발표 전사본은 기본 접힘 상태로 두고, 사용자에게 불필요한 raw internal data는 노출하지 않는다. 분석 불가 metric은 0으로 표시하지 말고 “측정되지 않음”과 이유를 설명한다. 하단에 “연습 계획 만들기” primary와 “도전 Q&A” secondary action을 둔다.

연결: 계획→연습 계획, Q&A→도전 Q&A, slide 분석 item→해당 slide detail, 다시 리허설→사전 점검.
```

### 20. 발표 brief — P1

```text
ORBIT 발표 brief 설정 desktop 화면을 디자인하라. editor와 rehearsal의 AI 기능이 사용할 발표 맥락을 사용자가 짧은 시간 안에 정리하게 한다.

공통 또는 editor-adjacent light shell에 breadcrumb, “발표 brief” 제목, 저장 status를 둔다. 중앙 form은 발표 목적, 핵심 청중, 청중이 이미 아는 것, 반드시 남겨야 할 핵심 메시지, 발표 시간, tone을 포함한다. 핵심 메시지는 최대 3개까지 추가·삭제·순서 변경 가능한 list input으로 만든다.

오른쪽에는 이 정보가 AI slide 생성, speaker notes, rehearsal cue에 어떻게 쓰이는지 간결한 설명을 제공한다. 하단에 “취소”와 “저장” primary action을 둔다. unsaved changes dialog, validation, saving, saved, save error 상태를 설계한다.

연결: 저장→에디터, 취소→에디터.
```

### 21. 버전 기록 — P1

```text
ORBIT 발표자료 버전 기록 desktop 화면을 디자인하라. 사용자가 변경 이력을 이해하고 안전하게 이전 버전을 미리 보거나 복원하게 한다.

상단에 back to editor, 프로젝트 제목, “버전 기록”을 둔다. 왼쪽 timeline/list에는 버전 시각, 작성자, 변경 요약, 현재 버전 status를 표시한다. 오른쪽 detail에는 선택 버전의 slide thumbnail grid, 변경된 slide 수, 생성 원인(자동 저장, AI 생성, 수동 snapshot)을 보여준다.

주요 action은 “이 버전 미리보기”, secondary는 “현재 버전과 비교”, 복원은 별도의 경고 action이다. 복원 dialog에서 현재 상태가 새 버전으로 보존된다는 점과 대상 시각을 명확히 설명한다. current version은 복원할 수 없게 한다.

loading, version 없음, preview error, restore in progress/success/failure 상태를 설계한다.

연결: back→에디터, 복원 완료→에디터의 새 버전, compare→split preview state.
```

### 22. 프로젝트 접근 요청 — P1

```text
공유 링크로 들어왔지만 권한이 없는 사용자를 위한 ORBIT 프로젝트 접근 요청 화면을 디자인하라.

밝은 중앙 single panel에 ORBIT brand, 프로젝트 제목과 소유자 정보, 잠금 icon, “이 프로젝트에 접근 권한이 필요합니다” 제목을 둔다. 현재 로그인 email과 요청할 권한 “보기 전용 / 편집 가능” 선택, 선택적인 짧은 메시지 field, “접근 요청 보내기” primary CTA를 제공한다.

요청 전, 전송 중, 요청 완료, 이미 대기 중, 거절됨, 링크 만료 상태를 같은 구조에서 설계한다. 완료 상태에는 소유자가 승인하면 알림을 받는다는 설명과 “내 프로젝트로 이동” secondary action을 둔다. 로그인하지 않은 경우 로그인 CTA가 먼저 보여야 한다.

연결: 요청→대기 완료 state, 로그인→로그인, 내 프로젝트→프로젝트 목록.
```

### 23. 공유·권한 관리 dialog — P1

```text
ORBIT editor 위에 열리는 “프로젝트 공유” desktop modal dialog를 디자인하라. 배경 editor는 dark하고 modal은 읽기 쉬운 light surface로 떠 있어야 한다.

dialog header에 제목, “사용자를 초대하고 프로젝트 접근 요청을 관리합니다” 설명, close icon을 둔다. tab은 “함께 작업 중 N”과 “승인 요청 N” 두 개다. 첫 tab 상단에는 email input, 보기 전용/편집 가능 role select, “초대” button을 한 줄로 구성한다. 아래 참여자 list에는 avatar/initial, 이름, email, role select, 권한 회수 icon을 둔다. 소유자 role은 변경할 수 없게 한다.

승인 요청 tab에는 요청자, 요청 권한, 메시지, 요청 시각, “승인”과 “거절”을 제공한다. empty, loading, email invalid, invite success/error, remove confirmation 상태를 설계한다. keyboard focus trap과 close 후 trigger focus return을 고려한다.

연결: 초대/승인/거절→동일 dialog updated state, 닫기→에디터.
```

### 24. 청중 링크·QR dialog — P1

```text
ORBIT editor 또는 presenter 위에 열리는 청중 링크·QR 설정 dialog를 디자인하라. 발표자가 세션을 만들고 입장 방식을 정한 뒤 링크를 쉽게 공유하게 한다.

dialog 상단에는 “청중 참여 링크”, 현재 세션 status “시작 대기 / 입장 열림 / 종료”를 둔다. 본문 왼쪽에는 충분히 큰 QR code, 오른쪽에는 short URL과 copy button, 4자리 session code를 표시한다. 입장 방식은 “링크만 있으면 참여”와 “4자리 code 필요” radio option으로 제공한다.

하단에는 “입장 열기” primary action, “새 세션 만들기” 또는 “세션 종료” secondary/danger action을 상태에 따라 보여준다. connected audience count와 URL 복사 성공 toast를 포함한다. 세션 생성 중, QR loading 실패, 이미 종료됨 상태를 설계한다.

연결: 입장 열기→live state, 결과 보기→발표 세션 결과, 닫기→editor/presenter.
```

### 25. 발표 세션 결과 — P1

```text
ORBIT 발표 세션의 청중 참여 결과와 moderation을 관리하는 desktop 화면을 디자인하라.

상단에는 breadcrumb, “발표 세션 결과”, 세션 날짜·참여자 수, refresh, session delete danger action을 둔다. 본문은 3-column 성격의 구조로 왼쪽 세션 archive list, 중앙 참여 장표 list, 오른쪽 선택 결과 detail을 사용하되 1024px 이하에서는 순차 layout으로 전환한다.

결과 detail에는 문항 제목, 응답 수·응답률, 객관식 bar chart 또는 척도 distribution, 주관식 원문 list를 표시한다. 주관식 각 항목에는 승인, 숨김, 삭제 moderation control과 현재 공개 status를 둔다. 공개 가능한 결과 preview도 제공한다.

결과 없음, 아직 진행 중, refresh error, 삭제 confirmation, moderation in progress 상태를 설계한다. 개인정보나 audience identifier를 불필요하게 노출하지 않는다.

연결: session 선택→detail 변경, 공개→전체 화면 발표의 결과 state, 삭제→다른 session 또는 empty state.
```

### 26. 연습 계획 — P1

```text
ORBIT 리허설 리포트를 바탕으로 만드는 개인 연습 계획 desktop 화면을 디자인하라. 사용자가 개선 항목을 행동 가능한 짧은 연습으로 바꾸게 한다.

상단에는 프로젝트명, 기준 리허설 회차, “연습 계획” 제목을 둔다. 첫 section에 AI가 제안한 우선순위 목표 3개를 보여준다. 각 목표는 문제 설명, 근거 metric 또는 slide, 성공 기준, 예상 연습 시간, 난이도를 포함한다. 사용자는 목표 선택, 순서 변경, 삭제, 직접 목표 추가를 할 수 있다.

오른쪽 summary에는 총 예상 시간과 선택된 목표 수를 보여준다. 하단 primary action은 “계획 시작”, secondary는 “나중에 저장”이다. 자동 저장, 목표 없음, AI 제안 loading/error, custom goal validation 상태를 설계한다.

한 goal 안에 또 여러 card를 중첩하지 말고 heading, divider, spacing으로 정보를 묶는다.

연결: 계획 시작→집중 연습의 첫 목표, 저장→프로젝트 리포트 개요.
```

### 27. 집중 연습 — P1

```text
ORBIT 집중 연습 desktop 화면을 디자인하라. 전체 발표가 아니라 하나의 개선 목표와 특정 slide 구간을 반복 연습하게 한다.

몰입형 workspace에서 상단에는 “목표 1/3”, 목표 문장, 성공 기준, 진행률을 표시한다. 중앙 왼쪽에는 대상 slide preview와 필요한 경우 이전/다음 context slide, 오른쪽에는 연습 지시, 핵심 cue, 실시간 발화 상태를 둔다. 하단에는 microphone 상태, timer, “연습 시작/중지” primary control, “이번 시도 건너뛰기” quiet action을 제공한다.

한 번의 시도가 끝나면 동일 화면 안에서 결과 panel로 전환해 시간, 말 속도, cue 충족, 짧은 coaching feedback, “다시 연습”과 “다음 목표”를 보여준다. 시도 기록은 최근 3회 trend만 간결하게 표시한다.

마이크 권한, recording, analyzing, success, retry recommended, network error 상태를 설계한다. 실시간 feedback가 사용자의 시선을 slide에서 빼앗지 않게 한다.

연결: 다음 목표→다음 focused practice state, 완료→연습 계획 완료 summary 또는 프로젝트 리포트.
```

### 28. 도전 Q&A — P1

```text
ORBIT 도전 Q&A 연습 desktop 화면을 디자인하라. 발표 내용에 기반한 까다로운 예상 질문에 답하고 AI feedback을 받는 대화형 연습 경험이다.

상단에는 프로젝트명, “도전 Q&A”, 남은 질문 수와 종료 action을 둔다. 중앙 conversation workspace에 AI 질문을 큰 질문 card가 아니라 명확한 heading block으로 보여주고, 관련 slide thumbnail과 질문 의도를 작은 supporting panel에 표시한다. 사용자는 microphone으로 답하거나 textarea로 입력할 수 있다.

답변 제출 후에는 구조, 근거, 간결성 관점의 짧은 feedback과 놓친 핵심 point를 보여준다. “더 나은 답변 예시”는 기본 접힘으로 두고, “다시 답하기” secondary와 “다음 질문” primary를 제공한다. 질문 난이도는 basic/challenging/follow-up status로 표현한다.

listening, transcribing, evaluating, microphone denied, answer too short, final summary 상태를 설계한다. 대화형 제품이지만 messenger bubble UI를 무조건 사용하지 말고 발표 훈련에 맞는 집중 layout을 사용한다.

연결: 다음 질문→new question state, 종료→Q&A summary 후 리허설 상세 리포트.
```

## 5. 화면 생성 후 공통 refinement 프롬프트

### Responsive variant

```text
이 desktop 화면을 ORBIT DESIGN.md를 유지한 채 390×844 mobile 화면으로 재구성하라. 단순 축소하지 말고 정보 우선순위를 보존하라. product header는 brand/account와 navigation의 2행 구조로 전환하고, 다열 layout은 의미 순서에 맞는 1열로 바꾼다. primary action은 가능한 경우 full-width, modal은 bottom sheet로 전환한다. page-level horizontal overflow가 없어야 하며 넓은 table만 자체 wrapper에서 scroll한다. 기능을 임의로 제거하지 말고 secondary panel은 tabs, accordion 또는 bottom sheet로 재배치한다.
```

### Loading·empty·error states

```text
이 화면의 기존 layout과 design system을 유지하면서 세 가지 추가 state frame을 만들어라: loading, empty, recoverable error. Loading은 무엇을 준비하는지 설명하는 skeleton 또는 progress를 사용한다. Empty는 상태 원인과 가능한 다음 행동 하나를 제공한다. Error는 짧은 원인 설명과 “다시 시도” 또는 안전한 이전 화면 action을 제공한다. 색만으로 상태를 표현하지 말고 text와 icon을 함께 사용한다.
```

### Accessibility review

```text
이 화면을 접근성 관점에서 수정하라. body text와 control의 WCAG AA 대비, 44px mobile touch target, visible keyboard focus, label이 있는 field, 색 이외의 selected/error/status 신호, 논리적인 heading order를 보장한다. icon-only button에는 구체적인 accessible name이 있다고 가정할 수 있게 tooltip 또는 명확한 interaction description을 추가한다. 시각적 개성은 유지하되 정보 이해를 방해하는 motion과 장식을 줄인다.
```

### Prototype connection

```text
현재 ORBIT project canvas의 관련 화면들을 하나의 prototype flow로 연결하라. primary CTA, back, card open, tab, dialog open/close, form submit, next/previous, retry가 실제로 이동하거나 state를 바꾸게 한다. destructive action은 confirmation을 거치고, modal close 후 이전 trigger로 돌아가는 흐름을 유지한다. dead-end 화면을 만들지 말고 각 success, empty, error 상태에 다음 행동을 제공한다.
```

## 6. 권장 제작 순서

처음부터 28개 화면을 동시에 만들기보다 다음 순서로 품질을 고정한다.

1. `04 홈 → 06 내용 입력 → 07 스타일 선택 → 08 생성 → 09 에디터`
2. `10 리허설 선택 → 11 사전 점검 → 12 리허설 → 19 상세 리포트`
3. `13 발표 제어 → 14 전체 화면 발표 → 15 청중 입장 → 16 청중 응답 → 25 세션 결과`
4. `17 리포트 목록 → 18 프로젝트 개요 → 26 연습 계획 → 27 집중 연습 → 28 도전 Q&A`
5. 공개·인증과 공유·버전·권한 화면을 같은 component language로 보완한다.

각 묶음의 첫 화면에서 visual language를 확정하고, 이후 화면에는 “현재 canvas의 ORBIT component와 spacing을 그대로 재사용하라”는 후속 지시를 붙인다.
