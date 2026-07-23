# AI PPT OOXML reference editor round-trip spike

## 결론

Checkpoint B2는 아직 승인되지 않았다. 기존 OOXML import/sync/export 경로의 자동 통합
검증과 승인된 7개 text-slot actual package round-trip은 통과했지만 source/generated/diff
montage, exact font 환경과 사람 검수 결과가 없다. 이 문서는 통과한 증거와 제품 적용 전
남은 경계를 구분한다.

## 자동 검증 증거

2026-07-22에 implementation branch에서 다음 통합 테스트를 로컬 Postgres와 Python
worker에 연결해 실행했다.

```bash
ORBIT_DB_INTEGRATION=1 \
ORBIT_PYTHON_WORKER_URL=http://127.0.0.1:8000 \
PPTX_INTEGRATION_DATABASE_URL=postgresql://orbit:orbit@127.0.0.1:5432/orbit \
corepack pnpm exec vitest run \
  integration/pptx-ooxml-roundtrip.integration.spec.ts --passWithNoTests
```

결과는 1 suite, 6 tests 통과다. 이 suite는 다음 경로를 검증한다.

- import 후 text/frame 편집, OOXML sync, export와 re-import
- 누적 reorder 및 authored line/arrow/chart fallback 처리
- add/duplicate/delete/reorder/undo replay
- 역순으로 도착한 v2/v3 sync job의 직렬화와 최신 v3 수렴
- export 대기 중 최신 Deck version 재평가
- bounded wait 뒤에도 stale이면 과거 package를 반환하지 않고 실패

Task 6/7의 targeted fixture에서는 text/image replacement 후 package warning 0건,
slot locator의 imported `elementId` unique reconciliation, decoration lock mapping과
Deck/TemplateBlueprint/current package의 원자적 publication을 검증했다.

2026-07-23에는 승인된 7개 manifest에서 template별 text slot 1개를 실제 편집했다. 7개
모두 sync warning 0, unsupported operation 0, package warning 0, Python re-import text 일치와
LibreOffice reopen text 유지를 통과했다. 같은 exported package SHA-256을 Microsoft
PowerPoint 16.111에서 open, 8-page PDF render, close, reopen했고 repair/recovery 징후는
0건이었다. DrawingML letter spacing 지원 후 product materialization warning도 7개 모두
0건으로 재검증했다.

## Task 18에서 필요한 mutation gate

API와 Web 양쪽은 `referenceTemplateSnapshot`과 `slotEditPolicies`를 기준으로 다음 전용
allowlist를 구현하고 직접 HTTP bypass 회귀 테스트를 통과했다.

- slot `elementId`만 수정하고 `mutationPolicy`에 포함된 property만 허용
- 모든 slot의 frame, geometry, rotation과 `zIndex` 변경 거부
- non-slot과 decoration의 content/style/geometry 변경 거부
- element add/delete/duplicate와 slide add/delete/reorder 거부
- animation, relationship 및 package 구조를 직접 바꾸는 mutation 거부
- 직접 HTTP 요청도 동일하게 `409`와 typed issue code로 거부

일반 native/imported Deck에는 이 제한을 적용하지 않는다.

## 미완료 승인 증거

- [x] 승인된 7개 manifest의 실제 text slot edit
- [x] 해당 edit의 `pptx-ooxml-sync` warning 0건과 최신 package 확인
- [x] 해당 current package의 export와 PowerPoint/LibreOffice reopen
- [ ] source/generated/diff montage와 checksum inventory
- [ ] exact font checksum과 renderer별 calibration threshold
- [ ] 사람 검수 및 7개 확장 승인

위 증거가 준비되기 전에는 Checkpoint B2를 통과로 표시하지 않는다. LibreOffice 검증을
Microsoft PowerPoint 검증으로 대체하지 않는다.
