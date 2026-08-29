# Storybook 기반 UI 개발 가이드

Orbit의 UI source of truth는 `apps/web/src/styles/tokens.css`,
`apps/web/src/styles/foundations.css`, `apps/web/src/components/ui`,
`apps/web/src/components/patterns`다. 새 화면을 만들기 전에 Storybook에서 기존
파운데이션과 컴포넌트를 확인하고, 같은 역할의 토큰이나 컴포넌트를 다시 만들지
않는다.

## 컴포넌트 배치

- `Foundations`: Color, Typography, Spacing, Radius, Elevation, Motion처럼
  제품 전체가 공유하는 시각 규칙
- `Primitives`: Button, Field, Card, Dialog, Status처럼 단독으로 조합 가능한 UI
- `Patterns`: 여러 Primitive를 묶은 반복 레이아웃과 상태 표현
- `Features`: 프로젝트 카드처럼 한 기능 안에서 재사용되는 UI
- `Screens`: 실제 라우트 수준 화면과 Success, Loading, Empty, Error 상태

Story의 `title`은 위 분류로 시작한다. 공용 Primitive는 `components/ui`의 public
export를 사용하고, Feature가 `components/ui`에 의존하는 방향을 유지한다.

## Story 작성 기준

Default를 복제하기보다 실제 회귀를 찾을 수 있는 상태만 추가한다.

- form/action: hover, keyboard focus, disabled, loading, validation error
- collection: empty, search empty, long content, loading, request error
- overlay/navigation: open/close, focus 이동, Escape/방향키 같은 핵심 interaction
- Screen: 서버 없이 확인 가능한 대표 성공 상태와 실패·대기 상태

props는 `args`와 Controls로 조작할 수 있게 하고, 컴포넌트 설명은 Autodocs에서
자동 생성한다. 클릭, 키보드 이동, 제출처럼 동작이 중요한 상태는 `play`에 사용자
관점 assertion을 둔다. 모든 Story는 전역 a11y gate를 통과해야 한다.

## API 상태 재현

React Query나 API에 의존하는 Story는 `.storybook/msw-handlers.ts`의 공통 fixture를
기본으로 사용한다. 현재 `msw-storybook-addon`의 CSF3 설정에서는
`parameters.msw`에 handler 배열을 직접 전달한다. Story별 Loading, Empty, Error는
같은 endpoint의 handler 배열로 대체한다.

첫 렌더 전에 이미 성공한 React Query 상태가 필요한 화면은
`.storybook/with-query-data.tsx`로 실제 query key와 response fixture를 주입한다.
브라우저 API wrapper 자체의 성공·실패를 제어해야 하는 화면은
`.storybook/preview.tsx`에 `sb.mock(..., { spy: true })`를 등록하고 Story의
`beforeEach`에서 반환값만 바꾼다. fixture는 shared schema와 실제 API response
shape를 따라야 하며 Story를 위해 제품 계약을 새로 만들지 않는다.

## 현재 주요 화면 커버리지

| 사용자 여정    | 대표 Story 상태                                                              |
| -------------- | ---------------------------------------------------------------------------- |
| 공개 진입·인증 | Landing, 로그인·가입, Profile 저장·중복 오류                                 |
| 프로젝트 탐색  | Workspace Home 성공·리스트·빈·로딩·오류, Project List, Project Card          |
| AI 발표자료    | Brief 빈·검증 오류·작성, 생성 진행·재시도 오류                               |
| 편집·발표      | Editor 성공·로딩·오류, Presentation presenter·audience activity              |
| 리허설·코칭    | Rehearsal 준비·무음·STT 오류, Practice Plan, Focused Practice, Challenge Q&A |
| 리포트         | 실제 분석 fixture를 사용한 Rehearsal Detail                                  |
| 커뮤니티·청중  | Gallery 성공·검색 빈·로딩·오류, Audience 인증·오류·방 선택·로딩              |

Companion spike/capture, deck render, mockup catalog 같은 진단·개발 전용 route는
제품 주요 화면 목록에서 제외한다. Community 상세의 쓰기 작업, 실전 발표 리포트,
버전 복원처럼 여러 mutation 계약이 결합된 화면은 각 기능 변경 시 계약 fixture와
함께 후속 Story를 추가한다.

## 작업 순서와 검증

1. `pnpm agent:context --path <target-file>`로 소유 영역과 검증 명령을 확인한다.
2. 기존 token, Primitive, Pattern을 검색하고 세 번째 실제 반복이 확인될 때만 새
   추상화를 만든다.
3. 실제 컴포넌트 변경과 의미 있는 Story를 같은 작은 변경 단위로 구현한다.
4. Storybook MCP `preview-stories`로 변경 화면을 직접 확인한다.
5. Storybook MCP `run-story-tests`로 focused interaction/a11y를 반복하고, 완료 전에는
   전체 Story를 실행한다.
6. `pnpm --filter @orbit/web typecheck`
7. `pnpm --filter @orbit/web build-storybook`
8. 영향받은 Web test/build와 저장소 검증 명령을 실행한다.

브라우저 테스트가 macOS sandbox 권한으로 차단되면 제품 실패로 간주하지 않고,
허용된 환경에서 같은 명령을 다시 실행해 interaction/a11y 결과를 확인한다.
