# ORBIT 기능별 지원 현황 매트릭스

작성일: 2026-07-17
분석 방법: 코드베이스 정적 분석 (API 컨트롤러·웹 라우트·워커 프로세서·Python worker 엔드포인트·shared 스키마·테스트·감사 문서 대조)

## 지원 수준 범례

| 표기 | 의미 |
| --- | --- |
| ✅ 지원 | 프로덕션 라우트·API·워커가 연결되어 동작하며 테스트가 존재 |
| 🟡 부분 지원 | 핵심 흐름은 동작하나 알려진 갭·한계가 있음 |
| 🟠 제한적 | 서버/계약만 존재하거나 클라이언트 미연결, 내부 전용 |
| 🔴 미지원 | 코드 없음 또는 명시적으로 미구현 |
| 🧪 목업 전용 | `/mockup/*` 디자인 참조 화면만 존재 |

## 시스템 구성 개요

| 구성 요소 | 역할 | 위치 |
| --- | --- | --- |
| Web | React 19 + Vite + Konva 캔버스 클라이언트 | `apps/web` |
| API | NestJS REST + Socket.IO 게이트웨이 | `apps/api` |
| Worker | BullMQ 백그라운드 잡 (16개 프로세서) | `apps/worker` |
| Slide render worker | 덱 슬라이드 → PNG 렌더 잡 | `apps/slide-render-worker` |
| Python worker | FastAPI — 문서 파싱, STT, 오디오 분석, AI 생성 | `services/python-worker` |
| 공통 패키지 | Zod 계약, 편집기 코어, 잡 큐, 스토리지, AI 어댑터 | `packages/*` |
| 저장소 | PostgreSQL + pgvector, Redis, MinIO | `docker-compose.yml` |

## 1. 전체 요약

| # | 기능 영역 | 지원 수준 | 한 줄 평가 |
| --- | --- | --- | --- |
| 1 | 계정·인증 | ✅ | 회원가입·로그인·세션 완결. OAuth·비밀번호 재설정은 없음 |
| 2 | 프로젝트·협업(공유/권한) | 🟡 | 멤버 초대·역할·접근 요청은 동작. 편집기가 viewer 역할을 반영하지 않는 P0 갭 존재 |
| 3 | 발표 브리프·평가 렌즈 | ✅ | 브리프 작성/저장 + 렌즈 조회 프로덕션 연결 완료 |
| 4 | 자료 업로드·참고자료(RAG) | ✅ | 업로드→추출→pgvector 색인/검색 파이프라인 동작 |
| 5 | AI 덱 생성 파이프라인 | ✅ | 위저드→스토리 검토→스타일/색→생성→미리보기 전 구간 연결 |
| 6 | 슬라이드 편집기(코어) | 🟡 | 요소 편집·패치·undo·자동저장·스냅샷은 실재. 슬라이드 복제/삭제/재정렬, zoom, viewer 게이팅 부재 |
| 7 | 편집기 AI 보조 | 🟡 | 디자인 에이전트·스피커 노트·품질 검사 동작. 경고→수정 루프 미완성 |
| 8 | PPTX 가져오기/내보내기 | 🟡 | PPTX 가져오기 + PPTX/PNG 내보내기 지원. PDF 등 그 외 형식 미지원 |
| 9 | 리허설·연습 | ✅ | 온디바이스 라이브 STT, 키워드 트리거, 녹음 분석, 리포트까지 가장 깊은 영역 |
| 10 | 코칭(연습 계획·집중 연습·도전 Q&A) | ✅ | 전 구간 프로덕션 연결. 환경 플래그로 게이팅 |
| 11 | 라이브 발표(발표자 화면) | 🟡 | 로컬 슬라이드쇼·발표자 보조·세션 관리 동작. 청중 화면 공유는 MVP 단계 |
| 12 | 청중 참여(세션·활동) | ✅ | 접속 코드 입장, 설문/사전질문/만족도 활동, 실시간 결과, 보존 정책까지 구현 |
| 13 | 실시간 캔버스 동기화(공동 편집) | 🟠 | 서버 게이트웨이만 존재, 웹 편집기 미연결. Yjs는 미사용 |
| 14 | 플랫폼·인프라·배포 | ✅ | 로컬 Docker, 헬스체크, CI, 개인 스테이징 자동 배포 구축. SQS 전송은 명시적 미구현 |

