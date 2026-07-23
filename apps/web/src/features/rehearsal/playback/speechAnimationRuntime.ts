import type { DeckSlideAction, Slide } from "@orbit/shared";
import type { SlidePlaybackState } from "@orbit/editor-core";

import type { SlideshowTransitionAddress } from "../presenter/useSlideshowTransitions";
import type { SlideshowAnimationPlan } from "../presenter/slideshowStepModel";
import {
  resolveCueTriggeredActions,
  resolveKeywordOccurrenceTriggeredActions,
  resolveKeywordTriggeredActions,
  resolveManualAnimationPlaybackUpdate,
  resolveTriggeredActionPlaybackUpdate,
  restoreSlidePlaybackAtStep
} from "./triggeredActionPlayback";

export type SpeechAnimationTrigger =
  | { kind: "keyword-occurrence"; keywordId: string; occurrenceId: string }
  | { kind: "keyword"; keywordId: string }
  | { kind: "cue"; cue: string; eventKey: string };

export type SpeechAnimationIntent = {
  action: DeckSlideAction;
  intentId: string;
  occurrenceId?: string;
  requiredStepIndex: number;
  triggerKey: string;
};

export type SpeechAnimationRuntimeState = {
  confirmedOccurrenceIds: string[];
  lastSpeechSequence: number;
  pendingIntents: SpeechAnimationIntent[];
  playbackState: SlidePlaybackState;
  presenterStepIndex: number;
  recognizedTriggerKeys: string[];
  slideId: string;
  transition: SlideshowTransitionAddress | null;
};

export type SpeechAnimationRuntimeUpdate = {
  consumedOccurrenceIds: string[];
  pendingOccurrenceIds: string[];
  shouldAdvanceSlide: boolean;
  state: SpeechAnimationRuntimeState;
};

export function createSpeechAnimationRuntimeState(args: {
  playbackState?: SlidePlaybackState;
  presenterStepIndex?: number;
  slideId: string;
}): SpeechAnimationRuntimeState {
  return {
    confirmedOccurrenceIds: [],
    lastSpeechSequence: 0,
    pendingIntents: [],
    playbackState: args.playbackState ?? { playedAnimationIds: [] },
    presenterStepIndex: args.presenterStepIndex ?? 0,
    recognizedTriggerKeys: [],
    slideId: args.slideId,
    transition: null
  };
}

export function enqueueSpeechAnimationTriggers(args: {
  sequence: number;
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  state: SpeechAnimationRuntimeState;
  triggers: readonly SpeechAnimationTrigger[];
}): SpeechAnimationRuntimeUpdate {
  if (
    args.state.slideId !== args.slide.slideId ||
    args.sequence <= args.state.lastSpeechSequence
  ) {
    return unchanged(args.state);
  }

  const recognizedTriggerKeys = new Set(args.state.recognizedTriggerKeys);
  const pendingIntents = new Map(
    args.state.pendingIntents.map((intent) => [intent.intentId, intent])
  );

  for (const trigger of args.triggers) {
    const triggerKey = getSpeechAnimationTriggerKey(trigger);
    if (recognizedTriggerKeys.has(triggerKey)) {
      continue;
    }
    recognizedTriggerKeys.add(triggerKey);

    for (const action of resolveTriggerActions(args.slide, trigger)) {
      const requiredStepIndex = getActionRequiredStepIndex(
        action,
        args.slideAnimationPlan
      );
      if (
        requiredStepIndex === null ||
        requiredStepIndex < args.state.presenterStepIndex
      ) {
        continue;
      }
      const intent: SpeechAnimationIntent = {
        action,
        intentId: `${triggerKey}:${action.actionId}`,
        ...(trigger.kind === "keyword-occurrence"
          ? { occurrenceId: trigger.occurrenceId }
          : {}),
        requiredStepIndex,
        triggerKey
      };
      pendingIntents.set(intent.intentId, intent);
    }
  }

  return drainSpeechAnimationRuntime({
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan,
    state: {
      ...args.state,
      lastSpeechSequence: args.sequence,
      pendingIntents: [...pendingIntents.values()],
      recognizedTriggerKeys: [...recognizedTriggerKeys]
    }
  });
}

export function settleSpeechAnimationTransition(args: {
  address: SlideshowTransitionAddress;
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  state: SpeechAnimationRuntimeState;
}): SpeechAnimationRuntimeUpdate {
  if (
    args.state.transition?.slideId !== args.address.slideId ||
    args.state.transition.stepIndex !== args.address.stepIndex
  ) {
    return unchanged(args.state);
  }

  return drainSpeechAnimationRuntime({
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan,
    state: { ...args.state, transition: null }
  });
}

export function advanceSpeechAnimationManually(args: {
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  state: SpeechAnimationRuntimeState;
}): SpeechAnimationRuntimeUpdate {
  if (
    args.state.slideId !== args.slide.slideId ||
    args.state.transition !== null
  ) {
    return unchanged(args.state);
  }

  const currentStepIndex = args.state.presenterStepIndex;
  const playbackUpdate = resolveManualAnimationPlaybackUpdate({
    playbackState: args.state.playbackState,
    presenterStepIndex: currentStepIndex,
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan
  });
  const executedIntents = args.state.pendingIntents.filter(
    (intent) => intent.requiredStepIndex === currentStepIndex
  );
  const pendingIntents = args.state.pendingIntents.filter(
    (intent) => intent.requiredStepIndex !== currentStepIndex
  );

  return finalizeUpdate({
    executedIntents,
    pendingIntents,
    playbackState: playbackUpdate.playbackState,
    presenterStepIndex: playbackUpdate.presenterStepIndex,
    shouldAdvanceSlide: playbackUpdate.shouldAdvanceSlide,
    state: args.state
  });
}

