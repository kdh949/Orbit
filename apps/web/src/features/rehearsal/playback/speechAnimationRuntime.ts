import type { DeckSlideAction, Slide } from "@orbit/shared";
import type { SlidePlaybackState } from "@orbit/editor-core";
import type { DiagnosticOutcome } from "../../diagnostics/diagnosticTypes";

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
  triggerTraceId?: string;
  triggerKey: string;
};

export type SpeechAnimationRuntimeDecision = {
  name:
    | "trigger_received"
    | "trigger_ignored"
    | "action_resolved"
    | "action_rejected"
    | "intent_queued"
    | "intent_executed"
    | "queue_blocked"
    | "transition_settled"
    | "transition_settle_rejected";
  outcome: DiagnosticOutcome;
  reason?: string;
  triggerTraceId?: string;
  triggerKey?: string;
  actionId?: string;
  animationId?: string;
  occurrenceId?: string;
  currentStepIndex: number;
  requiredStepIndex?: number;
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
  decisions: SpeechAnimationRuntimeDecision[];
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
  triggerTraceId?: string;
  triggers: readonly SpeechAnimationTrigger[];
}): SpeechAnimationRuntimeUpdate {
  if (args.state.slideId !== args.slide.slideId) {
    return unchanged(args.state, [
      createDecision(args.state, {
        name: "trigger_ignored",
        outcome: "rejected",
        reason: "SLIDE_MISMATCH",
        triggerTraceId: args.triggerTraceId
      })
    ]);
  }
  if (args.sequence <= args.state.lastSpeechSequence) {
    return unchanged(args.state, [
      createDecision(args.state, {
        name: "trigger_ignored",
        outcome: "rejected",
        reason: "STALE_SPEECH_SEQUENCE",
        triggerTraceId: args.triggerTraceId
      })
    ]);
  }

  const recognizedTriggerKeys = new Set(args.state.recognizedTriggerKeys);
  const pendingIntents = new Map(
    args.state.pendingIntents.map((intent) => [intent.intentId, intent])
  );
  const decisions: SpeechAnimationRuntimeDecision[] = [];

  for (const trigger of args.triggers) {
    const triggerKey = getSpeechAnimationTriggerKey(trigger);
    decisions.push(
      createDecision(args.state, {
        name: "trigger_received",
        outcome: "received",
        triggerTraceId: args.triggerTraceId,
        triggerKey,
        occurrenceId:
          trigger.kind === "keyword-occurrence"
            ? trigger.occurrenceId
            : undefined
      })
    );
    if (recognizedTriggerKeys.has(triggerKey)) {
      decisions.push(
        createDecision(args.state, {
          name: "trigger_ignored",
          outcome: "rejected",
          reason: "DUPLICATE_TRIGGER_KEY",
          triggerTraceId: args.triggerTraceId,
          triggerKey
        })
      );
      continue;
    }
    recognizedTriggerKeys.add(triggerKey);

    const actions = resolveTriggerActions(args.slide, trigger);
    if (actions.length === 0) {
      decisions.push(
        createDecision(args.state, {
          name: "action_rejected",
          outcome: "rejected",
          reason: "ACTION_NOT_FOUND",
          triggerTraceId: args.triggerTraceId,
          triggerKey
        })
      );
    }
    for (const action of actions) {
      const requiredStepIndex = getActionRequiredStepIndex(
        action,
        args.slideAnimationPlan
      );
      decisions.push(
        createDecision(args.state, {
          name: "action_resolved",
          outcome: "accepted",
          triggerTraceId: args.triggerTraceId,
          triggerKey,
          actionId: action.actionId,
          animationId: getActionAnimationId(action),
          ...(requiredStepIndex === null ? {} : { requiredStepIndex })
        })
      );
      if (requiredStepIndex === null) {
        decisions.push(
          createDecision(args.state, {
            name: "action_rejected",
            outcome: "rejected",
            reason: "ANIMATION_NOT_IN_PLAN",
            triggerTraceId: args.triggerTraceId,
            triggerKey,
            actionId: action.actionId,
            animationId: getActionAnimationId(action)
          })
        );
        continue;
      }
      if (requiredStepIndex < args.state.presenterStepIndex) {
        decisions.push(
          createDecision(args.state, {
            name: "action_rejected",
            outcome: "rejected",
            reason: "REQUIRED_STEP_BEHIND_CURRENT",
            triggerTraceId: args.triggerTraceId,
            triggerKey,
            actionId: action.actionId,
            animationId: getActionAnimationId(action),
            requiredStepIndex
          })
        );
        continue;
      }
      const intent: SpeechAnimationIntent = {
        action,
        intentId: `${triggerKey}:${action.actionId}`,
        ...(trigger.kind === "keyword-occurrence"
          ? { occurrenceId: trigger.occurrenceId }
          : {}),
        requiredStepIndex,
        ...(args.triggerTraceId === undefined
          ? {}
          : { triggerTraceId: args.triggerTraceId }),
        triggerKey
      };
      pendingIntents.set(intent.intentId, intent);
      decisions.push(
        createDecision(args.state, {
          name: "intent_queued",
          outcome: "queued",
          ...(requiredStepIndex > args.state.presenterStepIndex
            ? { reason: "REQUIRED_STEP_AHEAD_CURRENT" }
            : {}),
          triggerTraceId: args.triggerTraceId,
          triggerKey,
          actionId: action.actionId,
          animationId: getActionAnimationId(action),
          occurrenceId: intent.occurrenceId,
          requiredStepIndex
        })
      );
    }
  }

  return drainSpeechAnimationRuntime({
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan,
    decisions,
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
    return unchanged(args.state, [
      createDecision(args.state, {
        name: "transition_settle_rejected",
        outcome: "rejected",
        reason: "SETTLE_ADDRESS_MISMATCH"
      })
    ]);
  }

  return drainSpeechAnimationRuntime({
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan,
    decisions: [
      createDecision(args.state, {
        name: "transition_settled",
        outcome: "settled"
      })
    ],
    state: { ...args.state, transition: null }
  });
}

export function advanceSpeechAnimationManually(args: {
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  state: SpeechAnimationRuntimeState;
}): SpeechAnimationRuntimeUpdate {
  if (args.state.slideId !== args.slide.slideId) {
    return unchanged(args.state, [
      createDecision(args.state, {
        name: "queue_blocked",
        outcome: "rejected",
        reason: "SLIDE_MISMATCH"
      })
    ]);
  }
  if (args.state.transition !== null) {
    return unchanged(args.state, [
      createDecision(args.state, {
        name: "queue_blocked",
        outcome: "queued",
        reason: "TRANSITION_IN_FLIGHT"
      })
    ]);
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
    decisions: executedIntents.map((intent) =>
      createIntentDecision(args.state, intent, "intent_executed", "accepted")
    ),
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
  decisions?: SpeechAnimationRuntimeDecision[];
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
  state: SpeechAnimationRuntimeState;
}): SpeechAnimationRuntimeUpdate {
  const decisions = [...(args.decisions ?? [])];
  if (args.state.transition !== null) {
    decisions.push(
      createDecision(args.state, {
        name: "queue_blocked",
        outcome: "queued",
        reason: "TRANSITION_IN_FLIGHT"
      })
    );
    return unchanged(args.state, decisions);
  }

  const executableIntents = args.state.pendingIntents.filter(
    (intent) => intent.requiredStepIndex === args.state.presenterStepIndex
  );
  if (executableIntents.length === 0) {
    if (args.state.pendingIntents.length > 0) {
      decisions.push(
        createDecision(args.state, {
          name: "queue_blocked",
          outcome: "queued",
          reason: "NO_EXECUTABLE_INTENT"
        })
      );
    }
    return unchanged(args.state, decisions);
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
    decisions: [
      ...decisions,
      ...executableIntents.map((intent) =>
        createIntentDecision(
          args.state,
          intent,
          "intent_executed",
          "accepted"
        )
      )
    ],
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
  decisions: SpeechAnimationRuntimeDecision[];
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
    decisions: args.decisions,
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
  state: SpeechAnimationRuntimeState,
  decisions: SpeechAnimationRuntimeDecision[] = []
): SpeechAnimationRuntimeUpdate {
  return {
    consumedOccurrenceIds: [],
    decisions,
    pendingOccurrenceIds: getPendingOccurrenceIds(state.pendingIntents),
    shouldAdvanceSlide: false,
    state
  };
}

function createIntentDecision(
  state: SpeechAnimationRuntimeState,
  intent: SpeechAnimationIntent,
  name: SpeechAnimationRuntimeDecision["name"],
  outcome: DiagnosticOutcome
) {
  return createDecision(state, {
    name,
    outcome,
    triggerTraceId: intent.triggerTraceId,
    triggerKey: intent.triggerKey,
    actionId: intent.action.actionId,
    animationId: getActionAnimationId(intent.action),
    occurrenceId: intent.occurrenceId,
    requiredStepIndex: intent.requiredStepIndex
  });
}

function createDecision(
  state: SpeechAnimationRuntimeState,
  input: Omit<SpeechAnimationRuntimeDecision, "currentStepIndex"> & {
    currentStepIndex?: number;
  }
): SpeechAnimationRuntimeDecision {
  return {
    ...input,
    currentStepIndex: input.currentStepIndex ?? state.presenterStepIndex
  };
}

function getActionAnimationId(action: DeckSlideAction) {
  return action.effect.kind === "play-animation"
    ? action.effect.animationId
    : undefined;
}
