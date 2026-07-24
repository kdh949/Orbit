import type {
  CompanionDeckSnapshot,
  PresentationCompanionOutputState,
} from "@orbit/shared";
import { useEffect, useMemo, useState } from "react";
import { AudienceOutputRenderer } from "../rehearsal/presenter/AudienceOutputRenderer";
import type { PresenterSlideshowState } from "../rehearsal/presenter/presenterStateStore";
import {
  materializeCompanionDeck,
  resolveCompanionTriggerAnimationIds,
} from "./companionDeckAdapter";
import {
  calculateContainRect,
  type SurfaceRect,
  type SurfaceSize,
} from "./surfaceGeometry";
import { calculateCompanionRendererScale } from "./companionRendererScale";
import { CompanionActivityProjectionProvider } from "./CompanionActivityProjectionProvider";

export function CompanionAudienceRenderer(props: {
  deck: CompanionDeckSnapshot;
  onSurfaceRectChange?: (rect: SurfaceRect | null) => void;
  output: PresentationCompanionOutputState | null;
  stream?: MediaStream | null;
}) {
  const deck = useMemo(
    () => materializeCompanionDeck(props.deck),
    [props.deck],
  );
  const scale = useCompanionRendererScale(deck.canvas);
  const [screenShareMedia, setScreenShareMedia] = useState<{
    shareEpochId: string;
    size: SurfaceSize;
  } | null>(null);
  const activeShareEpochId =
    props.output?.outputMode === "screen-share"
      ? (props.output.shareEpochId ?? null)
      : null;

  useEffect(() => {
    if (
      props.output?.outputMode !== "screen-share" ||
      !activeShareEpochId ||
      screenShareMedia?.shareEpochId !== activeShareEpochId
    ) {
      props.onSurfaceRectChange?.(null);
      return;
    }
    props.onSurfaceRectChange?.(
      calculateContainRect(
        {
          height: deck.canvas.height * scale,
          width: deck.canvas.width * scale,
        },
        screenShareMedia.size,
      ),
    );
  }, [
    deck.canvas.height,
    deck.canvas.width,
    props.onSurfaceRectChange,
    activeShareEpochId,
    props.output?.outputMode,
    scale,
    screenShareMedia,
  ]);

  if (!props.output) {
    return (
      <section className="presenter-companion-waiting" role="status">
        <h1>발표 자료</h1>
        <p>발표자 화면 연결을 기다리고 있습니다.</p>
      </section>
    );
  }

  const state: PresenterSlideshowState = {
    audienceOutputMode: props.output.outputMode,
    highlights: [],
    slideId: props.output.slideId,
    slideIndex: props.output.slideIndex,
    stepIndex: props.output.animationStep,
  };
  const triggerAnimationIds = resolveCompanionTriggerAnimationIds(
    props.deck,
    props.output.slideId,
    props.output.slideIndex,
  );
  const activityIds = getVisibleActivityIds(props.deck, props.output);

  return (
    <section
      aria-label="iPad 청중 출력"
      className="presenter-companion-output"
      data-output-mode={props.output.outputMode}
      data-output-obscured={
        props.output.outputMode === "black" ? "true" : "false"
      }
      data-output-revision={props.output.outputRevision}
      style={{
        height: deck.canvas.height * scale,
        width: deck.canvas.width * scale,
      }}
    >
      <CompanionActivityProjectionProvider
        activityIds={activityIds}
        sessionId={props.output.sessionId}
      >
        <AudienceOutputRenderer
          deck={deck}
          onScreenShareContentSizeChange={(size) => {
            setScreenShareMedia(
              size && activeShareEpochId
                ? { shareEpochId: activeShareEpochId, size }
                : null,
            );
          }}
          scale={scale}
          state={state}
          stream={props.stream}
          triggerAnimationIds={triggerAnimationIds}
        />
      </CompanionActivityProjectionProvider>
    </section>
  );
}

function getVisibleActivityIds(
  deck: CompanionDeckSnapshot,
  output: PresentationCompanionOutputState,
) {
  if (output.outputMode !== "slide") {
    return [];
  }
  const slide =
    deck.slides.find((candidate) => candidate.slideId === output.slideId) ??
    deck.slides[output.slideIndex];
  if (!slide) {
    return [];
  }
  const activityIds = slide.elements.flatMap((element) =>
    element.type === "activity-qr" ? [element.props.activityId] : [],
  );
  if (slide.kind === "activity") {
    activityIds.push(slide.activity.activityId);
  }
  if (slide.kind === "activity-results") {
    activityIds.push(slide.activityResult.sourceActivityId);
  }
  return Array.from(new Set(activityIds));
}

function useCompanionRendererScale(canvas: {
  height: number;
  width: number;
}) {
  const getScale = () => {
    if (typeof window === "undefined") return 1;
    return calculateCompanionRendererScale(canvas, {
      height: window.innerHeight,
      width: window.innerWidth,
    });
  };
  const [scale, setScale] = useState(getScale);

  useEffect(() => {
    const handleResize = () => setScale(getScale());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [canvas.height, canvas.width]);

  return scale;
}
