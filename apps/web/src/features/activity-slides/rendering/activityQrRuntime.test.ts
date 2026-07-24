import { afterEach, describe, expect, it, vi } from "vitest";

import { activityApi } from "../api/activityApi";
import {
  getActivityQrRuntimeState,
  loadActivityQrRuntimeState,
  subscribeActivityQrRuntime
} from "./activityQrRuntime";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("activity QR runtime lookup", () => {
  it("uses only read endpoints and never prepares a run while rendering", async () => {
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: "https://orbit.example/audience/session_1",
      session: { sessionId: "session_1" } as never
    });
    vi.spyOn(activityApi, "getCurrentRun").mockResolvedValue({
      run: { activityId: "activity_1" } as never
    });
    const ensureRun = vi.spyOn(activityApi, "ensureRun");

    await expect(
      loadActivityQrRuntimeState({
        activityId: "activity_1",
        deckId: "deck_1",
        projectId: "project_1"
      })
    ).resolves.toEqual({
      status: "ready",
      audienceUrl: "https://orbit.example/audience/session_1/a/activity_1"
    });

    expect(activityApi.getCurrentSession).toHaveBeenCalledWith("project_1", "deck_1");
    expect(activityApi.getCurrentRun).toHaveBeenCalledWith(
      "project_1",
      "session_1",
      "activity_1"
    );
    expect(ensureRun).not.toHaveBeenCalled();
  });

  it("retries quickly while the rehearsal session is being prepared", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout,
      location: { origin: "https://orbit.example" },
      setTimeout
    });
    vi.spyOn(activityApi, "getCurrentSession")
      .mockResolvedValueOnce({ audienceUrl: null, session: null })
      .mockResolvedValue({
        audienceUrl: "https://orbit.example/audience/session_2",
        session: { sessionId: "session_2" } as never
      });
    vi.spyOn(activityApi, "getCurrentRun").mockResolvedValue({
      run: { activityId: "activity_retry" } as never
    });
    const input = {
      activityId: "activity_retry",
      deckId: "deck_retry",
      projectId: "project_retry"
    };
    const listener = vi.fn();
    const unsubscribe = subscribeActivityQrRuntime(input, listener);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(getActivityQrRuntimeState(input)).toEqual({
      status: "ready",
      audienceUrl:
        "https://orbit.example/audience/session_2/a/activity_retry"
    });
    expect(activityApi.getCurrentSession).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
