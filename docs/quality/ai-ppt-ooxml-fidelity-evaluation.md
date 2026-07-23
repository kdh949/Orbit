# AI PPT OOXML reference fidelity 평가 기준 초안

## 현재 상태

Task 8의 fidelity harness는 identity control, intended-slot mask, locked-region metric과
structural hard gate까지 구현됐다. 2026-07-23에 7개 actual source 139장 identity clone의
package warning 0, `python-pptx` reopen과 LibreOffice render checksum을 재현했다. 같은 source와
승인 manifest로 생성한 7개 actual 8장 full-deck도 package/sequence/overflow/overlap/crop gate와
LibreOffice 56장 render를 통과했다. template별 checksum은
`ooxml-reference-template-reports/`에 기록한다.

identity clone 7개/139장도 Microsoft PowerPoint 16.111에서 open, 139-page PDF render,
close, reopen을 통과했다. 이어 actual source와 raw identity clone을 같은 renderer/version에서
각각 다시 PDF/PNG로 만들고 139장 exact pixel diff를 계산한 결과 changed pixel은 모두 0이었다.
6~8장 template별 montage, per-slide checksum과 bounded report는
`/private/tmp/orbit-ooxml-powerpoint-identity-control-20260723-a`에 보관한다. 이 baseline은
exact font checksum과 locked overlay 승인 대신으로 사용하지 않는다. `summary.json` SHA-256은
`865ad3747a83939d99a5a516a79376352707349a5cb1a512de570c6d54490393`이다.

Microsoft PowerPoint 16.111에서 7개 generated 8장 deck과 7개 actual text-slot
edit/export 결과를 각각 open, 8-page PDF render, close, reopen했고 repair/recovery 로그는
0건이었다. 7개 generated deck의 PowerPoint PPTX/PDF/56장 PNG/montage/report를 checksum이
완결된
`/private/tmp/orbit-ooxml-powerpoint-full-deck-montage-metadata-fixed-20260723-b`에 다시 묶었다.
이 bundle의 `summary.json` SHA-256은
`5474bdc87e48d3ff9a1a20d64338cdf747b8fb66fe0575016aad5a820e2996aa`다. LibreOffice 결과와
별도 artifact로 보관한다. 7개 generated deck의 56장
source/generated/mask/locked-diff와 세 종류 montage는
`/private/tmp/orbit-ooxml-fidelity-artifacts-20260723-g`에 생성했다. 모든 template의 structural
geometry/style/relationship drift는 0이며 locked pixel 차이는 사람 검수를 위해 수치 그대로
남겼다. package manifest warning도 7개 모두 0이다. font manifest는 template별 48~56개 explicit
family 중 4~7개만 exact resolve되고 43~50개가 substituted임을 기록했다. exact 38개와 fallback
substituted 313개를 포함한 351개 resolved font file checksum은 모두 기록·재검산했고 절대 경로는
manifest에 남기지 않았다. 다만 substituted checksum은 요청 family 설치 증거가 아니므로 요청한
exact font 환경과 사람이 승인한 renderer별 threshold 근거는 아직 완결되지 않았다. 따라서 특정
pixel 차이, SSIM 점수나 종합 점수를 승인 threshold로
간주하지 않으며 제품 rollout을 통과로 표시하지 않는다.

strict Checkpoint C runner의 최신 report는
`/private/tmp/orbit-ooxml-checkpoint-c-report-20260723-metadata-fixed-final/summary.json`이다. 7개
자동 검증은
모두 통과했지만 derived PowerPoint evidence에 `FONT_AVAILABILITY_VALIDATION_PENDING`을
보존했으므로 공식 상태는 `failed`다. 폰트 설치와 exact file checksum을 확인한 뒤에만 이
warning을 제거하고 Checkpoint를 재실행한다.

초기 generated bundle은 source `docProps/app.xml`의 전체 slide title 목록과 stale slide count,
custom property와 thumbnail을 보존하는 결함 때문에 승인 증거에서 제외했다. clone 경계는 이제
root relationship으로 core/extended part를 찾고 private property/thumbnail을 제거하며
`Slides`/`HiddenSlides`를 선택된 slide 기준으로 재계산한다. metadata-fixed 7개 package는
`Slides=8`, stale/private metadata 0, package warning 0을 독립 전수 검산했다. actual text-slot
편집본의 수정 후 PowerPoint evidence는
`/private/tmp/orbit-ooxml-powerpoint-slot-roundtrip-bodypr-fixed-20260723-a`이고 `summary.json`
SHA-256은 `614fb1390c2297fd2021d660b4086ccec80df5b7bed8994f28167ef2c3053324`다.

실제 7개 package에서 발견된 DrawingML `a:rPr@spc`는 importer, shared rich-text schema,
editor measure/render, sync와 export까지 보존하도록 구현했다. 같은 deterministic package의
materialization warning은 7개 모두 0건으로 재검증했다.

