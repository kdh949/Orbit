# OOXML reference source slide/slot annotation specification

## 상태

이 문서는 Task 4의 검수 계약과 승인 기록이다. 2026-07-23 사용자 검수에서 inventory의
7개 원본 139장과 이에 대응하는 text-only slot annotation 253개를 승인했다. repository
catalog에는 원본별 검토 manifest checksum과 합계만 기록하며 private locator, 원문과
render artifact는 기록하지 않는다.

이 승인은 source authorization과 text-only annotation 범위에 한정된다. 승인된 canonical
manifest와 cover/body를 포함한 139개 preview checksum은 local QA private storage에서
검증했지만 production managed storage를 대신하지 않는다. Microsoft PowerPoint 16.111의
generated/slot-edit package open/render/reopen은 별도 통과했지만 embedded/exact font
checksum과 production publication, full fidelity 사람 승인은 아직 미검증이므로
repository의 7개 template은 모두 `disabled`다. source/contract 자동 기준과 사람 승인은
충족했지만 §15의 production private managed storage가 없어 Checkpoint A도 정식 통과
처리하지 않는다.

원본 PPTX, 원문 XML, source filename/절대 경로, preview/render binary, font와 storage
key는 Git·manifest·로그에 넣지 않는다. repository에는 승인 가능한 strict annotation과
checksum만 둔다.

## Spike template 선정

security/provenance gate를 통과한 candidate만 비교한다. 선정은 입력 순서와 전체 slide
수에 의존하지 않고 다음 tuple을 사용한다.

1. 8, 9, 10장 각각을 구성할 수 있는지, cover와 closing이 있는지 확인한다.
2. `supportedLocatorCoverage` 내림차순
3. `roleCoverage` 내림차순
4. `capacityEligibleSlideCount` 내림차순
5. eligible unique source slide 수 내림차순
6. 최종 tie-break는 `templateId`, `version` 오름차순

`supportedLocatorCoverage`의 분자는 stable locator와 허용 mutation을 모두 가진 direct
slide text/image/table/chart object 수다. 분모는 decoration을 제외한 content-bearing
candidate object 수다. unsupported SmartArt와 animation은 분모에는 남겨 source의 지원
가능성을 과대평가하지 않지만 editable slot에는 포함하지 않는다. 선정 report에는 위
수치, cover/closing, role별 eligible count, capacity 실패 code와 `[8, 9, 10]` 가능 여부를
기록한다. 단순 `slideCount`는 ranking criterion이 아니다.

8~10장 spike annotation은 cover 1장과 closing 1장을 필수로 하고, 나머지 source에서
agenda/statement/summary와 metric/comparison/chart/table/process/timeline/team-role/evidence
중 fixture가 요구하는 role 및 capacity를 만족해야 한다. 같은 source의 인접 반복은
허용하지 않는다. 실제 source가 서로 다른 slide에서 같은 layout을 공유하면 인접 배치를
허용하되 layout 다양성 하한은 `min(ceil(generated * 0.4), eligible layout 수)`로 계산한다.

## Source slide 형식

각 `sourceSlides[]` entry는 다음 strict field만 가진다.

- `sourceSlideId`: template version 안에서 유일한 stable ID
- `sourceSlidePart`: `ppt/slides/slideN.xml`
- `sourceOrder`: presentation의 1-based order
- `semanticRole`: shared 계약의 source role enum
- `relationships`: `layoutPart`, `masterPart`, `themePart`
- `capacity`: content type별 editable slot count
- `previewId`
- `lockedInventorySha256`: non-slot relationship/shape inventory checksum
- `slots`: 이 slide에 속한 editable slot만 포함

source ID, part, order는 각각 유일해야 한다. relationship identity와 locked checksum은
실제 package와 일치해야 하며 caller가 제공한 path/index를 신뢰하지 않는다.

## Slot manifest 형식

