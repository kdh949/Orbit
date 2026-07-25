# 로컬 개발 Runbook

## 전체 실행

```bash
corepack enable
corepack prepare pnpm@10.12.4 --activate
pnpm install
cp .env.example .env.local
docker compose up --build
```

일반 로컬 실행은 기본 Compose project 이름 `orbit`을 사용한다. Codex worktree에서는 서로 다른 브랜치의 PostgreSQL, Redis, MinIO volume이 섞이지 않도록 경로 기반 project 이름을 사용하는 wrapper를 실행한다.

```bash
infra/scripts/docker-compose-worktree.sh up --build -d
infra/scripts/docker-compose-worktree.sh down --remove-orphans
```

현재 worktree에 할당될 project 이름은 다음 명령으로 확인한다.

```bash
infra/scripts/docker-compose-worktree.sh --print-project-name
infra/scripts/docker-compose-worktree.sh --print-port-env
```

wrapper는 경로 hash로 `20000`–`59999` 범위의 port block도 할당한다. 따라서 named volume과 Web, API, Python worker, PostgreSQL, Redis, MinIO의 host port가 worktree별로 분리된다. 명시적으로 전달한 port 환경변수는 자동 할당보다 우선한다.

로컬 개발용으로 인프라, migration, Web/API/Worker, Python worker를 한 번에 올리려면:

```bash
corepack enable
corepack prepare pnpm@10.12.4 --activate
pnpm install
cp -n .env.example .env.local
pnpm dev:local
```

## DB migration

```bash
docker compose up -d postgres
corepack pnpm db:migration:run
docker compose exec postgres psql -U orbit -d orbit -c "\dt migration_command_checks"
docker compose exec postgres psql -U orbit -d orbit -c "select extname from pg_extension where extname = 'vector';"
corepack pnpm db:migration:revert
docker compose exec postgres psql -U orbit -d orbit -c "select to_regclass('public.migration_command_checks');"
```

예상 결과:

- `migration:run` 후 `migration_command_checks` 테이블이 보인다.
- `pg_extension` 조회에서 `vector`가 보인다.
- `migration:revert` 후 `to_regclass` 결과가 비어 있다.

### AI Deck 338-1 migration 왕복

기존 개발 DB가 아니라 별도의 disposable local DB에서 `run → 검증 → revert → run`을 수행한다. 아래 `DATABASE_URL`에는 `orbit_3381_it` 전용 URL을 주입하되 credential을 shell history나 검증 로그에 남기지 않는다.

```bash
docker compose exec postgres createdb -U orbit orbit_3381_it
export DATABASE_URL="<orbit_3381_it 전용 로컬 DB URL>"
corepack pnpm db:migration:run
docker compose exec postgres psql -U orbit -d orbit_3381_it -c "select to_regclass('public.ai_deck_generation_stages') as stages, to_regclass('public.ai_deck_reference_extraction_artifacts') as artifacts;"
docker compose exec postgres psql -U orbit -d orbit_3381_it -Atc "select name from typeorm_migrations order by id desc limit 1;"
corepack pnpm db:migration:revert
docker compose exec postgres psql -U orbit -d orbit_3381_it -c "select to_regclass('public.ai_deck_generation_stages') as stages, to_regclass('public.ai_deck_reference_extraction_artifacts') as artifacts;"
corepack pnpm db:migration:run
docker compose exec postgres psql -U orbit -d orbit_3381_it -c "select to_regclass('public.ai_deck_generation_stages') as stages, to_regclass('public.ai_deck_reference_extraction_artifacts') as artifacts;"
AI_DECK_3381_POSTGRES_URL="$DATABASE_URL" corepack pnpm --filter @orbit/worker test
unset DATABASE_URL
docker compose exec postgres dropdb -U orbit orbit_3381_it
```

첫 `migration:run`과 마지막 재적용 후에는 `stages`와 `artifacts`가 모두 보여야 한다. `revert` 직전 최신 migration 이름은 정확히 `CreateAiDeckReferenceExtractionArtifacts2026071503000`이어야 한다. 한 번 되돌린 뒤에는 `stages`만 남고 `artifacts`는 `null`이어야 한다.

패키지 직접 실행:

```bash
corepack pnpm --filter api migration:run
corepack pnpm --filter api migration:revert
corepack pnpm --filter api migration:generate -- src/database/migrations/NextMigration
```

## Python worker

```bash
cd services/python-worker
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
uv run pytest
```

## 헬스체크

```bash
curl http://localhost:3000/health
curl http://localhost:8000/health
docker compose ps
```

## 프로젝트 생성과 파일 업로드 smoke

```bash
cp .env.example .env.local
docker compose up --build -d api web
corepack pnpm db:migration:run
corepack pnpm test:smoke
```

예상 결과:

- Web에서 프로젝트를 만들 수 있다.
- PDF, PPTX, DOCX, JPG, PNG, WebP 파일의 upload URL 발급과 complete API가 성공한다.
- 로컬 MinIO 모드에서는 API upload proxy가 파일을 MinIO bucket에 저장한다.

## AI Deck staged BullMQ 실행 확인

### staged BullMQ full-deck smoke

로컬 기본 full-deck 생성은 `.env.local`에 다음 값을 두고 실행한다.

