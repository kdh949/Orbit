import { describe, expect, it } from "vitest";
import {
  advanceSpeechDetector,
  calculateNoiseFloorDb,
  initialSpeechDetectorState,
  resolveAdaptiveSpeechThresholdDb
} from "./realtimeWhisperSpikeVad";

describe("realtimeWhisperSpikeVad", () => {
  it("uses the median noise floor and applies a bounded margin", () => {
    expect(calculateNoiseFloorDb([-49, -45, -47, -46, -100, Number.NaN]))
      .toBe(-47);
    expect(resolveAdaptiveSpeechThresholdDb(-47, 10)).toBe(-37);
    expect(resolveAdaptiveSpeechThresholdDb(-80, 8)).toBe(-60);
    expect(resolveAdaptiveSpeechThresholdDb(-22, 12)).toBe(-20);
  });

  it("requires a stable attack before declaring speech", () => {
    const candidate = advanceSpeechDetector(initialSpeechDetectorState, {
      nowMs: 100,
      rmsDb: -30,
      thresholdDb: -40,
      attackMs: 200,
      releaseMs: 650
    });
    expect(candidate.speechStartedAtMs).toBeNull();

    const transient = advanceSpeechDetector(candidate.state, {
      nowMs: 180,
      rmsDb: -50,
      thresholdDb: -40,
      attackMs: 200,
      releaseMs: 650
    });
    expect(transient.state).toEqual(initialSpeechDetectorState);

    const stable = advanceSpeechDetector(candidate.state, {
      nowMs: 310,
      rmsDb: -29,
      thresholdDb: -40,
      attackMs: 200,
      releaseMs: 650
    });
    expect(stable.speechStartedAtMs).toBe(100);
    expect(stable.state.isSpeaking).toBe(true);
  });

  it("waits for the release window before ending speech", () => {
    const speaking = {
      candidateStartedAtMs: null,
      isSpeaking: true,
      lastVoiceAtMs: 1000
    };
    const holding = advanceSpeechDetector(speaking, {
      nowMs: 1500,
      rmsDb: -60,
      thresholdDb: -40,
      attackMs: 200,
      releaseMs: 650
    });
    expect(holding.speechEndedAtMs).toBeNull();
    expect(holding.state.isSpeaking).toBe(true);

    const ended = advanceSpeechDetector(holding.state, {
      nowMs: 1700,
      rmsDb: -60,
      thresholdDb: -40,
      attackMs: 200,
      releaseMs: 650
    });
    expect(ended.speechEndedAtMs).toBe(1700);
    expect(ended.state).toEqual(initialSpeechDetectorState);
  });
});
