# 분산 추적과 CPU 프로파일링 운영

Orbit의 분산 추적은 앱 서버 Alloy가 OTLP/HTTP trace를 수신해 모니터링 서버 Tempo로 전달한다. CPU profile은 API·Worker·Python Worker가 모니터링 서버 Pyroscope로 직접 전송한다. Prometheus, Loki, Tempo, Pyroscope, Grafana는 앱 서버와 분리된 VPN 내부 모니터링 서버에 둔다.

## 도입 순서

1. 모니터링 서버에서 Tempo, Pyroscope, Grafana를 먼저 시작한다.
2. Tempo metrics-generator와 Prometheus remote write를 확인한다.
3. 앱 서버에서 exporter와 Alloy를 시작하고 Alloy OTLP receiver를 확인한다.
4. API·Worker·Python Worker trace를 5% 샘플링으로 활성화한다.
5. Service Graph와 span metric을 확인한 뒤 trace와 Loki 로그 상호 이동을 확인한다.
6. CPU profile을 50Hz 상당의 보수적 설정으로 활성화한다.
7. Python span의 `pyroscope.profile.id`와 flame graph 연결을 확인한다.

## 네트워크

다음 통신만 VPN/private network 방화벽에서 허용한다. 해당 포트를 WAN에 공개하지 않는다.

| 출발지     | 목적지        | 포트 | 용도                    |
| ---------- | ------------- | ---: | ----------------------- |
| 앱 서버    | 모니터링 서버 | 9090 | Prometheus remote write |
| 앱 서버    | 모니터링 서버 | 3100 | Loki push               |
| 앱 서버    | 모니터링 서버 | 4318 | Tempo OTLP/HTTP         |
| 앱 서버    | 모니터링 서버 | 4040 | Pyroscope profile push  |
| 관리자 VPN | 모니터링 서버 | 3000 | Grafana UI              |

Alloy의 `4318`은 앱 서버의 `orbit_default` Docker network에만 노출한다. API·Worker·Python Worker는 `http://alloy:4318/v1/traces`를 사용한다.

## 모니터링 서버 시작

`infra/observability/monitoring.env.example`을 저장소 밖의 권한 600 파일로 복사하고 `MONITORING_BIND_ADDRESS`를 모니터링 서버 VPN IP로 바꾼다. `TEMPO_METRICS_ENVIRONMENT`에는 앱의 bounded environment 값과 같은 값(예: `staging`)을 넣는다.

```bash
docker compose --env-file /secure/path/monitoring.env \
  -f infra/observability/docker-compose.monitoring.yml config --quiet
docker compose --env-file /secure/path/monitoring.env \
  -f infra/observability/docker-compose.monitoring.yml up -d
```

Prometheus 보존 기간은 30일, Loki와 Tempo는 14일, Pyroscope는 7일이다. 디스크 여유가 15% 미만이 되면 새 부하 테스트를 시작하지 않는다.

Tempo는 `service-graphs`, `span-metrics-latency`, `span-metrics-count`만 생성한다. size metric, `target_info`, instance label, status message, 사용자 정의 dimension은 사용하지 않는다. 생성 metric의 `environment`는 trace dimension이 아니라 `TEMPO_METRICS_ENVIRONMENT` static external label이다. Prometheus는 Tempo가 remote write한 exemplar를 보존하도록 `exemplar-storage` feature를 활성화한다.

## 앱 서버 Alloy 시작

`infra/observability/app.env.example`을 저장소 밖의 권한 600 파일로 복사한다. URL에는 모니터링 서버 VPN IP를 사용하고 exporter credential은 secret store에서 주입한다.

```bash
docker compose --env-file /secure/path/app-observability.env \
  -f infra/observability/docker-compose.app.yml config --quiet
docker compose --env-file /secure/path/app-observability.env \
  -f infra/observability/docker-compose.app.yml up -d
```

## 애플리케이션 설정

다음 값은 Doppler 또는 배포용 env에 넣는다. `OTEL_SERVICE_VERSION`은 배포 image SHA로, Pyroscope 주소는 실제 모니터링 서버 VPN 주소로 교체한다.

```dotenv
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://alloy:4318/v1/traces
OTEL_SDK_DISABLED=false
OTEL_SERVICE_VERSION=<배포 이미지 SHA>
OTEL_TRACES_SAMPLER_ARG=0.05

PYROSCOPE_ENABLED=true
PYROSCOPE_SERVER_ADDRESS=http://172.16.16.18:4040
PYROSCOPE_CPU_SAMPLE_INTERVAL_MICROS=20000
PYROSCOPE_CPU_SAMPLE_RATE=50
```

