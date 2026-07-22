# AI PPT Checkpoint C 및 OOXML Go/No-Go

## 결론

2026-07-22 기준으로 네 개 Orbit-native System Design Pack은 Phase 3 계약·제품 연결을 진행할 수 있는 engineering gate를 통과했다. 이 결론은 자동 선택, layout capacity, silhouette 다양성, grounded metric, native PPTX export와 전체 Python 회귀에 한정한다. 사람 대상 blind preference와 “추가 편집 없이 발표 가능” 평가는 아직 수행하지 않았으므로 제품 품질 승인을 의미하지 않는다.

## 검증 증거

| family | golden slides | silhouettes | adjacent duplicate | native export | 주요 품질 gate |
| --- | ---: | ---: | ---: | --- | --- |
| Neutral | 8 | 4 이상 | 0 | editable text/shape | light/dark, capacity |
| Executive Review | 9 | 4 이상 | 0 | editable table/chart | grounded typed metric, 2~5 table rows, 2~4 chart values |
| Kickoff & Alignment | 8 | 4 이상 | 0 | editable role/schedule | role·milestone 3~6개 |
| Editorial Insight | 8 | 4 이상 | 0 | editable text/shape | primary claim 1개, ungrounded metric 승격 금지 |

실행한 검증은 다음과 같다.

```text
pytest pack/selector/registry tests: 22 passed
ruff check app and pack tests: passed
mypy app: 69 source files passed
pytest full Python suite: 813 passed, 1 skipped
```

PPTX 검증은 각 native table, chart, role, schedule 또는 statement 결과를 export한 뒤 `python-pptx`로 재개방하는 방식으로 수행했다. 추가로 Docker의 `Noto Sans CJK KR`와 LibreOffice 25.2.3.2로 네 full-deck PPTX를 33장 PNG와 4개 montage로 렌더했다. 한글 glyph, safe area, timeline font height, editable schedule bar를 실제 render에서 확인했고 export warning, layout/design issue와 text overlap은 모두 0이었다.

## 남은 사람 평가

- current 대비 blind preference 70% 이상
- full-deck Vision score 85 이상 또는 실제 golden montage에서 P1 0건 — montage P1 0건 확인
- “추가 편집 없이 발표 가능” 평균 4/5 이상

위 항목은 Task 19의 고정 golden brief와 비교 report로 측정 자료를 만든 뒤 사람 평가 결과를 입력한다. 측정 전에는 `measured` 또는 `passed`로 표시하지 않는다.

## Task 20 OOXML 결정

결정은 `No-Go (not triggered)`다.

- native pack이 현재 자동화된 correctness·editability gate에서 실패하지 않았다.
- source PPTX의 라이선스와 font 재배포 조건이 `pending`이므로 reference geometry를 product mode에 사용할 수 없다.
- OOXML spike의 추가 복잡성을 정당화할 blind preference 우위 증거가 아직 없다.
- Phase 3 feature flag와 safe fallback으로 native pack을 제한적으로 평가할 수 있다.

향후 사람 평가에서 native pack이 승인 기준을 달성하지 못하고, 대상 source의 라이선스와 font 조건이 승인된 경우에만 Task 20을 다시 연다.
