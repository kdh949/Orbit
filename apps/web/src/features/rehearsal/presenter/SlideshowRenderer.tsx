import {
  createMorphTransitionPlan,
  interpolateMorphFrames,
  type MorphTransitionPlan
} from "@orbit/editor-core";
import {
  evaluateMorphTransitionSupport,
  type Deck,
  type Slide
} from "@orbit/shared";
import { useEffect, useRef, useState } from "react";
import {
  getRenderableSlideElements,
  ReadOnlySlideCanvas,
  type ElementPresentationState,
  type SlideRuntimeHighlight
} from "../../slides/rendering";
import { resolveEditorAssetUrl } from "../../editor/shared/editorAssetUrl";
import { useReducedMotion } from "./useReducedMotion";
import { useSlideshowTransitions } from "./useSlideshowTransitions";
import {
  ActivityAudienceRuntime,
  ActivityResultRuntime
} from "../../activity-slides";
import {
  collectSlideAssetUrls,
  getReadySlideImage
} from "../../slides/rendering/slideImageCache";

export type SlideshowRenderMode = "presenter" | "slide-window" | "single-screen";

const emptyTriggerAnimationIds: readonly string[] = [];

export function SlideshowRenderer(props: {
  deck: Deck;
  highlights?: SlideRuntimeHighlight[];
  playInitialEntryAnimations?: boolean;
  renderMode?: SlideshowRenderMode;
  scale?: number;
  slideId: string;
  stepIndex: number;
  triggerAnimationIds?: Iterable<string>;
}) {
  const {
    deck,
    highlights = [],
    playInitialEntryAnimations: playInitialEntryAnimationsProp,
    renderMode = "presenter",
    scale = 1,
    slideId,
    stepIndex,
    triggerAnimationIds = emptyTriggerAnimationIds
  } = props;
  const playInitialEntryAnimations =
    playInitialEntryAnimationsProp ?? renderMode !== "slide-window";
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  const reducedMotion = useReducedMotion();

  if (!slide) {
    return (
      <div className="slideshow-renderer slideshow-renderer--missing" role="status">
        슬라이드를 찾을 수 없습니다.
      </div>
    );
  }


  if (slide.kind === "activity-results") {
    return (
      <ActivityResultRuntime
        deck={deck}
        role={renderMode === "presenter" ? "presenter" : "audience"}
        scale={scale}
        slide={slide}
      />
    );
  }

  if (slide.kind === "activity") {
    return (
      <ActivityAudienceRuntime
        activity={slide.activity}
        deckId={deck.deckId}
        projectId={deck.projectId}
        scale={scale}
        slideStyle={slide.style}
        theme={deck.theme}
      />
    );
  }

  return (
    <SlideshowRendererContent
      deck={deck}
      highlights={highlights}
      playInitialEntryAnimations={playInitialEntryAnimations}
      reducedMotion={reducedMotion}
      renderMode={renderMode}
      scale={scale}
      slide={slide}
      stepIndex={stepIndex}
      triggerAnimationIds={triggerAnimationIds}
    />
  );
}

function SlideshowRendererContent(props: {
  deck: Deck;
  highlights: SlideRuntimeHighlight[];
  playInitialEntryAnimations: boolean;
  reducedMotion: boolean;
  renderMode: SlideshowRenderMode;
  scale: number;
  slide: Deck["slides"][number];
  stepIndex: number;
  triggerAnimationIds: Iterable<string>;
}) {
  const {
    deck,
    highlights,
    playInitialEntryAnimations,
    reducedMotion,
    renderMode,
    scale,
    slide,
    stepIndex,
    triggerAnimationIds
  } = props;
  const { elementStates, settledElementStates } = useSlideshowTransitions({
    deck,
    playInitialEntryAnimations,
    reducedMotion,
    slide,
    stepIndex,
    triggerAnimationIds
  });
  const frame = { settledElementStates, slide };
  const crossFade = useDestinationCrossFade({ deck, frame, reducedMotion });
  const opacities = getCrossFadeLayerOpacities(crossFade?.progress ?? 1);
  const morphFrames =
    crossFade?.kind === "morph"
      ? interpolateMorphFrames(crossFade.plan, crossFade.progress)
      : null;
  const outgoingElementStates = crossFade
    ? composeMorphGeometryStates(
        crossFade.outgoing.settledElementStates,
        morphFrames?.source
      )
    : {};
  const incomingElementStates = composeMorphGeometryStates(
    elementStates,
    morphFrames?.destination
  );

  return (
    <div
      aria-label={`슬라이드쇼 렌더러: ${slide.title || slide.slideId}`}
      className={`slideshow-renderer slideshow-renderer--${renderMode}`}
      data-render-mode={renderMode}
      data-slide-id={slide.slideId}
      data-slide-title={slide.title}
      data-step-index={stepIndex}
      data-transition-active={crossFade ? "true" : "false"}
      data-transition-kind={crossFade?.kind ?? "none"}
      style={{
        height: deck.canvas.height * scale,
        overflow: "hidden",
        position: "relative",
        width: deck.canvas.width * scale
      }}
    >
      {crossFade ? (
        <div
          aria-hidden="true"
          data-cross-fade-layer="outgoing"
          data-slide-id={crossFade.outgoing.slide.slideId}
          style={createCrossFadeLayerStyle(opacities.outgoing)}
        >
          <SlideFrame
            deck={deck}
            elementStates={outgoingElementStates}
            highlights={[]}
            scale={scale}
            slide={crossFade.outgoing.slide}
          />
        </div>
      ) : null}
      <div
        data-cross-fade-layer="incoming"
        data-slide-id={slide.slideId}
        style={createCrossFadeLayerStyle(
          crossFade ? opacities.incoming : 1
        )}
      >
        <SlideFrame
          deck={deck}
          elementStates={incomingElementStates}
          highlights={highlights}
          scale={scale}
          slide={slide}
        />
      </div>
    </div>
  );
}

