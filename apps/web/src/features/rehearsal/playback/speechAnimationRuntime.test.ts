import { describe, expect, it } from "vitest";
import type { Slide } from "@orbit/shared";

import { createSlideshowAnimationPlan } from "../presenter/slideshowStepModel";
import { getTriggerAnimationIdsForSlide } from "./triggeredActionPlayback";
import {
  advanceSpeechAnimationManually,
  createSpeechAnimationRuntimeState,
  enqueueSpeechAnimationTriggers,
  settleSpeechAnimationTransition
} from "./speechAnimationRuntime";

describe("speechAnimationRuntime", () => {
  it("plays two triggers one step at a time after transition settlement", () => {
    const slide = createRuntimeSlide();
    const plan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide)
    });
    const first = enqueueSpeechAnimationTriggers({
      sequence: 1,
      slide,
      slideAnimationPlan: plan,
      state: createSpeechAnimationRuntimeState({ slideId: slide.slideId }),
      triggerTraceId: "speech:item-1:0",
      triggers: [
        { kind: "keyword", keywordId: "kw_first" },
        { kind: "keyword", keywordId: "kw_second" }
      ]
    });

    expect(first.state.presenterStepIndex).toBe(1);
    expect(first.state.transition).toEqual({
      slideId: slide.slideId,
      stepIndex: 1
    });
    expect(first.state.pendingIntents).toHaveLength(1);
    expect(first.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "intent_executed",
          triggerTraceId: "speech:item-1:0"
        }),
        expect.objectContaining({
          name: "intent_queued",
          reason: "REQUIRED_STEP_AHEAD_CURRENT",
          triggerTraceId: "speech:item-1:0"
        })
      ])
    );
    expect(first.state.pendingIntents[0]?.triggerTraceId).toBe(
      "speech:item-1:0"
    );

    const second = settleSpeechAnimationTransition({
      address: { slideId: slide.slideId, stepIndex: 1 },
      slide,
      slideAnimationPlan: plan,
      state: first.state
    });

    expect(second.state.presenterStepIndex).toBe(2);
    expect(second.state.playbackState.playedAnimationIds).toEqual([
      "anim_first",
      "anim_second"
    ]);
  });

  it("keeps a future occurrence pending until manual progress settles", () => {
    const slide = createRuntimeSlide();
    const plan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide)
    });
    const queued = enqueueSpeechAnimationTriggers({
      sequence: 1,
      slide,
      slideAnimationPlan: plan,
      state: createSpeechAnimationRuntimeState({ slideId: slide.slideId }),
      triggers: [
        {
          kind: "keyword-occurrence",
          keywordId: "kw_occurrence",
          occurrenceId: "kwo_slide_runtime_kw_occurrence_20_24"
        }
      ]
    });

    expect(queued.pendingOccurrenceIds).toEqual([
      "kwo_slide_runtime_kw_occurrence_20_24"
    ]);
    const manual = advanceSpeechAnimationManually({
      slide,
      slideAnimationPlan: plan,
      state: queued.state
    });
    const drained = settleSpeechAnimationTransition({
      address: { slideId: slide.slideId, stepIndex: 1 },
      slide,
      slideAnimationPlan: plan,
      state: manual.state
    });

    expect(drained.state.presenterStepIndex).toBe(2);
    expect(drained.pendingOccurrenceIds).toEqual([]);
    expect(drained.consumedOccurrenceIds).toEqual([
      "kwo_slide_runtime_kw_occurrence_20_24"
    ]);
  });

  it("preserves a terminal action for the same occurrence", () => {
    const slide = createRuntimeSlide(true);
    const plan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide)
    });
    const queued = enqueueSpeechAnimationTriggers({
      sequence: 1,
      slide,
      slideAnimationPlan: plan,
      state: createSpeechAnimationRuntimeState({
        playbackState: { playedAnimationIds: ["anim_first"] },
        presenterStepIndex: 1,
        slideId: slide.slideId
      }),
      triggers: [
        {
          kind: "keyword-occurrence",
          keywordId: "kw_occurrence",
          occurrenceId: "kwo_slide_runtime_kw_occurrence_20_24"
        }
      ]
    });

    expect(queued.state.presenterStepIndex).toBe(2);
    expect(queued.pendingOccurrenceIds).toEqual([
      "kwo_slide_runtime_kw_occurrence_20_24"
    ]);
    const terminal = settleSpeechAnimationTransition({
      address: { slideId: slide.slideId, stepIndex: 2 },
      slide,
      slideAnimationPlan: plan,
      state: queued.state
    });

    expect(terminal.shouldAdvanceSlide).toBe(true);
    expect(terminal.pendingOccurrenceIds).toEqual([]);
    expect(terminal.consumedOccurrenceIds).toEqual([
      "kwo_slide_runtime_kw_occurrence_20_24"
    ]);
  });

  it("ignores duplicate speech sequences and stale settlement addresses", () => {
    const slide = createRuntimeSlide();
    const plan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide)
    });
    const first = enqueueSpeechAnimationTriggers({
      sequence: 3,
      slide,
      slideAnimationPlan: plan,
      state: createSpeechAnimationRuntimeState({ slideId: slide.slideId }),
      triggers: [{ kind: "keyword", keywordId: "kw_first" }]
    });
    const duplicate = enqueueSpeechAnimationTriggers({
      sequence: 3,
      slide,
      slideAnimationPlan: plan,
      state: first.state,
      triggers: [{ kind: "keyword", keywordId: "kw_second" }]
    });
    const staleSettlement = settleSpeechAnimationTransition({
      address: { slideId: slide.slideId, stepIndex: 2 },
      slide,
      slideAnimationPlan: plan,
      state: duplicate.state
    });

    expect(duplicate.state).toBe(first.state);
    expect(staleSettlement.state).toBe(first.state);
    expect(duplicate.decisions).toEqual([
      expect.objectContaining({
        name: "trigger_ignored",
        reason: "STALE_SPEECH_SEQUENCE"
      })
    ]);
    expect(staleSettlement.decisions).toEqual([
      expect.objectContaining({
        name: "transition_settle_rejected",
        reason: "SETTLE_ADDRESS_MISMATCH"
      })
    ]);
  });

  it("records missing actions without mutating playback state", () => {
    const slide = createRuntimeSlide();
    const plan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide)
    });
    const initial = createSpeechAnimationRuntimeState({
      slideId: slide.slideId
    });
    const update = enqueueSpeechAnimationTriggers({
      sequence: 1,
      slide,
      slideAnimationPlan: plan,
      state: initial,
      triggerTraceId: "speech:item-missing:0",
      triggers: [{ kind: "keyword", keywordId: "kw_missing" }]
    });

    expect(update.state.playbackState).toBe(initial.playbackState);
    expect(update.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "action_rejected",
          outcome: "rejected",
          reason: "ACTION_NOT_FOUND",
          triggerTraceId: "speech:item-missing:0"
        })
      ])
    );
  });
});