export function restoreSpeechAnimationRuntimeAtStep(args: {
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  stepIndex: number;
}): SpeechAnimationRuntimeState {
  const restored = restoreSlidePlaybackAtStep(args);
  return {
    ...createSpeechAnimationRuntimeState({
      playbackState: restored.playbackState,
      presenterStepIndex: restored.presenterStepIndex,
      slideId: args.slide.slideId
    }),
    confirmedOccurrenceIds: restored.consumedOccurrenceIds,
    recognizedTriggerKeys: restored.consumedOccurrenceIds.map(
      (occurrenceId) => `keyword-occurrence:${occurrenceId}`
    )
  };
}

function drainSpeechAnimationRuntime(args: {
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  state: SpeechAnimationRuntimeState;
}): SpeechAnimationRuntimeUpdate {
  if (args.state.transition !== null) {
    return unchanged(args.state);
  }

  const executableIntents = args.state.pendingIntents.filter(
    (intent) => intent.requiredStepIndex === args.state.presenterStepIndex
  );
  if (executableIntents.length === 0) {
    return unchanged(args.state);
  }

  const playbackUpdate = resolveTriggeredActionPlaybackUpdate({
    actions: executableIntents.map((intent) => intent.action),
    playbackState: args.state.playbackState,
    presenterStepIndex: args.state.presenterStepIndex,
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan
  });
  const executedIntentIds = new Set(
    executableIntents.map((intent) => intent.intentId)
  );

  return finalizeUpdate({
    executedIntents: executableIntents,
    pendingIntents: args.state.pendingIntents.filter(
      (intent) => !executedIntentIds.has(intent.intentId)
    ),
    playbackState: playbackUpdate.playbackState,
    presenterStepIndex: playbackUpdate.presenterStepIndex,
    shouldAdvanceSlide: playbackUpdate.shouldAdvanceSlide,
    state: args.state
  });
}

function finalizeUpdate(args: {
  executedIntents: readonly SpeechAnimationIntent[];
  pendingIntents: SpeechAnimationIntent[];
  playbackState: SlidePlaybackState;
  presenterStepIndex: number;
  shouldAdvanceSlide: boolean;
  state: SpeechAnimationRuntimeState;
}): SpeechAnimationRuntimeUpdate {
  const pendingOccurrenceIds = getPendingOccurrenceIds(args.pendingIntents);
  const pendingOccurrenceIdSet = new Set(pendingOccurrenceIds);
  const consumedOccurrenceIds = Array.from(
    new Set(
      args.executedIntents.flatMap((intent) =>
        intent.occurrenceId && !pendingOccurrenceIdSet.has(intent.occurrenceId)
          ? [intent.occurrenceId]
          : []
      )
    )
  );
  const confirmedOccurrenceIds = Array.from(
    new Set([
      ...args.state.confirmedOccurrenceIds,
      ...consumedOccurrenceIds
    ])
  );
  const didAdvanceStep =
    args.presenterStepIndex !== args.state.presenterStepIndex &&
    !args.shouldAdvanceSlide;
  const state: SpeechAnimationRuntimeState = {
    ...args.state,
    confirmedOccurrenceIds,
    pendingIntents: args.pendingIntents,
    playbackState: args.playbackState,
    presenterStepIndex: args.presenterStepIndex,
    transition: didAdvanceStep
      ? {
          slideId: args.state.slideId,
          stepIndex: args.presenterStepIndex
        }
      : null
  };

  return {
    consumedOccurrenceIds,
    pendingOccurrenceIds,
    shouldAdvanceSlide: args.shouldAdvanceSlide,
    state
  };
}

function resolveTriggerActions(
  slide: Slide,
  trigger: SpeechAnimationTrigger
) {
  switch (trigger.kind) {
    case "keyword-occurrence":
      return resolveKeywordOccurrenceTriggeredActions(
        slide,
        trigger.keywordId,
        trigger.occurrenceId
      );
    case "keyword":
      return resolveKeywordTriggeredActions(slide, trigger.keywordId);
    case "cue":
      return resolveCueTriggeredActions(slide, trigger.cue);
  }
}

function getSpeechAnimationTriggerKey(trigger: SpeechAnimationTrigger) {
  switch (trigger.kind) {
    case "keyword-occurrence":
      return `keyword-occurrence:${trigger.occurrenceId}`;
    case "keyword":
      return `keyword:${trigger.keywordId}`;
    case "cue":
      return `cue:${trigger.cue}:${trigger.eventKey}`;
  }
}

function getActionRequiredStepIndex(
  action: DeckSlideAction,
  slideAnimationPlan: SlideshowAnimationPlan
) {
  if (action.effect.kind === "go-to-next-slide") {
    return slideAnimationPlan.maxStepIndex;
  }

  const animationId = action.effect.animationId;
  const stepIndex = slideAnimationPlan.triggerSteps.findIndex((step) =>
    step.animations.some(
      (animation) => animation.animationId === animationId
    )
  );
  return stepIndex >= 0 ? stepIndex : null;
}

function getPendingOccurrenceIds(intents: readonly SpeechAnimationIntent[]) {
  return Array.from(
    new Set(
      intents.flatMap((intent) =>
        intent.occurrenceId ? [intent.occurrenceId] : []
      )
    )
  );
}

function unchanged(
  state: SpeechAnimationRuntimeState
): SpeechAnimationRuntimeUpdate {
  return {
    consumedOccurrenceIds: [],
    pendingOccurrenceIds: getPendingOccurrenceIds(state.pendingIntents),
    shouldAdvanceSlide: false,
    state
  };
}
