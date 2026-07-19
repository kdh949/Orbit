import {
  textElementPropsSchema,
  type TextElementParagraph,
  type TextElementProps,
  type TextElementRun
} from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  applyRichTextCharacterStyle,
  applyRichTextParagraphStyle,
  getRichTextSemanticText,
  getRichTextSelectionCharacterStyle,
  getRichTextSelectionParagraphStyle,
  normalizeRichTextProps
} from "./richTextOperations";

function props(overrides: Partial<TextElementProps> = {}): TextElementProps {
  return {
    align: "left",
    fontSize: 24,
    fontWeight: "normal",
    lineHeight: 1.2,
    text: "",
    verticalAlign: "top",
    ...overrides
  };
}

function run(text: string, overrides: Partial<TextElementRun> = {}): TextElementRun {
  return { baseline: "normal", text, ...overrides };
}

function paragraph(
  text: string,
  overrides: Partial<TextElementParagraph> = {}
): TextElementParagraph {
  return {
    align: "left",
    indent: 0,
    lineHeight: 1.2,
    spaceAfter: 0,
    spaceBefore: 0,
    text,
    ...overrides
  };
}

function expectSchemaValid(value: TextElementProps) {
  expect(textElementPropsSchema.safeParse(value).success).toBe(true);
}

describe("normalizeRichTextProps", () => {
  it("adapts legacy plain text to one canonical paragraph and runs mirror", () => {
    const legacy = props({
      align: "center",
      bullet: { character: "•", enabled: true, indent: 18 },
      color: "#1D4ED8",
      italic: true,
      lineHeight: 1.4,
      text: "Legacy plain"
    });

    const normalized = normalizeRichTextProps(legacy);

    expect(normalized.text).toBe("Legacy plain");
    expect(normalized.paragraphs).toEqual([
      expect.objectContaining({
        align: "center",
        bullet: legacy.bullet,
        lineHeight: 1.4,
        text: "Legacy plain",
        runs: [run("Legacy plain")]
      })
    ]);
    expect(normalized.runs).toEqual(normalized.paragraphs?.[0]?.runs);
    expect(legacy.paragraphs).toBeUndefined();
    expectSchemaValid(normalized);
  });

  it("projects the same semantic text before and after style-only canonicalization", () => {
    const legacy = props({ text: "Same text" });
    const canonical = applyRichTextCharacterStyle(
      legacy,
      { end: 4, start: 0 },
      { italic: true }
    );

    expect(getRichTextSemanticText(legacy)).toBe("Same text");
    expect(getRichTextSemanticText(canonical)).toBe("Same text");
  });

  it("adapts runs-only text and removes empty or duplicate-style run boundaries", () => {
    const legacy = props({
      runs: [
        run("Hello", { color: "#DC2626", fontWeight: "bold" }),
        run(""),
        run(" ", { color: "#DC2626", fontWeight: "bold" }),
        run("World", { color: "#2563EB" })
      ],
      text: "stale"
    });

    const normalized = normalizeRichTextProps(legacy);

    expect(normalized.text).toBe("Hello World");
    expect(normalized.paragraphs?.[0]?.runs).toEqual([
      run("Hello ", { color: "#DC2626", fontWeight: "bold" }),
      run("World", { color: "#2563EB" })
    ]);
    expect(normalized.runs).toEqual(normalized.paragraphs?.[0]?.runs);
    expectSchemaValid(normalized);
  });

  it("keeps paragraphs authoritative and preserves empty paragraph boundaries", () => {
    const source = props({
      paragraphs: [
        paragraph("stale", { runs: [run("Hello", { italic: true })] }),
        paragraph(""),
        paragraph("World")
      ],
      runs: [run("legacy mirror")],
      text: "stale projection"
    });

    const normalized = normalizeRichTextProps(source);

    expect(normalized.text).toBe("Hello\n\nWorld");
    expect(normalized.paragraphs?.map((item) => item.text)).toEqual([
      "Hello",
      "",
      "World"
    ]);
    expect(normalized.paragraphs?.[2]?.runs).toEqual([run("World")]);
    expect(normalized.runs).toBeUndefined();
    expectSchemaValid(normalized);
  });

  it("keeps an explicitly empty canonical paragraph list safe for selection state", () => {
    const source = props({
      align: "right",
      lineHeight: 1.5,
      paragraphs: [],
      text: "stale"
    });

    const normalized = normalizeRichTextProps(source);
    const style = getRichTextSelectionParagraphStyle(normalized, {
      end: 0,
      start: 0
    });

    expect(normalized).toMatchObject({ paragraphs: [], text: "" });
    expect(normalized.runs).toBeUndefined();
    expect(style.align).toEqual({ mixed: false, value: "right" });
    expect(style.lineHeight).toEqual({ mixed: false, value: 1.5 });
    expectSchemaValid(normalized);
  });
});