## 2. 계정·인증 — ✅

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 회원가입 | ✅ | `POST /api/v1/auth/register`, argon2id 해시 (`apps/api/src/auth/auth.service.ts`) | |
| 로그인/로그아웃 | ✅ | `POST /auth/login`, `POST /auth/logout`, 세션 스토어 기반 | |
| 세션 확인 | ✅ | `GET /auth/me`, 웹 `auth-session.ts` + 라우트별 인증 대기 처리 (`App.tsx`) | |
| 로그인/가입 화면 | ✅ | `apps/web/src/features/auth/OrbitAuthPage.tsx` (프로덕션 `/login`, `/signup`) | |
| 소셜 로그인(OAuth) | 🔴 | 코드 없음 | |
| 비밀번호 재설정·이메일 인증 | 🔴 | 코드 없음 | |

## 3. 프로젝트·협업 — 🟡

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 프로젝트 목록/생성/삭제 | ✅ | `apps/api/src/projects/projects.controller.ts`, 웹 `OrbitProjectHub.tsx` | 프로젝트 이름 변경(PATCH) 엔드포인트는 없음 |
| 멤버 초대(이메일) | 🟡 | `POST /projects/:id/members`, `ShareAccessModal.tsx` | 등록된 사용자 중심. 미가입자 이메일 초대·초대 링크 없음 |
| 역할(owner/editor/viewer) | 🟡 | `packages/shared/src/projects`, API가 viewer write 거부 | 편집기 UI가 역할 미반영 → viewer에게 편집 UI 노출 후 403 (감사 P0, 2026-07-17 코드 재확인 시 미해결) |
| 접근 요청/승인 | ✅ | `POST /projects/:id/access-requests`, `ProjectAccessRequestPage` + 승인 UI | |
| 프로젝트 접근 게이트 | ✅ | `App.tsx`의 `ProjectAccessGate`가 브리프·편집기·기록 등 보호 | |
| 공개 링크 공유 | 🔴 | 계약·코드 없음 (감사 문서에서 명시적 제외) | |
| 댓글/리뷰 협업 | 🔴 | 계약·코드 없음 | |

## 4. 발표 브리프·평가 렌즈 — ✅

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 브리프 작성/저장 | ✅ | `GET/PUT /projects/:id/presentation-brief`, `PresentationBriefPage.tsx` (라우트 `project-brief`) | 청중·목적·시간·핵심 메시지 구조화. 감사에서 "가장 강한 자산"으로 평가 |
| 평가 렌즈 조회 | ✅ | `GET /api/v1/evaluator-lenses`, 브리프 페이지에서 사용 | |
| 브리프 → 편집기/AI 컨텍스트 연결 | 🟡 | 감사 지적: 편집기·AI 코치 컨텍스트 노출 미흡 | 백로그 P1 항목 |

## 5. 자료 업로드·참고자료(RAG) — ✅

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 파일 업로드(presigned) | ✅ | `POST /projects/:id/assets/upload-url` → MinIO → `POST /assets/complete` (`files.controller.ts`) | |
| 자산 목록/콘텐츠 읽기·수정 | ✅ | `GET /assets`, `GET/PUT /assets/:fileId/content`, `ProjectAssetWorkspace.tsx` | |
| 문서 파싱(PDF/PPTX/문서) | ✅ | Python `/documents/parse`, OCR 공급자 `python`/`textract` 선택 (`config.py`) | |
| 참고자료 추출 | ✅ | `POST /references/extractions` → `reference-extract.processor.ts` → Python `/extract/reference` | |
| 임베딩 색인·검색 | ✅ | Python `/references/index`, `/references/search` (pgvector), API `POST /references/search` | AI 덱 생성의 근거 자료로 사용 |

## 6. AI 덱 생성 파이프라인 — ✅

