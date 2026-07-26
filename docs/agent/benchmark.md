# AI Agent Efficiency Benchmark

이 benchmark는 Git으로 추적되는 ORBIT repository tree의 구조 지표와 실제 Agent
작업 지표를 분리한다. 파일 조회 수·tool call·token 사용량은 실행 환경이 제공한
실제 값만 기록한다.

## Snapshot identity

schema v3 snapshot은 측정 대상의 Git identity를 함께 기록한다.

- `headCommit`
- `treeHash`
- `workingTreeDirty`
- `toolVersion`
- `capturedAt`

dirty working tree에서는 baseline snapshot 생성을 기본 거부한다. 진행 중인 구조를
임시로 확인할 때만 `--allow-dirty`를 명시한다.

```bash
pnpm agent:benchmark snapshot
pnpm agent:benchmark snapshot --allow-dirty
pnpm agent:benchmark snapshot --ref origin/develop
```

`--ref`는 해당 Git object tree를 임시 디렉터리에서 측정한다. 저장된 baseline은
반드시 실제 commit과 tree hash를 함께 기록한다.

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

`docs/agent/benchmarks/baseline.json`은 Agent 효율 리팩터링 직전의 Git commit
`3b045d7b8fdcf7adb1121227879adf316c865c4c`과 tree
`78eb72732526a350f3381ab9226ecfca430d36fa`를 기준으로 한다.

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

## 비교 규칙

- 구조 지표의 감소가 correctness나 contract compatibility보다 우선하지 않는다.
- hotspot 줄 수는 architecture review signal이며 기계적인 max-lines gate가 아니다.
- root import 감소는 고변경 코드에서 평가하고 compatibility facade는 migration이
  끝날 때까지 유지한다.
- token 사용량이 제공되지 않으면 파일 크기나 tool call에서 추정하지 않는다.
