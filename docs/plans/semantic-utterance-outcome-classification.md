# Implementation Plan: Semantic Utterance Outcome Classification

**Status:** Ready after E5 calibration spike
**Date:** 2026-07-09
**Related specs/plans:**

- Original spec: `docs/specs/semantic-utterance-recognition.md` (no longer present in this checkout). See the [Deck·Editor contract](../contracts/deck-editor.md) for current behavior.
- [semantic-sentence-presenter-matching.md](./semantic-sentence-presenter-matching.md)
- [e5-prefix-mode-calibration.md](../spikes/e5-prefix-mode-calibration.md)

## Objective

Extend semantic utterance recognition so the system does not treat the nearest script sentence as a guaranteed match. Final STT segments should be classified into explicit rehearsal outcomes:

- `covered`: the speaker said a script sentence substantially as written.
- `paraphrased`: the speaker used different wording but conveyed the intended meaning.
- `ad-lib`: the speaker added content that is not in the script.
- `missed`: a script sentence was not explained before leaving or finishing the slide/session.

`covered` and `paraphrased` both count as coverage and may advance the current sentence. `ad-lib` is recorded for the report but does not advance script coverage. `missed` is computed from script sentences that remain uncovered at slide/session finalization.

## Research Findings

### Top-k retrieval is not acceptance

Semantic search embeds the corpus and the query in the same vector space, then returns the nearest corpus entries. This means a current-slide top 1 result always exists whenever the slide has at least one indexed sentence. Top 1 must therefore be treated as a candidate, not as proof that the spoken content belongs to the script.

Source: Sentence Transformers semantic search documentation describes finding the closest corpus embeddings for an embedded query: <https://www.sbert.net/examples/sentence_transformer/applications/semantic-search/README.html>

### E5 scores need local calibration

The `intfloat/multilingual-e5-small` model card states:

- inputs should use `query: ` / `passage: ` prefixes according to task type;
- embeddings are normalized before dot-product scoring;
- long texts are truncated at 512 tokens;
- cosine scores clustering around `0.7` to `1.0` is expected, and relative order matters more than absolute score.

This makes a single hard-coded global threshold fragile for distinguishing in-script paraphrases from unrelated `ad-lib` speech. Prefix mode and final thresholds are therefore owned by the E5 calibration spike, not by this feature implementation plan.

Source: `intfloat/multilingual-e5-small` model card: <https://huggingface.co/intfloat/multilingual-e5-small>

### Open-set rejection is required

The current script-matching problem is open-set at inference time: a final STT segment may belong to one of the current slide script sentences, or to no script sentence at all. Intent detection research frames this as out-of-scope detection: systems cannot assume every user query belongs to a supported class.

Source: CLINC150 / out-of-scope intent detection paper: <https://arxiv.org/abs/1909.02027>

### Browser runtime remains valid

The existing browser-local Transformers.js approach remains compatible with this plan. Transformers.js supports browser execution through ONNX Runtime and the `pipeline` API, including `feature-extraction` as a supported task.

Sources:

- Transformers.js overview: <https://huggingface.co/docs/transformers.js/index>
- Transformers.js environment configuration: <https://huggingface.co/docs/transformers.js/en/api/env>
- Transformers.js pipelines API: <https://huggingface.co/docs/transformers.js/en/api/pipelines>

## User Decisions

| Topic | Decision |
| --- | --- |
| `paraphrased` coverage | `paraphrased` counts the same as `covered` for coverage, sentence focus, and auto progression. The UI/report distinguishes the outcome label. |
| `ad-lib` persistence | `ad-lib` should be included in the rehearsal report, not only debug UI. |
| `ad-lib` raw text | Store the ad-lib utterance text in run/report metadata. This is an explicit exception to the previous run meta shape, but it must not be written to server logs. |
| Threshold calibration | Use the completed [E5 prefix mode calibration spike](../spikes/e5-prefix-mode-calibration.md) as the source of threshold and margin constants. |
| E5 prefix mode | Do not decide inside this implementation plan. Consume the spike decision: `query-passage` or `query-query`. |