| 단계 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 생성 위저드 | ✅ | 라우트 `create-deck` → `AiPptMockupPage`(이름과 달리 canonical 위저드, `docs/mockup-gap-audit.md` 참조) | PPT 어드바이저(`POST /ai/ppt-advisor`)로 입력 보조 |
| 잡 생성·재시도 | ✅ | `POST /projects/:id/jobs/generate-deck`, `POST /jobs/:jobId/retry` | |
| 스토리 플랜 검토 | ✅ | `GET/edit/regenerate/approve/cancel /jobs/:jobId/story-plan`, `StoryPlanReviewPage.tsx` | 사용자가 개요 승인 후 생성 진행 |
| 스타일·색상 선택 | ✅ | `POST /ai/deck-color-options`, `/deck-color-customization`, `AiPptStyleColorPage` | |
| 2단계 생성(기획→실행) | ✅ | `apps/worker/src/generate-deck/planning-stage.processor.ts`, `execution-stage.processor.ts` → Python `/ai/generate-deck` | |
| 진행 상황·미리보기 | ✅ | `GET /jobs/:jobId/deck-preview`, `AiDeckGenerationPage.tsx` | |
| 시각 품질 검사·자동 보정 | ✅ | Python `/ai/review-deck-visuals`, `/ai/repair-deck-visuals` | |
| 스마트아트 레이아웃 | 🟠 | `apps/api/src/smart-art-layouts/` (service+entity만, 컨트롤러 없음) | 생성 파이프라인 내부 전용 |
| SQS 기반 분산 생성 | 🔴 | `generate-deck.service.ts:54` "SQS transport is not implemented yet" | BullMQ 로컬 실행만 지원 |

## 7. 슬라이드 편집기(코어) — 🟡

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 캔버스 렌더/선택/편집 | ✅ | Konva 기반 `EditorCanvas.tsx`, `EditableElementNode.tsx`, 커스텀 도형 오버레이 | |
| 요소 타입 | ✅ | text, shape, image, line, arrow, chart, table, video (`packages/shared/src/deck/*.schema.ts`) | |
| 덱 저장/패치 | ✅ | `GET/PUT /projects/:id/deck`, `POST /deck/patches`, 패치 연산(add/update/delete/reorder slide·element, theme, style, animation) | `patch.schema.ts` + `applyPatch.ts` |
| 자동 저장·undo/redo | ✅ | `useEditorDocumentController.ts`, history 스토어. 감사 문서도 "실제 존재" 확인 | |
| 버전 스냅샷·복원 | ✅ | `GET /snapshots`, `POST /snapshots/:id/restore`, `DeckVersionHistoryPage.tsx` (라우트 `project-history`) | 시각 diff는 없음 |
| 애니메이션 편집 | ✅ | `AnimationEditorModal.tsx`, `AnimationInspectorPanel.tsx`, 패치 스키마 + 발표 스텝 연동 | |
| 스피커 노트 | ✅ | `SpeakerNotesPanel.tsx` + AI 제안(`POST /deck/speaker-notes/suggestions` → worker) | |
| 슬라이드 레일 기본 조작 | 🟡 | `SlideNavigatorPane.tsx` — 추가·선택·활동 슬라이드 추가만 구현 | 복제·삭제·재정렬 없음 (감사 P0, 2026-07-17 코드 재확인 시 미해결) |
| 캔버스 zoom·nudge | 🔴 | zoom 컨트롤 코드 없음 (2026-07-17 확인) | 감사 P1 백로그 |
| viewer 읽기 전용 편집기 | 🔴 | `EditorShell.tsx`에 역할 게이팅 없음 | viewer가 편집 시도 시 API 403 |
| 덱 로드 실패 처리 | 🟡 | `EditorShell.tsx:365` `deckQuery.data ?? fallbackDeck` (demo 덱 대체) | 감사 P0: 오류·재시도 UI로 교체 필요 |
| 동작하지 않는 메뉴 정리 | 🟡 | 감사: 새 프레젠테이션·이름 변경·보기 모드 등 핸들러 없는 affordance 존재 | |

## 8. 편집기 AI 보조 — 🟡

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| AI 디자인 에이전트(대화) | ✅ | `POST /projects/:id/design-agent/messages`, `AiChatPanel.tsx` | |
| 디자인 제안 미리보기·적용 | ✅ | `POST /design-agent/proposals/:id/apply`, `DesignProposalPreviewModal.tsx` | |
| AI 품질 검사(overlap·grid·overflow) | 🟡 | `features/editor/ai/quality/ValidationPanel.tsx` | 진단은 실재하나 경고가 raw element ID로 표시, 클릭-포커스·안전 수정 루프 미완성 (감사 P1) |
| 텍스트 overflow 자동 수정 | ✅ | 감사: "이미 지원되는 text overflow fix" | UI 노출이 약함 |
| 저장된 디자인 팩 | ✅ | `GET/POST/PATCH/DELETE /api/v1/design-packs` + duplicate/default | Python `design_library` 연동 |
| 키워드(시맨틱 큐) 관리 | ✅ | `POST /deck/semantic-cues` → worker → Python `/ai/extract-semantic-cues`, `KeywordInspector.tsx` | 리허설 키워드 트리거의 입력 |
| PPT 어드바이저 | ✅ | `POST /api/v1/ai/ppt-advisor` — 위저드·리허설에서 사용 | |

