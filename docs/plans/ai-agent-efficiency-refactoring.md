# Implementation Plan: AI Agent 효율 중심 코드베이스 리팩터링

**상태:** Execution approved

**작성일:** 2026-07-26

**기준 브랜치:** `develop`

**주요 소유 영역:** 저장소 전체

**공통 계약 변경:** 원칙적으로 없음. 필요한 경우 별도 계약 PR로 분리

**DB migration:** 없음

**배포 변경:** 없음. GitHub Actions 재도입은 별도 승인 전까지 제외

## 1. 목적

ORBIT을 Codex, Claude Code 같은 AI Agent가 더 적은 파일과 더 좁은 검증 범위만
읽고도 안전하게 수정할 수 있는 모노레포로 개선한다.

이 작업의 1차 목표는 코드 줄 수 자체를 줄이는 것이 아니라 다음 작업 비용을 줄이는
것이다.

- 수정할 canonical source를 찾는 비용
- 한 도메인의 entrypoint와 계약을 찾는 비용
- package와 feature 사이의 영향 범위를 계산하는 비용
- 작은 수정 뒤 관련 없는 package까지 빌드하고 테스트하는 비용
- 거대 shell, test, CSS에서 관련 책임을 찾는 비용

목표 실행 흐름은 다음과 같다.

```text
사용자 요청
  → domain 식별
  → pnpm agent:context <domain>
  → 관련 entrypoint·계약·테스트 확인
  → 작은 범위 수정
  → pnpm verify:scope <scope>
  → contract/root 변경일 때만 전체 검증으로 승격
```

## 2. 현재 기준선

이 문서의 수치는 2026-07-26 `develop`의 `3b045d7b`를 기준으로 다시 측정했다.
첨부 분석 문서의 아카이브 수치와 다른 경우 현재 저장소 수치를 우선한다.

| 항목 | 현재 |
| --- | ---: |
| `packages/*/src/**`를 직접 참조하는 파일 | 20 |
| `@orbit/shared` root import 파일 | 648 |
| `@orbit/editor-core` root import 파일 | 104 |
| `RehearsalWorkspace.tsx` | 7,711줄 |
| `RehearsalWorkspace.test.tsx` | 3,612줄 |
| `EditorShell.tsx` | 2,847줄 |
| `EditorShell.test.tsx` | 2,729줄 |
| `PresentationWorkspace.tsx` | 2,301줄 |
| `WorkerService` | 1,285줄 |
| Python `main.py` | 1,843줄 |
| `pptx_ooxml_generation.py` | 7,189줄 |
| `editor-shell.css` | 15,070줄 |
| `styles.css` | 11,088줄 |
| 범위별 Agent 지침 | root, Web만 존재 |
| GitHub Actions workflow | 최신 커밋에서 의도적으로 제거 |
| `agent:context`, `verify:scope`, `repo:doctor` | 없음 |

현재 확인된 feature 결합도 다음과 같다.

| 소비 영역 | `features/rehearsal`을 참조하는 파일 |
| --- | ---: |
| Presentation | 12 |
| Editor | 19 |
| Presenter Companion | 8 |

## 3. 핵심 결정

### 3.1 모노레포를 유지한다

Deck, Rehearsal, Job, Realtime, PPTX 계약을 Web, API, Worker, Python Worker가
함께 사용하므로 저장소 분리는 범위 밖이다. 먼저 package subpath와 feature runtime
경계를 정리한다.

### 3.2 모든 변경을 작은 순차 PR로 병합한다

전체 계획을 하나의 장기 브랜치나 대형 PR로 만들지 않는다. 각 PR은 `develop`에서
시작하고 검증·병합된 다음 후속 PR이 최신 `develop`을 기준으로 시작한다.

- 한 PR은 하나의 구조적 결과만 만든다.
- 파일 이동과 동작 변경을 같은 PR에 넣지 않는다.
- public API는 compatibility facade를 먼저 만든 뒤 소비자를 이동한다.
- 공유 브랜치에는 rebase 또는 force push를 하지 않는다.

### 3.3 GitHub Actions를 자동 복구하지 않는다

현재 HEAD는 아홉 개 workflow를 의도적으로 제거한 커밋이다. 따라서 repository truth
문서는 현재 자동 CI가 없다는 사실에 맞추되, workflow 재도입은 별도 승인과 별도
`ci:` PR로 진행한다.

### 3.4 공통 계약을 먼저 보존한다

