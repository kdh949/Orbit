import { describe, expect, it } from "vitest";
import { SherpaAudioFrameBatcher } from "./sherpaOnnxAudioBatch";

describe("SherpaAudioFrameBatcher", () => {
  it("waits until the decode threshold before flushing frames", () => {
    const batcher = new SherpaAudioFrameBatcher(2048);

    expect(batcher.push(audioFrame(512))).toBeNull();
    expect(batcher.push(audioFrame(512))).toBeNull();
    expect(batcher.push(audioFrame(512))).toBeNull();

    const batch = batcher.push(audioFrame(512));

    expect(batch?.sampleCount).toBe(2048);
    expect(batch?.frames).toHaveLength(4);
    expect(batcher.flush()).toBeNull();
  });

  it("flushes remaining frames below the decode threshold", () => {
    const batcher = new SherpaAudioFrameBatcher(2048);

    expect(batcher.push(audioFrame(512))).toBeNull();

    const batch = batcher.flush();

    expect(batch?.sampleCount).toBe(512);
    expect(batch?.frames).toHaveLength(1);
    expect(batcher.flush()).toBeNull();
  });

  it("drops stale pending frames after reset", () => {
    const batcher = new SherpaAudioFrameBatcher(1024);

    expect(batcher.push(audioFrame(512))).toBeNull();
    batcher.reset();
    expect(batcher.flush()).toBeNull();
    expect(batcher.push(audioFrame(512))).toBeNull();

    const batch = batcher.push(audioFrame(512));

    expect(batch?.sampleCount).toBe(1024);
    expect(batch?.frames).toHaveLength(2);
  });
});

function audioFrame(sampleCount: number) {
  return {
    sampleRate: 16000,
    samples: new Float32Array(sampleCount)
  };
}
