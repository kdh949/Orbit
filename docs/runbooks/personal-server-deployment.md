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

외부 공개 포트:

- `22`
- `80`
- `443`

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
```

HTTPS 예시:

```bash
WEB_ORIGIN=https://example.com
API_BASE_URL=https://example.com/api
S3_PUBLIC_ENDPOINT=https://example.com/assets
PYTHON_WORKER_URL=http://python-worker:8000
AUTH_COOKIE_SECURE=
```

TLS를 붙이기 전의 임시 HTTP demo에서만 다음처럼 `AUTH_COOKIE_SECURE=false`를 둔다. 이 경우 `WEB_ORIGIN`과 `API_BASE_URL`은 모두 `http://`여야 한다.

```bash
WEB_ORIGIN=http://8.230.24.164
API_BASE_URL=http://8.230.24.164/api
S3_PUBLIC_ENDPOINT=http://8.230.24.164/assets
AUTH_COOKIE_SECURE=false
```

실제 서버 전용 값은 repository에 커밋하지 않는다.

개인 서버용 Docker Compose override는 로컬 Redis, MinIO, Python worker를 기준으로 다음 런타임 값을 고정한다.

- storage driver는 MinIO를 사용한다.
- MinIO bucket은 staging local-default validation을 피하기 위해 `orbit-personal-staging`을 사용한다.
- queue driver는 BullMQ를 사용한다.
- Live STT provider는 `sherpa`, browser Live STT engine은 `LIVE_STT_ENGINE`으로 `openai-realtime` 또는 `web-speech`를 선택한다. report STT provider는 Python worker의 현재 지원 범위에 맞춰 `openai`를 사용한다.
- OCR provider는 Python worker 경로를 사용한다.
- AWS Textract는 사용하지 않는다.

Doppler `orbit / stg` 값이 S3, AWS Transcribe, AWS Textract 기준이어도 개인 서버 override에서 위 값으로 덮어쓴다.

## Nginx

Nginx는 외부 요청을 받는 public entrypoint다.

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
./infra/scripts/deploy-personal-server.sh
```

## 자동 배포

`develop`에 merge되면 `Environment Contract CI`가 환경 예시 파일 계약을 다시 검사한다. 성공한 push run은 같은 workflow의 후속 job에서 GitHub Environment `personal-staging`의 sync token으로 Doppler를 동기화한 뒤, 개인 서버 self-hosted runner가 검증된 commit SHA를 배포 wrapper에 전달한다. 자동 push 전체 run은 수동·webhook 배포와 같은 `personal-staging-deploy` concurrency group을 사용하므로 환경 계약, sync, full 배포 사이에 다른 personal staging 배포가 끼어들지 않는다. PR의 오래된 환경 검증 run만 새 commit에서 취소한다.

### GenerateDeck breaking contract 자동 배포와 사후 확인

#339 PR 6처럼 Web/API/Worker/Python worker가 공유하는 GenerateDeck request를 호환 shim 없이 축소하는 변경도 기존 `develop` 자동 배포 규칙을 따른다. 이 변경 때문에 workflow를 중단하거나 GitHub Environment `personal-staging`에 required reviewer를 추가하지 않는다.

자동 배포와 사후 확인 순서는 다음과 같다.

1. PR merge로 `develop`의 `Environment Contract CI`를 시작한다.
2. 환경 계약이 성공하면 같은 workflow의 direct job이 `DOPPLER_STG_SYNC_TOKEN` 존재 여부와 안전한 repo default 동기화를 검증한다.
3. sync가 성공하면 후속 `needs` job이 push의 `github.sha`를 배포 wrapper에 전달한다.
4. 배포 script가 `git pull --ff-only origin develop`로 서버 HEAD를 동기화하고, 실제 HEAD가 검증된 SHA와 다르면 배포를 거부한다.
5. Doppler로 주입한 개인 서버 필수 환경변수가 누락되거나 비어 있으면 build 전에 배포를 실패시킨다.
6. 환경 검증 뒤 Web/API/Worker/Python worker 이미지를 빌드하고 migration과 `docker compose up -d`로 서비스를 교체한다.
7. 배포 script의 API/root health check가 통과해 workflow가 성공했는지 확인한다.
8. 서버에서 `git rev-parse HEAD`를 실행해 실제 배포 SHA가 workflow의 검증 SHA와 같은지 기록한다.
9. BullMQ `generate-deck` queue의 `waiting`, `paused`, `delayed`, `prioritized`, `waiting-children`, `active`, `repeat`를 읽기 전용으로 확인한다.
10. DB에서 `type = 'ai-deck-generation'`이고 `status IN ('queued', 'running')`인 Job 수를 읽기 전용으로 확인한다.
11. GenerateDeck smoke를 실행하고 queue/DB에 stuck Job이 없음을 운영 기록에 남긴다.

배포 script는 실제 서버 HEAD와 queue/DB count를 출력하지 않으므로 workflow 성공만으로 8~11번을 충족했다고 기록하지 않는다. #339 도입 시점의 사전 drain 증거는 남아 있지 않으며, 수행했다고 소급 주장하지 않는다.

production ECS/CloudFront cutover는 이 personal staging runbook으로 대신하지 않는다. production의 ingress 중단, drain, 서비스 동시 교체와 cache invalidation은 별도 승인된 배포 계획으로 수행한다.

필수 서버 조건:

- GitHub Actions runner label: `orbit-personal-staging`
- runner 실행 사용자: `orbit-runner`
- 앱 checkout과 Doppler token scope: `/var/www/orbit`
- 배포 wrapper: `/usr/local/sbin/orbit-deploy-personal-staging`
- sudoers 허용 명령: `orbit-runner ALL=(root) NOPASSWD: /usr/local/sbin/orbit-deploy-personal-staging`

배포 wrapper는 저장소의 `infra/scripts/orbit-deploy-personal-staging-wrapper.sh`를 원본으로 사용한다. 이 root 소유 wrapper는 `orbit` 사용자로 전환하고 전달받은 인자를 변경 없이 넘기는 권한 경계만 담당한다. mode·SHA 검증, lock, Git 동기화, Doppler 검증, build, migration, Compose 교체는 모두 Git으로 관리되는 `infra/scripts/deploy-personal-server.sh`에 둔다. wrapper 안에 이 로직을 복제하거나 `bash -lc` 문자열을 조합하지 않는다.

```bash
#!/usr/bin/env bash
set -euo pipefail

