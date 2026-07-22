# AI PPT System Design Pack 평가 기준

## 고정 golden set

`services/python-worker/tests/fixtures/design-pack-golden`에는 Neutral, Executive Review, Kickoff & Alignment, Editorial Insight의 8~9장 brief를 한 개씩 고정한다. fixture는 사용자 입력과 slide role/item/grounded metric 개수만 포함하며 provider 응답이나 비밀값을 저장하지 않는다.

## 동일 rubric 비교

`scripts/evaluate_design_pack_golden.py`는 current silhouette와 새 pack 선택 결과에 다음 rubric을 동일하게 적용한다.

- unique silhouette 4종 이상
- adjacent duplicate 0건
- layout capacity violation 0건
- grounded metric violation 0건
- publication P0/P1 0건
- engineering score 85 이상

score는 100에서 P0당 20점, P1당 5점을 차감하는 회귀 탐지 지표다. 사람의 시각 선호를 대신하지 않으며 blind preference와 발표 가능성 평점은 `not-measured`로 출력한다.

## 실행 방법

```bash
cd services/python-worker
uv run python -m scripts.evaluate_design_pack_golden \
  --output /tmp/orbit-design-pack-golden-report.json
```

## staged rollout

- `AI_PPT_SYSTEM_DESIGN_PACKS_ENABLED=false`이면 모든 생성이 기존 `program-v2` composition을 사용한다.
- 전역 flag가 `true`여도 `AI_PPT_SYSTEM_DESIGN_PACK_ALLOWLIST`에 없는 pack은 기존 composition으로 안전하게 fallback한다.
- native renderer가 layout/capacity/grounding 오류를 내면 같은 slide의 기존 `program-v2` composition으로 fallback한다.
- local example은 다섯 pack을 켜지만 staging과 production example은 기본적으로 전역 flag를 끈다.

rollout 변경 후에는 golden report와 publication failure, 생성 latency를 함께 확인한다. 사람 평가 결과가 입력되기 전에는 Checkpoint D의 blind preference 및 발표 가능성 기준을 통과했다고 표시하지 않는다.

## PPTX·PNG montage artifact

`scripts/render_design_pack_golden.py`는 같은 fixture로 native Deck을 compile하고 PPTX export, LibreOffice PDF 변환, slide PNG와 whole-deck montage를 생성한다. 실행 환경에 `Noto Sans CJK KR`가 없으면 한글 fidelity를 검증할 수 없으므로 시작 전에 실패한다.

```bash
docker build -f infra/docker/python-worker.Dockerfile \
  -t orbit-python-worker .
render_root="$(mktemp -d /tmp/orbit-golden-render.XXXXXX)"
docker run --rm \
  -v "$render_root:/output" \
  orbit-python-worker \
  uv run python -m scripts.render_design_pack_golden \
  --output-dir /output/artifacts
```

artifact는 `/tmp`에서만 검수하고 repository에 커밋하지 않는다. `manifest.json`은 LibreOffice와 font checksum, PPTX/PNG checksum, export warning, layout/design issue, text overlap 수를 기록한다.

2026-07-22 Docker 기준 검증에서는 `Noto Sans CJK KR`와 LibreOffice 25.2.3.2를 사용해 33장 PNG, 4개 montage, 4개 PPTX를 생성했다. 네 family 모두 export warning, layout/design issue, text overlap이 0이었다. PyMuPDF가 LibreOffice PDF의 structure tree에 대해 경고를 출력했지만 33개 page raster와 checksum은 정상 생성됐다.