```json
{
  "slotId": "operating-review-v1-slide-07-body",
  "semanticRole": "body",
  "contentType": "text",
  "required": true,
  "locator": {
    "slidePart": "ppt/slides/slide7.xml",
    "shapeId": "12",
    "placeholderType": "body",
    "relationshipId": null
  },
  "capacity": {
    "maxChars": 220,
    "maxLines": 7,
    "maxParagraphs": 5,
    "maxBulletDepth": 2
  },
  "mutationPolicy": ["text-content"],
  "replacementPolicy": { "overflow": "fail" }
}
```

- 모든 content type은 `slotId`, semantic/content role, required 여부, locator, capacity,
  mutation policy와 overflow policy를 명시한다.
- locator는 positional index가 아니라 `slidePart + shapeId + relationshipId` identity다.
  slot ID와 locator tuple은 manifest 전체에서 중복될 수 없다.
- locator의 slide part는 부모 source slide와 같아야 한다. image/chart는 authoritative
  relationship ID가 필수다.
- image relationship은 internal media part를 package 전체에서 단독 참조해야 하고 해당
  slide의 `a:blip`도 한 번만 embed해야 한다. 같은 media part 또는 relationship을 다른
  picture가 공유하면 `shared_image_media_target`으로 annotation을 거부하고 runtime도
  `OOXML_REFERENCE_IMAGE_MEDIA_SHARED`로 원본 package를 그대로 반환한다.
- text는 max chars/lines/paragraphs/bullet depth, image는 aspect ratio/crop/alpha/mask,
  table은 fixed grid/merge policy/editable cell fingerprint, chart는 supported chart type과
  category/series 및 embedded workbook fingerprint를 기록한다.
- 허용 mutation은 각각 `text-content`, `image-source`, `table-cell-text`, `chart-data`뿐이다.
  frame 좌표, 크기, rotation, zIndex, shape geometry와 style mutation은 없다.
- capacity count는 실제 `slots[]`와 일치해야 하며 overflow는 fail-closed한다.
- unknown field, raw XML/text, local path, signed URL, storage key는 거부한다.

### Chart slot package mutation 경계

chart slot은 direct `p:graphicFrame`의 stable `shapeId`와 unique internal chart
relationship을 모두 확인한 경우에만 활성화한다. chart는 manifest가 허용한 `bar`,
`column`, `line`, `pie`, `doughnut` 중 실제 source type과 일치해야 하며, combo chart와
그 밖의 chart type은 preserve-only다.

embedded workbook은 unique internal `.xlsx` package relationship과 manifest의 SHA-256
fingerprint가 일치해야 한다. generation replacement는 source series 수를 유지하고
annotated category/series capacity 안에서 direct absolute worksheet range만 수정한다.
chart formula/cache와 workbook cell은 함께 갱신하며 source number format, chart style,
frame geometry, slide/chart relationship은 보존한다. external workbook, ambiguous
relationship, unsupported formula/range, fingerprint drift가 있으면 package 원본을
반환 가능한 error에 포함해 fail-closed하고 authored chart fallback을 만들지 않는다.

## Editable slot 제외 규칙

다음 object는 slot으로 annotation하지 않고 locked inventory에만 포함한다.

- 장식용 shape, background와 non-content visual
- slide master와 slide layout의 모든 object
- unsupported SmartArt/diagram
- animation/timing 대상 object
- external workbook/media relationship, OLE, embedded package와 linked content
- 둘 이상의 picture/relationship이 같은 media part를 공유해 독립 교체할 수 없는 image
- stable direct locator 또는 bounded mutation policy를 만들 수 없는 object

제외 object를 slot locator로 지정하면 각각 stable issue code로 validation을 실패시킨다.
도구가 조용히 authored fallback slot을 만들거나 System Design Pack으로 전환해서는 안 된다.

## 사람 검수 규칙

- source-slide catalog와 montage에서 cover/closing 및 8~10장 role 흐름을 확인한다.
- editable mask가 실제 content object만 포함하고 decoration/master/layout을 침범하지
  않는지 확인한다.
- 각 slot의 semantic role과 한국어 capacity를 실제 교체 문구로 검토한다.
- table/chart locator와 embedded workbook policy를 package reopen으로 확인한다.
- source checksum, manifest checksum, font/provenance 승인 상태를 확인한다.

