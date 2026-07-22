# AI PPT OOXML reference fidelity 평가 기준 초안

## 현재 상태

Task 8의 fidelity harness는 identity control, intended-slot mask, locked-region metric과
structural hard gate까지 구현됐다. 다만 7개 template의 실제 identity-control baseline,
Microsoft PowerPoint 결과와 threshold 근거는 아직 수집되지 않았다. 따라서 특정 SSIM
점수나 종합 점수를 승인 threshold로 간주하지 않으며, Checkpoint B1/B2 및 제품 rollout을
통과로 표시하지 않는다.

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

per-slide report는 최소한 다음을 기록한다.

- `sourceSlideId`, mode, source/generated artifact checksum
- intended slot mask checksum과 pixel count
- whole-image SSIM과 locked-region SSIM
- locked geometry/style/z-order drift count
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

artifact는 Git이 아닌 `/tmp` 또는 승인된 private QA storage에 다음 구조로 둔다.

```text
{templateId}/v{version}/
  baseline/source-slide-*.png
  generated/generated-slide-*.png
  diff/locked-overlay-slide-*.png
  montage/source.png
  montage/generated.png
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

7개 측정 후 calibration report는 renderer별 정상 변동, 선택한 tolerance, outlier와 그
근거를 기록한다. 리뷰 없이 임의 숫자를 추가하거나 낮춰서 실패를 통과시키지 않는다.

## 승인 전 체크리스트

- [ ] 7개 identity-control baseline과 checksum이 재현됨
- [ ] PowerPoint와 LibreOffice renderer별 결과가 분리됨
- [ ] known geometry/style/package drift fixture가 실패함
- [ ] intended slot mask 밖 drift가 실패함
- [ ] threshold와 tolerance 근거가 사람 검수됨

현재 위 항목은 승인 완료로 표시하지 않는다.
