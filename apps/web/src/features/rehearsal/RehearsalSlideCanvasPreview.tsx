import type { Deck } from "@orbit/shared";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

const ReadOnlySlideCanvas = lazy(async () => {
  const module = await import("../slides/rendering");
  return { default: module.ReadOnlySlideCanvas };
});

type Props = {
  ariaHidden?: boolean;
  deck: Deck;
  label?: string;
  slide: Deck["slides"][number];
};

export function RehearsalSlideCanvasPreview({
  ariaHidden = false,
  deck,
  label,
  slide,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      setScale(
        calculateRehearsalSlideCanvasScale(
          viewport.clientWidth,
          viewport.clientHeight,
          deck.canvas.width,
          deck.canvas.height,
        ),
      );
    };

    updateScale();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => window.removeEventListener("resize", updateScale);
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [deck.canvas.height, deck.canvas.width, slide.slideId]);

  return (
    <div
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : label}
      className="rrd-rehearsal-slide-canvas"
      data-renderer="konva"
      ref={viewportRef}
      role={ariaHidden ? undefined : "img"}
    >
      {scale > 0 ? (
        <Suspense fallback={null}>
          <ReadOnlySlideCanvas deck={deck} scale={scale} slide={slide} />
        </Suspense>
      ) : null}
    </div>
  );
}

export function calculateRehearsalSlideCanvasScale(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return 0;
  }

  return Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight);
}