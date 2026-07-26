import type { Slide } from "@orbit/shared/deck";

export function buildWorkspaceThumbnailSlide(slide: Slide): Slide {
  if (!slide.style.backgroundImage) {
    return slide;
  }

  return {
    ...slide,
    style: {
      ...slide.style,
      backgroundImage: {
        ...slide.style.backgroundImage,
        opacity: 1,
      },
    },
  };
}
