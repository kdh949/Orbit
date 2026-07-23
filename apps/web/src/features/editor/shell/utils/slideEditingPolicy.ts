import type { Slide } from "@orbit/shared";

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

export function getDesignPanelLabel(
  slide: Slide | null
): "디자인" | "장표 설정" {
  return slide && slide.kind !== "content" ? "장표 설정" : "디자인";
}
