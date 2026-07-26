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

## Format check

`pnpm format:check`도 같은 기준으로 변경 파일만 검사한다. 저장소 전체의 기존
포맷 부채를 한 PR에서 수정하지 않으면서 새 변경에 포맷 회귀를 추가하지 않기 위한
정책이다. 기준 ref는 `FORMAT_CHECK_BASE` 또는 `--base`로 바꿀 수 있다.