기존 `pptx_quality.py`의 일반 SSIM 기본값 `0.95`와 System Design Pack engineering score
`85`는 이 모드의 승인 threshold가 아니다.

## 비교 모드

### Identity control

source slide를 content 변경 없이 clone한다. 전체 slide와 locked region을 모두 비교하고,
locked geometry/z-order/style exact match 및 package warning 0건을 hard gate로 사용한다.
no-op 결과가 이 gate를 통과하지 못하면 generated comparison을 평가하지 않는다.

### Generated comparison

slot replacement 결과를 source와 비교한다. manifest locator로 만든 intended slot mask
안의 pixel 변화만 의도된 변경으로 제외한다. mask 밖은 locked region이며 geometry,
style, relationship 및 시각 drift를 평가한다. mask가 shape frame 밖으로 확장되거나 locked
object와 교차하면 hard failure다.

placeholder slot에 직접 `a:xfrm`이 없으면 slide layout과 master의 `p:ph` 상속 chain을
해석한다. slide→layout은 exact `idx`, layout→master는 `ctrTitle→title`과 content 계열→`body`
의미 type을 사용하고 unique match만 허용한다. 상속 geometry가 없거나 모호하면 mask를
추정하지 않고 fail-closed한다.

per-slide report는 최소한 다음을 기록한다.

- `sourceSlideId`, mode, source/generated artifact checksum
- intended slot mask checksum과 pixel count
- whole-image SSIM과 locked-region SSIM
- locked geometry/style/z-order 및 layout/master/theme relationship drift count
- package/relationship warning code

whole-deck report는 slide 수, evaluated/missing count, minimum/average locked-region metric과
모든 structural issue code를 집계한다. pixel 평균 하나로 pass를 결정하지 않는다.

## Structural hard gate

다음은 점수와 관계없이 `failed`다.

- PowerPoint reopen 실패 또는 package validator error
- master/layout/theme relationship drift
- locked shape geometry, z-order 또는 style drift
- source 없는 authored element
- unresolved relationship, duplicate part/ID, content type mismatch
- slot capacity, overlap, overflow 또는 crop policy 위반
- OOXML sync/export warning

identity-control에서는 locked geometry exact match와 package warning 0건을 우선 고정한다.

## 필수 환경과 provenance

다음 값이 하나라도 없으면 report status는 `passed`가 아니라 `not-run`이다.

- renderer 이름과 exact version
- renderer가 실제 resolve한 font family/file checksum
- source PPTX SHA-256
- strict template manifest SHA-256
- source/generated/mask/report artifact SHA-256
- template ID/version과 evaluation mode

PowerPoint와 LibreOffice 결과는 별도 renderer baseline으로 저장한다. LibreOffice 결과를
PowerPoint QA로 대체하거나 두 renderer의 정상 차이를 하나의 threshold로 숨기지 않는다.

runtime은 package의 explicit font family를 `fc-match`로 exact resolve하고 실제 font file
checksum을 기록한다. 요청 family가 resolve된 family 집합에 없으면 substitution으로 보고
render-validation을 fail-closed한다.

2026-07-23 현재 QA fontconfig 비교에서는 unique 50개 explicit family가 exact resolve되지
않았다. `/private/tmp/orbit-ooxml-font-gap-20260723-a.json`의 family를 설치하거나 exact alias와
file checksum을 제공해야 한다. PowerPoint의 resolved font evidence는 이 결과와 별도로
수집한다.

PowerPoint app bundle과 Office CloudFonts를 읽기 전용 fontconfig directory로 추가한
diagnostic calibration은
`/private/tmp/orbit-ooxml-identity-calibration-candidate-office-fonts-20260723-a`에 있다.
7개/139장 SSIM 1.0, changed pixel 0, structural pass와 checksum 461/461을 유지하면서 351개
resolution은 exact 320/substituted 31, unique substitution 8개로 줄었다. 그러나 app/cache
font의 cross-application license, embedded-only 4개와 exact source가 없는 4개, 사람
threshold 승인이 남아 `runtimeEligible=false`와
`proposedLockedRegionSsimThreshold=null`을 유지한다. 진단 분류 SHA-256은
`494208e0196867805d29e1a727e7a8e1e92a7a6a361c7496632d2da92bd758b0`이다.

artifact는 Git이 아닌 `/tmp` 또는 승인된 private QA storage에 다음 구조로 둔다.

```text
{templateId}/v{version}/
  baseline/source-slide-*.png
  generated/generated-slide-*.png
  diff/intended-slot-mask-slide-*.png
  diff/locked-overlay-slide-*.png
  montage/source.png
  montage/generated.png
  montage/locked-diff.png
  manifests/package.json
  manifests/font.json
  manifests/fidelity-report.json
```

manifest와 report에는 raw XML, source text, image/font bytes, absolute path, storage key,
signed URL을 넣지 않는다.

