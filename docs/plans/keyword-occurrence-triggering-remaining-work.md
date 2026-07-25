# Keyword Occurrence Triggering: Remaining Implementation Plan

## Status

Draft for implementation.

## Purpose

반복되는 같은 키워드 중 사용자가 클릭한 발표 메모 위치에서만 애니메이션 또는 다음 슬라이드 action이 실행되도록, 현재 코드에 이미 들어간 occurrence 기반 계약 위에 남은 gap만 정리한다.

기존 전체 설계 문서는 `docs/specs/keyword-occurrence-triggering.md`에 있다. 이 문서는 그중 이미 구현된 shared schema, 기본 occurrence trigger, 기본 에디터 선택 강조, 기본 playback resolver를 반복하지 않고, 실제로 추가 구현이 필요한 항목만 다룬다.

## Current Baseline

현재 작업트리 기준으로 다음 기반은 이미 있다.

- `packages/shared/src/deck/id.schema.ts`에 `deckKeywordOccurrenceIdSchema`가 있다.
- `packages/shared/src/deck/slide-action.schema.ts`에 별도 trigger kind인 `keyword-occurrence`가 있다.
- `packages/shared/src/deck/deck.schema.ts`는 `speakerNotes + keywords`에서 occurrence를 재계산해 `keyword-occurrence` action을 검증한다.
- `packages/editor-core/src/keywords/keywordOccurrences.ts`는 occurrence id, 위치, context를 파생한다.
- `apps/web/src/features/editor/shell/components/KeywordInspector.tsx`는 selected class를 occurrence id 기준으로 적용한다.
- 애니메이션 생성 patch는 occurrence id를 받으면 `kind: "keyword-occurrence"` action을 만든다.
- `packages/editor-core/src/playback/slidePlayback.ts`와 `apps/web/src/features/rehearsal/playback/triggeredActionPlayback.ts`는 occurrence action을 정확한 `keywordId + occurrenceId`로 resolve할 수 있다.
- `apps/web/src/features/rehearsal/speech/keywordOccurrenceRuntime.ts`에는 script progress window 기반의 기본 occurrence matcher가 있다.

따라서 남은 구현은 새 모델을 처음부터 추가하는 작업이 아니라, 아직 keyword-wide로 남아 있는 경로와 불일치한 occurrence 파생 로직을 정리하는 작업이다.

## Important Design Decision

현재 코드베이스의 계약을 유지한다.

```ts
type KeywordTrigger = {
  kind: "keyword";
  keywordId: string;
};

type KeywordOccurrenceTrigger = {
  kind: "keyword-occurrence";
  keywordId: string;
  occurrenceId: string;
};
```

사용자 제안처럼 `kind: "keyword"`에 `occurrenceId?: string`을 붙이지 않는다. 이미 shared schema와 playback이 separate trigger kind를 사용하고 있고, 이 편이 legacy keyword-wide trigger와 occurrence trigger를 명확히 분리한다.

또한 `slide.keywordOccurrences`를 Deck JSON에 저장하지 않는다. 현재 계약은 occurrence를 `speakerNotes + keywords`에서 파생하고, `occurrenceId`는 opaque string으로 취급한다. 이 방향을 유지하면 speaker notes 원문 위치 정보가 중복 저장되지 않고, presenter/audience snapshot에 occurrence context를 실수로 노출할 위험도 줄어든다.

## Task 1. Occurrence Derivation Source Of Truth 정리

### Problem

현재 occurrence id 파생 로직이 두 곳에 나뉘어 있다.

- `packages/editor-core/src/keywords/keywordOccurrences.ts`: 대소문자 무시 매칭, overlap 처리, context 포함
- `packages/shared/src/deck/deck.schema.ts`: private `deriveSlideKeywordOccurrences`, `speakerNotes.indexOf(term)` 기반

에디터는 `AI` keyword로 소문자 `ai` 토큰을 선택할 수 있지만, shared schema가 대소문자 구분으로 occurrence를 검증하면 저장 시 `keyword-occurrence` action이 reject될 수 있다. UI에서 만든 occurrence id와 API가 검증하는 occurrence id는 반드시 같은 helper에서 나와야 한다.