- `OTEL_TRACES_SAMPLER_ARG=0.05`는 root trace 5%를 수집한다.
- 동일한 값은 각 runtime의 숫자 resource attribute `orbit.trace.sample_ratio`에도 기록된다. Tempo는 이를 역수 multiplier로 사용해 count와 histogram 표본을 20배 가중한다. 이 속성은 Prometheus label로 생성하지 않는다.
- 파생 호출률·오류율·p95는 전체 트래픽의 추정치다. 희귀 오류가 5% 표본에 포함되지 않을 수 있으며, 저장된 느린/실패 trace 목록도 모든 요청을 보장하지 않는다.
- Node의 `20000µs`와 Python의 `50Hz`는 초당 약 50개 CPU sample이다.
- heap/allocation profiling은 활성화하지 않는다.
- environment와 service version 외에 사용자·세션·프로젝트·작업 ID를 resource/profile label로 추가하지 않는다.
- Node API·Worker는 연속 CPU profile을 제공한다. 현재 공식 Node span bridge가 없어 Node span 단위 profile 링크는 제공하지 않는다.
- Python Worker는 `pyroscope-otel` bridge를 통해 local root span과 CPU profile을 연결한다.

## Grafana 확인

1. `Connections > Data sources`에서 Prometheus, Loki, Tempo, Pyroscope 연결을 각각 테스트한다.
2. `Orbit Load Test & Observability`의 `8. Distributed Tracing` 행에서 Service Graph, 서비스별 span 호출률·오류율·p95를 확인한다.
3. `최근 느린 트레이스` 또는 `최근 실패 트레이스`에서 trace ID를 눌러 waterfall을 연다.
4. Python span의 logs 링크가 같은 `traceId`를 가진 Loki JSON 로그를 여는지 확인한다.
5. Pyroscope Explore에서 `service_name`별 CPU flame graph를 확인한다.
6. Python의 충분히 긴 local root span에서 `Profiles for this span` 링크와 embedded flame graph를 표본 확인한다.

권장 진단 흐름은 `API p95 증가 감지 → Service Graph에서 Python edge 지연 확인 → 느린 trace waterfall 열기 → 해당 span의 Loki 로그 확인 → Pyroscope CPU flame graph 확인`이다. Node API·Worker는 span 단위 profile이 아니라 같은 service와 time window의 CPU profile로 이동한다.

## 배포 갱신

모니터링 서버에서는 환경 파일에 `TEMPO_METRICS_ENVIRONMENT`를 추가한 뒤 Prometheus·Tempo·Grafana를 재생성한다.

```bash
docker compose --env-file /secure/path/monitoring.env \
  -f infra/observability/docker-compose.monitoring.yml \
  up -d --force-recreate prometheus tempo grafana
```

앱 서버에서는 새 image SHA로 API·Worker·Python Worker를 기존 배포 스크립트로 재배포한다. 새 포트나 데이터 migration은 없다. 배포 직후 대규모 부하를 실행하지 말고 정상 요청 1개와 의도된 오류 요청 1개 이하로 metric, exemplar, trace/log/profile 링크만 확인한다.

확인용 네트워크 요청은 health/API 작업 1~2개로 제한한다. 이는 성능 결과가 아니라 연결과 구성 오류 확인이다. ramp, soak, 수백~수천 요청은 이 단계에서 실행하지 않는다.

## 중단과 롤백

- 앱 CPU 또는 latency가 평소 기준보다 유의하게 증가하면 `PYROSCOPE_ENABLED=false`로 재배포하고 trace는 유지해 원인을 분리한다.
- trace export queue 오류가 반복되면 `OTEL_SDK_DISABLED=true`로 재배포한 뒤 Alloy와 Tempo 연결을 점검한다.
- 프로파일러와 exporter 오류 메시지에 endpoint credential이나 사용자 payload를 추가하지 않는다.
- 대규모 부하 테스트 결과에는 Git SHA, image SHA, trace sampling ratio, CPU sampling rate, 실행 시간 범위를 함께 보관한다.

구성 옵션은 [Grafana Pyroscope Node.js SDK](https://grafana.com/docs/pyroscope/latest/configure-client/language-sdks/nodejs/), [Python SDK](https://grafana.com/docs/pyroscope/latest/configure-client/language-sdks/python/), [Tempo datasource provisioning](https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/provision/), [Grafana Service Graph](https://grafana.com/docs/grafana/latest/datasources/tempo/service-graph/), [TraceQL dashboard query](https://grafana.com/docs/grafana/latest/datasources/tempo/query-editor/)를 기준으로 한다.
