# Implementation Plan: Semantic Sentence Matching and Presenter Script UI

**Status:** Ready for implementation review
**Date:** 2026-07-09
**Source spec at planning time:** `docs/specs/semantic-utterance-recognition.md` (no longer present in this checkout). Current behavior is documented in the [Deck·Editor contract](../contracts/deck-editor.md).

## Objective

Extend the existing semantic utterance recognition work so script progress is driven by sentence-level semantic coverage, not karaoke-style token highlighting. When a semantically matched sentence becomes covered, rehearsal and presenter script surfaces should immediately focus the next sentence. Presenter remote mode should also show the semantic floating debug panel and reflect semantic matching state from the owner rehearsal session.

## Updated Requirements

1. Drop karaoke-style word/token highlighting for the active prompter path.
2. Treat the requirement "문장 단위로 매칭 / covered 됐다면 바로 다음 문장 보여주기" as semantic embedding based matching, not substring or transcript token progress.
3. Split semantic script sentences on terminal punctuation, not only periods: `.`, `?`, `!`, `。`, `？`, `！`, and `…`.
4. Show the semantic floating panel in presenter remote mode.
5. Let presenter remote mode display script progress based on semantic sentence coverage.
6. Restyle the rehearsal script panel to match the presenter remote script design.

## Scope Boundaries

**In scope**

- Web rehearsal code under `apps/web/src/features/rehearsal`.
- Semantic sentence splitting, semantic matching focus behavior, presenter remote state propagation, presenter/rehearsal script UI.
- Browser-local semantic debug panel in the owner rehearsal screen and presenter remote screen.

**Out of scope**

- Server/API/Worker changes.
- `packages/shared` Deck JSON contract changes.
- Audience screen semantic debug or speaker notes exposure.
- Slide display window (`PresentWindow`) receiving speaker notes or raw transcript.
- STT engine changes or embedding model changes.

## Architecture Decisions

- Keep semantic matching execution in the owner `RehearsalWorkspace` / `P3RehearsalSession` path. Presenter remote receives sanitized presenter-state updates and displays the result; it does not open its own microphone or run a second STT session.
- Treat `PresenterRemoteWindow` as the presenter-only popup that may receive speaker notes and semantic debug state. Keep `PresentWindow` as slide-rendering-only; `createSlideWindowDeckSnapshot` must continue stripping `speakerNotes`, `keywords`, and actions from slide-window snapshots.
- Replace karaoke prompter token progress with sentence focus state derived from `coveredSentenceIds`. If a semantic accepted match covers sentence N, the current displayed sentence becomes the next uncovered matchable sentence.
- Reuse or extract a shared presenter-style script list component so rehearsal and presenter remote script panels share layout and state semantics.
- Preserve `AutoAdvanceSettings.semanticMatching` as the gate for semantic coverage/progression mutation. Debug top matches may still display while the toggle is off, but a sentence is considered covered by semantic matching only when the toggle allows mutation.

## Dependency Graph

```text
Terminal punctuation splitter
  ├─ semantic matcher sentence index
  └─ phrase/panel sentence alignment review

Semantic coverage focus policy
  ├─ rehearsal prompter sentence display
  └─ rehearsal script panel state

Presenter speech state contract
  ├─ presentation channel messages
  ├─ PresenterRemoteWindow semantic panel
  └─ presenter-style shared script UI

Shared script UI
  ├─ RehearsalPanel
  └─ PresenterRemoteWindow
```

## Task 1: Broaden Semantic Sentence Boundaries

**Description:** Update the semantic splitter so terminal punctuation marks end a semantic sentence. Keep decimal-period protection and trailing text behavior.

**Acceptance criteria:**

