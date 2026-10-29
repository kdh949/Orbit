# Orbit 시스템 아키텍처

```mermaid
flowchart LR
    n_web["React Web<br/>발표자 · 청중"]:::client
    n_cdn["CloudFront<br/>HTTPS 진입<br/>API 프록시"]:::edge
    n_api["NestJS API<br/>프로젝트 · 리허설<br/>활동 관리"]:::app
    n_db[("PostgreSQL · pgvector<br/>도메인 데이터<br/>작업 상태")]:::data
    n_queue[("Redis · BullMQ<br/>작업 큐 · room 이벤트")]:::data
    n_worker["NestJS Worker<br/>작업 실행<br/>진행 상태 관리"]:::app
    n_python["FastAPI Worker<br/>문서 변환 · AI 처리"]:::app
    n_s3[("S3<br/>원본 · 변환 파일")]:::data
    n_nginx["Nginx"]:::edge
    n_static[("S3 Static Web<br/>Web 정적 파일")]:::data

    n_web -->|"HTTPS"| n_cdn
    n_api -->|"조회 · 저장"| n_db
    n_api -->|"작업 등록"| n_queue
    n_queue -->|"작업 소비"| n_worker
    n_worker -->|"상태 갱신"| n_db
    n_worker -->|"HTTP"| n_python
    n_api -->|"파일 접근 관리"| n_s3
    n_python -->|"산출물 업로드"| n_s3
    n_cdn --> n_nginx
    n_nginx --> n_api
    n_cdn -->|"정적 파일"| n_static

    classDef client fill:#eff6ff,stroke:#60a5fa,color:#17233b
    classDef edge fill:#f8fafc,stroke:#94a3b8,color:#17233b
    classDef app fill:#f0fdfa,stroke:#2bbbad,color:#17233b
    classDef data fill:#fff7ed,stroke:#fdba74,color:#17233b
    classDef external fill:#f5f3ff,stroke:#bda4ee,color:#17233b
    classDef decision fill:#f0fdfa,stroke:#2bbbad,color:#17233b
```

발표자·청중 요청은 API와 Socket.IO에서 처리하고, 문서 변환·음성 분석은 BullMQ와 Worker로 넘깁니다. 작업 상태는 PostgreSQL에, 발표자료와 음성 파일은 S3에 저장합니다.

## 기능별 흐름

- [실시간 청중 참여와 재접속](realtime.md)
- [리허설 음성 업로드와 리포트 생성](speech-report.md)
- [변환 파일 업로드와 메타데이터 전달](artifact.md)

## 관련 문서

- [로컬 환경과 서비스 구성](local-first-stack.md)
- [기술 스택 버전](tech-stack-versions.md)

[README](../../README.md#아키텍처)
