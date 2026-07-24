import { describe, expect, it } from "vitest";

import { getActivityRuntimeElementFrame } from "./useEditorCanvasCommands";

describe("activity runtime element placement", () => {
  it("places blank-canvas QR and passcode slots side by side", () => {
    const canvas = {
      aspectRatio: "16:9",
      height: 1080,
      preset: "wide-16-9",
      width: 1920,
    } as const;
    const qr = getActivityRuntimeElementFrame(canvas, "qr");
    const passcode = getActivityRuntimeElementFrame(canvas, "passcode");

    expect(qr.x + qr.width).toBeLessThan(passcode.x);
    expect(qr.y).toBeGreaterThan(0);
    expect(passcode.x + passcode.width).toBeLessThanOrEqual(canvas.width);
    expect(passcode.y + passcode.height).toBeLessThanOrEqual(canvas.height);
  });
});