Deck JSON, File, Job, WebSocket, Rehearsal 계약은 `packages/shared`와
`docs/contracts.md`를 기준으로 한다. 구조 분해 PR은 schema, endpoint path,
queue payload, event envelope을 변경하지 않는다.

### 3.5 Web runtime을 shell보다 먼저 추출한다

Presentation과 Editor가 Rehearsal 내부 구현을 재사용하고 있으므로
`RehearsalWorkspace`를 먼저 hook으로 나누지 않는다. 공용 speech, presentation,
media runtime을 먼저 feature 밖으로 이동한다.

### 3.6 CSS와 Python을 독립 트랙으로 다룬다

CSS cascade와 Python PPTX pipeline도 Agent 탐색 범위의 핵심 병목이다.
TypeScript shell 분해의 부수 작업으로 처리하지 않는다.

## 4. 의존 순서

```text
Repository truth
  → scoped Agent instructions
  → domain manifest / context
  → verification wrappers
  → package public API
  → direct import / source cycle 제거
  → Web shared runtime
  → Web shell / test 분해
  → API / Worker / Python 분해
  → CSS ownership extraction
  → benchmark 재측정
```

`Repository truth`부터 `source cycle 제거`까지는 순차 작업이다. Package 경계가
안정된 뒤에는 Web, API/Worker, Python, CSS 트랙을 독립 PR로 진행할 수 있다.

## 5. PR 실행 계획

### Phase A. Repository truth와 Agent 기반

#### PR A1. 실행 계획과 repository truth 검사

**브랜치:** `codex/refactor-agent-efficiency-foundation`

**변경:**

- 이 실행 계획 추가
- `tools/agent/repo-doctor.mjs`
- `tools/agent/repo-doctor.test.mjs`
- root `repo:doctor` script
- 현재 없는 workflow와 stale 디자인 시스템 경로를 active 문서에서 탐지
- README와 test matrix를 현재 workflow 부재 상태에 맞게 수정

**Acceptance criteria:**

- active 문서가 없는 workflow를 현재 실행 중이라고 서술하면 검사가 실패한다.
- active 문서가 `apps/web/src/design-system`을 canonical source로 선언하면 실패한다.
- 현재 자동 CI 부재와 수동 검증 범위가 문서에서 명확하다.

**Verification:**

```bash
node --test tools/agent/repo-doctor.test.mjs
pnpm repo:doctor
```

**커밋 경계:**

```text
docs: AI Agent 효율 리팩터링 실행 계획 추가
test: repository truth 검사 회귀 테스트 추가
chore: repository truth 검사 도구 추가
docs: 현재 검증 체계와 디자인 기준 정합화
```

#### PR A2. 범위별 Agent 지침

**변경:**

- root `AGENTS.md`는 저장소 불변 규칙 중심으로 축소
- `apps/api/AGENTS.md`
- `apps/worker/AGENTS.md`
- `services/python-worker/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/editor-core/AGENTS.md`
- Claude Code를 사용할 경우 root와 scope별 `CLAUDE.md`가 해당 `AGENTS.md`를 import

**Acceptance criteria:**

- 각 scope 문서는 200줄 이하이고 관련 구현 규칙만 포함한다.
- 기존 `any`, `as unknown as`는 baseline보다 증가하지 않는 정책으로 표현한다.
- 전체 검증 명령을 모든 scope 문서에 반복하지 않는다.

**Verification:**

```bash
pnpm repo:doctor
```

#### PR A3. Domain manifest와 context 도구

**변경:**

- `docs/agent/domains/rehearsal.json`
- `docs/agent/domains/editor.json`
- `docs/agent/domains/pptx.json`
- `docs/agent/domains/ai-deck.json`
- `tools/agent/context.mjs`
- manifest schema와 경로 검증 테스트

**Acceptance criteria:**

- `pnpm agent:context rehearsal` 출력이 150줄 이하이다.
- owned path, entrypoint, contract, fast check, full-check trigger를 출력한다.
- 존재하지 않는 경로와 중복 domain id는 실패한다.

**Verification:**

```bash
node --test tools/agent/context.test.mjs
pnpm agent:context rehearsal
```

#### PR A4. Agent benchmark 기준선

**변경:**

- `tools/agent/benchmark.mjs`
- `docs/agent/benchmark.md`
- 결과 schema와 빈 baseline fixture

**Acceptance criteria:**

