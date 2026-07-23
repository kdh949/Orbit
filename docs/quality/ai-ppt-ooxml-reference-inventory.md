# AI PPT OOXML reference inventory

## Baseline

2026-07-22에 7개 read-only reference PPTX를 security preflight와 함께
검사했다. 원본 파일명과 절대 경로, raw XML, source text, image/font bytes는 이
문서와 생성 report에 기록하지 않는다.

| template ID | SHA-256 | slides | masters | layouts | themes | fonts | embedded fonts | chart workbooks | media | charts | tables | SmartArt | animations |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `simple-light` | `2ae8105571f68403f438458cd51e6ad14f0d989c7af64239e280437a4ac2a633` | 26 | 1 | 8 | 2 | 54 | 4 | 3 | 1 | 3 | 4 | 0 | 0 |
| `simple-dark` | `042ef2fcb8726524a1e773e3c73bf8b8c10b98f67ae675eb01c4501b9365a897` | 26 | 1 | 8 | 2 | 54 | 4 | 3 | 2 | 3 | 4 | 0 | 0 |
| `operating-review` | `ec2084d143a4d52857cc06c24129abbb45c45d04b90cca06e319ac26d3cadd4f` | 31 | 1 | 10 | 2 | 54 | 0 | 6 | 2 | 6 | 3 | 0 | 0 |
| `business-review` | `595b9a314c7e8e9b5f22180e7c7db167afba2437c8623d57e3f9dbc20af392c1` | 14 | 1 | 8 | 2 | 61 | 24 | 2 | 0 | 2 | 3 | 0 | 0 |
| `project-kickoff` | `b1b15cb0c23ad524f9832749ec31b775719bae2bdba897de9c9d8556ca00a44c` | 12 | 1 | 8 | 2 | 55 | 9 | 0 | 1 | 0 | 3 | 0 | 0 |
| `team-alignment` | `72b9f23a07bfd679cde36757acb11ec99900b4be0f5d393a5b4e8c6fdce4286d` | 24 | 1 | 10 | 2 | 55 | 9 | 2 | 4 | 2 | 5 | 0 | 0 |
| `market-trends-report` | `52396c3a70dc11d35989bb4e3f9a96d2c728c5eba8a1aad96920cfe24cff59fa` | 6 | 1 | 8 | 2 | 55 | 12 | 0 | 1 | 0 | 0 | 0 | 0 |
| 합계 | - | 139 | 7 | 60 | 14 | - | 62 | 16 | 11 | 16 | 22 | 0 | 0 |

`fonts`는 OOXML의 unique `typeface` declaration 수다. `embedded fonts`는
package의 font part 수, `chart workbooks`는 chart part가 단독으로 내부 참조하고
nested OOXML preflight를 통과한 `.xlsx` 수다. `animations`는 slide의 `p:timing`
수다.

## 승인과 활성화 상태

2026-07-23 사용자 승인으로 위 7개 source의 provenance
`authorizationStatus`는 `approved`다. 같은 검수에서 139장과 text-only slot annotation
253개도 승인했으며 template별 검토 checksum은
`ooxml-reference-slot-annotation.md`와 repository catalog에 기록한다.

승인된 source 7개와 preview 139개의 checksum은 local QA private storage에서
146/146 read-after-write로 검증됐고 anonymous HTTP 접근은 `403`이었다. strict manifest는
local QA bucket에 publication하지 않았으므로 이 검증은 manifest activation이나 production
managed storage를 대신하지 않는다.
승인 전 검수 snapshot은 `/private/tmp/orbit-ooxml-private-catalog-review-9e2wd3pb`에
보존하고, 현재 승인 후 상태 결정은
`/private/tmp/orbit-ooxml-private-catalog-decision-disabled-20260723/approval-decision.json`
(`SHA-256 e30b9f5bbe9046b00c5f535f1b8ec3bf8dd8c6d8b50c539359f81dc0fa2cc0ad`)에
별도로 기록했다. 이 artifact는 strict manifest 7개를 active로 잘못 기록한 이전 결정을
supersede한다. 승인 정보는 repository catalog의
`provenance.authorizationStatus=approved`와 `annotationReview.status=approved`에 반영했지만
strict catalog status는 7개 모두 `disabled`다. production publication 증거가 아니므로
production rollout도 계속 `disabled`다.
Microsoft PowerPoint 16.111에서 7개 generated deck과 actual slot-edit/export deck의
open/render/reopen은 별도로 검증했다. 그러나 embedded/exact font file checksum과 production
private managed storage, full fidelity 사람 승인이 남아 repository catalog의 7개 template은
모두 `disabled`다. 원본, font, render artifact와 storage secret은 Git에 저장하지 않는다.

현재 LibreOffice/fontconfig QA runtime에서 package의 모든 explicit `typeface`를 exact family로
대조하면 unique 50개 family가 미설치 또는 exact alias 불일치다. 목록은
`/private/tmp/orbit-ooxml-font-gap-20260723-a.json`에 보관한다. PowerPoint 자동화 로그의 font
substitution match 0건은 실제 resolved font file checksum 증거가 아니므로 이 blocker를
해제하지 않는다.

## Security preflight

7개 source는 모두 다음 fail-closed 검사에 통과했다.

- ZIP path traversal, case-insensitive duplicate part, encrypted ZIP part
- archive/part/uncompressed size, part count, per-part compression ratio
- macro-enabled content, VBA, ActiveX, OLE, unsupported embedded package
- external relationship, URI target와 missing internal relationship target
- malformed content type, relationship XML과 presentation slide mapping
- compound-file encryption과 presentation modification protection

Chart workbook은 일반 embedded package로 허용하지 않는다. chart XML의 internal
`package` relationship이 유일하게 참조하는 `.xlsx`에 한해 nested package를 다시
검사하고, nested macro, external relationship, encryption, OLE와 embedded package가
있으면 source 전체를 거부한다.

## 재현

```bash
cd services/python-worker
uv run python scripts/build_ooxml_reference_inventory.py --dry-run \
  --source simple-light=<local-read-only-reference.pptx> \
  --source simple-dark=<local-read-only-reference.pptx> \
  --source operating-review=<local-read-only-reference.pptx> \
  --source business-review=<local-read-only-reference.pptx> \
  --source project-kickoff=<local-read-only-reference.pptx> \
  --source team-alignment=<local-read-only-reference.pptx> \
  --source market-trends-report=<local-read-only-reference.pptx>
```

Source ID 집합이나 template별 slide 수가 7개/139장 baseline과 다르면 report를 쓰지
않고 `inventory_drift`로 non-zero 종료한다.
