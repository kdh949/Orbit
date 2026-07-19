import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/slideRenderUtils", () => ({
  createSlideRenderFile: vi.fn(),
  createSlideScopedUploadFile: vi.fn(),
  normalizeDeckAssetUrls: vi.fn((deck) => deck),
  waitForAnimationFrame: vi.fn(async () => undefined),
  waitForSlideAssets: vi.fn(async () => 0)
}));

import { waitForSlideCaptureAssets } from "./useSlideRenderPipeline";

describe("slide capture font preparation", () => {
  it("waits for images and fonts before two settling frames", async () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const order: string[] = [];
    const loadFonts = vi.fn(async () => {
      order.push("fonts");
      return [
        { family: "Pretendard", status: "loaded" as const },
        { family: "Noto Serif KR", status: "failed" as const }
      ];
    });
    const loadSlideAssets = vi.fn(async () => {
      order.push("images");
      return 2;
    });
    const waitForFrame = vi.fn(async () => {
      order.push("frame");
    });

    await expect(
      waitForSlideCaptureAssets({
        deck,
        loadFonts,
        loadSlideAssets,
        slide,
        waitForFrame
      })
    ).resolves.toEqual({ missingAssetCount: 2, missingFontCount: 1 });

    expect(order.slice(0, 2).sort()).toEqual(["fonts", "images"]);
    expect(order.slice(2)).toEqual(["frame", "frame"]);
  });
});
