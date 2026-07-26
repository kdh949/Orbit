import { describe, expect, it } from "vitest";

import {
  autoAdvanceThresholdSteps,
  defaultAutoAdvanceConfig,
  defaultAutoAdvancePolicy,
  defaultPauseDetectorConfig,
  formatAutoAdvanceThresholdPercent,
  isAutoAdvanceEnabledForMode,
  normalizeAutoAdvanceThreshold
} from "./autoAdvanceConfig";

describe("autoAdvanceConfig", () => {
  it("uses P4 default timing and detector values", () => {
    expect(defaultAutoAdvancePolicy).toEqual({
      countdownMs: 2000,
      live: false,
      pauseMs: 600,
      rehearsal: true,
      semanticMatching: true,
      threshold: 0.7
    });
    expect(defaultPauseDetectorConfig).toEqual({
      silenceThresholdDb: -55
    });
    expect(defaultAutoAdvanceConfig).toEqual({
      manualGuidanceDelayMs: 5000
    });
  });

  it("normalizes threshold values to 5 percent steps", () => {
    expect(autoAdvanceThresholdSteps).toEqual([
      0.5,
      0.55,
      0.6,
      0.65,
      0.7,
      0.75,
      0.8,
      0.85,
      0.9,
      0.95
    ]);
    expect(normalizeAutoAdvanceThreshold(0.52)).toBe(0.5);
    expect(normalizeAutoAdvanceThreshold(0.53)).toBe(0.55);
    expect(normalizeAutoAdvanceThreshold(0.99)).toBe(0.95);
    expect(formatAutoAdvanceThresholdPercent(0.749)).toBe(75);
  });

  it("checks mode enablement from the persisted policy", () => {
    expect(
      isAutoAdvanceEnabledForMode(
        { live: false, rehearsal: true },
        "rehearsal"
      )
    ).toBe(true);
    expect(
      isAutoAdvanceEnabledForMode({ live: false, rehearsal: true }, "live")
    ).toBe(false);
  });
});
