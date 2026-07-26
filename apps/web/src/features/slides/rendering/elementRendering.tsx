import type {
  Chart,
  CustomShapeElementProps,
  Deck,
  DeckElementPaint,
  DeckElement,
  ShapeElementProps,
  TableElementProps,
  Slide,
  TextElementProps
} from "@orbit/shared";
import type Konva from "konva";
import {
  Arrow as KonvaArrowComponent,
  Circle as KonvaCircle,
  Group as KonvaGroup,
  Line as KonvaLine,
  Rect as KonvaRect,
  RegularPolygon as KonvaRegularPolygon,
  Shape as KonvaShape,
  Star as KonvaStarComponent,
  Text as KonvaText
} from "react-konva";
import type { ComponentType } from "react";
import type { ElementPresentationState } from "../../../runtime/presentation/slideshow/elementPresentationState";

import { ImageElementContent } from "./ImageElementContent";
import { ActivityQrElementContent } from "../../activity-slides/rendering/ActivityQrElementContent";
import { ActivityCopyElementContent } from "../../activity-slides/rendering/ActivityCopyElementContent";
import { PresentationPasscodeElementContent } from "../../activity-slides/rendering/PresentationPasscodeElementContent";
import { getTableLayout } from "./tableLayout";
import {
  buildCustomShapePathDataFromNodes,
  getCustomShapeDimension,
  getCustomShapePaint,
  getCustomShapePathData,
  getCustomShapeStrokeWidth
} from "../../editor/canvas/custom-shape/geometry";
import {
  drawCustomShapeScene,
  getCustomShapeDataArray
} from "../../editor/canvas/custom-shape/render";
import {
  getKonvaFontStyle,
  getTextElementLayout
} from "../../editor/canvas/text/textLayout";

type KonvaComponent = ComponentType<any>;

const Circle = KonvaCircle as unknown as KonvaComponent;
const Group = KonvaGroup as unknown as KonvaComponent;
const KonvaArrow = KonvaArrowComponent as unknown as KonvaComponent;
const KonvaStar = KonvaStarComponent as unknown as KonvaComponent;
const Line = KonvaLine as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;
const RegularPolygon = KonvaRegularPolygon as unknown as KonvaComponent;
const Shape = KonvaShape as unknown as KonvaComponent;
const Text = KonvaText as unknown as KonvaComponent;

const officeChartColors = ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2"];

export type SlideElementFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type CustomShapeRenderPreview = {
  closed: boolean;
  elementId: string;
  nodes: CustomShapeElementProps["nodes"];
  selectedNodeIndex: number | null;
};