## Scope Boundaries

**In scope**

- Web rehearsal code under `apps/web/src/features/rehearsal`.
- Shared rehearsal run meta schema in `packages/shared/src/rehearsals`.
- Semantic matcher decision types, debug state, session events, presenter speech state, rehearsal report surfaces.
- Focused implementation tests for exact, paraphrase, ad-lib, ambiguous, and missed cases using the spike-selected policy.

**Out of scope**

- STT model replacement.
- Fine-tuning an embedding or NLI model.
- Sending raw audio or full transcript to a new server-side semantic service.
- Exposing transcript, ad-lib text, semantic top matches, or speaker notes to audience/slide display windows.
- Persisting every final STT segment as a full transcript log.
- Running the E5 prefix/threshold calibration experiment itself. That belongs to [e5-prefix-mode-calibration.md](../spikes/e5-prefix-mode-calibration.md).

## Architecture Decisions

- Keep nearest-neighbor ranking separate from outcome classification. Ranking produces top-k candidates; a decision layer assigns `accepted`, `rejected-low-score`, `rejected-ambiguous`, `rejected-covered`, or `ad-lib`.
- Add outcome-specific speech events instead of overloading `sentence-covered` with hidden semantics.
- Preserve existing substring/Dice matching as the exact/lexical path and semantic matching as the paraphrase path.
- Count `covered` and `paraphrased` toward sentence coverage. Do not count `ad-lib`.
- Compute `missed` from uncovered script sentence IDs at slide exit or session finalization.
- Store only bounded ad-lib snippets selected by the classifier, not full continuous transcripts. Server logs must continue to avoid transcript, speaker notes, and raw audio.
- Keep presenter remote state speaker-only. `PresentWindow` and slide deck snapshots must continue excluding speech/debug/report text.
- Consume a calibration profile from the completed E5 spike. The implementation should not compare prefix modes at runtime.

## Proposed Data Model

### Outcome Types

```ts
export type UtteranceOutcomeKind =
  | "covered"
  | "paraphrased"
  | "ad-lib"
  | "missed";

export type SemanticMatchDecisionReason =
  | "accepted-exact"
  | "accepted-paraphrase"
  | "rejected-low-score"
  | "rejected-ambiguous"
  | "rejected-covered"
  | "ad-lib";

export type SemanticUtteranceDecision = {
  slideId: string;
  transcript: string;
  isFinal: true;
  topMatches: SemanticUtteranceMatch[];
  acceptedMatch: SemanticUtteranceMatch | null;
  reason: SemanticMatchDecisionReason;
  outcome: Exclude<UtteranceOutcomeKind, "missed">;
  scoreThreshold: number;
  ambiguousMargin: number;
  lexicalOverlap: number;
};
```

### Speech Events

```ts
export type SentenceCoveredEvent = {
  type: "sentence-covered";
  slideId: string;
  sentenceId: string;
  matchKind: "covered" | "paraphrased";
  similarity?: number;
  lexicalOverlap?: number;
  atMs: number;
};

export type AdLibDetectedEvent = {
  type: "ad-lib-detected";
  slideId: string;
  text: string;
  nearestSentenceId: string | null;
  similarity: number | null;
  atMs: number;
};

export type SentenceMissedEvent = {
  type: "sentence-missed";
  slideId: string;
  sentenceId: string;
  atMs: number;
};
```

### Run Meta Extension

`packages/shared/src/rehearsals/rehearsal.schema.ts` currently states that run meta does not accept transcript/script/raw audio. This plan intentionally extends run meta with bounded utterance outcome facts so the rehearsal report can explain what was covered, paraphrased, added, and missed.

