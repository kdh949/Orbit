import type { SlidePlaybackState } from "@orbit/editor-core";
import type { Slide } from "@orbit/shared";

import {
  resolveKeywordOccurrenceTriggeredActions,
  resolveQueuedKeywordOccurrencePlayback,
  type QueuedKeywordOccurrencePlaybackUpdate,
} from "../playback/triggeredActionPlayback";
import type { SlideshowAnimationPlan } from "../presenter/slideshowStepModel";
import {
  findFutureKeywordOccurrenceMatches,
  getExpectedKeywordOccurrenceStep,
  matchExpectedKeywordOccurrenceStep,
  type ExpectedKeywordOccurrenceResolution,
} from "./keywordOccurrenceStepResolver";
import {
  matchKeywordOccurrenceTriggers,
  type KeywordOccurrenceRuntimeMatch,
} from "./keywordOccurrenceRuntime";

export type KeywordOccurrencePlaybackDispatch = {
  expectedStepOccurrenceIds: string[];
  matches: Array<{ keywordId: string; occurrenceId: string; text: string }>;
  positionedMatches: KeywordOccurrenceRuntimeMatch[];
  queuedPlayback: QueuedKeywordOccurrencePlaybackUpdate;
  resolution: ExpectedKeywordOccurrenceResolution;
};

/**
 * Resolves exactly one non-stale STT increment against the current slideshow
 * state. Runtime owners apply the returned state themselves so this function
 * remains reusable by presentation and both rehearsal modes.
 */
export function dispatchKeywordOccurrencePlayback(args: {
  allowAutomaticPlayback?: boolean;
  confidence?: number | null;
  consumedOccurrenceIds: readonly string[];
  latestTranscript: string;
  newSegment: string;
  pendingOccurrenceIds: readonly string[];
  playbackState: SlidePlaybackState;
  previousTranscript: string;
  presenterStepIndex: number;
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  transcript: string;
}): KeywordOccurrencePlaybackDispatch {
  const expectedStep = getExpectedKeywordOccurrenceStep({
    presenterStepIndex: args.presenterStepIndex,
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan,
  });
  if (args.allowAutomaticPlayback === false) {
    return {
      expectedStepOccurrenceIds: expectedStep?.occurrenceIds ?? [],
      matches: [],
      positionedMatches: [],
      queuedPlayback: {
        consumedOccurrenceIds: [],
        pendingOccurrenceIds: [...args.pendingOccurrenceIds],
        update: null,
      },
      resolution: {
        blocker: "evidence-pending",
        candidates: [],
        expectedStep,
        matches: [],
      },
    };
  }
  const targetOccurrenceIds = args.slide.actions.flatMap((action) =>
    action.trigger.kind === "keyword-occurrence"
      ? [action.trigger.occurrenceId]
      : [],
  );
  const positionedMatches = matchKeywordOccurrenceTriggers({
    confidence: args.confidence,
    confirmedOccurrenceIds: args.consumedOccurrenceIds,
    latestTranscript: args.latestTranscript,
    previousTranscript: args.previousTranscript,
    slide: args.slide,
    targetOccurrenceIds,
    transcript: args.transcript,
  });
  const positionedOccurrenceIds = positionedMatches.map(
    (match) => match.occurrenceId,
  );
  const resolution = matchExpectedKeywordOccurrenceStep({
    allowedOccurrenceIds: positionedOccurrenceIds,
    confidence: args.confidence,
    consumedOccurrenceIds: args.consumedOccurrenceIds,
    expectedStep,
    newSegment: args.latestTranscript,
    slide: args.slide,
  });
  const matches = [
    ...resolution.matches,
    ...findFutureKeywordOccurrenceMatches({
      allowedOccurrenceIds: positionedOccurrenceIds,
      confidence: args.confidence,
      consumedOccurrenceIds: args.consumedOccurrenceIds,
      newSegment: args.latestTranscript,
      presenterStepIndex: args.presenterStepIndex,
      slide: args.slide,
      slideAnimationPlan: args.slideAnimationPlan,
    }),
  ];
  const uniqueMatches = Array.from(
    new Map(matches.map((match) => [match.occurrenceId, match])).values(),
  );
  const actionsByOccurrenceId = new Map<string, Slide["actions"]>();
  for (const match of uniqueMatches) {
    actionsByOccurrenceId.set(
      match.occurrenceId,
      resolveKeywordOccurrenceTriggeredActions(
        args.slide,
        match.keywordId,
        match.occurrenceId,
      ),
    );
  }

  return {
    expectedStepOccurrenceIds: expectedStep?.occurrenceIds ?? [],
    matches: uniqueMatches,
    positionedMatches,
    queuedPlayback: resolveQueuedKeywordOccurrencePlayback({
      actionsByOccurrenceId,
      matchedOccurrenceIds: uniqueMatches.map((match) => match.occurrenceId),
      pendingOccurrenceIds: args.pendingOccurrenceIds,
      playbackState: args.playbackState,
      presenterStepIndex: args.presenterStepIndex,
      slide: args.slide,
      slideAnimationPlan: args.slideAnimationPlan,
    }),
    resolution,
  };
}
