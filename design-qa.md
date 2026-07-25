# Rehearsal waiting screen design QA

- Source visual truth: `C:\Users\Runner\Desktop\Frame 12.png`
- Implementation screenshot: `C:\Users\Runner\.codex\visualizations\2026\07\19\019f7960-a82c-7e11-b04e-91cc188840ca\rehearsal-waiting-implementation.png`
- Combined comparison: `C:\Users\Runner\.codex\visualizations\2026\07\19\019f7960-a82c-7e11-b04e-91cc188840ca\rehearsal-waiting-comparison.png`
- Viewport: 1280 × 720 implementation; source content region normalized to the same comparison width
- State: presentation window waiting for its first presenter snapshot

## Full-view comparison evidence

The implementation matches the reference hierarchy and composition: a flat near-black surface, the existing white ORBIT logo centered in the viewport, and one concise waiting message directly below it. The responsive logo width preserves the reference proportion at desktop sizes.

## Focused region comparison evidence

A separate focused crop was not needed because the only visible content is the centered logo and one text line; both remain clearly readable in the normalized full-view comparison.

## Findings

- No actionable P0, P1, or P2 differences.
- Fonts and typography: existing Pretendard token roles preserve the reference weight and single-line hierarchy.
- Spacing and layout rhythm: centered grouping and logo-to-copy gap match the reference intent.
- Colors and visual tokens: background and foreground use `inverse-surface` and `inverse-on-surface` tokens without a custom palette.
- Image quality and asset fidelity: the existing white ORBIT logo asset is reused without recreation or distortion.
- Copy and content: secondary label and explanatory paragraph were removed; the waiting message now matches the reference wording.

## Comparison history

- Pass 1: no P0/P1/P2 findings; no post-comparison fixes required.

## Validation

- Browser-rendered waiting state inspected at the local `/present/...?...sessionId=style-preview` route.
- `PresentWindow.test.tsx`: 21 tests passed.

final result: passed

---

# iPad Presenter Companion preflight design QA (2026-07-24)

## Source of truth

- User-annotated production preflight at `1934 × 1324`.
- ORBIT redesign tokens and the existing microphone preflight primitives.
- Requested intentional changes: make companion setup optional and collapsible,
  remove the private input pad, and remove handwriting readiness.

## Comparison

- Rendered the production `PresenterCompanionSetup` inside the production
  microphone-modal styles at `1934 × 1324`.
- Collapsed state matches the surrounding modal density and exposes a clear
  `선택` badge, non-blocking copy, summary state, and disclosure control.
- Expanded state keeps only the QR pairing action, iPad connection status, and
  presentation output readiness.
- Confirmed the removed private input pad and handwriting row are absent.
- Confirmed the disclosure exposes an accessible expanded state when opened.
- Confirmed the compact layout has no horizontal overflow at `500 × 900`.

## Findings

- P0: none.
- P1: none.
- P2: none.

final result: passed

---

# iPad Presenter Companion 운영 UI design QA (2026-07-24)

- Source visual truth: `prototypes/ipad-presenter-companion/reference/combined-target-v2.png` (시각 참조 전용, 운영 코드에서 import하지 않음).
- PC implementation: `docs/qa/assets/ipad-presenter-companion/preflight-pc.png`.
- iPad landscape implementation: `docs/qa/assets/ipad-presenter-companion/ipad-landscape.png`.
- iPad portrait fallback: `docs/qa/assets/ipad-presenter-companion/ipad-portrait.png`.
- PC combined comparison: `docs/qa/assets/ipad-presenter-companion/pc-comparison.png`.
- iPad combined comparison: `docs/qa/assets/ipad-presenter-companion/ipad-comparison.png`.
- CSS viewport / density: PC 788 × 863, landscape 1024 × 768, portrait 768 × 1024, `deviceScaleFactor: 1`.
- State: PC는 companion 연결 완료·private pad 입력 대기, iPad는 실제 `CompanionAudienceRenderer`의 빈 slide와 쓰기 가능 toolbar 상태.

## Full-view comparison evidence

- PC는 선택 시안의 3단계 진행 표시, QR/pairing 영역, 준비 상태 3행, 비공개 입력 패드 계층을 유지한다.
- 사용자 피드백에 따라 첫 상태 행은 추상적인 보안 연결이 아니라 status API의 실제 `iPad 연결` 여부만 설명한다.
- 시안의 별도 `기기 확인 완료` CTA는 운영 preflight의 기존 `발표 시작`·`리허설 시작`이 담당하므로 companion 패널 안에 복제하지 않았다.
- iPad는 선택 시안의 왼쪽 세로 rail, 인접 palette, dark shell을 유지하면서 운영의 실제 slide/black/screen-share 출력을 사용한다. 시안의 고정 문구, 샘플 화살표, 궤도선은 복사하지 않았다.

## Focused region comparison evidence

- PC pairing/status 영역과 iPad rail/palette가 핵심 변경 범위이므로 각각 별도의 같은-input comparison에 집중해 확인했다.
- QR은 캡처 상태에서 아직 생성 전이지만 실제 운영 동작은 기존 HTTPS `pairingUrl`을 `qrcode`로 변환하며 API unit과 E2E가 요청 계약을 검증한다.
- palette는 계약 색상 5개와 pen/highlighter 굵기 4개를 표시하고 선택 상태를 `aria-pressed`로 노출한다.

## Fidelity and interaction checks

- Fonts and typography: 기존 Pretendard와 `--redesign-type-*` 계층을 사용한다.
- Spacing and layout rhythm: surface, border, radius, shadow, spacing은 기존 `--redesign-*` 토큰을 사용한다.
- Colors: primary/success/warning/error와 ink palette를 기존 redesign token에만 매핑했다.
- Assets: Tabler 아이콘과 런타임 QR만 사용하며 정적 목업 QR이나 수제 SVG를 운영 번들에 추가하지 않았다.
- Copy and privacy: speaker notes, script, transcript, raw audio, pairing code, credential은 DOM·로그·상태 문구에 추가하지 않았다.
- Browser interaction: pen → highlighter 전환, highlighter 굵기 4, red 선택, eraser 선택 시 palette 닫힘을 확인했다.
- Responsive behavior: landscape `flex-direction: column`, portrait `flex-direction: row`, 두 viewport 모두 문서 가로 overflow가 없음을 확인했다.
- 실제 `/companion/:sessionId` 실패 shell에서 공통 header와 `연결 확인 필요` 상태를 확인했고 browser warning/error log는 비어 있었다.

## Comparison history

1. Pass 1 P1 — landscape rail의 텍스트 너비 때문에 palette가 rail과 8px 겹쳤다.
2. Fix — rail 폭을 token 조합으로 고정하고 palette를 rail 실측 폭 다음으로 이동해 12px 간격을 확보했다.
3. Pass 1 P1 — renderer scale이 viewport 전체 폭을 사용해 page padding 40px만큼 slide와 header가 가로 overflow됐다.
4. Fix — shell inset을 반영하는 `calculateCompanionRendererScale()`을 추가하고 1024 × 768에서 984px, 768 × 1024에서 728px 이내로 제한하는 회귀 테스트를 추가했다.
5. Pass 1 P2 — portrait palette와 하단 rail 사이 간격이 2px에 불과했다.
6. Fix — 실제 rail 높이와 token 간격을 반영해 10px 간격으로 보정했다.
7. Post-fix — PC, landscape, portrait를 다시 캡처했고 남은 actionable P0/P1/P2 차이가 없음을 확인했다.

## Validation

- Presenter companion component tests: 7 files, 19 tests passed.
- Web unit suite: 315 files, 1,941 tests passed.
- Presenter companion E2E: 5 tests passed.
- Web typecheck and production build passed.

final result: passed

---

# Presenter slide controller design QA (2026-07-23)

- Reference: `C:\Users\Runner\AppData\Local\Temp\codex-clipboard-717a61a0-1b0d-49d5-925f-cbbd87a925a5.png`
- Implementation: `.tmp/presenter-current.png`
- Combined comparison: `.tmp/presenter-design-compare.png`
- Viewport: 1421 × 874

## Verification

- The previous, current, and next slide previews remain fully visible in the initial viewport.
- The controller row has a bounded responsive height and no longer clips its preview content.
- The current slide remains visually emphasized while adjacent previews remain subordinate.
- Presenter tests: 25 passed.
- Web TypeScript check and `git diff --check`: passed.

final result: passed

---

# PPTX 백그라운드 처리 카드 및 작업 트레이 design QA (2026-07-22)

