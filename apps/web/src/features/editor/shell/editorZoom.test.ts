import { describe, expect, it, vi } from "vitest";

import {
  getEditorZoomStorageKey,
  getResponsiveEditorStageScale,
  getSteppedEditorZoomScale,
  persistProjectEditorZoom,
  readProjectEditorZoom,
  resolveEditorStageScale,
} from "./editorZoom";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    values,
  };
}

describe("editor zoom", () => {
  it("defaults to Fit and isolates manual zoom by project", () => {
    const storage = createMemoryStorage();
    expect(readProjectEditorZoom("project_a", storage)).toEqual({ mode: "fit" });

    persistProjectEditorZoom(
      "project_a",
      { mode: "manual", scale: 1.25 },
      storage,
    );

    expect(readProjectEditorZoom("project_a", storage)).toEqual({
      mode: "manual",
      scale: 1.25,
    });
    expect(readProjectEditorZoom("project_b", storage)).toEqual({ mode: "fit" });
    expect(getEditorZoomStorageKey("project/a")).not.toBe(
      getEditorZoomStorageKey("project_a"),
    );
  });

  it.each([
    "not-json",
    JSON.stringify({ mode: "fit" }),
    JSON.stringify({ mode: "manual", scale: "1" }),
    JSON.stringify({ mode: "manual", scale: null }),
    JSON.stringify({ mode: "manual", scale: 0.24 }),
    JSON.stringify({ mode: "manual", scale: 2.01 }),
  ])("recovers invalid stored value %s to Fit", (serialized) => {
    const storage = createMemoryStorage();
    storage.values.set(getEditorZoomStorageKey("project_a"), serialized);

    expect(readProjectEditorZoom("project_a", storage)).toEqual({ mode: "fit" });
  });

  it.each([0.25, 1, 2])("accepts manual boundary scale %s", (scale) => {
    const storage = createMemoryStorage();
    storage.values.set(
      getEditorZoomStorageKey("project_a"),
      JSON.stringify({ mode: "manual", scale }),
    );

    expect(readProjectEditorZoom("project_a", storage)).toEqual({
      mode: "manual",
      scale,
    });
  });

  it("removes persisted manual zoom when Fit is selected", () => {
    const storage = createMemoryStorage();
    persistProjectEditorZoom("project_a", { mode: "manual", scale: 1 }, storage);
    persistProjectEditorZoom("project_a", { mode: "fit" }, storage);

    expect(storage.removeItem).toHaveBeenCalledWith(
      getEditorZoomStorageKey("project_a"),
    );
    expect(readProjectEditorZoom("project_a", storage)).toEqual({ mode: "fit" });
  });

  it("fails closed when storage APIs throw", () => {
    expect(
      readProjectEditorZoom("project_a", {
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual({ mode: "fit" });

    expect(() =>
      persistProjectEditorZoom("project_a", { mode: "manual", scale: 1 }, {
        removeItem: vi.fn(),
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).not.toThrow();
  });

  it("recalculates Fit with viewport changes while manual zoom stays invariant", () => {
    const compactFit = resolveEditorStageScale(
      { mode: "fit" },
      1920,
      652,
      1080,
      600,
    );
    const wideFit = resolveEditorStageScale(
      { mode: "fit" },
      1920,
      1679,
      1080,
      1124,
    );

    expect(compactFit).toBeCloseTo(600 / 1920, 5);
    expect(wideFit).toBe(0.66);
    expect(
      resolveEditorStageScale(
        { mode: "manual", scale: 1.5 },
        1920,
        652,
        1080,
        600,
      ),
    ).toBe(1.5);
  });

  it("accounts for editor canvas chrome when Fit is height constrained", () => {
    expect(
      resolveEditorStageScale(
        { mode: "fit" },
        1920,
        1400,
        1080,
        600,
      ),
    ).toBeCloseTo(512 / 1080, 5);
  });

  it("preserves the existing small-screen Fit floor", () => {
    expect(getResponsiveEditorStageScale(1920, 100, 1080, 100)).toBe(0.16);
  });

  it("steps and clamps manual zoom to 25-200 percent", () => {
    expect(getSteppedEditorZoomScale(0.25, "out")).toBe(0.25);
    expect(getSteppedEditorZoomScale(1, "in")).toBe(1.25);
    expect(getSteppedEditorZoomScale(2, "in")).toBe(2);
  });
});
