## 계획: 에디터 AI 어시스턴트 이미지 생성에 참고자료 첨부 지원

현재 구조를 기준으로 보면, 가장 현실적인 방식은 "기존 업로드/프로젝트 자산 흐름을 재사용해서 첨부파일을 선택하고, 그 정보를 이미지 생성 요청에 함께 보내는 방식"입니다.

### 1. 우선 구현할 범위
- M1:
  - 이미지 생성 모드에서 첨부 버튼 추가
  - 이미지 파일, 문서 파일(예: PDF, 텍스트, Markdown 등) 첨부 가능
  - 첨부 목록 확인/삭제 가능
  - 생성 요청에 첨부 정보가 함께 전달됨

### 2. 구현 순서
1. UI 확장
- [apps/web/src/features/editor/shell/components/AiChatPanel.tsx](apps/web/src/features/editor/shell/components/AiChatPanel.tsx)에서 이미지 생성 입력창에 첨부 UI 추가
- 기존 업로드 흐름인 [apps/web/src/features/projects/ProjectAssetWorkspace.tsx](apps/web/src/features/projects/ProjectAssetWorkspace.tsx) 및 [apps/web/src/features/editor/shell/hooks/useEditorFileTransfer.ts](apps/web/src/features/editor/shell/hooks/useEditorFileTransfer.ts)를 재사용해 파일 업로드 처리

2. 요청 스키마 확장
- [packages/shared/src/deck/design-image-generation.schema.ts](packages/shared/src/deck/design-image-generation.schema.ts)에 첨부 목록 필드 추가
- 첨부는 파일명, MIME 타입, 종류, 선택적으로 요약 텍스트를 포함하도록 설계

3. 백엔드 연결
- [apps/api/src/design-agent/design-agent.controller.ts](apps/api/src/design-agent/design-agent.controller.ts)와 [apps/api/src/design-agent/design-image-generation.service.ts](apps/api/src/design-agent/design-image-generation.service.ts)에서 요청을 받아 job payload에 포함
- 현재 프로젝트에 속한 파일만 허용하도록 권한 검증 추가

4. 이미지 생성 프롬프트 반영
- [apps/worker/src/image-asset-pipeline.ts](apps/worker/src/image-asset-pipeline.ts)에서 프롬프트에 참고자료 컨텍스트를 포함
- 이미지 첨부는 시각적 참고로, 문서 첨부는 텍스트 요약/추출본으로 반영

### 3. M1에서 권장하는 제약
- 첨부는 최대 3개 정도로 제한
- 문서 첨부는 요약 텍스트 길이를 제한
- 너무 많은 첨부는 프롬프트가 길어져 품질이 떨어질 수 있으므로 초기에 제한하는 것이 안전합니다

### 4. 검증 포인트
- 첨부 추가/삭제가 UI에서 정상 동작하는지
- 생성 요청 본문에 첨부 정보가 포함되는지
- 기존 이미지 생성 기능이 깨지지 않는지
- 권한 없는 파일 첨부가 차단되는지

이 범위면 현재 코드베이스 기준으로 바로 시작하기 좋고, 이후에는 문서 포맷 확장이나 첨부별 요약 품질 개선으로 이어갈 수 있습니다.
