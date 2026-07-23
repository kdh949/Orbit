# OOXML reference template fidelity reports

## 상태 요약

2026-07-23 기준 7개/139장 source inventory와 SHA-256을 재현했고 source 사용 권한과
139장/253개 version 1 text-only slot annotation을 승인했다. 이후 actual image slot 5개도
별도 승인해 4개 template-manifest version 2 proposal로 고정했지만 모두 `disabled`이며
source/QA storage/repository catalog mutation은 적용하지 않았다. actual identity clone 7개와 actual
content-generated 8장 full-deck 7개는 package warning 0, `python-pptx` reopen과
LibreOffice PDF/PNG render를 통과했다. local QA private storage의 source 7개, preview
139개와 QA-active strict manifest 7개, 총 153개 object도 checksum, canonical manifest
identity, versioning과 private ACL을 검증했다. 현재 상태 audit는
`/private/tmp/orbit-ooxml-qa-manifest-drift-audit-v2-WSyKlN`에 있고 `audit.json` SHA-256은
`455ec8689f1000b4360a0583b84df8af7955be56e034bc264119e41b66c965b6`이다. 이 QA-only
publication은 production managed storage를 대신하지 않는다.
승인 전 검수 snapshot과 승인 후 상태 결정은 각각
`/private/tmp/orbit-ooxml-private-catalog-review-9e2wd3pb`,
`/private/tmp/orbit-ooxml-private-catalog-decision-disabled-20260723`에 분리 보존한다. 후자의
`approval-decision.json` SHA-256은
`e30b9f5bbe9046b00c5f535f1b8ec3bf8dd8c6d8b50c539359f81dc0fa2cc0ad`이다. 이 결정은
QA strict manifest 게시 전 상태를 보존하며 현재 storage 사실은 위 drift audit가 supersede한다.
승인 provenance와 annotation review는 repository catalog에 반영했지만 repository와 production
rollout 상태는 모두 `disabled`다. QA bucket에는 runtime calibration object가 없다.

아래 표는 version 1 text-slot runtime baseline이다.

| template                                          | version | slides | identity clone | actual full-deck | actual slot edit | fidelity artifact | PowerPoint | rollout  |
| ------------------------------------------------- | ------: | -----: | -------------- | ---------------- | ---------------- | ----------------- | ---------- | -------- |
| [`simple-light`](simple-light.md)                 |       1 |     26 | passed         | passed           | passed           | generated/pending | passed     | disabled |
| [`simple-dark`](simple-dark.md)                   |       1 |     26 | passed         | passed           | passed           | generated/pending | passed     | disabled |
| [`operating-review`](operating-review.md)         |       1 |     31 | passed         | passed           | passed           | generated/pending | passed     | disabled |
| [`business-review`](business-review.md)           |       1 |     14 | passed         | passed           | passed           | generated/pending | passed     | disabled |
| [`project-kickoff`](project-kickoff.md)           |       1 |     12 | passed         | passed           | passed           | generated/pending | passed     | disabled |
| [`team-alignment`](team-alignment.md)             |       1 |     24 | passed         | passed           | passed           | generated/pending | passed     | disabled |
| [`market-trends-report`](market-trends-report.md) |       1 |      6 | passed         | passed           | passed           | generated/pending | passed     | disabled |

`actual full-deck`은 승인된 source와 manifest로 각 8장을 생성해 package, sequence,
capacity, overflow/overlap/crop과 LibreOffice 렌더를 검증한 결과다. Microsoft PowerPoint
16.111에서도 각 deck의 8장 open, PDF render, close, reopen을 별도로 통과했다.

`actual slot edit`은 version 1 template별 승인 text slot 1개를 편집해 sync/export하고 Python importer,
LibreOffice와 Microsoft PowerPoint에서 재개방한 결과다. 7개 모두 sync/OOXML package warning
0, unsupported operation 0, 편집 문구 유지와 PowerPoint 8장 reopen을 확인했다. DrawingML
letter spacing을 지원한 뒤 product materialization warning도 7개 모두 0건이다.

`actual identity clone`은 exact source 전체 139장을 raw clone engine으로 다시 구성한
결과다. 7개 모두 package warning 0, slide count 일치, `python-pptx` reopen과
LibreOfficeDev 26.8.0.0.alpha0 PDF render를 통과했다. Microsoft PowerPoint 16.111에서도
139장 open/PDF render/reopen과 clean close를 통과했다. content plan/slot replacement를 거친
product full-deck가 아니며 임시 artifact는 Git에 포함하지 않는다.

