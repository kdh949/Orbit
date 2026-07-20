import { describe, expect, it, vi } from "vitest";
import { createSlideAssetNavigationGate } from "./slideAssetNavigationGate";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("slideAssetNavigationGate", () => {
  it("keeps the current slide until target assets are ready", async () => {
    const preparation = deferred();
    const commit = vi.fn();
    const pending = vi.fn();
    const gate = createSlideAssetNavigationGate({
      commit,
      onPendingChange: pending,
      prepare: async () => preparation.promise
    });

    const request = gate.request({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: 1
    });

    expect(commit).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(true);

    preparation.resolve();
    await expect(request).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledWith({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: 1
    });
    expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("ignores automatic navigation while a request is pending", async () => {
    const preparation = deferred();
    const gate = createSlideAssetNavigationGate({
      commit: vi.fn(),
      onPendingChange: vi.fn(),
      prepare: async () => preparation.promise
    });

    const manual = gate.request({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: 1
    });
    await expect(
      gate.request({ source: "auto", stepIndex: 0, targetSlideIndex: 2 })
    ).resolves.toBe("ignored");

    preparation.resolve();
    await manual;
  });

  it("lets an explicit remote goto supersede a pending request", async () => {
    const first = deferred();
    const second = deferred();
    const commit = vi.fn();
    const gate = createSlideAssetNavigationGate({
      commit,
      onPendingChange: vi.fn(),
      prepare: vi
        .fn()
        .mockImplementationOnce(async () => first.promise)
        .mockImplementationOnce(async () => second.promise)
    });

    const manual = gate.request({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: 1
    });
    const goto = gate.request({
      source: "remote-goto",
      stepIndex: 2,
      targetSlideIndex: 4
    });

    first.resolve();
    await expect(manual).resolves.toBe("superseded");
    expect(commit).not.toHaveBeenCalled();

    second.resolve();
    await expect(goto).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith({
      source: "remote-goto",
      stepIndex: 2,
      targetSlideIndex: 4
    });
  });

  it("continues with the placeholder and clears pending when preparation rejects", async () => {
    const commit = vi.fn();
    const pending = vi.fn();
    const gate = createSlideAssetNavigationGate({
      commit,
      onPendingChange: pending,
      prepare: vi.fn(async () => {
        throw new Error("image preparation failed");
      })
    });
    const request = {
      source: "manual" as const,
      stepIndex: 0,
      targetSlideIndex: 1
    };

    await expect(gate.request(request)).resolves.toBe("committed");

    expect(commit).toHaveBeenCalledWith(request);
    expect(gate.isPending()).toBe(false);
    expect(pending).toHaveBeenNthCalledWith(1, true);
    expect(pending).toHaveBeenLastCalledWith(false);
  });
});
