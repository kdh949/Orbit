import { describe, expect, it } from "vitest";

import { resizeImageCropDraft, type ImageCropDraft } from "./imageCropResize";

const draft: ImageCropDraft = {
  frame: { x: 100, y: 200, width: 300, height: 200, rotation: 0 },
  crop: { left: 0.2, top: 0.1, right: 0.2, bottom: 0.1 },
};

describe("resizeImageCropDraft", () => {
  it.each([
    "top-left",
    "top",
    "top-right",
    "right",
    "bottom-right",
    "bottom",
    "bottom-left",
    "left",
  ] as const)("supports the %s handle", (handle) => {
    const result = resizeImageCropDraft({
      draft,
      handle,
      deltaX: handle.includes("left") ? 20 : handle.includes("right") ? 20 : 0,
      deltaY: handle.includes("top") ? 10 : handle.includes("bottom") ? 10 : 0,
      minimumFrameSize: 8,
    });

    expect(result.frame.width).toBeGreaterThanOrEqual(8);
    expect(result.frame.height).toBeGreaterThanOrEqual(8);
    expect(result.crop.left + result.crop.right).toBeLessThan(1);
    expect(result.crop.top + result.crop.bottom).toBeLessThan(1);
  });

  it("moves a rotated frame origin along element-local axes", () => {
    const result = resizeImageCropDraft({
      draft: {
        ...draft,
        frame: { ...draft.frame, rotation: 90 },
      },
      handle: "top-left",
      deltaX: 20,
      deltaY: 10,
      minimumFrameSize: 8,
    });

    expect(result.frame.x).toBeCloseTo(90);
    expect(result.frame.y).toBeCloseTo(220);
    expect(result.frame.width).toBe(280);
    expect(result.frame.height).toBe(190);
  });

  it("clamps outward dragging to the full source bounds", () => {
    const result = resizeImageCropDraft({
      draft,
      handle: "top-left",
      deltaX: -10_000,
      deltaY: -10_000,
      minimumFrameSize: 8,
    });

    expect(result.crop.left).toBeCloseTo(0);
    expect(result.crop.top).toBeCloseTo(0);
    expect(result.frame.width).toBeCloseTo(400);
    expect(result.frame.height).toBeCloseTo(225);
  });

  it("keeps at least an 8px interaction frame at 200% zoom", () => {
    const result = resizeImageCropDraft({
      draft,
      handle: "bottom-right",
      deltaX: -10_000,
      deltaY: -10_000,
      minimumFrameSize: 8 / 2,
    });

    expect(result.frame.width).toBeGreaterThanOrEqual(4);
    expect(result.frame.height).toBeGreaterThanOrEqual(4);
  });

  it("does not lock the aspect ratio for corner drags", () => {
    const result = resizeImageCropDraft({
      draft,
      handle: "bottom-right",
      deltaX: -30,
      deltaY: -10,
      minimumFrameSize: 8,
    });

    expect(result.frame.width / result.frame.height).not.toBe(
      draft.frame.width / draft.frame.height,
    );
  });
});
