# AWS ECS Fargate 전환 기준

## 현재 운영 릴리스 정책

2026-07-24 운영 결정에 따라 ECS Fargate 전환은 별도 재승인 전까지 중지한다.
현재 코드 릴리스는 기존 `CloudFront -> S3 Static Web / EC2 nginx -> Docker
Compose -> RDS` 경로를 유지한다. `main`에 ECS 준비 코드나 인프라 template이
존재하더라도 production Change Set 생성·실행, ALB traffic 전환, ECS service
활성화는 코드 릴리스 범위에 포함하지 않는다.

`develop` 또는 `main` 대상 모든 PR은 `ec2-release-gate`를 통과해야 한다. 이
검사는 다음 배포 호환성을 확인한다.

- `docker-compose.aws.yml` 렌더링과 기존 EC2 service/healthcheck 계약
- 환경변수 예시, 필수 key, production 값 제약
- 깨끗한 PostgreSQL에 전체 TypeORM migration 적용 및 재실행
- EC2 deploy wrapper와 CloudFront의 API health check 경로

장기 목표 아키텍처를 다시 추진하려면 별도 운영 결정과 PR을 만들고, 기존 EC2
경로를 rollback 대상으로 보존한 상태에서 아래 전환 기준을 다시 검토한다.

## 배포 목표

운영 배포는 ECS Fargate를 기준으로 한다. Kubernetes/EKS는 현재 범위에서 제외한다.

## 서비스 분리

- `web`: S3 Static Web + CloudFront
- `api`: ECS Fargate service, ALB 뒤에 배치
- `worker`: ECS Fargate worker service
- `python-worker`: ECS Fargate worker service 또는 내부 service

## Managed service 매핑

- DB: RDS PostgreSQL + pgvector
- Cache/session/realtime adapter: ElastiCache Redis/Valkey
- Queue: BullMQ + ElastiCache Redis/Valkey
- File storage: S3 private bucket, presigned URL
- Live STT: browser on-device STT, no managed cloud STT service
- Rehearsal/coaching STT: OpenAI STT/API via `python-worker`
- OCR: Amazon Textract
- Secrets: AWS Secrets Manager
- Logs/alarms: CloudWatch. 서버 컨테이너는 stdout JSON 로그를 출력하고 `LOG_PRETTY=false`를 유지한다.

## 체크리스트

- [ ] staging/prod 환경변수 분리
- [ ] migration runbook 작성
- [ ] rollback 절차 작성
- [ ] ALB WebSocket idle timeout 설정
- [ ] S3 lifecycle policy와 KMS encryption 설정
- [ ] raw audio 삭제 정책 검증
- [ ] 청중 API에서 speaker notes/script가 노출되지 않는지 검증
- [ ] BullMQ와 ElastiCache Redis/Valkey 연결·TLS·network policy 검증
- [ ] staged BullMQ 처리와 `monolith` rollback 경로 smoke, queue/DB 잔여 상태 검증

단일 workload AZ ECS cutover와 EC2 rollback의 세부 실행 순서는 [ecs-single-az-cutover.md](runbooks/ecs-single-az-cutover.md)를 따른다. AWS 인프라는 `main` push로 자동 실행하지 않으며, change set 생성·검토와 `production` environment 승인 후 실행을 분리한다.