function createRuntimeSlide(includeTerminalAction = false): Slide {
  const occurrenceId = "kwo_slide_runtime_kw_occurrence_20_24";
  return {
    kind: "content",
    slideId: "slide_runtime",
    order: 0,
    title: "Runtime",
    thumbnailUrl: "",
    speakerNotes: "first keyword then occurrence",
    style: {},
    semanticCues: [],
    elements: [],
    keywords: [
      {
        keywordId: "kw_first",
        text: "first",
        synonyms: [],
        abbreviations: [],
        required: true
      },
      {
        keywordId: "kw_second",
        text: "second",
        synonyms: [],
        abbreviations: [],
        required: true
      },
      {
        keywordId: "kw_occurrence",
        text: "then",
        synonyms: [],
        abbreviations: [],
        required: true
      }
    ],
    animations: [
      {
        animationId: "anim_first",
        elementId: "el_first",
        type: "fade-in",
        order: 1,
        startMode: "on-click",
        durationMs: 100,
        delayMs: 0,
        easing: "linear"
      },
      {
        animationId: "anim_second",
        elementId: "el_second",
        type: "fade-in",
        order: 2,
        startMode: "on-click",
        durationMs: 100,
        delayMs: 0,
        easing: "linear"
      }
    ],
    actions: [
      {
        actionId: "act_first",
        trigger: { kind: "keyword", keywordId: "kw_first" },
        effect: { kind: "play-animation", animationId: "anim_first" }
      },
      {
        actionId: "act_second",
        trigger: { kind: "keyword", keywordId: "kw_second" },
        effect: { kind: "play-animation", animationId: "anim_second" }
      },
      {
        actionId: "act_occurrence",
        trigger: {
          kind: "keyword-occurrence",
          keywordId: "kw_occurrence",
          occurrenceId
        },
        effect: { kind: "play-animation", animationId: "anim_second" }
      },
      ...(includeTerminalAction
        ? [
            {
              actionId: "act_terminal",
              trigger: {
                kind: "keyword-occurrence" as const,
                keywordId: "kw_occurrence",
                occurrenceId
              },
              effect: { kind: "go-to-next-slide" as const }
            }
          ]
        : [])
    ],
    aiNotes: {
      emphasisPoints: [],
      sourceEvidence: []
    }
  };
}
