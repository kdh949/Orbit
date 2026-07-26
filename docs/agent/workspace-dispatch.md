# Agent workspace dispatch

대상 영역이 정해진 작업은 repository root 전체보다 해당 workspace를 시작
디렉터리로 사용한다. Codex는 root부터 시작 디렉터리까지의 `AGENTS.md`를 적용한다.

```bash
codex --cd apps/web
codex --cd apps/api
codex --cd apps/worker
codex --cd services/python-worker
```

대상 파일을 찾은 뒤에는 시작 위치와 관계없이 path context를 확인한다.

```bash
pnpm agent:context --path <target-file>
pnpm agent:context --path <target-file> --explain-all
```

기본 출력은 다음을 제공한다.

- root부터 대상까지 적용되는 `AGENTS.md`
- 소유 domain과 capability
- primary contract와 직접 관련된 secondary contract
- 테스트 선택 이유와 confidence
- Tier 0~2 최소 검증과 full-check 승격 사유

`--explain-all`은 transitive contract가 필요한 조사에서만 사용한다. 일반 leaf
작업에서는 기본 출력을 유지해 불필요한 계약 문맥을 주입하지 않는다.

등록 domain의 fast check는 실제 실행 전에 dry run으로 확인한다.

```bash
pnpm agent:context --list
pnpm verify:scope web:rehearsal --dry-run
pnpm verify:scope api:projects-access --dry-run
pnpm verify:scope python:pptx --dry-run
```

여러 workspace, public package barrel, shared schema, queue runtime, migration,
root build 설정이 바뀌면 scoped check 대신 affected 검증으로 승격한다.

```bash
pnpm verify:affected --dry-run
pnpm verify:affected
```
