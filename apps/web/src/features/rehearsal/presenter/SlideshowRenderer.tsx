import type { Deck } from "@orbit/shared";
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
  const crossFade = useDestinationCrossFade({ frame, reducedMotion });
  const opacities = getCrossFadeLayerOpacities(crossFade?.progress ?? 1);

  return (
    <div
      aria-label={`슬라이드쇼 렌더러: ${slide.title || slide.slideId}`}
      className={`slideshow-renderer slideshow-renderer--${renderMode}`}
      data-render-mode={renderMode}
      data-slide-id={slide.slideId}
      data-slide-title={slide.title}
      data-step-index={stepIndex}
      data-transition-active={crossFade ? "true" : "false"}
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
            elementStates={crossFade.outgoing.settledElementStates}
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
          elementStates={elementStates}
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

type SlideshowCrossFadeState = {
  destinationSlideId: string;
  outgoing: SlideshowCrossFadeFrame;
  progress: number;
};

function useDestinationCrossFade(args: {
  frame: SlideshowCrossFadeFrame;
  reducedMotion: boolean;
}) {
  const previousFrameRef = useRef(args.frame);
  const frameRequestRef = useRef<number | null>(null);
  const [transition, setTransition] = useState<SlideshowCrossFadeState | null>(
    null
  );
  const previousFrame = previousFrameRef.current;
  const didChangeSlide =
    previousFrame.slide.slideId !== args.frame.slide.slideId;
  const durationMs = getDestinationCrossFadeDurationMs({
    hasPreviousSlide: true,
    reducedMotion: args.reducedMotion,
    slide: args.frame.slide
  });

  if (!didChangeSlide) {
    previousFrameRef.current = args.frame;
  }

  useEffect(() => {
    const outgoing = previousFrameRef.current;

    if (outgoing.slide.slideId === args.frame.slide.slideId) {
      setTransition((current) =>
        current?.destinationSlideId === args.frame.slide.slideId
          ? null
          : current
      );
      return;
    }

    previousFrameRef.current = args.frame;

    if (durationMs <= 0) {
      setTransition(null);
      return;
    }

    const destinationSlideId = args.frame.slide.slideId;
    const startedAt = performance.now();
    setTransition({ destinationSlideId, outgoing, progress: 0 });

    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));

      if (progress >= 1) {
        frameRequestRef.current = null;
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
  }, [args.frame.slide.slideId, args.reducedMotion, durationMs]);

  if (
    transition?.destinationSlideId === args.frame.slide.slideId &&
    !args.reducedMotion
  ) {
    return transition;
  }

  return didChangeSlide && durationMs > 0
    ? {
        destinationSlideId: args.frame.slide.slideId,
        outgoing: previousFrame,
        progress: 0
      }
    : null;
}

export function getDestinationCrossFadeDurationMs(args: {
  hasPreviousSlide: boolean;
  reducedMotion: boolean;
  slide: Deck["slides"][number];
}) {
  if (
    !args.hasPreviousSlide ||
    args.reducedMotion ||
    args.slide.transition?.type !== "fade"
  ) {
    return 0;
  }

  return Math.max(0, args.slide.transition.durationMs);
}

export function getCrossFadeLayerOpacities(progress: number) {
  const normalizedProgress = Math.min(1, Math.max(0, progress));

  return {
    incoming: normalizedProgress,
    outgoing: 1 - normalizedProgress
  };
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
