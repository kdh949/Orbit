import type { DeckElement } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import { getElementLayerOrderUpdates } from "./elementLayerOrder";

const elements = [
  { elementId: "back", zIndex: 3 },
  { elementId: "middle", zIndex: 8 },
  { elementId: "front", zIndex: 20 },
] as DeckElement[];

describe("getElementLayerOrderUpdates", () => {
  it("moves an element to the front and normalizes z-indexes", () => {
    expect(
      getElementLayerOrderUpdates(elements, "back", "bring-to-front"),
    ).toEqual([
      { elementId: "middle", zIndex: 0 },
      { elementId: "front", zIndex: 1 },
      { elementId: "back", zIndex: 2 },
    ]);
  });

  it("moves an element one layer forward or backward", () => {
    expect(
      getElementLayerOrderUpdates(elements, "middle", "bring-forward"),
    ).toEqual([
      { elementId: "back", zIndex: 0 },
      { elementId: "front", zIndex: 1 },
      { elementId: "middle", zIndex: 2 },
    ]);
    expect(
      getElementLayerOrderUpdates(elements, "middle", "send-backward"),
    ).toEqual([
      { elementId: "middle", zIndex: 0 },
      { elementId: "back", zIndex: 1 },
      { elementId: "front", zIndex: 2 },
    ]);
  });

  it("moves an element to the back and ignores boundary operations", () => {
    expect(
      getElementLayerOrderUpdates(elements, "front", "send-to-back"),
    ).toEqual([
      { elementId: "front", zIndex: 0 },
      { elementId: "back", zIndex: 1 },
      { elementId: "middle", zIndex: 2 },
    ]);
    expect(
      getElementLayerOrderUpdates(elements, "front", "bring-forward"),
    ).toEqual([]);
  });
});
