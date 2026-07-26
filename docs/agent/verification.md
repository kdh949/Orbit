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
- `packages/shared/src/**/*.schema.ts`
- `packages/shared/src/jobs/**`, `packages/shared/src/realtime/**`
- `packages/job-queue/src/**`

Python source, test, `pyproject.toml`, `uv.lock`이 바뀌면 Ruff, mypy, pytest를
추가한다. Python 문서만 바뀐 경우에는 추가하지 않는다. shared schema 변경은
cross-language contract 영향 가능성이 있으므로 Python 전체 검증도 추가한다.

## Import boundary

앱과 서비스는 workspace package의 내부 `packages/*/src/**`를 상대경로로 직접
참조하지 않고 `@orbit/*` 공개 entrypoint를 사용한다.

```bash
pnpm lint:boundaries
pnpm test:import-boundaries
```

`@orbit/shared`와 `@orbit/editor-core`는 Node의 CommonJS 소비자에는 빌드된
`dist/index.js`를, Vite 같은 ESM bundler에는 공개 TypeScript entrypoint를
제공한다. package 내부 파일을 옮길 때 app import가 함께 깨지는 우회를 만들지
않도록 새 직접 참조는 `lint:boundaries`에서 실패한다.

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
