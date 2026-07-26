import type { ActivityCopyElementProps, Deck, Slide } from "@orbit/shared/deck";
import { Text as KonvaText } from "react-konva";
import type { ComponentType } from "react";

import { getKonvaFontStyle } from "../../editor/canvas/text/textLayout";

type KonvaComponent = ComponentType<any>;
const Text = KonvaText as unknown as KonvaComponent;

export function ActivityCopyElementContent(props: {
  deck: Deck;
  elementProps: ActivityCopyElementProps;
  frame: { width: number; height: number };
  slide: Slide;
}) {
  const activitySlide = props.deck.slides.find(
    (slide) =>
      slide.kind === "activity" &&
      slide.activity.activityId === props.elementProps.activityId
  );
  const content =
    activitySlide?.kind === "activity"
      ? activitySlide.activity[props.elementProps.field]
      : "";
  const text = content.trim() || props.elementProps.fallbackText;
  const style = props.elementProps.textStyle;

  return (
    <Text
      align={style.align ?? "left"}
      fill={
        style.color ??
        props.slide.style.textColor ??
        props.deck.theme.textColor
      }
      fontFamily={
        style.fontFamily ??
        props.slide.style.fontFamily ??
        props.deck.theme.typography.bodyFontFamily
      }
      fontSize={style.fontSize ?? 32}
      fontStyle={getKonvaFontStyle(style.fontWeight ?? "normal")}
      height={props.frame.height}
      letterSpacing={style.letterSpacing ?? 0}
      lineHeight={style.lineHeight ?? 1.2}
      listening={false}
      text={text}
      textDecoration={style.underline ? "underline" : undefined}
      verticalAlign={style.verticalAlign ?? "top"}
      width={props.frame.width}
      wrap="word"
    />
  );
}
