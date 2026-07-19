import { createDemoDeck } from "@orbit/editor-core";
import type { Deck, TextElementProps } from "@orbit/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  commitTextContextToolbarAction,
  getTextContextToolbarFontOptions,
  getTextContextToolbarPlacement,
  TextContextToolbar,
} from "./TextContextToolbar";

function getTextFixture() {
  const deck = createDemoDeck();
  const slide = deck.slides[0]!;
  const element = slide.elements.find((candidate) => candidate.type === "text");
  if (!element || element.type !== "text") {
    throw new Error("text fixture is required");
  }
  return { deck, element, slide };
}

describe("getTextContextToolbarPlacement", () => {
  it.each([0.5, 1, 2])(
    "keeps a rotated anchor inside the viewport at %sx zoom",
    (stageScale) => {
      const placement = getTextContextToolbarPlacement({
        element: {
          height: 90,
          rotation: 37,
          width: 260,
          x: 310,
          y: 180,
        },
        stageRect: { left: 24, top: 18 },
        stageScale,
        toolbarSize: { height: 44, width: 280 },
        viewportSize: { height: 520, width: 640 },
      });

      expect(placement.left).toBeGreaterThanOrEqual(12);
      expect(placement.left + 280).toBeLessThanOrEqual(628);
      expect(placement.top).toBeGreaterThanOrEqual(12);
      expect(placement.top + 44).toBeLessThanOrEqual(508);
    },
  );

  it("flips below the text when the viewport has no room above", () => {
    const placement = getTextContextToolbarPlacement({
      element: {
        height: 50,
        rotation: 0,
        width: 180,
        x: 40,
        y: 2,
      },
      stageRect: { left: 0, top: 0 },
      stageScale: 1,
      toolbarSize: { height: 44, width: 240 },
      viewportSize: { height: 300, width: 360 },
    });

    expect(placement.side).toBe("below");
    expect(placement.top).toBe(60);
  });
});

describe("getTextContextToolbarFontOptions", () => {
  it("shows loaded fonts and preserves an unavailable imported family as disabled", () => {
    expect(
      getTextContextToolbarFontOptions({
        currentFontFamily: "Aptos Display",
        isImported: true,
        loadedFontFamilies: ["Pretendard", "Pretendard"],
      }),
    ).toEqual([
      { available: true, family: "Pretendard" },
      { available: false, family: "Aptos Display" },
    ]);
  });

  it("does not present an unavailable non-imported family as a loaded option", () => {
    expect(
      getTextContextToolbarFontOptions({
        currentFontFamily: "Inter",
        isImported: false,
        loadedFontFamilies: ["Pretendard"],
      }),
    ).toEqual([{ available: true, family: "Pretendard" }]);
  });
});

describe("commitTextContextToolbarAction", () => {
  it("uses a direct element update without an active range and commits once", () => {
    const { element } = getTextFixture();
    const onCommitProps = vi.fn();

    commitTextContextToolbarAction({
      action: { kind: "character", patch: { fontWeight: "bold" } },
      element,
      onCommitProps,
      range: null,
    });

    expect(onCommitProps).toHaveBeenCalledTimes(1);
    expect(onCommitProps).toHaveBeenCalledWith(element.elementId, {
      fontWeight: "bold",
    });
  });

  it("uses B2 character operations for an active range and commits once", () => {
    const { element } = getTextFixture();
    const rangedElement = {
      ...element,
      props: {
        ...element.props,
        text: "가나다",
      },
    };
    const onCommitProps = vi.fn();

    commitTextContextToolbarAction({
      action: { kind: "character", patch: { italic: true } },
      element: rangedElement,
      onCommitProps,
      range: { end: 2, start: 1 },
    });

    expect(onCommitProps).toHaveBeenCalledTimes(1);
    const updated = onCommitProps.mock.calls[0]?.[1] as TextElementProps;
    expect(updated.paragraphs?.[0]?.runs).toEqual([
      { baseline: "normal", text: "가" },
      { baseline: "normal", italic: true, text: "나" },
      { baseline: "normal", text: "다" },
    ]);
  });

  it("uses B2 paragraph operations for a ranged alignment action", () => {
    const { element } = getTextFixture();
    const rangedElement = {
      ...element,
      props: {
        ...element.props,
        paragraphs: [
          {
            align: "left" as const,
            indent: 0,
            lineHeight: 1.2,
            spaceAfter: 0,
            spaceBefore: 0,
            text: "One",
          },
          {
            align: "left" as const,
            indent: 0,
            lineHeight: 1.2,
            spaceAfter: 0,
            spaceBefore: 0,
            text: "Two",
          },
        ],
        text: "One\nTwo",
      },
    };
    const onCommitProps = vi.fn();

    commitTextContextToolbarAction({
      action: { kind: "paragraph", patch: { align: "center" } },
      element: rangedElement,
      onCommitProps,
      range: { end: 7, start: 4 },
    });

    const updated = onCommitProps.mock.calls[0]?.[1] as TextElementProps;
    expect(updated.paragraphs?.map((paragraph) => paragraph.align)).toEqual([
      "left",
      "center",
    ]);
  });

  it("formats every canonical paragraph when no text range is active", () => {
    const { element } = getTextFixture();
    const paragraphElement = {
      ...element,
      props: {
        ...element.props,
        paragraphs: [
          {
            align: "left" as const,
            indent: 0,
            lineHeight: 1.2,
            spaceAfter: 0,
            spaceBefore: 0,
            text: "One",
          },
          {
            align: "left" as const,
            indent: 0,
            lineHeight: 1.2,
            spaceAfter: 0,
            spaceBefore: 0,
            text: "Two",
          },
        ],
        text: "One\nTwo",
      },
    };
    const onCommitProps = vi.fn();

    commitTextContextToolbarAction({
      action: { kind: "paragraph", patch: { align: "right" } },
      element: paragraphElement,
      onCommitProps,
      range: null,
    });

    expect(onCommitProps).toHaveBeenCalledTimes(1);
    const updated = onCommitProps.mock.calls[0]?.[1] as TextElementProps;
    expect(updated.paragraphs?.map((paragraph) => paragraph.align)).toEqual([
      "right",
      "right",
    ]);
  });
});