2026-07-23 승인 범위와 repository catalog의 검토 checksum은 다음과 같다.

| template ID | slides | approved text slots | reviewed manifest SHA-256 |
| --- | ---: | ---: | --- |
| `simple-light` | 26 | 39 | `b74c8b380fc7e0851ead94b9a9d59db0e6675536ea5e3276629e9310b9847a51` |
| `simple-dark` | 26 | 39 | `47463ab9eda2bf57fea9f927df5b921a01dc9007d54e805cfdcd4c2ec98f70c7` |
| `operating-review` | 31 | 65 | `cfd23df7c920e9d45a4d425ea242eba88f9d3fc54f53be0276717eea368edb34` |
| `business-review` | 14 | 21 | `12c93d5d08d0978d39c436142a19d237a35491cfdb8dcaf52a3cf6fd5d197545` |
| `project-kickoff` | 12 | 21 | `fff1138b8afb1d41db43a81de2df66eb2b39fb03e6f94d693f14146e357befd8` |
| `team-alignment` | 24 | 51 | `d30bc208224b13a9a815b5b469666850feb3a64d2517437007477e6a53da2edb` |
| `market-trends-report` | 6 | 17 | `50036ba39076f49a6aa89d72ca5e865ed001cee4c29812179c8deaa44ae8cfc8` |
| 합계 | 139 | 253 | - |

검토 checksum은 승인된 private annotation 내용의 drift를 탐지하기 위한 provenance이며
runtime publication이나 template 활성화 증거가 아니다. production managed storage와 남은
외부 gate가 기록되기 전에는 Checkpoint A/B1/C 또는 product rollout을 `passed`로 표시하지
않는다.

## 검수 artifact 생성

annotation draft가 준비되면 원본이나 preview binary를 repository에 복사하지 않고 다음
명령으로 strict locator와 locked inventory를 검증한다.

```bash
cd services/python-worker
uv run python scripts/annotate_ooxml_reference_template.py \
  --source <private-reference.pptx> \
  --manifest <private-annotation.json> \
  --catalog-output <private-output>/source-slide-catalog.json \
  --image-slot-candidate-output <private-output>/image-slot-candidates.json \
  --preview-directory <private-rendered-slide-pngs> \
  --montage-output <private-output>/source-slide-montage.png
```

catalog에는 source slide ID, semantic role, preview ID, slot ID와 checksum만 기록한다.
source path, 원문 text, raw XML, render binary는 기록하지 않는다. preview가 하나라도 없거나
path-bounded preview ID가 아니면 montage 생성은 실패한다.

image candidate report는 strict manifest validation 후 direct `p:pic`만 읽고 internal image
relationship, media part 존재, package-wide exclusive target, 단일 slide embed와 animation
제외 여부를 기록한다. source path/text/raw XML/media target/bytes는 출력하지 않는다. 실제
7개 원본에서는 direct picture 19개 중 기술 후보 5개, shared media 제외 14개였다. direct
`p:ph` 또는 정규화된 source-authored `p:cNvPr@descr`의 exact allowlist만 명시적 replacement
intent로 인정하며 `@name`이나 importer/prepared metadata로 추론하지 않는다. 이 기준에서
high-confidence 후보는 4개, low-confidence 후보는 1개다. artifact는
`/private/tmp/orbit-ooxml-image-slot-candidates-v2-20260723-8vzdI7`에 있으며 candidate
승인이나 manifest mutation은 적용하지 않았다. `summary.json`과 `CHECKSUMS.sha256`의
SHA-256은 각각
`364bac762d035ce1d01dcfb2e0043f4b5c69e79b8aebd77e402099f946695426`,
`0b348dca0a7914c7a38c8bb4b6fe71231ae4974135c2d89fb98162a0d344212d`이다.

7개 private 검수 artifact의 139장/253 text-only slot 내용은 승인되었지만 raw annotation,
source-slide catalog, montage와 원본은 repository에 복사하지 않는다. preview baseline과
production managed storage publication은 아직 없으며, 자동 fixture와 private 검수 승인은
PowerPoint/font 검증 또는 runtime 활성화를 대신하지 않는다.
