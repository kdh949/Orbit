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

`infra/observability/monitoring.env.example`을 `/etc/orbit/monitoring.env`로 복사해 권한을 600으로 설정하고 `MONITORING_BIND_ADDRESS`를 모니터링 서버 VPN IP로 바꾼다. `TEMPO_METRICS_ENVIRONMENT`에는 앱의 bounded environment 값과 같은 값(예: `staging`)을 넣는다.

```bash
docker compose --env-file /etc/orbit/monitoring.env \
  -f infra/observability/docker-compose.monitoring.yml config --quiet
docker compose --env-file /etc/orbit/monitoring.env \
  -f infra/observability/docker-compose.monitoring.yml up -d
```

Prometheus 보존 기간은 30일, Loki와 Tempo는 14일, Pyroscope는 7일이다. 디스크 여유가 15% 미만이 되면 새 부하 테스트를 시작하지 않는다.

Tempo는 `service-graphs`, `span-metrics-latency`, `span-metrics-count`만 생성한다. size metric, `target_info`, instance label, status message, 사용자 정의 dimension은 사용하지 않는다. 생성 metric의 `environment`는 trace dimension이 아니라 `TEMPO_METRICS_ENVIRONMENT` static external label이다. Prometheus는 Tempo가 remote write한 exemplar를 보존하도록 `exemplar-storage` feature를 활성화한다.

## 앱 서버 Alloy 시작

앱 서버는 Doppler project/config를 선택하고 `infra/observability/app.env.example`에 정의된 환경변수를 Doppler에 등록한다. URL에는 모니터링 서버 VPN IP를 사용하고 exporter credential도 Doppler에서 주입한다.

호스트 Nginx를 사용하는 서버에서는 exporter를 시작하기 전에 status socket과 bounded JSON access log를 설치한다. 기존 Orbit virtual host의 `http` 블록이 아니라 Nginx 최상위 `http` context에서 아래 파일이 include되어야 한다. 배포판 기본 설정이 `/etc/nginx/conf.d/*.conf`를 include한다면 다음 명령을 그대로 사용할 수 있다.

```bash
sudo install -m 0644 infra/observability/nginx/orbit-nginx.tmpfiles.conf \
  /etc/tmpfiles.d/orbit-nginx.conf
sudo systemd-tmpfiles --create /etc/tmpfiles.d/orbit-nginx.conf

sudo install -m 0644 infra/observability/nginx/orbit-observability.conf \
  /etc/nginx/conf.d/orbit-observability.conf
sudo nginx -t
sudo systemctl reload nginx
sudo test -S /run/orbit-nginx/status.sock
sudo curl --unix-socket /run/orbit-nginx/status.sock \
  http://localhost/stub_status
```

`/run/orbit-nginx/status.sock`은 호스트 포트로 공개되지 않고 `nginx-exporter` 컨테이너에 read-only로 마운트된다. access log에는 method, normalized `$uri`, status, upstream header/response와 전체 request duration, body/전체 response byte 수만 기록하며 query string, cookie, authorization, client IP는 기록하지 않는다.

```bash
doppler run -- docker compose \
  -f infra/observability/docker-compose.app.yml config --quiet
doppler run -- docker compose \
  -f infra/observability/docker-compose.app.yml up -d
```

설치 후 `nginx-exporter`와 Alloy 상태만 확인한다. 외부 요청을 생성하지 않아도 Nginx 상태 지표의 scrape 여부와 기존 access log 유입 여부를 확인할 수 있다.