- `질문인가요? 다음입니다! 끝.` splits into three semantic sentences.
- `Version 1.2 is ready? Next!` keeps `1.2` inside the first sentence and splits on `?` and `!`.
- CJK punctuation `。`, `？`, `！`, and ellipsis `…` split sentences.
- Trailing text without terminal punctuation remains included.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/semanticSentenceSplitter.test.ts`

**Dependencies:** None

**Files likely touched:**

- `apps/web/src/features/rehearsal/speech/semanticSentenceSplitter.ts`
- `apps/web/src/features/rehearsal/speech/semanticSentenceSplitter.test.ts`
- `docs/specs/semantic-utterance-recognition.md` or this plan, if documenting that the earlier period-only rule is superseded

**Estimated scope:** Small

## Task 2: Make Prompter Focus Purely Sentence-Based

**Description:** Replace the active prompter's karaoke token progress with sentence focus derived from semantic sentence coverage. The current sentence should advance as soon as the sentence is covered; transcript token completion should not keep a covered sentence on screen.

**Acceptance criteria:**

- `getRehearsalPrompterRows` chooses the next uncovered matchable sentence when `coveredSentenceIds` includes the current sentence.
- A partially matching transcript does not keep the covered sentence visible.
- Previous/current/next sentence display remains available.
- The active current sentence comes from semantic coverage when `AutoAdvanceSettings.semanticMatching` is on and semantic matcher accepts the final STT result.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/RehearsalWorkspace.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/p3RehearsalSession.test.ts`

**Dependencies:** Task 1

**Files likely touched:**

- `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`
- `apps/web/src/features/rehearsal/speech/p3RehearsalSession.test.ts`
- `apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx`

**Estimated scope:** Medium

## Task 3: Remove Karaoke Token UI From the Rehearsal Prompter

**Description:** Remove or retire the `KaraokePrompterSegment` rendering path for the active rehearsal prompter. Render the current sentence as a single sentence block with previous/next context.

**Acceptance criteria:**

- The rehearsal prompter no longer renders spoken/pending token spans as the primary progress UI.
- Classes such as `rehearsal-teleprompter-token-spoken` and `rehearsal-teleprompter-token-pending` are removed or become unused legacy styles scheduled for deletion in the same task.
- Current sentence visual emphasis is applied at the sentence/block level.
- Existing auto-advance countdown/status cards still render.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/RehearsalWorkspace.test.tsx`
- `corepack pnpm --filter @orbit/web typecheck`

**Dependencies:** Task 2

**Files likely touched:**

- `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx`

**Estimated scope:** Medium

## Task 4: Add Presenter Speech State to the Presentation Channel

**Description:** Extend presenter state messages with browser-local speech progress needed by presenter remote mode: covered sentence IDs, semantic debug state, and whether semantic coverage is enabled. Do not include this state in slide-window deck snapshots.

**Acceptance criteria:**

- `PresenterSlideshowState` can carry a presenter-only speech state object.
- `createPresenterStateMessage` and `createPresenterSnapshotMessage` validate and transmit that state to `PresenterRemoteWindow`.
- `createSlideWindowDeckSnapshot` still strips `speakerNotes`, `keywords`, and actions.
- `PresentWindow` tests continue proving that presenter-only content does not reach the slide display window.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/presentationChannel.test.ts`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/PresentWindow.test.tsx`
- `corepack pnpm --filter @orbit/web typecheck`

**Dependencies:** Task 2

**Files likely touched:**

- `apps/web/src/features/rehearsal/presenter/presenterStateStore.ts`
- `apps/web/src/features/rehearsal/presenter/presentationChannel.ts`
- `apps/web/src/features/rehearsal/presenter/presentationChannel.test.ts`
- `apps/web/src/features/rehearsal/presenter/PresentWindow.test.tsx`
- `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`

**Estimated scope:** Medium

## Task 5: Show Semantic Debug Panel in Presenter Remote Mode

**Description:** Render the existing `SemanticSpeechDebugPanel` in `PresenterRemoteWindow` using semantic debug state received from the owner rehearsal session. Keep the same development/localStorage visibility gate semantics unless a presenter-specific gate is required later.

**Acceptance criteria:**

- Presenter remote mode can show the semantic floating panel.
- The panel shows the latest final STT text and top matches from the owner session.
- The panel's "적용/참고" semantics match the owner screen's `semanticMatchingEnabled` flag.
- No additional STT session or embedding service is started in `PresenterRemoteWindow`.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/PresenterRemoteWindow.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/panel/SemanticSpeechDebugPanel.test.tsx`
- Manual Chrome check: start Live STT from presenter remote, observe owner session semantic debug state mirrored in presenter remote.

**Dependencies:** Task 4

**Files likely touched:**

- `apps/web/src/features/rehearsal/presenter/PresenterRemoteWindow.tsx`
- `apps/web/src/features/rehearsal/presenter/PresenterRemoteWindow.test.tsx`
- `apps/web/src/features/rehearsal/panel/SemanticSpeechDebugPanel.tsx`
- `apps/web/src/styles.css`