- 고정 작업 8개의 파일 조회 수, tool call, 검증 package, 시간을 기록할 수 있다.
- 실제 token 사용량을 제공받지 못하면 `unavailable`로 기록하고 추정하지 않는다.
- 저장소에 prompt나 secret을 기록하지 않는다.

### Phase B. 검증 비용 축소

#### PR B1. Package script의 중복 dependency build 제거

**변경:**

- Web/API/Worker의 `test`, `typecheck`에서 수동 workspace build 제거
- dependency build 순서는 Turbo가 단독 관리
- direct package command와 Turbo command의 차이를 문서화

**Acceptance criteria:**

- `pnpm turbo run test --filter=@orbit/api`에서 같은 dependency build가 반복되지 않는다.
- package test는 자신의 Vitest 실행만 담당한다.
- migration과 운영 script의 명시적 build는 이 PR에서 변경하지 않는다.

**Verification:**

```bash
pnpm turbo run typecheck --filter=@orbit/web
pnpm turbo run test --filter=@orbit/api
pnpm turbo run test --filter=@orbit/worker
```

#### PR B2. `lint`, `typecheck`, `format:check` 의미 분리

**변경:**

- `typecheck`는 TypeScript 검사만 담당
- `format:check` 추가
- 실제 linter가 없으면 `lint`를 중복 실행 경로에서 제거
- linter 도입은 별도 결정으로 유지

**Acceptance criteria:**

- 기본 검증에서 같은 `tsc --noEmit`을 두 번 실행하지 않는다.
- 검증 명령이 repository 전체에 write를 수행하지 않는다.

#### PR B3. `verify:scope`와 `verify:affected`

**변경:**

- `tools/agent/verify-scope.mjs`
- domain manifest 기반 TypeScript/Python command 선택
- full verification 승격 규칙

**승격 조건:**

- shared schema
- DB migration
- queue payload
- cross-language API
- root lockfile 또는 compiler/build config

**Acceptance criteria:**

- `web:rehearsal`, `api:decks`, `worker:pptx`, `python:pptx`를 지원한다.
- `--dry-run`으로 실행할 명령을 확인할 수 있다.
- 실패한 하위 명령의 exit code를 보존한다.

### Phase C. Package public API와 cycle

#### PR C1. Shared domain subpath

**변경 순서:**

1. `@orbit/shared/deck`
2. `@orbit/shared/rehearsals`
3. `@orbit/shared/jobs`
4. `@orbit/shared/realtime`
5. `@orbit/shared/activities`
6. `@orbit/shared/coaching`

각 domain은 독립 커밋 또는 독립 PR로 진행한다. Root export는 migration 기간 동안
compatibility facade로 유지한다.

**Acceptance criteria:**

- root와 subpath가 같은 runtime schema 객체를 export한다.
- package build 결과에 각 subpath의 JS와 declaration이 존재한다.
- contract test가 기존 consumer와 subpath consumer 양쪽에서 통과한다.

#### PR C2. Editor Core public API

**변경:**

- `createDemoDeck`을 `fixtures`로 이동
- `patches`, `playback`, `animations`, `fixtures` subpath 추가
- root `index.ts`는 re-export만 담당

**Acceptance criteria:**

- fixture를 production entrypoint 구현과 분리한다.
- 기존 root import는 compatibility를 유지한다.
- package build와 test가 통과한다.

#### PR C3. Package source 직접 import 제거

20개 파일을 다음 작은 범위로 나눈다.

1. App과 Vite config
2. Editor shell API와 controller
3. Editor canvas와 test
4. Rehearsal keyword runtime
5. Job schema consumer

**Acceptance criteria:**

```text
apps/** → packages/*/src/** 직접 import = 0
```

마지막 범위에서 `tools/agent/check-import-boundaries.mjs`와 회귀 테스트를 추가한다.

#### PR C4. Web type/helper cycle 제거

각 항목을 독립 커밋으로 처리한다.

- `ElementPresentationState` → `presentationState.ts`
- semantic matcher 공통 타입 → `semanticUtterance.types.ts`
- report route helper → `rehearsalRoutes.ts`
- editor session DTO → `editorSession.model.ts`
- companion annotation input → `companionSocket.contract.ts`

**Acceptance criteria:**

- component나 hook 파일이 하위 API/type 모듈의 type source가 되지 않는다.
- 기존 targeted test가 변경 없이 통과한다.

#### PR C5. API와 AI package cycle 제거

**변경:**

