import { applyDeckPatch, createDemoDeck } from "@orbit/editor-core";
import type { DeckElement } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { createAlignSelectionPatch } from "./selectionAlignment";

function rect(
  elementId: string,
  frame: Pick<DeckElement, "height" | "width" | "x" | "y"> &
    Partial<Pick<DeckElement, "locked" | "rotation">>,
): DeckElement {
  return {
    elementId,
    type: "rect",
    role: "highlight",
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    rotation: frame.rotation ?? 0,
    opacity: 1,
    zIndex: 1,
    locked: frame.locked ?? false,
    visible: true,
    props: {
      fill: "#ffffff",
      stroke: "#111827",
      strokeWidth: 1,
      borderRadius: 0,
    },
  };
}

describe("createAlignSelectionPatch", () => {
  it.each([
    ["left", "x", [100, 100, 100]],
    ["centerX", "x", [350, 300, 325]],
    ["right", "x", [600, 500, 550]],
    ["top", "y", [80, 80, 80]],
    ["centerY", "y", [290, 250, 265]],
    ["bottom", "y", [500, 420, 450]],
  ] as const)("aligns selection to %s", (alignment, coordinate, expected) => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    slide.elements = [
      rect("el_a", { x: 100, y: 80, width: 100, height: 80 }),
      rect("el_b", { x: 300, y: 240, width: 200, height: 160 }),
      rect("el_c", { x: 550, y: 450, width: 150, height: 130 }),
    ];

    const patch = createAlignSelectionPatch(
      deck,
      slide,
      slide.elements,
      alignment,
    );
    expect(patch).not.toBeNull();
    const applied = applyDeckPatch(deck, patch!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(
      applied.deck.slides[0]!.elements.map((element) => element[coordinate]),
    ).toEqual(expected);
  });

  it("moves grouped children by the same alignment delta", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const child = rect("el_child", {
      x: 430,
      y: 180,
      width: 40,
      height: 40,
    });
    const group: DeckElement = {
      ...rect("el_group", { x: 400, y: 150, width: 120, height: 100 }),
      type: "group",
      props: { childElementIds: [child.elementId] },
    };
    const anchor = rect("el_anchor", {
      x: 100,
      y: 100,
      width: 80,
      height: 80,
    });
    slide.elements = [anchor, child, group];

    const patch = createAlignSelectionPatch(
      deck,
      slide,
      [anchor, group],
      "left",
    );
    const applied = applyDeckPatch(deck, patch!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(
      applied.deck.slides[0]!.elements.find(
        (element) => element.elementId === group.elementId,
      )?.x,
    ).toBe(100);
    expect(
      applied.deck.slides[0]!.elements.find(
        (element) => element.elementId === child.elementId,
      )?.x,
    ).toBe(130);
  });

  it("fails closed for a single element or a selection containing a locked element", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const unlocked = rect("el_unlocked", {
      x: 100,
      y: 100,
      width: 100,
      height: 80,
    });
    const locked = rect("el_locked", {
      x: 500,
      y: 300,
      width: 100,
      height: 80,
      locked: true,
    });

    expect(
      createAlignSelectionPatch(deck, slide, [unlocked], "left"),
    ).toBeNull();
    expect(
      createAlignSelectionPatch(deck, slide, [unlocked, locked], "left"),
    ).toBeNull();
  });
});
