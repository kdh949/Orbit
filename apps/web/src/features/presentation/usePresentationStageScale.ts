import type { Deck } from "@orbit/shared/deck";
import { useCallback, useEffect, useState } from "react";

export function usePresentationStageScale(deck: Deck | null) {
  const [presenterStageElement, setPresenterStageElement] =
    useState<HTMLDivElement | null>(null);
  const [presenterScale, setPresenterScale] = useState(0.44);
  const presenterStageRef = useCallback((node: HTMLDivElement | null) => {
    setPresenterStageElement(node);
  }, []);

  useEffect(() => {
    const stage = presenterStageElement;
    if (!stage || !deck) {
      return;
    }

    let animationFrame: number | null = null;

    const updateScale = () => {
      const bounds = stage.getBoundingClientRect();
      const style = window.getComputedStyle(stage);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const verticalPadding =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const availableWidth = Math.max(0, bounds.width - horizontalPadding);
      const availableHeight = Math.max(0, bounds.height - verticalPadding);
      const nextScale = Math.min(
        availableWidth / deck.canvas.width,
        availableHeight / deck.canvas.height,
      );
      if (Number.isFinite(nextScale) && nextScale > 0) {
        setPresenterScale((current) =>
          Math.abs(current - nextScale) > 0.001 ? nextScale : current,
        );
      }
    };
    const scheduleScaleUpdate = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(updateScale);
    };

    updateScale();
    scheduleScaleUpdate();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleScaleUpdate);
      return () => {
        window.removeEventListener("resize", scheduleScaleUpdate);
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
      };
    }

    const observer = new ResizeObserver(scheduleScaleUpdate);
    observer.observe(stage);
    window.addEventListener("resize", scheduleScaleUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleScaleUpdate);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [deck, presenterStageElement]);

  return { presenterScale, presenterStageRef };
}