- `ActivitiesModule ↔ PresentationSessionsModule`을 좁은 port 또는 bridge로 교체
- `packages/ai` provider contract를 implementation/barrel에서 분리

두 cycle은 별도 PR로 진행한다.

### Phase D. Web 공용 runtime

#### PR D1. Speech runtime

Leaf module부터 다음 순서로 이동한다.

1. STT port와 transcript normalization
2. runtime config와 engine registry
3. semantic matcher/decision types
4. keyword tracker와 phrase extractor
5. pause detection

**Target:**

```text
apps/web/src/runtime/speech/
```

**Acceptance criteria:**

- Presentation과 Editor가 `features/rehearsal/stt` 또는 `speech`를 import하지 않는다.
- runtime은 feature를 import하지 않는다.
- 기존 speech/STT test가 target path에서 통과한다.

#### PR D2. Presentation runtime

Leaf module부터 다음 순서로 이동한다.

1. presentation channel과 state contract
2. slideshow step/transition model
3. display manager와 window capability
4. audience output
5. slide navigation gate

**Target:**

```text
apps/web/src/runtime/presentation/
```

**Acceptance criteria:**

- Presentation과 Presenter Companion이 Rehearsal presenter 내부를 import하지 않는다.
- speaker notes, transcript, raw audio가 audience surface로 전달되지 않는다.
- presenter window와 authority regression test가 통과한다.

#### PR D3. Media runtime

**Target:**

```text
apps/web/src/runtime/media/
```

**범위:**

- microphone
- recording
- slide asset cache/preload

**Acceptance criteria:**

- media runtime이 report나 feature UI를 import하지 않는다.
- recording lifecycle과 asset gate test가 독립적으로 실행된다.

### Phase E. Web shell과 test 분해

#### PR E1. Rehearsal API와 route 분리

- API helper
- report/upload API
- route helper
- 관련 test

#### PR E2. Rehearsal recording과 STT lifecycle

- recording controller
- live STT controller
- recovery state
- 관련 test split

#### PR E3. Rehearsal speech tracking과 navigation

- speech tracking controller
- navigation/auto advance controller
- presenter window coordination
- 관련 test split

#### PR E4. Rehearsal report/preflight와 UI shell

- report/preflight controller
- UI section component
- 최종 integration test

**Phase E1~E4 완료 기준:**

- `RehearsalWorkspace.tsx`는 500~800줄의 orchestration shell이다.
- API, recording, STT, speech, navigation, report가 독립 test target을 갖는다.
- route, API payload, report schema, recording privacy 동작이 바뀌지 않는다.

#### PR E5. Presentation shell

- controller와 UI 조합 분리
- runtime dependency만 사용
- 기존 integration test 유지

#### PR E6. Editor shell

다음 책임별 독립 PR로 나눈다.

- document/persistence
- selection
- canvas commands
- slide commands
- modal/panel UI

**완료 기준:**

- `EditorShell.tsx`는 500~800줄 shell이다.
- public export는 `features/editor/public.ts`만 담당한다.
- command와 controller에 독립 test가 있다.

#### PR E7. App router

- route model
- route parser/table
- providers
- production fixture

**완료 기준:**

- `App.tsx`는 provider와 router 조합만 담당한다.
- mockup/report fixture를 production route entrypoint에서 분리한다.

### Phase F. API, Worker, Python

#### PR F1. DecksService use case

다음 독립 PR로 나눈다.

- get/save/patch
- snapshot/version
- export
- PPTX sync
- legacy normalization

각 PR은 controller contract와 기존 service method를 compatibility facade로 유지한다.

#### PR F2. RehearsalsService use case

- create run
- upload lifecycle
- report/comparison
- semantic retry
- persistence query

#### PR F3. Worker registry와 scheduler

- descriptor contract
- worker registry
- execution observer
- transport recovery
- retention/storage/maintenance scheduler

**완료 기준:**

- `WorkerService`는 registry와 scheduler lifecycle만 관리한다.
- queue name, retry, concurrency, terminal recovery 동작이 바뀌지 않는다.

#### PR F4. Worker processor

- rehearsal STT pipeline
- PPTX OOXML sync pipeline

두 processor는 별도 PR로 분해한다.

#### PR F5. Python app factory와 router

다음 router family를 순차 이동한다.

1. health/reference
2. audio/rehearsal
3. slide practice/coaching
4. AI Deck
5. PPTX/visual QA

**완료 기준:**

