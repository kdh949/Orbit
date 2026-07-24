# AWS main 자동 배포 Runbook

## 범위

이 문서는 `main` 브랜치 push를 ORBIT AWS production 배포로 연결하는 절차를 다룬다.

현재 production 배포 workflow는 `main` push와 수동 `workflow_dispatch`를 사용한다.
`main` 병합이 만든 commit은 기존 CloudFront, S3 Static Web, EC2 Docker Compose,
RDS 경로로 자동 배포된다. ECS Change Set 생성·실행이나 ALB traffic 전환은 이
workflow에 포함하지 않는다.

`develop` 또는 `main` 대상 PR은 병합 전에 `ec2-release-gate`를 통과해야 한다.
GitHub branch protection의 required status check에는 정확히
`ec2-release-gate`를 등록한다. 이 검사는 다음 순서로 기존 EC2 릴리스 호환성을
검증한다.

1. `docker-compose.aws.yml`을 production 예시 환경으로 렌더링한다.
2. 환경변수 계약과 EC2 service/healthcheck 구성을 검사한다.
3. 깨끗한 PostgreSQL에 전체 TypeORM migration을 적용한다.
4. 같은 migration 명령을 다시 실행해 pending migration이 없는 상태에서도
   실패하지 않는지 확인한다.
5. EC2 deploy wrapper가 Compose 검증, migration, direct API와 nginx proxy
   health check를 계속 수행하는지 확인한다.

이 gate는 AWS 계정이나 production instance를 변경하지 않는 배포 전 검사다.
실제 배포는 아래 수동 workflow에서 EC2 내부와 CloudFront endpoint의 health를
다시 확인한다.

현재 production 구성은 비용을 줄이기 위해 ECS/ECR/ElastiCache 없이 다음 형태로 시작한다.

- CloudFront: 단일 HTTPS entry point
- S3 Static Web bucket: `apps/web/dist`
- EC2 1대: Docker Compose로 `api`, `worker`, `python-worker`, `redis`, `private-evidence-redis`, `nginx` 실행
- RDS PostgreSQL: private subnet, pgvector는 TypeORM migration에서 생성
- S3 Assets bucket: presigned PUT/GET
- CloudWatch Logs: Docker `awslogs` driver

## 1회 AWS bootstrap

기본 region은 `ap-northeast-2`다. 다른 region을 사용하려면 GitHub Actions 변수, CloudFormation parameter, EC2 env file의 region을 함께 맞춘다.

CloudFront origin-facing managed prefix list로 EC2 80번 포트를 제한하려면 먼저 prefix list id를 확인한다.

```bash
aws ec2 describe-managed-prefix-lists \
  --region ap-northeast-2 \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query "PrefixLists[0].PrefixListId" \
  --output text
```

CloudFormation stack 생성 예시:

```bash
aws cloudformation deploy \
  --region ap-northeast-2 \
  --stack-name orbit-main-production \
  --template-file infra/aws/main-production-bootstrap.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    DbPassword='<DB_PASSWORD>' \
    CloudFrontOriginPrefixListId='<PREFIX_LIST_ID>'
```

`CloudFrontOriginPrefixListId`를 비우면 EC2 80번 포트는 `OriginIngressCidr` 기본값인 `0.0.0.0/0`로 열린다. bootstrap 직후 가능한 한 prefix list 제한으로 갱신한다.

## GitHub Actions 설정

GitHub repository 또는 environment variable:

```text
AWS_REGION=ap-northeast-2
AWS_PRODUCTION_STACK_NAME=orbit-main-production
AWS_PRODUCTION_ROLE_ARN=<GitHubActionsRoleArn output>
```

GitHub secret 값은 이 배포 workflow에 넣지 않는다. 앱 secret 원본은 SSM SecureString `/orbit/production/*`에 두고, EC2의 `/etc/orbit/production.env`는 EC2 내부에서 렌더링한다.

workflow job이 `environment: production`을 사용하므로 GitHub OIDC subject는 environment 형식도 허용해야 한다. CloudFormation template의 `GitHubDeployEnvironment` 기본값은 `production`이며, GitHub environment `production`의 deployment branch rule은 `main`만 허용하도록 유지한다.