exec /usr/bin/sudo -iu orbit -- \
  /bin/bash /var/www/orbit/infra/scripts/deploy-personal-server.sh "$@"
```

이 파일은 Git pull 때 `/usr/local/sbin`으로 자동 복사하지 않는다. 배포 중 root 권한 파일을 자기 자신이 바꾸게 하면 검토되지 않은 commit이 다음 root 실행 경계를 변경할 수 있기 때문이다. wrapper 계약이 바뀌는 PR은 검토·로컬 검증을 마친 뒤, merge 전에 운영자가 아래 절차로 서버에 한 번 설치한다.

```bash
cd /var/www/orbit

WRAPPER=/usr/local/sbin/orbit-deploy-personal-staging
BACKUP=/usr/local/sbin/orbit-deploy-personal-staging.pre-stable-shim
CANDIDATE=/usr/local/sbin/.orbit-deploy-personal-staging.new

if sudo test -e "$BACKUP"; then
  echo "Backup already exists: $BACKUP"
  exit 1
fi

sudo install -o root -g root -m 0700 \
  "$WRAPPER" \
  "$BACKUP"

sudo install -o root -g root -m 0750 \
  infra/scripts/orbit-deploy-personal-staging-wrapper.sh \
  "$CANDIDATE"
sudo bash -n "$CANDIDATE"
sudo mv -f "$CANDIDATE" "$WRAPPER"
```

백업은 `root:root 0700`, 설치 파일은 `root:root 0750`으로 유지한다. 같은 파일시스템의 임시 파일을 `mv`해 교체하므로 wrapper가 부분적으로 기록된 상태를 노출하지 않는다. 기존 백업은 자동으로 덮어쓰지 않는다.

설치 후에는 다음 순서로 원본 일치, 문법, 소유권, 권한, 인자 전달을 검증한다. 마지막 probe는 checksum이 일치한 뒤에만 실행한다. 기존의 오래된 wrapper는 인자를 무시하고 기본 `full` 배포를 시작할 수 있으므로 교체 전에는 probe를 실행하지 않는다.

```bash
cd /var/www/orbit

