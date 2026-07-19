import type {
  DeckAnimation,
  DeckAnimationStartMode
} from "@orbit/shared";

export const animationTimelineDiagnosticLimit = 100;

export type AnimationStartMode = DeckAnimationStartMode;

export type TimelineAnimationInput = DeckAnimation & {
  startMode?: AnimationStartMode;
};

export type AnimationTimelineDiagnostic = {
  animationId: string;
  code: "missing-target" | "orphan-after-previous";
};

export type AnimationTimelineBaseReference =
  | { kind: "slide-entry"; timeMs: 0 }
  | { kind: "click"; timeMs: 0 }
  | { kind: "transition-end"; timeMs: number }
  | {
      animationId: string;
      kind: "animation-end";
      timeMs: number;
    };

export type PlannedAnimationTimelineEffect = TimelineAnimationInput & {
  baseReference: AnimationTimelineBaseReference;
  endMs: number;
  hasTargetElement: boolean;
  rootAnimationId: string;
  rootKind: "slide-entry" | "click";
  sourceIndex: number;
  startMode: AnimationStartMode;
  startMs: number;
};

export type AnimationTimelineRoot = {
  durationMs: number;
  effects: PlannedAnimationTimelineEffect[];
  kind: "slide-entry" | "click";
  rootAnimationId: string;
  stepIndex: number;
};

export type AnimationTimelinePlan = {
  clickSteps: AnimationTimelineRoot[];
  diagnostics: AnimationTimelineDiagnostic[];
  diagnosticsTruncatedCount: number;
  effects: PlannedAnimationTimelineEffect[];
  entryDurationMs: number;
  entryRoots: AnimationTimelineRoot[];
  totalDurationMs: number;
};

export function createAnimationTimeline(input: {
  animations: readonly TimelineAnimationInput[];
  legacyOnClickAnimationIds?: Iterable<string>;
  targetElementIds?: Iterable<string>;
  transitionDurationMs?: number;
}): AnimationTimelinePlan {
  const transitionDurationMs = toSafeMilliseconds(
    input.transitionDurationMs ?? 0
  );
  const targetElementIds = input.targetElementIds
    ? new Set(input.targetElementIds)
    : null;
  const legacyOnClickAnimationIds = new Set(
    input.legacyOnClickAnimationIds ?? []
  );
  const sortedAnimations = input.animations
    .map((animation, sourceIndex) => ({ animation, sourceIndex }))
    .sort(compareTimelineSourceAnimations);
  const legacyModes = inferLegacyStartModes(
    sortedAnimations,
    legacyOnClickAnimationIds
  );
  const diagnostics: AnimationTimelineDiagnostic[] = [];
  let diagnosticsTruncatedCount = 0;
  const roots: AnimationTimelineRoot[] = [];
  let clickStepCount = 0;
  let currentRoot: AnimationTimelineRoot | null = null;
  let previousEffect: PlannedAnimationTimelineEffect | null = null;

  const addDiagnostic = (diagnostic: AnimationTimelineDiagnostic) => {
    if (diagnostics.length < animationTimelineDiagnosticLimit) {
      diagnostics.push(diagnostic);
      return;
    }

    diagnosticsTruncatedCount += 1;
  };

  for (const { animation, sourceIndex } of sortedAnimations) {
    const startMode = isAnimationStartMode(animation.startMode)
      ? animation.startMode
      : legacyModes.get(sourceIndex) ?? "on-slide-enter";
    const startsRoot = startMode === "on-slide-enter" || startMode === "on-click";

    if (startsRoot || !currentRoot) {
      const kind = startMode === "on-click" ? "click" : "slide-entry";
      if (kind === "click") {
        clickStepCount += 1;
      }
      currentRoot = {
        durationMs: 0,
        effects: [],
        kind,
        rootAnimationId: animation.animationId,
        stepIndex: kind === "click" ? clickStepCount : 0
      };
      roots.push(currentRoot);
      previousEffect = null;
    }

    let baseReference: AnimationTimelineBaseReference;

    switch (startMode) {
      case "on-slide-enter":
        baseReference = { kind: "slide-entry", timeMs: 0 };
        break;
      case "on-click":
        baseReference = { kind: "click", timeMs: 0 };
        break;
      case "with-previous":
        baseReference = previousEffect?.baseReference ?? {
          kind: "slide-entry",
          timeMs: 0
        };
        break;
      case "after-previous":
        if (previousEffect) {
          baseReference = {
            animationId: previousEffect.animationId,
            kind: "animation-end",
            timeMs: previousEffect.endMs
          };
        } else {
          baseReference = {
            kind: "transition-end",
            timeMs: transitionDurationMs
          };
          addDiagnostic({
            animationId: animation.animationId,
            code: "orphan-after-previous"
          });
        }
        break;
    }

    const hasTargetElement =
      targetElementIds === null || targetElementIds.has(animation.elementId);

    if (!hasTargetElement) {
      addDiagnostic({
        animationId: animation.animationId,
        code: "missing-target"
      });
    }

    const startMs = baseReference.timeMs + toSafeMilliseconds(animation.delayMs);
    const endMs = startMs + Math.max(1, toSafeMilliseconds(animation.durationMs));
    const effect: PlannedAnimationTimelineEffect = {
      ...animation,
      baseReference,
      endMs,
      hasTargetElement,
      rootAnimationId: currentRoot.rootAnimationId,
      rootKind: currentRoot.kind,
      sourceIndex,
      startMode,
      startMs
    };

    currentRoot.effects.push(effect);
    currentRoot.durationMs = Math.max(currentRoot.durationMs, endMs);
    previousEffect = effect;
  }

  const entryRoots = roots.filter((root) => root.kind === "slide-entry");
  const clickSteps = roots.filter((root) => root.kind === "click");
  const entryDurationMs = Math.max(
    0,
    ...entryRoots.map((root) => root.durationMs)
  );

  return {
    clickSteps,
    diagnostics,
    diagnosticsTruncatedCount,
    effects: roots.flatMap((root) => root.effects),
    entryDurationMs,
    entryRoots,
    totalDurationMs:
      entryDurationMs +
      clickSteps.reduce((total, root) => total + root.durationMs, 0)
  };
}

