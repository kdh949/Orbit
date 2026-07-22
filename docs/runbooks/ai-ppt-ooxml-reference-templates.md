# AI PPT OOXML reference template rollout/rollback

## 적용 경계

이 runbook은 `/createdeck`의 **원본 템플릿 충실도** 모드와 전용
`ooxml-reference-template-generation` API/Job/queue에만 적용한다. 일반
`GenerateDeckRequest`, System Design Pack 생성, 사용자 PPTX import와 기존
`pptx-ooxml-sync` 계약은 변경하지 않는다.

노출은 다음 두 환경변수를 모두 만족할 때만 열린다.

```dotenv
AI_PPT_OOXML_REFERENCE_TEMPLATES_ENABLED=false
AI_PPT_OOXML_REFERENCE_TEMPLATE_ALLOWLIST=
```

- `AI_PPT_OOXML_REFERENCE_TEMPLATES_ENABLED` 기본값은 `false`다.
- allowlist는 쉼표로 구분한 exact `template-id@version`만 허용한다.
- 예: `operating-review@1,project-kickoff@2`
- ID만 적거나 `@latest`, `@0`, 공백 항목 또는 대문자를 사용하면 환경 검증이 실패한다.
- 설정은 API 시작 시 읽는다. 변경 후 API를 안전하게 재시작하고 Web은 새
  `/createdeck` 진입에서 runtime config를 다시 읽는다.

전역 flag가 꺼져 있으면 authenticated catalog는 `503`, `/createdeck`은 AI 추천
디자인만 표시한다. flag가 켜져 있어도 allowlist에 없는 ID/version은 catalog에서
숨기고 generation/preview 요청을 fail-closed한다.

## rollout 전제

template을 allowlist에 넣기 전에 다음 증거가 같은 exact version에 존재해야 한다.

- private managed storage의 immutable source와 preview, source SHA-256 일치
- strict catalog manifest와 승인된 slot annotation
- source 사용 권리와 font 설치/대체 정책 승인
- full-deck package validation, PowerPoint와 LibreOffice 각각의 render/reopen
- slot 편집 후 sync/export/reopen warning 0건
- template별 fidelity report와 사람 검수 승인

하나라도 없으면 catalog entry의 `enabled`를 유지하지 않고 allowlist에 추가하지 않는다.
LibreOffice 결과는 Microsoft PowerPoint 승인을 대체하지 않는다.

## 단계적 rollout

1. 전역 flag는 `false`, allowlist는 빈 값으로 배포해 환경 schema와 기존 경로 회귀를
   확인한다.
2. 승인된 exact version 하나만 allowlist에 넣고 flag를 `true`로 바꾼다.
3. `/createdeck` catalog, preview, generation, 제한 편집, sync와 export smoke를 수행한다.
4. 아래 지표와 stable issue code를 관찰한다.
5. template별 승인 증거가 생길 때마다 exact version을 한 개씩 추가한다.

검증 명령:

```bash
node infra/scripts/check-env.mjs
docker compose config
pnpm --filter @orbit/api test -- ooxml-reference-template
pnpm --filter @orbit/worker test -- ooxml-reference-template deck-export
PLAYWRIGHT_USE_SYSTEM_CHROME=1 \
  node infra/scripts/run-playwright-test.mjs ai-ppt-ooxml-reference-template.spec.ts
```

local Compose에서는 flag off와 단일 exact version on을 각각 실행해 API liveness와
readiness를 확인한다. 실제 template source가 없는 환경에서 fixture 성공을 actual
full-deck 성공으로 기록하지 않는다.

## 관찰 지표

허용된 업무 이벤트 필드만 집계하고 prompt, slot content, source path/XML, storage key,
signed URL, 폰트·이미지 bytes는 로그에 남기지 않는다.

- `ooxml-reference-template.job.enqueued`, `.job.started`, `.job.succeeded`, `.job.failed`
- `ooxml-reference-template.stage.succeeded`, `.stage.failed`
- template ID/version별 enqueue→success 비율과 stage latency
- `OOXML_REFERENCE_CAPACITY_*`, `SOURCE_*`, `FONT_*`, `IMAGE_*`, `PACKAGE_*`
- 편집 이후 `OOXML_REFERENCE_SYNC_*`, `OOXML_REFERENCE_EXPORT_*`
- sync warning count, stale retry, package validation 실패율
- catalog/preview `5xx`, generation preview handoff 실패율

자동 fallback은 성공률로 계산하지 않는다. 이 모드는 실패해도 System Design Pack으로
전환하지 않는다.

## rollback

rollback은 데이터 삭제나 source overwrite 없이 노출만 닫는다.

1. 문제가 특정 version이면 해당 `template-id@version`만 allowlist에서 제거한다.
2. 공통 장애면 `AI_PPT_OOXML_REFERENCE_TEMPLATES_ENABLED=false`로 바꾼다.
3. API를 재시작하고 새 `/createdeck`에서 원본 모드가 보이지 않으며 catalog가 `503`인지
   확인한다.
4. 일반 AI 추천 디자인과 System Design Pack 생성 smoke를 수행한다.
5. 장애 시각, 영향 template/version, issue code, 마지막 성공 Job과 rollback 설정을
   기록한다. secret이나 private locator는 기록하지 않는다.

rollback에서 다음 작업은 하지 않는다.

- Job, Deck, generated package 또는 source catalog asset 삭제
- source PPTX 덮어쓰기나 catalog version 재사용
- 진행 중 Job 강제 변환 또는 System Design Pack 자동 fallback
- 이미 생성된 reference Deck의 sync/export 차단

allowlist와 global flag는 **새 catalog 조회와 새 generation 시작**만 제어한다. 이미
enqueue된 Job의 Worker 처리와 generation preview 조회, 기존 reference Deck의 slot 편집,
`pptx-ooxml-sync`, current-package export는 rollout 설정과 독립적으로 계속 동작한다.
rollback 뒤에도 이 경로를 smoke해 복구 가능성을 보존한다.

## 장애 분류

| 증상                      | 우선 확인                                               | 조치                                                              |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| catalog/preview 불가      | global flag, exact allowlist, manifest/preview checksum | 새 생성을 닫고 해당 version 제거                                  |
| source/font/package 실패  | `SOURCE_*`, `FONT_*`, `PACKAGE_*`                       | template version 제거, private artifact/권리/폰트 확인            |
| sync stale/failed/warning | `SYNC_*`, Deck/current package version                  | 기존 Deck은 유지하고 retry/원인 수정, export는 warning 0까지 차단 |
| export 실패               | `EXPORT_*`, sync freshness, package validator           | source 대신 current generated package 사용 여부 확인              |
| 공통 오류율 급증          | stage별 latency/error와 storage/queue 상태              | global flag off, in-flight Job과 기존 Deck은 보존                 |

## 현재 승인 상태

2026-07-22 기준 코드·fixture E2E는 통과했지만 7개 source의 private managed storage,
승인 manifest/preview/license/font evidence, 7개 actual full-deck artifact와 정식 Microsoft
PowerPoint 사람 검수가 없다. 따라서 모든 catalog entry는 disabled이고 제품 rollout은
승인 보류다. 상세 상태는
`docs/quality/ooxml-reference-template-reports/README.md`를 따른다.
