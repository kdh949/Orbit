import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/slideRenderUtils", () => ({
  waitForAnimationFrame: vi.fn(async () => undefined),
  waitForSlideAssets: vi.fn(async () => 0),
}));

import {
  isPrintKeyboardShortcut,
  waitForDeckPrintAssets,
} from "./useEditorPrint";

describe("editor print preparation", () => {
  it("recognizes only unmodified Ctrl/Cmd+P shortcuts", () => {
    expect(
      isPrintKeyboardShortcut({
        altKey: false,
        ctrlKey: true,
        key: "p",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isPrintKeyboardShortcut({
        altKey: false,
        ctrlKey: false,
        key: "P",
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isPrintKeyboardShortcut({
        altKey: false,
        ctrlKey: true,
        key: "p",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
  });

  it("preloads every slide asset before printing", async () => {
    const deck = createDemoDeck();
    const loadSlideAssets = vi.fn(async () => 0);

    await waitForDeckPrintAssets(deck, { loadSlideAssets, timeoutMs: 50 });

    expect(loadSlideAssets).toHaveBeenCalledTimes(deck.slides.length);
  });

  it("stops waiting for print assets at the configured timeout", async () => {
    vi.useFakeTimers();
    const deck = createDemoDeck();
    const pending = waitForDeckPrintAssets(deck, {
      loadSlideAssets: () => new Promise<number>(() => undefined),
      timeoutMs: 20,
    });

    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
