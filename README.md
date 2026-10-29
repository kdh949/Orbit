<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/orbit-logo-dark.png" />
    <img src="./docs/assets/readme/orbit-logo-light.png" alt="ORBIT 로고" width="200" />
  </picture>
  <h1>ORBIT</h1>
  <p><strong>발표를 만드는 순간부터, 무대에 오르는 순간까지.</strong></p>
  <p>
    AI 발표자료 생성, 편집, 리허설 코칭, 실전 발표를<br />
    하나의 로컬 우선 워크스페이스에서 연결합니다.
  </p>
  <p>
    <a href="#제품-둘러보기">제품 둘러보기</a> ·
    <a href="#빠른-시작">빠른 시작</a> ·
    <a href="#아키텍처">아키텍처</a> ·
    <a href="#개인-구현">개인 구현</a> ·
    <a href="#개발-가이드">개발 가이드</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/pnpm-10.12.4-F69220?logo=pnpm&logoColor=white" alt="pnpm 10.12.4" />
  </p>
</div>

<p align="center">
  <img
    src="./docs/assets/readme/orbit-product-hero.jpg"
    alt="내 프로젝트 목록과 AI 발표자료 만들기, 최근 프로젝트 카드가 보이는 ORBIT 작업 공간"
    width="100%"
  />
</p>

ORBIT는 발표자료 제작과 발표 연습을 서로 분리하지 않습니다. 주제와 참고자료를 바탕으로 덱을 만들고, Canvas에서 편집하고, AI 코칭과 함께 리허설한 뒤, 발표자·청중 화면과 리포트까지 하나의 제품 흐름으로 이어갑니다.

이 저장소는 `pnpm` workspace와 Turborepo 기반 모노레포이며 Web, API, Worker, Python worker와 공통 계약 패키지를 함께 관리합니다.

## 제품 둘러보기

```mermaid
flowchart LR
    A["주제와 참고자료"] --> B["AI 발표자료 생성"]
    B --> C["Canvas 편집"]
    C --> D["AI 리허설"]
    D --> E["리허설 리포트"]
    E -- "다음 연습" --> D
    D --> F["실전 발표"]
```

### 하나로 이어지는 발표 워크플로

<table>
  <tr>
    <td width="50%" valign="top">
      <img
        src="./docs/assets/readme/orbit-create-flow.jpg"
        alt="발표 주제, 타깃 청중, 상세 내용과 대본 톤을 입력한 ORBIT AI 발표자료 생성 화면"
        width="100%"
      />
      <br />
      <strong>AI 발표자료 생성</strong><br />
      발표 목적, 청중, 핵심 메시지와 참고자료를 입력해 Design Pack 기반의 Deck을 생성합니다. 기존 PPTX 가져오기나 빈 프로젝트로 시작할 수도 있습니다.
    </td>
    <td width="50%" valign="top">
      <img
        src="./docs/assets/readme/orbit-editor.jpg"
        alt="슬라이드 목록, Canvas와 AI 어시스턴트 패널로 구성된 ORBIT 에디터"
        width="100%"
      />
      <br />
      <strong>Canvas 편집</strong><br />
      Konva 기반 에디터에서 슬라이드를 다듬고 AI 코치, 디자인, 발표 메모를 같은 작업 공간에서 관리합니다. 완성한 Deck은 PPTX로 내보낼 수 있습니다.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img
        src="./docs/assets/readme/orbit-rehearsal.jpg"
        alt="현재 슬라이드, 타이머, 키워드와 발표 대본이 보이는 ORBIT 리허설 화면"
        width="100%"
      />
      <br />
      <strong>AI 리허설</strong><br />
      Live STT, 말하기 속도, 핵심 키워드와 의미 단서를 바탕으로 발표 흐름을 점검하고 집중 연습으로 연결합니다.
    </td>
    <td width="50%" valign="top">
      <img
        src="./docs/assets/readme/orbit-report.jpg"
        alt="다음 연습 목표와 AI 코칭 결과를 보여주는 ORBIT 리허설 리포트"
        width="100%"
      />
      <br />
      <strong>리허설 리포트</strong><br />
      리허설 종료 후 회차별 분석, 강점과 개선점, 다음 연습 목표를 확인합니다.
    </td>
  </tr>
</table>

