import { describe, expect, it } from "vitest";
import {
  isExpectedTranscriptionConfig,
  mergeTranscriptionConfig
} from "./realtimeWhisperSpikeSession";

describe("realtimeWhisperSpikeSession", () => {
  it("accepts only the requested model and delay reported by session.updated", () => {
    expect(
      isExpectedTranscriptionConfig(
        { model: "gpt-realtime-whisper", delay: "high" },
        "high"
      )
    ).toBe(true);
    expect(
      isExpectedTranscriptionConfig(
        { model: "gpt-realtime-whisper", delay: "medium" },
        "high"
      )
    ).toBe(false);
    expect(
      isExpectedTranscriptionConfig(
        { model: "other-model", delay: "high" },
        "high"
      )
    ).toBe(false);
  });

  it("retains session.created delay when session.updated omits it", () => {
    expect(
      mergeTranscriptionConfig(
        { model: "gpt-realtime-whisper", delay: "minimal" },
        { model: "gpt-realtime-whisper", delay: null }
      )
    ).toEqual({ model: "gpt-realtime-whisper", delay: "minimal" });
  });
});
