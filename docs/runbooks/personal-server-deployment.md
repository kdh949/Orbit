# 개인 서버 develop 배포 Runbook

## 범위

이 문서는 `develop` 브랜치를 개인 서버에 배포하는 절차를 다룬다.

이 서버는 staging/demo 환경으로만 사용한다. 공식 production 배포 경로가 아니다. 공식 production 목표는 기존 `docs/deployment.md` 기준대로 AWS ECS Fargate이며, web은 S3/CloudFront, 런타임 서비스는 ECS 기준으로 배포한다.

## 서버 기준

- 앱 경로: `/var/www/orbit`
- 런타임 사용자: `orbit`
- 관리자 사용자: `shawn`
- secret 출처: Doppler `orbit / stg`
- 공개 origin: `<SERVER_ORIGIN>` (HTTPS)

## 네트워크 정책

Sophos Firewall WAF에서 외부에 공개하는 포트:

- `80`
- `443`

개인 서버 DMZ 인터페이스에서 허용하는 포트:

- `80`: Sophos Firewall의 DMZ 인터페이스 IP에서만 허용한다.
- `22`: Sophos VPN 또는 관리 LAN 대역에서만 허용한다. WAN에는 공개하지 않는다.

localhost에만 bind하는 앱 포트:

- `5173`: web
- `3000`: api
- `9000`: MinIO object API. Nginx의 `/assets/` 프록시 upstream으로만 사용한다.

외부에 직접 공개하지 않는 포트:

- PostgreSQL `5432`
- Redis `6379`
- Python worker `8000`
- MinIO console `9001`

## Doppler

서버는 Doppler `orbit / stg` config에 scoped된 service token을 사용한다.

토큰은 `orbit` 사용자로 앱 디렉터리에서 등록한다.

```bash
sudo -iu orbit
cd /var/www/orbit

read -s -p "Doppler service token: " DOPPLER_SERVICE_TOKEN
echo
printf '%s' "$DOPPLER_SERVICE_TOKEN" | doppler configure set token --scope /var/www/orbit
unset DOPPLER_SERVICE_TOKEN

doppler run -- sh -c 'test -n "$APP_ENV" && echo "doppler ok"'
```

service token은 read 권한만 필요하다.

## 필요한 staging 값

Doppler에는 실제 서버 origin을 기준으로 공개 URL 값을 설정한다.

```bash
WEB_ORIGIN=<SERVER_ORIGIN>
API_BASE_URL=<SERVER_ORIGIN>/api
S3_PUBLIC_ENDPOINT=<SERVER_ORIGIN>/assets
PYTHON_WORKER_URL=http://python-worker:8000
AUTH_COOKIE_SECURE=
API_TRUST_PROXY_HOPS=2
```

HTTPS 예시:

```bash
WEB_ORIGIN=https://example.com
API_BASE_URL=https://example.com/api
S3_PUBLIC_ENDPOINT=https://example.com/assets
PYTHON_WORKER_URL=http://python-worker:8000
AUTH_COOKIE_SECURE=
API_TRUST_PROXY_HOPS=2
```

TLS를 붙이기 전의 임시 HTTP demo에서만 다음처럼 `AUTH_COOKIE_SECURE=false`를 둔다. 이 경우 `WEB_ORIGIN`과 `API_BASE_URL`은 모두 `http://`여야 한다.

```bash
WEB_ORIGIN=http://8.230.24.164
API_BASE_URL=http://8.230.24.164/api
S3_PUBLIC_ENDPOINT=http://8.230.24.164/assets
AUTH_COOKIE_SECURE=false
```

실제 서버 전용 값은 repository에 커밋하지 않는다.

개인 서버용 Docker Compose override는 로컬 Redis, MinIO, Python worker를 기준으로 다음 런타임 값을 사용한다.

