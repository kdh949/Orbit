# OOXML reference template fidelity reports

## 상태 요약

2026-07-22 기준 7개/139장 source inventory와 SHA-256은 재현됐지만 실제 product
full-deck 검증에 필요한 private managed storage, 승인 manifest/preview/license/font
evidence와 정식 Microsoft PowerPoint QA 환경이 준비되지 않았다. 아래 report는 누락을
숨기지 않기 위한 template별 `not-run` 기록이며 fidelity 통과 증거가 아니다.

| template                                          | version | slides | automated fixture | actual full-deck | PowerPoint | LibreOffice | rollout  |
| ------------------------------------------------- | ------: | -----: | ----------------- | ---------------- | ---------- | ----------- | -------- |
| [`simple-light`](simple-light.md)                 |       1 |     26 | passed            | not-run          | not-run    | not-run     | disabled |
| [`simple-dark`](simple-dark.md)                   |       1 |     26 | passed            | not-run          | not-run    | not-run     | disabled |
| [`operating-review`](operating-review.md)         |       1 |     31 | passed            | not-run          | not-run    | not-run     | disabled |
| [`business-review`](business-review.md)           |       1 |     14 | passed            | not-run          | not-run    | not-run     | disabled |
| [`project-kickoff`](project-kickoff.md)           |       1 |     12 | passed            | not-run          | not-run    | not-run     | disabled |
| [`team-alignment`](team-alignment.md)             |       1 |     24 | passed            | not-run          | not-run    | not-run     | disabled |
| [`market-trends-report`](market-trends-report.md) |       1 |      6 | passed            | not-run          | not-run    | not-run     | disabled |

`automated fixture`는 clone/slot/materialization/package/fidelity harness의 synthetic fixture
검증만 뜻한다. 실제 source full-deck나 사람 검수를 뜻하지 않는다. LibreOffice 결과로
PowerPoint 상태를 채우지 않는다.

승인 artifact는 Git에 커밋하지 않고 private QA storage의
`{templateId}/v{version}/...` 구조에 보관한다. report에는 artifact checksum과 renderer
version만 기록하며 source path, raw XML/text, storage key, signed URL, font/image bytes를
기록하지 않는다.
