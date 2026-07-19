import type { Deck } from "@orbit/shared";
import type Konva from "konva";
import { useEffect, useRef } from "react";

import { ReadOnlySlideCanvas } from "../../../slides/rendering/ReadOnlySlideCanvas";

export function PrintDeckView({
  deck,
  onReady,
}: {
  deck: Deck;
  onReady: () => void;
}) {
  const mountedSlideIdsRef = useRef(new Set<string>());
  const didNotifyReadyRef = useRef(false);

  useEffect(() => {
    if (deck.slides.length === 0 && !didNotifyReadyRef.current) {
      didNotifyReadyRef.current = true;
      onReady();
    }
  }, [deck.slides.length, onReady]);

  function handleStageRef(slideId: string, stage: Konva.Stage | null) {
    if (stage) {
      mountedSlideIdsRef.current.add(slideId);
    } else {
      mountedSlideIdsRef.current.delete(slideId);
    }

    if (
      !didNotifyReadyRef.current &&
      mountedSlideIdsRef.current.size === deck.slides.length
    ) {
      didNotifyReadyRef.current = true;
      queueMicrotask(onReady);
    }
  }

  return (
    <section aria-label="인쇄할 슬라이드" className="editor-print-deck">
      {deck.slides.map((slide) => (
        <article className="editor-print-slide" key={slide.slideId}>
          <ReadOnlySlideCanvas
            deck={deck}
            interactive={false}
            renderPixelRatio={1}
            slide={slide}
            stageRef={(stage) => handleStageRef(slide.slideId, stage)}
          />
        </article>
      ))}
    </section>
  );
}
