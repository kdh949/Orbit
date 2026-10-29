# 변환 파일 업로드와 메타데이터 전달

```mermaid
flowchart LR
    n_job["문서 변환 작업"]:::app
    n_python["Python Worker<br/>산출물 생성"]:::app
    n_s3[("S3 산출물 업로드")]:::data
    n_manifest["객체 키·크기·해시 반환"]:::app
    n_node["Node Worker<br/>객체 메타데이터 확인"]:::app
    n_db[("파일·작업 결과 등록")]:::data
    n_web["에디터 / 파일 다운로드"]:::client

    n_job --> n_python
    n_python --> n_s3
    n_s3 --> n_manifest
    n_manifest -->|"파일 위치 전달"| n_node
    n_node -->|"검증 성공"| n_db
    n_db -->|"권한 확인 후 접근"| n_web

    classDef client fill:#eff6ff,stroke:#60a5fa,color:#17233b
    classDef edge fill:#f8fafc,stroke:#94a3b8,color:#17233b
    classDef app fill:#f0fdfa,stroke:#2bbbad,color:#17233b
    classDef data fill:#fff7ed,stroke:#fdba74,color:#17233b
    classDef external fill:#f5f3ff,stroke:#bda4ee,color:#17233b
    classDef decision fill:#f0fdfa,stroke:#2bbbad,color:#17233b
```

Python Worker가 변환 파일을 객체 저장소에 업로드하고 객체 키·크기·해시를 반환합니다. Node Worker는 메타데이터를 확인한 뒤 결과 파일을 등록합니다.

## 상세 문서

[문서 변환 Worker 메모리 처리 상세](../runbooks/pptx-ooxml-worker-memory.md)

[시스템 구조](overview.md) · [README](../../README.md#아키텍처)
