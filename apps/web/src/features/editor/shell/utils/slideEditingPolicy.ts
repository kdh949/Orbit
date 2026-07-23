import type { DeckElement, Slide } from "@orbit/shared";

const activityElementTypes = new Set<DeckElement["type"]>([
  "text",
  "rect",
  "ellipse",
  "line",
  "arrow",
  "polygon",
  "star",
  "ring",
  "image",
  "svg",
  "group",
  "activity-qr",
  "activity-copy",
  "presentation-passcode"
]);

export function canEditSlideCanvas(
  slide: Slide | null | undefined
): slide is
  | Extract<Slide, { kind: "content" }>
  | Extract<Slide, { kind: "activity" }> {
  if (slide?.kind === "activity") {
    return slide.activityAppearance.mode === "editable";
  }

  return slide?.kind === "content" && slide.importRenderMode !== "snapshot";
}

export function canInsertElementTypeOnSlide(
  slide: Slide | null | undefined,
  elementType: DeckElement["type"]
) {
  if (!canEditSlideCanvas(slide)) return false;
  return slide.kind === "content" || activityElementTypes.has(elementType);
}

export function canInsertDataElements(slide: Slide | null | undefined) {
  return (
    canInsertElementTypeOnSlide(slide, "chart") &&
    canInsertElementTypeOnSlide(slide, "table")
  );
}

export function canInsertCustomShape(slide: Slide | null | undefined) {
  return canInsertElementTypeOnSlide(slide, "customShape");
}

export function getDesignPanelLabel(
  slide: Slide | null
): "디자인" | "장표 설정" {
  return slide && slide.kind !== "content" ? "장표 설정" : "디자인";
}
