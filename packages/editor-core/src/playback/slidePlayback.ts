import type { DeckAnimation, DeckSlideAction, Slide } from "@orbit/shared";
import {
  createAnimationTimeline,
  getAnimationTimelineRoot
} from "./animationTimeline";

export type SlidePlaybackState = {
  playedAnimationIds: string[];
};

export type ClickPlaybackResult = {
  animation: DeckAnimation;
  animations: DeckAnimation[];
  state: SlidePlaybackState;
};

export type SlideActionExecutionResult =
  | {
      kind: "play-animation";
      action: DeckSlideAction;
      animation: DeckAnimation;
      animations: DeckAnimation[];
      state: SlidePlaybackState;
    }
  | {
      kind: "go-to-next-slide";
      action: DeckSlideAction;
      state: SlidePlaybackState;
    };

export function createSlidePlaybackState(): SlidePlaybackState {
  return {
    playedAnimationIds: []
  };
}

export function getNextClickAnimation(
  slide: Slide,
  state: SlidePlaybackState
): DeckAnimation | null {
  const root = getNextClickRoot(slide, state);
  const rootAnimation = root?.effects[0];
  return rootAnimation
    ? slide.animations[rootAnimation.sourceIndex] ?? null
    : null;
}

export function playNextClickAnimation(
  slide: Slide,
  state: SlidePlaybackState
): ClickPlaybackResult | null {
  const root = getNextClickRoot(slide, state);
  const animation = root?.effects[0];

  if (!root || !animation) {
    return null;
  }

  const animations = getRootSourceAnimations(slide, root);

  return {
    animation: animations[0]!,
    animations,
    state: markAnimationsPlayed(
      state,
      animations.map((candidate) => candidate.animationId)
    )
  };
}

export function resolveCueActions(
  slide: Slide,
  cue: string
): DeckSlideAction[] {
  return resolveTriggeredActions(slide, { cue });
}

export function resolveTriggeredActions(
  slide: Slide,
  trigger: {
    cue?: string;
    keywordId?: string;
    occurrenceId?: string;
  }
): DeckSlideAction[] {
  const normalizedCue = trigger.cue ? normalizeCue(trigger.cue) : "";

  if (!normalizedCue && !trigger.keywordId && !trigger.occurrenceId) {
    return [];
  }

  if (trigger.occurrenceId !== undefined) {
    return slide.actions.filter((action) => {
      return (
        action.trigger.kind === "keyword-occurrence" &&
        action.trigger.occurrenceId === trigger.occurrenceId &&
        (trigger.keywordId === undefined ||
          action.trigger.keywordId === trigger.keywordId)
      );
    });
  }

  return slide.actions.filter((action) => {
    if (
      normalizedCue &&
      action.trigger.kind === "cue" &&
      normalizeCue(action.trigger.cue) === normalizedCue
    ) {
      return true;
    }

    return (
      trigger.keywordId !== undefined &&
      action.trigger.kind === "keyword" &&
      action.trigger.keywordId === trigger.keywordId
    );
  });
}

export function executeSlideAction(
  slide: Slide,
  state: SlidePlaybackState,
  action: DeckSlideAction
): SlideActionExecutionResult | null {
  const { effect } = action;

  switch (effect.kind) {
    case "play-animation": {
      const { animationId } = effect;
      const animation = slide.animations.find(
        (candidate) => candidate.animationId === animationId
      );

      if (!animation || hasPlayedAnimation(state, animation.animationId)) {
        return null;
      }

      const plan = createSlideAnimationTimeline(slide);
      const root = getAnimationTimelineRoot(plan, animation.animationId);
      const animations = root
        ? getRootSourceAnimations(slide, root)
        : [animation];

      if (
        animations.some((candidate) =>
          hasPlayedAnimation(state, candidate.animationId)
        )
      ) {
        return null;
      }

      return {
        kind: "play-animation",
        action,
        animation,
        animations,
        state: markAnimationsPlayed(
          state,
          animations.map((candidate) => candidate.animationId)
        )
      };
    }

    case "go-to-next-slide":
      return {
        kind: "go-to-next-slide",
        action,
        state
      };
  }
}

function hasPlayedAnimation(
  state: SlidePlaybackState,
  animationId: string
): boolean {
  return state.playedAnimationIds.includes(animationId);
}

function markAnimationsPlayed(
  state: SlidePlaybackState,
  animationIds: Iterable<string>
): SlidePlaybackState {
  const playedAnimationIds = new Set(state.playedAnimationIds);
  let changed = false;

  for (const animationId of animationIds) {
    if (!playedAnimationIds.has(animationId)) {
      playedAnimationIds.add(animationId);
      changed = true;
    }
  }

  if (!changed) {
    return state;
  }

  return {
    playedAnimationIds: [...playedAnimationIds]
  };
}

function createSlideAnimationTimeline(slide: Slide) {
  return createAnimationTimeline({
    animations: slide.animations,
    legacyOnClickAnimationIds: slide.actions.flatMap((action) =>
      action.effect.kind === "play-animation"
        ? [action.effect.animationId]
        : []
    ),
    targetElementIds: slide.elements.map((element) => element.elementId),
    transitionDurationMs: slide.transition?.durationMs ?? 0
  });
}

function getNextClickRoot(slide: Slide, state: SlidePlaybackState) {
  const playedAnimationIds = new Set(state.playedAnimationIds);

  return (
    createSlideAnimationTimeline(slide).clickSteps.find((root) =>
      root.effects.every(
        (animation) => !playedAnimationIds.has(animation.animationId)
      )
    ) ?? null
  );
}

function getRootSourceAnimations(
  slide: Slide,
  root: NonNullable<ReturnType<typeof getAnimationTimelineRoot>>
) {
  return root.effects.flatMap((animation) => {
    const sourceAnimation = slide.animations[animation.sourceIndex];
    return sourceAnimation ? [sourceAnimation] : [];
  });
}

function normalizeCue(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}
