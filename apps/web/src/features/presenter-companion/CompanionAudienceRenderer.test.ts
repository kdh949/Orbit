import { describe, expect, it } from "vitest";
import { calculateCompanionRendererScale } from "./companionRendererScale";

describe("calculateCompanionRendererScale", () => {
  it("keeps a 16:9 slide inside the landscape iPad shell padding", () => {
    const scale = calculateCompanionRendererScale(
      { height: 1080, width: 1920 },
      { height: 768, width: 1024 },
    );

    expect(1920 * scale).toBeLessThanOrEqual(984);
    expect(1080 * scale).toBeLessThanOrEqual(656);
  });

  it("keeps the slide inside the portrait fallback shell", () => {
    const scale = calculateCompanionRendererScale(
      { height: 1080, width: 1920 },
      { height: 1024, width: 768 },
    );

    expect(1920 * scale).toBeLessThanOrEqual(728);
    expect(1080 * scale).toBeLessThanOrEqual(912);
  });
});