### Implementation

1. shared package에 occurrence helper를 추가한다.

   File: `packages/shared/src/deck/keyword-occurrences.ts`

   ```ts
   export type DeckKeywordOccurrence = {
     occurrenceId: string;
     slideId: string;
     keywordId: string;
     text: string;
     start: number;
     end: number;
     occurrenceIndex: number;
     contextBefore: string;
     contextAfter: string;
   };

   export function createKeywordOccurrenceId(
     slideId: string,
     keywordId: string,
     start: number,
     end: number
   ): string {
     return `kwo_${slideId}_${keywordId}_${start}_${end}`;
   }

   export function deriveKeywordOccurrences(slide: {
     slideId: string;
     speakerNotes: string;
     keywords: Array<{
       keywordId: string;
       text: string;
       synonyms: string[];
       abbreviations: string[];
     }>;
   }): DeckKeywordOccurrence[] {
     // Move current editor-core implementation here.
   }
   ```

2. `packages/shared/src/index.ts`에서 export한다.

   ```ts
   export * from "./deck/keyword-occurrences";
   ```

3. `packages/shared/src/deck/deck.schema.ts`의 private occurrence derivation을 제거하고 shared helper를 사용한다.

   ```ts
   const keywordOccurrences = new Map(
     deriveKeywordOccurrences(slide).map((occurrence) => [
       occurrence.occurrenceId,
       occurrence
     ])
   );
   ```

4. `packages/editor-core/src/keywords/keywordOccurrences.ts`는 shared helper를 re-export하거나 삭제하고 import 경로를 shared로 바꾼다.

   ```ts
   export {
     createKeywordOccurrenceId,
     deriveKeywordOccurrences
   } from "@orbit/shared";
   export type { DeckKeywordOccurrence as KeywordOccurrence } from "@orbit/shared";
   ```

5. `apps/web/src/features/editor/shell/components/KeywordInspector.tsx`의 local `createKeywordOccurrenceKey`는 shared `createKeywordOccurrenceId`로 대체한다.

### Acceptance Criteria

- `AI` keyword가 있고 발표 메모에 `ai`가 있어도 에디터가 만든 occurrence action을 shared `deckSchema`가 accept한다.
- synonym 또는 abbreviation을 클릭해 만든 occurrence도 같은 `keywordId`에 속한 occurrence로 검증된다.
- overlap 우선순위는 shared schema, editor-core, editor UI에서 동일하다.
- occurrence id parsing에 의존하는 로직이 없다.

### Tests

- `packages/shared/src/deck/deck.schema.test.ts`
  - 대소문자가 다른 occurrence id를 포함한 `keyword-occurrence` action이 valid
  - synonym/abbreviation occurrence action이 valid
  - 다른 keyword의 occurrence id를 섞으면 invalid
- `packages/editor-core/src/keywords/keywordOccurrences.test.ts`
  - 기존 테스트가 shared helper re-export 후에도 통과
- `apps/web/src/features/editor/shell/components/KeywordInspector.test.tsx`
  - rendered `data-occurrence-id`가 shared helper 결과와 일치

## Task 2. Next-slide Action을 Occurrence-aware로 변경

### Problem

애니메이션 생성은 occurrence id를 저장할 수 있지만, 발표 메모의 키워드 상세 패널에서 켜는 “다음 슬라이드” action은 아직 `keywordId`만 받는다.

현재 흐름:

```ts
createUpsertAdvanceSlideKeywordActionPatch(deck, slideId, keywordId, enabled)
```

이 상태에서는 사용자가 마지막 `AI` 위치를 선택하고 “다음 슬라이드”를 켜도, action은 legacy keyword-wide trigger로 저장될 수 있다.

### Implementation

1. `packages/editor-core/src/patches/actionOperations.ts`의 signature를 확장한다.

   ```ts
   export function createUpsertAdvanceSlideKeywordActionPatch(
     deck: Deck,
     slideId: string,
     keywordId: string,
     enabled: boolean,
     occurrenceId?: string | null
   ): DeckPatch | null
   ```