```bash
doppler run -- docker compose \
  -f infra/observability/docker-compose.app.yml ps nginx-exporter alloy
doppler run -- docker compose \
  -f infra/observability/docker-compose.app.yml logs --tail=50 nginx-exporter alloy
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
- Alloy trace memory limiter는 hard limit `256MiB`, spike allowance `64MiB`로 설정한다. soft limit은 `192MiB`이며, `refused`가 0보다 크면 Alloy 로그의 현재 memory와 GC 경고를 확인한 뒤 실측을 근거로 조정한다.

## Grafana 확인

1. `Connections > Data sources`에서 Prometheus, Loki, Tempo, Pyroscope 연결을 각각 테스트한다.
2. `Orbit Load Test & Observability`의 `8. Distributed Tracing` 행에서 Service Graph, 서비스별 span 호출률·오류율·p95를 확인한다.
3. `최근 느린 트레이스` 또는 `최근 실패 트레이스`에서 trace ID를 눌러 waterfall을 연다.
4. Python span의 logs 링크가 같은 `traceId`를 가진 Loki JSON 로그를 여는지 확인한다.
5. `13. CPU Profiling` 행에서 `Profile service`를 선택하고 현재 dashboard 시간 범위의 CPU flame graph를 확인한다.
6. API event-loop, GC, heap, process CPU panel의 `Open API CPU flame graph` data link가 같은 시간 범위와 `orbit-api` service를 유지하는지 확인한다.
7. Python의 충분히 긴 local root span에서 `Profiles for this span` 링크와 embedded flame graph를 표본 확인한다.
8. `14. Response & DB Timing` 행에서 API response body 크기, handler/write 완료 시간, in-flight/abort, API·Worker DB query p95/p99를 확인한다.
9. 같은 행의 Nginx upstream header/upstream complete/request complete와 k6 client phase를 비교한다.

권장 진단 흐름은 `API p95 증가 감지 → Service Graph에서 Python edge 지연 확인 → 느린 trace waterfall 열기 → 해당 span의 Loki 로그 확인 → Pyroscope CPU flame graph 확인`이다. Node API·Worker는 span 단위 profile이 아니라 같은 service와 time window의 CPU profile로 이동한다.

응답 또는 DB 병목이 의심되면 다음 순서로 범위를 좁힌다.

1. `API success latency p95`와 `API response completion phases`를 비교한다.
2. handler 이후 시간이 크면 response body 크기와 `first write → Node finish`를 확인한다.
3. Nginx `upstream header → upstream complete → request complete`를 비교한다.
4. k6 `waiting`과 `receiving`을 확인해 proxy 밖의 client 수신 구간까지 비교한다.
5. DB query p95/p99가 함께 증가하면 느린 trace에서 `db.operation.name`, PostgreSQL query span, `pg-pool.connect` 대기를 확인한다.
6. DB가 아니라 API CPU/event-loop가 증가하면 같은 시간 범위의 Pyroscope flame graph를 확인한다.

각 값의 측정 경계는 다음과 같다.

| 값                           | 시작                        | 끝                            | 의미                           |
| ---------------------------- | --------------------------- | ----------------------------- | ------------------------------ |
| API request duration         | Nest middleware 진입        | Node `finish`                 | API 전체 처리와 OS 전달 완료   |
| API post-handler duration    | controller stream 완료/오류 | Node `finish`                 | 직렬화와 응답 write/flush 구간 |
| API response write duration  | 첫 `write` 또는 `end`       | Node `finish`                 | Node response write lifecycle  |
| Nginx upstream header time   | Nginx request 시작          | upstream header 수신          | proxy 관점 API 첫 응답         |
| Nginx upstream response time | Nginx request 시작          | upstream body 수신 완료       | proxy 관점 API 응답 완료       |
| Nginx request time           | Nginx request 시작          | client 방향 마지막 byte write | Nginx 관점 전송 완료           |
| k6 request/receiving         | 부하 발생기 요청            | 부하 발생기 수신 완료         | 실제 테스트 client 관점        |

Node `finish`와 Nginx `request_time`은 TCP peer가 데이터를 소비했다는 확인이 아니다. 실제 부하 client 수신 완료 여부는 k6/Artillery 결과를 함께 사용한다. API response body 크기는 API가 쓴 body이고, Nginx `responseBodyBytes`는 Nginx가 client 방향으로 쓴 body이므로 향후 압축을 켜면 두 값이 달라질 수 있다.

`orbit_db_client_*` 메트릭은 trace sampling과 무관하게 모든 TypeORM query를 `operation`과 `outcome`으로 집계한다. SQL, table, parameter는 label이나 로그에 저장하지 않는다. 상세 SQL 구간은 샘플링된 PostgreSQL trace에서 확인한다. 정규화된 query별 서버 실행시간이 추가로 필요하면 별도 변경으로 `pg_stat_statements`를 활성화해야 하며, 이는 `shared_preload_libraries`와 PostgreSQL 재시작 승인을 먼저 요구한다.

## 배포 갱신

모니터링 서버에서는 환경 파일에 `TEMPO_METRICS_ENVIRONMENT`를 추가한 뒤 Prometheus·Tempo·Grafana를 재생성한다.

```bash
docker compose --env-file /etc/orbit/monitoring.env \
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
