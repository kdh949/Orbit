# OOXML reference template fidelity reports

## 상태 요약

2026-07-23 기준 7개/139장 source inventory와 SHA-256을 재현했고 source 사용 권한과
139장/253개 text-only slot annotation을 승인했다. actual identity clone 7개와 actual
content-generated 8장 full-deck 7개는 package warning 0, `python-pptx` reopen과
LibreOffice PDF/PNG render를 통과했다. local QA private storage의 153개 current object도
checksum과 private ACL을 검증했지만 production managed storage를 대신하지 않는다.

| template                                          | version | slides | identity clone | actual full-deck | actual slot edit | PowerPoint | rollout  |
| ------------------------------------------------- | ------: | -----: | -------------- | ---------------- | ---------------- | ---------- | -------- |
| [`simple-light`](simple-light.md)                 |       1 |     26 | passed         | passed           | passed           | passed     | disabled |
| [`simple-dark`](simple-dark.md)                   |       1 |     26 | passed         | passed           | passed           | passed     | disabled |
| [`operating-review`](operating-review.md)         |       1 |     31 | passed         | passed           | passed           | passed     | disabled |
| [`business-review`](business-review.md)           |       1 |     14 | passed         | passed           | passed           | passed     | disabled |
| [`project-kickoff`](project-kickoff.md)           |       1 |     12 | passed         | passed           | passed           | passed     | disabled |
| [`team-alignment`](team-alignment.md)             |       1 |     24 | passed         | passed           | passed           | passed     | disabled |
| [`market-trends-report`](market-trends-report.md) |       1 |      6 | passed         | passed           | passed           | passed     | disabled |

`actual full-deck`은 승인된 source와 manifest로 각 8장을 생성해 package, sequence,
capacity, overflow/overlap/crop과 LibreOffice 렌더를 검증한 결과다. Microsoft PowerPoint
16.111에서도 각 deck의 8장 open, PDF render, close, reopen을 별도로 통과했다.

`actual slot edit`은 template별 승인 text slot 1개를 편집해 sync/export하고 Python importer,
LibreOffice와 Microsoft PowerPoint에서 재개방한 결과다. 7개 모두 sync/OOXML package warning
0, unsupported operation 0, 편집 문구 유지와 PowerPoint 8장 reopen을 확인했다. DrawingML
letter spacing을 지원한 뒤 product materialization warning도 7개 모두 0건이다.

`actual identity clone`은 exact source 전체 139장을 raw clone engine으로 다시 구성한
결과다. 7개 모두 package warning 0, slide count 일치, `python-pptx` reopen과
LibreOfficeDev 26.8.0.0.alpha0 PDF render를 통과했다. content plan/slot replacement를 거친
product full-deck가 아니며 임시 artifact는 Git에 포함하지 않는다.

PowerPoint 자동화는 input alias/output file spec을 application tell 밖에서 만들고 export
완료를 기다리는 방식으로 실행했다. QA 구간의 repair/recovery/corrupt/font substitution 로그
match는 0건이고 종료 후 열린 presentation도 0개다. 이 자동 검증은 full locked-region
montage의 사람 승인, exact font checksum 또는 production managed storage를 대신하지 않는다.
승인 artifact는 Git에 커밋하지 않고 private QA storage에 보관하며 report에는 checksum과
renderer version만 기록한다.