2. matching action 조건을 trigger 단위로 분리한다.

   ```ts
   function isSameKeywordTrigger(
     action: DeckSlideAction,
     keywordId: string,
     occurrenceId?: string | null
   ) {
     if (occurrenceId) {
       return (
         action.trigger.kind === "keyword-occurrence" &&
         action.trigger.keywordId === keywordId &&
         action.trigger.occurrenceId === occurrenceId
       );
     }

     return (
       action.trigger.kind === "keyword" &&
       action.trigger.keywordId === keywordId
     );
   }
   ```

3. add/update 시 기존 `createKeywordActionTrigger(keywordId, occurrenceId)`를 재사용한다.

4. `apps/web/src/features/editor/shell/EditorShell.tsx`에서 selected occurrence를 넘긴다.

   ```ts
   createUpsertAdvanceSlideKeywordActionPatch(
     workingDeckRef.current,
     slideId,
     keywordId,
     enabled,
     selectedKeywordOccurrenceKey
   );
   ```

5. keyword chip만 선택한 상태에서 “다음 슬라이드”를 켜려 하면 저장하지 않고 위치 선택 안내를 보여준다. 애니메이션 패널의 restriction message와 같은 정책을 재사용한다.

### Acceptance Criteria

- 발표 메모의 두 번째 `AI`를 선택하고 “다음 슬라이드”를 켜면 action trigger가 `kind: "keyword-occurrence"`로 저장된다.
- 같은 `keywordId`의 다른 occurrence에 이미 next-slide action이 있어도 별개의 action으로 취급된다.
- occurrence-selected next-slide action을 끄면 그 occurrence action만 삭제된다.
- legacy keyword chip 기반 next-slide action은 명시적으로 허용한 경로에서만 `kind: "keyword"`로 유지된다.

### Tests

- `packages/editor-core/src/patches/actionOperations.test.ts`
  - occurrence id가 있으면 next-slide action이 `keyword-occurrence`로 생성된다.
  - 같은 keyword의 다른 occurrence action은 삭제되지 않는다.
  - occurrence id 없이 호출하면 기존 legacy keyword-wide 동작이 유지된다.
- `apps/web/src/features/editor/shell/EditorShell.test.tsx`
  - 발표 메모 occurrence 선택 후 next-slide 토글이 occurrence id를 포함한 patch를 만든다.

## Task 3. Keyword Usage를 Keyword-wide와 Occurrence-specific으로 분리

### Problem

`deriveKeywordUsage(slide)`는 현재 keywordId별 usage만 반환한다.

```ts
type DerivedKeywordUsage = {
  advancesSlide: boolean;
  animationIds: string[];
  keywordId: string;
};
```

이 구조로는 keyword chip에 “이 키워드 전체에 action이 있음”을 보여줄 수는 있지만, 사용자가 선택한 특정 위치에 연결된 action인지 구분할 수 없다.

### Implementation

1. `packages/editor-core/src/patches/actionOperations.ts`에 새 usage shape을 추가한다.

   ```ts
   export type DerivedKeywordUsage = {
     byKeywordId: Record<string, {
       keywordId: string;
       animationIds: string[];
       advancesSlide: boolean;
     }>;
     byOccurrenceId: Record<string, {
       keywordId: string;
       occurrenceId: string;
       animationIds: string[];
       advancesSlide: boolean;
     }>;
   };
   ```

2. 기존 호출부 영향이 크면 단계적으로 진행한다.

   - 기존 `deriveKeywordUsage(slide)`는 backward-compatible하게 keyword-wide record를 유지한다.
   - 새 `deriveKeywordActionUsage(slide)`를 추가해 `byKeywordId`, `byOccurrenceId`를 반환한다.
   - UI 전환 후 기존 helper를 deprecated한다.

3. `KeywordDetail`은 selected occurrence가 있을 때 occurrence-specific usage를 우선 표시한다.

   ```ts
   const selectedOccurrenceUsage =
     selectedKeywordOccurrenceKey
       ? keywordActionUsage.byOccurrenceId[selectedKeywordOccurrenceKey]
       : null;
   ```

