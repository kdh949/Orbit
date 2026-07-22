# AI PPT OOXML chart slot spike

## 범위와 상태

Task 11a의 package replacement fixture를 실제 renderer에서 reopen/render한 기술 증거다.
승인된 7개 reference manifest의 chart slot 결과가 아니므로 Checkpoint C는 승인되지 않았다.

## Fixture artifact

2026-07-22에 다음 artifact를 `/private/tmp`에 생성했다. artifact는 Git에 포함하지 않는다.

| Artifact | SHA-256 | 결과 |
| --- | --- | --- |
| `/private/tmp/orbit-ooxml-chart-slot-generated.pptx` | `a213a10e13e66cecf021d55290d7f75e5244cd6f2805fd10b0ec4be97f91a815` | OOXML package validator warning 0 |
| `/private/tmp/orbit-ooxml-chart-slot-render/orbit-ooxml-chart-slot-generated.pdf` | `0d6025994630ab316c5d2d3616425bdd2f1a7c8b91187667df414c4f94c1e46a` | LibreOffice 1-page render |

fixture는 source bar/column chart의 두 series를 유지하면서 category를 3개로 바꾸고 chart
formula/cache와 embedded workbook cell을 함께 갱신했다. slide/chart relationship, frame,
chart style, workbook style와 number format preservation은 자동 테스트에서 비교했다.

## Renderer 결과

- LibreOfficeDev `26.8.0.0.alpha0`에서 PPTX reopen과 PDF export 성공
- Microsoft PowerPoint `16.111`에서 presentation reopen 성공, slide count `1` 확인 후
  저장하지 않고 종료

LibreOffice 결과를 Microsoft PowerPoint 검증으로 대체하지 않았으며 두 결과를 별도로
확인했다.

## 남은 승인 증거

- [ ] 승인된 manifest의 authoritative chart locator/workbook fingerprint
- [ ] 실제 reference template의 source/generated/diff montage
- [ ] 실제 font inventory를 고정한 PowerPoint/LibreOffice 비교
- [ ] Task 11b editor mutation → targeted sync → chart refresh/reopen
- [ ] 사람 검수와 Checkpoint C 승인
