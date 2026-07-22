# AI PPT Design Pack inventory 및 provenance gate

## 실행 결과

2026-07-22에 7개 read-only reference PPTX를 `build_design_pack_inventory.py`로 분석했다. 원본 파일과 plugin cache 절대 경로는 repository에 복사하거나 report에 기록하지 않았다. 생성한 raw JSON은 `/tmp`에서만 검증하고 커밋하지 않았다.

| source ID | slides | license | active pack eligibility |
| --- | ---: | --- | --- |
| `simple-light` | 26 | `pending` | blocked |
| `simple-dark` | 26 | `pending` | blocked |
| `operating-review` | 31 | `pending` | blocked |
| `business-review` | 14 | `pending` | blocked |
| `project-kickoff` | 12 | `pending` | blocked |
| `team-alignment` | 24 | `pending` | blocked |
| `market-trends-report` | 6 | `pending` | blocked |
| 합계 | 139 | `pending` | blocked |

Heuristic role inventory는 `content=77`, `data=37`, `media-content=9`, `cover=7`, `closing=7`, `section=2`였다. 한글 capacity 사전 점검은 `high=19`, `medium=38`, `low=82`로, reference slide를 그대로 product layout으로 전환하면 다수 장표가 한글 용량 기준을 충족하지 못한다.

## 1차 Orbit-native 후보 36개

아래 후보는 reference asset이나 원본 geometry를 복사하지 않고 일반적인 정보 구조만 바탕으로 Orbit-native editable layout으로 다시 구현한다. 따라서 source provenance는 `orbit-native`, license는 `approved`이며 외부 reference license가 승인되기 전에도 구현할 수 있다.

| family | candidate layout IDs | count | role/capacity | Korean fit | editability | provenance |
| --- | --- | ---: | --- | --- | --- | --- |
| Neutral | `neutral-cover-01`, `neutral-section-01`, `neutral-content-01`, `neutral-two-column-01`, `neutral-media-split-01`, `neutral-comparison-01`, `neutral-timeline-01`, `neutral-metric-01`, `neutral-closing-01` | 9 | checked | checked | native elements | approved |
| Executive Review | `exec-cover-01`, `exec-summary-01`, `exec-kpi-01`, `exec-table-01`, `exec-chart-01`, `exec-decision-01`, `exec-risk-01`, `exec-actions-01`, `exec-closing-01` | 9 | checked | checked | native elements | approved |
| Kickoff & Alignment | `kickoff-cover-01`, `kickoff-agenda-01`, `kickoff-goals-01`, `kickoff-roles-01`, `kickoff-process-01`, `kickoff-timeline-01`, `kickoff-roadmap-01`, `kickoff-schedule-01`, `kickoff-closing-01` | 9 | checked | checked | native elements | approved |
| Editorial Insight | `editorial-cover-01`, `editorial-thesis-01`, `editorial-statement-01`, `editorial-split-01`, `editorial-evidence-01`, `editorial-trend-01`, `editorial-implication-01`, `editorial-quote-01`, `editorial-closing-01` | 9 | checked | checked | native elements | approved |

## 검수 체크리스트

- [x] source ID와 slide number를 raw inventory에 기록했다.
- [x] role, silhouette, Korean capacity와 font family를 추출했다.
- [x] report와 product manifest에서 원본 절대 경로를 제거했다.
- [x] `licenseStatus != approved` source를 active pack에서 차단하는 schema/test를 추가했다.
- [x] 36개 후보의 role, capacity, 한글 적합성, editability와 Orbit-native provenance를 엔지니어링 검수했다.
- [ ] 외부 reference 원본의 재사용·재배포 라이선스와 font 조건에 대한 별도 사람 승인은 아직 없다. 승인 전까지 reference-derived asset과 geometry는 active pack에 포함하지 않는다.

## 재현 방법

```bash
cd services/python-worker
uv run python scripts/build_design_pack_inventory.py \
  --source simple-light=<local-reference.pptx> \
  --source simple-dark=<local-reference.pptx> \
  --output /tmp/orbit-design-pack-inventory.json
uv run pytest tests/test_design_pack_ingest.py
```
