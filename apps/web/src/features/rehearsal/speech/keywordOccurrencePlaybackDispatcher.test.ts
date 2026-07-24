import { describe, expect, it } from "vitest";
import { deriveKeywordOccurrences, type Slide } from "@orbit/shared";

import { dispatchKeywordOccurrencePlayback } from "./keywordOccurrencePlaybackDispatcher";

const slide = {
  actions: [
    { actionId: "a", trigger: { kind: "keyword-occurrence", keywordId: "a", occurrenceId: "kwo_slide-1_a_0_2" }, effect: { kind: "play-animation", animationId: "anim-a" } },
    { actionId: "b", trigger: { kind: "keyword-occurrence", keywordId: "b", occurrenceId: "kwo_slide-1_b_6_8" }, effect: { kind: "play-animation", animationId: "anim-b" } },
  ],
  elements: [],
  animations: [
    { animationId: "anim-a", elementId: "el-a", type: "fade-in", order: 1, durationMs: 1, delayMs: 0, easing: "ease-out" },
    { animationId: "anim-b", elementId: "el-b", type: "fade-in", order: 2, durationMs: 1, delayMs: 0, easing: "ease-out" },
  ],
  keywords: [
    { keywordId: "a", text: "알파", synonyms: [], abbreviations: [], required: true },
    { keywordId: "b", text: "베타", synonyms: [], abbreviations: [], required: true },
    { keywordId: "c", text: "끝", synonyms: [], abbreviations: [], required: true },
  ],
  slideId: "slide-1",
  speakerNotes: "알파 다음 베타 끝",
} as unknown as Slide;

const plan = {
  maxStepIndex: 2,
  triggerSteps: [
    { animations: [{ animationId: "anim-a" }], durationMs: 1, order: 1, rootAnimationId: "anim-a" },
    { animations: [{ animationId: "anim-b" }], durationMs: 1, order: 2, rootAnimationId: "anim-b" },
  ],
} as never;