준비가 끝난 Deck은 발표자 화면과 청중 화면에 동기화하고, QR로 입장한 청중과 실시간 투표·평점·자유 응답 같은 활동 슬라이드로 상호작용하며 실전 발표로 이어집니다. 만든 Deck은 커뮤니티 템플릿으로 공유하거나 갤러리에서 다른 사용자의 템플릿을 가져와 시작할 수 있습니다.

### 로컬 우선으로 설계했습니다

> `docker compose up --build` 한 번으로 Web, API, Worker, Python worker, PostgreSQL, Redis, MinIO를 함께 실행합니다.

- Deck, API, Job, WebSocket 데이터는 `packages/shared`의 Zod schema를 공통 계약으로 사용합니다.
- Storage, Job Queue, AI/STT/OCR은 port와 provider interface 뒤에 두어 로컬 환경과 운영 환경을 교체할 수 있습니다.
- 발표자 script, raw audio와 transcript 원문은 청중 API에 노출하지 않습니다.

## 빠른 시작

### 요구 사항

- Node.js `>=22.12`
- pnpm `10.12.4`
- Docker와 Docker Compose

### 전체 서비스 실행

```bash
corepack enable
corepack prepare pnpm@10.12.4 --activate
pnpm install
cp .env.example .env.local
node infra/scripts/check-env.mjs
docker compose up --build
```

브라우저에서 <http://localhost:5173>을 열면 ORBIT Web을 확인할 수 있습니다.

<details>
<summary><strong>로컬 서비스 주소 보기</strong></summary>

| 서비스               | 주소                           |
| -------------------- | ------------------------------ |
| Web                  | <http://localhost:5173>        |
| API health           | <http://localhost:3000/health> |
| API Swagger          | <http://localhost:3000/docs>   |
| Python worker health | <http://localhost:8000/health> |
| MinIO console        | <http://localhost:9001>        |

</details>

인프라와 migration을 포함한 개발 환경은 `pnpm dev:local`로도 시작할 수 있습니다. 자세한 내용은 [로컬 개발 Runbook](docs/runbooks/local-development.md)을 확인하세요.

## 아키텍처

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

[전체 구조](docs/architecture/overview.md) · [실시간 청중 참여와 재접속](docs/architecture/realtime.md) · [리허설 음성 업로드와 리포트 생성](docs/architecture/speech-report.md) · [변환 파일 업로드와 메타데이터 전달](docs/architecture/artifact.md)

| 영역                 | 주요 기술                                        |
| -------------------- | ------------------------------------------------ |
| Web                  | React 19, Vite 7, TanStack Query, Zustand, Konva |
| Realtime             | Socket.IO, Yjs                                   |
| API                  | NestJS 11, TypeORM, Swagger, Zod                 |
| Background jobs      | NestJS Worker, BullMQ, Redis                     |
| Python worker        | FastAPI, Pydantic, OpenAI SDK                    |
| Local infrastructure | PostgreSQL + pgvector, Redis, MinIO              |
| Production target    | AWS ECS Fargate, RDS, ElastiCache, S3, SQS       |

운영 매핑과 확장 원칙은 [로컬 우선 아키텍처](docs/architecture/local-first-stack.md), 정확한 버전은 [기술 스택 버전 기준](docs/architecture/tech-stack-versions.md)을 확인하세요.

<details>
<summary><strong>모노레포 구조 보기</strong></summary>

```text
apps/
  web/              Vite React client
  api/              NestJS REST API + Socket.IO gateway
  worker/           NestJS background worker
services/
  python-worker/    FastAPI document, speech, and AI worker
packages/
  shared/           Zod schemas and shared contracts
  config/           Environment validation and runtime config
  editor-core/      Deck and editor domain helpers
  realtime/         Realtime event helpers
  job-queue/        Job queue ports and adapters
  storage/          Storage ports and adapters
  ai/               LLM, STT, and OCR provider interfaces
infra/
  docker/           Service Dockerfiles
  scripts/          Environment and smoke-check scripts
docs/               Architecture, conventions, runbooks, and research
```

</details>

## 개인 구현

리허설 녹음 업로드와 STT 처리, E5 발화·대본 매칭, 문서 변환 파일 전달 경로를 구현했습니다. 이후 개인 저장소에서 전역 소켓 목록 전송과 청중 응답의 잠금 범위를 개선했습니다.

