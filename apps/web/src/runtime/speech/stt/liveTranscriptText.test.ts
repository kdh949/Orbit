import { describe, expect, it } from "vitest";

import { normalizeLiveTranscriptText } from "./liveTranscriptText";

describe("normalizeLiveTranscriptText", () => {
  it("한국어 비교를 위해 소문자화하고 공백을 제거한다", () => {
    expect(normalizeLiveTranscriptText("실시간 음성 인식")).toBe(
      "실시간음성인식",
    );
    expect(normalizeLiveTranscriptText("ORBIT Live STT")).toBe("orbitlivestt");
  });
});
