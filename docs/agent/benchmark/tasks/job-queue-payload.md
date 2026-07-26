# Job queue payload benchmark

`packages/job-queue/src/index.ts`에서 payload 선언 하나와 runtime adapter의 경계를
찾아, public API를 유지하면서 payload 관련 선언을 전용 모듈로 한 단계 추출하라.
관련 package test와 typecheck를 실행하라.