export function ElementNodeContent(props: {
  accentColor: string;
  activeHighlightElementIds?: Set<string>;
  customShapePreview?: CustomShapeRenderPreview | null;
  deck: Deck;
  element: DeckElement;
  elementStates?: Record<string, ElementPresentationState>;
  frame: SlideElementFrame;
  slide: Slide;
}) {
  const {
    accentColor,
    customShapePreview,
    deck,
    element,
    frame,
    slide
  } = props;

  if (element.type === "text") {
    const textLayout = getTextElementLayout({
      frame,
      props: element.props as TextElementProps,
      slide,
      theme: deck.theme
    });
    const textProps = element.props as TextElementProps;

    let content;

    if (textProps.writingMode === "vertical-270") {
      content = (
        <Text
          align={textProps.align}
          fill={textLayout.color}
          fontFamily={textLayout.fontFamily}
          fontSize={textLayout.fontSize}
          fontStyle={textLayout.fontStyle}
          letterSpacing={textLayout.letterSpacing}
          lineHeight={textLayout.lineHeight}
          listening={false}
          padding={0}
          rotation={-90}
          text={textLayout.text}
          textDecoration={textLayout.textDecoration}
          width={frame.height}
          wrap="word"
          x={0}
          y={frame.height}
        />
      );
    } else if (textLayout.richText) {
      content = (
        <Group listening={false}>
          {textLayout.richText.fragments.map((fragment, index) => (
            <Text
              fill={fragment.style.color}
              fontFamily={fragment.style.fontFamily}
              fontSize={fragment.style.fontSize}
              fontStyle={fragment.style.fontStyle}
              key={`${fragment.paragraphIndex}-${fragment.lineIndex}-${index}`}
              lineHeight={1}
              listening={false}
              letterSpacing={fragment.style.letterSpacing}
              padding={0}
              text={fragment.text}
              textDecoration={fragment.style.underline ? "underline" : undefined}
              x={fragment.x}
              y={fragment.y}
            />
          ))}
        </Group>
      );
    } else {
      content = (
        <Text
          align={textProps.align}
          fill={textLayout.color}
          fontFamily={textLayout.fontFamily}
          fontSize={textLayout.fontSize}
          fontStyle={textLayout.fontStyle}
          letterSpacing={textLayout.letterSpacing}
          lineHeight={textLayout.lineHeight}
          listening={false}
          padding={0}
          text={textLayout.text}
          textDecoration={textLayout.textDecoration}
          width={textLayout.width}
          wrap="word"
          x={textLayout.x}
          y={textLayout.y}
        />
      );
    }

    return (
      <Group
        clipHeight={frame.height}
        clipWidth={frame.width}
        clipX={0}
        clipY={0}
        listening={false}
      >
        {content}
      </Group>
    );
  }

  if (element.type === "image") {
    return (
      <ImageElementContent
        frame={frame}
        imageProps={element.props}
        projectId={deck.projectId}
      />
    );
  }

  if (element.type === "activity-qr") {
    return (
      <ActivityQrElementContent
        activityId={element.props.activityId}
        deckId={deck.deckId}
        frame={frame}
        projectId={deck.projectId}
      />
    );
  }

  if (element.type === "activity-copy") {
    return (
      <ActivityCopyElementContent
        deck={deck}
        elementProps={element.props}
        frame={frame}
        slide={slide}
      />
    );
  }

  if (element.type === "presentation-passcode") {
    return (
      <PresentationPasscodeElementContent
        elementProps={element.props}
        frame={frame}
      />
    );
  }

  if (element.type === "svg") {
    return (
      <ImageElementContent
        frame={frame}
        imageProps={{ ...element.props, fit: "stretch" }}
        projectId={deck.projectId}
      />
    );
  }

  if (element.type === "table") {
    return (
      <TableElementContent
        frame={frame}
        table={element.props as TableElementProps}
      />
    );
  }

  if (element.type === "chart") {
    return (
      <ChartElementContent
        accentColor={accentColor}
        chart={element.props as Chart}
        frame={frame}
      />
    );
  }

  if (element.type === "group") {
    return null;
  }

  if (element.type === "customShape") {
    const customShapeProps = element.props as CustomShapeElementProps;
    const isClosed = customShapePreview?.closed ?? customShapeProps.closed;
    const pathData =
      customShapePreview?.nodes.length
        ? buildCustomShapePathDataFromNodes(customShapePreview.nodes, isClosed)
        : getCustomShapePathData(customShapeProps);
    const dataArray = getCustomShapeDataArray(pathData);
    const fill = getCustomShapePaint(customShapeProps, "fill", "#f5edff");
    const stroke = getCustomShapePaint(customShapeProps, "stroke", "#9333ea");
    const strokeWidth = getCustomShapeStrokeWidth(customShapeProps);
    const strokeProps = getStrokeRenderProps(customShapeProps);
    const viewBoxWidth = getCustomShapeDimension(
      customShapeProps,
      "viewBoxWidth",
      frame.width
    );
    const viewBoxHeight = getCustomShapeDimension(
      customShapeProps,
      "viewBoxHeight",
      frame.height
    );

    if (dataArray.length > 0) {
      return (
        <Group listening={false}>
          <Rect fill="transparent" width={frame.width} height={frame.height} />
          <Shape
            {...getFillRenderProps(isClosed ? customShapeProps.fill : "transparent", {
              fallback: fill,
              height: viewBoxHeight,
              width: viewBoxWidth
            })}
            {...getShadowRenderProps(customShapeProps)}
            fillEnabled={isClosed}
            lineCap={strokeProps.lineCap}
            lineJoin={strokeProps.lineJoin ?? "round"}
            scaleX={frame.width / viewBoxWidth}
            scaleY={frame.height / viewBoxHeight}
            sceneFunc={(context: Konva.Context, shape: Konva.Shape) =>
              drawCustomShapeScene(context, shape, dataArray)
            }
            stroke={stroke}
            strokeWidth={strokeWidth}
            dash={strokeProps.dash}
          />
        </Group>
      );
    }

    return (
      <Group listening={false}>
        <Rect
          cornerRadius={18}
          dash={strokeProps.dash ?? [10, 6]}
          {...getFillRenderProps(customShapeProps.fill, {
            fallback: fill,
            height: frame.height,
            width: frame.width
          })}
          {...getShadowRenderProps(customShapeProps)}
          stroke={stroke}
          strokeWidth={2}
          width={frame.width}
          height={frame.height}
        />
        <Text
          fill="#6b21a8"
          fontSize={16}
          fontStyle="bold"
          text="SVG PATH"
          width={frame.width}
          height={frame.height}
          padding={14}
        />
      </Group>
    );
  }

  if (element.type === "ellipse") {
    const strokeWidth = Math.max(1, element.props.strokeWidth);
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2 - strokeWidth / 2);
    const strokeProps = getStrokeRenderProps(element.props);

    return (
      <Group listening={false}>
        <Circle
          {...getFillRenderProps(element.props.fill, {
            fallback: "transparent",
            height: frame.height,
            width: frame.width
          })}
          {...getShadowRenderProps(element.props)}
          dash={strokeProps.dash}
          lineCap={strokeProps.lineCap}
          lineJoin={strokeProps.lineJoin}
          stroke={getSolidPaint(element.props.stroke, "transparent")}
          strokeWidth={strokeWidth}
          x={frame.width / 2}
          y={frame.height / 2}
          radius={radius}
        />
      </Group>
    );
  }

  if (element.type === "polygon") {
    const polygonProps = element.props as ShapeElementProps & { sides?: number };
    const strokeWidth = Math.max(1, element.props.strokeWidth);
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2 - strokeWidth / 2);
    const sides = polygonProps.sides ?? 3;
    const strokeProps = getStrokeRenderProps(element.props);

    return (
      <Group listening={false}>
        <RegularPolygon
          sides={sides}
          {...getFillRenderProps(element.props.fill, {
            fallback: "transparent",
            height: frame.height,
            width: frame.width
          })}
          {...getShadowRenderProps(element.props)}
          dash={strokeProps.dash}
          lineCap={strokeProps.lineCap}
          lineJoin={strokeProps.lineJoin}
          stroke={getSolidPaint(element.props.stroke, "transparent")}
          strokeWidth={strokeWidth}
          x={frame.width / 2}
          y={frame.height / 2}
          radius={radius}
        />
      </Group>
    );
  }

  if (element.type === "star") {
    const strokeWidth = Math.max(1, element.props.strokeWidth);
    const strokeProps = getStrokeRenderProps(element.props);
    const outerRadius = Math.max(
      1,
      Math.min(frame.width, frame.height) / 2 - strokeWidth / 2
    );

    return (
      <Group listening={false}>
        <KonvaStar
          {...getFillRenderProps(element.props.fill, {
            fallback: "transparent",
            height: frame.height,
            width: frame.width
          })}
          {...getShadowRenderProps(element.props)}
          dash={strokeProps.dash}
          innerRadius={outerRadius * 0.48}
          lineCap={strokeProps.lineCap}
          lineJoin={strokeProps.lineJoin}
          numPoints={5}
          outerRadius={outerRadius}
          stroke={getSolidPaint(element.props.stroke, "transparent")}
          strokeWidth={strokeWidth}
          x={frame.width / 2}
          y={frame.height / 2}
        />
      </Group>
    );
  }

  if (element.type === "ring") {
    const strokeWidth = Math.max(6, element.props.strokeWidth * 4 || 12);
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2 - strokeWidth / 2);
    const strokeProps = getStrokeRenderProps(element.props);

    return (
      <Group listening={false}>
        <Circle
          fill="transparent"
          dash={strokeProps.dash}
          lineCap={strokeProps.lineCap}
          lineJoin={strokeProps.lineJoin}
          radius={radius}
          stroke={getSolidPaint(
            element.props.stroke,
            getSolidPaint(element.props.fill, "#2563eb")
          )}
          strokeWidth={strokeWidth}
          x={frame.width / 2}
          y={frame.height / 2}
        />
      </Group>
    );
  }

  if (element.type === "arrow") {
    const stroke = getSolidPaint(element.props.stroke, "#2563eb");
    const strokeProps = getStrokeRenderProps(element.props);
    const strokeWidth = Math.max(2, element.props.strokeWidth);
    const pointerLength = Math.max(18, Math.min(42, frame.width * 0.1));
    const pointerWidth = Math.max(14, Math.min(30, frame.height * 1.2));

    return (
      <Group listening={false}>
        <Rect fill="transparent" width={frame.width} height={Math.max(20, frame.height)} />
        <KonvaArrow
          fill={stroke}
          dash={strokeProps.dash}
          lineCap={strokeProps.lineCap}
          lineJoin={strokeProps.lineJoin}
          pointerLength={pointerLength}
          pointerWidth={pointerWidth}
          points={[0, frame.height / 2, frame.width, frame.height / 2]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          tension={0}
        />
      </Group>
    );
  }

  if (element.type === "line") {
    const strokeProps = getStrokeRenderProps(element.props);

    return (
      <Group listening={false}>
        <Rect fill="transparent" width={frame.width} height={Math.max(16, frame.height)} />
        <Line
          dash={strokeProps.dash}
          lineCap={strokeProps.lineCap}
          lineJoin={strokeProps.lineJoin}
          points={[0, frame.height / 2, frame.width, frame.height / 2]}
          stroke={getSolidPaint(element.props.stroke, "#2563eb")}
          strokeWidth={Math.max(2, element.props.strokeWidth)}
          tension={0}
        />
      </Group>
    );
  }

  return (
    <Group listening={false}>
      <Rect
        cornerRadius={element.props.borderRadius}
        {...getFillRenderProps(element.props.fill, {
          fallback: "transparent",
          height: frame.height,
          width: frame.width
        })}
        {...getShadowRenderProps(element.props)}
        {...getStrokeRenderProps(element.props)}
        stroke={getSolidPaint(element.props.stroke, "transparent")}
        strokeWidth={element.props.stroke === "transparent" ? 0 : Math.max(1, element.props.strokeWidth)}
        width={frame.width}
        height={frame.height}
      />
    </Group>
  );
}

