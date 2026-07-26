# AI Agent 효율 리팩터링 후속 계획

**상태:** Completed

**작성일:** 2026-07-26

**기준 브랜치:** `develop`

**기준 저장소:** `kdh949/Orbit`

**공통 계약 변경:** 없음

**DB migration:** 없음

**배포 변경:** 없음

## 목적

ORBIT의 작은 변경이 필요한 source, contract, test만 읽고 검증하도록 repository
경계와 Agent 도구를 개선한다. 구조 지표 감소보다 correctness, contract compatibility,
privacy를 우선한다.

## 완료된 기반

2026-07-26 병합된 `kdh949/Orbit` PR #1부터 #38까지 다음 기반을 만들었다.

- `packages/*/src/**` 직접 import 20개에서 0개
- production source cycle 7개에서 0개
- scoped `AGENTS.md`, domain manifest, `agent:context`, verification wrapper 추가
- Presentation, speech, semantic browser runtime을 feature-neutral 경계로 이동
- Rehearsal API, recording, transcript, report, completion, preflight 일부 분리
- Worker queue policy, practice registration, API mapper, Python app factory와 PPTX facade 추가

## Git 기준선

구조 비교 기준은 리팩터링 직전 Git tree다.

- commit: `3b045d7b8fdcf7adb1121227879adf316c865c4c`
- tree: `78eb72732526a350f3381ab9226ecfca430d36fa`

현재 구조는 `pnpm agent:benchmark snapshot --ref origin/develop`로 측정한다.

## 완료 결과

### Wave 0 — 측정과 검증 신뢰성

- benchmark를 Git identity 전용 schema v3로 전환했다.
- 삭제와 rename을 포함해 변경 영향을 계산한다.
- 직접·전이 contract consumer를 선택하고 넓은 변경은 workspace 검증으로 승격한다.
- `pnpm test`와 PR merge gate가 공개 로컬 검증 환경에서 동작한다.

### Wave 1 — Rehearsal

- Workspace public barrel을 없애고 leaf public API를 사용한다.
- source 문자열 기반 통합 테스트를 architecture guard와 behavior test로 분리했다.
- run/media, Live STT, tracking/presentation controller를 분리했다.

### Wave 2 — Web과 package

- Presentation, Editor, Companion에서 Rehearsal 내부로 들어가는 import를 0으로 만들었다.
- PresentationWorkspace, EditorShell, App routing 책임을 분리했다.
- AST codemod로 production `@orbit/shared` root importer를 0개로 줄였다.

### Wave 3 — Worker, API, Python

- Worker registration, runtime option, recovery를 descriptor로 통합했다.
- DecksService와 RehearsalsService를 use case별로 분리했다.
- Python router를 capability별로 분리하고 PPTX facade 뒤 구현을 capability 모듈로 나눴다.

### Wave 4 — CSS와 문서

- CSS rule을 owner 파일로 이동하고 원본 cascade hash를 회귀 테스트로 고정했다.
- `docs/contracts.md`를 index로 유지하며 domain 계약 문서로 분리했다.
- 이 완료 계획을 active repository truth에서 제외했다.

## 실행 규칙

- 각 PR은 최신 `origin/develop`에서 시작하고 병합 후 다음 PR을 시작한다.
- 한 PR은 하나의 구조적 결과만 만들며 의미 변경 파일 25개를 넘기지 않는다.
- source 이동과 behavior 변경을 같은 PR에 섞지 않는다.
- 작업 중 leaf test, PR 전 workspace/consumer test, Wave 완료 시 전체 gate를 실행한다.
- GitHub Actions는 사용자가 별도로 요청하기 전까지 추가하지 않는다.
