# ORBIT README 이미지 명세

## 목적

이 문서는 루트 `README.md`에 사용할 제품 이미지를 일관된 품질로 캡처하고 교체하기 위한 기준이다. README 이미지는 기능 증빙이 아니라 첫 방문자가 ORBIT의 제품 흐름을 빠르게 이해하도록 돕는 제품 소개 자산이다.

시각 기준은 [ORBIT Design System](orbit-design-system.md), Demo 데이터 기준은 [Demo ID 기준](demo-standards.md)을 따른다.

## 저장 위치와 형식

- 최종 자산은 `docs/assets/readme/`에 저장한다.
- 파일 이름은 화면 역할을 설명하는 영문 kebab-case를 사용한다.
- README에 삽입하는 이미지에는 화면과 목적을 설명하는 한국어 `alt`를 제공한다.
- 브라우저 원본 캡처는 JPEG로 저장하며 애니메이션 GIF는 사용하지 않는다.
- 원본 비율을 임의로 늘리거나 서로 다른 viewport의 화면을 한 이미지 안에 혼합하지 않는다.
- 최종 export는 sRGB로 만들고, GitHub에서 빠르게 로드되도록 각 파일을 가급적 800KB 이하로 유지한다.

## 필수 자산

| 파일                     | 크기와 비율                 | 내용                                  | README 위치     |
| ------------------------ | --------------------------- | ------------------------------------- | --------------- |
| `orbit-product-hero.jpg` | 1440×810, 16:9              | 최근 프로젝트와 빠른 시작이 보이는 홈 | badge 바로 아래 |
| `orbit-create-flow.jpg`  | 1440×900 viewport, 약 16:10 | 입력이 완료된 AI 생성 Brief           | 제품 둘러보기   |
| `orbit-editor.jpg`       | 1440×900 viewport, 16:10    | 내용이 채워진 Deck 에디터             | 제품 둘러보기   |
| `orbit-rehearsal.jpg`    | 1440×900 viewport, 16:10    | 진행 중인 리허설과 발표 코칭 정보     | 제품 둘러보기   |
| `orbit-report.jpg`       | 1440×900 viewport, 약 16:10 | 다음 연습 목표와 리허설 분석          | 제품 둘러보기   |

모든 자산은 동일한 Demo 시나리오의 실제 production route에서 캡처한다. 화면 자체를 다시 그리거나 QA baseline을 재사용하지 않는다. Canvas 배경은 `Surface` 또는 `Canvas`, 강조 면은 `Lilac`, `Lime`, `Cream`만 사용하며 과한 그림자나 장식은 추가하지 않는다.

## 공통 Demo 시나리오

- 프로젝트 제목: `ORBIT AI 발표 코칭 제품의 2026년 3분기 출시 전략`
- 발표 목적: 제품 출시 의사결정
- 청중: PM, 프론트엔드, 백엔드, AI 파이프라인 담당자
- 발표 시간: 15분
- 덱 상태: 최소 6장, 표지·핵심 지표·프로세스·결론 슬라이드 포함
- 리허설 상태: 2장 이상 진행, 타이머·말하기 속도·핵심 키워드에 유효한 값 표시
- 리포트 상태: 종합 점수, 강점, 개선점, 다음 연습 목표가 모두 표시

Demo ID와 고정 식별자는 `.env.example`, `packages/shared`, [Demo ID 기준](demo-standards.md)의 값을 사용한다.

## 캡처 기준

1. 브라우저 viewport는 `1440×900`, device scale factor는 `1`로 맞춘다.
2. Light theme와 현재 production route를 사용한다.
3. 실제 로그인 이메일, 개인 이름, 실제 파일명과 외부 서비스 credential은 화면에 포함하지 않는다. `docs/demo-standards.md`의 표준 Demo identity만 허용한다.
4. API 키, token, cookie, password, secret 값은 존재 여부와 관계없이 노출하지 않는다.
5. 로딩, 빈 상태, 권한 오류, 연결 실패, debug overlay, 개발자 도구와 scrollbar는 제거한다.
6. QA baseline과 mockup 이미지를 그대로 복사하지 않고 동일한 시나리오를 현재 구현에서 다시 캡처한다.
7. 글자와 핵심 UI가 축소 후에도 읽히도록 빈 여백보다 작업 화면을 우선한다.
8. 로고는 밝은 면에서 `apps/web/src/assets/orbit-logo.png`, 어두운 면에서 `apps/web/src/assets/orbit-logo-white.png` 원본을 사용한다.

## 화면별 구도

### Hero

- 로그인 정보가 있는 공통 header를 제외하고 작업 공간의 첫 화면을 사용한다.
- 최근 프로젝트, `AI 발표자료 만들기`, `리허설 시작하기`가 한 viewport에 보여야 한다.
- 제품의 `Canvas`, `Lilac`, `Lime`, `Cream` surface가 모두 드러나는 구도를 사용한다.

### 생성과 편집

- 생성 화면은 발표 주제, 청중, 목적, 스타일과 참고자료 입력이 완료된 상태를 사용한다.
- 에디터는 slide rail, 실제 slide canvas, AI 코치 panel이 동시에 보여야 한다.
- 생성 중 spinner나 빈 canvas는 사용하지 않는다.

### 리허설과 리포트

- 리허설은 진행 중 상태로 캡처하고 Live STT debug panel은 숨긴다.
- 타이머, 현재 slide, 말하기 속도, 핵심 키워드가 서로 겹치지 않아야 한다.
- 리포트는 실제 지표와 다음 연습 행동이 한 화면에서 이해되는 구도를 사용한다.

## README 삽입 예시

루트 `README.md`의 Hero는 다음 구조를 사용한다.

```html
<p align="center">
  <img
    src="./docs/assets/readme/orbit-product-hero.jpg"
    alt="최근 프로젝트와 AI 발표자료 만들기, 리허설 시작하기가 보이는 ORBIT 작업 공간"
    width="100%"
  />
</p>
```

## 교체 전 확인

- 화면의 기능과 문구가 현재 코드와 일치한다.
- 실제 사용자 데이터와 민감정보가 없다.
- 이미지 링크와 대체 텍스트가 GitHub README에서 정상적으로 보인다.
- 데스크톱과 좁은 화면에서 이미지가 잘리거나 가로 스크롤을 만들지 않는다.
- `git diff --check`와 README 로컬 링크 검증을 통과한다.
