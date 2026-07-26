import { describe, expect, it } from "vitest";
import { measureSlideshowFrameCadence } from "./slideshowPerfProbe";

describe("slideshowPerfProbe", () => {
  it("summarizes frame cadence for manual playback checks", async () => {
    const frames = [16, 32, 72, 88, 104];
    let frameIndex = 0;

    const result = await measureSlideshowFrameCadence({
      durationMs: 80,
      now: () => 0,
      requestFrame: (callback) => {
        const timestamp = frames[frameIndex++] ?? 104;
        callback(timestamp);
        return frameIndex;
      },
      cancelFrame: () => undefined
    });

    expect(result.measuredFrameCount).toBe(4);
    expect(result.droppedFrameCount).toBe(1);
    expect(result.averageFrameMs).toBe(22);
  });
});