- Source visual truth: `/Users/donghyunkim/Documents/Orbit-pptx-import-fidelity-speaker-notes/prototypes/orbit-pptx-background-processing/design-qa-final.png`.
- Implementation screenshot: `/Users/donghyunkim/.codex/visualizations/2026/07/22/019f89ec-2dfd-76c1-b0a1-50a42ceb028f/orbit-pptx-background-production-final.png`.
- Full-view comparison: `/Users/donghyunkim/.codex/visualizations/2026/07/22/019f89ec-2dfd-76c1-b0a1-50a42ceb028f/orbit-pptx-background-production-comparison.png`.
- Focused comparison: `/Users/donghyunkim/.codex/visualizations/2026/07/22/019f89ec-2dfd-76c1-b0a1-50a42ceb028f/orbit-pptx-background-focused-comparison.png`.
- Viewport and normalization: source and implementation screenshots are both 1425 × 1013 pixels. Implementation CSS viewport is 1425 × 1013 at device pixel ratio 2; the in-app browser capture is normalized to CSS pixel dimensions, so no additional density scaling was required.
- State: `2026 하반기 제품 전략.pptx` 업로드 후 실제 `pptx-ooxml-generation` Job이 `running`, `progress: 78`인 상태.

## Full-view comparison evidence

- 선택한 3번 시안과 실제 ORBIT 홈을 같은 크기로 나란히 비교했다.
- 운영 화면은 기존 현재 리디자인 시스템의 커뮤니티/프로젝트 구성을 유지한다. 이는 전체 홈 재설계가 아니라 PPTX 처리 상태를 실제 제품에 통합한다는 범위에 따른 의도된 차이다.
- 처리 프로젝트는 목록 첫 위치에 즉시 나타나며, 임시 16:9 썸네일, 하단 진행 오버레이, 상태칩, 제목, 실제 Job 메시지와 날짜를 한 카드 안에 표시한다.
- 우측 하단 작업 트레이는 시안과 같은 파일명, 실제 퍼센트, 진행 바, 완료 안내, 접기/닫기 구조를 유지한다.

## Focused comparison evidence

- 처리 카드와 작업 트레이를 각각 같은 비교 입력에 확대해 확인했다.
- 현재 제품 카드 문법에 맞춰 편집/리허설/리포트는 썸네일의 빠른 작업으로 유지했으며, 처리 중에는 모두 비활성화된다. 시안의 하단 버튼 행을 그대로 복제하지 않은 것은 기존 카드 인터랙션을 보존하기 위한 의도된 차이다.
- 카드와 트레이 모두 동일한 `78%`를 표시하며 파란 진행 바의 길이와 상태 문구가 일치한다.

## Required fidelity surfaces

- Fonts and typography: 현재 ORBIT의 `Pretendard`와 `--redesign-type-*` 계층을 사용한다. 제목, 상태칩, 보조 메시지, 트레이 파일명의 위계와 말줄임을 확인했다.
- Spacing and layout rhythm: 처리 카드만 white surface, border, radius, shadow로 묶어 시안의 임시 카드 존재감을 재현했다. 4열 그리드와 우측 하단 fixed tray는 가로 오버플로 없이 유지된다.
- Colors and visual tokens: 새 리터럴 팔레트 없이 `--redesign-color-primary`(`#0090ff`)와 surface/outline/status 토큰만 사용한다. 카드와 트레이 진행 바가 같은 primary blue로 렌더링된다.
- Image quality and asset fidelity: 시안에서 생성한 640 × 360 임시 썸네일 raster asset을 실제 앱 asset으로 복사해 사용하며 CSS 도형이나 가짜 placeholder로 대체하지 않았다.
- Copy and content: `미리보기 만드는 중`, `PPTX 변환 중`, 파일명, Job 메시지, `완료되면 이 작업 트레이에서 알려드릴게요.`가 선택 시안의 의도를 유지한다.

## Comparison history

1. Pass 1 P1 — 브라우저 기본 progress 스타일 때문에 카드와 트레이 진행 바가 초록색으로 렌더링됐다.
2. Pass 1 P2 — 처리 카드가 일반 카드와 같은 무경계 구조여서 선택 시안보다 임시 프로젝트의 존재감이 약했다.
3. Fix — WebKit/Mozilla progress selector를 분리해 primary blue를 강제하고, PPTX 처리 카드에만 기존 token 기반 surface, border, radius, shadow와 16:9 비율을 적용했다.
4. Post-fix — 같은 1425 × 1013 viewport와 `78%` 상태에서 재캡처했다. 카드와 트레이의 색상, 파일명, 상태, 진행률이 일치하고 남은 actionable P0/P1/P2 차이가 없음을 확인했다.

## Interaction and validation

- 처리 카드의 편집, 핀, 리허설, 리포트, 삭제가 모두 비활성화되고 다른 프로젝트의 편집은 활성 상태임을 확인했다.
- 작업 트레이 접기/펼치기를 실행하고 파일명과 진행률이 복원되는 것을 확인했다.
- 브라우저 error/warning 로그가 비어 있고 문서 가로 오버플로가 없다.
- `@orbit/shared`: 55 files, 569 tests passed.
- `@orbit/api`: 127 files passed, 1 skipped; 599 tests passed, 1 skipped.
- PPTX 관련 Web 대상 테스트: 3 files, 68 tests passed.
- Web production build와 `git diff --check`가 통과했다. 전체 Web suite의 1개 실패는 이번 변경과 겹치지 않는 기존 `features/rehearsal/rehearsal-workspace-orbit.css` shadow token 위반이다.

final result: passed

---

# 리허설 성장 추세 회차 표기와 축하 마스코트 motion design QA

- Source visual truth: 사용자 브라우저 주석 화면과 `/private/tmp/orbit-product-design-source.png`.
- Implementation screenshot: `/private/tmp/orbit-product-design-implementation-final.png`.
- Expanded implementation evidence: `/private/tmp/orbit-product-design-maximized.png`.
- Full-view comparison: `/private/tmp/orbit-product-design-comparison.png`.
- Focused report comparison: `/private/tmp/orbit-product-design-focused-comparison.png`.
- Viewport: 2207 × 1324 요청 화면 기준. 브라우저 screenshot은 browser chrome을 제외한 2109 × 1324 content capture.
- State: slide 3, 하단 발표 메모 펼침, `리포트` tab, 동일 내용 report 5회, 습관어 없음과 GREAT 조건 충족.

## Full-view comparison evidence

- 원본과 구현을 같은 viewport와 editor 상태로 나란히 비교했다.
- 캔버스, slide rail, property panel, report dock의 크기와 시각 계층은 유지됐다.
- 변경 범위는 chart의 x-axis label과 축하 카드 mascot motion layer에 한정됐다.
- source가 실제 API의 4회 기록, implementation이 QA fixture의 5회 기록이라 `4회 비교`/`5회 비교` 차이는 의도된 데이터 차이다.

## Focused region comparison evidence

- 확대된 implementation에서 `1회차 (7/13)`부터 `5회차 (7/21)`까지 point와 일대일로 정렬되고 서로 겹치지 않음을 확인했다.
- 정상 눈과 감은 눈 asset은 모두 1254 × 1254, 동일한 subject placement와 transparent edge를 사용한다.
- mascot은 stable state에서 card 안에 유지되며 horizontal overflow가 없다.

## Required fidelity surfaces

- Fonts and typography: 기존 Pretendard와 `--redesign-type-*` 역할을 유지했다. 새 회차/날짜 label은 기존 chart label 크기와 weight를 그대로 사용한다.
- Spacing and layout rhythm: 기존 3-column dashboard와 celebration card padding, radius, asset slot 크기를 변경하지 않았다. 긴 label도 5개 point 간격 안에 정렬된다.
- Colors and visual tokens: 기존 primary subtle/outline surface와 motion duration/easing token만 사용하고 새 색상값을 추가하지 않았다.
- Image quality and asset fidelity: 기존 ORBIT thumbs-up mascot을 edit target으로 사용해 눈만 감긴 raster frame을 생성했다. chroma-key 제거 후 RGBA WebP의 네 모서리 alpha가 0이고 subject edge에 green background가 남지 않았다.
- Copy and content: x-axis의 모호한 `오늘` 반복을 `N회차 (M/D)`로 교체했다. 축하 카드 copy와 접근 가능한 이름은 유지했다.

## Interaction and accessibility verification

- 상시 animation: `editor-practice-mascot-float`, `editor-practice-mascot-open-eyes`, `editor-practice-mascot-blink-eyes`가 적용됨을 확인했다.
- 새 rehearsal에만 `.is-new`가 붙고 `editor-practice-mascot-fly-in`이 실행되도록 one-shot 경계를 유지했다.
- `aria-live="polite"`, decorative image의 빈 `alt`, celebration card overflow 없음 확인.
- `prefers-reduced-motion: reduce`에서 stage/open/blink animation이 모두 `none`, blink frame opacity가 `0`임을 브라우저에서 확인했다.
- 브라우저 console warning/error 없음.

## Comparison history