function ChartElementContent(props: {
  accentColor: string;
  chart: Chart;
  frame: SlideElementFrame;
}) {
  const { accentColor, chart, frame } = props;
  if (chart.type === "pie" || chart.type === "doughnut") {
    return <PieChartContent chart={chart} frame={frame} />;
  }
  if (chart.type === "scatter") {
    return <ScatterChartContent chart={chart} frame={frame} />;
  }

  return <CartesianChartContent accentColor={accentColor} chart={chart} frame={frame} />;
}

function ScatterChartContent(props: {
  chart: Extract<Chart, { type: "scatter" }>;
  frame: SlideElementFrame;
}) {
  const { chart, frame } = props;
  const textColor = chart.style.textColor ?? "#000000";
  const axisLabelFontSize = chart.style.axisLabelFontSize ?? 28;
  const dataLabelFontSize = chart.style.dataLabelFontSize ?? 22;
  const plot = {
    height: frame.height * 0.68,
    width: frame.width * 0.78,
    x: frame.width * 0.14,
    y: frame.height * 0.18
  };
  const xValues = chart.data.map((datum) => datum.x);
  const yValues = chart.data.map((datum) => datum.y);
  const xRange = chartRange(xValues);
  const yRange = chartRange(yValues);
  const tickCount = 5;
  const colors = chart.style.colors.length ? chart.style.colors : officeChartColors;

  return (
    <Group listening={false}>
      <Text
        align="center"
        fill={textColor}
        fontFamily={chart.style.fontFamily}
        fontSize={chart.style.titleFontSize ?? 34}
        fontStyle="bold"
        listening={false}
        text={chart.title || "Scatter chart"}
        width={frame.width}
        y={frame.height * 0.04}
      />
      {Array.from({ length: tickCount + 1 }, (_, index) => {
        const ratio = index / tickCount;
        const x = plot.x + plot.width * ratio;
        const y = plot.y + plot.height - plot.height * ratio;
        const xValue = xRange.min + (xRange.max - xRange.min) * ratio;
        const yValue = yRange.min + (yRange.max - yRange.min) * ratio;
        return (
          <Group key={`scatter-tick-${index}`} listening={false}>
            {chart.style.showGrid !== false ? (
              <>
                <Line points={[x, plot.y, x, plot.y + plot.height]} stroke="#8A8A8A" strokeWidth={1} />
                <Line points={[plot.x, y, plot.x + plot.width, y]} stroke="#8A8A8A" strokeWidth={1} />
              </>
            ) : null}
            <Text
              align="center"
              fill={textColor}
              fontFamily={chart.style.fontFamily}
              fontSize={axisLabelFontSize}
              listening={false}
              text={formatChartValue(xValue, chart.style.unit)}
              width={plot.width / tickCount}
              x={x - plot.width / tickCount / 2}
              y={plot.y + plot.height + 8}
            />
            <Text
              align="right"
              fill={textColor}
              fontFamily={chart.style.fontFamily}
              fontSize={axisLabelFontSize}
              listening={false}
              text={formatChartValue(yValue, chart.style.unit)}
              width={plot.x - 12}
              y={y - axisLabelFontSize / 2}
            />
          </Group>
        );
      })}
      <Line
        points={[plot.x, plot.y, plot.x, plot.y + plot.height, plot.x + plot.width, plot.y + plot.height]}
        stroke="#8A8A8A"
        strokeWidth={1}
      />
      {chart.data.map((datum, index) => {
        const x = plot.x + ((datum.x - xRange.min) / (xRange.max - xRange.min)) * plot.width;
        const y = plot.y + plot.height - ((datum.y - yRange.min) / (yRange.max - yRange.min)) * plot.height;
        const color = colors[index % colors.length] ?? officeChartColors[0];
        return (
          <Group key={`${datum.label ?? "point"}-${index}`} listening={false}>
            <Circle fill={color} radius={7} x={x} y={y} />
            {chart.style.showDataLabels === true ? (
              <Text
                align="center"
                fill={textColor}
                fontFamily={chart.style.fontFamily}
                fontSize={dataLabelFontSize}
                listening={false}
                text={datum.label || `${formatChartTick(datum.x)}, ${formatChartTick(datum.y)}`}
                width={plot.width / Math.max(2, chart.data.length)}
                x={x - plot.width / Math.max(2, chart.data.length) / 2}
                y={y - dataLabelFontSize - 10}
              />
            ) : null}
          </Group>
        );
      })}
      {chart.style.xAxisTitle ? (
        <Text
          align="center"
          fill={textColor}
          fontFamily={chart.style.fontFamily}
          fontSize={axisLabelFontSize}
          listening={false}
          text={chart.style.xAxisTitle}
          width={plot.width}
          x={plot.x}
          y={frame.height - axisLabelFontSize - 4}
        />
      ) : null}
      {chart.style.yAxisTitle ? (
        <Text
          align="center"
          fill={textColor}
          fontFamily={chart.style.fontFamily}
          fontSize={axisLabelFontSize}
          height={plot.height}
          listening={false}
          lineHeight={1}
          text={verticalAxisTitleText(chart.style.yAxisTitle)}
          verticalAlign="middle"
          width={Math.max(axisLabelFontSize * 1.4, plot.x - 8)}
          x={0}
          y={plot.y}
        />
      ) : null}
    </Group>
  );
}

