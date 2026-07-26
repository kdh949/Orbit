import type { Deck } from "@orbit/shared";
import { IconMaximize as Maximize2, IconX as X } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { SlideRuntimeHighlight } from "../../slides/rendering";
import { shouldAdvancePresentationFromClick } from "../../presenter-shell/presentationClickAdvance";
import { SlideshowRenderer } from "./SlideshowRenderer";

export function SingleScreenPresenter(props: {
  deck: Deck;
  highlights?: SlideRuntimeHighlight[];
  isFullscreen?: boolean;
  onExit: () => void;
  onNextStep?: () => void;
  slideElapsedLabel: string;
  slideId: string;
  slideTargetLabel: string;
  stepIndex: number;
  totalTimeLabel: string;
  triggerAnimationIds: string[];
}) {
  const {
    deck,
    highlights = [],
    onExit,
    onNextStep,
    slideId,
    stepIndex,
    triggerAnimationIds
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreenRequested, setFullscreenRequested] = useState(false);
  const liveIsFullscreen = useSingleScreenFullscreenState();
  const isFullscreen = props.isFullscreen ?? liveIsFullscreen;
  const currentSlide = deck.slides.find((slide) => slide.slideId === slideId);
  const canAdvanceStage =
    currentSlide?.kind !== "activity" && currentSlide?.kind !== "activity-results";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onExit();
      }
    };
    const handleFullscreenChange = () => {
      if (fullscreenRequested && !document.fullscreenElement) {
        onExit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [fullscreenRequested, onExit]);

  return (
    <main className="single-screen-presenter" ref={rootRef}>
      <div
        className="single-screen-stage"
        aria-label="단일 화면 슬라이드"
        onClick={(event) => {
          if (canAdvanceStage && shouldAdvancePresentationFromClick(event.target)) {
            onNextStep?.();
          }
        }}
      >
        <SlideshowRenderer
          deck={deck}
          highlights={highlights}
          renderMode="single-screen"
          scale={getSingleScreenScale(deck)}
          slideId={slideId}
          stepIndex={stepIndex}
          triggerAnimationIds={triggerAnimationIds}
        />
      </div>
      {!isFullscreen ? (
        <div className="single-screen-actions">
          <button
            type="button"
            onClick={() => {
              void requestSingleScreenFullscreen(rootRef.current).then((ok) => {
                setFullscreenRequested(ok);
              });
            }}
          >
            <Maximize2 size={17} />
            전체화면 시작
          </button>
          <button type="button" onClick={onExit} aria-label="단일 화면 종료">
            <X size={18} />
          </button>
        </div>
      ) : null}
    </main>
  );
}

export function getSingleScreenScale(deck: Deck, viewport = readViewportSize()) {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }

  return Math.min(viewport.width / deck.canvas.width, viewport.height / deck.canvas.height);
}

async function requestSingleScreenFullscreen(target: HTMLElement | null) {
  if (!target || typeof target.requestFullscreen !== "function") {
    return false;
  }

  try {
    await target.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

function readViewportSize() {
  if (typeof window === "undefined") {
    return { height: 1080, width: 1920 };
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth
  };
}

function useSingleScreenFullscreenState() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  return isFullscreen;
}