1. P2 — 첫 브라우저 pass에서 reduced-motion이 부유 transform은 멈췄지만 더 구체적인 eye-frame selector 때문에 blink opacity animation이 남았다.
2. Fix — reduced-motion selector를 `.is-open`과 `.is-blinking`에 직접 적용해 우선순위를 바로잡았다.
3. Post-fix evidence — 브라우저 computed style에서 stage/open/blink animation이 모두 `none`이고 blink image가 숨겨짐을 확인했다.
4. Final pass — 요청 영역에 남은 actionable P0/P1/P2 차이가 없다.

## Follow-up polish

- P3: one-shot fly-in의 중간 frame 자동 캡처는 이전 pass의 인앱 브라우저 연결 중단으로 남겼다. keyframe 존재, 800ms token duration, component `.is-new` gating, unit test는 통과했다.

## Dynamic motion follow-up — 2026-07-21

- Source visual truth: 기존 안정 상태 `/private/tmp/orbit-dynamic-before.png`와 사용자의 “조금 더 동적인 애니메이션” 피드백.
- Implementation screenshot: 환호 점프 구간 `/private/tmp/orbit-dynamic-cheer.png`.
- Full-view comparison: `/private/tmp/orbit-dynamic-comparison.png`.
- Viewport: 1280 × 720, slide 3, `리포트` tab, 동일한 5회 QA fixture.
- Focused region comparison: full-view에서도 축하 카드의 마스코트 크기와 위치가 충분히 읽혀 별도 crop은 만들지 않았다.
- Findings: 기존 card 크기, copy, asset 선명도, GREAT stamp 위치는 유지된다. 새 drift와 cheer transform을 별도 wrapper에 분리해 자연스러운 부유 중 6.4초마다 짧은 squash-and-stretch 점프가 합성된다. fly-in은 120% x offset에서 곡선 overshoot로 강화하고 stamp는 220ms 늦게 등장한다.
- Fonts and typography: 변경 없음.
- Spacing and layout rhythm: card와 asset slot 크기는 변경하지 않았고 문서 가로 overflow가 없다.
- Colors and visual tokens: 새 색상 없이 기존 motion duration/easing token만 사용했다.
- Image quality and asset fidelity: 기존 RGBA WebP frame을 그대로 사용하며 blur는 fly-in 시작 38% 안에서만 3px에서 0으로 해소된다.
- Copy and content: 변경 없음.
- Browser verification: computed animation이 `editor-practice-mascot-drift` 5.4s, `editor-practice-mascot-cheer` 6.4s로 적용됐다. `aria-live="polite"`, console warning/error 없음, `prefers-reduced-motion: reduce`에서 stage/character/open/blink animation이 모두 `none`임을 확인했다.
- Comparison history: 첫 비교에서 card layout이나 asset crop의 P0/P1/P2 회귀가 없었다. 추가 visual fix는 필요하지 않았다.

## Click reaction follow-up — 2026-07-21

- Source visual truth: 클릭 전 안정 상태 `/private/tmp/orbit-mascot-click-before.png`와 사용자의 “클릭하면 반응” 피드백.
- Implementation screenshot: 클릭 후 210ms 반응 frame `/private/tmp/orbit-mascot-click-reaction-final.png`.
- Full-view comparison: `/private/tmp/orbit-mascot-click-comparison-final.png`.
- Viewport/state: 1280 × 720, slide 3, `리포트` tab, 동일한 5회 QA fixture.
- Focused region comparison: full-view에서 마스코트의 상승·회전과 focus outline이 읽혀 별도 crop은 필요하지 않았다.
- Findings: card layout과 raster asset은 유지된다. 마스코트는 접근 가능한 native button이 되었고 pointer click마다 540ms `editor-practice-mascot-react`가 새로 시작된다. focus-visible outline, hover/active feedback, 반복 클릭마다 교대로 갱신되는 polite live message를 추가했다.
- Fonts and typography: 시각 text 변경 없음. Spacing and layout rhythm: button reset으로 기존 168px slot과 card 높이를 유지했다. Colors and visual tokens: 기존 primary focus color와 motion token만 사용했다. Image quality and asset fidelity: 기존 WebP frame을 그대로 사용했다. Copy and content: visible copy 변경 없음.
- Browser verification: pointer 클릭과 반복 클릭에서 live message가 각각 갱신되고 reaction transform이 active/settled state 사이에서 변경됐다. button이 접근성 tree에 `ORBIT 마스코트와 함께 기뻐하기`로 노출되고 focus target이 됨을 확인했다. `prefers-reduced-motion: reduce`에서는 reaction animation이 `none`, hover transition이 `0s`였다. console warning/error와 가로 overflow는 없었다.
- Comparison history: 동일 viewport/state 전후 비교에서 새로운 P0/P1/P2 회귀가 없었다.

final result: passed

---

# Rehearsal microphone modal — Frame 13 refinement

- Source visual truth: `C:/Users/Runner/Desktop/Frame 13.png`.
- Implementation evidence: `C:/Users/Runner/.codex/visualizations/2026/07/19/019f7960-a82c-7e11-b04e-91cc188840ca/rehearsal-mic-modal-frame13.png`.
- The source and browser-rendered modal were compared together at desktop scale.
- The title and supporting copy now match the reference hierarchy, with the existing redesign title/body tokens and 32px modal padding.
- Permission and recognition steps use the existing primary, outline, success, and error tokens; the live waveform and microphone selection behavior remain intact.
- Browser verification confirmed the permission-granted state, device selector, recognition prompt, and CTA layout. `RehearsalWorkspace.test.tsx`: 113 tests passed.

final result: passed

---

# 리허설 마이크 확인 모달 design QA

## Visual truth

- 선택 시안(3번): `C:\Users\Runner\.codex\generated_images\019f7960-a82c-7e11-b04e-91cc188840ca\exec-47a9ca5d-ce47-469d-98be-944966d23a39.png`
- 파형 참고 이미지: `codex-clipboard-51d5907a-51f6-4e00-9959-b17caa28248e.png`, `codex-clipboard-c3a78fb4-4308-4b98-aab9-9c560b5b8a66.png`, `codex-clipboard-8de8efa4-31c8-46fc-bf1a-8a035288f88d.png`

## Implementation evidence

- 전체 화면: `C:\Users\Runner\.codex\visualizations\2026\07\19\019f7960-a82c-7e11-b04e-91cc188840ca\rehearsal-mic-modal.png`
- 모달 집중 화면: `C:\Users\Runner\.codex\visualizations\2026\07\19\019f7960-a82c-7e11-b04e-91cc188840ca\rehearsal-mic-modal-focused.png`
- viewport: 1440 × 1024
- 상태: 마이크 권한 허용, fake audio input 선택, 실시간 파형 활성, 음성 감지 성공, `마이크 없이 시작` 표시

## Comparison and findings

- 전체 화면과 집중 화면을 선택 시안과 나란히 비교했다.
- 제목, 설명, 3단계 계층, 중앙 모달 비율, CTA와 보조 동작의 시각적 우선순위가 시안과 일치한다.
- 사용자 요청에 따라 1단계에 실제 마이크 선택 UI를 추가했고, 2단계는 `AudioContext`/`AnalyserNode` 기반 실제 입력 파형으로 대체했다.
- 배경 페이지는 진입 위치를 유지하는 page-agnostic modal 요구 때문에 시안과 달라도 의도된 차이다.
- 별도의 P0/P1/P2 시각 결함은 확인되지 않았다. 초기 비교에서 빠졌던 `마이크 없이 시작` 보조 동작은 수정 후 재검증했다.

## Interaction verification

- 마이크 권한 허용 후 장치 목록 3개 노출 확인
- 선택한 마이크 장치 ID 저장 및 리허설 스트림 재사용 확인
- 실시간 canvas 파형 크기 396 × 82 및 입력 분석 루프 활성 확인
- `리허설 시작`의 `preflight=complete` 경로와 `마이크 없이 시작`의 `preflight=without-voice` 경로 확인
- 브라우저 `pageerror`는 없었다. 로컬 인증/API가 준비되지 않은 상태에서 기존 401/404 및 네트워크 차단 콘솔 메시지는 관찰됐으며 이번 UI 코드와 직접 관련된 오류는 아니다.
- TypeScript 검사와 `RehearsalWorkspace.test.tsx` 113개 테스트를 통과했다.

final result: passed

---

# Rehearsal display options design QA

- Source visual truth: `C:/Users/Runner/Desktop/Frame 7.png`, `C:/Users/Runner/Desktop/Frame 8.png`.
- Implementation evidence: current in-app browser capture of `/rehearsal/project_6c000fc2-a814-4c85-a5ad-bc5931ec94a6` with the display options popover open.
- State: presenter mode enabled, automatic placement disabled, fullscreen enabled, new-window display selected.

## Comparison evidence

