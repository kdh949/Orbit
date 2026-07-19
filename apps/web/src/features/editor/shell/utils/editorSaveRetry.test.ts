import { describe, expect, it, vi } from "vitest";

import { createEditorSaveRetryCoordinator } from "./editorSaveRetry";

describe("createEditorSaveRetryCoordinator", () => {
  it("keeps a failed patch pending and reports an error until an online retry succeeds", async () => {
    const pending = ["patch-1"];
    const attempts: string[] = [];
    const states: string[] = [];
    let online = false;
    const coordinator = createEditorSaveRetryCoordinator({
      flushNext: async () => {
        const patch = pending[0];
        if (!patch) return;
        attempts.push(patch);
        if (!online) throw new Error("network offline");
        pending.shift();
      },
      hasPending: () => pending.length > 0,
      onFailure: () => states.push("error"),
      onStart: (reason) => states.push(`saving:${reason}`),
      onSuccess: (reason) => states.push(`saved:${reason}`)
    });

    await expect(coordinator.retry("auto")).rejects.toThrow("network offline");
    expect(pending).toEqual(["patch-1"]);
    expect(states.at(-1)).toBe("error");

    online = true;
    await coordinator.retry("online");

    expect(pending).toEqual([]);
    expect(attempts).toEqual(["patch-1", "patch-1"]);
    expect(states.at(-1)).toBe("saved:online");
  });

  it("uses the same pending patch flow for an explicit manual retry", async () => {
    const pending = ["patch-1"];
    const onSuccess = vi.fn();
    const coordinator = createEditorSaveRetryCoordinator({
      flushNext: async () => {
        pending.shift();
      },
      hasPending: () => pending.length > 0,
      onFailure: vi.fn(),
      onStart: vi.fn(),
      onSuccess
    });

    await coordinator.retry("manual");

    expect(pending).toEqual([]);
    expect(onSuccess).toHaveBeenCalledWith("manual");
  });

  it("coalesces concurrent retry requests so a patch is acknowledged once", async () => {
    const pending = ["patch-1"];
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const flushNext = vi.fn(async () => {
      await flushGate;
      pending.shift();
    });
    const coordinator = createEditorSaveRetryCoordinator({
      flushNext,
      hasPending: () => pending.length > 0,
      onFailure: vi.fn(),
      onStart: vi.fn(),
      onSuccess: vi.fn()
    });

    const automaticRetry = coordinator.retry("online");
    const manualRetry = coordinator.retry("manual");
    releaseFlush();
    await Promise.all([automaticRetry, manualRetry]);

    expect(flushNext).toHaveBeenCalledTimes(1);
    expect(pending).toEqual([]);
  });
});