4. keyword chip은 keyword-wide aggregate를 보여주되, occurrence-selected detail card는 선택 위치의 action만 제어한다.

### Acceptance Criteria

- 같은 `AI` keyword의 첫 번째 occurrence에 animation, 두 번째 occurrence에 next-slide가 있어도 detail card는 선택한 occurrence의 usage만 보여준다.
- keyword chip의 aggregate badge는 전체 keyword action 수를 유지한다.
- keyword 삭제 확인은 keyword-wide aggregate를 기준으로 유지한다.

### Tests

- `packages/editor-core/src/patches/actionOperations.test.ts`
  - `byKeywordId`가 legacy + occurrence action을 aggregate한다.
  - `byOccurrenceId`가 occurrence action만 분리한다.
  - legacy keyword action은 `byOccurrenceId`에 들어가지 않는다.
- `apps/web/src/features/editor/shell/components/KeywordInspector.test.tsx`
  - 선택 occurrence에만 next-slide badge가 표시되는 component-level 테스트를 추가한다.

## Task 4. Speaker Notes 변경 시 Dangling Occurrence Guard 추가

### Problem

현재 occurrence id는 `speakerNotes`의 UTF-16 `start/end`를 포함한다. 발표 메모를 수정하면 기존 occurrence id가 사라질 수 있다.

shared schema는 이런 deck을 invalid로 처리하지만, 에디터가 아무 안내 없이 `update_speaker_notes` patch를 보내면 저장 실패 또는 나중의 발표 시작 실패로 보일 수 있다.

### Implementation

1. `packages/editor-core`에 diagnostics helper를 추가한다.

   ```ts
   export type DanglingKeywordOccurrenceAction = {
     slideId: string;
     actionId: string;
     keywordId: string;
     occurrenceId: string;
     effectKind: DeckSlideAction["effect"]["kind"];
   };

   export function findDanglingKeywordOccurrenceActions(
     slide: Slide,
     nextSpeakerNotes: string
   ): DanglingKeywordOccurrenceAction[] {
     const nextOccurrences = new Set(
       deriveKeywordOccurrences({
         slideId: slide.slideId,
         speakerNotes: nextSpeakerNotes,
         keywords: slide.keywords
       }).map((occurrence) => occurrence.occurrenceId)
     );

     return slide.actions.flatMap((action) => {
       if (action.trigger.kind !== "keyword-occurrence") return [];
       return nextOccurrences.has(action.trigger.occurrenceId)
         ? []
         : [{
             slideId: slide.slideId,
             actionId: action.actionId,
             keywordId: action.trigger.keywordId,
             occurrenceId: action.trigger.occurrenceId,
             effectKind: action.effect.kind
           }];
     });
   }
   ```

2. `EditorShell.commitSpeakerNotesDraftIfDirty()`에서 patch 생성 전에 diagnostics를 실행한다.

3. MVP 정책은 자동 재연결을 하지 않는다.

   - dangling action이 있으면 저장을 막고 안내한다.
   - 사용자가 action을 삭제하거나 새 occurrence에 다시 연결한 뒤 저장하게 한다.

4. 안내 문구:

   ```text
   발표 메모 수정으로 기존 키워드 트리거 위치를 찾을 수 없습니다. 연결된 애니메이션 또는 다음 슬라이드 트리거를 새 위치에 다시 연결한 뒤 저장하세요.
   ```

### Acceptance Criteria

- occurrence action이 있는 단어 앞에 텍스트를 삽입해 start/end가 바뀌면 저장 전에 guard가 동작한다.
- occurrence action이 없는 slide의 speaker notes 수정은 기존처럼 저장된다.
- legacy `kind: "keyword"` action은 dangling 검사 대상이 아니다.

### Tests

- `packages/editor-core/src/keywords/keywordOccurrenceDiagnostics.test.ts`
  - speaker notes 변경으로 사라진 occurrence action을 반환한다.
  - 그대로 남은 occurrence action은 반환하지 않는다.
- `apps/web/src/features/editor/shell/EditorShell.test.tsx`
  - dangling occurrence가 있으면 `update_speaker_notes` patch가 commit되지 않는다.