- The source references and implementation capture were compared together at desktop scale.
- The panel measures 360px wide with 32px top/side padding and 25px bottom padding, matching the annotated reference.
- Header hierarchy, presenter-mode helper copy, switch treatment, slideshow grouping, conditional display-position surface, and bottom-anchored primary action match the reference structure.
- Turning fullscreen off removes the display-position radio group; turning presenter mode off removes the automatic-placement switch.
- Enabling automatic placement requests display permission from the original click activation before updating local UI state.
- Existing redesign color, radius, type, space, and shadow tokens are used; no new visual asset was introduced.

## Verification

- `DisplayControls.test.tsx`: 10 tests passed.
- `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`: passed.
- In-app browser console: no warnings or errors.
- `git diff --check`: passed with the existing LF-to-CRLF warning only.
- No P0, P1, or P2 visual mismatch remains in the requested popover states.

final result: passed

---

# QnA 답변 가시성 및 하단 탭 밀도 design QA

- Source visual truth: `/var/folders/bz/br99y0bj2395vd1507vwbqmm0000gn/T/codex-clipboard-38909dcc-4b0f-4b87-a400-37743dc0abe5.png`.
- Implementation screenshot: `/private/tmp/qna-latest.png`.
- Combined comparison: `/private/tmp/qna-tabs-unified-comparison.png`.
- Route: `http://localhost:4174/project/project_972d5901-d92c-4dfb-9e3d-547a3079f940`.
- Viewport: 1280 × 720, 발표 메모 확장 후 QnA 탭 선택 상태.

## Findings and fixes

1. P1 — 추천 답변 데이터는 DOM에 존재했지만 QnA 외부 패널과 내부 패널의 이중 여백, 18~22px 질문 글자 크기 때문에 답변이 첫 화면 아래로 밀려 보이지 않았다.
2. QnA 내부 중복 여백을 제거하고 외부 패널 여백을 대본·리포트와 같은 `8px 12px 12px`로 통일했다.
3. 질문은 16px, 답변과 핵심 포인트는 14px 기준으로 낮추고 카드·도구막대·구분선 간격을 축소했다.
4. 1280 × 720에서 추천 답변 요약 전체가 스크롤 전 화면 안에 표시되며, 핵심 포인트부터 패널 내부 스크롤로 이어진다.
5. 실제로 추천 답변 데이터가 없는 경우에는 빈 영역 대신 `추천 답변을 불러오지 못했습니다. 다시 생성해 주세요.`를 표시하고 전체 답변 토글을 숨긴다.

## Interaction and regression checks

- 대본, QnA, 리포트 탭을 순서대로 전환하고 세 패널의 외부 여백과 스크롤 영역을 비교했다.
- 대본 본문과 QnA 답변은 14px 보조 본문 기준을 공유하고, 리포트/QnA 제목은 16px 계층을 유지한다.
- QnA 이전·다음·다시 생성과 전체 답변 토글 구조를 유지했다.
- `SlideQuestionGuidePanel.test.tsx` 11개 테스트와 Web production build가 통과했다.

final result: passed

---

# 에디터 QnA 패널 정보 구조 개선 design QA

- Source visual truth: `/var/folders/bz/br99y0bj2395vd1507vwbqmm0000gn/T/codex-clipboard-38909dcc-4b0f-4b87-a400-37743dc0abe5.png`.
- Implementation route: `http://127.0.0.1:4174/project/project_972d5901-d92c-4dfb-9e3d-547a3079f940`.
- Implementation screenshot: `/private/tmp/qna-editor-full.png`.
- Focused implementation screenshot: `/private/tmp/qna-panel-focused.png`.
- Combined comparison: `/private/tmp/qna-design-comparison.png`.
- Viewport/state: 1116 × 794 CSS px, QnA 탭, Q1 / 3, 추천 답변 접힘 상태.

## Comparison evidence

- 참조의 개선안과 구현 화면을 한 비교 이미지에 배치해 질문 탐색, 질문·핵심 개념, 답변 요약, 상세 답변 disclosure의 정보 계층을 확인했다.
- 기존의 가운데 정렬된 큰 질문 카드와 전체 답변 즉시 노출 구조를 제거하고, 왼쪽 정렬 질문과 요약 우선 구조로 바꿨다.
- 진행 상태는 `Q1 / 3`, 현재 문항 점, 이전·다음 버튼으로 압축했고 재생성은 같은 toolbar의 보조 동작으로 유지했다.
- 보라색 강조 대신 redesign primary blue 계열 토큰만 진행 상태, 핵심 개념, AI 추천, 체크 아이콘에 사용했다.

## Interaction and responsive verification

- `전체 답변 보기`를 누르면 `aria-expanded`가 `false`에서 `true`로 바뀌고, `답변 접기`로 다시 축소된다.
- `다음 질문`과 `이전 질문`을 눌러 `Q1 / 3 → Q2 / 3 → Q1 / 3` 전환을 확인했다.
- 583px 폭의 실제 하단 패널에서 toolbar가 겹치지 않고 질문·답변 영역이 패널 내부에서 스크롤된다.
- 인앱 브라우저 console warning/error 없음.

## Verification

- `SlideQuestionGuidePanel.test.tsx`: 10 tests passed.
- `pnpm --filter @orbit/web build`: passed with the existing bundle-size and dynamic-import warnings only.
- `git diff --check`: passed.

final result: passed

---

# Create deck first-step design QA

- Source visual truth: `/var/folders/bz/br99y0bj2395vd1507vwbqmm0000gn/T/codex-clipboard-e806a6c4-f0be-4044-8753-75c50caadb56.png` plus the current task requirements for a two-stage connected indicator and a single content flow.
- Implementation screenshots: `/private/tmp/orbit-createdeck-772-final.png`, `/private/tmp/orbit-createdeck-detail-772-final.png`, `/private/tmp/orbit-createdeck-tone-divider-final.png`, `/private/tmp/orbit-createdeck-step-outline-final.png`, `/private/tmp/orbit-createdeck-step-gray-outline-final.png`, `/private/tmp/orbit-rehearsal-picker-772-final.png`, and `/private/tmp/orbit-reports-772-final.png`.
- Earlier mobile evidence: `/private/tmp/orbit-createdeck-qa-mobile.png` at 442px; current responsive rules were rechecked at the same `max-width: 620px` and `max-width: 900px` breakpoints.
- Route: `/createdeck`.
- Viewports: 772 × 721 current annotation viewport, plus the earlier 442 × 665 mobile capture.
- State: authenticated workspace shell, first stage active, empty content form, default policy and tone selections.

## Full-view comparison evidence

The annotated 772px implementation was reviewed against the supplied 772px and 442px browser evidence. The policy controls now switch to one column before their descriptions become cramped, while the project and report tables switch to title-plus-action rows. No project identifier is exposed in the rehearsal list, and no horizontal overflow or clipped persistent action was observed.

## Focused region comparison evidence

The source and implementation indicators were placed in one focused comparison. Both use a connected capsule with rounded outside edges and a directional first segment. ORBIT intentionally maps the source's green status color to the redesign primary-to-secondary gradient and reduces the flow to the requested two stages. The implementation keeps the same visual direction while using production labels and design tokens.

## Required fidelity surfaces

- Fonts and typography: Pretendard and redesign type tokens are used. Stage labels, form labels, placeholders, policy values, attachment copy, and tone labels keep lighter weights; internal project IDs are removed from user-facing copy.
- Spacing and layout rhythm: `OrbitIconLabel` fixes every icon slot to the shared 20px icon token and applies the same spacing token to form, policy, attachment, and script-tone headings. Policy controls stack at 900px; project and report rows also adopt compact two-column layouts at that breakpoint.
- Colors and visual tokens: form and policy controls use `primary-subtle` instead of the dull neutral fill, icons use `primary-emphasis`, dividers use `outline-variant`, and active states use the redesign primary/secondary palette.
- Image quality and asset fidelity: the flow indicator is native UI rather than a raster asset. All semantic icons use the existing Tabler icon dependency; no placeholder or improvised glyph was introduced.
- Copy and content: `내용 구성` and `이미지 구성` expose the selected value plus a subdued, dynamically updated explanation. Redundant helper copy beneath `참고 자료` and `대본 톤` was removed while upload formats remain visible inside the drop zone.

## Interaction verification

- Opened the shared white `DropdownMenu` for `내용 구성`, confirmed four `menuitemradio` options and checked state, selected `참고자료 우선`, verified the helper description updated, then restored `사용자 입력만`.
- Selected a different script tone and restored `전문적인`; the selected button remained exposed through `aria-pressed`.
- Confirmed two stages, no duplicated tone panel, no `핵심 컨텍스트` title, and no horizontal overflow at desktop and mobile viewports.
- The `/createdeck`, `/project?intent=rehearsal`, and `/reports` captures reported no console warnings or errors.
- `pnpm --filter @orbit/web typecheck` passed.
- AI PPT tests passed: 14 tests.
- Targeted `/createdeck` app-route test passed.
- `pnpm --filter @orbit/web build` passed with the existing chunk-size warning only.