type SlideshowCrossFadeFrame = {
  settledElementStates: Record<string, ElementPresentationState>;
  slide: Deck["slides"][number];
};

type SlideshowCrossFadeStateBase = {
  destinationSlideId: string;
  outgoing: SlideshowCrossFadeFrame;
  progress: number;
};

type SlideshowCrossFadeState =
  | (SlideshowCrossFadeStateBase & { kind: "fade" })
  | (SlideshowCrossFadeStateBase & {
      kind: "morph";
      plan: MorphTransitionPlan;
    });

function useDestinationCrossFade(args: {
  deck: Deck;
  frame: SlideshowCrossFadeFrame;
  reducedMotion: boolean;
}): SlideshowCrossFadeState | null {
  const previousFrameRef = useRef(args.frame);
  const frameRequestRef = useRef<number | null>(null);
  const activeDestinationRef = useRef<string | null>(null);
  const [transition, setTransition] = useState<SlideshowCrossFadeState | null>(
    null
  );
  const previousFrame = previousFrameRef.current;
  const didChangeSlide =
    previousFrame.slide.slideId !== args.frame.slide.slideId;
  const transitionSpec = getDestinationTransitionSpec({
    assetsReady:
      areMorphSlideAssetsReady(args.deck, previousFrame.slide) &&
      areMorphSlideAssetsReady(args.deck, args.frame.slide),
    deck: args.deck,
    destinationSlide: args.frame.slide,
    outgoingSlide: previousFrame.slide,
    reducedMotion: args.reducedMotion
  });
  const durationMs = transitionSpec?.durationMs ?? 0;

  if (!didChangeSlide) {
    previousFrameRef.current = args.frame;
  }

  useEffect(() => {
    const outgoing = previousFrameRef.current;

    if (outgoing.slide.slideId === args.frame.slide.slideId) {
      activeDestinationRef.current = null;
      setTransition((current) =>
        current?.destinationSlideId === args.frame.slide.slideId
          ? null
          : current
      );
      return;
    }

    previousFrameRef.current = args.frame;

    if (
      activeDestinationRef.current !== null &&
      activeDestinationRef.current !== args.frame.slide.slideId
    ) {
      activeDestinationRef.current = null;
      setTransition(null);
      return;
    }

    const nextTransitionSpec = getDestinationTransitionSpec({
      assetsReady:
        areMorphSlideAssetsReady(args.deck, outgoing.slide) &&
        areMorphSlideAssetsReady(args.deck, args.frame.slide),
      deck: args.deck,
      destinationSlide: args.frame.slide,
      outgoingSlide: outgoing.slide,
      reducedMotion: args.reducedMotion
    });
    if (!nextTransitionSpec) {
      activeDestinationRef.current = null;
      setTransition(null);
      return;
    }

    const destinationSlideId = args.frame.slide.slideId;
    const startedAt = performance.now();
    activeDestinationRef.current = destinationSlideId;
    setTransition(
      nextTransitionSpec.kind === "morph"
        ? {
            destinationSlideId,
            kind: "morph",
            outgoing,
            plan: nextTransitionSpec.plan,
            progress: 0
          }
        : {
            destinationSlideId,
            kind: "fade",
            outgoing,
            progress: 0
          }
    );

    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));

      if (progress >= 1) {
        frameRequestRef.current = null;
        activeDestinationRef.current = null;
        setTransition((current) =>
          current?.destinationSlideId === destinationSlideId ? null : current
        );
        return;
      }

      setTransition((current) =>
        current?.destinationSlideId === destinationSlideId
          ? { ...current, progress }
          : current
      );
      frameRequestRef.current = requestAnimationFrame(tick);
    };

    frameRequestRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRequestRef.current !== null) {
        cancelAnimationFrame(frameRequestRef.current);
        frameRequestRef.current = null;
      }
    };
  }, [
    args.deck,
    args.frame.slide.slideId,
    args.reducedMotion,
    durationMs
  ]);

  if (
    transition?.destinationSlideId === args.frame.slide.slideId &&
    !args.reducedMotion
  ) {
    return transition;
  }

  if (!didChangeSlide || !transitionSpec) return null;
  if (transitionSpec.kind === "morph") {
    return {
      destinationSlideId: args.frame.slide.slideId,
      kind: "morph",
      outgoing: previousFrame,
      plan: transitionSpec.plan,
      progress: 0
    };
  }
  return {
    destinationSlideId: args.frame.slide.slideId,
    kind: "fade",
    outgoing: previousFrame,
    progress: 0
  };
}