production deploy branch에는 `package.json`, `pnpm-lock.yaml`, `apps/`, `packages/`, `infra/docker/`가 모두 있어야 한다. workflow와 EC2 wrapper는 같은 branch를 배포하므로, `main`이 앱 workspace 없이 문서만 가진 상태이면 `pnpm install`, web build, Docker Compose build가 모두 실패한다.

`Build and push images`의 `publish-ecr` job은 `main`이면서 repository variable
`AWS_ECR_PUBLISH_ROLE_ARN`이 설정된 경우에만 실행한다. 이 변수가 없으면 ECR
게시만 `skipped`가 되고 GHCR image build와 기존 EC2 배포는 계속 진행된다.
ECR role을 설정하는 것은 추후 ECS 전환을 다시 승인할 때 별도로 검토한다.

이미 생성된 stack이 이전 template으로 만들어졌다면 첫 workflow 실행 전에 같은 CloudFormation deploy 명령을 다시 실행해 `GitHubActionsDeployRole` trust policy를 갱신한다.

## EC2 deploy key

EC2가 private GitHub repository를 read-only로 가져오려면 deploy key가 필요하다.

EC2에 SSM으로 접속한 뒤 `orbit` 사용자 홈에 deploy key를 설치한다. 자동 bootstrap에서는 private key를 EC2 내부에서 생성하고 public key만 조회한다.

```bash
sudo install -d -o orbit -g orbit -m 0700 /home/orbit/.ssh
sudo -u orbit ssh-keygen -t ed25519 -N "" -C "orbit-production-ec2-deploy" -f /home/orbit/.ssh/id_ed25519
sudo -iu orbit ssh-keyscan github.com >> /home/orbit/.ssh/known_hosts
sudo cat /home/orbit/.ssh/id_ed25519.pub
```

GitHub repository settings에는 public key를 read-only deploy key로 등록한다.

## EC2 env file

CloudFormation은 `/etc/orbit/production.env.example`만 만든다. 실제 secret은 SSM SecureString에 저장한 뒤 EC2가 직접 읽어서 `/etc/orbit/production.env`를 만든다.

운영 secret parameter:

```text
/orbit/production/db-password
/orbit/production/openai-api-key
/orbit/production/session-secret
/orbit/production/cookie-secret
```

EC2 IAM role은 `/orbit/production/*`에 대한 `ssm:GetParameter`와 `ssm:GetParameters`만 가진다. SSM RunCommand 출력에는 env key 목록만 남기고 값은 출력하지 않는다.

템플릿은 저장소의 `infra/aws/ec2-production.env.example`와 EC2의 `/etc/orbit/production.env.example`를 기준으로 한다.

`private-evidence-redis`는 발표 원문 근거를 최대 30분만 보존하는 API/Worker 전용 Redis다. 작업큐용 `redis`와 분리하고 volume, RDB, AOF를 사용하지 않으며 host port도 열지 않는다. API와 Worker의 `PRIVATE_EVIDENCE_REDIS_URL=redis://private-evidence-redis:6379`은 `docker-compose.aws.yml`의 `environment`에서 직접 주입한다.

AWS 환경 예시에도 같은 키를 기록하지만 기존 EC2의 `/etc/orbit/production.env`는 template 변경으로 자동 갱신되지 않는다. Compose의 직접 주입 값이 `env_file`보다 우선하므로 기존 운영 파일에 이 키가 없어도 배포할 수 있고, 이번 복구에서는 deploy wrapper의 `required_keys`에 추가하지 않는다.

필수 값:

```text
NODE_ENV
APP_ENV
WEB_ORIGIN
API_BASE_URL
PYTHON_WORKER_URL
DATABASE_URL
REDIS_URL
SESSION_SECRET
COOKIE_SECRET
STORAGE_DRIVER
S3_BUCKET
S3_REGION
S3_FORCE_PATH_STYLE
JOB_QUEUE_DRIVER
SLIDE_PRACTICE_ENABLED
SLIDE_QUESTION_GUIDES_ENABLED
LIVE_STT_PROVIDER
REPORT_STT_PROVIDER
REHEARSAL_AUDIO_MAX_BYTES
OCR_PROVIDER
LLM_PROVIDER
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_TRANSCRIPTION_MODEL
OPENAI_EMBEDDING_MODEL
AWS_REGION
TRANSCRIBE_LANGUAGE_CODE
TEXTRACT_ENABLED
AUTH_COOKIE_SECURE
LOG_LEVEL
LOG_PRETTY
DEMO_USER_ID
DEMO_WORKSPACE_ID
DEMO_PROJECT_ID
DEMO_DECK_ID
DEMO_SESSION_ID
CLOUDWATCH_LOG_GROUP
```

권장 production 값:

```text
WEB_ORIGIN=https://<CloudFrontDomainName>
API_BASE_URL=https://<CloudFrontDomainName>
PYTHON_WORKER_URL=http://python-worker:8000
REDIS_URL=redis://redis:6379
STORAGE_DRIVER=s3
S3_BUCKET=<AssetsBucketName>
S3_REGION=ap-northeast-2
S3_FORCE_PATH_STYLE=false
JOB_QUEUE_DRIVER=bullmq
SLIDE_PRACTICE_ENABLED=true
SLIDE_QUESTION_GUIDES_ENABLED=true
REPORT_STT_PROVIDER=openai
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OCR_PROVIDER=python
TEXTRACT_ENABLED=false
AUTH_COOKIE_SECURE=true
LOG_LEVEL=info
LOG_PRETTY=false
CLOUDWATCH_LOG_GROUP=/orbit/production
```

### Editor QnA와 부분 슬라이드 연습 rollout

`main` production은 `SLIDE_PRACTICE_ENABLED=true`와
`SLIDE_QUESTION_GUIDES_ENABLED=true`를 전역으로 사용한다. 두 flag에는
project allowlist가 없으며, deploy wrapper는 둘 중 하나가 누락되면 배포를
중단한다. 저장소 template 변경은 기존 `/etc/orbit/production.env`를 자동으로
갱신하지 않으므로 최초 rollout 전에 SSM Run Command로 두 flag만 `true`로
추가하거나 교체한다. 명령 출력에는 flag 이름과 성공 여부만 남기고 env 파일의
다른 key나 값은 출력하지 않는다.

배포 후 다음 순서로 확인한다.

1. 공개 `/api/v1/runtime-config` 응답에서 `slidePracticeEnabled`와
   `slideQuestionGuidesEnabled`가 모두 `true`인지 확인한다.
2. 실제 editor QnA에서 질문 생성 Job이 완료되는지 확인한다.
3. 실제 editor에서 10초 이상 부분 슬라이드 연습을 녹음하고 report가 생성되는지
   확인한다.
4. CloudWatch에서 질문 Job, 연습 분석 Job, raw audio 삭제 완료 event를
   확인한다. 음성, transcript, script, secret 값은 출력하지 않는다.

문제가 생기면 `/etc/orbit/production.env`의 두 flag를 `false`로 되돌리고
재배포한다. rollback 후 runtime config가 둘 다 `false`인지, editor가 마이크나
생성 요청 전에 기능을 차단하며 raw 403을 노출하지 않는지 확인한다.

실제 파일 권한:

```bash
sudo chown root:root /etc/orbit/production.env
sudo chmod 0600 /etc/orbit/production.env
```

## 자동 배포 흐름

`.github/workflows/deploy-aws-production.yml`은 `main` push 또는 운영자의 수동
`workflow_dispatch`에서 다음 순서로 실행된다. `concurrency`는 실행 중인 배포를
취소하지 않고 다음 commit 배포를 대기시킨다.