## Comparison history

1. P1 — the initial numbered indicator was visually heavy and disconnected from the requested pipeline reference. Replaced it with a compact connected capsule and directional active segment.
2. P1 — `핵심 컨텍스트` and `발표 톤` were presented as two competing panels. Merged them into one content flow and demoted tone to a compact `대본 톤` fieldset.
3. P2 — labels and placeholder copy looked overly bold. Reduced the active stage, field, helper, policy, attachment, and tone text weights while preserving contrast.
4. P2 — native policy selects did not match shared product menus and gave no selection rationale. Replaced them with `DropdownMenu`/`DropdownMenuItem` and added tokenized, live helper descriptions.
5. P2 — icon labels used ad hoc gaps and inconsistent semantic icons. Added the shared `OrbitIconLabel`, fixed the icon slot, and replaced content/tone icons with clearer document and message symbols.
6. P1 — the 772px policy and list layouts retained desktop columns, producing cramped descriptions and overlapping metadata. Added a 900px intermediate breakpoint and removed project IDs from user-facing rows.
7. P2 — neutral field fills made the creation flow look dull. Mapped form and policy surfaces to `primary-subtle` and icon accents to `primary-emphasis`.
8. Post-fix evidence — the latest 772px captures show aligned labels, one-column policy controls, compact list rows, and no actionable P0/P1/P2 issue in the requested regions.
9. P2 — the `fieldset` top border intersected the `대본 톤` legend. Removed the top border, retained a single bottom divider before the CTA, and verified the revised hierarchy in `/private/tmp/orbit-createdeck-tone-divider-final.png`.
10. P3 — the inactive second stage carried more color than needed. Removed its fill so the inactive stage uses the white surface and primary outline only; `/private/tmp/orbit-createdeck-step-outline-final.png` confirms the quieter hierarchy.
11. P3 — the inactive outline still carried too much brand color. Replaced it with the light neutral `outline-variant` token and verified the result in `/private/tmp/orbit-createdeck-step-gray-outline-final.png`.

## Findings

No remaining P0, P1, or P2 visual issue in the requested regions.

## Follow-up polish

- P3: validate helper-copy length against translated or server-provided policy descriptions before localization ships.

final result: passed

---

# 청중 참여 화면 공통 카드 design QA

- Source visual truth: `/var/folders/bz/br99y0bj2395vd1507vwbqmm0000gn/T/codex-clipboard-f48ba377-0e42-4353-80e1-49c102e892b4.png`.
- Implementation route: `/project/project_972d5901-d92c-4dfb-9e3d-547a3079f940/activity-preview/activity_1`.
- Implementation screenshot: `/private/tmp/orbit-audience-wide.png`.
- Combined comparison: `/private/tmp/orbit-audience-comparison.png`.
- Viewports: desktop 1456 × 1086, mobile 390 × 844.
- State: 사전 질문 입력 화면과 제출 완료 화면. 사전 질문·실시간 투표·만족도 조사가 같은 청중 폼 레이아웃을 공유한다.

## Findings and comparison history

1. P1 — 기존 폼은 최대 폭 560px의 작은 카드와 조밀한 컨트롤 때문에 청중이 멀리서 보거나 터치하기 어려웠다.
2. 참조 시안의 중앙 흰색 카드, 번호 원형, 필수 표시, 큰 선택지, 전체 폭 제출 버튼 구조를 공통 청중 폼에 적용했다.
3. 템플릿별 제목과 안내 문구는 유지하면서 사전 질문·실시간 투표·만족도 조사에 동일한 시각 계층이 적용되도록 `data-activity-template` 계약을 추가했다.
4. 데스크톱에서 카드 폭 1048px, 모바일에서 본문 폭 375px 내 가로 오버플로 없음, 제출 완료 상태 전환을 확인했다.

## Required fidelity surfaces

- Typography: 영문 유형 라벨, 큰 한국어 제목, 설명, 질문 순서로 계층을 맞췄다.
- Spacing: 질문마다 독립 카드와 넉넉한 내부 여백을 사용하고 터치 컨트롤 높이를 확대했다.
- Colors: redesign의 `primary-subtle`, `surface`, `outline-variant`, `secondary-container` 토큰만 사용했다.
- Interaction: 선택 상태, 텍스트 입력, 필수 검증, 제출 완료 흐름을 기존 기능과 동일하게 유지했다.
- Responsive: 390px에서 질문 카드, 선택지, 제출 버튼이 화면 폭 안에서 재배치된다.

## Verification

- `pnpm --filter @orbit/web exec vitest run src/features/activity-slides/audience/AudienceSatisfactionPage.test.tsx` passed: 7 tests.
- `pnpm --filter @orbit/web typecheck` passed.
- Docker web rebuild passed.
- 실제 브라우저에서 사전 질문 입력 → 제출 완료 흐름 통과.
- 실제 브라우저의 console warning/error 없음.
- 인앱 브라우저의 캡처 배율 오차가 있어 시각 검증은 DOM geometry와 실제 상호작용 결과를 함께 사용했다.

final result: passed

---

# 실시간 응답 결과 장표 design QA

- Source visual truth: `/var/folders/bz/br99y0bj2395vd1507vwbqmm0000gn/T/codex-clipboard-a077d3c3-85a3-4179-988c-7b1cf6fd6c8e.png`.
- Implementation capture: in-app browser의 `/project/project_972d5901-d92c-4dfb-9e3d-547a3079f940` 결과 장표 캔버스.
- Viewport/state: 1194 × 882 CSS px, 12번 결과 장표, 실시간 투표 연결, 차트 레이아웃, 기록 미리보기 미선택 및 응답 없는 기록 상태.

## Fidelity checks

- 16:9 결과 장표를 왼쪽 제목·설명·진행 상태와 오른쪽 응답 수·질문·집계 카드의 2열 구조로 재구성했다.
- 선택지 결과는 가로 비율 막대와 백분율을 사용하고 최다 응답은 강조 테두리와 `가장 많음` 상태로 구분한다.
- 배경, surface, border, 강조색, 글자색은 덱 theme과 장표 style을 변환한 기존 특수 장표 CSS 변수만 사용한다.
- 사전 질문, 실시간 투표, 만족도 조사에 공통으로 적용되며 한눈에 보기, 차트, 확인한 주관식 답변의 세 레이아웃을 유지한다.
- 실행 전·집계 중·공개 전·연결 오류 상태도 동일한 2열 구조 안에서 잘림 없이 표시된다.

## Verification

- `pnpm --filter @orbit/web typecheck` passed.
- `pnpm --filter @orbit/web exec vitest run src/features/activity-slides/rendering/ActivityResultSlideRenderer.test.tsx` passed: 10 tests.
- `pnpm --filter @orbit/web build` passed with the existing chunk-size warning only.
- Docker web image rebuild and in-app browser check passed.
- 저장된 실시간 투표 기록은 현재 장표 revision과 일치하지 않아 실제 데이터 브라우저 캡처는 만들 수 없었고, 차트 데이터 구조와 보안 경계는 renderer test로 검증했다.

## Findings

No remaining P0, P1, or P2 visual issue in the requested result-slide renderer.

final result: passed

---

# 덱 테마 기반 특수 장표 design QA

- Reference: 사용자가 제공한 사전 질문, 실시간 투표, 만족도 조사 HTML 3종의 분할 레이아웃과 응답 카드 구조를 참고했다.
- Editor route: `http://localhost:5173/project/project_972d5901-d92c-4dfb-9e3d-547a3079f940`.
- Presenter route: `http://localhost:5173/rehearsal/project_972d5901-d92c-4dfb-9e3d-547a3079f940?presenterSessionId=design-qa&presenterWindow=1&slideIndex=8&stepIndex=0`.
- States: 사전 질문, 실시간 투표, 만족도 조사, 결과 장표 빈 상태, 발표자 현재/다음 장표 미리보기.

## Visual checks

- AI PPT 생성에서 선택한 덱 `theme`과 개별 장표 `style`을 특수 장표 CSS 변수로 변환해 배경, 강조색, 표면색, 글자색에 일관되게 반영했다.
- 에디터 캔버스, 썸네일, 발표자 화면, 슬라이드 쇼, 청중 화면, 결과 화면이 같은 색과 레이아웃 계층을 사용한다.
- 장식용 영문 문구인 `LIVE ACTIVITY`, `ACTIVITY RESULTS`, `AUDIENCE`, `PRESENTER`를 제거하고 ORBIT 브랜드와 실제 장표 제목·질문·응답 상태만 표시했다.
- 사전 질문, 투표, 만족도 조사 모두 왼쪽에 장표 목적을, 오른쪽에 실제 질문·응답 카드를 배치해 발표자 화면의 축소 미리보기에서도 구분된다.
- 결과 장표는 원본 참여 장표의 제목과 설명을 재사용하며, 응답이 없을 때는 데이터 없는 상태만 간결하게 표시한다.
- 에디터 장표 9~12와 실제 발표자 런타임의 현재/다음 장표에서 잘림, 겹침, 가로 오버플로가 없음을 확인했다.