- storage driver는 MinIO를 사용한다.
- asset bucket의 기본값은 staging local-default validation을 피하기 위해 `orbit-personal-staging`을 사용한다. Doppler가 `S3_ASSETS_BUCKET`을 제공하면 API와 `minio-init`이 동일한 값을 사용하며, `minio-init`이 해당 bucket을 생성한다.
- queue driver는 BullMQ를 사용한다.
- Live STT provider는 `sherpa`, browser Live STT engine은 `LIVE_STT_ENGINE`으로 `openai-realtime` 또는 `web-speech`를 선택한다. report STT provider는 Python worker의 현재 지원 범위에 맞춰 `openai`를 사용한다.
- OCR provider는 Python worker 경로를 사용한다.
- AWS Textract는 사용하지 않는다.

개인 서버 override는 storage endpoint, driver, credential을 로컬 MinIO 기준으로 덮어쓴다. `S3_ASSETS_BUCKET`은 Doppler override를 허용하며 API와 `minio-init`에 같은 값으로 전달한다.

## Nginx

Nginx는 Sophos WAF 뒤에서 요청을 받는 DMZ 내부 entrypoint다. 외부 사용자는
Nginx에 직접 접속하지 않고, Sophos WAF만 Nginx의 `80` 포트에 접근한다.

Sophos에서 TLS가 종료되고 Nginx까지 HTTP로 전달되므로 공통 proxy header는
다음 값을 유지한다.

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
```

Sophos WAF에서는 `Pass host header`를 켜고 `/socket.io/` path에만 WebSocket
passthrough를 적용한다. Nginx와 Sophos backend timeout은 우선 `300s`로 맞춘다.

기대 라우팅:

- `/`: `127.0.0.1:5173`으로 proxy
- `/api/health`: API `/health`로 proxy
- `/api/v1/`: prefix를 유지해 `127.0.0.1:3000`으로 proxy
- `/assets/`: prefix를 제거한 뒤 `127.0.0.1:9000`으로 proxy
- `/socket.io/`: websocket traffic을 `127.0.0.1:3000/socket.io/`로 proxy

`S3_PUBLIC_ENDPOINT=<SERVER_ORIGIN>/assets`를 사용하면 API가 asset URL을 `/assets/<bucket>/<key>` 형태로 반환한다. Nginx는 `/assets/` prefix를 제거해 MinIO의 path-style object URL인 `/<bucket>/<key>`로 전달해야 한다.

예시:

```nginx
location /assets/ {
  rewrite ^/assets/(.*)$ /$1 break;
  proxy_pass http://127.0.0.1:9000;
  proxy_set_header Host $host;
}
```

API는 controller가 `api/v1/...` prefix를 직접 받으므로 `/api/v1/` location의 `proxy_pass`에는 path를 다시 붙이지 않는다.

```nginx
location /api/v1/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
}
```

Nginx 설정 변경 후에는 다음 명령으로 문법을 확인하고 재시작한다.

```bash
sudo nginx -t
sudo systemctl restart nginx
```

## 배포

```bash
sudo -iu orbit
cd /var/www/orbit
./infra/scripts/deploy-personal-server.sh <40-character-develop-sha>
```

배포할 SHA는 아래 GitHub Actions image build가 성공한 `develop` commit이어야 한다.

## GitHub Actions 이미지 빌드

`develop`에 push되면 `Build personal staging images` workflow가 GitHub-hosted
runner에서 API, Worker, Python worker, Web 이미지를 빌드한다. workflow는 개인
서버에 접속하거나 배포를 실행하지 않는다.

네 이미지는 모두 다음처럼 같은 commit SHA로 GHCR에 게시한다.

```text
ghcr.io/kdh949/orbit-api:<commit-sha>
ghcr.io/kdh949/orbit-worker:<commit-sha>
ghcr.io/kdh949/orbit-python-worker:<commit-sha>
ghcr.io/kdh949/orbit-web:<commit-sha>
```

workflow의 validate job과 네 image build가 모두 성공한 SHA만 배포 대상으로
사용한다. 개인 서버에서 사용할 Doppler `orbit / stg`에는 다음 값을 추가한다.

```text
GHCR_TOKEN=<read:packages 전용 PAT>
GHCR_USERNAME=kdh949
```

runtime용 token은 `read:packages` 외 불필요한 repository 권한을 갖지 않는다.
GitHub Actions publish는 별도 PAT 대신 repository의 `GITHUB_TOKEN`과
`packages: write` 권한을 사용한다.

## VPN/SSH 수동 배포

개인 서버 self-hosted GitHub Actions runner는 현재 배포 경로에서 사용하지 않는다.
관리자는 Sophos VPN 또는 관리 LAN을 통해 SSH로 접속한 뒤 배포한다.

```bash
sudo -iu orbit
cd /var/www/orbit