```ts
export const rehearsalUtteranceOutcomeSchema = z
  .object({
    slideId: deckSlideIdSchema,
    kind: z.enum(["covered", "paraphrased", "ad-lib", "missed"]),
    sentenceId: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).max(600).optional(),
    similarity: z.number().min(-1).max(1).optional(),
    lexicalOverlap: z.number().min(0).max(1).optional(),
    at: isoDateTimeSchema.optional()
  })
  .strict();
```

Guardrails:

- `text` is allowed for `ad-lib` because the user explicitly approved raw ad-lib text in reports.
- `text` should not store full slide speaker notes.
- Non-ad-lib outcomes should prefer `sentenceId` plus metrics, not transcript text.
- API/server logs must not print `text`.

## Classification Policy

The classifier should run only for final STT segments. It receives:

- normalized final STT segment;
- current slide semantic index;
- current covered sentence IDs;
- lexical matcher result for exact/near-exact coverage;
- semantic top-k matches;
- calibrated threshold/margin settings from the E5 spike.

Decision order:

1. If lexical substring/Dice matcher covers a script sentence, emit `covered`.
2. Else rank current-slide semantic candidates.
3. If no candidate passes calibrated semantic acceptance, emit `ad-lib`.
4. If the best candidate is too close to the second candidate, emit `ad-lib` or `uncertain` internally and do not cover any sentence. The public report should classify it as `ad-lib` only if the spoken text is clearly extra content; otherwise omit it from persisted outcomes until calibration defines an `uncertain` report state.
5. If the best accepted candidate is already covered, do not cover it again. If the transcript contains additional non-script content, emit an `ad-lib` segment for the extra part only when segmentation supports that safely.
6. If semantic accepted and lexical overlap is below the exact threshold, emit `paraphrased`.
7. On slide exit/session finalization, emit or compute `missed` for every matchable sentence not covered by `covered` or `paraphrased`.

Initial metric concepts:

- `semanticSimilarity`: E5 dot product on normalized embeddings.
- `semanticMargin`: `top1.similarity - top2.similarity`.
- `lexicalOverlap`: word multiset recall or token overlap between final STT segment and candidate sentence.
- `exactLexicalThreshold`: spike-selected value above which an accepted sentence is labeled `covered` instead of `paraphrased`.
- `adLibRejectThreshold`: spike-selected semantic similarity floor below which the utterance is not a script match.
- `ambiguousMargin`: spike-selected minimum margin required to accept top 1.

## Required Spike Inputs

Before this plan is implemented, [e5-prefix-mode-calibration.md](../spikes/e5-prefix-mode-calibration.md) must be completed with:

- selected prefix mode;
- `adLibRejectThreshold`;
- `ambiguousMargin`;
- `exactLexicalThreshold`;
- known failure cases;
- fixture evidence that unrelated `ad-lib` speech does not mutate coverage merely because top 1 exists.

## UI and Product Behavior

### Debug Panel

The debug panel must not label rank 1 as `적용` solely because semantic matching is enabled. It should display:

- top 3 candidates;
- `acceptedMatch` if any;
- decision reason;
- outcome label: `covered`, `paraphrased`, `ad-lib`, or `rejected`;
- threshold and margin used for the decision.

### Rehearsal Script UI

- `covered`: mark the sentence complete.
- `paraphrased`: mark the sentence complete with a distinct semantic/paraphrase indicator.
- `ad-lib`: show as an extra spoken note in a separate area, not inline as a script sentence.
- `missed`: show after slide/session finalization or in report, not as a live accusation while the speaker is still on the slide.

### Presenter Remote

- Mirror the same current sentence coverage/paraphrase state from owner rehearsal state.
- Show ad-lib indicators only in presenter-only surfaces.
- Do not start a second STT or embedding session.
- Do not expose outcome text to `PresentWindow`.

### Rehearsal Report

Add a section that separates:

- 그대로 말한 문장: `covered`.
- 바꿔 말했지만 의미 전달한 문장: `paraphrased`.
- 추가로 말한 애드리브: `ad-lib`.
- 설명하지 않고 넘어간 문장: `missed`.

## Dependency Graph