## Task 5. Live STT Event Contract에 Occurrence ID 반영

### Problem

리허설 runtime은 occurrence matcher를 이미 호출하지만, shared live STT event schema는 아직 `keywordId`만 가진다.

현재 occurrence match 처리도 cue text에 occurrence id를 넣는다.

```ts
setLiveCue({
  type: "animation-cue",
  slideId: slide.slideId,
  keywordId: occurrenceMatch.keywordId,
  cue: "emphasis",
  text: occurrenceMatch.occurrenceId
});
```

이러면 runtime 내부 상태와 event contract가 어긋나고, UI나 테스트가 occurrence 감지 여부를 타입으로 검증하기 어렵다.

### Implementation

1. `packages/shared/src/rehearsals/live-stt.schema.ts`에 optional occurrence id를 추가한다.

   ```ts
   export const liveSttKeywordDetectedEventSchema = z.object({
     type: z.literal("keyword-detected"),
     slideId: z.string().min(1),
     keywordId: z.string().min(1),
     occurrenceId: z.string().min(1).optional(),
     text: z.string().min(1),
     matchedText: z.string().min(1),
     coverage: keywordCoverageSchema
   });

   export const liveSttAnimationCueEventSchema = z.object({
     type: z.literal("animation-cue"),
     slideId: z.string().min(1),
     keywordId: z.string().min(1),
     occurrenceId: z.string().min(1).optional(),
     cue: z.literal("emphasis"),
     text: z.string().min(1)
   });
   ```

2. `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`에서 occurrence cue에 `occurrenceId`를 명시한다.

   ```ts
   setLiveCue({
     type: "animation-cue",
     slideId: slide.slideId,
     keywordId: occurrenceMatch.keywordId,
     occurrenceId: occurrenceMatch.occurrenceId,
     cue: "emphasis",
     text: occurrenceMatch.text
   });
   ```

3. `KeywordOccurrenceRuntimeMatch`에 UI 표시용 `text`를 추가한다.

   ```ts
   export type KeywordOccurrenceRuntimeMatch = {
     keywordId: string;
     occurrenceId: string;
     text: string;
     currentCharOffset: number;
   };
   ```

4. 기존 keyword-wide detection event는 legacy keyword coverage 용도로 유지한다. occurrence action 실행은 `matchKeywordOccurrenceTriggers` 결과만 사용한다.

### Acceptance Criteria

- occurrence action이 실행될 때 runtime cue event에 `occurrenceId`가 들어간다.
- UI가 occurrence id 문자열을 그대로 사용자에게 보여주지 않는다.
- legacy keyword detection event는 기존 adapter/tests와 호환된다.

### Tests

- `packages/shared/src/rehearsals/live-stt.schema.test.ts`
  - optional occurrence id가 있는 keyword/cue event가 parse된다.
  - occurrence id 없이도 legacy event가 parse된다.
- `apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx`
  - occurrence trigger 실행 시 live cue에 occurrence id가 포함된다.

## Task 6. Legacy Keyword Trigger 처리 정책 확정 및 Repair Flow 추가

### Problem

새로 만드는 action은 occurrence trigger를 사용할 수 있지만, 기존 deck에는 `kind: "keyword"` action이 남아 있을 수 있다. 이 action은 의도적으로 keyword-wide trigger로 유지할 수도 있고, 기존 데이터를 새 occurrence trigger로 변환해야 할 수도 있다.

자동 DB migration은 잘못된 위치에 action을 연결할 수 있으므로 바로 수행하지 않는다.

### Implementation

1. editor-only repair helper를 추가한다.

   ```ts
   export type LegacyKeywordTriggerRepairSuggestion = {
     actionId: string;
     keywordId: string;
     suggestedOccurrenceId: string | null;
     confidence: "high" | "medium" | "low" | "none";
     reason: string;
   };
   ```

2. deterministic heuristic:

   - occurrence가 0개면 `confidence: "none"`
   - occurrence가 1개면 `high`
   - 같은 keyword의 legacy action 수와 occurrence 수가 같으면 action order와 occurrence order를 순서대로 매핑하고 `medium`
   - legacy action이 1개이고 occurrence가 여러 개면 마지막 occurrence를 제안하고 `low`

