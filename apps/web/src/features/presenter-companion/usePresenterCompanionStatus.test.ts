import { describe, expect, it, vi } from "vitest";
import {
  presenterCompanionStatusPollIntervalMs,
  startPresenterCompanionStatusPolling,
} from "./usePresenterCompanionStatus";

describe("presenter companion status polling", () => {
  it("refreshes immediately, keeps the three-second cadence, and cleans up", () => {
    const refresh = vi.fn();
    const setInterval = vi.fn().mockReturnValue(37);
    const clearInterval = vi.fn();

    const cleanup = startPresenterCompanionStatusPolling(refresh, {
      clearInterval,
      setInterval,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledWith(
      refresh,
      presenterCompanionStatusPollIntervalMs,
    );
    expect(presenterCompanionStatusPollIntervalMs).toBe(3_000);

    cleanup();
    expect(clearInterval).toHaveBeenCalledWith(37);
  });
});
