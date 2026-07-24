# ORBIT 로컬 우선 아키텍처

## 방향

ORBIT은 MVP 기능 범위를 `docker compose up --build` 한 번으로 Web, API, Worker, Python worker, PostgreSQL, Redis, MinIO까지 실행할 수 있게 구성한다.

운영 기준은 Kubernetes가 아니라 AWS ECS Fargate와 managed service다.

## 로컬 서비스

| 서비스 | 역할 | 로컬 포트 |
| --- | --- | --- |
| web | Vite React UI | 5173 |
| api | NestJS REST API, Socket.IO gateway | 3000 |
| worker | NestJS background worker | - |
| python-worker | FastAPI document/STT/AI helper | 8000 |
| postgres | PostgreSQL + pgvector | 5432 |
| redis | cache, BullMQ backend | 6379 |
| minio | S3 호환 파일 저장소 | 9000, 9001 |

## 운영 매핑

| 로컬 | 운영 |
| --- | --- |
| PostgreSQL + pgvector | RDS PostgreSQL + pgvector |
| Redis | ElastiCache Redis/Valkey |
| BullMQ + Redis | BullMQ + ElastiCache Redis/Valkey |
| MinIO | S3 |
| FastAPI worker | ECS Fargate worker |
| Socket.IO | ALB + ECS + Redis adapter |
| `.env` | AWS Secrets Manager |

## Socket.IO 수평 확장

API의 모든 Socket.IO gateway는 `REDIS_URL`을 사용하는 하나의
`@socket.io/redis-adapter`에 연결한다. project presence, canvas, activity,
presentation companion room은 같은 pub/sub transport를 사용하므로 서로 다른
API task에 연결된 client 사이에서도 room broadcast가 전달된다.

- `APP_ENV=staging | production`에서 Redis pub/sub 연결이 준비되지 않으면 API는
  listen 전에 시작을 중단한다.
- `APP_ENV=local | test`에서는 Redis 연결 실패를 구조화된 warning으로 기록하고
  단일 process용 in-memory adapter를 명시적으로 사용한다.
- publisher와 subscriber client는 API shutdown에서 함께 종료한다.
- Redis connection URL과 credential은 로그에 기록하지 않는다.
- Redis adapter는 Socket.IO connection state recovery를 제공하지 않는다.
  client reconnect와 application bootstrap으로 상태를 다시 동기화한다.

## 확장 원칙

- API request/response, Job, WebSocket payload는 `packages/shared`의 Zod schema를 우선한다.
- 저장소는 `StoragePort`, 큐는 `JobQueuePort`, AI/STT/OCR은 provider interface 뒤에 둔다.
- DB 변경은 TypeORM migration으로만 반영한다.
- STT/OCR/LLM 결과는 shared schema 검증 후 저장한다.
- 발표자 script와 raw audio는 청중 API로 노출하지 않는다.
