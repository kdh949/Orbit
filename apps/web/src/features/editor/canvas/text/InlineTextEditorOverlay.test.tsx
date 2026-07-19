import fs from "node:fs";
import path from "node:path";
import { createDemoDeck, normalizeRichTextProps } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InlineTextEditorOverlay } from "./InlineTextEditorOverlay";

function getRichTextFixture() {
  const deck = createDemoDeck();
  const slide = deck.slides[0]!;
  const source = slide.elements.find((candidate) => candidate.type === "text");
  if (!source || source.type !== "text") {
    throw new Error("text fixture is required");
  }

  const firstParagraphText = "A😀 <script>alert(1)</script>";
  const secondParagraphText = "둘째 줄";
  const element = {
    ...source,
    props: normalizeRichTextProps({
      ...source.props,
      paragraphs: [
        {
          align: "left",
          indent: 0,
          lineHeight: 1.2,
          runs: [
            {
              baseline: "normal",
              fontWeight: "bold",
              text: "A😀",
            },
            {
              baseline: "normal",
              italic: true,
              text: " <script>alert(1)</script>",
            },
          ],
          spaceAfter: 0,
          spaceBefore: 0,
          text: firstParagraphText,
        },
        {
          align: "right",
          indent: 0,
          lineHeight: 1.4,
          runs: [
            {
              baseline: "normal",
              text: secondParagraphText,
              underline: true,
            },
          ],
          spaceAfter: 0,
          spaceBefore: 0,
          text: secondParagraphText,
        },
      ],
      text: `${firstParagraphText}\n${secondParagraphText}`,
    }),
  };

  return { deck, element, slide };
}

describe("InlineTextEditorOverlay", () => {
  it("keeps the editing surface transparent so slide colors remain visible", () => {
    const editorCss = fs.readFileSync(
      path.join(process.cwd(), "src/features/editor/editor-shell.css"),
      "utf8",
    );
    const rule = editorCss.match(/\.inline-text-editor\s*\{([\s\S]*?)\}/)?.[1];

    expect(rule).toContain("background: transparent;");
    expect(rule).toContain("caret-color: currentColor;");
    expect(rule).toContain("outline: 2px solid var(--redesign-color-primary);");
    expect(rule).toContain("overflow-wrap: anywhere;");
    expect(rule).toContain("word-break: keep-all;");
    expect(rule).not.toContain("border: 2px solid");
    expect(rule).not.toContain("word-break: break-word;");
    expect(rule).not.toContain("color-scheme: light;");
  });

  it("renders an accessible uncontrolled contentEditable tree from canonical paragraphs and runs", () => {
    const { deck, element, slide } = getRichTextFixture();

    const html = renderToStaticMarkup(
      <InlineTextEditorOverlay
        deck={deck}
        element={element}
        slide={slide}
        stageScale={1}
        onCommitProps={vi.fn()}
        onFinishEditing={vi.fn()}
      />,
    );

    expect(html).toMatch(/contenteditable="true"/i);
    expect(html).toContain('role="textbox"');
    expect(html).toContain('aria-multiline="true"');
    expect(html).toContain('data-text-paragraph-index="0"');
    expect(html).toContain('data-text-paragraph-index="1"');
    expect(html.match(/data-text-run-index=/g)).toHaveLength(3);
    expect(html).toContain("padding-left:4px");
    expect(html).toContain("padding-top:4px");
    expect(html).toContain("A😀");
    expect(html).toContain("둘째 줄");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<textarea");
    expect(html).not.toMatch(/\svalue=/i);
  });

  it("renders explicit blank lines and intentional line-leading indentation", () => {
    const { deck, element, slide } = getRichTextFixture();
    if (element.type !== "text") throw new Error("text fixture is required");
    element.props = normalizeRichTextProps({
      ...element.props,
      paragraphs: [
        {
          align: "left",
          indent: 0,
          lineHeight: 1.15,
          runs: [
            {
              baseline: "normal",
              fontWeight: "bold",
              text: "발표의 모든 순간을  \n \n                  하나의  궤도로   ",
            },
          ],
          spaceAfter: 0,
          spaceBefore: 0,
          text: "stale",
        },
      ],
      text: "stale",
    });

    const html = renderToStaticMarkup(
      <InlineTextEditorOverlay
        deck={deck}
        element={element}
        slide={slide}
        stageScale={1}
        onCommitProps={vi.fn()}
        onFinishEditing={vi.fn()}
      />,
    );

    expect(html).toContain(
      ">발표의 모든 순간을  \n \n                  하나의  궤도로   </span>",
    );
  });
});