git fetch origin develop
git log --oneline origin/develop -n 5

./infra/scripts/deploy-personal-server.sh <40-character-develop-sha>
```

배포 script는 다음 순서를 지킨다.

1. `develop`을 fast-forward로 갱신하고 서버 HEAD가 요청 SHA와 같은지 확인한다.
2. 서버의 read-only Doppler token으로 필수 환경값을 검증한다.
3. GHCR에서 네 서비스의 동일 SHA 이미지를 pull한다.
4. 이미지가 아직 게시 중이면 기본 10회, 15초 간격으로 재시도한다.
5. 하나라도 pull 또는 image preflight에 실패하면 실행 중 컨테이너를 교체하지 않는다.
6. PostgreSQL migration을 실행한 뒤 `--pull never`로 컨테이너를 교체한다.
7. API와 Web health check가 통과해야 배포가 성공한다.

개인 서버의 2코어·8GB 자원을 보호하기 위해 application image의 온박스 build
fallback은 사용하지 않는다. GHCR 인증 또는 이미지 게시가 실패하면 원인을 고친 뒤
같은 SHA 배포를 다시 실행한다.

Doppler 값만 변경한 경우에는 서버 HEAD를 확인한 뒤 기존 이미지를 재사용한다.

```bash
EXPECTED_SHA="$(git rev-parse HEAD)"
./infra/scripts/deploy-personal-server.sh environment-only "$EXPECTED_SHA"
```

`environment-only`는 네 이미지가 로컬에 모두 존재하고 Node/Python runtime env
검증이 성공한 뒤 `minio-init`으로 현재 `S3_ASSETS_BUCKET`을 준비한다. bucket
초기화까지 성공한 경우에만 앱 컨테이너를 재생성한다.

## 검증

서버 내부에서 확인한다.

```bash
sudo -iu orbit
cd /var/www/orbit
git rev-parse HEAD
curl -fsS http://127.0.0.1/api/health
curl -I http://127.0.0.1/
curl -I http://127.0.0.1:9000/minio/health/live
doppler run -- docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
```

### #339 queue/DB 사후 확인

다음 명령은 queue payload나 credential을 출력하지 않고 `pptx-import`, `ai-template-deck-generation`, `generate-deck`의 현재 BullMQ 상태 수만 출력한다. 모든 값이 0이어야 하며 하나라도 남으면 exit code 1이다.

```bash
doppler run -- docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T -w /app/apps/worker worker node --input-type=module -e '
const { Queue } = await import("bullmq");
const { redisConnectionOptions } = await import("@orbit/job-queue");
const names = ["pptx-import", "ai-template-deck-generation", "generate-deck"];
const states = ["waiting", "paused", "delayed", "prioritized", "waiting-children", "active"];
let hasRemainingJob = false;
for (const name of names) {
  const queue = new Queue(name, {
    connection: redisConnectionOptions(process.env.REDIS_URL),
    skipMetasUpdate: true,
  });
  const counts = await queue.getJobCounts(...states);
  const repeat = (await queue.getRepeatableJobs()).length;
  console.log(JSON.stringify({ queue: name, ...counts, repeat }));
  hasRemainingJob ||= Object.values(counts).some((count) => count !== 0) || repeat !== 0;
  await queue.close();
}
if (hasRemainingJob) process.exitCode = 1;
'
```

DB는 세 historical/active type의 `queued`, `running` 수만 집계한다. 결과의 두 count가 모두 0이어야 한다.

```bash
doppler run -- docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T postgres psql -U orbit -d orbit -v ON_ERROR_STOP=1 -c "
WITH expected(type) AS (
  VALUES ('pptx-import'), ('ai-template-deck-generation'), ('ai-deck-generation')
)
SELECT expected.type,
       COUNT(j.*) FILTER (WHERE j.status = 'queued') AS queued,
       COUNT(j.*) FILTER (WHERE j.status = 'running') AS running
