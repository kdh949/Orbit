import { describe, expect, it } from "vitest";
import {
  mergeTranscriptionConfig,
  verifyTranscriptionConfig
} from "./realtimeWhisperSpikeSession";

describe("realtimeWhisperSpikeSession", () => {
  it("accepts a matching event-reported delay", () => {
    expect(
      verifyTranscriptionConfig({
        issuedModel: "gpt-realtime-whisper",
        issuedDelay: "high",
        reported: { model: "gpt-realtime-whisper", delay: "high" },
        requestedDelay: "high"
      })
    ).toEqual({ ok: true, delaySource: "event" });
  });

  it("accepts an issued delay when the server event does not report delay", () => {
    expect(
      verifyTranscriptionConfig({
        issuedModel: "gpt-realtime-whisper",
        issuedDelay: "low",
        reported: { model: "gpt-realtime-whisper", delay: null },
        requestedDelay: "low"
      })
    ).toEqual({ ok: true, delaySource: "issued" });
  });

  it("rejects issued and event-reported configuration mismatches", () => {
    expect(
      verifyTranscriptionConfig({
        issuedModel: "gpt-realtime-whisper",
        issuedDelay: "medium",
        reported: { model: "gpt-realtime-whisper", delay: null },
        requestedDelay: "high"
      })
    ).toEqual({ ok: false, reason: "issued-delay-mismatch" });
    expect(
      verifyTranscriptionConfig({
        issuedModel: "gpt-realtime-whisper",
        issuedDelay: "high",
        reported: { model: "gpt-realtime-whisper", delay: "medium" },
        requestedDelay: "high"
      })
    ).toEqual({ ok: false, reason: "reported-delay-mismatch" });
    expect(
      verifyTranscriptionConfig({
        issuedModel: "gpt-realtime-whisper",
        issuedDelay: "high",
        reported: { model: "other-model", delay: null },
        requestedDelay: "high"
      })
    ).toEqual({ ok: false, reason: "reported-model-mismatch" });
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