PowerPoint identity-control의 source와 raw clone을 각각 다시 렌더해 139장 exact pixel diff를
계산한 bundle은 `/private/tmp/orbit-ooxml-powerpoint-identity-control-20260723-a`에 있다.
7개 모두 changed pixel 0, open/render/reopen `passed`, checksum manifest 446/446 일치다.
template별 6~8장 source/clone/diff montage와 report를 포함하지만 approval/calibration은
`pending`이다. `summary.json` SHA-256은
`865ad3747a83939d99a5a516a79376352707349a5cb1a512de570c6d54490393`이다.

PowerPoint 자동화는 input alias/output file spec을 application tell 밖에서 만들고 export
완료를 기다리는 방식으로 실행했다. QA 구간의 repair/recovery/corrupt/font substitution 로그
match는 0건이고 종료 후 열린 presentation도 0개다. 이 자동 검증은 full locked-region
montage의 사람 승인, exact font checksum 또는 production managed storage를 대신하지 않는다.
승인 artifact는 Git에 커밋하지 않고 private QA storage에 보관하며 report에는 checksum과
renderer version만 기록한다.

LibreOffice 기반 generated fidelity review artifact는
`/private/tmp/orbit-ooxml-fidelity-artifacts-20260723-g`에 있다. 7개/56장의 source,
generated, intended-slot mask, locked-diff PNG와 source/generated/locked-diff montage를
계획 §7.4의 versioned 구조로 생성했고 package/font/fidelity manifest도 함께 기록했다.
package warning과 geometry/style/relationship drift는 전부 0이다. template별 locked pixel 차이는
6~615px이며 threshold를 적용하지 않았다. font manifest는 43~50개 substituted family를
기록하고 exact 38개와 substituted fallback 313개 resolved file checksum을 모두 보존한다.
fallback checksum은 요청 family 설치 증거가 아니다. report 자체의
`approvalStatus=pending`은 원본 artifact를 불변으로 보존한 값이다. 사용자는 2026-07-23
별도 decision artifact에서 7개 PowerPoint full-deck montage의 source identity와 B2
locked-diff 예외를 승인했다. exact font와 calibration threshold 전에는 전체 fidelity
gate를 `passed`로 해석하지 않는다.

승인/disabled canonical manifest를 사용한 full 139-slide LibreOffice identity candidate는
`/private/tmp/orbit-ooxml-identity-calibration-candidate-20260723-b`에 있다. source와 clone
render는 139/139 byte-identical, SSIM 1.0, changed pixel 0이고 locked structural/package
drift도 0이다. 461개 checksum은 모두 재계산 일치하지만 font는 exact 38/substituted 313이므로
candidate는 `runtimeEligible=false`, proposed threshold는 `null`이며 Task 8 approval을
충족하지 않는다.

PowerPoint app bundle과 Office CloudFonts를 읽기 전용으로 연결한 후의 별도 diagnostic
candidate는
`/private/tmp/orbit-ooxml-identity-calibration-candidate-office-fonts-20260723-a`에 있다.
7개/139장 identity metric은 동일하게 exact지만 font resolution은 exact 320,
substituted 31, unique substitution 8개다. font license와 exact family 및 사람 승인이
남아 `runtimeEligible=false`이고 runtime calibration으로 게시하지 않는다.

실제 text-slot 편집용 B2 visual artifact는
`/private/tmp/orbit-ooxml-b2-slot-montage-7cg9oi8q`에 있다. 7개 template의 편집 전/후,
slot mask, locked overlay, montage와 bounded report 43개 파일의 checksum을 재검산했다.
package/import warning과 structural drift는 0이고 `operating-review` 42px와 `simple-light`
72px의 locked pixel은 사용자가 각각 slot-mask 경계 antialiasing으로 승인했다. 나머지 다섯
template은 0px다. 승인 기록과 원본 request checksum은
`/private/tmp/orbit-ooxml-human-fidelity-review-decision-20260723`에 있다. 이 LibreOffice
기반 montage-only artifact는 기존 PowerPoint/LibreOffice reopen 증거나 full-deck
calibration을 대체하지 않는다.