## 9. PPTX 가져오기/내보내기 — 🟡

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| PPTX 가져오기 | ✅ | Python `/design/import-pptx`, `PptxImportQualityPanel.tsx`, e2e `pptx-konva-accuracy.spec.ts`, `tools/pptx-accuracy` | 가져오기 품질 패널·정확도 측정 도구까지 존재 |
| PPTX 내보내기 | ✅ | `POST /deck/exports` → `deck-export.processor.ts` → Python `/ai/export-deck-pptx` | |
| PNG 내보내기 | ✅ | `deckExportFormatSchema = ["pptx","png"]`, Python `/ai/export-pptx-png-zip`, `DeckExportDialog.tsx` | ZIP으로 묶어 제공 |
| AI OOXML 생성·동기화 | ✅ | `POST /projects/:id/pptx-ooxml-generations` → worker `pptx-ooxml-generation/sync.processor.ts` → Python `/ai/pptx-ooxml-generation`, `/ai/pptx-ooxml-sync` | 편집기(`editorJobApi.ts`)에서 사용 |
| 슬라이드 PNG 렌더 파이프라인 | ✅ | `apps/slide-render-worker` (`handleSlideRenderJob` → MinIO), 웹 `useSlideRenderPipeline.ts` | |
| PDF 내보내기 | 🔴 | 코드·계약 없음 | 감사: 미지원 형식이 메뉴에 노출되는 문제 지적 |
| JSON 등 기타 형식 | 🔴 | 계약 없음 | |
| 인쇄·페이지 설정 | 🔴 | 코드 없음 | |

## 10. 리허설·연습 — ✅ (가장 깊게 구현된 영역)

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 리허설 시작·프리플라이트 | ✅ | `POST /projects/:id/rehearsals`, `RehearsalWorkspace.tsx`, 마이크 점검·발화 확인 UI | 감사에서 ORBIT 최강 차별화로 평가 |
| 온디바이스 라이브 STT | ✅ | sherpa-onnx 어댑터(`sherpaOnnxLiveSttAdapter.ts`, PCM worklet), `LIVE_STT_PROVIDER=sherpa` | 브라우저 내 실행, 런타임 설정 `GET /runtime-config` |
| 키워드 발화 트리거·자동 슬라이드 진행 | ✅ | `features/rehearsal/keywords`, `advance/`, 스펙 `docs/specs/keyword-occurrence-triggering.md` | 시맨틱 큐와 연동 |
| 녹음 업로드 | ✅ | `POST /rehearsals/:runId/audio/upload-url` → `complete` (presigned) | MediaRecorder 미지원 브라우저는 명시적 오류 |
| 리포트용 STT | ✅ | worker `rehearsal-stt.processor.ts` → Python `/audio/transcribe`, 공급자 `openai`/`whisperx` 선택 | `docs/specs/whisperx-report-stt-provider.md` |
| 오디오 분석(침묵·볼륨·VAD) | ✅ | `services/python-worker/app/audio/analysis/` (silence, volume, vad) + `/rehearsal/analyze` | 평가 산식은 MVP 휴리스틱 (`rehearsal.py:232` TODO) |
| 시맨틱 커버리지 평가 | ✅ | worker `rehearsal-semantic-evaluation.processor.ts` + 재시도 엔드포인트, `RehearsalSemanticCoverage.tsx` | NLI 벤치마크 페이지는 개발자 전용 |
| 리허설 리포트 | ✅ | `GET /rehearsals/:runId/report`, 타이밍·침묵·볼륨·습관·AI 요약 컴포넌트, 오디오 재생(`playback/`) | 라우트 `rehearsal-report`, `report-list` |
| 회차 비교·프로젝트 개요 | ✅ | `GET /rehearsals/:runId/comparison`, `rehearsal-summary`, `RehearsalProjectOverviewPage` | |
| e2e 검증 | ✅ | `tests/e2e/adaptive-coaching.spec.ts`, `presenter-screen.spec.ts` 등 | 실제 마이크 품질은 수동 검증 영역 |

