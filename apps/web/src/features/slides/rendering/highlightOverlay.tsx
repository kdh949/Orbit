import type { DeckElement } from "@orbit/shared";
import { Group as KonvaGroup, Rect as KonvaRect } from "react-konva";
import type { ComponentType } from "react";
import type { ElementPresentationState } from "./presentationState";

type KonvaComponent = ComponentType<any>;

const Group = KonvaGroup as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;

export function HighlightOverlay(props: {
  color?: string;
  element: DeckElement;
  state?: ElementPresentationState;
}) {
  const { color = "#2563eb", element, state } = props;
  const visible = state?.visible ?? element.visible;
  const opacity = state?.opacity ?? element.opacity;

  if (!visible || opacity === 0) {
    return null;
  }

  const x = state?.x ?? element.x;
  const y = state?.y ?? element.y;
  const width = state?.width ?? element.width;
  const height = state?.height ?? element.height;
  const rotation = state?.rotation ?? element.rotation;

  return (
    <Group
      data-highlight-element-id={element.elementId}
      data-testid="slide-highlight-overlay"
      listening={false}
      rotation={rotation}
      scaleX={state?.scaleX ?? 1}
      scaleY={state?.scaleY ?? 1}
      x={x}
      y={y}
    >
      <Rect
        cornerRadius={14}
        height={height}
        opacity={0.95}
        shadowBlur={24}
        shadowColor={color}
        shadowOpacity={0.38}
        stroke={color}
        strokeWidth={4}
        width={width}
      />
    </Group>
  );
}

export function getActiveHighlightElementIds(
  highlights: Array<{ active: boolean; elementId: string }> = [],
) {
  const activeIds = new Set<string>();

  for (const highlight of highlights) {
    if (highlight.active) {
      activeIds.add(highlight.elementId);
    } else {
      activeIds.delete(highlight.elementId);
    }
  }

  return activeIds;
}
