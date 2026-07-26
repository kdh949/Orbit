import type { Deck, DeckElement, Slide } from "@orbit/shared";
import type Konva from "konva";
import {
  Group as KonvaGroup,
  Layer as KonvaLayer,
  Stage as KonvaStage
} from "react-konva";
import type { ComponentType } from "react";
import { ElementNodeContent } from "./elementRendering";
import {
  getRenderableSlideElements,
  usesSourceSlideSnapshot
} from "./elementNormalization";
import { resolveGroupedElementPresentationStates } from "./groupPresentationState";
import { getHighlightOverlayElements } from "./highlightOverlayElements";
import type { ElementPresentationState } from "./presentationState";
import { SlideBackground } from "./SlideBackground";
import { getActiveHighlightElementIds, HighlightOverlay } from "./highlightOverlay";

type KonvaComponent = ComponentType<any>;

const Group = KonvaGroup as unknown as KonvaComponent;
const Layer = KonvaLayer as unknown as KonvaComponent;
const Stage = KonvaStage as unknown as KonvaComponent;
const inactiveHighlightElementIds = new Set<string>();

export type SlideRuntimeHighlight = {
  active: boolean;
  elementId: string;
};

export function ReadOnlySlideCanvas(props: {
  deck: Deck;
  elementStates?: Record<string, ElementPresentationState>;
  highlights?: SlideRuntimeHighlight[];
  scale?: number;
  slide: Slide;
  stageRef?: (stage: Konva.Stage | null) => void;
}) {
  const { deck, elementStates = {}, highlights = [], scale = 1, slide, stageRef } = props;
  const elements = getRenderableSlideElements(slide, deck.canvas);
  const resolvedElementStates = resolveGroupedElementPresentationStates({
    elementStates,
    slide
  });
  const activeHighlightElementIds = getActiveHighlightElementIds(highlights);
  const highlightElements = getHighlightOverlayElements({
    activeHighlightElementIds,
    deck,
    elementStates: resolvedElementStates,
    slide
  });
  const backgroundSlide =
    usesSourceSlideSnapshot(slide) && slide.thumbnailUrl
      ? {
          ...slide,
          style: {
            ...slide.style,
            backgroundImage: {
              src: slide.thumbnailUrl,
              alt: slide.title,
              fit: "stretch" as const,
              opacity: 1
            }
          }
        }
      : slide;

  return (
    <div
      className="orbit-read-only-slide-viewport"
      style={{
        height: deck.canvas.height * scale,
        overflow: "hidden",
        width: deck.canvas.width * scale
      }}
    >
      <SlideBackground
        deck={deck}
        slide={backgroundSlide}
        style={{
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left"
        }}
      >
        <Stage
          className="orbit-read-only-slide-stage"
          data-testid="read-only-slide-stage"
          height={deck.canvas.height}
          ref={stageRef}
          width={deck.canvas.width}
        >
          <Layer>
            {elements.map((element) => (
              <ReadOnlyElementNode
                key={element.elementId}
                accentColor={slide.style.accentColor ?? deck.theme.accentColor}
                deck={deck}
                element={element}
                elementStates={resolvedElementStates}
                activeHighlightElementIds={activeHighlightElementIds}
                presentationState={resolvedElementStates[element.elementId]}
                slide={slide}
              />
            ))}
            {highlightElements.map((element) => (
              <HighlightOverlay
                element={element}
                key={`highlight-${element.elementId}`}
                state={resolvedElementStates[element.elementId]}
              />
            ))}
          </Layer>
        </Stage>
      </SlideBackground>
    </div>
  );
}

function ReadOnlyElementNode(props: {
  accentColor: string;
  activeHighlightElementIds: Set<string>;
  deck: Deck;
  element: DeckElement;
  elementStates: Record<string, ElementPresentationState>;
  presentationState?: ElementPresentationState;
  slide: Slide;
}) {
  const {
    accentColor,
    activeHighlightElementIds,
    deck,
    element,
    elementStates,
    presentationState,
    slide
  } = props;
  const visible = presentationState?.visible ?? element.visible;
  const opacity = presentationState?.opacity ?? element.opacity;
  const visibleHighlightElementIds =
    visible && opacity !== 0 ? activeHighlightElementIds : inactiveHighlightElementIds;
  const frame = {
    x: presentationState?.x ?? element.x,
    y: presentationState?.y ?? element.y,
    width: presentationState?.width ?? element.width,
    height: presentationState?.height ?? element.height,
    rotation: presentationState?.rotation ?? element.rotation
  };

  return (
    <Group
      data-element-id={element.elementId}
      listening={false}
      opacity={visible ? opacity : 0}
      rotation={frame.rotation}
      scaleX={presentationState?.scaleX ?? 1}
      scaleY={presentationState?.scaleY ?? 1}
      x={frame.x}
      y={frame.y}
    >
      <ElementNodeContent
        accentColor={accentColor}
        activeHighlightElementIds={visibleHighlightElementIds}
        deck={deck}
        element={element}
        elementStates={elementStates}
        frame={frame}
        slide={slide}
      />
    </Group>
  );
}