```text
Outcome data contract
  ├─ speech event types
  ├─ rehearsal log collector
  └─ report rendering

Completed E5 calibration spike
  ├─ prefix mode
  ├─ threshold/margin policy
  └─ known failure cases

Matcher decision layer
  ├─ speech tracker coverage events
  ├─ semantic debug state
  ├─ presenter speech state
  └─ rehearsal/presenter UI

Slide/session finalization
  ├─ missed sentence calculation
  └─ run meta persistence
```

## Implementation Tasks

### Task 1: Add Outcome Contract to Shared Rehearsal Meta

**Description:** Extend shared rehearsal run meta with bounded utterance outcomes and update schema tests. Preserve existing `missedKeywords` and `adviceEvents`.

**Acceptance criteria:**

- `rehearsalRunMetaSchema` accepts `utteranceOutcomes` with `covered`, `paraphrased`, `ad-lib`, and `missed`.
- `ad-lib` may include bounded `text`; other outcomes prefer `sentenceId` and metrics.
- Invalid raw/oversized text is rejected.
- Existing run meta payloads remain valid.

**Verification:**

- `corepack pnpm --filter @orbit/shared test -- src/rehearsals/rehearsal.schema.test.ts`
- `corepack pnpm --filter @orbit/web typecheck`

**Dependencies:** None

**Files likely touched:**

- `packages/shared/src/rehearsals/rehearsal.schema.ts`
- `packages/shared/src/rehearsals/rehearsal.schema.test.ts`

**Estimated scope:** Small

### Task 2: Import Spike Calibration Policy

**Description:** Convert the completed E5 prefix calibration spike into implementation constants/configuration and regression fixtures. This task does not run the prefix comparison experiment; it consumes the spike result.

**Acceptance criteria:**

- Prefix mode is represented in the embedding/matcher configuration.
- `adLibRejectThreshold`, `ambiguousMargin`, and `exactLexicalThreshold` are named constants or config values.
- Tests prove low-similarity top 1 does not become coverage.
- Spike known-failure cases are represented as regression tests where practical.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/semanticUtteranceDecision.test.ts`
- Review completed [e5-prefix-mode-calibration.md](../spikes/e5-prefix-mode-calibration.md) decision table.

**Dependencies:** Task 1

**Files likely touched:**

- `apps/web/src/features/rehearsal/speech/semanticUtteranceDecision.test.ts`
- `apps/web/src/features/rehearsal/speech/e5EmbeddingService.ts`
- `apps/web/src/features/rehearsal/speech/semanticUtteranceMatcher.ts`

**Estimated scope:** Medium

### Task 3: Introduce Semantic Decision Layer

**Description:** Split semantic ranking from decision making. Add a pure decision module that returns accepted/rejected reason, outcome kind, selected sentence, score, margin, and lexical overlap.

**Acceptance criteria:**

- `rankTopSemanticMatches` still returns top-k candidates for debug.
- `decideSemanticUtteranceOutcome` rejects low-score and ambiguous candidates.
- Top 1 is never treated as applied unless the decision reason is accepted.
- Already-covered top 1 does not produce duplicate coverage.
- Semantic matching disabled still permits debug ranking but does not mutate coverage.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/semanticUtteranceMatcher.test.ts`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/semanticUtteranceDecision.test.ts`

**Dependencies:** Task 2

**Files likely touched:**

- `apps/web/src/features/rehearsal/speech/semanticUtteranceDecision.ts`
- `apps/web/src/features/rehearsal/speech/semanticUtteranceMatcher.ts`
- `apps/web/src/features/rehearsal/speech/semanticUtteranceMatcher.test.ts`
- `apps/web/src/features/rehearsal/speech/semanticUtteranceDecision.test.ts`

**Estimated scope:** Medium

### Task 4: Extend Speech Events and Tracker Outcomes

**Description:** Add outcome-aware coverage events and ad-lib events to the speech tracker/session path. Keep exact substring/Dice fallback working.

**Acceptance criteria:**

- Exact matcher emits `sentence-covered` with `matchKind: "covered"`.
- Accepted semantic paraphrase emits `sentence-covered` with `matchKind: "paraphrased"`.
- Rejected unmatched final segment can emit `ad-lib-detected`.
- Coverage calculation counts `covered` and `paraphrased`, not `ad-lib`.
- Speech events do not include speaker notes or raw audio.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/speechTracker.test.ts`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/p3RehearsalSession.test.ts`

**Dependencies:** Task 3

**Files likely touched:**

- `apps/web/src/features/rehearsal/speech/speechTrackingEvents.ts`
- `apps/web/src/features/rehearsal/speech/speechTracker.ts`
- `apps/web/src/features/rehearsal/speech/p3RehearsalSession.ts`
- `apps/web/src/features/rehearsal/speech/speechTracker.test.ts`
- `apps/web/src/features/rehearsal/speech/p3RehearsalSession.test.ts`

**Estimated scope:** Medium

### Task 5: Record Outcomes in the Rehearsal Log Collector

**Description:** Persist bounded outcome facts to run meta so reports can show covered/paraphrased/ad-lib/missed. Compute missed sentences from uncovered matchable sentence IDs at finalization.

**Acceptance criteria:**

- Collector records covered/paraphrased sentence outcomes once per sentence.
- Collector records ad-lib text with slide ID and timestamp.
- Collector computes missed sentence IDs for matchable sentences not covered or paraphrased.
- Existing missed keyword behavior is unchanged.
- No server log path prints ad-lib text.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/rehearsalLogCollector.test.ts`
- `corepack pnpm --filter @orbit/shared test -- src/rehearsals/rehearsal.schema.test.ts`

