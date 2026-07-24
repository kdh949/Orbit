import { describe, expect, it } from "vitest";
import {
  redactedPaths,
  sanitizeLogRequestUrl,
} from "./logging";

describe("API logging redaction", () => {
  it("redacts semantic cue NLI evidence text fields", () => {
    expect(redactedPaths).toEqual(
      expect.arrayContaining([
        "premise",
        "hypothesis",
        "semanticCueDecisions",
        "*.premise",
        "*.hypothesis",
        "*.semanticCueDecisions",
        "payload.semanticCueDecisions",
        "result.semanticCueDecisions"
      ])
    );
  });

  it("redacts companion WebRTC and annotation payload fields", () => {
    expect(redactedPaths).toEqual(
      expect.arrayContaining([
        "sdp",
        "candidate",
        "points",
        "*.sdp",
        "*.candidate",
        "*.points",
        "usernameFragment",
        "*.usernameFragment",
        "token",
        "*.token",
      ]),
    );
  });

  it("removes one-time pairing codes from HTTP log URLs", () => {
    const privateCode = "private-single-use-code";
    const sanitized = sanitizeLogRequestUrl(
      `/api/v1/presentation-companion/pairings/${privateCode}/exchange?source=qr`,
    );

    expect(sanitized).toBe(
      "/api/v1/presentation-companion/pairings/[Redacted]/exchange?source=qr",
    );
    expect(sanitized).not.toContain(privateCode);
  });
});