describe("applyRichTextCharacterStyle", () => {
  it("styles a Korean UTF-16 range while preserving surrounding run styles", () => {
    const source = props({
      paragraphs: [
        paragraph("가나다", {
          runs: [run("가나다", { color: "#111827", fontWeight: "normal" })]
        })
      ],
      text: "가나다"
    });

    const updated = applyRichTextCharacterStyle(
      source,
      { end: 2, start: 1 },
      {
        color: "#DC2626",
        fontSize: 32,
        fontWeight: "bold",
        italic: true,
        underline: true
      }
    );

    expect(updated.paragraphs?.[0]?.runs).toEqual([
      run("가", { color: "#111827", fontWeight: "normal" }),
      run("나", {
        color: "#DC2626",
        fontSize: 32,
        fontWeight: "bold",
        italic: true,
        underline: true
      }),
      run("다", { color: "#111827", fontWeight: "normal" })
    ]);
    expect(updated.text).toBe("가나다");
    expect(updated.runs).toEqual(updated.paragraphs?.[0]?.runs);
    expectSchemaValid(updated);
  });

  it("expands UTF-16 boundaries inside a surrogate pair without corrupting text", () => {
    const source = props({ text: "A😀B" });

    const updated = applyRichTextCharacterStyle(
      source,
      { end: 2, start: 1 },
      { underline: true }
    );

    expect(updated.paragraphs?.[0]?.runs).toEqual([
      run("A"),
      run("😀", { underline: true }),
      run("B")
    ]);
    expect(updated.text).toBe("A😀B");
    expect(Array.from(updated.text)).toEqual(["A", "😀", "B"]);
    expectSchemaValid(updated);
  });

  it("preserves paragraph boundaries when a range crosses newlines", () => {
    const source = props({
      paragraphs: [
        paragraph("One", { runs: [run("One", { color: "#111827" })] }),
        paragraph("Two", { runs: [run("Two", { color: "#2563EB" })] }),
        paragraph("Three", { runs: [run("Three", { color: "#16A34A" })] })
      ],
      text: "One\nTwo\nThree"
    });

    const updated = applyRichTextCharacterStyle(
      source,
      { end: 6, start: 1 },
      { italic: true }
    );

    expect(updated.text).toBe("One\nTwo\nThree");
    expect(updated.paragraphs?.[0]?.runs).toEqual([
      run("O", { color: "#111827" }),
      run("ne", { color: "#111827", italic: true })
    ]);
    expect(updated.paragraphs?.[1]?.runs).toEqual([
      run("Tw", { color: "#2563EB", italic: true }),
      run("o", { color: "#2563EB" })
    ]);
    expect(updated.paragraphs?.[2]?.runs).toEqual([
      run("Three", { color: "#16A34A" })
    ]);
    expect(updated.runs).toBeUndefined();
    expectSchemaValid(updated);
  });

  it("merges equal-style neighbors and never emits empty runs", () => {
    const source = props({
      paragraphs: [
        paragraph("Already bold", {
          runs: [run("Already bold", { fontWeight: "bold" })]
        })
      ],
      text: "Already bold"
    });

    const updated = applyRichTextCharacterStyle(
      source,
      { end: 7, start: 0 },
      { fontWeight: "bold" }
    );

    expect(updated.paragraphs?.[0]?.runs).toEqual([
      run("Already bold", { fontWeight: "bold" })
    ]);
    expect(updated.paragraphs?.[0]?.runs?.every((item) => item.text.length > 0)).toBe(
      true
    );
  });
});

