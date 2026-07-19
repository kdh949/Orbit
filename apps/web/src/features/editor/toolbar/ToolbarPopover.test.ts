import { describe, expect, it } from "vitest";

import { getToolbarPopoverPosition } from "./ToolbarPopover";

describe("getToolbarPopoverPosition", () => {
  it("opens below the trigger when space is available", () => {
    expect(
      getToolbarPopoverPosition({
        content: { height: 180, width: 240 },
        trigger: { bottom: 40, left: 120, top: 8 },
        viewport: { height: 600, width: 800 },
      }),
    ).toEqual({ left: 120, top: 46 });
  });

  it("flips above and clamps to the right viewport edge", () => {
    expect(
      getToolbarPopoverPosition({
        content: { height: 180, width: 240 },
        trigger: { bottom: 590, left: 700, top: 550 },
        viewport: { height: 600, width: 800 },
      }),
    ).toEqual({ left: 552, top: 364 });
  });

  it("keeps oversized content anchored inside the left padding", () => {
    expect(
      getToolbarPopoverPosition({
        content: { height: 120, width: 640 },
        trigger: { bottom: 40, left: 12, top: 8 },
        viewport: { height: 400, width: 320 },
      }).left,
    ).toBe(8);
  });
});
