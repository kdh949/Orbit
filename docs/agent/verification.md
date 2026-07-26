# Agent verification

Agent와 개발자가 변경 범위를 직접 재구성하지 않도록 domain별 빠른 검증과 Git
변경 영향 검증을 한 명령으로 제공한다. 모든 명령은 기본적으로 read-only이며,
실행 전에 `--dry-run`으로 선택된 하위 명령을 확인할 수 있다.

## Domain scope

사용 가능한 domain은 다음 명령으로 확인한다.

```bash
pnpm agent:context --list
```

검증 scope는 `<area>:<domain>` 형식이다.

```bash
pnpm verify:scope web:rehearsal --dry-run
pnpm verify:scope api:decks --dry-run
pnpm verify:scope worker:pptx --dry-run
pnpm verify:scope python:pptx --dry-run
```

`--dry-run`을 제거하면 `docs/agent/domains/*.json`의 `fastChecks` 중 해당 area에
등록된 명령을 순서대로 실행한다. 첫 실패에서 중단하고 해당 exit code를 그대로
반환한다. `decks`는 현재 `editor` domain의 alias다. Web 검증에 필요한 공개 로컬
필수값은 `.env.example`에서 선택해 제공하고, 선택 기능 flag는 주입하지 않으며,
호출자가 설정한 환경변수를 우선한다. 로컬 검증에서는 이 환경을 하위 task에
전달하도록 Turbo `--env-mode=loose`를 사용한다.

새 domain을 추가할 때는 다음을 함께 등록한다.

- domain을 대표하는 entrypoint, contract, test
- area별 typecheck와 가장 좁은 테스트
- 전체 검증 승격 조건
- 보안·아키텍처 경계

## Path context

domain을 알지 못해도 변경 파일 하나에서 작업 context를 계산할 수 있다.

```bash
pnpm agent:context --path \
  apps/web/src/runtime/speech/stt/koreanTextSimilarity.ts
```

출력에는 workspace, capability, 가장 가까운 `AGENTS.md`, manifest ownership,
direct/reverse dependency, 인접 test, 관련 contract와 verification tier가
포함된다. manifest가 파일을 소유하지 않아도 경로 기반 fallback을 반환하며, 둘
이상의 manifest가 일치하면 `overlap`으로 표시한다. `runtime/speech`처럼
feature-neutral한 capability는 manifest domain보다 경로의 capability를 우선한다.
domain context의 `Contracts`에는 root index 전체가 아니라 manifest가 선택한
domain 계약 문서와 shared schema만 표시한다. 공통 File, Job, WebSocket 계약이
필요한 domain만 `docs/contracts/common.md`를 함께 등록한다.

## Changed-file verification

작업 중에는 domain 전체 검증 대신 변경 파일에서 계산한 tier를 실행한다.

```bash
pnpm verify:changed --dry-run --tier 1 \
  apps/web/src/runtime/speech/stt/koreanTextSimilarity.ts
pnpm verify:changed --tier 2 \
  apps/web/src/runtime/speech/stt/koreanTextSimilarity.ts
```

경로를 생략하면 기준 ref와 merge base 이후의 committed, staged, unstaged,
untracked 파일을 합쳐 계산한다. 영향 계산에는 삭제 경로와 rename 원본·대상을
모두 포함하고, 포맷 검사는 현재 존재하는 대상 경로만 사용한다. `--base`로 기준
ref를 바꿀 수 있다.

| Tier | 목적                                                 | 기본 실행 시점        |
| ---- | ---------------------------------------------------- | --------------------- |
| 0    | import boundary, source cycle, 변경 파일 format      | 변경 직후             |
| 1    | 같은 basename 또는 직접 reverse import인 leaf test   | patch 직후            |
| 2    | 변경 workspace typecheck                             | PR 완료 전            |
| 3    | 등록된 contract consumer test                        | schema/API/queue 변경 |
| 4    | root config, migration, queue runtime의 release gate | merge/release         |

기본 최대 tier는 2다. 성공 시 선택 이유를 compact하게 출력하며 첫 실패에서
중단한다. STT leaf 변경은 인접한 `koreanTextSimilarity.test.ts`만 선택하고
`RehearsalWorkspace.test.tsx`, API, Worker, Python test를 선택하지 않는다.

TypeScript contract consumer와 test는 import graph의 direct·transitive reverse
dependency에서 계산한다. Python처럼 import graph가 언어 경계를 넘지 못하는
consumer만 `docs/agent/contract-consumers.json`에 exact test override로 등록한다.
존재하지 않는 override test 경로는 canonical guard에서 실패한다. exact leaf 또는
contract test가 8개를 초과하거나 `index.ts`, `public.ts` 같은 public barrel이
바뀌면 개별 명령을 열거하지 않고 workspace test 또는 affected 검증으로 승격한다.

