# AI PPT 시연 캐시 설정 및 재생 속도 조절

## 1. 시연 흐름

시연에서는 검수 완료한 AI PPT를 source project의 canonical Deck으로 보관한다. 발표자가 정해진 주제를 입력하고 같은 계정으로 생성을 시작하면 API가 source Deck을 새 target project로 복제한다. 화면에서는 복제된 슬라이드를 한 장씩 공개해 생성 중인 것처럼 보여준 뒤 기존 흐름대로 편집기로 이동한다.

캐시 조건이 하나라도 맞지 않으면 일반 AI 생성이 실행되므로 생성 시간이 길어진다.

## 2. 캐시할 PPT 준비

1. 캐시 기능을 끈 상태에서 시연 계정으로 AI PPT를 한 번 정상 생성한다.
2. 편집기에서 표지부터 마지막 장까지 내용, 레이아웃, 폰트와 이미지를 검수한다.
3. 브라우저 주소 `/project/{projectId}`의 `{projectId}`를 source project ID로 기록한다.
4. source project와 연결된 asset을 삭제하지 않는다. 현재 구현은 asset을 복제하지 않고 source Deck의 URL을 유지한다.
5. 실제 시연에서는 source Deck 생성 때 사용한 palette와 font를 다시 선택한다. 캐시 재생 시 색상과 폰트를 다시 적용하지 않는다.

로컬 DB에서 최근 project와 접근 계정을 확인하려면 다음 명령을 사용한다.

```powershell
docker compose exec postgres psql -U orbit -d orbit -c "SELECT project_id, title, created_by, created_at FROM projects ORDER BY created_at DESC LIMIT 10;"
docker compose exec postgres psql -U orbit -d orbit -c "SELECT project_id, user_id, role, status FROM project_members WHERE project_id = '<SOURCE_PROJECT_ID>';"
```

`DEMO_USER_ID`에는 실제 로그인한 시연 계정의 `user_id`를 넣는다. 기본 예시값인 `user_demo_1`을 그대로 사용하면 실제 로그인 계정과 달라 캐시가 동작하지 않을 수 있다. 이 계정은 source project에 `accepted` 멤버로 등록되어 있어야 한다.

## 3. 로컬 설정

`.env.local`에 다음 값을 설정한다.

```dotenv
APP_ENV=local
DEMO_FIXTURE_ENV_ALLOWLIST=local,test
DEMO_AI_DECK_CACHE_ENABLED=true
DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION=false
DEMO_AI_DECK_SOURCE_PROJECT_ID=<검수한 source project ID>
DEMO_AI_DECK_TRIGGER_TOPIC=<발표자가 입력할 정확한 주제>
DEMO_USER_ID=<실제 로그인한 시연 계정 user ID>
```

환경변수만 바꿨고 현재 API 이미지에 캐시 코드가 이미 포함되어 있다면 API만 재생성한다.

```powershell
docker compose --env-file .env.local up -d --force-recreate api
```

코드 변경까지 반영해야 하거나 이미지 상태가 확실하지 않다면 전체를 빌드한다.

```powershell
docker compose --env-file .env.local up -d --build
```

적용된 API 설정은 `.env.local` 전체나 환경변수 값을 로그에 출력하지 않는다. API 시작 검증 성공 여부와 각 key의 존재 여부만 확인하고, source project ID, 주제와 사용자 ID는 출력하지 않는다.

## 4. 로컬 시연 실행

1. 시연 계정으로 로그인한다.
2. 새 target project를 만든다. source project 자체에서 캐시 생성을 실행하면 실패한다.
3. `DEMO_AI_DECK_TRIGGER_TOPIC`과 같은 문구를 입력한다. 앞뒤 공백과 연속 공백만 정규화되며 다른 문구는 캐시 miss다.
4. source Deck에서 사용한 palette와 font를 선택한다.
5. Style 확정 후 슬라이드가 한 장씩 공개되고 마지막 장을 잠시 보여준 뒤 편집기로 이동하는지 확인한다.
6. 편집기에서 모든 슬라이드와 이미지가 정상인지 확인한다.

캐시 사용 로그는 다음처럼 확인한다.

```powershell
docker compose logs api | Select-String "ai_ppt.demo_cache.used"
```

로그가 없고 생성이 오래 걸리면 다음 항목을 순서대로 확인한다.

- `DEMO_AI_DECK_CACHE_ENABLED=true`인가
- 현재 `APP_ENV`가 `DEMO_FIXTURE_ENV_ALLOWLIST`에 포함되는가
- 실제 로그인 사용자 ID와 `DEMO_USER_ID`가 정확히 같은가
- 입력 주제와 `DEMO_AI_DECK_TRIGGER_TOPIC`이 정확히 같은가
- source project와 target project가 서로 다른가
- 시연 계정이 source project의 `accepted` 멤버인가
- source project에 schema가 유효한 canonical Deck이 있는가

캐시 조건은 맞지만 source Deck이 없거나 유효하지 않으면 일반 생성으로 전환하지 않고 `DEMO_DECK_CACHE_UNAVAILABLE`로 실패한다. 반대로 캐시 조건 자체가 맞지 않으면 Worker가 일반 AI 생성 파이프라인을 실행한다.

## 5. 슬라이드 공개 속도 조절

현재 속도는 환경변수가 아니라 [ai-deck-preview-api.ts](../../apps/web/src/features/ai-ppt/ai-deck-preview-api.ts)에 있는 두 상수로 관리한다.

```ts
export const aiDeckRevealIntervalMs = 1250;
export const aiDeckFinalSlideHoldMs = 1000;
```