| 구분           | 주요 구현                                                    | 상세                                                            |
| -------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| 팀 프로젝트    | 녹음 업로드 API·STT Worker·분석 결과 저장                    | [리허설 STT](docs/contributions/kdh949.md#rehearsal-stt)        |
| 팀 프로젝트    | E5 의미 매칭·모호한 발화 제외·대본 임베딩 재사용             | [발화·대본 매칭](docs/contributions/kdh949.md#script-alignment) |
| 팀 프로젝트    | Python 직접 업로드·저장 메타데이터 전달·Node 파일 복사 제거  | [문서 변환](docs/contributions/kdh949.md#artifact-storage)      |
| 개인 후속 개선 | 전역 소켓 목록 제거, 200 VU 결과 이벤트 p95 8.19초 → 301.9ms | [실시간 전송](docs/contributions/kdh949.md#socket-broadcast)    |
| 개인 후속 개선 | 청중별 요청 직렬화·부모 행 우선 잠금                         | [동시성 개선](docs/contributions/kdh949.md#response-locking)    |

## 개발 가이드

변경 범위에 맞는 검증을 실행합니다.

| 명령                               | 용도                 |
| ---------------------------------- | -------------------- |
| `pnpm build`                       | workspace 전체 빌드  |
| `pnpm format:check`                | 변경 파일 포맷 검사  |
| `pnpm verify:scope <scope>`        | domain별 빠른 검증   |
| `pnpm verify:affected`             | 변경 영향 범위 검증  |
| `pnpm test`                        | workspace 테스트     |
| `pnpm typecheck`                   | TypeScript typecheck |
| `node infra/scripts/check-env.mjs` | 환경변수 계약 검증   |
| `docker compose config --quiet`    | Compose 구성 검증    |

Python worker를 변경한 경우 다음 검증을 추가합니다.

```bash
cd services/python-worker
uv sync
uv run ruff check .
uv run mypy app
uv run pytest
```

공통 계약을 바꾸는 작업은 기능 구현과 분리해 작게 진행하고 `packages/shared` schema와 [공통 계약 문서](docs/contracts.md)를 함께 갱신합니다.

### Git과 PR

GitHub Flow를 사용하며 `main`에 직접 커밋하지 않습니다. 목적이 드러나는 브랜치에서 작업하고 기본적으로 `develop` 대상 PR로 검증한 뒤 병합합니다.

브랜치 이름, 커밋 메시지, PR 작성과 병합 기준은 [Git과 PR 규칙](docs/git-rules.md)을 따릅니다.

## 문서

| 문서                                                    | 내용                              |
| ------------------------------------------------------- | --------------------------------- |
| [시스템 아키텍처](docs/architecture/overview.md)        | 서비스 구성과 기능별 흐름         |
| [실시간 청중 참여](docs/architecture/realtime.md)       | 응답 저장, 결과 갱신과 재접속     |
| [리허설 음성 처리](docs/architecture/speech-report.md)  | 음성 업로드부터 리포트까지        |
| [문서 변환](docs/architecture/artifact.md)              | 파일 업로드와 메타데이터 전달     |
| [개인 구현 상세](docs/contributions/kdh949.md)          | 담당 기능, 코드와 검증 결과       |
| [AGENTS.md](AGENTS.md)                                  | 저장소 최상위 작업 규칙           |
| [ORBIT Design System](docs/orbit-design-system.md)      | 제품의 시각·상호작용 기준         |
| [공통 계약](docs/contracts.md)                          | Deck, File, Job, WebSocket schema |
| [Demo ID 기준](docs/demo-standards.md)                  | 로컬·E2E Demo 식별자              |
| [로컬 개발 Runbook](docs/runbooks/local-development.md) | 실행, migration, smoke test       |
| [환경변수 규칙](docs/conventions/environment.md)        | 환경변수 이름과 관리 기준         |
| [서버 로그 규칙](docs/conventions/logging.md)           | 업무 이벤트와 민감정보 보호       |
| [AWS 배포 기준](docs/deployment.md)                     | ECS Fargate 기반 운영 목표        |
| [README 이미지 명세](docs/readme-assets.md)             | Hero와 제품 화면 캡처 기준        |