3. low confidence는 자동 저장하지 않는다. 사용자가 발표 메모 위치를 클릭해 재연결해야 한다.

4. `getAnimationTriggerAction()`은 기존처럼 legacy action도 읽되, 편집 UI에서는 legacy keyword-wide임을 표시한다.

5. 필요하면 별도 task로 deck load 시 repair banner를 띄운다.

### Acceptance Criteria

- legacy keyword action이 있는 기존 deck은 계속 열린다.
- 반복 keyword가 있는 legacy action은 editor에서 keyword-wide trigger로 표시된다.
- 사용자가 명시적으로 occurrence를 선택해 저장하면 `keyword-occurrence`로 update patch가 생성된다.
- 자동 DB migration 없이도 기존 데이터 손상 없이 repair할 수 있다.

### Tests

- `packages/editor-core/src/patches/legacyKeywordTriggerRepair.test.ts`
  - 1 occurrence는 high confidence suggestion
  - N actions/N occurrences는 order mapping
  - 1 action/N occurrences는 low confidence 마지막 occurrence suggestion
  - 0 occurrence는 none
- `apps/web/src/features/editor/shell/EditorShell.test.tsx`
  - legacy trigger를 occurrence로 재연결하면 `update_slide_action` patch가 `keyword-occurrence` trigger를 가진다.

## Task 7. Rehearsal Coverage와 Occurrence Completion 상태 분리

### Problem

`evaluateLiveTranscript()`는 현재 unique keyword 기준 coverage를 계산한다. 이 coverage는 “필수 키워드를 말했는가” 체크리스트에는 맞지만, “특정 occurrence action이 실행됐는가”를 의미하지 않는다.

같은 keyword가 여러 번 등장할 때 keyword coverage를 occurrence trigger 실행 조건으로 재사용하면, 앞의 `AI` 발화가 뒤의 `AI` trigger를 충족한 것처럼 보일 수 있다.

### Implementation

1. 기존 `LiveTranscriptAnalysis.detectedKeywords`는 legacy checklist/coverage 용도로 유지한다.

2. occurrence action 실행 상태는 별도 state로 유지한다.

   ```ts
   type LiveKeywordOccurrenceState = {
     slideId: string;
     confirmedOccurrenceIds: string[];
   };
   ```

   이 state는 이미 `RehearsalWorkspace`에 있으므로, coverage와 섞지 않고 명시적으로 유지한다.

3. auto-advance 또는 report가 occurrence trigger completion을 필요로 하면 새 metric을 추가한다.

   ```ts
   type OccurrenceTriggerProgress = {
     targetOccurrenceIds: string[];
     confirmedOccurrenceIds: string[];
     coverage: number;
   };
   ```

4. keyword checklist coverage를 required occurrence coverage로 바꾸지 않는다. 제품 의미가 다르다.

   - keyword checklist coverage: 이 슬라이드의 핵심 용어를 말했는가
   - occurrence trigger coverage: action이 연결된 특정 위치에 도달했는가

### Acceptance Criteria

- keyword checklist는 기존처럼 keywordId 단위로 동작한다.
- occurrence action 실행 여부는 `confirmedOccurrenceIds`로만 판단한다.
- 앞의 같은 keyword가 detected되어도 target occurrence의 confirmed state는 바뀌지 않는다.

### Tests

- `apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx`
  - 첫 번째 `AI` detection은 keyword coverage를 올릴 수 있지만, 마지막 `AI` occurrence action은 실행하지 않는다.
  - 마지막 occurrence window에서만 `confirmedOccurrenceIds`에 target id가 추가된다.
- `apps/web/src/features/rehearsal/speech/keywordOccurrenceRuntime.test.ts`
  - confidence threshold 미만이면 match하지 않는다.
  - target occurrence 이전 progress에서는 match하지 않는다.
  - already confirmed occurrence는 다시 match하지 않는다.

## Task 8. End-to-End 저장 검증 추가

### Problem

