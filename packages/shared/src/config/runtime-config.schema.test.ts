import { describe, expect, it } from "vitest";

import { runtimeConfigResponseSchema } from "./runtime-config.schema";

describe("runtimeConfigResponseSchema", () => {
  const flags = {
    ipadPresenterCompanionEnabled: true,
    adaptiveRehearsalCoachEnabled: false,
    focusedPracticeEnabled: false,
    challengeQnaEnabled: false,
    slidePracticeEnabled: true,
    slideQuestionGuidesEnabled: true,
  };

  it("accepts browser live STT engines exposed by runtime config", () => {
    expect(
      runtimeConfigResponseSchema.parse({ liveSttEngine: "openai-realtime", ...flags })
    ).toEqual({ liveSttEngine: "openai-realtime", ...flags });
    expect(
      runtimeConfigResponseSchema.parse({ liveSttEngine: "web-speech", ...flags })
    ).toEqual({ liveSttEngine: "web-speech", ...flags });
  });

  it("rejects local model engines that are not env-switch targets", () => {
    expect(
      runtimeConfigResponseSchema.safeParse({ liveSttEngine: "sherpa", ...flags }).success
    ).toBe(false);
    expect(
      runtimeConfigResponseSchema.safeParse({ liveSttEngine: "moonshine", ...flags }).success
    ).toBe(false);
  });
});
