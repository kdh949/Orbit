# OOXML reference template fidelity reports

## 상태 요약

2026-07-22 기준 7개/139장 source inventory와 SHA-256을 재현했고, 실제 원본 전체를
identity clone한 7개 package는 warning 0, `python-pptx` reopen과 LibreOffice PDF render를
통과했다. 다만 실제 product content-generated full-deck 검증에 필요한 private managed
storage, 승인 manifest/preview/license/font evidence와 정식 Microsoft PowerPoint QA 환경은
준비되지 않았다. identity clone 결과는 관계 보존 검증일 뿐 fidelity 승인 증거가 아니다.

| template                                          | version | slides | automated fixture | actual identity clone | actual full-deck | PowerPoint | rollout  |
| ------------------------------------------------- | ------: | -----: | ----------------- | --------------------- | ---------------- | ---------- | -------- |
| [`simple-light`](simple-light.md)                 |       1 |     26 | passed            | passed                | not-run          | not-run    | disabled |
| [`simple-dark`](simple-dark.md)                   |       1 |     26 | passed            | passed                | not-run          | not-run    | disabled |
| [`operating-review`](operating-review.md)         |       1 |     31 | passed            | passed                | not-run          | not-run    | disabled |
| [`business-review`](business-review.md)           |       1 |     14 | passed            | passed                | not-run          | not-run    | disabled |
| [`project-kickoff`](project-kickoff.md)           |       1 |     12 | passed            | passed                | not-run          | not-run    | disabled |
| [`team-alignment`](team-alignment.md)             |       1 |     24 | passed            | passed                | not-run          | not-run    | disabled |
| [`market-trends-report`](market-trends-report.md) |       1 |      6 | passed            | passed                | not-run          | not-run    | disabled |

`automated fixture`는 clone/slot/materialization/package/fidelity harness의 synthetic fixture
검증만 뜻한다. 실제 source full-deck나 사람 검수를 뜻하지 않는다. LibreOffice 결과로
PowerPoint 상태를 채우지 않는다.

`actual identity clone`은 exact source 전체 139장을 raw clone engine으로 다시 구성한
결과다. 7개 모두 package warning 0, slide count 일치, `python-pptx` reopen과
LibreOfficeDev 26.8.0.0.alpha0 PDF render를 통과했다. content plan/slot replacement를 거친
product full-deck가 아니며 임시 artifact는 Git에 포함하지 않는다.

승인 artifact는 Git에 커밋하지 않고 private QA storage의
`{templateId}/v{version}/...` 구조에 보관한다. report에는 artifact checksum과 renderer
version만 기록하며 source path, raw XML/text, storage key, signed URL, font/image bytes를
기록하지 않는다.