**Estimated scope:** Medium

## Task 6: Share Presenter-Style Script UI Between Rehearsal and Presenter Remote

**Description:** Make the rehearsal script panel use the same visual language as the presenter remote script list. Prefer extracting a shared script list component over duplicating markup and CSS.

**Acceptance criteria:**

- Rehearsal script rows visually match presenter remote rows: numbered rows, current row emphasis, covered row state, and readable sentence blocks.
- `RehearsalPanel` still does not render raw transcript text.
- Covered sentences remain marked as covered, and the next uncovered sentence is visually current.
- Pointer/wheel interaction can still pause auto-follow in the rehearsal panel.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/panel/RehearsalPanel.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/PresenterRemoteWindow.test.tsx`
- Manual visual check in Chrome for rehearsal and presenter remote widths.

**Dependencies:** Task 4

**Files likely touched:**

- `apps/web/src/features/rehearsal/panel/RehearsalPanel.tsx`
- `apps/web/src/features/rehearsal/presenter/PresenterRemoteWindow.tsx`
- `apps/web/src/features/rehearsal/panel/RehearsalPanel.test.tsx`
- `apps/web/src/features/rehearsal/presenter/PresenterRemoteWindow.test.tsx`
- `apps/web/src/styles.css`

**Estimated scope:** Medium

## Task 7: End-to-End Semantic Presenter QA

**Description:** Verify the integrated flow with all browser-facing surfaces: owner rehearsal screen, presenter remote screen, and slide display privacy boundary.

**Acceptance criteria:**

- With semantic matching enabled, a final STT phrase that semantically matches sentence N covers sentence N and both rehearsal and presenter remote move focus to sentence N+1.
- With semantic matching disabled, the semantic debug top matches can display but sentence coverage does not mutate from semantic results.
- Presenter remote shows the floating semantic panel when the debug gate allows it.
- Slide display window does not show speaker notes, transcript, semantic top matches, or semantic debug state.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/p3RehearsalSession.test.ts`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/PresenterRemoteWindow.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/PresentWindow.test.tsx`
- `corepack pnpm --filter @orbit/web typecheck`
- Manual Chrome check with presenter remote and semantic debug panel.

**Dependencies:** Tasks 1-6

**Files likely touched:** Test files only unless defects are found.

**Estimated scope:** Small

## Checkpoints

### Checkpoint A: Semantic Sentence Foundation

- [ ] Task 1 tests pass.
- [ ] Existing semantic matcher tests still pass.
- [ ] Period-only rule in the older source spec is clearly superseded by this plan.

### Checkpoint B: Rehearsal UX

- [ ] Tasks 2-3 tests pass.
- [ ] Rehearsal prompter no longer depends on karaoke token progress.
- [ ] Semantic accepted coverage advances to the next sentence immediately.

### Checkpoint C: Presenter Integration

- [ ] Tasks 4-6 tests pass.
- [ ] Presenter remote mirrors semantic debug and script coverage state.
- [ ] Slide display privacy tests still pass.

### Checkpoint D: Complete

- [ ] Task 7 verification complete.
- [ ] `corepack pnpm --filter @orbit/web typecheck` passes.
- [ ] Manual Chrome QA notes are recorded in the final implementation report.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Presenter remote receives speaker-only state that leaks to slide display | High | Keep semantic debug/speech state inside `PresenterSlideshowState`; add `PresentWindow` regression tests proving it is not rendered or included in `createSlideWindowDeckSnapshot`. |
| Semantic false positives advance script focus too aggressively | Medium | Preserve threshold/ambiguous-margin policy and only mutate coverage when semantic matching toggle is on. |
| Splitter divergence between phrase extractor and semantic splitter causes row mismatch | Medium | Add fixtures covering punctuation in both semantic splitter and presenter/rehearsal script rendering. Consider extracting a shared boundary helper only if duplication becomes risky. |
| Shared script component grows too generic | Medium | Extract only the row/list rendering needed by `RehearsalPanel` and `PresenterRemoteWindow`; keep timing, keyword, and command controls in their current owners. |
| UI regression on small presenter popup sizes | Medium | Add responsive CSS constraints and manual Chrome checks for rehearsal and presenter remote viewports. |

## Open Questions

None.

