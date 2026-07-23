# 참여 장표 편집 프리셋 명세

## 목적

참여 장표의 질문·응답 계약은 유지하면서, 발표자가 참여 안내 화면의 구성을 일반 장표처럼 편집할 수 있게 한다. 실시간 투표, 사전 질문, 만족도 조사 모두 같은 디자인 프리셋을 사용하며 결과 장표의 렌더링 계약은 변경하지 않는다.

이 문서는 Product Design으로 생성한 세 시안을 1920×1080 Deck 좌표와 런타임 슬롯으로 변환한 구현 기준이다.

## 공통 원칙

- 프리셋을 적용하면 프리셋 ID가 아니라 구체적인 `slide.style`, `elements`, `activityAppearance`를 저장한다.
- 프리셋 적용 후 모든 일반 텍스트·도형·이미지는 일반 캔버스 요소처럼 이동, 크기 조절, 스타일 편집, 삭제할 수 있다.
- `activity-copy`, `activity-qr`, `presentation-passcode`는 런타임 값을 표시하는 bound element다.
- bound element도 이동, 크기 조절, 스타일 편집, 삭제할 수 있지만 바인딩 대상 자체는 inspector에서 변경하지 않는다.
- 참여 장표의 제목과 설명은 `activity-copy`를 통해 `activity.title`, `activity.description`을 표시한다.
- QR URL, QR 비트맵, 입장 코드 숫자는 Deck JSON에 저장하지 않는다.
- 결과 장표는 기존 `activity-results` 시스템 렌더러를 계속 사용하며 디자인 편집 대상에 포함하지 않는다.
- 편집 가능한 참여 장표는 16:9 wide Deck에서만 생성한다.

## 색상과 타이포그래피

프리셋은 현재 ORBIT redesign의 밝은 neutral surface와 lime accent를 따른다. Deck 요소에는 아래 값을 저장하되, 프리셋 적용 뒤 사용자가 자유롭게 바꿀 수 있다.

| 역할 | 값 |
| --- | --- |
| 기본 배경 | `#F7F7F2` |
| 기본 텍스트 | `#171917` |
| 보조 텍스트 | `#62675F` |
| 어두운 surface | `#171917` |
| 밝은 surface 텍스트 | `#F7F7F2` |
| accent | `#C7FF35` |
| 구분선 | `#C9CEC5` |
| 기본 폰트 | Deck theme의 `fontFamily` |

프리셋의 제목은 72–104px, 설명은 26–32px, eyebrow와 안내 문구는 18–22px 범위를 사용한다. 자동 맞춤은 `shrink-text`로 설정해 activity 문구가 길어져도 영역을 벗어나지 않게 한다.

## 런타임 슬롯 상태

### `activity-qr`

- editor/thumbnail: QR 형태의 안전한 placeholder와 `발표 시작 후 표시`를 표시한다.
- presentation + active session: 해당 activity 참여 URL을 QR로 렌더링한다.
- presentation + session 없음: `발표 시작 후 표시`를 표시한다.
- export: 실제 URL이나 QR을 포함하지 않고 `발표 중 QR 표시` placeholder를 표시한다.

### `presentation-passcode`

- private session: label `입장 코드`와 복호화된 4자리 코드를 표시한다.
- public session: `비밀번호 없이 바로 참여`를 표시한다.
- session 없음: `발표 시작 후 표시`를 표시한다.
- legacy hash-only session: `입장 코드를 다시 설정해 주세요`를 표시한다.
- editor/thumbnail/export: 실제 숫자를 표시하지 않고 `••••` 또는 안전한 상태 문구를 표시한다.

### `activity-copy`

- `field: "title"`은 `activity.title`을 표시한다.
- `field: "description"`은 `activity.description`을 표시한다.
- 값이 비어 있으면 element의 `fallbackText`를 표시한다.

## 프리셋

### Spotlight

질문을 중앙에 크게 배치하고 참여 수단을 화면 하단에 나란히 두는 기본 프리셋이다.