FROM expected
LEFT JOIN jobs j
  ON j.type = expected.type
 AND j.status IN ('queued', 'running')
GROUP BY expected.type
ORDER BY expected.type;
"
```

마지막으로 인증된 브라우저에서 `/createdeck` GenerateDeck smoke를 1회 완료하고, 위 두 명령을 다시 실행해 stuck Job이 없음을 확인한다. 결과에는 count와 확인 시각, workflow trigger SHA, 서버의 실제 `git rev-parse HEAD`를 구분해 기록하고 payload, prompt, 발표 원문, credential은 남기지 않는다.

외부 브라우저에서는 다음 주소를 확인한다.

```text
<SERVER_ORIGIN>/
<SERVER_ORIGIN>/api/health
<SERVER_ORIGIN>/assets/<S3_ASSETS_BUCKET>/
```

## 주의 사항

`APP_ENV=staging`에서는 인증 cookie가 `secure`로 설정된다. 따라서 로그인, 회원가입, 현재 사용자 조회 같은 인증 흐름을 브라우저에서 검증하려면 `<SERVER_ORIGIN>`은 HTTPS여야 한다.

TLS를 붙이기 전의 HTTP endpoint는 기본 health check와 화면 로딩 확인에만 사용한다. HTTP 상태에서 register/login 응답이 성공하더라도 브라우저가 session cookie를 저장하지 않아 이후 인증 요청은 실패할 수 있다.

단, 개인 서버 develop demo에서 HTTPS를 붙이기 전 임시로 인증 흐름을 확인해야 하면 Doppler `orbit / stg`에 `AUTH_COOKIE_SECURE=false`를 둘 수 있다. 이 값은 개인 서버 HTTP demo 전용 예외이며, `WEB_ORIGIN`과 `API_BASE_URL`이 모두 `http://`일 때만 허용된다. production 또는 `https://` staging origin에서는 startup이 실패한다. HTTPS를 적용한 뒤에는 값을 비우거나 `true`로 되돌린다.

MinIO는 기존 named volume과의 호환성을 위해 `docker-compose.yml`의 로컬 개발 root credential을 유지한다. 초기화된 MinIO volume에서 root credential을 바꾸려면 별도 migration 계획이 필요하다.

## Rollback

애플리케이션 rollback은 서버 source를 강제로 되돌리거나 온박스에서 다시 빌드하지
않고, 이전에 검증한 commit SHA의 GHCR 이미지 네 개를 함께 재사용한다. 먼저 해당
SHA의 네 이미지가 GHCR에 존재하고, 적용된 DB migration이 이전 애플리케이션과
호환되는지 확인한다.

```bash
sudo -iu orbit
cd /var/www/orbit

export IMAGE_TAG=<40-character-known-good-sha>
export DOCKER_CONFIG="$(mktemp -d)"
trap 'rm -rf "$DOCKER_CONFIG"' EXIT

printf '%s' "$(doppler secrets get GHCR_TOKEN --plain)" | \
  docker login ghcr.io \
    -u "$(doppler secrets get GHCR_USERNAME --plain 2>/dev/null || echo kdh949)" \
    --password-stdin

doppler run -- docker compose \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  pull api worker python-worker web

doppler run -- docker compose \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  up -d --no-build --pull never api worker python-worker web

unset IMAGE_TAG
```

이 절차는 애플리케이션 컨테이너만 되돌리며 DB migration을 자동으로 역적용하지
않는다. migration이 backward-compatible하지 않으면 먼저 별도 DB 복구 계획을
승인받아야 한다. 교체 후 내부·외부 health check와 주요 smoke test를 다시 수행한다.