1. GitHub OIDC로 AWS role assume
2. CloudFormation output에서 S3 bucket, CloudFront distribution, EC2 instance id 조회
3. `API_BASE_URL=https://<CloudFrontDomainName>`로 web build
4. SSM `AWS-RunShellScript`로 EC2의 `/usr/local/sbin/orbit-deploy-aws-production` 실행
5. EC2에서 작업큐용 `redis`와 `private-evidence-redis`가 healthy 상태가 될 때까지 기다린 뒤 migration과 API/Worker/nginx 시작
6. workflow timeout 안에서 SSM command status를 polling하고 EC2 Docker Compose 배포 완료를 기다림
7. CloudFront `/api/health`, `/socket.io/` 확인
8. backend 검증이 끝난 뒤 `apps/web/dist`를 Static Web S3 bucket에 sync
9. CloudFront invalidation
10. CloudFront `/` 확인

EC2 wrapper는 `/opt/orbit/source` 전용 checkout만 사용한다.

- 최초 실행: read-only deploy key로 `git clone --branch <GitHubDeployBranch>`
- `/opt/orbit/source`가 비어 있으면 최초 clone 대상으로 사용하고, 비어 있지 않은 non-git 디렉터리는 덮어쓰지 않는다.
- 이후 실행: `git fetch origin <GitHubDeployBranch>`, `git switch <GitHubDeployBranch>`, `git pull --ff-only origin <GitHubDeployBranch>`
- 사용자 작업 디렉터리에 `git reset`을 실행하지 않는다.
- migration 전에 두 Redis를 `docker compose up -d --wait --wait-timeout 120`으로 준비한다. 둘 중 하나가 healthy 상태가 되지 않으면 실행 중인 API/Worker를 교체하기 전에 배포를 중단한다.

SPA fallback은 CloudFront distribution-level `CustomErrorResponses`를 사용하지 않는다. Default static behavior의 CloudFront Function이 확장자가 없는 정적 SPA route만 `/index.html`로 rewrite하며, `/api/*`, `/socket.io/*`는 별도 cache behavior로 EC2 origin에 전달되어 backend의 403/404 상태와 JSON 오류 의미를 유지한다.

## 수동 배포

GitHub Actions를 통하지 않고 EC2 내부에서 재배포하려면:

```bash
sudo /usr/local/sbin/orbit-deploy-aws-production
```

repo script만 직접 실행할 수도 있다.

```bash
cd /opt/orbit/source
sudo bash ./infra/scripts/deploy-aws-ec2.sh
```

## 검증

EC2 내부:

```bash
docker compose -f /opt/orbit/source/docker-compose.aws.yml ps
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1/api/health
```

RDS pgvector:

```bash
docker compose -f /opt/orbit/source/docker-compose.aws.yml run --rm --no-deps api \
  node -e "const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL }); c.connect().then(() => c.query(\"select extname from pg_extension where extname = 'vector'\")).then((r) => { console.log(r.rows); return c.end(); }).catch((e) => { console.error(e.message); process.exit(1); });"
```

외부:

```bash
curl -fsS https://<CloudFrontDomainName>/api/health
curl -fsS "https://<CloudFrontDomainName>/socket.io/?EIO=4&transport=polling"
curl -fsSI https://<CloudFrontDomainName>/
```

S3 Assets presigned 흐름은 앱에서 프로젝트 asset upload URL을 발급한 뒤 browser PUT과 complete API까지 확인한다. presigned URL 자체는 로그에 남기지 않는다.

CloudWatch Logs:

```bash
aws logs describe-log-streams \
  --region ap-northeast-2 \
  --log-group-name /orbit/production
```

기대 stream:

- `api`
- `worker`
- `python-worker`
- `nginx`
- `redis`
- `private-evidence-redis`

## Rollback

web rollback:

1. known-good build 산출물을 Static Web S3 bucket에 sync
2. CloudFront invalidation 실행

EC2 rollback:

```bash
sudo -iu orbit
cd /opt/orbit/source
git fetch origin <GitHubDeployBranch>
git switch --detach <known-good-commit>
sudo bash ./infra/scripts/deploy-aws-ec2.sh
```

DB migration rollback은 자동화하지 않는다. migration revert는 데이터 영향이 있으므로 별도 승인 후 수동으로 진행한다.