| 요소 | x | y | width | height | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| eyebrow text | 660 | 118 | 600 | 40 | `LIVE ACTIVITY` |
| activity title | 300 | 205 | 1320 | 150 | 중앙 정렬, 92px bold |
| activity description | 500 | 365 | 920 | 58 | 중앙 정렬, 30px |
| activity QR | 430 | 500 | 360 | 360 | 좌측 참여 슬롯 |
| vertical divider | 930 | 520 | 2 | 300 | 구분선 |
| passcode slot | 1040 | 535 | 470 | 270 | 우측 입장 코드 |
| footer text | 600 | 935 | 720 | 34 | `휴대폰으로 QR을 스캔해 참여해 주세요` |

배경은 `#F7F7F2`, 텍스트는 `#171917`, QR 아래 accent bar는 `#C7FF35`를 사용한다.

### Split

왼쪽은 질문, 오른쪽 dark surface는 참여 수단에 집중하는 대비형 프리셋이다.

| 요소 | x | y | width | height | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| dark panel | 1110 | 0 | 810 | 1080 | `#171917` |
| accent ellipse | -180 | 830 | 430 | 430 | `#C7FF35` 장식 |
| eyebrow text | 110 | 150 | 820 | 40 | `LIVE ACTIVITY` |
| activity title | 110 | 245 | 880 | 270 | 좌측 정렬, 88px bold |
| activity description | 110 | 570 | 840 | 110 | 30px |
| activity QR | 1320 | 145 | 360 | 360 | 우측 상단 |
| passcode slot | 1250 | 600 | 500 | 250 | 밝은 텍스트 |
| helper text | 1250 | 920 | 500 | 56 | 참여 안내 |

dark panel 안의 일반 텍스트와 runtime slot은 밝은 surface 텍스트를 사용한다.

### Editorial

큰 editorial 제목, 오른쪽 참여 카드, 하단 accent band를 조합하는 행사·키노트용 프리셋이다.

| 요소 | x | y | width | height | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| eyebrow text | 140 | 165 | 900 | 40 | `AUDIENCE CHECK-IN` |
| activity title | 140 | 275 | 900 | 280 | 좌측 정렬, 96px bold |
| accent rule | 140 | 600 | 125 | 10 | `#C7FF35` |
| activity description | 140 | 645 | 860 | 105 | 30px |
| decorative ellipse | 1460 | 50 | 540 | 540 | `#C7FF35`, 일부 crop |
| QR surface | 1240 | 135 | 520 | 445 | 밝은 surface |
| activity QR | 1310 | 175 | 380 | 380 | 오른쪽 카드 |
| passcode slot | 1240 | 620 | 520 | 170 | 테두리형 |
| bottom band | 0 | 880 | 1920 | 200 | `#C7FF35` |
| bottom helper text | 140 | 930 | 1640 | 56 | 참여 안내 |

### Essentials

장식 없이 QR과 입장 코드만 제공하는 최소 프리셋이다.

| 요소 | x | y | width | height | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| activity QR | 510 | 280 | 420 | 420 | 중앙 좌측 |
| passcode slot | 1030 | 350 | 440 | 260 | 중앙 우측 |

### Blank

`activityAppearance.mode`를 `editable`로 전환하고 `elements`를 빈 배열로 만든다. 사용자는 일반 요소와 runtime slot을 직접 추가해 처음부터 구성한다.

## 프리셋 선택 UX

- 참여 장표를 처음 만들 때 다섯 개의 카드(`Spotlight`, `Split`, `Editorial`, `Essentials`, `Blank`)를 보여준다.
- 기본 선택은 `Spotlight`다.
- 기존 system mode 참여 장표는 장표 설정에서 `디자인 편집 시작`을 눌러 선택 화면으로 진입한다.
- 이미 editable mode인 장표에서 다른 프리셋을 적용할 때는 기존 요소가 모두 대체된다는 확인을 한 번 받는다.
- bound element가 삭제된 상태에서 발표를 시작하면 비차단 경고를 보여준다.
- 요소 추가 메뉴의 `참여 요소` 그룹에서 `질문 제목`, `질문 설명`, `QR`, `입장 코드`를 다시 추가할 수 있다.

## 접근성

- 프리셋 카드와 runtime slot은 키보드로 선택할 수 있어야 한다.
- placeholder와 실제 값의 의미를 색상에만 의존하지 않는다.
- light/dark surface 모두 텍스트 대비 4.5:1 이상을 목표로 한다.
- QR 주변 quiet zone을 slot 내부에서 보장한다.
- 실제 입장 코드는 screen reader label에 포함하되 editor/thumbnail/export에서는 읽히지 않게 한다.