## Affected verification

현재 브랜치와 `origin/develop`의 merge base 이후 변경과 staged, unstaged,
untracked 파일을 함께 계산한다.

```bash
pnpm verify:affected --dry-run
pnpm verify:affected
```

다른 기준 ref를 사용할 때는 명시적으로 지정한다.

```bash
pnpm verify:affected --dry-run --base develop
```

일반 app/package 변경은 `TURBO_SCM_BASE`와 `TURBO_SCM_HEAD`를 설정한 Turbo
`--affected` 검증으로 제한한다. 다음 변경은 전체 TypeScript 검증으로 승격한다.

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`,
  `tsconfig.base.json`
- `apps/api/src/database/migrations/**`
- `packages/job-queue/src/**`

Python source, test, `pyproject.toml`, `uv.lock`이 바뀌면 Ruff, mypy, pytest를
추가한다. Python 문서만 바뀐 경우에는 추가하지 않는다. consumer matrix에 등록된
shared 계약은 exact consumer test를 추가한다. matrix에 없는 shared schema, Job,
realtime 계약은 안전을 위해 전체 TypeScript와 Python 검증으로 승격한다.

## PR verification

로컬 PR merge gate는 공개 검증 기본값을 주입한 하나의 명령으로 실행한다.

```bash
pnpm verify:pr
pnpm verify:pr --base develop
```

실행 순서는 canonical guard, 현재 존재하는 변경 파일의 format check, affected
build·typecheck·test와 필요한 Python 검증이다. root `pnpm test`도 같은 공개
기본값을 사용하므로 별도 `.env` 없이 실행할 수 있다. PR에 포함되지 않은 사용자
소유 untracked 파일은 gate 대상에서 제외한다.

## Canonical Agent guard

Agent 도구 전체 test와 dependency 설치 전에도 실행 가능한 repository guard를
각각 한 명령으로 제공한다.

```bash
pnpm test:agent
pnpm verify:guard
```

`verify:guard`는 repo truth, domain manifest, contract consumer matrix, import
boundary, source cycle, benchmark integrity, package task graph를 검사한다.
orientation과 impact 계산 경로는 Prettier를 top-level에서 import하지 않으므로
dependency가 없는 checkout에서도 built-in-only guard를 실행할 수 있다.

## Import boundary

앱과 서비스는 workspace package의 내부 `packages/*/src/**`를 상대경로로 직접
참조하지 않고 `@orbit/*` 공개 entrypoint를 사용한다.
Web의 `runtime/**`은 feature-neutral한 browser capability 계층이므로
`features/**` 내부 구현을 역참조하지 않는다.

```bash
pnpm lint:boundaries
pnpm test:import-boundaries
```

`@orbit/shared`와 `@orbit/editor-core`는 Node의 CommonJS 소비자에는 빌드된
`dist/index.js`를, Vite 같은 ESM bundler에는 공개 TypeScript entrypoint를
제공한다. package 내부 파일을 옮길 때 app import가 함께 깨지는 우회를 만들지
않도록 새 직접 참조는 `lint:boundaries`에서 실패한다.
같은 검사에서 `apps/web/src/runtime/** → apps/web/src/features/**` 상대 import도
실패한다.

## Source cycle

production TypeScript/JavaScript의 상대 import graph에는 type-only dependency를
포함한 순환 참조를 허용하지 않는다.

```bash
pnpm lint:cycles
pnpm test:source-cycles
```

검사는 `apps`, `packages`, `services`의 source를 대상으로 하며 test/spec,
dependency, build 산출물은 제외한다. 공통 타입이나 계약 때문에 cycle이 생기면
구현 파일 또는 root barrel을 역참조하지 않고 양쪽이 참조할 수 있는 중립 모듈로
이동한다.

## Format check

`pnpm format:check`도 같은 기준으로 변경 파일만 검사한다. 새 파일이 포맷되지
않았거나 기준 ref에서 포맷되었던 파일이 현재 포맷되지 않으면 실패한다. 기준
ref부터 포맷되지 않았던 파일은 기존 부채로 경고만 남긴다. 따라서 작은 변경 때문에
대형 legacy 파일 전체를 다시 쓰지 않으면서 새 포맷 회귀는 차단한다. 기준 ref는
`FORMAT_CHECK_BASE` 또는 `--base`로 바꿀 수 있다.
