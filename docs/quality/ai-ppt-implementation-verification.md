# AI PPT 디자인 팩 구현·검증 ledger

## 범위

Phase 0~3의 Task 1~19를 구현했다. 자동화 가능한 acceptance와 verification은 모두 통과했으며, 사람이 직접 평가해야 하는 항목은 통과로 표시하지 않았다.

## Checkpoint 상태

| Checkpoint | 구현 및 자동 검증 | 남은 외부 검증 |
| --- | --- | --- |
| A 발행 안전성 | P0/P1 publication 차단, bounded repair/safe remap, final whole-deck diagnostics, editor image occlusion warning | 없음 |
| B 자동 선택 MVP | topic-only Neutral 선택, 기존 request 계약 유지, pack/version/layout provenance snapshot | current 대비 사람 blind comparison |
| C 네 pack 품질 | 네 family 고정 fixture, silhouette 4종 이상, 인접 반복 0, P0/P1 0, native PPTX export | current 대비 사람 blind preference 70% |
| D 제품 적용 | 자동/수동 선택, pack별 flag, safe fallback, Compose smoke | 사람 blind preference, 발표 가능성 4/5, provider 포함 full-deck p95 |

Checkpoint B~D의 외부 평가가 끝나기 전에는 engineering gate 통과와 제품 승인 통과를 구분한다. 현재 운영 판단은 제한 rollout 가능, 전면 rollout 보류다.

## 최종 자동 검증

2026-07-22에 다음 결과를 확인했다.

- `pnpm build`: 10개 package 통과
- `pnpm lint`: 10개 package 통과
- `pnpm test`: 전체 통과; Web 1,803, API 603, Worker 392 tests 포함
- Python: Ruff 통과, Mypy 72 source files 통과, Pytest 824 passed / 1 skipped
- 환경: `node infra/scripts/check-env.mjs`와 `docker compose config --quiet` 통과
- Compose: API liveness/readiness, Python health, Web 200, Worker ready 확인
- Compose 내부 pack smoke: 17 passed
- golden report: 네 family 모두 engineering score 100, publication P0/P1 0

Web production build에는 기존 dynamic/static import와 500kB 이상 chunk warning이 남지만 build 실패는 아니다. Python test에는 dependency deprecation warning이 남는다.

## 조건부 Task 20

Task 20 OOXML spike는 수행하지 않았다. Checkpoint C의 native pack 자동화 gate가 통과했고, reference source의 라이선스와 font 재배포 조건 및 사람 선호 우위가 확인되지 않아 trigger 조건이 성립하지 않았다. 상세 근거는 `docs/quality/ai-ppt-checkpoint-c.md`에 기록했다.