actual source image 후보의 읽기 전용 감사 artifact는
`/private/tmp/orbit-ooxml-image-slot-candidates-v2-20260723-8vzdI7`에 있다. direct picture
19개 중 package-wide exclusive 후보는 5개이며 source-authored replacement intent 기준
high-confidence 4개, low-confidence 1개다. shared media target 14개는 제외했다.
`summary.json`과 `CHECKSUMS.sha256`의 SHA-256은 각각
`364bac762d035ce1d01dcfb2e0043f4b5c69e79b8aebd77e402099f946695426`,
`0b348dca0a7914c7a38c8bb4b6fe71231ae4974135c2d89fb98162a0d344212d`다.
사용자는 low-confidence cover를 포함한 5개 모두를 승인했다. 4개 disabled
template-manifest version 2 proposal은
`/private/tmp/orbit-ooxml-image-slot-manifest-proposals-v2-20260723-Mi7CX3`에 있으며
source/QA storage/catalog를 변경하지 않았다. capacity·effective content type·exclusive media와
기존 relationship을 보존한 actual image sync/export 5/5는
`/private/tmp/orbit-ooxml-image-slot-roundtrip-capacity-v2-20260723-a`에서 LibreOffice
render/reopen을 통과했고, 별도 Microsoft PowerPoint 16.111 5/5·총 96장 open/render/reopen과
target visual review는
`/private/tmp/orbit-ooxml-powerpoint-image-slot-roundtrip-capacity-v2-20260723-b`에서 통과했다.
round-trip과 PowerPoint summary SHA-256은 각각
`30a0250f1348e59321147295564bc1fcd95877b7caa9d34019d26d5cb67d71a1`,
`d173582a2892c831464476ae8fdf7ca6925aeebd5b29da952840aa20644df9b4`다.

승인된 253개 actual text slot의 sync 구조 matrix는 수정 전
`/private/tmp/orbit-ooxml-actual-text-slot-matrix-20260723-ew36f6m1`, 수정 후
`/private/tmp/orbit-ooxml-actual-text-slot-matrix-v2-20260723-60dgia3v`에 있다. generic sync가
추가하던 `bodyPr` overflow/wrap drift는 253건에서 0건으로 줄었고, 수정 후 7개 template
253/253 slot이 warning/unsupported/package/reimport warning 0으로 통과했다. target
frame/style과 locked geometry/style/relationship drift도 0이며 checksum 대상 8개는 모두
재계산 일치한다. text mutation에 따른 run/paragraph hierarchy rewrite 119건은 v2 gate에서
`bodyPr`/`lstStyle` exact, 494개 output style subtree의 original template byte-equivalence,
non-text/relationship semantics와 unclassified residual drift 0으로 분류했다. 이 matrix 자체는
PowerPoint 또는 사람 승인을 주장하지 않는다.

초기 full-deck bundle은 self-contained checksum caveat에 더해 source `docProps/app.xml`의 stale
slide title/count와 custom/thumbnail metadata를 보존해 승인 증거에서 제외했다. sanitizer 수정 후
self-contained 7개×8장 PowerPoint PPTX/PDF/PNG/montage/report bundle은
`/private/tmp/orbit-ooxml-powerpoint-full-deck-montage-metadata-fixed-20260723-b`에 있다. 7개 PPTX는
모두 `Slides=8`, stale/private metadata 0, package warning 0이다. 86개 파일 중
checksum manifest가 선언한 85개가 모두 일치하며 7개 report는 render/reopen `passed`다.
artifact 내부 approval 값은 불변인 `pending`이고 별도 사람 검수에서 7개 montage의
source-template identity는 승인됐다. `summary.json` SHA-256은
`5474bdc87e48d3ff9a1a20d64338cdf747b8fb66fe0575016aad5a820e2996aa`다.

actual text-slot 편집→sync/export 수정본 7개의 PowerPoint 16.111 open/PDF render/reopen 증거는
`/private/tmp/orbit-ooxml-powerpoint-slot-roundtrip-bodypr-fixed-20260723-a`에 있다. 편집값은
slot capacity에 맞춘 `ORBIT QA`이고 7개 PDF에서 모두 확인됐다. checksum manifest 22/22,
package warning 0, `Slides=8`, stale/private metadata 0이며 approval/font/human gate는 `pending`이다.
`summary.json` SHA-256은 `614fb1390c2297fd2021d660b4086ccec80df5b7bed8994f28167ef2c3053324`다.