현재 UI에서 occurrence가 강조되고 action helper가 occurrence trigger를 만들 수 있어도, 실제 프로젝트 저장 흐름에서 API로 persisted deck에 들어가는지 확인하는 테스트가 필요하다.

### Implementation

1. editor integration test에서 다음 흐름을 검증한다.

   - 발표 메모에 같은 keyword가 2개 이상 있다.
   - 두 번째 occurrence를 선택한다.
   - 애니메이션 또는 next-slide action을 추가한다.
   - 발생한 patch operation의 action trigger가 `kind: "keyword-occurrence"`와 expected `occurrenceId`를 가진다.

2. API service test에서 `add_slide_action` patch가 occurrence trigger를 포함할 때 deck 저장이 성공하는지 검증한다.

   File: `apps/api/src/decks/decks.service.spec.ts`

3. DB 직접 검증은 수동 QA 항목으로 둔다. 테스트는 DB row 전체를 snapshot하지 않고 action trigger만 검사한다.

### Acceptance Criteria

- API persisted `decks.deck_json` 안의 action trigger가 occurrence id를 유지한다.
- speaker notes 원문, raw transcript, raw audio를 test log에 출력하지 않는다.
- current project처럼 action이 없는 상태와 occurrence action이 저장된 상태를 구분해 확인할 수 있다.

### Tests

- `apps/web/src/features/editor/shell/EditorShell.test.tsx`
- `apps/api/src/decks/decks.service.spec.ts`

## Verification Commands

Focused verification:

```bash
pnpm --filter @orbit/shared test -- deck.schema.test.ts live-stt.schema.test.ts
pnpm --filter @orbit/editor-core test -- keywordOccurrences.test.ts actionOperations.test.ts slidePlayback.test.ts
pnpm --filter @orbit/web test -- KeywordInspector.test.tsx EditorShell.test.tsx RehearsalWorkspace.test.tsx triggeredActionPlayback.test.ts
pnpm --filter @orbit/api test -- decks.service.spec.ts
```

Type checks:

```bash
pnpm --filter @orbit/shared typecheck
pnpm --filter @orbit/editor-core typecheck
pnpm --filter @orbit/web typecheck
pnpm --filter @orbit/api typecheck
```

Manual browser QA:

1. 발표 메모를 `AI를 설명하고 중간에 AI를 말한 뒤 마지막에 AI를 강조합니다.`처럼 만든다.
2. 마지막 `AI`만 클릭한다.
3. 선택 강조가 마지막 `AI`에만 적용되는지 확인한다.
4. 선택 상태에서 애니메이션을 추가한다.
5. 저장 완료 후 DB 또는 API response에서 action trigger만 확인한다.

   Expected:

   ```json
   {
     "kind": "keyword-occurrence",
     "keywordId": "kw_...",
     "occurrenceId": "kwo_..."
   }
   ```

6. 리허설에서 첫 번째/중간 `AI` 문장을 말해도 target animation이 실행되지 않는지 확인한다.
7. 마지막 `AI` 주변 문장까지 진행했을 때만 target animation 또는 next-slide action이 실행되는지 확인한다.

## Do Not Do

- 같은 단어 occurrence마다 `kw_ai_1`, `kw_ai_2`처럼 keyword를 복제하지 않는다.
- `kind: "keyword"` trigger에 optional `occurrenceId`를 섞어 새 action을 만들지 않는다.
- `slide.keywordOccurrences`를 Deck JSON에 중복 저장하지 않는다.
- speaker notes, raw transcript, raw audio를 presenter/audience snapshot 또는 서버 로그에 포함하지 않는다.
- low-confidence legacy trigger repair를 자동 저장하지 않는다.

## Implementation Order

1. Task 1: occurrence derivation source of truth
2. Task 2: next-slide occurrence action
3. Task 3: usage split
4. Task 4: dangling occurrence guard
5. Task 5: live STT event contract
6. Task 7: occurrence completion state tests
7. Task 8: persistence integration tests
8. Task 6: legacy repair flow, product decision 후 진행

Task 6은 기존 사용자 deck을 바꾸는 정책이므로 별도 확인 후 진행한다. 나머지 task는 현재 버그를 막기 위한 직접 구현 범위다.