**Dependencies:** Task 4

**Files likely touched:**

- `apps/web/src/features/rehearsal/speech/rehearsalLogCollector.ts`
- `apps/web/src/features/rehearsal/speech/rehearsalLogCollector.test.ts`
- `apps/web/src/features/rehearsal/speech/p3RehearsalSession.ts`

**Estimated scope:** Medium

### Task 6: Update Debug, Presenter, and Rehearsal UI

**Description:** Show decision outcomes instead of implying that rank 1 is applied. Reflect covered/paraphrased/ad-lib/missed state in rehearsal and presenter-only surfaces.

**Acceptance criteria:**

- Debug panel shows decision reason and does not mark low-score top 1 as applied.
- Rehearsal script UI distinguishes `covered` and `paraphrased`.
- Presenter remote mirrors outcome state without running another matcher.
- `PresentWindow` does not render or receive ad-lib text, transcript, top matches, or speaker notes.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/panel/SemanticSpeechDebugPanel.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/panel/RehearsalPanel.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/PresenterRemoteWindow.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/presenter/PresentWindow.test.tsx`

**Dependencies:** Task 5

**Files likely touched:**

- `apps/web/src/features/rehearsal/panel/SemanticSpeechDebugPanel.tsx`
- `apps/web/src/features/rehearsal/panel/RehearsalPanel.tsx`
- `apps/web/src/features/rehearsal/presenter/PresenterRemoteWindow.tsx`
- `apps/web/src/features/rehearsal/presenter/presenterStateStore.ts`
- `apps/web/src/features/rehearsal/presenter/presentationChannel.ts`
- `apps/web/src/styles.css`

**Estimated scope:** Medium

### Task 7: Add Report Rendering for Utterance Outcomes

**Description:** Surface utterance outcomes in completion/report screens, separating exact coverage, semantic paraphrases, ad-lib additions, and missed script sentences.

**Acceptance criteria:**

- Report has distinct sections or grouped rows for `covered`, `paraphrased`, `ad-lib`, and `missed`.
- Ad-lib text appears only in presenter/rehearsal report surfaces.
- Missed sentences are derived from script sentence IDs and displayed with slide context.
- Existing missed keyword report remains visible.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/RehearsalWorkspace.test.tsx`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/RehearsalReportDocument.test.tsx`
- `corepack pnpm --filter @orbit/web typecheck`

**Dependencies:** Task 5

**Files likely touched:**

- `apps/web/src/features/rehearsal/RehearsalWorkspace.tsx`
- `apps/web/src/features/rehearsal/RehearsalReportDocument.tsx`
- `apps/web/src/features/rehearsal/rehearsalSlideAnalysisModel.ts`
- `apps/web/src/styles.css`

**Estimated scope:** Medium

### Task 8: End-to-End Outcome Browser QA

**Description:** Run the integrated workflow with the spike-selected E5 policy, semantic toggle on/off, presenter remote, and report generation.

**Acceptance criteria:**

- Unrelated ad-lib speech does not cover any script sentence even though top 1 exists.
- Exact script speech records `covered`.
- Semantic paraphrase records `paraphrased` and advances the sentence.
- Ad-lib text appears in the report.
- Uncovered script sentences appear as `missed`.
- Presenter remote mirrors outcomes; slide display remains private.

**Verification:**

- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/semanticUtteranceDecision.test.ts`
- `corepack pnpm --filter @orbit/web test -- src/features/rehearsal/speech/p3RehearsalSession.test.ts`
- `corepack pnpm --filter @orbit/web typecheck`
- Manual Chrome QA with real model loading and debug panel.

