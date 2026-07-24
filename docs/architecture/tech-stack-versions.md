# ORBIT 기술스택 버전

## 기준

이 문서는 ORBIT 로컬 개발 환경에서 사용하는 주요 기술스택의 버전 기준을 한눈에 보기 위해 정리한다.

주의할 점:

- `docker-compose.yml`과 Dockerfile은 컨테이너 이미지와 런타임 기준을 가진다.
- `package.json`과 `pyproject.toml`은 의존성 버전 범위를 가진다.
- 실제 설치된 정확한 패키지 버전은 `pnpm-lock.yaml`과 `services/python-worker/uv.lock`을 기준으로 한다.

## 런타임과 모노레포

| 영역 | 기술 | 버전 기준 | 기준 파일 |
| --- | --- | --- | --- |
| JavaScript runtime | Node.js | `node:24-alpine` | `infra/docker/web.Dockerfile`, `infra/docker/api.Dockerfile`, `infra/docker/worker.Dockerfile` |
| JavaScript package manager | pnpm | `10.12.4` | `package.json`, `infra/docker/*.Dockerfile` |
| Monorepo task runner | Turborepo | `^2.5.4` | `package.json` |
| TypeScript | TypeScript | `^5.8.3` | `package.json`, workspace package manifests |
| Python runtime | Python | `python:3.12-slim`, `requires-python >=3.12` | `infra/docker/python-worker.Dockerfile`, `services/python-worker/pyproject.toml` |
| Python package runner | uv | Dockerfile installs latest at build time | `infra/docker/python-worker.Dockerfile` |

## Web

| 영역 | 기술 | 버전 기준 | 기준 파일 |
| --- | --- | --- | --- |
| Frontend build | Vite | `^7.0.0` | `apps/web/package.json` |
| UI library | React | `^19.1.0` | `apps/web/package.json` |
| UI library | React DOM | `^19.1.0` | `apps/web/package.json` |
| Server state | TanStack Query | `^5.81.5` | `apps/web/package.json` |
| Client state | Zustand | `^5.0.6` | `apps/web/package.json` |
| Canvas editor | Konva | `^9.3.20` | `apps/web/package.json` |
| Canvas editor | React Konva | `^19.0.3` | `apps/web/package.json` |
| Realtime client | Socket.IO client | `^4.8.1` | `apps/web/package.json` |
| Collaboration data | Yjs | `^13.6.27` | `apps/web/package.json` |
| Icons | lucide-react | `^0.468.0` | `apps/web/package.json` |

## API와 Worker

| 영역 | 기술 | 버전 기준 | 기준 파일 |
| --- | --- | --- | --- |
| API framework | NestJS | `^11.1.3` | `apps/api/package.json` |
| Worker framework | NestJS | `^11.1.3` | `apps/worker/package.json` |
| ORM | TypeORM | `^0.3.25` | `apps/api/package.json` |
| PostgreSQL driver | pg | `^8.16.2` | `apps/api/package.json` |
| Realtime server | Socket.IO | `^4.8.1` | `apps/api/package.json` |
| Realtime scaling adapter | Socket.IO Redis adapter | `^8.3.0` | `apps/api/package.json` |
| Password hashing | Argon2 | `^0.44.0` | `apps/api/package.json` |
| Session cache client | ioredis | `^5.11.1` | `apps/api/package.json` |
| Cookie parsing/signing | cookie-parser | `^1.4.7` | `apps/api/package.json` |
| HTTP security headers | Helmet | `^8.2.0` | `apps/api/package.json` |
| Background queue | BullMQ | `^5.56.0` | `apps/worker/package.json`, `packages/job-queue/package.json` |
| Redis client | ioredis | `^5.6.1` | `apps/worker/package.json` |
| Runtime schema | Zod | `^3.25.76` | `apps/api/package.json`, `packages/shared/package.json` |
| API docs | Swagger for NestJS | `^11.2.0` | `apps/api/package.json` |
| Structured logger | nestjs-pino | `^4.6.1` | `apps/api/package.json`, `apps/worker/package.json` |
| JSON logger | Pino | `^10.3.1` | `apps/api/package.json`, `apps/worker/package.json` |
| HTTP request logger | pino-http | `^11.0.0` | `apps/api/package.json` |
| Dev log formatter | pino-pretty | `^13.1.3` | `apps/api/package.json`, `apps/worker/package.json` |

## Python Worker

| 영역 | 기술 | 버전 기준 | 기준 파일 |
| --- | --- | --- | --- |
| Python API | FastAPI | `>=0.115.0` | `services/python-worker/pyproject.toml` |
| ASGI server | Uvicorn | `>=0.34.0` | `services/python-worker/pyproject.toml` |
| AI SDK | OpenAI Python SDK | `>=1.86.0` | `services/python-worker/pyproject.toml` |
| Data validation | Pydantic | `>=2.11.0` | `services/python-worker/pyproject.toml` |
| Multipart upload | python-multipart | `>=0.0.20` | `services/python-worker/pyproject.toml` |
| Python test | pytest | `>=8.4.0` | `services/python-worker/pyproject.toml` |
| Python lint | Ruff | `>=0.12.0` | `services/python-worker/pyproject.toml` |
| Python typecheck | mypy | `>=1.16.0` | `services/python-worker/pyproject.toml` |

## Local Infra

| 영역 | 기술 | 버전 기준 | 기준 파일 |
| --- | --- | --- | --- |
| Database | PostgreSQL 18 + pgvector | `pgvector/pgvector:pg18` | `docker-compose.yml` |
| Cache, queue backend | Redis | `redis:7-alpine` | `docker-compose.yml` |
| Object storage | MinIO | `minio/minio:RELEASE.2025-04-22T22-12-26Z` | `docker-compose.yml` |
| MinIO client | mc | `minio/mc:RELEASE.2025-04-16T18-13-26Z` | `docker-compose.yml` |

## Lockfile 기준

| 생태계 | lockfile | 의미 |
| --- | --- | --- |
| JavaScript, TypeScript | `pnpm-lock.yaml` | `package.json`의 버전 범위를 실제 설치 버전으로 고정 |
| Python | `services/python-worker/uv.lock` | `pyproject.toml`의 버전 범위를 실제 설치 버전으로 고정 |

## 운영 확장 기준

운영 환경은 현재 로컬 이미지 버전을 그대로 배포한다는 뜻이 아니라, 아래 managed service로 옮길 수 있게 adapter 구조를 유지한다.

| 로컬 | 운영 기준 |
| --- | --- |
| PostgreSQL + pgvector | AWS RDS PostgreSQL + pgvector |
| Redis | AWS ElastiCache Redis/Valkey |
| BullMQ + Redis | BullMQ + AWS ElastiCache Redis/Valkey |
| MinIO | AWS S3 |
| FastAPI Python worker | ECS Fargate worker |
| Socket.IO | ALB + ECS + Redis adapter |
