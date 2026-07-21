import { describe, expect, it } from "vitest";
import {
  realtimeTranscriptionClientSecretRequestSchema,
  realtimeTranscriptionClientSecretResponseSchema
} from "./realtime-transcription.schema";

describe("realtimeTranscriptionClientSecretRequestSchema", () => {
  it("accepts an optional supported delay override", () => {
    expect(realtimeTranscriptionClientSecretRequestSchema.parse({})).toEqual({});
    expect(
      realtimeTranscriptionClientSecretRequestSchema.parse({ delay: "high" })
    ).toEqual({ delay: "high" });
  });

  it("rejects unknown delay overrides", () => {
    expect(() =>
      realtimeTranscriptionClientSecretRequestSchema.parse({ delay: "instant" })
    ).toThrow();
  });
});

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
