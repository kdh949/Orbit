import { createDemoDeck } from "@orbit/editor-core";
import type { EditorValidationItem } from "./editorValidation";
import { presentEditorValidationItems } from "./validationPresentation";
import { describe, expect, it } from "vitest";

describe("presentEditorValidationItems", () => {
  it("labels a target by slide order and semantic element role without raw IDs", () => {
    const deck = createDemoDeck();
    const sourceSlide = deck.slides[0];
    const title = sourceSlide.elements.find(
      (element) => element.type === "text" && element.role === "title"
    );
    if (!title) throw new Error("title fixture missing");
    deck.slides = [
      structuredClone(sourceSlide),
      { ...structuredClone(sourceSlide), slideId: "slide_second", order: 2 },
      { ...structuredClone(sourceSlide), slideId: "slide_third", order: 3 }
    ];
    deck.slides[2].elements = deck.slides[2].elements.map((element) => ({
      ...element,
      elementId: `${element.elementId}_third`
    }));
    const thirdTitle = deck.slides[2].elements.find(
      (element) => element.type === "text" && element.role === "title"
    );
    if (!thirdTitle) throw new Error("third title fixture missing");

    const [presented] = presentEditorValidationItems(deck, [
      validationItem({
        elementId: thirdTitle.elementId,
        issue: "textOverflow",
        slideId: deck.slides[2].slideId
      })
    ]);

    expect(presented.target).toEqual({
      elementIds: [thirdTitle.elementId],
      label: "3번 슬라이드 · 제목 텍스트",
      slideId: deck.slides[2].slideId,
      status: "resolved"
    });
    expect(presented.target?.label).not.toContain(thirdTitle.elementId);
  });

  it("presents every overlap target and a manual adjustment instruction", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    const title = slide.elements.find(
      (element) => element.type === "text" && element.role === "title"
    );
    const body = slide.elements.find(
      (element) => element.type === "text" && element.role === "body"
    );
    if (!title || !body) throw new Error("overlap fixtures missing");

    const [presented] = presentEditorValidationItems(deck, [
      validationItem({
        elementIds: [title.elementId, body.elementId],
        issue: "textOverlap",
        slideId: slide.slideId
      })
    ]);

    expect(presented.target?.label).toBe(
      "1번 슬라이드 · 제목 텍스트, 본문 텍스트"
    );
    expect(presented.target?.elementIds).toEqual([title.elementId, body.elementId]);
    expect(presented.recoveryInstruction).toContain("이동하거나 크기를 조정");
  });

  it("returns the exact safe fallback for partial and missing references", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    const target = slide.elements[0];
    const presented = presentEditorValidationItems(deck, [
      validationItem({
        elementIds: [target.elementId, "el_missing_secret"],
        issue: "textOverlap",
        slideId: slide.slideId
      }),
      validationItem({
        elementId: "el_unknown_secret",
        issue: "textOverflow",
        slideId: "slide_missing_secret"
      })
    ]);

    expect(presented[0].target).toEqual({
      elementIds: [target.elementId],
      label: "대상을 찾을 수 없음",
      slideId: slide.slideId,
      status: "partial"
    });
    expect(presented[1].target).toEqual({
      elementIds: [],
      label: "대상을 찾을 수 없음",
      slideId: null,
      status: "missing"
    });
    expect(presented.map((item) => item.target?.label).join(" ")).not.toMatch(
      /el_(missing|unknown)_secret/
    );
  });

  it("provides the concrete 12-column and 8px grid guidance", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    const target = slide.elements[0];

    const [presented] = presentEditorValidationItems(deck, [
      validationItem({
        elementId: target.elementId,
        issue: "GRID_ALIGNMENT_INCONSISTENT",
        slideId: slide.slideId
      })
    ]);

    expect(presented.recoveryInstruction).toContain("12열");
    expect(presented.recoveryInstruction).toContain("8px");
    expect(presented.recoveryInstruction).toContain("수동 조정");
  });

  it("keeps deck-wide warnings targetless", () => {
    const deck = createDemoDeck();
    const [presented] = presentEditorValidationItems(deck, [
      validationItem({ issue: "slideCountMismatch" })
    ]);

    expect(presented.target).toBeNull();
    expect(presented.recoveryInstruction).toBeNull();
  });
});

function validationItem(
  overrides: Partial<EditorValidationItem>
): EditorValidationItem {
  return {
    message: "검사 경고",
    severity: "warning",
    ...overrides
  };
}
