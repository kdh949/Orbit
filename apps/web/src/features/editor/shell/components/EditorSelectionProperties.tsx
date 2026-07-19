import { validateSlideAnimations } from "../../../../../../../packages/editor-core/src/index";
import type {
  CustomShapeElementProps,
  Deck,
  DeckAnimation,
  DeckElement,
  Slide
} from "@orbit/shared";
import type { ComponentProps } from "react";

import { getCustomShapeAbsoluteNodes } from "../../canvas/custom-shape/geometry";
import type { ImageCropActionState } from "../../canvas/image/imageCropSession";
import { SelectionQuickBar } from "./SelectionQuickBar";
import type { ElementLayerOrderAction } from "../utils/elementLayerOrder";

type EditorSelectionPropertiesProps = {
  animations: DeckAnimation[];
  animationDiagnostics: ReturnType<typeof validateSlideAnimations> | null;
  canvas: Deck["canvas"];
  customShapeEditActive: boolean;
  deckSourceType?: Deck["metadata"]["sourceType"];
  element: DeckElement | null;
  imageCropActionState?: ImageCropActionState;
  onChangeElementFrame: (
    slideId: string,
    elementId: string,
    frame: Parameters<ComponentProps<typeof SelectionQuickBar>["onChangeFrame"]>[0]
  ) => void;
  onChangeElementProps: (
    slideId: string,
    elementId: string,
    props: Parameters<ComponentProps<typeof SelectionQuickBar>["onChangeProps"]>[0]
  ) => void;
  onChangeElementLayerOrder: (
    slideId: string,
    elementId: string,
    action: ElementLayerOrderAction,
  ) => void;
  onConvertChartToTable: (slideId: string, elementId: string) => void;
  onChangeSlideStyle: ComponentProps<typeof SelectionQuickBar>["onChangeSlideStyle"];
  onChangeTheme: ComponentProps<typeof SelectionQuickBar>["onChangeTheme"];
  onCloseInlineEditing: () => void;
  onCommitCustomShapeGeometry: (
    slideId: string,
    elementId: string,
    nodes: ReturnType<typeof getCustomShapeAbsoluteNodes>,
    closed: boolean
  ) => void;
  onDeleteAnimation: (slideId: string, animationId: string) => void;
  onOpenAnimationEditor: () => void;
  onStartImageCrop?: () => void;
  onToggleCustomShapeEdit: (elementId: string) => void;
  selectedKeywordLabel: string | null;
  showIds: boolean;
  slide: Slide | null;
  theme: Deck["theme"];
};

export function EditorSelectionProperties(props: EditorSelectionPropertiesProps) {
  const { element, slide } = props;
  return (
    <SelectionQuickBar
      animations={element ? props.animations : []}
      animationDiagnostics={
        props.animationDiagnostics ?? {
          danglingAnimations: [],
          duplicateOrders: [],
          selectedElementEmpty: false
        }
      }
      canCreateAnimation={Boolean(slide && element)}
      canvas={props.canvas}
      customShapeEditActive={props.customShapeEditActive}
      deckSourceType={props.deckSourceType}
      element={element}
      imageCropActionState={props.imageCropActionState}
      key={element?.elementId ?? slide?.slideId ?? "none"}
      selectedKeywordLabel={props.selectedKeywordLabel}
      showIds={props.showIds}
      slide={slide}
      theme={props.theme}
      onChangeFrame={(frame) => {
        if (element && slide) props.onChangeElementFrame(slide.slideId, element.elementId, frame);
      }}
      onChangeLayerOrder={(action) => {
        if (element && slide) {
          props.onChangeElementLayerOrder(slide.slideId, element.elementId, action);
        }
      }}
      onChangeProps={(nextProps) => {
        if (element && slide) props.onChangeElementProps(slide.slideId, element.elementId, nextProps);
      }}
      onConvertChartToTable={() => {
        if (element?.type === "chart" && slide) {
          props.onConvertChartToTable(slide.slideId, element.elementId);
        }
      }}
      onChangeSlideStyle={props.onChangeSlideStyle}
      onChangeTheme={props.onChangeTheme}
      onDeleteAnimation={(animationId) => {
        if (slide) props.onDeleteAnimation(slide.slideId, animationId);
      }}
      onOpenAnimationEditor={props.onOpenAnimationEditor}
      onStartImageCrop={props.onStartImageCrop}
      onToggleCustomShapeClosed={() => {
        if (!element || !slide || element.type !== "customShape") return;
        props.onCommitCustomShapeGeometry(
          slide.slideId,
          element.elementId,
          getCustomShapeAbsoluteNodes(element),
          !(element.props as CustomShapeElementProps).closed
        );
      }}
      onToggleCustomShapeEdit={() => {
        if (!element || element.type !== "customShape") return;
        props.onCloseInlineEditing();
        props.onToggleCustomShapeEdit(element.elementId);
      }}
    />
  );
}