**Dependencies:** Tasks 1-7

**Files likely touched:** Tests and QA notes only unless defects are found.

**Estimated scope:** Small

## Checkpoints

### Checkpoint A: Contract and Calibration Policy

- [ ] Shared schema accepts utterance outcomes.
- [ ] Existing run meta payloads remain valid.
- [ ] Completed E5 spike provides prefix mode and thresholds.
- [ ] Spike known-failure cases are represented in implementation tests where practical.

### Checkpoint B: Decision Correctness

- [ ] Top 1 candidate alone never mutates coverage.
- [ ] Low-score and ambiguous final STT are rejected.
- [ ] `covered` vs `paraphrased` is determined by lexical overlap after semantic acceptance.
- [ ] Prefix mode from the E5 spike is applied consistently.

### Checkpoint C: Runtime Integration

- [ ] Final STT only path still holds.
- [ ] Semantic toggle gates coverage/progression mutation.
- [ ] Substring/Dice fallback still works when semantic matching fails.
- [ ] Ad-lib does not affect sentence coverage.

### Checkpoint D: UI and Privacy

- [ ] Debug panel shows decision reason.
- [ ] Rehearsal and presenter UI distinguish covered/paraphrased/ad-lib.
- [ ] Report shows ad-lib text and missed sentences.
- [ ] Slide display and audience surfaces do not receive speaker-only text.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| E5 absolute scores are poorly calibrated for this task | High | Complete the dedicated E5 prefix calibration spike before implementing matcher decisions; record chosen thresholds in tests. |
| Ad-lib false positive covers a script sentence | High | Treat false positive as highest-risk failure; require threshold plus margin; do not rely on top 1 alone. |
| Paraphrase false negative slows progression | Medium | Use the spike-selected threshold policy; keep manual controls and existing exact matcher. |
| Persisting ad-lib text increases privacy risk | High | Store only bounded ad-lib snippets in run meta by explicit user decision; never log text; keep out of audience/slide windows. |
| Mixed script-plus-ad-lib utterances are hard to split | Medium | Start with sentence/terminal-punctuation segmentation; only persist clear extra segments; leave uncertain mixed cases out of report until classified safely. |
| Shared schema change affects API compatibility | Medium | Add defaults so existing run meta remains valid; update shared tests first. |

## Open Questions

None. The user explicitly decided:

- `paraphrased` counts as coverage.
- `ad-lib` should be saved in reports.
- raw ad-lib text may be persisted in bounded run meta.
- thresholds must come from the E5 calibration spike.
- E5 prefix mode must come from the E5 calibration spike.