function CartesianChartContent(props: {
  accentColor: string;
  chart: Chart;
  frame: SlideElementFrame;
}) {
  const { accentColor, chart, frame } = props;
  const data = chart.data.filter((datum): datum is { label: string; series?: string; value: number } =>
    "value" in datum
  );
  const categories = Array.from(new Set(data.map((datum) => datum.label)));
  const lineSeries = Array.from(
    data.reduce((groups, datum) => {
      const name = datum.series?.trim() || "Series 1";
      groups.set(name, [...(groups.get(name) ?? []), datum]);
      return groups;
    }, new Map<string, Array<{ label: string; series?: string; value: number }>>())
  );
  const values = data.map((datum) => datum.value);
  const maxValue = niceChartMax(Math.max(1, ...values));
  const isLineChart = chart.type === "line";
  const plot = {
    height: frame.height * 0.716,
    width: frame.width * (isLineChart ? 0.73 : 0.91),
    x: frame.width * 0.0715,
    y: frame.height * 0.185
  };
  const tickCount = 10;
  const slotWidth = plot.width / Math.max(1, categories.length);
  const seriesColor = chart.style.colors[0] ?? officeChartColors[0] ?? accentColor;
  const colors = chart.style.colors.length ? chart.style.colors : officeChartColors;
  const textColor = chart.style.textColor ?? "#000000";
  const axisLabelFontSize = chart.style.axisLabelFontSize ?? 28;
  const dataLabelFontSize = chart.style.dataLabelFontSize ?? 22;
  const legendFontSize = chart.style.legendFontSize ?? 24;

  return (
    <Group listening={false}>
      <Text
        align="center"
        fill={textColor}
        fontFamily={chart.style.fontFamily}
        fontSize={chart.style.titleFontSize ?? 34}
        fontStyle="bold"
        listening={false}
        text={chart.title || `${chart.type} chart`}
        width={frame.width}
        x={0}
        y={frame.height * 0.04}
      />
      {Array.from({ length: tickCount + 1 }, (_, index) => {
        const value = (maxValue * index) / tickCount;
        const y = plot.y + plot.height - (plot.height * value) / maxValue;
        return (
          <Group key={`tick-${index}`} listening={false}>
            {chart.style.showGrid !== false ? (
              <Line
                points={[plot.x, y, plot.x + plot.width, y]}
                stroke="#8A8A8A"
                strokeWidth={1}
              />
            ) : null}
            <Text
              align="right"
              fill={textColor}
              fontFamily={chart.style.fontFamily}
              fontSize={axisLabelFontSize}
              listening={false}
              text={formatChartValue(value, chart.style.unit)}
              width={plot.x - 12}
              x={0}
              y={y - 16}
            />
          </Group>
        );
      })}
      <Line
        points={[plot.x, plot.y, plot.x, plot.y + plot.height, plot.x + plot.width, plot.y + plot.height]}
        stroke="#8A8A8A"
        strokeWidth={1}
      />
      {isLineChart ? (
        <>
          {lineSeries.map(([name, seriesData], index) => (
            <LineChartSeries
              categories={categories}
              data={seriesData}
              key={name}
              maxValue={maxValue}
              plot={plot}
              seriesColor={colors[index % colors.length] ?? seriesColor}
              dataLabelFontSize={dataLabelFontSize}
              fontFamily={chart.style.fontFamily}
              showDataLabels={chart.style.showDataLabels === true}
              textColor={textColor}
              unit={chart.style.unit}
            />
          ))}
        </>
      ) : (
        data.map((datum, index) => {
          const barHeight = (plot.height * datum.value) / maxValue;
          const barWidth = slotWidth * 0.4;
          const x = plot.x + slotWidth * index + (slotWidth - barWidth) / 2;
          const y = plot.y + plot.height - barHeight;
          return (
            <Group key={`${datum.label}-${index}`} listening={false}>
              <Rect
                fill={colors[index % colors.length] ?? seriesColor ?? accentColor}
                height={barHeight}
                listening={false}
                width={barWidth}
                x={x}
                y={y}
              />
              {chart.style.showDataLabels === true ? (
                <Text
                  align="center"
                  fill={textColor}
                  fontFamily={chart.style.fontFamily}
                  fontSize={dataLabelFontSize}
                  listening={false}
                  text={formatChartValue(datum.value, chart.style.unit)}
                  width={slotWidth}
                  x={plot.x + slotWidth * index}
                  y={Math.max(plot.y, y - dataLabelFontSize - 4)}
                />
              ) : null}
            </Group>
          );
        })
      )}
      {categories.map((label, index) => (
        <Text
          align="center"
          fill={textColor}
          fontFamily={chart.style.fontFamily}
          fontSize={axisLabelFontSize}
          key={`${label}-label-${index}`}
          listening={false}
          text={label}
          width={slotWidth}
          x={plot.x + slotWidth * index}
          y={plot.y + plot.height + 20}
        />
      ))}
      {isLineChart && chart.style.showLegend !== false
        ? lineSeries.map(([name], index) => (
            <ChartLegend
              color={colors[index % colors.length] ?? seriesColor}
              frame={frame}
              index={index}
              key={name}
              label={name}
              fontFamily={chart.style.fontFamily}
              fontSize={legendFontSize}
              plot={plot}
              textColor={textColor}
            />
          ))
        : null}
      {chart.style.xAxisTitle ? (
        <Text
          align="center"
          fill={textColor}
          fontFamily={chart.style.fontFamily}
          fontSize={axisLabelFontSize}
          listening={false}
          text={chart.style.xAxisTitle}
          width={plot.width}
          x={plot.x}
          y={frame.height - axisLabelFontSize - 4}
        />
      ) : null}
      {chart.style.yAxisTitle ? (
        <Text
          align="center"
          fill={textColor}
          fontFamily={chart.style.fontFamily}
          fontSize={axisLabelFontSize}
          height={plot.height}
          listening={false}
          lineHeight={1}
          text={verticalAxisTitleText(chart.style.yAxisTitle)}
          verticalAlign="middle"
          width={Math.max(axisLabelFontSize * 1.4, plot.x - 8)}
          x={0}
          y={plot.y}
        />
      ) : null}
    </Group>
  );
}

