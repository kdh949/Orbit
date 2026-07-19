import { describe, expect, it } from "vitest";

import {
  getEditorCommandScrollState,
  getEditorCommandScrollTarget,
} from "./EditorCommandScroller";

describe("getEditorCommandScrollState", () => {
  it("does not expose navigation without overflow", () => {
    expect(
      getEditorCommandScrollState({
        clientWidth: 800,
        scrollLeft: 0,
        scrollWidth: 800,
      }),
    ).toEqual({
      canScrollLeft: false,
      canScrollRight: false,
      hasOverflow: false,
    });
  });

  it("tracks the available direction at the start, middle, and end", () => {
    expect(
      getEditorCommandScrollState({
        clientWidth: 400,
        scrollLeft: 0,
        scrollWidth: 1_000,
      }),
    ).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
      hasOverflow: true,
    });
    expect(
      getEditorCommandScrollState({
        clientWidth: 400,
        scrollLeft: 300,
        scrollWidth: 1_000,
      }),
    ).toEqual({
      canScrollLeft: true,
      canScrollRight: true,
      hasOverflow: true,
    });
    expect(
      getEditorCommandScrollState({
        clientWidth: 400,
        scrollLeft: 600,
        scrollWidth: 1_000,
      }),
    ).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
      hasOverflow: true,
    });
  });
});

describe("getEditorCommandScrollTarget", () => {
  it("moves by the visible page minus one control", () => {
    expect(
      getEditorCommandScrollTarget(
        { clientWidth: 400, scrollLeft: 100, scrollWidth: 1_000 },
        1,
      ),
    ).toBe(460);
    expect(
      getEditorCommandScrollTarget(
        { clientWidth: 400, scrollLeft: 460, scrollWidth: 1_000 },
        -1,
      ),
    ).toBe(100);
  });

  it("clamps page movement to both scroll edges", () => {
    expect(
      getEditorCommandScrollTarget(
        { clientWidth: 400, scrollLeft: 550, scrollWidth: 1_000 },
        1,
      ),
    ).toBe(600);
    expect(
      getEditorCommandScrollTarget(
        { clientWidth: 400, scrollLeft: 40, scrollWidth: 1_000 },
        -1,
      ),
    ).toBe(0);
  });

  it("uses a minimum useful step for very narrow viewports", () => {
    expect(
      getEditorCommandScrollTarget(
        { clientWidth: 96, scrollLeft: 0, scrollWidth: 500 },
        1,
      ),
    ).toBe(160);
  });
});
