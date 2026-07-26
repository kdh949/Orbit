## 변경 요약

-

## 테스트/검증

- [ ] 수동 검증 결과를 아래 검증표에 기록
- [ ] `pnpm verify:pr --dry-run`으로 변경 범위 확인
- [ ] `pnpm verify:pr`
- [ ] 필요 시 `pnpm build`, `pnpm typecheck`, `pnpm test`
- [ ] 필요 시 수동 실행: `pnpm test:smoke`
- [ ] `node infra/scripts/check-env.mjs`
- [ ] `docker compose config --quiet`

## 검증표

| 범위 | 완료 기준 | 검증 방법                  | 테스트/증거 | 결과 |
| ---- | --------- | -------------------------- | ----------- | ---- |
|      |           | unit/API/Playwright/manual |             |      |

## 영향 범위

-

## 비고

-
