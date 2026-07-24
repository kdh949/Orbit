# 참여 장표 디자인 레퍼런스

이 디렉터리는 사용자가 제공한 세 장의 1672×941 PNG를 손실 없이 보관한다. 원본 QR code와 ORBIT 표기는 생성형 모델 입력의 위치·질감 참고에만 사용하며 구현 자산으로 재사용하지 않는다.

- `spotlight-reference.png`: 중앙 집중형 참여 안내
- `split-reference.png`: 밝은 질문 영역과 어두운 참여 영역의 분할형
- `editorial-reference.png`: 행사형 타이포그래피와 하단 참여 밴드
- `text-manifest.json`: 1920×1080 Deck 좌표로 정규화한 편집 텍스트와 런타임 슬롯 명세

## 구현 자산 원칙

- 텍스트는 Deck의 `text` 또는 `activity-copy` 요소로 재작성한다.
- QR과 입장 코드는 각각 `activity-qr`, `presentation-passcode` 런타임 요소를 사용한다.
- ORBIT 로고는 저장소의 공식 로고 자산만 사용한다.
- 생성형 배경에는 텍스트, 숫자, QR, logo, icon, UI card를 포함하지 않는다.
- 단순 선·프레임·아이콘은 Deck shape 또는 저장소 icon primitive로 구성한다.
