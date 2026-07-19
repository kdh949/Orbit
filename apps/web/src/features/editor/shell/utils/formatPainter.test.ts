import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";

import { canApplyFormatPainter, createFormatPainterPayload } from "./formatPainter";

describe("formatPainter", () => {
  it("copies text style without copying semantic content", () => {
    const deck = createDemoDeck();
    const text = deck.slides[0]!.elements.find((element) => element.type === "text");
    if (!text || text.type !== "text") throw new Error("text fixture required");
    const payload = createFormatPainterPayload(text);
    expect(payload?.category).toBe("text");
    expect(payload?.props).not.toHaveProperty("text");
    expect(payload?.props).not.toHaveProperty("runs");
    expect(payload?.props).not.toHaveProperty("paragraphs");
  });

  it("only applies a captured style to a compatible category", () => {
    const deck = createDemoDeck();
    const text = deck.slides[0]!.elements.find((element) => element.type === "text")!;
    const shape = deck.slides[0]!.elements.find((element) => element.type === "rect")!;
    const payload = createFormatPainterPayload(text)!;
    expect(canApplyFormatPainter(payload, text)).toBe(true);
    expect(canApplyFormatPainter(payload, shape)).toBe(false);
  });
});
