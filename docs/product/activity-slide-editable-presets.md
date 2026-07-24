# 참여 장표 편집 프리셋 명세

## 목적

참여 장표의 질문·응답 계약은 유지하면서, 발표자가 참여 안내 화면의 구성을 일반 장표처럼 편집할 수 있게 한다. 실시간 투표, 사전 질문, 만족도 조사 모두 같은 디자인 프리셋을 사용하며 결과 장표의 렌더링 계약은 변경하지 않는다.

이 문서는 Product Design으로 생성한 세 시안을 1920×1080 Deck 좌표와 런타임 슬롯으로 변환한 구현 기준이다. 2026-07-24 품질 보강의 원본 PNG와 전체 텍스트 bbox는 `docs/product/references/activity-slide-templates`를 기준으로 하며, 이 문서의 프리셋 표는 실제 구현 좌표를 기록한다.

## 공통 원칙

- 프리셋을 적용하면 프리셋 ID가 아니라 구체적인 `slide.style`, `elements`, `activityAppearance`를 저장한다.
- 프리셋 적용 후 모든 일반 텍스트·도형·이미지는 일반 캔버스 요소처럼 이동, 크기 조절, 스타일 편집, 삭제할 수 있다.
- `activity-copy`, `activity-qr`, `presentation-passcode`는 런타임 값을 표시하는 bound element다.
- bound element도 이동, 크기 조절, 스타일 편집, 삭제할 수 있지만 바인딩 대상 자체는 inspector에서 변경하지 않는다.
- 참여 장표의 제목과 설명은 `activity-copy`를 통해 `activity.title`, `activity.description`을 표시한다.
- 제목 입력은 두 줄 textarea를 사용해 레퍼런스처럼 사용자가 명시적인 줄바꿈을 저장할 수 있다.
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
| eyebrow text | 830 | 187 | 261 | 32 | `LIVE ACTIVITY`, 중앙 정렬 |
| accent rule | 892 | 247 | 136 | 6 | lime–blue gradient shape |
| activity title | 400 | 298 | 1120 | 116 | 중앙 정렬, 76px bold |
| activity description | 620 | 430 | 680 | 58 | 중앙 정렬, 34px |
| QR surface | 489 | 538 | 342 | 342 | 흰색 카드 |
| activity QR | 508 | 557 | 304 | 304 | 좌측 runtime slot |
| vertical divider | 914 | 542 | 2 | 334 | 구분선 |
| passcode label | 1102 | 571 | 235 | 58 | lime pill |
| passcode slot | 992 | 664 | 453 | 125 | 흰색 runtime slot |
| passcode helper | 1077 | 830 | 345 | 28 | 발표 시작 안내 |
| ORBIT logo | 588 | 962 | 120 | 52 | 저장소 투명 logo |
| footer text | 766 | 975 | 600 | 40 | 참여 방법 안내 |

배경은 ImageGen edit mode로 전경을 제거한 `/activity-presets/spotlight-background.png`를 `stretch`로 사용한다. QR, logo, text, passcode dot는 배경 PNG에 포함하지 않는다.

### Split

왼쪽은 질문, 오른쪽 dark surface는 참여 수단에 집중하는 대비형 프리셋이다.

| 요소 | x | y | width | height | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| eyebrow text | 112 | 264 | 268 | 33 | `LIVE ACTIVITY` |
| activity title | 111 | 343 | 926 | 228 | 좌측 정렬, 76px bold |
| activity description | 112 | 622 | 610 | 48 | 34px |
| QR surface | 1313 | 195 | 407 | 407 | 흰색 카드 |
| activity QR | 1343 | 225 | 347 | 347 | 우측 상단 runtime slot |
| passcode label | 1427 | 682 | 168 | 54 | 밝은 텍스트 |
| passcode slot | 1267 | 760 | 497 | 130 | lime code, dark card |

좌우 surface, 우하단의 dark texture, 좌하단 orbit glow는 `/activity-presets/split-background.png`에만 포함한다. dark surface 위 runtime slot은 밝은 label과 lime code를 사용한다.

### Editorial

큰 editorial 제목, 오른쪽 참여 카드, 하단 accent band를 조합하는 행사·키노트용 프리셋이다.

| 요소 | x | y | width | height | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| ORBIT logo | 64 | 42 | 164 | 72 | 저장소 투명 logo |
| eyebrow text | 142 | 279 | 491 | 29 | `AUDIENCE PARTICIPATION` |
| activity title | 139 | 344 | 833 | 263 | 좌측 정렬, 92px bold |
| accent rule | 142 | 662 | 98 | 10 | lime shape |
| activity description | 142 | 715 | 649 | 47 | 34px |
| QR surface | 1251 | 243 | 522 | 411 | 밝은 surface |
| activity QR | 1361 | 297 | 302 | 302 | 오른쪽 runtime slot |
| passcode surface | 1251 | 673 | 522 | 128 | 밝은 surface |
| passcode label | 1301 | 718 | 133 | 36 | 좌측 label |
| passcode slot | 1520 | 689 | 220 | 96 | 우측 runtime slot |
| message icon | 171 | 959 | 52 | 52 | Tabler SVG |
| primary footer text | 278 | 969 | 822 | 46 | 참여 유형 안내 |
| footer divider | 1225 | 952 | 1 | 76 | 구분선 |
| clock icon | 1325 | 959 | 54 | 54 | Tabler SVG |
| secondary footer text | 1405 | 976 | 377 | 33 | 참여 가능 시점 |

우상단 halo와 하단 lime band는 `/activity-presets/editorial-background.png`에 포함한다. message와 clock은 `@tabler/icons` SVG 원본이며 각각 256×256 PNG preview를 함께 보관한다.

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
