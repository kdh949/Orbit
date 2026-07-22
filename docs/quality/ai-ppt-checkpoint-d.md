# AI PPT Checkpoint D 제품 적용 판단

## 결론

2026-07-22 기준으로 System Design Pack의 engineering gate는 통과했다. 네 family는 자동 선택, 수동 override, publication P0/P1, native renderer, safe fallback과 로컬 Compose smoke를 통과했다. 다만 사람 blind preference, “추가 편집 없이 발표 가능” 평점, 전체 생성 p95가 측정되지 않았으므로 전면 제품 적용 승인은 보류한다.

현재 결정은 `제한 rollout 가능 / 전면 rollout No-Go`다. staging과 production의 전역 flag는 기본적으로 꺼 두고, 별도 승인 후 pack allowlist를 좁게 열어 측정한다.

## 검증 결과

| 기준 | 결과 | 상태 |
| --- | --- | --- |
| 4개 family 자동 선택 | Neutral, Executive Review, Kickoff & Alignment, Editorial Insight 고정 fixture에서 기대 pack 선택 | 통과 |
| 수동 override | shared snapshot, API 저장, Web 선택 UI 회귀 테스트 | 통과 |
| engineering regression score | 네 family 모두 100 | 통과 |
| publication P0/P1 | 네 family 모두 P0 0건, P1 0건 | 통과 |
| rollout fallback | 전역 off, pack allowlist 제외, invalid native layout에서 `program-v2` 복귀 | 통과 |
| 로컬 Compose | API liveness/readiness, Python health, Web 200, Worker ready | 통과 |
| full-deck render | Docker Noto CJK + LibreOffice에서 33 PNG, 4 montage, 4 PPTX; warning/P0/P1 0 | 통과 |
| selector latency | 고정 fixture 네 건 모두 1ms 미만 | 참고값 |
| 전체 생성 p95 | provider 포함 full-deck 표본 미수집 | 미측정 |
| current 대비 blind preference | 사람 평가 미수행 | 미측정 |
| 발표 가능성 평균 4/5 | 사람 평가 미수행 | 미측정 |

고정 결과는 다음 명령으로 재생성한다.

```bash
cd services/python-worker
uv run python -m scripts.evaluate_design_pack_golden \
  --output /tmp/orbit-design-pack-golden-report.json
```

report의 `humanEvaluation.status`가 `not-measured`인 동안 blind preference와 발표 가능성 기준은 통과로 취급하지 않는다. selector latency는 전체 생성 latency가 아니므로 p95 승인 근거로 사용하지 않는다.

## rollout 조건

- `AI_PPT_SYSTEM_DESIGN_PACKS_ENABLED=false`를 staging과 production 기본값으로 유지한다.
- 제한 rollout 시 승인된 pack만 `AI_PPT_SYSTEM_DESIGN_PACK_ALLOWLIST`에 추가한다.
- publication P0/P1 증가, full-deck p95 예산 초과 또는 native compile 오류 증가 시 전역 flag를 끈다.
- 사람 평가 두 항목과 전체 생성 p95가 기준을 충족한 뒤에만 Checkpoint D를 전면 승인으로 갱신한다.

## Task 20 관계

Checkpoint C에서 기록한 OOXML spike의 `No-Go (not triggered)` 결정은 유지한다. native pack이 자동화된 engineering gate를 통과했고 source 라이선스와 사람 선호 증거가 아직 없으므로 Task 20을 수행하지 않는다.
