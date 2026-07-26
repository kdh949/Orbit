import type { Slide } from "@orbit/shared/deck";

export type SlideRailItem = {
  canDelete: boolean;
  canMoveDown: boolean;
  canMoveUp: boolean;
  index: number;
  isSelected: boolean;
  slideId: string;
  thumbnailUrl: string;
  title: string;
};

export type SlideRailNavigationKey = "ArrowDown" | "ArrowUp" | "End" | "Home";

export function getSlideRailTitle(slide: Pick<Slide, "title">, index: number) {
  return slide.title.trim() || `슬라이드 ${index + 1}`;
}

export function resolveSelectedSlideId(
  slides: readonly Pick<Slide, "slideId">[],
  selectedSlideId: string | null,
) {
  if (selectedSlideId && slides.some((slide) => slide.slideId === selectedSlideId)) {
    return selectedSlideId;
  }

  return slides[0]?.slideId ?? null;
}

export function buildSlideRailItems(
  slides: readonly Pick<Slide, "slideId" | "thumbnailUrl" | "title">[],
  selectedSlideId: string | null,
): SlideRailItem[] {
  const resolvedSelectedSlideId = resolveSelectedSlideId(slides, selectedSlideId);

  return slides.map((slide, index) => ({
    canDelete: slides.length > 1,
    canMoveDown: index < slides.length - 1,
    canMoveUp: index > 0,
    index,
    isSelected: slide.slideId === resolvedSelectedSlideId,
    slideId: slide.slideId,
    thumbnailUrl: slide.thumbnailUrl,
    title: getSlideRailTitle(slide, index),
  }));
}

export function resolveSelectedSlideIdAfterDelete(args: {
  deletedSlideId: string;
  selectedSlideId: string | null;
  slides: readonly Pick<Slide, "slideId">[];
}) {
  const deletedIndex = args.slides.findIndex(
    (slide) => slide.slideId === args.deletedSlideId,
  );

  if (deletedIndex < 0 || args.selectedSlideId !== args.deletedSlideId) {
    return resolveSelectedSlideId(
      args.slides.filter((slide) => slide.slideId !== args.deletedSlideId),
      args.selectedSlideId,
    );
  }

  return (
    args.slides[deletedIndex + 1]?.slideId ??
    args.slides[deletedIndex - 1]?.slideId ??
    null
  );
}

export function getSlideRailKeyboardTargetSlideId(args: {
  currentSlideId: string;
  items: readonly Pick<SlideRailItem, "slideId">[];
  key: string;
}) {
  if (!isSlideRailNavigationKey(args.key)) return null;

  const currentIndex = args.items.findIndex(
    (item) => item.slideId === args.currentSlideId,
  );
  if (currentIndex < 0 || args.items.length === 0) return null;

  const targetIndex =
    args.key === "Home"
      ? 0
      : args.key === "End"
        ? args.items.length - 1
        : args.key === "ArrowUp"
          ? Math.max(0, currentIndex - 1)
          : Math.min(args.items.length - 1, currentIndex + 1);

  return args.items[targetIndex]?.slideId ?? null;
}

function isSlideRailNavigationKey(key: string): key is SlideRailNavigationKey {
  return key === "ArrowDown" || key === "ArrowUp" || key === "End" || key === "Home";
}