export function getAnimationTimelineRoot(
  plan: AnimationTimelinePlan,
  animationId: string
) {
  return (
    [...plan.entryRoots, ...plan.clickSteps].find((root) =>
      root.effects.some((effect) => effect.animationId === animationId)
    ) ?? null
  );
}

function inferLegacyStartModes(
  animations: Array<{
    animation: TimelineAnimationInput;
    sourceIndex: number;
  }>,
  legacyOnClickAnimationIds: Set<string>
) {
  const modes = new Map<number, AnimationStartMode>();
  const groups = new Map<number, typeof animations>();

  for (const item of animations) {
    const group = groups.get(item.animation.order) ?? [];
    group.push(item);
    groups.set(item.animation.order, group);
  }

  for (const group of groups.values()) {
    const isClickGroup = group.some(({ animation }) =>
      legacyOnClickAnimationIds.has(animation.animationId)
    );

    group.forEach(({ animation, sourceIndex }, groupIndex) => {
      if (isAnimationStartMode(animation.startMode)) {
        return;
      }

      modes.set(
        sourceIndex,
        groupIndex === 0
          ? isClickGroup
            ? "on-click"
            : "on-slide-enter"
          : "with-previous"
      );
    });
  }

  return modes;
}

function compareTimelineSourceAnimations(
  left: { animation: TimelineAnimationInput; sourceIndex: number },
  right: { animation: TimelineAnimationInput; sourceIndex: number }
) {
  if (left.animation.order !== right.animation.order) {
    return left.animation.order - right.animation.order;
  }

  if (left.sourceIndex !== right.sourceIndex) {
    return left.sourceIndex - right.sourceIndex;
  }

  return left.animation.animationId.localeCompare(right.animation.animationId);
}

function isAnimationStartMode(value: unknown): value is AnimationStartMode {
  return (
    value === "on-slide-enter" ||
    value === "on-click" ||
    value === "with-previous" ||
    value === "after-previous"
  );
}

function toSafeMilliseconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
