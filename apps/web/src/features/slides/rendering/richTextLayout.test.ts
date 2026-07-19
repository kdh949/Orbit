import type { TextElementProps } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";
import {
  richTextLayout,
  type RichTextFragmentStyle,
  type RichTextMeasure
} from "./richTextLayout";

const baseStyle = {
  color: "#111827",
  fontFamily: "Pretendard",
  fontSize: 20,
  fontWeight: "normal" as const,
  italic: false,
  underline: false
};

function props(overrides: Partial<TextElementProps>): TextElementProps {
  return {
    align: "left",
    fontSize: 20,
    fontWeight: "normal",
    lineHeight: 1.2,
    text: "",
    verticalAlign: "top",
    ...overrides
  };
}

const fixedMeasure: RichTextMeasure = (text) => Array.from(text).length * 10;

describe("richTextLayout", () => {
  it("preserves mixed run font, emphasis, decoration, color, and baseline", () => {
    const measureText = vi.fn(
      (text: string, _style: RichTextFragmentStyle) =>
        Array.from(text).length * 10
    );
    const result = richTextLayout({
      baseStyle,
      frame: { height: 120, width: 420 },
      measureText,
      props: props({
        paragraphs: [
          {
            align: "left",
            indent: 0,
            lineHeight: 1.2,
            runs: [
              {
                baseline: "normal",
                color: "#DC2626",
                fontFamily: "Aptos",
                fontSize: 24,
                fontWeight: "bold",
                italic: true,
                text: "Bold"
              },
              {
                baseline: "superscript",
                color: "#2563EB",
                fontFamily: "Arial",
                fontSize: 18,
                text: "Super",
                underline: true
              }
            ],
            spaceAfter: 0,
            spaceBefore: 0,
            text: "BoldSuper"
          }
        ],
        text: "BoldSuper"
      })
    });

    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[0]?.style).toMatchObject({
      color: "#DC2626",
      fontFamily: "Aptos",
      fontSize: 24,
      fontStyle: "bold italic",
      italic: true,
      underline: false
    });
    expect(result.fragments[1]?.style).toMatchObject({
      baseline: "superscript",
      color: "#2563EB",
      fontFamily: "Arial",
      fontSize: 18,
      fontStyle: "normal",
      underline: true
    });
    expect(measureText).toHaveBeenCalledWith(
      "Bold",
      expect.objectContaining({ fontFamily: "Aptos", italic: true })
    );
  });

  it("applies body inset, bullet indent, center alignment, and paragraph spacing", () => {
    const result = richTextLayout({
      baseStyle,
      frame: { height: 160, width: 200 },
      measureText: fixedMeasure,
      props: props({
        bodyInset: { bottom: 8, left: 10, right: 10, top: 8 },
        paragraphs: [
          {
            align: "center",
            bullet: { character: "•", enabled: true, indent: 30 },
            indent: 20,
            lineHeight: 1.5,
            runs: [{ baseline: "normal", text: "alpha beta" }],
            spaceAfter: 7,
            spaceBefore: 5,
            text: "alpha beta"
          }
        ],
        text: "alpha beta"
      })
    });

    expect(result.innerX).toBe(10);
    expect(result.innerWidth).toBe(180);
    expect(result.lineBoxes[0]).toMatchObject({
      align: "center",
      availableWidth: 150,
      height: 30,
      width: 120,
      x: 55,
      y: 13
    });
    expect(result.fragments[0]).toMatchObject({ text: "• alpha beta", x: 55 });
    expect(result.totalContentHeight).toBe(42);
  });

  it("wraps at word boundaries and preserves explicit newlines", () => {
    const result = richTextLayout({
      baseStyle,
      frame: { height: 180, width: 72 },
      measureText: fixedMeasure,
      props: props({
        runs: [
          {
            baseline: "normal",
            text: "Hello world\nNext"
          }
        ],
        text: "Hello world\nNext"
      })
    });

    expect(result.lineBoxes).toHaveLength(3);
    expect(
      result.lineBoxes.map((line) =>
        line.fragments.map((fragment) => fragment.text).join("")
      )
    ).toEqual(["Hello", "world", "Next"]);
    expect(result.lineBoxes.map((line) => line.hardBreak)).toEqual([
      false,
      true,
      false
    ]);
  });

  it("preserves intentional indentation after an explicit newline", () => {
    const result = richTextLayout({
      baseStyle,
      frame: { height: 180, width: 200 },
      measureText: fixedMeasure,
      props: props({
        bodyInset: { bottom: 0, left: 0, right: 0, top: 0 },
        runs: [
          {
            baseline: "normal",
            text: "첫째 줄\n   둘째 줄"
          }
        ],
        text: "첫째 줄\n   둘째 줄"
      })
    });

    expect(
      result.lineBoxes.map((line) =>
        line.fragments.map((fragment) => fragment.text).join("")
      )
    ).toEqual(["첫째 줄", "   둘째 줄"]);
    expect(result.lineBoxes[1]?.width).toBe(70);
    expect(result.lineBoxes[1]?.fragments[0]).toMatchObject({
      text: "   둘째 줄",
      x: 0
    });
  });

  it("justifies wrapped non-final lines while leaving the final line ragged", () => {
    const result = richTextLayout({
      baseStyle,
      frame: { height: 160, width: 118 },
      measureText: fixedMeasure,
      props: props({
        paragraphs: [
          {
            align: "justify",
            indent: 0,
            lineHeight: 1.2,
            runs: [{ baseline: "normal", text: "one two three" }],
            spaceAfter: 0,
            spaceBefore: 0,
            text: "one two three"
          }
        ],
        text: "one two three"
      })
    });

    expect(result.lineBoxes).toHaveLength(2);
    expect(result.lineBoxes[0]?.width).toBe(110);
    expect(result.lineBoxes[0]?.fragments[1]?.width).toBe(50);
    expect(result.lineBoxes[1]?.width).toBe(50);
  });

  it("positions superscript and subscript around the shared baseline", () => {
    const result = richTextLayout({
      baseStyle,
      frame: { height: 120, width: 300 },
      measureText: fixedMeasure,
      props: props({
        bodyInset: { bottom: 0, left: 0, right: 0, top: 0 },
        paragraphs: [
          {
            align: "left",
            indent: 0,
            lineHeight: 1.2,
            runs: [
              { baseline: "normal", text: "N" },
              { baseline: "superscript", text: "S" },
              { baseline: "subscript", text: "B" }
            ],
            spaceAfter: 0,
            spaceBefore: 0,
            text: "NSB"
          }
        ],
        text: "NSB",
        verticalAlign: "bottom"
      })
    });
    const [normal, superscript, subscript] = result.fragments;

    expect(result.lineBoxes[0]?.height).toBe(30);
    expect(result.contentY).toBe(90);
    expect(superscript?.y).toBeLessThan(normal?.y ?? 0);
    expect(subscript?.y).toBeGreaterThan(normal?.y ?? Number.POSITIVE_INFINITY);
  });
});
