# AI Agent Efficiency Benchmark

이 benchmark는 구조 지표와 실제 Agent 작업 지표를 분리한다. 구조 지표는 저장소에서
자동 계산하고, 파일 조회 수·tool call·token 사용량은 동일한 작업을 새 세션에서
반복해 실제 값만 기록한다.

## 구조 기준선

현재 구조를 출력한다.

```bash
pnpm agent:benchmark snapshot
```

저장된 기준선의 schema를 검사하고 현재 값과 비교한다.

```bash
pnpm agent:benchmark validate docs/agent/benchmarks/baseline.json
pnpm agent:benchmark compare docs/agent/benchmarks/baseline.json
```

자동 구조 지표:

- package `src` 직접 import 파일 수
- `@orbit/shared`, `@orbit/editor-core` root import 파일 수
- GitHub Actions workflow 수
- domain manifest와 scoped `AGENTS.md` 수
- 주요 production, test, CSS hotspot 줄 수

## 실제 Agent 작업 측정

```bash
pnpm agent:benchmark tasks
```

각 작업을 같은 commit과 prompt, 새 세션에서 3회 실행한다. 한 번의 run에는 다음을
기록한다.

- 첫 patch 전 읽은 파일 수
- 읽은 최상위 영역 수
- 첫 targeted test까지 tool call 수
- 검증한 workspace 수
- 첫 targeted test까지 시간
- 전체 작업 시간
- rollback 또는 잘못된 파일 수정 횟수

Token 사용량은 실행 환경이 제공한 실제 값만 기록한다. 제공되지 않으면
`unavailable`로 남기고 파일 크기나 tool call에서 추정하지 않는다.

## 비교 규칙

- 구조 지표의 감소가 correctness나 contract compatibility보다 우선하지 않는다.
- hotspot 줄 수는 architecture review signal이며 기계적인 max-lines gate가 아니다.
- root import 감소는 고변경 코드에서 평가하고 compatibility facade는 migration이
  끝날 때까지 유지한다.
- 전체 검증 비율은 shared schema, migration, queue payload, root config 변경을
  제외한 작업에서 비교한다.
- prompt, transcript, presenter script, credential, 개인식별정보를 benchmark
  결과에 기록하지 않는다.
