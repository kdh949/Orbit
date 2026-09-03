# Orbit 핵심 사용자 여정 혼합 테스트

혼합 테스트는 전용 staging 계정의 실제 UI 여정과 k6의 안전한 API 반복, Artillery의 Socket.IO 청중 참여를 한 실행으로 묶는다. `smoke`는 owner 브라우저 컨텍스트 1개와 청중 10명, `average`는 로그인 상태를 복제한 owner 컨텍스트 5개와 청중 50명을 사용한다. `average`는 `CONFIRM_LARGE_LOAD=true` 없이는 시작하지 않는다.

## 사전 조건

앱 서버는 `APP_ENV=staging`, `LOAD_TEST_MODE=true`, `LOAD_TEST_PROVIDER_MODE=deterministic`로 배포되어 있어야 한다. 공개 health 응답에는 이 설정이 노출되지 않으므로 실행기가 원격에서 대신 추론하지 않는다.

실행기는 실제 여정을 시작하기 전에 다음을 검사한다.

- `BASE_URL/health`, Pushgateway `/-/healthy`, Prometheus `/-/healthy`
- `k6`, 저장소의 Artillery, Playwright 실행 가능 여부
- PPTX fixture와 필수 환경변수, 32자 이상 bypass token
- `orbit.dhkim.cloud` 대상의 `CONFIRM_ORBIT_DHKIM_CLOUD=true`

정적 안전 테스트는 네트워크 요청 없이 실행한다.

```bash
pnpm --filter @orbit/load-tests test:mixed
```

## 실행

```bash
BASE_URL=http://172.16.16.30 \
MIXED_TEST_EMAIL='전용 계정' \
MIXED_TEST_PASSWORD='전용 비밀번호' \
LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN='32자 이상 서버와 동일한 값' \
ARTILLERY_PUSHGATEWAY_URL=http://172.16.16.18:9091 \
K6_PROMETHEUS_RW_SERVER_URL=http://172.16.16.18:9090/api/v1/write \
pnpm --filter @orbit/load-tests mixed:smoke
```

```bash
BASE_URL=http://172.16.16.30 \
MIXED_TEST_EMAIL='전용 계정' \
MIXED_TEST_PASSWORD='전용 비밀번호' \
LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN='32자 이상 서버와 동일한 값' \
ARTILLERY_PUSHGATEWAY_URL=http://172.16.16.18:9091 \
K6_PROMETHEUS_RW_SERVER_URL=http://172.16.16.18:9090/api/v1/write \
CONFIRM_LARGE_LOAD=true \
pnpm --filter @orbit/load-tests mixed:average
```

`RUN_ID`는 생략하면 UTC 시각과 profile로 생성된다. 결과는 `results/<RUN_ID>/`에 남는다. 최종 `manifest.json`에는 Git SHA, target, profile, 시작·종료 시각, 생성 ID와 결과 파일명만 기록한다. cookie, 계정, 비밀번호, bypass token, 청중 passcode, transcript, 발표 메모, signed URL은 기록하지 않는다. Playwright trace/HAR/video/screenshot은 만들지 않으며 임시 인증·런타임·가짜 WAV 파일은 성공과 실패 모두 삭제한다. project, Job, session, activity response는 자동 삭제하지 않고 `[RUN_ID]` 제목으로 staging에 보존한다.

검증 범위는 AI 5장 생성, PPTX import, 발표 메모 저장·재조회, PPTX/PNG ZIP export, 결정론적 STT 리허설 report, 세 활동이 있는 실전 발표와 청중 응답이다. 커뮤니티, 멤버 권한 협업, iPad companion, 적응형 코칭 전체, 실제 OS 화면 공유 picker와 실제 마이크 품질 평가는 포함하지 않는다. 가짜 WAV와 결정론적 STT 결과는 워크플로·큐·저장소 검증 근거일 뿐 음성 인식 품질이나 운영 용량 근거가 아니다.
