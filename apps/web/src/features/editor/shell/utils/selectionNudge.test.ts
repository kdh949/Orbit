import { applyDeckPatch, createDemoDeck } from "@orbit/editor-core";
import type { Deck, DeckElement } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import { createSelectionNudgePatch } from "./selectionNudge";

function rect(
  elementId: string,
  x: number,
  y: number,
  options: { height?: number; locked?: boolean; width?: number } = {},
): DeckElement {
  return {
    elementId,
    height: options.height ?? 80,
    locked: options.locked ?? false,
    opacity: 1,
    props: {
      borderRadius: 0,
      fill: "#ffffff",
      stroke: "#111827",
      strokeWidth: 1,
    },
    role: "highlight",
    rotation: 0,
    type: "rect",
    visible: true,
    width: options.width ?? 100,
    x,
    y,
    zIndex: 1,
  };
}

function group(
  elementId: string,
  childElementIds: string[],
  x: number,
  y: number,
  options: { height?: number; locked?: boolean; width?: number } = {},
): DeckElement {
  return {
    elementId,
    height: options.height ?? 120,
    locked: options.locked ?? false,
    opacity: 1,
    props: { childElementIds },
    role: "decoration",
    rotation: 0,
    type: "group",
    visible: true,
    width: options.width ?? 160,
    x,
    y,
    zIndex: 2,
  };
}

function deckWithElements(elements: DeckElement[]) {
  const deck = createDemoDeck();
  deck.slides[0]!.elements = elements;
  return deck;
}

function applyNudge(deck: Deck, selectedElementIds: string[], deltaX: number, deltaY: number) {
  const patch = createSelectionNudgePatch({
    deck,
    deltaX,
    deltaY,
    selectedElementIds,
    slideId: deck.slides[0]!.slideId,
  });
  if (!patch) {
    return { patch, result: null };
  }

  return { patch, result: applyDeckPatch(deck, patch) };
}

describe("createSelectionNudgePatch", () => {
  it("moves a single element with one valid patch", () => {
    const deck = deckWithElements([rect("el_1", 100, 100)]);
    const { patch, result } = applyNudge(deck, ["el_1"], 1, -1);

    expect(patch?.operations).toHaveLength(1);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.deck.slides[0]!.elements[0]).toMatchObject({ x: 101, y: 99 });
    }
  });

  it("moves a multi-selection by one shared delta in one patch", () => {
    const deck = deckWithElements([
      rect("el_1", 100, 100),
      rect("el_2", 400, 300),
    ]);
    const { patch, result } = applyNudge(deck, ["el_1", "el_2"], 10, 10);

    expect(patch?.operations.map((operation) =>
      operation.type === "update_element_frame" ? operation.elementId : null,
    )).toEqual(["el_1", "el_2"]);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.deck.slides[0]!.elements.map(({ x, y }) => ({ x, y }))).toEqual([
        { x: 110, y: 110 },
        { x: 410, y: 310 },
      ]);
    }
  });

  it("canonicalizes selected group descendants and emits unique operations", () => {
    const child = rect("el_child", 120, 120);
    const parent = group("el_group", [child.elementId], 100, 100);
    const deck = deckWithElements([child, parent]);
    const { patch } = applyNudge(deck, [parent.elementId, child.elementId], 10, 0);
    const operationIds = patch?.operations.flatMap((operation) =>
      operation.type === "update_element_frame" ? [operation.elementId] : [],
    );

    expect(operationIds).toEqual(["el_group", "el_child"]);
    expect(new Set(operationIds).size).toBe(operationIds?.length);
  });

  it("deduplicates every operation in a nested group tree", () => {
    const child = rect("el_child", 140, 140);
    const nested = group("el_nested", [child.elementId], 120, 120);
    const parent = group("el_parent", [nested.elementId], 100, 100, {
      height: 180,
      width: 220,
    });
    const deck = deckWithElements([child, nested, parent]);
    const { patch } = applyNudge(
      deck,
      [parent.elementId, nested.elementId, child.elementId],
      0,
      10,
    );
    const operationIds = patch?.operations.flatMap((operation) =>
      operation.type === "update_element_frame" ? [operation.elementId] : [],
    );

    expect(operationIds).toEqual(["el_parent", "el_nested", "el_child"]);
  });

  it("skips locked targets while moving unlocked selection targets", () => {
    const deck = deckWithElements([
      rect("el_locked", 100, 100, { locked: true }),
      rect("el_open", 300, 100),
    ]);
    const { patch, result } = applyNudge(deck, ["el_locked", "el_open"], 10, 0);

    expect(patch?.operations).toHaveLength(1);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.deck.slides[0]!.elements.find(({ elementId }) =>
        elementId === "el_locked",
      )?.x).toBe(100);
      expect(result.deck.slides[0]!.elements.find(({ elementId }) =>
        elementId === "el_open",
      )?.x).toBe(310);
    }
  });

  it("skips an entire group when a descendant is locked", () => {
    const child = rect("el_child", 120, 120, { locked: true });
    const parent = group("el_group", [child.elementId], 100, 100);
    const deck = deckWithElements([child, parent]);

    expect(
      createSelectionNudgePatch({
        deck,
        deltaX: 10,
        deltaY: 0,
        selectedElementIds: [parent.elementId],
        slideId: deck.slides[0]!.slideId,
      }),
    ).toBeNull();
  });

  it("clamps a common delta against left and top boundaries", () => {
    const deck = deckWithElements([
      rect("el_edge", 2, 3),
      rect("el_other", 400, 300),
    ]);
    const { result } = applyNudge(deck, ["el_edge", "el_other"], -10, -10);

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.deck.slides[0]!.elements.map(({ x, y }) => ({ x, y }))).toEqual([
        { x: 0, y: 0 },
        { x: 398, y: 297 },
      ]);
    }
  });

  it("clamps a common delta with element size at right and bottom boundaries", () => {
    const deck = deckWithElements([
      rect("el_other", 100, 100),
      rect("el_edge", 1818, 998, { height: 80, width: 100 }),
    ]);
    const { result } = applyNudge(deck, ["el_other", "el_edge"], 10, 10);

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.deck.slides[0]!.elements.map(({ x, y }) => ({ x, y }))).toEqual([
        { x: 102, y: 102 },
        { x: 1820, y: 1000 },
      ]);
    }
  });

  it("returns null for locked, missing, non-finite, and fully clamped no-ops", () => {
    const lockedDeck = deckWithElements([rect("el_locked", 0, 0, { locked: true })]);
    const edgeDeck = deckWithElements([rect("el_edge", 0, 0)]);

    expect(applyNudge(lockedDeck, ["el_locked"], 1, 0).patch).toBeNull();
    expect(applyNudge(edgeDeck, ["missing"], 1, 0).patch).toBeNull();
    expect(applyNudge(edgeDeck, ["el_edge"], Number.NaN, 0).patch).toBeNull();
    expect(applyNudge(edgeDeck, ["el_edge"], -1, 0).patch).toBeNull();
  });
});