sudo cmp --silent \
  infra/scripts/orbit-deploy-personal-staging-wrapper.sh \
  /usr/local/sbin/orbit-deploy-personal-staging
sudo bash -n /usr/local/sbin/orbit-deploy-personal-staging
sudo stat -c '%A %a %U:%G %n' \
  /usr/local/sbin/orbit-deploy-personal-staging

sudo /usr/local/sbin/orbit-deploy-personal-staging \
  wrapper-contract-probe 0000000000000000000000000000000000000000
```

마지막 명령은 `deploy-personal-server.sh`의 `Invalid deployment mode.` 오류와 non-zero exit로 끝나야 한다. 이 지점에서는 Git pull, image build, migration, Compose 교체가 실행되지 않는다. 예상과 다르면 자동 배포를 시작하지 않고 다음 명령으로 백업을 원자적으로 복원한다.

```bash
sudo install -o root -g root -m 0750 \
  /usr/local/sbin/orbit-deploy-personal-staging.pre-stable-shim \
  /usr/local/sbin/.orbit-deploy-personal-staging.rollback
sudo mv -f \
  /usr/local/sbin/.orbit-deploy-personal-staging.rollback \
  /usr/local/sbin/orbit-deploy-personal-staging
```

GitHub Environment `personal-staging`에는 required reviewer를 설정하지 않는다. `develop` merge 후 완전 자동 배포가 팀의 고정 규칙이다.

### 수동 full 배포 복구

토큰 교체, GitHub Environment 설정 변경, 일시적인 Actions 장애 뒤에는 기존 run의 `Re-run failed jobs`를 반복하지 않는다. 같은 run의 attempt는 최초 실행과 구분하기 어렵기 때문에 완전히 새로운 run ID에서 Doppler 동기화와 full 배포를 다시 검증한다.

GitHub Actions의 기존 `Deploy Personal Staging`에서 `Run workflow`를 누르고 다음처럼 실행한다. 이 workflow는 기본 브랜치에도 `workflow_dispatch`가 존재하므로 `develop`에만 있는 새 수동 trigger에 의존하지 않는다.

1. branch는 `develop`을 선택한다.
2. `deployment_mode`는 `full`을 선택한다.
3. `expected_sha`는 비워 두거나 검증할 최신 `develop` SHA를 입력한다.
4. `trigger_source`는 `manual`을 선택한다.
5. workflow를 실행한다.

`develop + full + manual` 경로는 자동 `develop` push와 같은 Doppler sync를 먼저 실행한다. Doppler sync와 full 배포는 자동 `develop` 배포 및 `environment-only` 배포와 동일한 `personal-staging-deploy` concurrency group에서 직렬화한다. `DOPPLER_STG_SYNC_TOKEN`이 비어 있으면 self-hosted runner 배포를 시작하지 않는다.

새 run에서는 다음 순서와 결과를 확인한다.

1. `sync-personal-staging-env`가 `DOPPLER_STG_SYNC_TOKEN`의 존재 여부만 확인하고 성공한다.
2. `deploy`가 같은 SHA를 개인 서버 wrapper에 전달한다.
3. 서버 HEAD가 해당 SHA와 일치하고 API/root health check가 성공한다.

토큰 값이나 Doppler secret 값은 workflow log에 출력하지 않는다.

### Doppler stg 변경 자동 재배포

Doppler `orbit / stg` secret 변경은 같은 workflow의 `environment-only` mode를 호출한다. 이 경로는 production secret 또는 AWS production 배포와 연결하지 않는다.

사전 조건:

1. 이 workflow와 위 wrapper가 `develop` 및 개인 서버에 반영되어 있어야 한다.
2. 서버 checkout의 HEAD가 현재 `develop` HEAD와 같아야 한다. 다르면 환경변수만 이전 코드에 적용하지 않고 실패한다.
3. GitHub Environment `personal-staging`에는 required reviewer를 두지 않는다.

Doppler Webhook 설정:

1. `na-man-mu-303-team2/Orbit` 저장소만 대상으로 하고 `Actions: write`만 가진 fine-grained personal access token을 준비한다. 가능한 짧은 만료 기한을 사용하고 값은 저장소·문서·로그에 남기지 않는다.
2. Doppler project `orbit`의 Webhooks에서 `stg` config만 선택한다.
3. Webhook URL을 다음 endpoint로 지정한다.

```text
https://api.github.com/repos/na-man-mu-303-team2/Orbit/actions/workflows/deploy-personal-staging.yml/dispatches
```

4. Authentication은 위 token을 쓰는 Bearer 방식으로 설정한다.
5. Custom JSON payload는 다음처럼 고정한다.

```json
{
  "ref": "develop",
  "inputs": {
    "deployment_mode": "environment-only",
    "trigger_source": "doppler-stg-secrets-update"
  }
}
```

Webhook은 secret 값이 아니라 고정된 배포 요청만 GitHub에 전달한다. 실제 값은 개인 서버의 read-only Doppler service token으로 실행 시점에 읽는다. GitHub App installation token은 짧은 수명이므로 relay 없이 이 직접 연결 방식에 정적으로 저장하지 않는다.

#### 새 env key 자동 동기화

GitHub Environment `personal-staging`에 `DOPPLER_STG_SYNC_TOKEN` secret을 등록한다. 이 값은 Doppler `orbit / stg` config의 Access 화면에서 생성한 read/write service token이어야 한다. workplace 전체 권한이 있는 CLI·Personal token을 사용하지 않고, 개인 서버에 저장된 runtime용 read-only service token도 변경하지 않는다. token 값은 저장소·문서·workflow log에 남기지 않는다.

`develop` push가 Environment Contract CI를 통과하면 같은 workflow의 direct sync·full deploy job이 다음 순서로 동작한다. reusable workflow 경계에서는 `personal-staging` Environment secret이 공백으로 해석된 실제 run이 있었으므로 자동 경로에서 `workflow_call`을 사용하지 않는다.

1. 검증을 통과한 정확한 `develop` SHA를 GitHub-hosted runner에 checkout한다.
2. `DOPPLER_STG_SYNC_TOKEN`의 존재 여부만 확인한다.
3. 아래 dry-run과 같은 정책으로 누락 key를 분류한다.
4. 누락된 `repo-default` + `delivery=compose` key를 한 번에 추가한다.
5. 필수 수동 값이 없으면 개인 서버 배포를 시작하지 않는다.
6. 동기화가 성공하거나 추가할 key가 없으면 self-hosted runner의 full 배포를 실행한다.

로컬에서 정책과 현재 Doppler key 상태만 확인할 때는 다음 dry-run을 사용한다.

```bash
pnpm env:sync:stg
```

이 명령은 `infra/env/personal-staging-env-policy.json`, `.env.staging.example`, 개인 서버 Compose 전달 선언과 Doppler의 key 이름을 비교한다. Doppler에서는 key 이름만 읽고 어떤 값도 출력하지 않는다. 결과는 다음 세 종류의 key 이름만 보여준다.

- `Missing safe repo defaults`: 기존 값을 건드리지 않고 자동 추가할 수 있는 일반 설정
- `Missing required manual values`: 운영자가 실제 값을 Doppler에 먼저 입력해야 하는 환경별 값 또는 secret
- `Missing optional overrides`: 없어도 runtime 기본값으로 실행 가능한 선택 override

자동화 장애를 복구하거나 merge 전에 동기화를 수동 검증해야 할 때만 쓰기 권한이 있는 관리 환경에서 다음 명령을 실행한다.

```bash
pnpm env:sync:stg:apply
```

`apply`는 자동 workflow와 동일하게 누락된 `repo-default` + `delivery=compose` key만 한 요청으로 추가한다. 기존 Doppler key를 갱신하거나 secret placeholder·빈 값을 복사하지 않는다. 변경이 생기면 위 webhook이 `environment-only` workflow를 자동 호출하므로 서버에서 `/usr/local/sbin/orbit-deploy-personal-staging`을 직접 실행하지 않는다. 개인 서버에 저장된 runtime용 read-only service token으로는 이 동기화 명령을 실행하지 않는다.

자동 동기화가 발생한 push에서는 full 배포 workflow가 `personal-staging-deploy` concurrency를 먼저 점유한다. Doppler webhook의 `environment-only` 요청은 full 배포가 끝난 뒤 후속 실행되어 두 배포가 동시에 컨테이너를 교체하지 않는다. Webhook은 exactly-once를 보장하지 않으므로 중복 요청도 같은 방식으로 직렬 처리한다.

`environment-only` mode는 다음 순서로 동작한다.

1. GitHub dispatch의 `develop` SHA와 서버 HEAD가 같은지 확인한다.
2. backend `IMAGE_TAG`는 `develop`, Web `WEB_IMAGE_TAG`는 검증된 서버 HEAD로 배포 모드 분기 전에 고정한다.
3. 필수값 누락·공백과 `APP_ENV=staging`을 확인한다.
4. `docker compose config --quiet`로 최종 Compose interpolation을 확인한다.
5. Compose가 해석한 API, Worker, Python worker, Web 이미지 네 개가 로컬에 모두 존재하는지 확인한다.
6. 기존 이미지의 API/Worker Zod schema와 Python worker Pydantic schema를 임시 컨테이너에서 실행한다.
7. 모든 preflight가 성공한 경우에만 API, Worker, Python worker, Web을 `--no-build --pull never --force-recreate`로 재생성한다.
8. API와 root health check가 통과해야 workflow가 성공한다.

1~6단계가 실패하면 실행 중인 컨테이너는 교체하지 않는다. 이미지가 하나라도 없으면 누락된 image reference만 출력하고 `docker compose up`을 실행하지 않는다. 필수 secret 삭제·공백, 잘못된 enum·URL·숫자 범위는 오류 key와 이유를 GitHub Actions log에서 확인할 수 있다. 선택값 삭제는 runtime default가 허용하는 경우 해당 기본값으로 재적용된다.

Doppler webhook은 동일 이벤트를 한 번 넘게 전달할 수 있다. workflow concurrency는 실행 중인 배포를 취소하지 않고 직렬화하며, 서버 script도 같은 `flock`을 사용한다. 따라서 중복 이벤트가 서비스 교체 중인 실행을 강제 중단하지는 않지만, 유효한 이벤트가 반복 전달되면 순서대로 재생성될 수 있다.

설정 뒤 Doppler Webhook Logs의 응답 코드와 GitHub Actions `Deploy Personal Staging`의 `trigger_source=doppler-stg-secrets-update` 실행을 함께 확인한다. 실제 secret 값을 로그에 복사하지 않는다.

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
<SERVER_ORIGIN>/assets/orbit-personal-staging/
```

