import { describe, expect, it } from "vitest";
import {
  calculatePcmAudioLevel,
  liveSttAudioLevelFloorDb,
} from "./liveSttAudioLevel";

describe("calculatePcmAudioLevel", () => {
  it("marks silent PCM as likely silence", () => {
    const level = calculatePcmAudioLevel(new Float32Array([0, 0, 0, 0]));

    expect(level).toEqual({
      type: "audio-level",
      rms: 0,
      peak: 0,
      rmsDb: liveSttAudioLevelFloorDb,
      peakDb: liveSttAudioLevelFloorDb,
      isLikelySilence: true,
    });
  });

  it("calculates RMS, peak, and dB values for audible PCM", () => {
    const level = calculatePcmAudioLevel(
      new Float32Array([0, 0.5, -0.5, 1, -1]),
    );

    expect(level.type).toBe("audio-level");
    expect(level.rms).toBeCloseTo(Math.sqrt(0.5));
    expect(level.peak).toBe(1);
    expect(level.rmsDb).toBeCloseTo(-3.0103, 4);
    expect(level.peakDb).toBeCloseTo(0);
    expect(level.isLikelySilence).toBe(false);
  });
});
