import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { p0AnimationDeck } from "../../rehearsal/presenter/__fixtures__/animationDeck";
import {
  buildSlideBackgroundStyle,
  getActiveHighlightElementIds,
  getRenderableSlideElements,
  ReadOnlySlideCanvas,
  verticalAxisTitleText
} from "./index";

vi.mock("react-konva", () => {
  function attrs(props: Record<string, unknown>) {
    return {
      "data-element-id":
        typeof props["data-element-id"] === "string"
          ? props["data-element-id"]
          : undefined,
      "data-highlight-element-id":
        typeof props["data-highlight-element-id"] === "string"
          ? props["data-highlight-element-id"]
          : undefined,
      "data-opacity":
        typeof props.opacity === "number" ? String(props.opacity) : undefined,
      "data-clip-height":
        typeof props.clipHeight === "number" ? String(props.clipHeight) : undefined,
      "data-clip-width":
        typeof props.clipWidth === "number" ? String(props.clipWidth) : undefined,
      "data-testid":
        typeof props["data-testid"] === "string" ? props["data-testid"] : undefined
    };
  }

  type MockKonvaProps = { children?: ReactNode; [key: string]: any };

  const Group = forwardRef<HTMLDivElement, MockKonvaProps>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...attrs(props)}>
        {children}
      </div>
    )
  );
  const Layer = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Stage = forwardRef<HTMLDivElement, MockKonvaProps>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...attrs(props)}>
        {children}
      </div>
    )
  );
  const Text = ({
    fill,
    fontStyle,
    fontSize,
    rotation,
    text,
    textDecoration,
    width,
    wrap,
    x,
    y
  }: {
    fill?: string;
    fontStyle?: string;
    fontSize?: number;
    rotation?: number;
    text?: string;
    textDecoration?: string;
    width?: number;
    wrap?: string;
    x?: number;
    y?: number;
  }) => (
    <span
      data-fill={fill}
      data-font-style={fontStyle}
      data-font-size={fontSize === undefined ? undefined : String(fontSize)}
      data-rotation={rotation === undefined ? undefined : String(rotation)}
      data-text-decoration={textDecoration}
      data-width={width === undefined ? undefined : String(width)}
      data-wrap={wrap}
      data-x={x === undefined ? undefined : String(x)}
      data-y={y === undefined ? undefined : String(y)}
    >
      {text}
    </span>
  );

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer,
    Line: () => <span data-konva-line="true" />,
    Rect: (props: Record<string, unknown>) => <span {...attrs(props)} />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text
  };
});

function tableCell(text: string, fill: string) {
  return {
    align: "left" as const,
    borderColor: "#CBD5E1",
    borderWidth: 1,
    colSpan: 1,
    fill,
    fontSize: 18,
    fontWeight: "normal" as const,
    rowSpan: 1,
    text,
    verticalAlign: "middle" as const
  };
}