function LineChartSeries(props: {
  categories: string[];
  data: Array<{ label: string; value: number }>;
  dataLabelFontSize: number;
  fontFamily?: string;
  maxValue: number;
  plot: { height: number; width: number; x: number; y: number };
  seriesColor: string;
  showDataLabels: boolean;
  textColor: string;
  unit: string;
}) {
  const { categories, data, maxValue, plot, seriesColor } = props;
  const slotWidth = plot.width / Math.max(1, categories.length);
  const points = data.flatMap((datum) => [
    plot.x + slotWidth * (Math.max(0, categories.indexOf(datum.label)) + 0.5),
    plot.y + plot.height - (plot.height * datum.value) / maxValue
  ]);

  return (
    <Group listening={false}>
      <Line points={points} stroke={seriesColor} strokeWidth={4} tension={0} />
      {data.map((datum, index) => {
        const x = plot.x + slotWidth * (Math.max(0, categories.indexOf(datum.label)) + 0.5);
        const y = plot.y + plot.height - (plot.height * datum.value) / maxValue;
        return (
          <Group key={`${datum.label}-marker-${index}`} listening={false}>
            <Rect
              fill={seriesColor}
              stroke={seriesColor}
              strokeWidth={1}
              width={10}
              height={10}
              x={x - 5}
              y={y - 5}
            />
            {props.showDataLabels ? (
              <Text
                align="center"
                fill={props.textColor}
                fontFamily={props.fontFamily}
                fontSize={props.dataLabelFontSize}
                listening={false}
                text={formatChartValue(datum.value, props.unit)}
                width={slotWidth}
                x={x - slotWidth / 2}
                y={y - props.dataLabelFontSize - 8}
              />
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}

function ChartLegend(props: {
  color: string;
  fontFamily?: string;
  fontSize: number;
  frame: SlideElementFrame;
  index?: number;
  label: string;
  plot: { height: number; width: number; x: number; y: number };
  textColor: string;
}) {
  const { color, frame, index = 0, label, plot } = props;
  const x = Math.min(frame.width - 170, plot.x + plot.width + frame.width * 0.04);
  const y = plot.y + plot.height * 0.32 + index * 44;

  return (
    <Group listening={false} x={x} y={y}>
      <Line points={[0, 12, 42, 12]} stroke={color} strokeWidth={4} />
      <Rect fill={color} height={18} width={18} x={12} y={3} />
      <Text
        fill={props.textColor}
        fontFamily={props.fontFamily}
        fontSize={props.fontSize}
        listening={false}
        text={label}
        x={56}
        y={-5}
      />
    </Group>
  );
}

function PieChartContent(props: { chart: Chart; frame: SlideElementFrame }) {
  const { chart, frame } = props;
  const data = chart.data.filter((datum): datum is { label: string; value: number } =>
    "value" in datum
  );
  const total = data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0) || 1;
  const showLegend = chart.style.showLegend !== false;
  const radius = Math.min(
    frame.height * 0.36,
    frame.width * (showLegend ? 0.28 : 0.4)
  );
  const center = {
    x: frame.width * (showLegend ? 0.36 : 0.5),
    y: frame.height * 0.57
  };
  const colors = chart.style.colors.length ? chart.style.colors : officeChartColors;
  const textColor = chart.style.textColor ?? "#000000";
  const dataLabelFontSize = chart.style.dataLabelFontSize ?? 22;
  const legendFontSize = chart.style.legendFontSize ?? 24;
  let startAngle = -90;

  return (
    <Group listening={false}>
      <Text
        align="center"
        fill={textColor}
        fontFamily={chart.style.fontFamily}
        fontSize={chart.style.titleFontSize ?? 34}
        fontStyle="bold"
        listening={false}
        text={chart.title || "Pie Chart"}
        width={frame.width}
        x={0}
        y={frame.height * 0.04}
      />
      {data.map((datum, index) => {
        const angle = (Math.max(0, datum.value) / total) * 360;
        const sliceStartAngle = startAngle;
        const sliceEndAngle = startAngle + angle;
        startAngle = sliceEndAngle;
        const middleAngle = ((sliceStartAngle + sliceEndAngle) / 2) * (Math.PI / 180);
        const labelRadius = radius * 0.62;
        return (
          <Group key={`${datum.label}-${index}`} listening={false}>
            <Shape
              fill={colors[index % colors.length]}
              listening={false}
              sceneFunc={(context: Konva.Context, shape: Konva.Shape) => {
                const start = (sliceStartAngle * Math.PI) / 180;
                const end = (sliceEndAngle * Math.PI) / 180;
                context.beginPath();
                context.moveTo(center.x, center.y);
                context.arc(center.x, center.y, radius, start, end, false);
                context.closePath();
                context.fillStrokeShape(shape);
              }}
            />
            {chart.style.showDataLabels === true ? (
              <Text
                align="center"
                fill={textColor}
                fontFamily={chart.style.fontFamily}
                fontSize={dataLabelFontSize}
                listening={false}
                text={formatChartValue(datum.value, chart.style.unit)}
                width={radius}
                x={center.x + Math.cos(middleAngle) * labelRadius - radius / 2}
                y={center.y + Math.sin(middleAngle) * labelRadius - dataLabelFontSize / 2}
              />
            ) : null}
          </Group>
        );
      })}
      {showLegend
        ? data.map((datum, index) => (
            <Group
              key={`${datum.label}-legend-${index}`}
              listening={false}
              x={frame.width * 0.72}
              y={frame.height * 0.22 + index * (legendFontSize + 12)}
            >
              <Rect
                fill={colors[index % colors.length]}
                height={legendFontSize * 0.7}
                width={legendFontSize * 0.7}
                y={legendFontSize * 0.15}
              />
              <Text
                fill={textColor}
                fontFamily={chart.style.fontFamily}
                fontSize={legendFontSize}
                listening={false}
                text={datum.label}
                x={legendFontSize}
              />
            </Group>
          ))
        : null}
    </Group>
  );
}

function niceChartMax(value: number) {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function formatChartTick(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatChartValue(value: number, unit: string) {
  return `${formatChartTick(value)}${unit}`;
}

export function verticalAxisTitleText(value: string) {
  return Array.from(value).join("\n");
}

function chartRange(values: number[]) {
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

function TableElementContent(props: {
  frame: SlideElementFrame;
  table: TableElementProps;
}) {
  const { frame, table } = props;
  const layout = getTableLayout(table, frame);

  return (
    <Group listening={false}>
      {layout.cells.map(
        ({ cell, columnIndex, height, rowIndex, width, x, y }) =>
          (
            <Group key={`${rowIndex}-${columnIndex}`} listening={false} x={x} y={y}>
              <Rect
                {...getFillRenderProps(cell.fill ?? "transparent", {
                  fallback: "transparent",
                  height,
                  width
                })}
                stroke={cell.borderColor ?? table.borderColor}
                strokeWidth={cell.borderWidth ?? table.borderWidth}
                width={width}
                height={height}
              />
              <Text
                align={cell.align ?? "left"}
                fill={cell.textColor ?? "#111827"}
                fontFamily={cell.fontFamily}
                fontSize={cell.fontSize ?? 18}
                fontStyle={getKonvaFontStyle(cell.fontWeight ?? "normal")}
                height={Math.max(1, height - 12)}
                listening={false}
                padding={6}
                text={cell.text ?? ""}
                verticalAlign={cell.verticalAlign ?? "middle"}
                width={Math.max(1, width - 12)}
              />
            </Group>
          )
      )}
    </Group>
  );
}

function getSolidPaint(paint: DeckElementPaint | undefined, fallback: string) {
  if (!paint || paint === "transparent") {
    return paint === "transparent" ? "transparent" : fallback;
  }

  if (typeof paint === "string") {
    return paint;
  }

  if (paint.type === "pattern") {
    return paint.foreground;
  }

  return paint.stops[0]?.color ?? fallback;
}

function getFillRenderProps(
  paint: DeckElementPaint | undefined,
  frame: { fallback: string; height: number; width: number }
) {
  if (!paint || typeof paint === "string") {
    return { fill: getSolidPaint(paint, frame.fallback) };
  }

  if (paint.type === "pattern") {
    return getPatternFillRenderProps(paint);
  }

  const radians = (paint.angle * Math.PI) / 180;
  const length = Math.max(frame.width, frame.height);
  const dx = Math.cos(radians) * length * 0.5;
  const dy = Math.sin(radians) * length * 0.5;

  return {
    fillLinearGradientColorStops: paint.stops.flatMap((stop) => [
      stop.offset,
      stop.opacity < 1 ? withOpacity(stop.color, stop.opacity) : stop.color
    ]),
    fillLinearGradientEndPoint: {
      x: frame.width / 2 + dx,
      y: frame.height / 2 + dy
    },
    fillLinearGradientStartPoint: {
      x: frame.width / 2 - dx,
      y: frame.height / 2 - dy
    }
  };
}

function getPatternFillRenderProps(
  paint: Extract<DeckElementPaint, { type: "pattern" }>
) {
  const pattern = createPatternCanvas(paint);
  if (!pattern) {
    return { fill: paint.background };
  }

  return {
    fill: paint.background,
    fillPatternImage: pattern,
    fillPatternRepeat: "repeat"
  };
}

function createPatternCanvas(
  paint: Extract<DeckElementPaint, { type: "pattern" }>
) {
  if (typeof document === "undefined") {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 12;
  canvas.height = 12;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.fillStyle = paint.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = paint.foreground;
  context.fillStyle = paint.foreground;
  context.lineWidth = 2;

  const preset = paint.preset.toLowerCase();
  const isDiagonalPattern = preset.includes("diag") || preset === "pct20";
  if (isDiagonalPattern) {
    context.lineWidth = preset === "pct20" ? 1 : 2;
    context.globalAlpha = preset === "pct20" ? 0.42 : 1;
    context.beginPath();
    for (let offset = -12; offset <= 24; offset += 6) {
      context.moveTo(offset, 12);
      context.lineTo(offset + 12, 0);
    }
    context.stroke();
    context.globalAlpha = 1;
    return canvas;
  }

  context.globalAlpha = preset.includes("pct") ? 0.55 : 1;
  context.fillRect(2, 2, 3, 3);
  context.fillRect(8, 8, 3, 3);
  context.globalAlpha = 1;
  return canvas;
}

function getStrokeRenderProps(props: ShapeElementProps | CustomShapeElementProps) {
  return {
    dash: props.dash,
    lineCap: props.lineCap,
    lineJoin: props.lineJoin
  };
}

function getShadowRenderProps(props: ShapeElementProps | CustomShapeElementProps) {
  if (!props.shadow) {
    return {};
  }

  return {
    shadowBlur: props.shadow.blur,
    shadowColor: props.shadow.color,
    shadowOffsetX: props.shadow.offsetX,
    shadowOffsetY: props.shadow.offsetY,
    shadowOpacity: props.shadow.opacity
  };
}

function withOpacity(color: string, opacity: number) {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}
