import type { DeckElement, Slide } from "@orbit/shared";

export type MorphElementFrame = Pick<
  DeckElement,
  "x" | "y" | "width" | "height" | "rotation"
>;

export type MorphElementPair = {
  matchKey: string;
  sourceElementId: string;
  destinationElementId: string;
  sourceFrame: MorphElementFrame;
  destinationFrame: MorphElementFrame;
};

export type MorphTransitionDiagnostic = {
  code: "duplicate-source-match-key" | "duplicate-destination-match-key";
  matchKey: string;
};

export type MorphTransitionPlan = {
  pairs: MorphElementPair[];
  sourceUnmatchedElementIds: string[];
  destinationUnmatchedElementIds: string[];
  diagnostics: MorphTransitionDiagnostic[];
};

export type MorphPresentationFrames = {
  source: Record<string, MorphElementFrame>;
  destination: Record<string, MorphElementFrame>;
  progress: number;
  easedProgress: number;
};

export function getMorphMatchKey(element: DeckElement): string {
  return element.morphKey ?? element.elementId;
}

export function isMorphGeometryEligible(element: DeckElement): boolean {
  return (
    element.visible &&
    element.role !== "background" &&
    element.type !== "activity-qr" &&
    element.type !== "chart" &&
    element.type !== "group"
  );
}

export function createMorphTransitionPlan(
  sourceSlide: Slide,
  destinationSlide: Slide
): MorphTransitionPlan {
  const diagnostics: MorphTransitionDiagnostic[] = [];
  const sourceByMatchKey = collectEligibleElements(
    sourceSlide,
    "source",
    diagnostics
  );
  const destinationByMatchKey = collectEligibleElements(
    destinationSlide,
    "destination",
    diagnostics
  );
  const pairs: MorphElementPair[] = [];
  const pairedSourceIds = new Set<string>();
  const pairedDestinationIds = new Set<string>();

  for (const [matchKey, sourceElement] of sourceByMatchKey) {
    const destinationElement = destinationByMatchKey.get(matchKey);
    if (!destinationElement) continue;

    pairs.push({
      matchKey,
      sourceElementId: sourceElement.elementId,
      destinationElementId: destinationElement.elementId,
      sourceFrame: elementFrame(sourceElement),
      destinationFrame: elementFrame(destinationElement)
    });
    pairedSourceIds.add(sourceElement.elementId);
    pairedDestinationIds.add(destinationElement.elementId);
  }

  return {
    pairs,
    sourceUnmatchedElementIds: sourceSlide.elements
      .filter((element) => !pairedSourceIds.has(element.elementId))
      .map((element) => element.elementId),
    destinationUnmatchedElementIds: destinationSlide.elements
      .filter((element) => !pairedDestinationIds.has(element.elementId))
      .map((element) => element.elementId),
    diagnostics
  };
}

export function interpolateMorphFrames(
  plan: MorphTransitionPlan,
  progressInput: number
): MorphPresentationFrames {
  const progress = clamp(progressInput, 0, 1);
  const easedProgress = easeInOutCubic(progress);
  const source: Record<string, MorphElementFrame> = {};
  const destination: Record<string, MorphElementFrame> = {};

  for (const pair of plan.pairs) {
    const frame = interpolateFrame(
      pair.sourceFrame,
      pair.destinationFrame,
      easedProgress,
      progress
    );
    source[pair.sourceElementId] = frame;
    destination[pair.destinationElementId] = frame;
  }

  return { source, destination, progress, easedProgress };
}

export function easeInOutCubic(progress: number): number {
  const value = clamp(progress, 0, 1);
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function collectEligibleElements(
  slide: Slide,
  side: "source" | "destination",
  diagnostics: MorphTransitionDiagnostic[]
): Map<string, DeckElement> {
  const elementsByMatchKey = new Map<string, DeckElement>();
  const duplicateKeys = new Set<string>();

  for (const element of slide.elements) {
    if (!isMorphGeometryEligible(element)) continue;
    const matchKey = getMorphMatchKey(element);
    if (elementsByMatchKey.has(matchKey)) {
      duplicateKeys.add(matchKey);
      elementsByMatchKey.delete(matchKey);
      continue;
    }
    if (!duplicateKeys.has(matchKey)) {
      elementsByMatchKey.set(matchKey, element);
    }
  }

  for (const matchKey of duplicateKeys) {
    diagnostics.push({
      code:
        side === "source"
          ? "duplicate-source-match-key"
          : "duplicate-destination-match-key",
      matchKey
    });
  }

  return elementsByMatchKey;
}

function elementFrame(element: DeckElement): MorphElementFrame {
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation
  };
}

function interpolateFrame(
  source: MorphElementFrame,
  destination: MorphElementFrame,
  easedProgress: number,
  linearProgress: number
): MorphElementFrame {
  if (linearProgress <= 0) return { ...source };
  if (linearProgress >= 1) return { ...destination };

  const rotationDelta = shortestRotationDelta(
    source.rotation,
    destination.rotation
  );
  return {
    x: lerp(source.x, destination.x, easedProgress),
    y: lerp(source.y, destination.y, easedProgress),
    width: lerp(source.width, destination.width, easedProgress),
    height: lerp(source.height, destination.height, easedProgress),
    rotation: source.rotation + rotationDelta * easedProgress
  };
}

function shortestRotationDelta(source: number, destination: number): number {
  return ((((destination - source) % 360) + 540) % 360) - 180;
}

function lerp(source: number, destination: number, progress: number): number {
  return source + (destination - source) * progress;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
