# AI Agent Efficiency Benchmark

이 benchmark는 구조 지표와 실제 Agent 작업 지표를 분리한다. 구조 지표는 저장소나
source archive에서 자동 계산하고, 파일 조회 수·tool call·token 사용량은 실행
환경이 제공한 실제 값만 기록한다.

## Snapshot identity

schema v2 snapshot은 측정 대상의 identity를 함께 기록한다.

- Git 측정: `headCommit`, `treeHash`, `workingTreeDirty`
- archive 측정: `sourceArchiveSha256`과 null인 Git identity
- 공통: `toolVersion`, `capturedAt`

dirty working tree에서는 baseline snapshot 생성을 기본 거부한다. 진행 중인 구조를
임시로 확인할 때만 `--allow-dirty`를 명시한다.

```bash
pnpm agent:benchmark snapshot
pnpm agent:benchmark snapshot --allow-dirty
pnpm agent:benchmark snapshot --ref origin/develop
pnpm agent:benchmark snapshot --archive /path/to/Orbit-main.zip
```

`--ref`는 해당 Git tree를 임시 archive로 추출해 측정한다. `--archive`는 archive
SHA-256을 직접 계산하고 Git commit을 추정하지 않는다. 이 구분으로 commit label과
실제 측정 tree가 달라지는 baseline 오염을 방지한다.

저장된 기준선의 schema를 검사하고 현재 값과 비교한다.

```bash
pnpm agent:benchmark validate docs/agent/benchmarks/baseline.json
pnpm agent:benchmark compare docs/agent/benchmarks/baseline.json
```

## 자동 구조 지표

- package `src` 직접 import 파일 수
- `@orbit/shared`, `@orbit/editor-core` root/subpath import 파일 수
- production/test `@orbit/shared` root import 분리
- source cycle과 source inspection test 수
- domain manifest의 production source coverage
- 주요 shell의 direct dependency, reachable file/LOC
- 주요 production, test, CSS hotspot 줄 수
- CSS duplicate selector와 occurrence

`docs/agent/benchmarks/baseline.json`은 제공된 `Orbit-main.zip`을 직접 측정한
archive baseline이다. 원본 기준은 `manifest=0`, scoped `AGENTS.md=2`,
`source cycle=7`을 재현하며, 일부 Agent 파일이 이미 있던 Git commit을 원본으로
오인하지 않는다.

## 실제 Agent 작업 측정

```bash
pnpm agent:benchmark tasks
```

처음에는 대표 작업 4개를 한 번씩 실행한다.

- Web leaf logic
- shared contract
- Worker retry
- Python PPTX error mapping

편차가 큰 작업만 한 번 추가하고 세 번째 run은 필요할 때만 수행한다. 각 run은 첫
patch 전 파일 수, 첫 targeted test까지 tool call과 시간, 전체 시간, 검증
workspace, rollback을 기록한다. prompt, transcript, 발표자 script, credential,
개인식별정보는 기록하지 않는다.

기존 3,257,365-token 실행은 micro task가 아닌 `macro-refactor` run으로 저장한다.
이는 구조 변경의 실제 비용 기록이며 대표 task의 반복 결과와 섞지 않는다.

## 비교 규칙

- 구조 지표의 감소가 correctness나 contract compatibility보다 우선하지 않는다.
- hotspot 줄 수는 architecture review signal이며 기계적인 max-lines gate가 아니다.
- root import 감소는 고변경 코드에서 평가하고 compatibility facade는 migration이
  끝날 때까지 유지한다.
- token 사용량이 제공되지 않으면 파일 크기나 tool call에서 추정하지 않는다.