## Verification

- `pnpm --filter @orbit/web typecheck` passed.
- `pnpm --filter @orbit/web build` passed with the existing chunk-size warning only.
- `pnpm --filter @orbit/web exec vitest run` targeted activity suites passed: 56 tests.
- `src/styles/design-system-boundary.test.ts` passed: 8 tests.
- In-app browser visual verification passed for editor and presenter runtime.

final result: passed

---

# 청중 참여 화면 홈 디자인 통일 QA

- Source visual truth: 현재 서비스 홈 화면 캡처 `/Users/choeyeongbin/.codex/visualizations/2026/07/18/019f748d-91ea-7c52-a134-3d278a1af020/audience-waiting-home-redesign/source-home.png`와 사용자 제공 대기 화면 `/Users/choeyeongbin/.codex/visualizations/2026/07/18/019f748d-91ea-7c52-a134-3d278a1af020/audience-waiting-home-redesign/before-audience-waiting.png`.
- Implementation captures: `/Users/choeyeongbin/.codex/visualizations/2026/07/18/019f748d-91ea-7c52-a134-3d278a1af020/audience-waiting-home-redesign/implementation-audience.png`, `/Users/choeyeongbin/.codex/visualizations/2026/07/18/019f748d-91ea-7c52-a134-3d278a1af020/audience-waiting-home-redesign/implementation-audience-chrome.png`.
- Combined comparison: `/Users/choeyeongbin/.codex/visualizations/2026/07/18/019f748d-91ea-7c52-a134-3d278a1af020/audience-waiting-home-redesign/comparison-audience-home.png`.
- Route: `/audience/:sessionId` 및 `/audience/:sessionId/a/:activityId`.
- State: 참여 코드 입력 전 상태와 실제 Chrome 세션의 사전 질문 제출 완료 상태. 대기 상태는 동일한 공통 status-card 컴포넌트 경로와 렌더링 테스트로 검증했다.

## Fidelity checks

- 홈과 동일한 `OrbitBrand`, `WorkspaceContainer`, 흰색 배경, 얇은 `outline-variant` 헤더 구분선, Pretendard 및 redesign 타이포그래피 토큰을 사용한다.
- 기존 보라색 배경 그라데이션과 과도하게 큰 중앙 카드를 제거하고 홈 화면과 같은 밀도의 흰색 surface, card shadow, primary blue 상태 아이콘으로 통일했다.
- 공개 참여 화면 특성상 인증 전용 상단 내비게이션과 사용자 아바타는 노출하지 않고 브랜드와 세션 제목만 유지했다.
- 데스크톱에서는 상태 카드를 560px 이내로 제한하고, 모바일 breakpoint에서는 헤더·본문 패딩과 제목 크기를 토큰 기준으로 축소한다.
- 질문 제출 완료 상태에서 참여 장표, 저장 상태, 제출 답변, 수정 CTA가 잘리지 않고 홈 화면과 동일한 색·테두리 계층으로 표시된다.

## Verification

- `AudienceSatisfactionPage` 렌더링 테스트에 공통 ORBIT 브랜드와 workspace shell 검증을 추가했다.
- Web Vitest 전체 249 files, 1,592 tests 통과.
- `pnpm --filter @orbit/web typecheck` 통과.
- `pnpm --filter @orbit/web build` 통과(기존 chunk-size warning만 존재).
- Docker web 이미지를 재빌드한 뒤 실제 Chrome 참여 세션을 새로고침하여 제출 완료 상태의 레이아웃과 콘텐츠 유지 확인.
- 홈 참조와 실제 참여 화면을 동일 비교 이미지에서 확인했으며 요청 영역에 남은 P0/P1/P2 시각 문제 없음.

final result: passed

---

# Rehearsal timer split-surface design QA

- Source visual truth: `C:/Users/Runner/Desktop/Frame 6.png` (lower warning-state reference).
- Implementation screenshot: `D:/Projects/Orbit/.tmp/design-qa/rehearsal-timer-split.png`.
- Combined full-view comparison: `D:/Projects/Orbit/.tmp/design-qa/rehearsal-timer-split-comparison.png`.
- Focused timer comparison: `D:/Projects/Orbit/.tmp/design-qa/rehearsal-timer-split-focused-comparison.png`.
- Route: `/rehearsal/project_6c000fc2-a814-4c85-a5ad-bc5931ec94a6`.
- Viewport: 1212 x 874 CSS px.
- State: running rehearsal, default timing state. The reference shows the warning timing state.

## Full-view comparison evidence

The existing rehearsal layout, slide area, side panel, and teleprompter remain unchanged. The timer card now matches the reference hierarchy: a blue stopwatch header is directly joined to a bright timing-threshold panel inside one clipped card.

## Focused region comparison evidence

The source and implementation timer cards were placed in one focused comparison. Both use a full-width blue header, a full-width bright timing panel, two compact timing rows, and the existing rounded outer card. The implementation uses the existing 16px horizontal spacing token and 12px vertical spacing token. A separate asset comparison was unnecessary because this scoped change contains no new imagery or icons.

## Required fidelity surfaces

- Fonts and typography: existing rehearsal type tokens and hierarchy are unchanged; small timing labels remain readable on the bright surface.
- Spacing and layout rhythm: header padding is 16px; timing-panel padding is 12px 16px with a 12px row gap, matching the surrounding rehearsal spacing system.
- Colors and visual tokens: header uses `--redesign-color-primary`, the lower panel uses `--redesign-color-surface-container-lowest`, default progress uses `--redesign-color-on-surface`, warning uses the requested `#f0be36`, and danger uses `--redesign-color-error`.
- Image quality and asset fidelity: no new raster or vector asset is required; the existing Lucide controls are preserved.
- Copy and content: stopwatch and timing labels are unchanged.

## Comparison history

1. P2 - The previous state treatment placed warning/error container fills behind each row, making the compact timer visually heavy. Removed per-row containers.
2. P2 - The stopwatch and timing thresholds previously shared one blue surface, reducing hierarchy and forcing all copy to white. Split the card into blue and bright surfaces while preserving one outer card.
3. Post-fix evidence - The focused comparison shows matching surface proportions, padding, row rhythm, and outer radius. No actionable P0/P1/P2 issue remains in the requested timer region.

## Findings

No remaining P0, P1, or P2 visual issue in the requested region. The live capture is in the default state; the warning and danger selectors were verified in the loaded stylesheet, while the existing timing-state logic remains unchanged.

## Follow-up polish

- P3: capture a natural warning transition during a timed rehearsal if a final state-by-state visual archive is needed.
final result: passed

---

# Style loading spinner design QA

- Source visual truth: `.tmp/design-qa/style-loading-final.png`의 기존 로딩 화면 레이아웃과 사용자 지정 스피너 요구.
- Implementation screenshot: `.tmp/design-qa/style-loading-spinner.png`.
- Route: `/createdeck?preview=style-loading`.
- Viewport/state: 1453×874 CSS px, Style & Color 시작 로딩 상태.

## Comparison evidence

- Full view: 단계 표시, 상태 문구 너비·위치, 화면 여백은 기존 로딩 레이아웃과 동일하게 유지했다.
- Focused region: 폐기된 블록 영역만 기존 AI PPT 로딩 화면에서 사용 중인 Tabler `IconLoader2` 기반 스피너로 교체했다.
- Typography, spacing, color tokens, copy는 기존 상태를 유지했다. 추가 이미지 자산은 없다.
- 300ms 간격의 computed transform 값이 달라 회전 동작을 확인했다.
- 브라우저 콘솔 warning/error 없음. P0/P1/P2 시각 차이 없음.

## Verification

- AI PPT UI Vitest 4개 통과.
- `tsc -p tsconfig.json --noEmit` 통과.

final result: passed

---

# Style loading block animation design QA

> 2026-07-19: 사용자 요청으로 블록 애니메이션 렌더링과 CSS를 삭제하지 않고 주석 처리했다. 상태 문구의 중앙 정렬만 유지한다.

- Source visual truth: `C:/Users/Runner/Desktop/Frame 3.png`.
- Implementation captures: `.tmp/design-qa/style-loading-a.png`, `.tmp/design-qa/style-loading-b.png`, `.tmp/design-qa/style-loading-final.png`.
- Route: `/createdeck?preview=style-loading`.
- Viewport: 1453×874 CSS px.

## Fidelity and motion checks

