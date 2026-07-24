import { describe, expect, it } from "vitest";

import {
  shouldClosePresenterSessionOnPreflightExit,
  shouldWarnBeforePresentationUnload,
} from "./presentationLifecycle";

describe("presentationLifecycle", () => {
  it("warns only while a live presentation can lose in-progress data", () => {
    expect(shouldWarnBeforePresentationUnload("preflight")).toBe(false);
    expect(shouldWarnBeforePresentationUnload("starting")).toBe(false);
    expect(shouldWarnBeforePresentationUnload("active")).toBe(true);
    expect(shouldWarnBeforePresentationUnload("finishing")).toBe(true);
    expect(shouldWarnBeforePresentationUnload("completed")).toBe(false);
    expect(shouldWarnBeforePresentationUnload("failed")).toBe(false);
  });

  it("closes only companion-only sessions when preflight exits", () => {
    expect(shouldClosePresenterSessionOnPreflightExit(false)).toBe(true);
    expect(shouldClosePresenterSessionOnPreflightExit(true)).toBe(false);
    expect(shouldClosePresenterSessionOnPreflightExit(null)).toBe(false);
  });
});
