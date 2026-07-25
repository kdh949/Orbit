import { describe, expect, it } from "vitest";
import { realtimeTranscriptionClientSecretResponseSchema } from "./realtime-transcription.schema";

describe("realtimeTranscriptionClientSecretResponseSchema", () => {
  it("accepts a gpt-realtime-whisper client secret response", () => {
    expect(
      realtimeTranscriptionClientSecretResponseSchema.parse({
        clientSecret: "ek_test",
        delay: "minimal",
        expiresAt: 1790000000,
        model: "gpt-realtime-whisper"
      })
    ).toEqual({
      clientSecret: "ek_test",
      delay: "minimal",
      expiresAt: 1790000000,
      model: "gpt-realtime-whisper"
    });
  });

  it("rejects unknown realtime transcription delay values", () => {
    expect(() =>
      realtimeTranscriptionClientSecretResponseSchema.parse({
        clientSecret: "ek_test",
        delay: "instant",
        expiresAt: 1790000000,
        model: "gpt-realtime-whisper"
      })
    ).toThrow();
  });
});
