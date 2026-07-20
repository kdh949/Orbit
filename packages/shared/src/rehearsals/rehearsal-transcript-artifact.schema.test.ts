import { describe, expect, it } from "vitest";

import { rehearsalTranscriptArtifactSchema } from "./rehearsal-transcript-artifact.schema";

describe("rehearsalTranscriptArtifactSchema", () => {
  it("accepts the retained transcript shape without speaker or word segments", () => {
    const artifact = rehearsalTranscriptArtifactSchema.parse({
      text: "안녕하세요. 발표를 시작하겠습니다.",
      liveTranscript: "안녕하세요 발표를 시작하겠습니다",
      language: "ko",
      duration: 5.4,
      provider: "whisperx",
      segments: [{ text: "안녕하세요.", start: 0, end: 2.1 }],
    });

    expect(artifact.segments).toHaveLength(1);
    expect(artifact.liveTranscript).toBe("안녕하세요 발표를 시작하겠습니다");
    expect(artifact).not.toHaveProperty("speaker");
    expect(artifact).not.toHaveProperty("word_segments");
  });

  it("rejects fields outside the retained transcript contract", () => {
    expect(
      rehearsalTranscriptArtifactSchema.safeParse({
        text: "안녕하세요.",
        language: "ko",
        duration: 2.1,
        provider: "whisperx",
        segments: [],
        speaker: "SPEAKER_00",
      }).success,
    ).toBe(false);
  });
});