- `aiDeckRevealIntervalMs`: 다음 슬라이드가 공개될 때까지의 간격
- `aiDeckFinalSlideHoldMs`: 모든 슬라이드가 공개된 후 편집기로 이동하기 전 유지 시간

전체 연출 시간은 다음과 같다.

```text
전체 시간(ms) = 슬라이드 수 × aiDeckRevealIntervalMs + aiDeckFinalSlideHoldMs
```

8장 기준 비교값은 다음과 같다.

| 공개 간격 | 마지막 장 유지 | 전체 시간 | 느낌 |
| ---: | ---: | ---: | --- |
| 750ms | 600ms | 6.6초 | 빠름 |
| 1,000ms | 800ms | 8.8초 | 약간 여유 있음 |
| 1,250ms | 1,000ms | 11초 | 현재값, 발표용 시작 권장값 |
| 1,500ms | 1,200ms | 13.2초 | 슬라이드를 설명하며 보기 좋음 |

먼저 `1,250ms / 1,000ms`로 리허설한 뒤 발표 멘트 길이에 맞춰 `250ms` 단위로 조절하는 것을 권장한다. 값을 바꾼 후 [AiDeckGenerationPage.test.tsx](../../apps/web/src/features/ai-ppt/AiDeckGenerationPage.test.tsx)의 5장·8장 예상 시간도 같은 계산식에 맞춰 수정한다.

로컬 Docker Web에 변경을 반영한다.

```powershell
docker compose --env-file .env.local up -d --build web
pnpm --filter @orbit/web test -- AiDeckGenerationPage.test.tsx
```

브라우저나 OS에서 `prefers-reduced-motion: reduce`가 활성화되어 있으면 슬라이드가 즉시 모두 공개되고 마지막 장 대기도 생략된다. 발표 장비에서는 접근성 모션 감소 설정이 꺼져 있는지 리허설 때 확인한다.

## 6. AWS 시연 환경 설정

이 값들은 API에서만 필요하며 Worker 설정으로 복제할 필요는 없다. AWS staging은 ECS Task Definition의 API container environment에 다음처럼 설정하고 새 revision으로 service를 갱신한다.

```text
APP_ENV=staging
DEMO_FIXTURE_ENV_ALLOWLIST=staging
DEMO_AI_DECK_CACHE_ENABLED=true
DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION=false
DEMO_AI_DECK_SOURCE_PROJECT_ID=<staging RDS의 source project ID>
DEMO_AI_DECK_TRIGGER_TOPIC=<발표 입력 문구>
DEMO_USER_ID=<AWS 시연 계정 user ID>
```

현재 production은 ECS 전환이 아니라 기존 EC2 Docker Compose 경로를 유지한다. production 예외는 기본적으로 거부되며 다음 세 조건이 모두 충족돼야 API가 시작된다.

- `DEMO_AI_DECK_CACHE_ENABLED=true`
- `DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION=true`
- `DEMO_FIXTURE_ENV_ALLOWLIST`에 정확한 항목 `production` 포함

적용 순서는 다음과 같다.

1. 이중 잠금 코드가 포함된 release를 `main`에 먼저 배포하되 `.env.production.example`, `infra/aws/ec2-production.env.example`, `infra/aws/main-production-bootstrap.yaml`의 두 cache flag는 모두 `false`로 유지한다.
2. production RDS에서 시연 계정의 user ID, source project의 `accepted` membership, canonical Deck schema와 asset URL 접근성을 읽기 전용으로 확인한다.
3. 최소권한 production 운영 자격 증명으로 EC2의 `/etc/orbit/production.env`에 필요한 key만 반영한다. 파일 전체와 값은 터미널, GitHub Actions log 또는 PR에 출력하지 않는다.
4. API container를 재생성하거나 `Deploy AWS Production`을 재실행한다.
5. API와 CloudFront `/api/health`를 확인한 뒤 지정 사용자·지정 주제에서 `ai_ppt.demo_cache.used` event가 기록되고 Worker enqueue가 발생하지 않는지 확인한다.
6. 다른 사용자 또는 다른 주제에서는 일반 AI 생성 경로가 실행되는지 확인한다.

source project ID와 사용자 ID는 로컬이나 staging 값이 아니라 production RDS에 실제 존재하는 값을 사용해야 한다. production env 반영 전에는 source project와 target project가 다른지, source asset을 production S3에서 계속 읽을 수 있는지도 확인한다.

롤백은 `/etc/orbit/production.env`의 `DEMO_AI_DECK_CACHE_ENABLED`와 `DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION`을 모두 `false`로 되돌린 후 API container를 재생성하거나 production workflow를 재배포한다. health와 일반 AI 생성 경로가 정상인지 확인할 때까지 source project 또는 asset은 삭제하지 않는다.

재생 속도는 Web 정적 빌드에 포함되는 코드 값이다. 속도를 바꿨다면 Web을 다시 빌드해 S3/CloudFront에 배포하고, 캐시 무효화 또는 새 asset hash가 반영되었는지 확인한다. API Task Definition만 바꿔서는 재생 속도가 바뀌지 않는다.

## 7. 발표 전 최종 체크리스트

- source project와 asset이 보존되어 있다.
- 시연 계정이 source project의 `accepted` 멤버다.
- source와 target project가 다르다.
- 트리거 문구를 복사해 메모해 두었다.
- palette와 font 선택 순서를 리허설했다.
- API 로그에서 `ai_ppt.demo_cache.used`를 확인했다.
- 8장 기준 실제 공개 시간과 발표 멘트를 함께 재봤다.
- 마지막 장 이후 편집기 이동과 전체 슬라이드 표시를 확인했다.
- OS와 브라우저의 모션 감소 설정을 확인했다.
- 캐시 실패에 대비해 완성된 source project를 별도 탭에 열어 두었다.