- `main.py`는 50~150줄이다.
- endpoint path, status code, Pydantic response, OpenAPI operation이 유지된다.

#### PR F6. Python PPTX pipeline

기존 public function과 exception type을 facade에 유지하면서 다음을 이동한다.

- package reader/security
- import
- sync
- rendering
- fallback

#### PR F7. Python AI Deck pipeline과 test

- content planning
- design planning
- composition selection
- quality/repair
- 7,881줄 contract test의 domain별 분리

### Phase G. CSS ownership

#### PR G1. CSS ownership report와 freeze

- 거대 CSS 신규 selector 추가 차단
- selector ownership report
- stylesheet import order snapshot

#### PR G2. 내용 변경 없는 CSS 이동

Editor, Rehearsal, Presentation 순서로 component stylesheet를 이동한다.
첫 이동 PR에서는 selector와 declaration을 수정하지 않는다.

#### PR G3. Duplicate와 token 정리

visual regression을 통과한 범위만 duplicate selector, token, dead rule을 정리한다.

**완료 기준:**

- `editor-shell.css`는 3,000줄 이하의 shell/layout 전용 파일이다.
- `styles.css`는 2,000줄 이하의 reset/global 전용 파일이다.
- 새로운 `!important`가 증가하지 않는다.

### Phase H. Benchmark와 종료

#### PR H1. 리팩터링 후 benchmark

다음 고정 작업을 기준선과 같은 방식으로 측정한다.

1. 리허설 UI 문구 변경
2. Web Speech retry 조건 변경
3. `RehearsalRun` response 필드 추가
4. Worker retry option 변경
5. Python audio validation 추가
6. Editor slide patch 변경
7. 환경변수 추가
8. PPTX sync error mapping 변경

**목표 가설:**

- 첫 patch 전 읽은 파일 중앙값 8개 이하
- 단일 feature 작업에서 읽는 최상위 영역 2개 이하
- 일반 fast verification이 2개 workspace 이하
- package source 직접 import 0
- 확인된 source cycle 0
- 고변경 코드의 shared root import 80% 이상 감소
- Agent input 사용량 30~50% 감소 여부를 실측

30~50%는 보장 조건이 아니라 검증할 가설이다.

## 6. 공통 PR 체크리스트

모든 PR은 다음을 지킨다.

- [ ] 최신 `origin/develop`에서 시작
- [ ] 동작 변경과 구조 이동을 혼합하지 않음
- [ ] 변경 범위의 targeted test 실행
- [ ] 계약·migration·queue 변경 시 전체 검증으로 승격
- [ ] secret 값, raw audio, transcript, presenter script를 로그에 출력하지 않음
- [ ] `commit-convention`에 맞춘 스코프 없는 한국어 커밋 제목 사용
- [ ] PR 본문에 변경 요약, 테스트, 영향 범위 기록
- [ ] 공유 브랜치 rebase/force push 금지
- [ ] PR merge 후 후속 브랜치를 최신 `develop`에서 생성

## 7. 중단과 롤백 조건

다음 조건에서는 해당 PR을 병합하지 않고 범위를 줄인다.

- 구조 이동 중 public contract 또는 endpoint path가 변경됨
- targeted test가 현재 동작의 의도인지 판단할 수 없음
- CSS 이동 후 visual baseline이 달라졌으나 원인을 설명할 수 없음
- Python facade 분리 중 exception/status mapping이 달라짐
- 검증 wrapper가 관련 package를 누락함
- root barrel compatibility 제거가 아직 migration되지 않은 consumer를 깨뜨림

이미 병합된 공유 이력은 rebase나 force push로 수정하지 않고 `revert:` PR로 되돌린다.

## 8. 완료 정의

전체 Goal은 다음 조건을 모두 만족할 때 완료한다.

- 모든 필수 Phase A~H PR이 `develop`에 병합됨
- package source 직접 import 0
- 확인된 source cycle 0
- scope별 Agent 지침과 domain context 사용 가능
- 중복 build와 TypeScript 검사 제거
- Web 공용 runtime의 feature 역의존 0
- 거대 shell, test, CSS, Python entrypoint가 책임별 target을 가짐
- 최종 benchmark 결과가 문서화됨
- 마지막 PR 검증과 merge 상태를 확인함

Shared package 물리 분리, CI workflow 재도입, compatibility 제거는 측정과 별도 승인에
따라 진행하는 선택 작업이며 이 Goal의 필수 완료 조건이 아니다.
