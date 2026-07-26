import type { DeckCanvas, DeckElement } from "@orbit/shared/deck";

const CANVAS_ID_BADGE_GAP = 10;
const CANVAS_ID_STAGE_PADDING = 12;

export const CANVAS_ID_BADGE_FONT_SIZE = 27;
export const CANVAS_ID_BADGE_HEIGHT = 60;
export const CANVAS_ID_BADGE_PADDING = 15;

export function getGroupedChildPreviewFrame(args: {
  childElement: DeckElement;
  currentGroupFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  previewGroupFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
}) {
  const { childElement, currentGroupFrame, previewGroupFrame } = args;
  const scaleX = previewGroupFrame.width / Math.max(1, currentGroupFrame.width);
  const scaleY = previewGroupFrame.height / Math.max(1, currentGroupFrame.height);

  return {
    height: Math.max(1, childElement.height * scaleY),
    rotation: childElement.rotation - currentGroupFrame.rotation,
    width: Math.max(1, childElement.width * scaleX),
    x: (childElement.x - currentGroupFrame.x) * scaleX,
    y: (childElement.y - currentGroupFrame.y) * scaleY
  };
}

export function getDisplayIdLabel(id: string) {
  const kind = getIdKind(id);
  const suffix = getDisplayIdSuffix(id);

  switch (kind) {
    case "project":
      return `project${suffix}`;
    case "deck":
      return `deck${suffix}`;
    case "slide":
      return `slide${suffix}`;
    case "element":
      return `element${suffix}`;
    case "animation":
      return `animation${suffix}`;
    case "keyword":
      return `keyword${suffix}`;
    case "change":
      return `change${suffix}`;
    case "snapshot":
      return `snapshot${suffix}`;
    default:
      return truncateValue(id.replace(/_/g, ""), 18);
  }
}

export function getCanvasIdBadgeWidth(label: string) {
  return Math.max(172, label.length * 19 + 36);
}

export function getCanvasIdBadgeOffset(args: {
  canvas: DeckCanvas;
  frame: { x: number; y: number; width: number; height: number };
  badgeWidth: number;
  badgeHeight: number;
}) {
  const { canvas, frame, badgeWidth, badgeHeight } = args;
  const hasRoomOnRight = frame.x + badgeWidth <= canvas.width - CANVAS_ID_STAGE_PADDING;
  const hasRoomAbove =
    frame.y >= badgeHeight + CANVAS_ID_BADGE_GAP + CANVAS_ID_STAGE_PADDING;
  const hasRoomBelow =
    frame.y + frame.height + CANVAS_ID_BADGE_GAP + badgeHeight <=
    canvas.height - CANVAS_ID_STAGE_PADDING;

  return {
    x: hasRoomOnRight ? 0 : Math.min(0, frame.width - badgeWidth),
    y: hasRoomAbove || !hasRoomBelow ? -badgeHeight - CANVAS_ID_BADGE_GAP : frame.height + CANVAS_ID_BADGE_GAP
  };
}

function getIdKind(id: string): string {
  if (id.startsWith("deck_")) {
    return "deck";
  }
  if (id.startsWith("project_")) {
    return "project";
  }
  if (id.startsWith("slide_")) {
    return "slide";
  }
  if (id.startsWith("el_")) {
    return "element";
  }
  if (id.startsWith("anim_")) {
    return "animation";
  }
  if (id.startsWith("kw_")) {
    return "keyword";
  }
  if (id.startsWith("change_")) {
    return "change";
  }
  if (id.startsWith("snapshot_")) {
    return "snapshot";
  }
  return "default";
}

function getDisplayIdSuffix(id: string) {
  const normalized = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;

  return truncateValue(normalized.replace(/_/g, ""), 12);
}

function truncateValue(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