describe("TextContextToolbar", () => {
  it("renders all formatting controls and exposes mixed values explicitly", () => {
    const { deck, element, slide } = getTextFixture();
    const mixedElement = {
      ...element,
      props: {
        ...element.props,
        paragraphs: [
          {
            align: "left" as const,
            indent: 0,
            lineHeight: 1.2,
            runs: [
              {
                baseline: "normal" as const,
                fontWeight: "bold" as const,
                text: "Bold",
              },
              {
                baseline: "normal" as const,
                fontWeight: "normal" as const,
                text: "Plain",
              },
            ],
            spaceAfter: 0,
            spaceBefore: 0,
            text: "BoldPlain",
          },
        ],
        text: "BoldPlain",
      },
    };

    const html = renderToString(
      <TextContextToolbar
        deck={deck}
        element={mixedElement}
        loadedFontFamilies={["Pretendard"]}
        range={{ end: 9, start: 0 }}
        readOnly={false}
        slide={slide}
        stageElement={null}
        stageScale={1}
        onCommitProps={vi.fn()}
      />,
    );

    expect(html).toContain('role="toolbar"');
    expect(html).toContain("글꼴");
    expect(html).toContain("글자 크기 줄이기");
    expect(html).toContain("굵게");
    expect(html).toContain("기울임");
    expect(html).toContain("밑줄");
    expect(html).toContain("글자색");
    expect(html).toContain("강조색");
    expect(html).toContain("링크");
    expect(html).toContain("문단 정렬");
    expect(html).toContain("글머리 기호");
    expect(html).toContain("번호 매기기");
    expect(html).toContain("들여쓰기 늘리기");
    expect(html).toContain("줄 간격");
    expect(html).toContain("서식 지우기");
    expect(html).toContain('aria-pressed="mixed"');
  });

  it("hides in read-only mode", () => {
    const { deck, element, slide } = getTextFixture();
    expect(
      renderToString(
        <TextContextToolbar
          deck={deck}
          element={element}
          readOnly
          slide={slide}
          stageElement={null}
          stageScale={1}
          onCommitProps={vi.fn()}
        />,
      ),
    ).toBe("");
  });

  it("disables imported rich-text controls and renders the resolver reason", () => {
    const { deck, element, slide } = getTextFixture();
    const importedDeck: Deck = {
      ...deck,
      metadata: { ...deck.metadata, sourceType: "import" },
    };
    const importedElement = {
      ...element,
      ooxmlEditCapabilities: {
        crop: "none" as const,
        richText: "none" as const,
        tableCellText: false,
      },
      ooxmlOrigin: "imported" as const,
      props: { ...element.props, fontFamily: "Aptos Display" },
    };

    const html = renderToString(
      <TextContextToolbar
        deck={importedDeck}
        element={importedElement}
        loadedFontFamilies={["Pretendard"]}
        readOnly={false}
        slide={slide}
        stageElement={null}
        stageScale={1}
        onCommitProps={vi.fn()}
      />,
    );

    expect(html).toContain(
      "원본 OOXML 구조에서 이 편집을 안전하게 보존할 수 없습니다.",
    );
    expect(html).toContain("Aptos Display");
    expect(html).toContain("(사용 불가)");
    expect(html).toContain("disabled");
  });
});
