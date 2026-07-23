import type {
  DeckElementPaint,
  PresentationPasscodeElementProps
} from "@orbit/shared";
import {
  Group as KonvaGroup,
  Rect as KonvaRect,
  Text as KonvaText
} from "react-konva";
import type { ComponentType } from "react";

import { getKonvaFontStyle } from "../../editor/canvas/text/textLayout";
import { useActivityElementRuntime } from "./ActivityElementRuntimeContext";

type KonvaComponent = ComponentType<any>;
const Group = KonvaGroup as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;
const Text = KonvaText as unknown as KonvaComponent;

export function PresentationPasscodeElementContent(props: {
  elementProps: PresentationPasscodeElementProps;
  frame: { width: number; height: number };
}) {
  const runtime = useActivityElementRuntime();
  const labelStyle = props.elementProps.labelTextStyle;
  const codeStyle = props.elementProps.codeTextStyle;
  const labelHeight = Math.min(52, props.frame.height * 0.3);

  return (
    <Group listening={false}>
      <Rect
        cornerRadius={props.elementProps.borderRadius}
        fill={solidPaint(props.elementProps.fill)}
        height={props.frame.height}
        stroke={solidPaint(props.elementProps.stroke)}
        strokeWidth={props.elementProps.strokeWidth}
        width={props.frame.width}
      />
      <Text
        align={labelStyle.align ?? "center"}
        fill={labelStyle.color ?? "#62675F"}
        fontFamily={labelStyle.fontFamily}
        fontSize={labelStyle.fontSize ?? 22}
        fontStyle={getKonvaFontStyle(labelStyle.fontWeight ?? "medium")}
        height={labelHeight}
        padding={8}
        text={props.elementProps.label}
        verticalAlign="middle"
        width={props.frame.width}
      />
      <Text
        align={codeStyle.align ?? "center"}
        fill={codeStyle.color ?? "#171917"}
        fontFamily={codeStyle.fontFamily}
        fontSize={codeStyle.fontSize ?? 64}
        fontStyle={getKonvaFontStyle(codeStyle.fontWeight ?? "bold")}
        height={Math.max(1, props.frame.height - labelHeight)}
        letterSpacing={codeStyle.letterSpacing ?? 12}
        padding={8}
        text={runtime?.displayPasscode ?? "••••"}
        verticalAlign={codeStyle.verticalAlign ?? "middle"}
        width={props.frame.width}
        y={labelHeight}
      />
    </Group>
  );
}

function solidPaint(paint: DeckElementPaint) {
  return typeof paint === "string" ? paint : "transparent";
}
