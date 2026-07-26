import type { Deck } from "@orbit/shared/deck";
import { useEffect, useRef, useState } from "react";

import { ReadOnlySlideCanvas } from "../slides/rendering";

export default function FocusedSlidePreview(props: { deck: Deck; slideId: string }) {
  const shell = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);
  const slide = props.deck.slides.find((candidate) => candidate.slideId === props.slideId);

  useEffect(() => {
    const target = shell.current;
    if (!target) return;
    const update = () => {
      if (target.clientWidth <= 0 || target.clientHeight <= 0) return;
      setScale(Math.min(
        target.clientWidth / props.deck.canvas.width,
        target.clientHeight / props.deck.canvas.height,
      ));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, [props.deck.canvas.height, props.deck.canvas.width]);

  if (!slide) return null;
  return <section className="focused-slide-preview" aria-label={`${slide.title} 장표 미리보기`}><div className="focused-slide-preview-canvas" ref={shell}><ReadOnlySlideCanvas deck={props.deck} slide={slide} scale={scale} /></div></section>;
}