- `ai-ppt-status`는 960px 너비로 중앙 정렬하고 단계 표시와 로딩 모션 사이에 기준 이미지와 유사한 수직 여백을 확보했다.
- Tabler `IconSquareFilled`로 구성한 블록이 위에서 회전하며 낙하하고, 하단의 불규칙한 블록 더미 위로 쌓이는 동작을 확인했다.
- 700ms 간격의 두 캡처에서 낙하 블록 위치가 달라 실제 애니메이션 재생을 확인했다.
- `prefers-reduced-motion: reduce` 환경에서는 낙하 애니메이션을 정지하도록 처리했다.
- 브라우저 콘솔 warning/error 없음. P0/P1/P2 시각 차이 없음.

## Verification

- AI PPT UI Vitest 4개 통과.
- `tsc -p tsconfig.json --noEmit` 통과.
- `git diff --check` 통과(CRLF 변환 안내만 존재).

final result: discarded

---

# AI 컬러 팔레트 생성 흐름 design QA

- Source visual truth: `C:/Users/Runner/Desktop/Frame 1.png`, `C:/Users/Runner/Desktop/Frame 2.png`.
- Implementation captures: `.tmp/design-qa/ai-palette-initial.png`, `.tmp/design-qa/compare-ai-palette-open-normalized.png`, `.tmp/design-qa/compare-ai-palette-result-normalized.png`.
- Route: `/project/:projectId/style-color/:jobId`.
- Viewport: 1453×874 CSS px.

## Fidelity and interaction checks

- 초기 상태는 `workspace-home-create` 스타일의 `AI로 컬러 팔레트 만들기` 타일만 표시한다.
- 타일을 누르면 오른쪽 두 열에 프롬프트 패널이 열리고, 생성 후 선택 가능한 팔레트·LLM 설명·재생성 입력창으로 전환한다.
- 기존 AI 팔레트 API와 선택 동작을 재사용하며 생성 및 재생성 결과가 즉시 선택 상태로 반영된다.
- 콘솔 warning/error 없음. P0/P1/P2 시각 차이 없음.

## Verification

- UI 및 design-system boundary Vitest 11개 통과.
- `tsc -p tsconfig.json --noEmit` 통과.
- 실제 브라우저에서 초기 → 열기 → 생성 → 프롬프트 변경 → 재생성 흐름 통과.

final result: passed

---

# Project 02 — Style & Color design QA

- Source visual truth: `/var/folders/bz/br99y0bj2395vd1507vwbqmm0000gn/T/codex-clipboard-103a0d56-0330-426e-98a7-81f9a705b4ff.png`.
- Implementation capture: `/private/tmp/orbit-style-color-latest.png`.
- Route: `/project/:projectId/style-color/:jobId`.
- Viewport: in-app browser default desktop viewport plus 390px responsive check.

## Fidelity and interaction checks

- Palette cards follow the reference's large color-led thumbnail, category badge, hex/RGB metadata, swatches, token role, and version rhythm.
- The nine fixed palette presets render varied presentation structures: cover, metrics, timeline, quote, comparison, roadmap, chart, agenda, and matrix.
- Font choices render actual `Aa`, Korean, Latin, and number samples with the selected font family instead of name-only selection.
- Selecting a palette updates the live slide title, layout, colors, and AI image; the selected state is exposed with `aria-pressed`.
- Korean presentation copy replaces the earlier English placeholder content across the fixed mockup data.
- AI-generated raster assets are present in the project and rendered in the strategy and roadmap slide previews.
- Mobile check: `scrollWidth` equals `clientWidth` at 390px; no horizontal overflow was observed.

## Verification

- `pnpm --filter @orbit/web typecheck` passed.
- `pnpm --filter @orbit/web exec vitest run src/features/ai-ppt/AiPptMockupPage.ui.test.ts src/features/ai-ppt/AiPptMockupPage.test.ts` passed: 14 tests.

final result: passed

---

# 총 리허설 리포트 design QA

- Source visual truth: `C:\Users\home\.codex\generated_images\019f7622-57ed-7922-986f-c35f80971944\exec-e600489b-0396-4c86-8752-3b713953d6e9.png`.
- Implementation screenshots: `C:\Users\home\.codex\visualizations\2026\07\18\019f7622-57ed-7922-986f-c35f80971944\project-summary-final-v2.png`, `C:\Users\home\.codex\visualizations\2026\07\18\019f7622-57ed-7922-986f-c35f80971944\project-summary-final-v2-lower.png`.
- Responsive screenshot: `C:\Users\home\.codex\visualizations\2026\07\18\019f7622-57ed-7922-986f-c35f80971944\project-summary-mobile-table-v2.png`.
- Viewports: desktop 870 × 1808, focused region 870 × 900, mobile 390 × 844.
- State: 23회차 완료, 8개 슬라이드, 최신 회차와 직전 회차 비교 데이터가 있는 프로젝트.

## Comparison history

1. P1 — 721~980px 구간의 내비게이션과 사이드 레일이 세로로 쌓이고 KPI가 분리 카드 2열로 노출됐다. 프로젝트 리포트 전용 반응형 경계와 단일 4열 KPI 카드로 수정했다.
2. P1/P2 — 회차별 변화가 전체 폭 차트와 3열 미니 차트로 배치되고 슬라이드 표의 열 밀도와 썸네일 비율이 시안과 달랐다. 큰 총 소요시간 차트와 우측 3단 미니 차트, 7열 썸네일 표로 수정했다.
3. P2 — 모바일 표가 패널 전체 폭을 밀어냈다. 대시보드와 카드의 최소 폭을 해제하고 표 래퍼만 가로 스크롤되도록 수정했다.
4. 수정 후 참조 시안과 구현 화면을 동일 입력에서 재비교했으며 데스크톱과 모바일 모두 P0/P1/P2 시각 문제는 남지 않았다.

## Verification

- 헤더, 고정 회차 레일, 프로젝트 히어로, 4개 KPI, 8개 썸네일 행의 순서와 시각 계층을 참조 시안과 대조했다.
- 총 소요시간 목표 밴드와 기준선, 최댓값과 최신값 라벨, 긴 침묵·핵심 메시지·시간 초과 추이를 대조했다.
- 최신 리포트, 개선 필요 슬라이드 행, `상세 리포트에서 보기`가 모두 최신 회차 상세 리포트와 해당 슬라이드 앵커를 가리키는 것을 확인했다.
- 본문 폭 375px에서 가로 오버플로가 없고 슬라이드 표 래퍼만 309px 안에서 633px 콘텐츠를 가로 스크롤한다.
- 새로고침 시점을 기준으로 새로 발생한 console error/warn 없음.
- 비로그인 QA 상태는 아바타 대신 기존 `로그인` 버튼을 사용하며 다음 행동 카드는 실제 상세 리포트 이동 CTA를 유지한다.

final result: passed

---

# 만족도 장표 5점 척도 밀도 design QA

- Source visual truth: `/var/folders/bz/br99y0bj2395vd1507vwbqmm0000gn/T/codex-clipboard-f1f9dfc7-77e3-4ee1-9ca3-7e20094960c8.png`.
- Implementation screenshot: `/private/tmp/orbit-satisfaction-rating-after.png`.
- Focused implementation screenshot: `/private/tmp/orbit-satisfaction-rating-after-crop.png`.
- Combined comparison: `/private/tmp/orbit-satisfaction-rating-comparison.png`.
- Viewport: 1264 × 720 editor viewport, satisfaction slide selected.
- State: 만족도 조사 장표의 두 번째 문항, 응답 전 5점 척도 미리보기.

## Findings and comparison history

1. P1 — `repeat(5, 1fr)`와 `aspect-ratio: 1`이 결합되어 점수 선택지가 카드의 가용 폭만큼 커지는 문제가 있었다.
2. 각 선택지 크기에 반응형 상한을 두고 원형을 라운드 스퀘어로 바꿔 질문보다 선택지가 더 강하게 보이지 않도록 수정했다.
3. `전혀 아니요`와 `매우 그래요`를 양 끝에 표시해 1과 5의 의미를 장표만 보고도 이해할 수 있게 했다.
4. 수정 전·후를 한 화면에서 비교한 결과, 카드 여백과 질문 계층이 복원되고 점수 선택지가 잘리거나 겹치지 않았다.

## Required fidelity surfaces

- Typography: 질문을 최상위로 유지하고 점수와 양 끝 라벨은 보조 크기로 낮췄다.
- Spacing: 점수 사이 간격을 균등하게 유지하되 버튼 폭은 카드 폭을 강제로 채우지 않는다.
- Colors: 덱 테마에서 계산한 surface, muted, border 토큰을 그대로 사용한다.
- Image quality: 별도 이미지 자산이 없는 네이티브 폼 컨트롤이므로 래스터 교체 대상이 없다.
- Copy: 사용자 정의 질문은 유지하고, 기존 rating schema의 좌우 라벨만 추가했다.