```txt
JOB_QUEUE_DRIVER=bullmq
AI_DECK_EXECUTION_MODE=bullmq
AI_DECK_WORKER_QUEUE=all
```

API와 Worker를 재기동한 뒤 인증된 브라우저의 `/createdeck`에서 GenerateDeck을 1회 완료한다. 최종 `ai-deck-generation` Job은 `succeeded`, `progress=100`이고 생성된 Deck이 에디터에서 열려야 한다. `image-slide`은 이미지가 필요한 slide별 shard로 fan-out하며, `semantic-quality`, `rendered-visual-quality`, `publication`까지 모두 terminal 상태여야 한다. request payload, prompt, OCR 원문, provider 응답은 검증 로그에 남기지 않는다.

### checkpoint와 artifact 확인

```bash
docker compose up --build -d api worker python-worker
corepack pnpm --filter @orbit/job-queue test
```

`@orbit/job-queue` contract test는 stage payload가 strict `{ pipelineJobId, projectId, stage, shardKey }`이고 binary, base64, 전체 Deck 또는 provider raw response를 싣지 않는지 검증한다. 인증된 `/createdeck` 요청에 참고 파일을 첨부한 뒤 응답의 부모 Job ID만 별도로 기록하고, 원문을 조회하지 않는 다음 SQL로 OCR artifact와 checkpoint를 확인한다.

```bash
PIPELINE_JOB_ID=<pipeline-job-id>
docker compose exec postgres psql -U orbit -d orbit -v ON_ERROR_STOP=1 -v pipeline_job_id="$PIPELINE_JOB_ID" -c "
SELECT stage,
       status,
       COUNT(*) AS shard_count,
       COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL) AS dispatched_count,
       COUNT(*) FILTER (WHERE result_ref_json ? 'referenceExtractionArtifactId') AS locator_count
FROM ai_deck_generation_stages
WHERE pipeline_job_id = :'pipeline_job_id'
GROUP BY stage, status
ORDER BY stage, status;

SELECT usable, COUNT(*) AS artifact_count
FROM ai_deck_reference_extraction_artifacts
WHERE pipeline_job_id = :'pipeline_job_id'
GROUP BY usable
ORDER BY usable;

SELECT COUNT(*) AS matched_locator_count
FROM ai_deck_generation_stages s
JOIN ai_deck_reference_extraction_artifacts a
  ON a.artifact_id::text = s.result_ref_json->>'referenceExtractionArtifactId'
WHERE s.pipeline_job_id = :'pipeline_job_id';

SELECT COUNT(*) AS matched_planning_locator_count
FROM ai_deck_generation_stages s
JOIN ai_deck_planning_artifacts a
  ON a.artifact_id::text = s.result_ref_json->>'planningArtifactId'
WHERE s.pipeline_job_id = :'pipeline_job_id';

SELECT COUNT(*) AS matched_execution_locator_count
FROM ai_deck_generation_stages s
JOIN ai_deck_execution_artifacts a
  ON a.artifact_id::text = s.result_ref_json->>'executionArtifactId'
WHERE s.pipeline_job_id = :'pipeline_job_id';
"
```

참고 파일별 `reference-extract-file` checkpoint가 terminal 상태가 되고 locator 수와 artifact join 수가 일치해야 한다. usable source가 policy를 충족하거나 `topic-only`·`user-input-only`처럼 OCR skip이 허용된 요청이면 `source-grounding` checkpoint가 생성된다. strict policy인데 usable source가 0이면 부모 Job이 `SOURCE_GROUNDING_REQUIRED`로 실패하는 것이 정상이다.

부모 Job이 성공하면 생성된 모든 checkpoint는 `succeeded`여야 하며 `planningArtifactId`, `executionArtifactId` locator 수가 각각 artifact join 수와 일치해야 한다. 실패 Job은 `error.failedStage`와 `retryable`을 확인한다. retryable 실패는 인증된 `POST /api/v1/projects/:projectId/jobs/:jobId/retry`로 재개하며 성공한 upstream 및 같은 OCR/image stage의 성공 shard는 보존되고 실패 shard와 downstream만 다시 실행돼야 한다.

`AI_DECK_WORKER_QUEUE=reference-extract`는 역할 분리 검증용이다. 이 값의 Worker는 `generate-deck` coordinator와 `reference-extract`만 소비하므로, 로컬 전체 기능을 함께 쓰려면 다른 queue를 소비하는 `all` Worker가 별도로 필요하다.

### rollback 전 확인

`bullmq`에서 `monolith`로 돌아가거나 AI Deck stage migration을 되돌리기 전에 신규 staged 요청을 중단하고, `ai-deck-generation` 부모 Job과 `ai_deck_generation_stages`의 `queued`/`running` 잔여를 먼저 확인한다. 해당 부모 Job을 승인된 방식으로 종료·보존할지 정한 뒤 모드를 전환하며, 실행 중인 staged Job이 있는 상태에서 planning/execution artifact table을 먼저 revert하지 않는다. 위 migration 왕복 명령은 disposable local DB 검증용이다.

## 자주 보는 포인트

- `pnpm build`: workspace package가 먼저 빌드되는지 확인
- `corepack pnpm db:migration:run`: pgvector extension과 sample migration table 생성 확인
- `docker compose config`: Compose 문법 확인
- API Swagger: http://localhost:3000/docs
