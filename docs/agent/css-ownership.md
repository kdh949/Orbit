# CSS ownership report

`editor-shell.css`와 `styles.css` entry의 local import graph를 따라가며 selector의
위치, 중복, 첫 selector anchor를 측정한다.

```bash
pnpm css:ownership
pnpm css:ownership -- --json
pnpm css:ownership -- apps/web/src/features/rehearsal/rehearsal-workspace-orbit.css
```

기본 보고서는 다음을 출력한다.

- 파일별 줄 수와 selector 수
- 같은 selector가 두 번 이상 선언된 위치
- selector의 첫 class, id, element anchor별 occurrence 수

이 보고서는 CSS를 자동으로 수정하지 않는다. 기본 실행은 두 entry의 import-only
aggregator 대신 실제 owner leaf 파일을 cascade 순서대로 측정한다. 같은 selector의
후순위 override는 중복으로 집계되더라도 자동 병합하지 않는다.

2026-07-26 owner extraction 직후 기준선은 selector 719개, occurrence 1,872개다.
완전히 같은 rule과 빈 rule을 제거하는 no-op cleanup 뒤에도 나머지는 시각 결과를
검토해야 하는 override 부채다. 장기 목표는 duplicate occurrence 500 이하이며,
token 치환과 selector 병합은 별도 시각 변경 PR에서 검증한다.
