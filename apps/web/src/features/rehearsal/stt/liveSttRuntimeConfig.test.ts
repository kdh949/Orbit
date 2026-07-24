import { describe, expect, it, vi } from "vitest";

import { LiveSttError } from "./liveSttPort";
import { fetchLiveSttRuntimeConfig } from "./liveSttRuntimeConfig";

describe("fetchLiveSttRuntimeConfig", () => {
  it("fetches the env-selected Live STT engine from runtime config", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          liveSttEngine: "web-speech",
          adaptiveRehearsalCoachEnabled: false,
          focusedPracticeEnabled: false,
          challengeQnaEnabled: false,
          slidePracticeEnabled: false,
          slideQuestionGuidesEnabled: false,
          ipadPresenterCompanionEnabled: true,
        })
      )
    );

    await expect(fetchLiveSttRuntimeConfig(fetcher as never)).resolves.toEqual({
      liveSttEngine: "web-speech",
      adaptiveRehearsalCoachEnabled: false,
      focusedPracticeEnabled: false,
      challengeQnaEnabled: false,
      slidePracticeEnabled: false,
      slideQuestionGuidesEnabled: false,
      ipadPresenterCompanionEnabled: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/runtime-config", {
      credentials: "include",
      method: "GET"
    });
  });

  it("fails closed when runtime config contains an unsupported engine", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          liveSttEngine: "sherpa",
          adaptiveRehearsalCoachEnabled: false,
          focusedPracticeEnabled: false,
          challengeQnaEnabled: false,
          slidePracticeEnabled: false,
          slideQuestionGuidesEnabled: false,
          ipadPresenterCompanionEnabled: true,
        })
      )
    );

    await expect(fetchLiveSttRuntimeConfig(fetcher as never)).rejects.toMatchObject({
      code: "start_failed",
      message: "Live STT runtime config 응답이 올바르지 않습니다."
    } satisfies Partial<LiveSttError>);
  });
});