## 주의 사항

`APP_ENV=staging`에서는 인증 cookie가 `secure`로 설정된다. 따라서 로그인, 회원가입, 현재 사용자 조회 같은 인증 흐름을 브라우저에서 검증하려면 `<SERVER_ORIGIN>`은 HTTPS여야 한다.

TLS를 붙이기 전의 HTTP endpoint는 기본 health check와 화면 로딩 확인에만 사용한다. HTTP 상태에서 register/login 응답이 성공하더라도 브라우저가 session cookie를 저장하지 않아 이후 인증 요청은 실패할 수 있다.

단, 개인 서버 develop demo에서 HTTPS를 붙이기 전 임시로 인증 흐름을 확인해야 하면 Doppler `orbit / stg`에 `AUTH_COOKIE_SECURE=false`를 둘 수 있다. 이 값은 개인 서버 HTTP demo 전용 예외이며, `WEB_ORIGIN`과 `API_BASE_URL`이 모두 `http://`일 때만 허용된다. production 또는 `https://` staging origin에서는 startup이 실패한다. HTTPS를 적용한 뒤에는 값을 비우거나 `true`로 되돌린다.

MinIO는 기존 named volume과의 호환성을 위해 `docker-compose.yml`의 로컬 개발 root credential을 유지한다. 초기화된 MinIO volume에서 root credential을 바꾸려면 별도 migration 계획이 필요하다.

## Rollback

현재 배포 경로는 source checkout과 Docker Compose rebuild를 사용한다.

수동 rollback이 필요하면 다음 절차를 사용한다.

```bash
sudo -iu orbit
cd /var/www/orbit
git log --oneline --decorate -n 10
git switch develop
git reset --hard <known-good-commit>
doppler run -- docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

rollback 대상 commit이 확인된 경우에만 실행한다. 의도 없이 공유 브랜치 상태를 되돌리지 않는다.