## Verification

- `pnpm --filter @orbit/web exec vitest run src/features/activity-slides/editor/activityEditor.test.tsx` passed: 18 tests.
- `pnpm --filter @orbit/web typecheck` passed.
- Docker web rebuild and in-app browser visual comparison passed.

final result: passed

---

# 발표 개선 요약 시각화 design QA

- Source visual truth: `codex-clipboard-2efec99c-2335-49a9-93ab-31cbeb1173dd.png`와 생성된 `발표 변화` 지표 시안.
- Implementation surface: `RehearsalProjectOverviewPage`, `RehearsalProjectSummaryDashboard`.
- QA state: 실제 컴포넌트와 6회차 고정 fixture를 사용한 임시 Vite 진입점이며 캡처 후 제거했다.

## Comparison history

1. 데스크톱 1440×900에서 시안과 구현 KPI를 같은 입력으로 비교했다. 4개 지표의 이전→현재 아이콘 흐름, 큰 수치, 개선 문구 계층이 일치했다.
2. 우선 행동 배너 참조 이미지와 구현을 같은 입력으로 비교했다. 배너가 개선 요약 바로 위에 배치되고 상세 리포트 CTA를 유지했다.
3. 태블릿 820×1000에서 KPI가 2열로, 모바일 390×844에서 1열로 전환됨을 확인했다.
4. 태블릿과 모바일 모두 document `scrollWidth`와 `clientWidth`가 같아 가로 오버플로가 없었다.

## Accessibility and behavior

- 각 KPI는 단위, 비교 기준, 개선량을 포함한 전체 `aria-label`을 유지한다.
- 우선 행동 배너는 `다음 연습 우선 행동` 레이블을 제공한다.
- 렌더링 테스트로 우선 행동 배너가 KPI 요약보다 DOM에서 먼저 오는지 검증한다.
- 누적 지표가 모두 미측정이고 비교 이슈가 없는 슬라이드는 `측정 불가`로 표시한다.

final result: passed

---

# 리허설 회차별 총 소요시간 차트 design QA

- Route: `http://localhost:5174/reports/project_66b1fbe6-5543-441a-9b39-cecd9ef51e41`.
- Source visual truth: 사용자가 제공한 기존 차트 화면.
- QA state: 로그인된 로컬 5174 화면의 실제 렌더링.

## Findings

- 주요 회차 라벨을 14px 굵은 글씨로 표시해 가독성을 높였다.
- 마지막 회차와 가까운 중간 눈금을 생략해 `21회차`와 `23회차`가 붙지 않는다.
- 목표 라벨을 차트 왼쪽으로 옮겨 최신 값 `8:42`와 분리했다.
- 총 리허설 리포트의 8개 슬라이드가 실제 Deck 화면으로 렌더링된다.
- 관련 Vitest 10개와 Web TypeScript 검사를 통과했다.
final result: passed

## 리허설 완료 모달 (2026-07-20)

### 검증 대상

- 참조 시안: `C:\Users\Runner\.codex\generated_images\019f7960-a82c-7e11-b04e-91cc188840ca\exec-a8b3ec39-125e-4ed9-93ed-5055fd34e777.png`
- 구현 화면: `C:\Users\Runner\.codex\visualizations\2026\07\19\019f7960-a82c-7e11-b04e-91cc188840ca\rehearsal-completion-implemented.png`
- 비교 화면: `C:\Users\Runner\.codex\visualizations\2026\07\19\019f7960-a82c-7e11-b04e-91cc188840ca\rehearsal-completion-comparison.png`
- 검증 URL: `http://localhost:5173/rehearsal/project_6c000fc2-a814-4c85-a5ad-bc5931ec94a6?snapshotPreparationId=ac5f3857-a3f1-4a02-b115-08f1c497da5f&preflight=complete`
- 검증 뷰포트: 1144 × 873

### 시각 검증

- [x] 리허설 화면 위에 scrim과 중앙 모달이 표시된다.
- [x] 완료 체크, 제목, 보조 문구의 위계와 중앙 정렬이 시안과 일치한다.
- [x] 발표 시간, 대본 커버리지, 놓친 키워드 요약은 노출하지 않는다.
- [x] 리포트 준비 중 상태와 준비 완료 상태의 문구 및 아이콘을 구분한다.
- [x] 준비 전에는 `리포트 보기`가 비활성화되고 준비 완료 후 활성화된다.
- [x] `리포트 보기`와 `다시 연습하기` 버튼은 동일한 너비와 높이를 사용한다.
- [x] `프로젝트 편집기로 | 홈으로` 이동 링크가 버튼 아래에 유지된다.
- [x] 모달 닫기 버튼과 작은 화면용 내부 스크롤을 제공한다.
- [x] 색상, 간격, radius, 그림자는 `--redesign-*` 토큰을 사용한다.

### 조정 내역

- 실제 브라우저 비교 후 완료 아이콘의 이중 테두리를 제거해 시안과 같은 단일 체크 원으로 정리했다.
- 리포트 상태 영역의 과한 카드 배경을 제거하고 구분선 기반의 평평한 구조로 조정했다.
- 배경 scrim을 디자인 토큰 원색으로 적용해 기존 리허설 화면과 모달의 깊이 차이를 명확히 했다.

### 결과

`passed`

---

# 홈 프로젝트 목록 로딩 실패 상태 design QA

- Source visual truth: `/Users/choeyeongbin/Desktop/스크린샷 2026-07-20 오전 4.47.46.png`.
- Implementation screenshot: `/private/tmp/orbit-home-error-after.png`.
- Verification route: `http://localhost:5174/?qa=project-error`.
- Verification viewport: 1280 × 720.
- QA state: 인증 요청은 실제 로컬 API로 전달하고 프로젝트 목록 요청만 503으로 응답하는 임시 로컬 프록시를 사용했다.

## Findings and fixes

1. 기존 실패 제목과 버튼이 최근 작업 영역의 카드보다 지나치게 커서 페이지의 정보 위계를 압도했다.
2. 공통 실패 컴포넌트는 유지하고 홈 화면에만 토큰 기반 축약 스타일을 적용해 다른 화면의 전면 오류 상태에 영향을 주지 않았다.
3. 실패 상태의 높이, radius, border, surface, shadow를 프로젝트 카드 문법과 맞췄다.
4. 제목과 본문을 `title-lg`, `body-sm` 계층으로 낮추고 원인, 권장 행동, 재시도 순서를 유지했다.
5. 재시도 문구를 `목록 다시 불러오기`로 구체화해 버튼의 결과를 바로 이해할 수 있게 했다.

## Verification

- 원본과 구현 결과를 한 번에 비교해 최근 작업 그리드의 위계와 정렬이 개선된 것을 확인했다.
- 실패 상태 섹션이 1개 렌더링되고 제목, 원인, 권장 행동, 재시도 문구가 모두 표시되는 것을 확인했다.
- 브라우저 error/warning 로그가 비어 있음을 확인했다.
- Web 테스트 266개 파일, 1660개 테스트가 통과했다.
- Web TypeScript 검사가 통과했다.

final result: passed

---

# 홈 단일 페이지 리디자인 design QA (2026-07-21)

- Source visual truth: `/Users/choeyeongbin/Downloads/생성된 이미지 1 (7).png`.
- Verification route: `http://localhost:5173/`.
- QA state: 로그인된 Chrome 탭의 실제 렌더링과 DOM 치수, 인터랙션을 확인했다.

## Visual and responsive checks

1. 헤더, 다크 커뮤니티, 흰색 프로젝트 영역의 수직 구조와 대비를 참조 시안에 맞췄다.
2. 커뮤니티는 태그 없이 대표 카드 1개와 보조 카드 4개로 구성했다.
3. 프로젝트 툴바는 생성 액션, 검색, 정렬, 태그 필터를 유지하며 1280px 아래에서 두 줄로 전환된다.
4. 프로젝트 카드는 넓은 데스크톱에서 4열, 1130px 검증 화면에서 3열로 전환되고 가로 오버플로가 없다.
5. 각 썸네일에 핀, 리허설, 리포트, 삭제 버튼 4개가 노출된다.
6. AI 생성 작업은 썸네일 위 진행 상태, 퍼센트, 진행 바로 표시된다.

## Interaction and build checks

- 태그 필터 팝오버와 새 태그 모달이 뷰포트 안에서 열리는 것을 확인했다.
- 검증한 프로젝트 카드마다 썸네일 액션 버튼이 정확히 4개 존재한다.
- `pnpm --filter @orbit/shared build`가 통과했다.
- `pnpm --filter @orbit/web build`가 기존 chunk-size 경고만 남기고 통과했다.
- Chrome 확장 캡처는 CDP 5초 제한으로 실패해 마지막 인증 캡처와 이후 실제 DOM 실측을 함께 판정 근거로 사용했다.

final result: passed