## 11. 코칭(연습 계획·집중 연습·도전 Q&A) — ✅

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 다음 연습 계획(목표) | ✅ | `GET /projects/:id/practice-plan`, `PracticePlanPage` (라우트 `practice-plan`) | 리허설 결과 기반 목표 제안 |
| 집중 연습 세션 | ✅ | `focused-practice-sessions` CRUD + attempts + audio + complete/cancel + summary, `FocusedPracticePage.tsx`, worker `focused-practice-analysis.processor.ts` | |
| 도전 Q&A | ✅ | `challenge-qna-sessions` 생성·질문·힌트·답변·오디오·진행·취소, `ChallengeQnaPage.tsx`, worker 생성·답변 평가 프로세서 | 음성/텍스트 입력, 단계형 힌트 |
| 기능 플래그 게이팅 | ✅ | `GET /projects/:id/coaching-capabilities` — `FOCUSED_PRACTICE_ENABLED`, `CHALLENGE_QNA_ENABLED` | 환경에 따라 비활성화 가능 |
| 연습 목표 리마인더 | ✅ | `PracticeGoalReminder.tsx`, `PracticeGoalSummary.tsx` | |

## 12. 라이브 발표(발표자 화면) — 🟡

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 로컬 슬라이드쇼(발표 창) | ✅ | `PresentWindow.tsx`, `SlideshowRenderer`, 전환·스텝 내비게이션·키보드, 라우트 `present` | 스펙 `docs/specs/presenter-screen.md` |
| 단일 화면 발표자 모드 | ✅ | `SingleScreenPresenter.tsx`, 발표자 보조 정책(`presenterAidPolicy.ts`) | |
| 발표자 리모트(별도 창) | ✅ | `PresenterRemoteWindow.tsx`, `presentationChannel.ts` (창 간 동기화) | |
| 디스플레이 관리·자동 전체화면 | ✅ | `displayManager.ts`, 스펙 `docs/specs/slide-window-auto-fullscreen.md` | |
| 발표 세션 관리 | ✅ | `GET/POST /projects/:id/presentation-sessions`, access 갱신, close | |
| 청중 화면 공유(스트리밍) | 🟡 | `screenShareCapture.ts`, `audienceStreamBridge.ts`, `AudienceOutputControls` | MVP 단계 (`docs/qa/presenter-screen-share-mvp.md`) |
| 발표 중 실시간 자막/키워드 제어 | 🟡 | `POST /projects/:id/realtime-transcription/client-secret` (OpenAI Realtime), 스펙 `docs/specs/live-stt-keyword-control.md` | OpenAI 키 필요, 키 없으면 비활성 |
| 키워드 체크리스트 발표 화면 | ✅ | `PresentationWorkspace.tsx` (라우트 `presentation`) — 슬라이드별 키워드 확인·다음 키워드 힌트 | |

## 13. 청중 참여(세션·활동) — ✅

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 청중 입장(코드 검증) | ✅ | `GET /audience-sessions/:id/public`, `POST /join`, `AudienceEntrance.tsx`, 라우트 `audience-session` | 로그인 불필요 |
| 활동 슬라이드 편집(발표자) | ✅ | `features/activity-slides/editor/` — 설문 삽입·검수·운영 패널 | 편집기 내 특수 슬라이드로 관리 |
| 활동 템플릿 | ✅ | `pre-question`, `poll`, `satisfaction` (`activity-definition.schema.ts`) | 질문 유형: rating, single/multiple-choice, free-text |
| 활동 실행 제어(발표자) | ✅ | `PUT activities/:id/current-run`, supersede, 상태 변경, `ActivityPresenterPanel.tsx` | |
| 청중 응답 제출 | ✅ | `PUT /audience-sessions/:id/activities/:activityId/response`, 만족도 페이지 | |
| 실시간 결과 반영 | ✅ | Socket.IO `activityRealtimeClient.ts` + `packages/realtime` | e2e `activity-slides.spec.ts` |
| 결과 조회·중재 | ✅ | run results·public-results, 텍스트 응답 중재(`PATCH text-entries/:id`), `ActivityResultsPage` | |
| 결과 보존·삭제 정책 | ✅ | `activity-retention.processor.ts` + retention 스키마, `DELETE results` | |
| 라이브 Q&A·워드클라우드 등 추가 활동 | 🔴 | 템플릿 3종 외 없음 | 감사 문서에서도 명시적 제외 |