describe("ReadOnlySlideCanvas", () => {
  const slide = p0AnimationDeck.slides[0]!;

  it("uses the same renderable element normalization as editor previews", () => {
    const elements = getRenderableSlideElements(slide, p0AnimationDeck.canvas);

    expect(elements.map((element) => element.elementId)).toContain("el_group");
    expect(elements.map((element) => element.elementId)).toContain("el_group_rect");
    expect(elements.map((element) => element.elementId)).toContain("el_group_label");
    expect(elements.map((element) => element.zIndex)).toEqual(
      [...elements.map((element) => element.zIndex)].sort((left, right) => left - right)
    );
  });

  it("keeps grouped children in their original global layer order", () => {
    const rect = slide.elements.find(
      (element) => element.elementId === "el_group_rect"
    )!;
    const image = slide.elements.find(
      (element) => element.elementId === "el_image"
    )!;
    const group = slide.elements.find(
      (element) => element.elementId === "el_group"
    )!;
    if (group.type !== "group") throw new Error("group fixture is invalid");
    const elements = getRenderableSlideElements(
      {
        ...slide,
        elements: [
          { ...image, zIndex: 2 },
          {
            ...group,
            zIndex: 3,
            props: { childElementIds: [image.elementId, rect.elementId] }
          },
          { ...rect, zIndex: 1 }
        ]
      },
      p0AnimationDeck.canvas
    );

    expect(elements.map((element) => element.elementId)).toEqual([
      rect.elementId,
      image.elementId,
      group.elementId
    ]);
  });

  it("matches editor slide background image behavior", () => {
    const style = buildSlideBackgroundStyle(slide, p0AnimationDeck);

    expect(style.backgroundColor).toBe("#f8fafc");
    expect(String(style.backgroundImage)).toContain("linear-gradient");
    expect(String(style.backgroundImage)).toContain(
      "/api/v1/projects/project_p0/assets/file_bg/content"
    );
    expect(style.backgroundSize).toBe("100% 100%, cover");
  });

  it("renders deck elements and persistent active highlights", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={p0AnimationDeck}
        highlights={[
          { elementId: "el_body", active: true },
          { elementId: "el_body", active: false },
          { elementId: "el_image", active: true }
        ]}
        slide={slide}
      />
    );

    expect(html).toContain("Slideshow Renderer");
    expect(html).toContain("읽기 전용 캔버스");
    expect(html).toContain("data-element-id=\"el_image\"");
    expect(html).toContain("data-highlight-element-id=\"el_image\"");
    expect(html).not.toContain("data-highlight-element-id=\"el_body\"");
  });

  it("applies presentation state to grouped child elements", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={p0AnimationDeck}
        elementStates={{
          el_group_label: {
            opacity: 0,
            visible: false
          }
        }}
        slide={slide}
      />
    );

    expect(html).toContain("data-element-id=\"el_group_label\"");
    expect(html).toContain("data-opacity=\"0\"");
  });

  it("does not render placeholder text for empty groups", () => {
    const emptyGroupSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_empty_group",
          type: "group" as const,
          role: "decoration" as const,
          x: 100,
          y: 120,
          width: 320,
          height: 180,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            childElementIds: []
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas deck={p0AnimationDeck} slide={emptyGroupSlide} />
    );

    expect(html).not.toContain("빈 그룹");
  });

  it("renders styled text runs separately", () => {
    const richSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_rich_text",
          type: "text" as const,
          role: "body" as const,
          x: 100,
          y: 100,
          width: 600,
          height: 120,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            text: "Hello World",
            runs: [
              {
                text: "Hello ",
                baseline: "normal" as const,
                color: "#111827",
                fontSize: 48,
                fontWeight: "bold" as const,
                italic: true
              },
              {
                text: "World",
                baseline: "normal" as const,
                color: "#2563eb",
                fontSize: 36,
                fontWeight: "normal" as const,
                underline: true
              }
            ],
            fontSize: 48,
            fontWeight: "normal" as const,
            align: "left" as const,
            verticalAlign: "top" as const,
            lineHeight: 1.15
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={{ ...p0AnimationDeck, slides: [richSlide] }}
        slide={richSlide}
      />
    );

    expect(html).toContain("data-fill=\"#111827\"");
    expect(html).toContain("data-font-size=\"48\"");
    expect(html).toContain("data-font-style=\"bold italic\"");
    expect(html).toContain("data-fill=\"#2563eb\"");
    expect(html).toContain("data-font-size=\"36\"");
    expect(html).toContain("data-text-decoration=\"underline\"");
    expect(html).toContain("data-clip-height=\"120\"");
    expect(html).toContain("data-clip-width=\"600\"");
  });

  it("renders PPT text paragraphs from paragraph props", () => {
    const paragraphSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_paragraph_text",
          type: "text" as const,
          role: "body" as const,
          x: 100,
          y: 100,
          width: 600,
          height: 240,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            text: "First paragraph\nSecond paragraph",
            paragraphs: [
              {
                text: "First paragraph",
                runs: [
                  {
                    text: "First paragraph",
                    baseline: "normal" as const,
                    fontSize: 40,
                    fontWeight: "bold" as const,
                    color: "#111827"
                  }
                ],
                align: "left" as const,
                lineHeight: 1.1,
                spaceBefore: 0,
                spaceAfter: 12,
                indent: 0
              },
              {
                text: "Second paragraph",
                align: "left" as const,
                lineHeight: 1.2,
                spaceBefore: 0,
                spaceAfter: 0,
                indent: 0
              }
            ],
            fontSize: 36,
            fontWeight: "normal" as const,
            align: "left" as const,
            verticalAlign: "top" as const,
            lineHeight: 1.15
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={{ ...p0AnimationDeck, slides: [paragraphSlide] }}
        slide={paragraphSlide}
      />
    );

    expect(html).toContain("First paragraph");
    expect(html).toContain("Second paragraph");
    expect(html).toContain("data-font-size=\"40\"");
    expect(html).not.toContain("data-width=");
    expect(html).not.toContain("data-wrap=\"none\"");
  });

  it("renders editable table cells", () => {
    const tableSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_table",
          type: "table" as const,
          role: "table" as const,
          x: 100,
          y: 100,
          width: 480,
          height: 180,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            rows: [
              [
                tableCell("A", "#EFF6FF"),
                tableCell("B", "#EFF6FF")
              ],
              [tableCell("C", "transparent"), tableCell("D", "transparent")]
            ],
            columnWidths: [240, 240],
            rowHeights: [90, 90],
            borderColor: "#CBD5E1",
            borderWidth: 1
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={{ ...p0AnimationDeck, slides: [tableSlide] }}
        slide={tableSlide}
      />
    );

    expect(html).toContain("A");
    expect(html).toContain("D");
  });

  it("renders editable SVG media elements", () => {
    const svgSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_svg",
          type: "svg" as const,
          role: "media" as const,
          x: 100,
          y: 100,
          width: 240,
          height: 160,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            alt: "Vector mark",
            fit: "stretch" as const,
            focusX: 0.5,
            focusY: 0.5,
            src: "/assets/vector.svg"
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={{ ...p0AnimationDeck, slides: [svgSlide] }}
        slide={svgSlide}
      />
    );

    expect(html).toContain("Vector mark");
  });

  it("renders editable pattern filled shapes", () => {
    const patternSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_pattern",
          type: "rect" as const,
          role: "decoration" as const,
          x: 100,
          y: 100,
          width: 240,
          height: 160,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            fill: {
              type: "pattern" as const,
              preset: "pct20",
              foreground: "#111827",
              background: "#F59E0B"
            },
            stroke: "transparent" as const,
            strokeWidth: 0,
            borderRadius: 0
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={{ ...p0AnimationDeck, slides: [patternSlide] }}
        slide={patternSlide}
      />
    );

    expect(html).toContain("data-element-id=\"el_pattern\"");
  });

  it("renders editable line chart legends", () => {
    const chartSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_chart",
          type: "chart" as const,
          role: "chart" as const,
          x: 100,
          y: 100,
          width: 640,
          height: 360,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            type: "line" as const,
            title: "Line Chart",
            data: [
              { label: "A", value: 4.3 },
              { label: "B", value: 2.5 },
              { label: "C", value: 3.5 },
              { label: "D", value: 4.5 }
            ],
            style: {
              colors: ["#4F81BD"],
              showLegend: true,
              legendPosition: "right" as const,
              showDataLabels: false,
              showGrid: true,
              xAxisTitle: "",
              yAxisTitle: "",
              unit: ""
            }
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={{ ...p0AnimationDeck, slides: [chartSlide] }}
        slide={chartSlide}
      />
    );

    expect(html).toContain("Line Chart");
    expect(html).toContain("Series 1");
  });

  it("renders vertical PPT text as rotated text", () => {
    const verticalSlide = {
      ...slide,
      elements: [
        {
          elementId: "el_vertical_text",
          type: "text" as const,
          role: "body" as const,
          x: 100,
          y: 100,
          width: 120,
          height: 480,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            text: "VERTICAL",
            fontSize: 36,
            fontWeight: "normal" as const,
            align: "left" as const,
            verticalAlign: "top" as const,
            writingMode: "vertical-270" as const,
            lineHeight: 1.15
          }
        }
      ]
    };
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={{ ...p0AnimationDeck, slides: [verticalSlide] }}
        slide={verticalSlide}
      />
    );

    expect(html).toContain("data-rotation=\"-90\"");
    expect(html).toContain("VERTICAL");
  });

  it("renders active highlights for grouped child elements", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={p0AnimationDeck}
        highlights={[{ elementId: "el_group_label", active: true }]}
        slide={slide}
      />
    );

    expect(html).toContain("data-element-id=\"el_group_label\"");
    expect(html).toContain("data-highlight-element-id=\"el_group_label\"");
  });

  it("does not render grouped child highlights when the parent group is hidden", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySlideCanvas
        deck={p0AnimationDeck}
        elementStates={{
          el_group: {
            opacity: 0,
            visible: false
          }
        }}
        highlights={[{ elementId: "el_group_label", active: true }]}
        slide={slide}
      />
    );

    expect(html).toContain("data-element-id=\"el_group\"");
    expect(html).toContain("data-element-id=\"el_group_label\"");
    expect(html).not.toContain("data-highlight-element-id=\"el_group_label\"");
  });

  it("applies highlight events in order", () => {
    expect(
      [...getActiveHighlightElementIds([
        { elementId: "el_body", active: true },
        { elementId: "el_image", active: true },
        { elementId: "el_body", active: false }
      ])].sort()
    ).toEqual(["el_image"]);
  });

  it("lays out vertical axis titles without rotating their glyphs", () => {
    expect(verticalAxisTitleText("매출액")).toBe("매\n출\n액");
  });
});