## Threshold calibration

threshold는 아래 7개 template/version의 no-op identity-control을 동일한 deterministic
환경에서 측정한 뒤에만 제안할 수 있다.

- `simple-light`
- `simple-dark`
- `operating-review`
- `business-review`
- `project-kickoff`
- `team-alignment`
- `market-trends-report`

각 baseline evidence는 template ID/version, renderer/version, font checksum, source 및
report checksum, locked-region metric 분포와 structural gate 결과를 포함한다. 하나라도
빠지면 threshold status는 `not-calibrated`, `applied=false`이고 전체 report는 `not-run`이다.

활성 runtime은 private storage의 고정된 versioned calibration object를 시작 시 읽고 object
metadata SHA-256과 strict schema를 검증한다. exact 7개 `templateId@1`, 하나의
renderer/version, `geometryEdgeTolerancePx=0`, threshold와 승인 rationale가 없으면 runtime
구성 자체가 실패한다. calibration locator는 report와 로그에 기록하지 않는다.

7개 측정 후 calibration report는 renderer별 정상 변동, 선택한 tolerance, outlier와 그
근거를 기록한다. 리뷰 없이 임의 숫자를 추가하거나 낮춰서 실패를 통과시키지 않는다.

2026-07-23 LibreOffice 26.8.0.0 no-op identity candidate는
`/private/tmp/orbit-ooxml-identity-calibration-candidate-20260723-b`에 생성했다. repository
catalog가 참조하는 승인/disabled canonical manifest 7개와 source checksum을 사용해 139장을
측정했고, source/identity-clone PNG는 모두 byte-identical, locked-region SSIM 최소/평균/최대
`1.0`, changed pixel과 geometry/style/relationship drift 및 package warning은 모두 0이었다.
`checksums.json`의 461개 entry는 실제 파일 집합과 일치하고 재계산 SHA-256도 461/461
일치한다. candidate SHA-256은
`1945a9cff42e8930711d615f42b0bbb32449b98476c5d1755c02daa22bba2925`,
checksum manifest SHA-256은
`43a9108f4fff71118da33a5d72c81780bb4aede8f3ef0b7bed5fccb0f07bcdf9`다.

현재 font 결과는 exact 38, substituted 313, unavailable 0이므로 candidate는
`status=pending-approval`, `applied=false`, `runtimeEligible=false`,
`proposedLockedRegionSsimThreshold=null`이다. 이 값은 LibreOffice identity-control의
측정 증거일 뿐이며 exact-font 재측정과 사람 threshold 승인이 끝날 때까지 runtime
`calibration.json`으로 변환하거나 private storage에 publication하지 않는다.

## 승인 전 체크리스트

- [x] 7개 identity-control package/LibreOffice baseline과 checksum이 재현됨
- [x] PowerPoint와 LibreOffice renderer별 결과가 분리됨
- [x] PowerPoint 7개/139장 source↔identity clone pixel diff와 montage가 생성됨
- [x] known geometry/style/relationship/package drift fixture가 실패함
- [x] intended slot mask 밖 drift가 실패함
- [x] 7개 generated full-deck의 56장 source/generated/mask/locked-diff와 montage가 생성됨
- [x] PowerPoint 7개 generated full-deck의 56장 PNG/montage/report가 생성됨
- [x] 7개 실제 text-slot 편집 전/후/mask/locked-overlay/montage가 생성됨
- [x] 253개 실제 text-slot의 `bodyPr`/frame/style/locked structure matrix가 통과함
- [ ] threshold와 tolerance 근거가 사람 검수됨

편집 artifact는 `/private/tmp/orbit-ooxml-b2-slot-montage-7cg9oi8q`에 있으며 structural drift와
package/import warning은 0이다. `operating-review` 42px와 `simple-light` 72px의 locked pixel은
mask 경계 anti-alias 후보지만 사람이 승인하지 않았으므로 `LOCKED_PIXEL_DIFF_REVIEW_PENDING`이다.
253-slot 구조 matrix는
`/private/tmp/orbit-ooxml-actual-text-slot-matrix-v2-20260723-60dgia3v`에 있으며 `bodyPr`,
`lstStyle`, target frame/style과 locked geometry/style/relationship drift가 모두 0이다.
119개 hierarchy rewrite의 494개 output style subtree는 original style template과 byte-equivalent,
non-text/relationship semantics와 unclassified residual drift는 0이다. 이는 실제 image slot 또는
사람 visual approval을 대체하지 않는다.

요청한 exact font 설치와 사람의 locked-diff/threshold 승인이 남아 있으므로 전체 calibration은
`not-calibrated`, `applied=false`를 유지한다. artifact report의 `status=generated`는 파일 생성과
structural 비교 완료만 뜻하며 `approvalStatus=pending`을 fidelity 승인으로 승격하지 않는다.
