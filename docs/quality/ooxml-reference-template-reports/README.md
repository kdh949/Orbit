# OOXML reference template fidelity reports

## 상태 요약

2026-07-23 기준 7개/139장 source inventory와 SHA-256을 재현했고 source 사용 권한과
139장/253개 text-only slot annotation을 승인했다. actual identity clone 7개와 actual
content-generated 8장 full-deck 7개는 package warning 0, `python-pptx` reopen과
LibreOffice PDF/PNG render를 통과했다. local QA private storage의 153개 current object도
checksum과 private ACL을 검증했지만 production managed storage를 대신하지 않는다.

| template                                          | version | slides | automated fixture | actual identity clone | actual full-deck | PowerPoint | rollout  |
| ------------------------------------------------- | ------: | -----: | ----------------- | --------------------- | ---------------- | ---------- | -------- |
| [`simple-light`](simple-light.md)                 |       1 |     26 | passed            | passed                | passed           | not-run    | disabled |
| [`simple-dark`](simple-dark.md)                   |       1 |     26 | passed            | passed                | passed           | not-run    | disabled |
| [`operating-review`](operating-review.md)         |       1 |     31 | passed            | passed                | passed           | not-run    | disabled |
| [`business-review`](business-review.md)           |       1 |     14 | passed            | passed                | passed           | not-run    | disabled |
| [`project-kickoff`](project-kickoff.md)           |       1 |     12 | passed            | passed                | passed           | not-run    | disabled |
| [`team-alignment`](team-alignment.md)             |       1 |     24 | passed            | passed                | passed           | not-run    | disabled |
| [`market-trends-report`](market-trends-report.md) |       1 |      6 | passed            | passed                | passed           | not-run    | disabled |

`actual full-deck`은 승인된 source와 manifest로 각 8장을 생성해 package, sequence,
capacity, overflow/overlap/crop과 LibreOffice 렌더를 검증한 결과다. PowerPoint QA나 실제
원본 slot edit 승인을 뜻하지 않으며 LibreOffice 결과로 PowerPoint 상태를 채우지 않는다.

`actual identity clone`은 exact source 전체 139장을 raw clone engine으로 다시 구성한
결과다. 7개 모두 package warning 0, slide count 일치, `python-pptx` reopen과
LibreOfficeDev 26.8.0.0.alpha0 PDF render를 통과했다. content plan/slot replacement를 거친
product full-deck가 아니며 임시 artifact는 Git에 포함하지 않는다.

PowerPoint 앱은 설치되어 있지만 현재 자동화 세션에서 PowerPoint가 직접 저장한 빈 PPTX도
`open` 단계의 `-9074`로 실패했다. 따라서 7개 생성물의 PowerPoint render/reopen은
`not-run`이고 Checkpoint C/D2도 승인하지 않는다. 승인 artifact는 Git에 커밋하지 않고
private QA storage의
`{templateId}/v{version}/...` 구조에 보관한다. report에는 artifact checksum과 renderer
version만 기록하며 source path, raw XML/text, storage key, signed URL, font/image bytes를
기록하지 않는다.