describe("rich text selection style", () => {
  it("returns effective inherited values for a uniform selection", () => {
    const source = props({
      color: "#111827",
      fontFamily: "Pretendard",
      fontSize: 26,
      italic: true,
      paragraphs: [
        paragraph("Uniform", {
          runs: [run("Uniform", { fontWeight: "bold", underline: true })]
        })
      ],
      text: "Uniform"
    });

    const style = getRichTextSelectionCharacterStyle(source, {
      end: 7,
      start: 0
    });

    expect(style).toMatchObject({
      baseline: { mixed: false, value: "normal" },
      color: { mixed: false, value: "#111827" },
      fontFamily: { mixed: false, value: "Pretendard" },
      fontSize: { mixed: false, value: 26 },
      fontWeight: { mixed: false, value: "bold" },
      italic: { mixed: false, value: true },
      underline: { mixed: false, value: true }
    });
  });

  it("reports mixed fields and uses the previous run at a collapsed boundary", () => {
    const source = props({
      paragraphs: [
        paragraph("Boldplain", {
          runs: [
            run("Bold", { fontWeight: "bold" }),
            run("plain", { fontWeight: "normal" })
          ]
        })
      ],
      text: "Boldplain"
    });

    const mixed = getRichTextSelectionCharacterStyle(source, {
      end: 9,
      start: 0
    });
    const caret = getRichTextSelectionCharacterStyle(source, {
      end: 4,
      start: 4
    });

    expect(mixed.fontWeight).toEqual({ mixed: true, value: undefined });
    expect(mixed.italic).toEqual({ mixed: false, value: false });
    expect(caret.fontWeight).toEqual({ mixed: false, value: "bold" });
  });
});

describe("paragraph range operations", () => {
  it("applies align, bullet, and line height only to touched paragraphs", () => {
    const source = props({
      paragraphs: [paragraph("One"), paragraph("Two"), paragraph("Three")],
      text: "One\nTwo\nThree"
    });
    const bullet = { character: "–", enabled: true, indent: 24 };

    const updated = applyRichTextParagraphStyle(
      source,
      { end: 6, start: 1 },
      { align: "center", bullet, lineHeight: 1.6 }
    );

    expect(updated.paragraphs?.[0]).toMatchObject({
      align: "center",
      bullet,
      lineHeight: 1.6
    });
    expect(updated.paragraphs?.[1]).toMatchObject({
      align: "center",
      bullet,
      lineHeight: 1.6
    });
    expect(updated.paragraphs?.[2]).toMatchObject({
      align: "left",
      lineHeight: 1.2
    });
    expect(updated.paragraphs?.[2]?.bullet).toBeUndefined();
    expect(updated.text).toBe("One\nTwo\nThree");
    expectSchemaValid(updated);
  });

  it("reports mixed paragraph style across the selected range", () => {
    const source = props({
      paragraphs: [
        paragraph("One", { align: "left", lineHeight: 1.2 }),
        paragraph("Two", {
          align: "center",
          bullet: { character: "•", enabled: true, indent: 12 },
          lineHeight: 1.5
        })
      ],
      text: "One\nTwo"
    });

    const style = getRichTextSelectionParagraphStyle(source, {
      end: 7,
      start: 0
    });

    expect(style.align).toEqual({ mixed: true, value: undefined });
    expect(style.lineHeight).toEqual({ mixed: true, value: undefined });
    expect(style.bullet).toEqual({ mixed: true, value: undefined });
  });

  it("applies numbering, indentation, and paragraph spacing to the selection", () => {
    const source = props({
      paragraphs: [paragraph("One"), paragraph("Two")],
      text: "One\nTwo"
    });
    const bullet = {
      character: "•",
      enabled: true,
      indent: 28,
      kind: "number" as const,
      numberStyle: "upper-alpha" as const,
      startAt: 2
    };

    const updated = applyRichTextParagraphStyle(
      source,
      { end: 3, start: 0 },
      { bullet, indent: 12, spaceAfter: 8, spaceBefore: 4 }
    );

    expect(updated.paragraphs?.[0]).toMatchObject({
      bullet,
      indent: 12,
      spaceAfter: 8,
      spaceBefore: 4
    });
    expect(updated.paragraphs?.[1]).toMatchObject({
      indent: 0,
      spaceAfter: 0,
      spaceBefore: 0
    });
    expectSchemaValid(updated);
  });
});

describe("extended character styles", () => {
  it("applies and removes highlight and hyperlink without changing text", () => {
    const source = props({ text: "Orbit editor" });
    const styled = applyRichTextCharacterStyle(
      source,
      { end: 5, start: 0 },
      { highlightColor: "#FEF08A", hyperlink: "https://example.com" }
    );

    expect(styled.paragraphs?.[0]?.runs?.[0]).toMatchObject({
      highlightColor: "#FEF08A",
      hyperlink: "https://example.com",
      text: "Orbit"
    });
    expect(getRichTextSemanticText(styled)).toBe("Orbit editor");

    const cleared = applyRichTextCharacterStyle(
      styled,
      { end: 5, start: 0 },
      { highlightColor: null, hyperlink: null }
    );
    expect(cleared.paragraphs?.[0]?.runs?.[0]?.highlightColor).toBeUndefined();
    expect(cleared.paragraphs?.[0]?.runs?.[0]?.hyperlink).toBeUndefined();
    expectSchemaValid(cleared);
  });
});