## 14. 실시간 캔버스 동기화(공동 편집) — 🟠

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 서버 게이트웨이 | 🟠 | `realtime.gateway.ts` — `canvas:state/update`, `room:create/join`, `users:list`, `slide:changed` + spec 테스트 | 서버만 존재 |
| 웹 편집기 연결 | 🔴 | 웹에서 `canvas:update` 사용처 없음 (2026-07-17 grep 확인) | 편집기는 단독 편집 전제 |
| CRDT(Yjs) 공동 편집 | 🔴 | README 스택에는 Yjs 명시되어 있으나 실제 import 0건 | remote cursor 등 없음 |

## 15. 플랫폼·인프라·배포 — ✅

| 기능 | 지원 수준 | 근거 | 비고 |
| --- | --- | --- | --- |
| 잡 큐(BullMQ+Redis) | ✅ | `packages/job-queue`, worker 16개 프로세서, `POST /jobs`, `GET /jobs/:id` | |
| SQS 등 클라우드 큐 | 🔴 | `worker.service.ts:134` "SqsJobQueue adapter is not implemented yet" | 포트만 존재 |
| 오브젝트 스토리지(MinIO) | ✅ | `packages/storage`, presigned 업로드·재생 URL | |
| DB·마이그레이션 | ✅ | TypeORM + `apps/api/src/database/migrations`, pgvector | |
| 헬스체크·문서화 | ✅ | `/health`, `/health/readiness`, Swagger `/docs`, Python `/health` | |
| 환경변수 계약 검증 | ✅ | `packages/config`, `infra/scripts/check-env.mjs`, Environment Contract CI | |
| 로컬 Docker 구성 | ✅ | `docker-compose.yml`, `infra/docker/` | |
| CI/CD | ✅ | GitHub Actions: env-contract CI, TypeScript CI, 개인 스테이징 자동 배포(Doppler 연동, `docker-compose.staging.yml`) | `main` push 자동 CI는 없음(정책) |
| e2e/스모크 테스트 | ✅ | Playwright `tests/e2e/` 7개 스펙, `pnpm test:smoke` | 1,000명 부하 테스트는 수동 실행 항목 |

## 16. 미지원·목업 전용 항목 정리

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| PDF 내보내기 | 🔴 미지원 | export 형식 enum에 없음 |
| 댓글·리뷰 협업 | 🔴 미지원 | 계약 없음 |
| 공개 링크 권한 | 🔴 미지원 | 계약 없음 |
| 실시간 공동 편집(CRDT·remote cursor) | 🔴 미지원 | Yjs 미사용 |
| SQS 분산 워커 | 🔴 미지원 | 명시적 throw |
| 초대 링크(만료·중복 사용) | 🔴 미지원 | test-matrix ORBIT-9 "planned" |
| 과거 버전 시각 diff | 🔴 미지원 | 스냅샷 목록·복원만 존재 |
| 오프라인·인쇄·페이지 설정 | 🔴 미지원 | 코드 없음 |
| `/mockup/*` 화면 23종 | 🧪 목업 전용 | `OrbitMockupFlow.tsx` — 디자인 참조용 카탈로그. 브리프·버전 기록·집중 연습 등 대부분은 프로덕션 대응 화면이 이미 존재 |

## 17. 판정 근거·검증 현황

| 근거 | 내용 |
| --- | --- |
| 테스트 규모 | TS 테스트 파일 약 1,050개(unit/spec), Python pytest 파일 30개, Playwright e2e 스펙 7개 |
| 테스트 매트릭스 | `docs/testing/test-matrix.md` — 기능 ID(ORBIT-1..)별 완료 기준·검증 앵커 관리 |
| 제품 감사 | `artifacts/product-audit-2026-07-15/ORBIT-24h-product-audit.md` — Google Slides 대비 편집기 갭·P0/P1 백로그 정의 |
| 목업 갭 감사 | `docs/mockup-gap-audit.md` — 목업 카탈로그와 프로덕션 표면 대조 |
| 코드 재확인 (2026-07-17) | 감사 P0 항목(슬라이드 복제/삭제/재정렬, viewer 게이팅, zoom, demo fallback)이 아직 코드에 반영되지 않음을 grep으로 확인 |

### 분석 한계

정적 분석 기준이며 실제 실행(마이크 녹음, 다중 사용자 세션, PPTX 라운드트립 품질, 부하)은 검증하지 않았다. OpenAI 키 등 환경 의존 기능은 설정에 따라 비활성일 수 있다.

