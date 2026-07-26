# CSS ownership report

`editor-shell.css`와 `styles.css`의 cascade를 분리하기 전에 selector의 위치,
중복, 첫 selector anchor를 측정한다.

```bash
pnpm css:ownership
pnpm css:ownership -- --json
pnpm css:ownership -- apps/web/src/features/rehearsal/rehearsal-workspace-orbit.css
```

기본 보고서는 다음을 출력한다.

- 파일별 줄 수와 selector 수
- 같은 selector가 두 번 이상 선언된 위치
- selector의 첫 class, id, element anchor별 occurrence 수

이 보고서는 CSS를 자동으로 수정하지 않는다. Extraction PR에서는 기존 rule
순서와 selector text를 유지하고, 이동 후 production build와 visual regression을
검증한다. Duplicate selector 병합과 token 치환은 별도 동작 변경 PR로 진행한다.