describe("keyword occurrence playback dispatcher", () => {
  it("executes each independent STT increment using the latest runtime step", () => {
    const first = dispatchKeywordOccurrencePlayback({
      confidence: 1,
      consumedOccurrenceIds: [],
      latestTranscript: "알파",
      newSegment: "알파",
      pendingOccurrenceIds: [],
      playbackState: { playedAnimationIds: [] },
      previousTranscript: "",
      presenterStepIndex: 0,
      slide,
      slideAnimationPlan: plan,
      transcript: "알파",
    });
    expect(first.queuedPlayback.update).toMatchObject({ presenterStepIndex: 1 });
    expect(first.queuedPlayback.consumedOccurrenceIds).toEqual(["kwo_slide-1_a_0_2"]);

    const second = dispatchKeywordOccurrencePlayback({
      confidence: 1,
      consumedOccurrenceIds: first.queuedPlayback.consumedOccurrenceIds,
      latestTranscript: "베타",
      newSegment: "베타",
      pendingOccurrenceIds: first.queuedPlayback.pendingOccurrenceIds,
      playbackState: first.queuedPlayback.update!.playbackState,
      previousTranscript: "알파",
      presenterStepIndex: first.queuedPlayback.update!.presenterStepIndex,
      slide,
      slideAnimationPlan: plan,
      transcript: "알파 다음 베타",
    });
    expect(second.queuedPlayback.update).toMatchObject({ presenterStepIndex: 2 });
    expect(second.queuedPlayback.consumedOccurrenceIds).toEqual(["kwo_slide-1_b_6_8"]);
  });

  it("queues a future keyword without consuming it before its step", () => {
    const dispatched = dispatchKeywordOccurrencePlayback({
      confidence: 1,
      consumedOccurrenceIds: [],
      latestTranscript: "베타",
      newSegment: "베타",
      pendingOccurrenceIds: [],
      playbackState: { playedAnimationIds: [] },
      previousTranscript: "알파 다음",
      presenterStepIndex: 0,
      slide,
      slideAnimationPlan: plan,
      transcript: "알파 다음 베타",
    });
    expect(dispatched.queuedPlayback.update).toBeNull();
    expect(dispatched.queuedPlayback.pendingOccurrenceIds).toEqual(["kwo_slide-1_b_6_8"]);
  });

  it("uses the full STT revision for a keyword split across partial results", () => {
    const dispatched = dispatchKeywordOccurrencePlayback({
      confidence: 1,
      consumedOccurrenceIds: [],
      latestTranscript: "알파",
      newSegment: "파",
      pendingOccurrenceIds: [],
      playbackState: { playedAnimationIds: [] },
      previousTranscript: "알",
      presenterStepIndex: 0,
      slide,
      slideAnimationPlan: plan,
      transcript: "알파",
    });

    expect(dispatched.queuedPlayback.consumedOccurrenceIds).toEqual([
      "kwo_slide-1_a_0_2",
    ]);
    expect(dispatched.queuedPlayback.update).toMatchObject({ presenterStepIndex: 1 });
  });

  it("does not queue a later repeated occurrence when STT is still aligned to the first one", () => {
    const repeatedSlide = {
      actions: [],
      elements: [],
      animations: [
        { animationId: "anim-also", elementId: "el-also", type: "fade-in", order: 1, durationMs: 1, delayMs: 0, easing: "ease-out" },
        { animationId: "anim-activity", elementId: "el-activity", type: "fade-in", order: 2, durationMs: 1, delayMs: 0, easing: "ease-out" },
      ],
      keywords: [
        { keywordId: "also", text: "also", synonyms: [], abbreviations: [], required: true },
        { keywordId: "activity", text: "activity", synonyms: [], abbreviations: [], required: true },
      ],
      slideId: "slide-repeated",
      speakerNotes: "activity starts. also explains. activity continues.",
    } as unknown as Slide;
    const occurrences = deriveKeywordOccurrences(repeatedSlide);
    const alsoOccurrence = occurrences.find((occurrence) => occurrence.keywordId === "also")!;
    const laterActivityOccurrence = occurrences.filter(
      (occurrence) => occurrence.keywordId === "activity",
    )[1]!;
    repeatedSlide.actions = [
      { actionId: "also", trigger: { kind: "keyword-occurrence", keywordId: "also", occurrenceId: alsoOccurrence.occurrenceId }, effect: { kind: "play-animation", animationId: "anim-also" } },
      { actionId: "activity", trigger: { kind: "keyword-occurrence", keywordId: "activity", occurrenceId: laterActivityOccurrence.occurrenceId }, effect: { kind: "play-animation", animationId: "anim-activity" } },
    ];
    const repeatedPlan = {
      maxStepIndex: 2,
      triggerSteps: [
        { animations: [{ animationId: "anim-also" }], durationMs: 1, order: 1, rootAnimationId: "anim-also" },
        { animations: [{ animationId: "anim-activity" }], durationMs: 1, order: 2, rootAnimationId: "anim-activity" },
      ],
    } as never;

    const dispatched = dispatchKeywordOccurrencePlayback({
      confidence: 1,
      consumedOccurrenceIds: [],
      latestTranscript: "activity starts",
      newSegment: "activity starts",
      pendingOccurrenceIds: [],
      playbackState: { playedAnimationIds: [] },
      previousTranscript: "",
      presenterStepIndex: 0,
      slide: repeatedSlide,
      slideAnimationPlan: repeatedPlan,
      transcript: "activity starts",
    });

    expect(dispatched.positionedMatches).toEqual([]);
    expect(dispatched.queuedPlayback.pendingOccurrenceIds).toEqual([]);
  });

  it("executes a terminal occurrence next-slide action", () => {
    const terminalSlide = {
      ...slide,
      actions: [
        ...slide.actions,
        {
          actionId: "next",
          effect: { kind: "go-to-next-slide" },
          trigger: { kind: "keyword-occurrence", keywordId: "c", occurrenceId: "kwo_slide-1_c_9_10" },
        },
      ],
    } as Slide;
    const dispatched = dispatchKeywordOccurrencePlayback({
      confidence: 1,
      consumedOccurrenceIds: ["kwo_slide-1_a_0_2", "kwo_slide-1_b_6_8"],
      latestTranscript: "끝",
      newSegment: "끝",
      pendingOccurrenceIds: [],
      playbackState: { playedAnimationIds: ["anim-a", "anim-b"] },
      previousTranscript: "",
      presenterStepIndex: 2,
      slide: terminalSlide,
      slideAnimationPlan: plan,
      transcript: "알파 다음 베타 끝",
    });

    expect(dispatched.queuedPlayback.consumedOccurrenceIds).toEqual(["kwo_slide-1_c_9_10"]);
    expect(dispatched.queuedPlayback.update?.shouldAdvanceSlide).toBe(true);
  });
});
