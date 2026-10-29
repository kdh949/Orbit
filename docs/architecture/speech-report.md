# 리허설 음성 업로드와 리포트 생성

```mermaid
flowchart LR
    n_record["리허설 녹음 종료"]:::client
    n_upload["API 업로드·접근 검사"]:::app
    n_storage[("S3 음성 저장")]:::data
    n_queue[("BullMQ 작업 등록")]:::data
    n_worker["NestJS Worker"]:::app
    n_python["FastAPI<br/>STT·음성 분석"]:::app
    n_provider["STT / AI Provider"]:::external
    n_result[("분석 결과·작업 상태 저장")]:::data
    n_report["리허설 리포트"]:::client

    n_record --> n_upload
    n_upload --> n_storage
    n_upload -->|"저장 후"| n_queue
    n_queue --> n_worker
    n_worker --> n_python
    n_python --> n_provider
    n_provider -->|"분석 입력"| n_python
    n_python -->|"분석 결과"| n_worker
    n_worker --> n_result
    n_result -->|"조회"| n_report

    classDef client fill:#eff6ff,stroke:#60a5fa,color:#17233b
    classDef edge fill:#f8fafc,stroke:#94a3b8,color:#17233b
    classDef app fill:#f0fdfa,stroke:#2bbbad,color:#17233b
    classDef data fill:#fff7ed,stroke:#fdba74,color:#17233b
    classDef external fill:#f5f3ff,stroke:#bda4ee,color:#17233b
    classDef decision fill:#f0fdfa,stroke:#2bbbad,color:#17233b
```

녹음 파일을 저장한 뒤 분석 작업을 큐에 등록합니다. Worker가 음성 전사·분석을 실행하고 결과를 저장하면 리포트 화면에서 조회합니다.

## 상세 문서

[리허설 리포트 파이프라인 상세](../rehearsal-report/README.md)

[시스템 구조](overview.md) · [README](../../README.md#아키텍처)