export function getDestinationCrossFadeDurationMs(args: {
  hasPreviousSlide: boolean;
  reducedMotion: boolean;
  slide: Deck["slides"][number];
}) {
  if (
    !args.hasPreviousSlide ||
    args.reducedMotion ||
    args.slide.transition === undefined
  ) {
    return 0;
  }

  return Math.max(0, args.slide.transition.durationMs);
}

type DestinationTransitionSpec =
  | { durationMs: number; kind: "fade" }
  | {
      durationMs: number;
      kind: "morph";
      plan: MorphTransitionPlan;
    };

export function getDestinationTransitionSpec(args: {
  assetsReady: boolean;
  deck: Deck;
  destinationSlide: Slide;
  outgoingSlide: Slide;
  reducedMotion: boolean;
}): DestinationTransitionSpec | null {
  const transition = args.destinationSlide.transition;
  if (args.reducedMotion || !transition) return null;
  const durationMs = Math.max(0, transition.durationMs);
  if (durationMs === 0) return null;
  if (transition.type === "fade") return { durationMs, kind: "fade" };

  const orderedSlides = [...args.deck.slides].sort(
    (left, right) => left.order - right.order
  );
  const destinationIndex = orderedSlides.findIndex(
    (slide) => slide.slideId === args.destinationSlide.slideId
  );
  const previousSlide = orderedSlides[destinationIndex - 1];
  const support = evaluateMorphTransitionSupport({
    sourceType: args.deck.metadata.sourceType,
    previousSlide,
    destinationSlide: args.destinationSlide
  });
  if (
    !support.supported ||
    previousSlide?.slideId !== args.outgoingSlide.slideId ||
    !args.assetsReady
  ) {
    return { durationMs, kind: "fade" };
  }

  return {
    durationMs,
    kind: "morph",
    plan: createMorphTransitionPlan(
      args.outgoingSlide,
      args.destinationSlide
    )
  };
}

export function getCrossFadeLayerOpacities(progress: number) {
  const normalizedProgress = Math.min(1, Math.max(0, progress));

  return {
    incoming: normalizedProgress,
    outgoing: 1 - normalizedProgress
  };
}

export function composeMorphGeometryStates(
  states: Record<string, ElementPresentationState>,
  frames?: Record<
    string,
    Pick<
      ElementPresentationState,
      "x" | "y" | "width" | "height" | "rotation"
    >
  >
): Record<string, ElementPresentationState> {
  if (!frames) return states;
  const composed = { ...states };
  for (const [elementId, frame] of Object.entries(frames)) {
    composed[elementId] = {
      ...(states[elementId] ?? {}),
      ...frame
    };
  }
  return composed;
}

function areMorphSlideAssetsReady(deck: Deck, slide: Slide): boolean {
  return collectSlideAssetUrls(deck, slide).every(
    (src) => getReadySlideImage(deck.projectId, src) !== null
  );
}

function createCrossFadeLayerStyle(opacity: number) {
  return {
    inset: 0,
    opacity,
    position: "absolute" as const
  };
}

function SlideFrame(props: {
  deck: Deck;
  elementStates: Record<string, ElementPresentationState>;
  highlights: SlideRuntimeHighlight[];
  scale: number;
  slide: Deck["slides"][number];
}) {
  const { deck, elementStates, highlights, scale, slide } = props;
  const hasRenderableElements =
    getRenderableSlideElements(slide, deck.canvas).length > 0;
  const thumbnailUrl = resolveEditorAssetUrl(slide.thumbnailUrl);

  if (!hasRenderableElements && thumbnailUrl) {
    return (
      <div
        className="slideshow-renderer-thumbnail"
        style={{
          height: deck.canvas.height * scale,
          overflow: "hidden",
          width: deck.canvas.width * scale
        }}
      >
        <img
          alt={`${slide.title || slide.slideId} thumbnail`}
          src={thumbnailUrl}
          style={{
            display: "block",
            height: "100%",
            objectFit: "contain",
            width: "100%"
          }}
        />
      </div>
    );
  }

  return (
    <ReadOnlySlideCanvas
      deck={deck}
      elementStates={elementStates}
      highlights={highlights}
      scale={scale}
      slide={slide}
    />
  );
}
