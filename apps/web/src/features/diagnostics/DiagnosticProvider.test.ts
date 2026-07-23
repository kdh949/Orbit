import { describe, expect, it } from "vitest";

import {
  DiagnosticAutoStartController,
  getDiagnosticSurface,
  hasAnimationDebugOptIn,
  hashDiagnosticIdentifier
} from "./DiagnosticProvider";

describe("DiagnosticProvider policy", () => {
  it("only opts in with animationDebug=1", () => {
    expect(hasAnimationDebugOptIn("?animationDebug=1")).toBe(true);
    expect(hasAnimationDebugOptIn("?animationDebug=0")).toBe(false);
    expect(hasAnimationDebugOptIn("")).toBe(false);
  });

  it("maps only diagnostic presentation surfaces", () => {
    expect(getDiagnosticSurface("/presentation/project-1")).toBe(
      "presentation"
    );
    expect(getDiagnosticSurface("/rehearsal/project-1")).toBe("rehearsal");
    expect(getDiagnosticSurface("/project/project-1")).toBe(
      "editor-partial-rehearsal"
    );
    expect(getDiagnosticSurface("/login")).toBeNull();
  });

  it("hashes project identifiers without retaining the input", () => {
    expect(hashDiagnosticIdentifier("project-secret")).toMatch(/^fnv1a:/);
    expect(hashDiagnosticIdentifier("project-secret")).not.toContain(
      "project-secret"
    );
    expect(hashDiagnosticIdentifier("project-secret")).toBe(
      hashDiagnosticIdentifier("project-secret")
    );
  });

  it("starts once, respects manual stop, and restarts after page re-entry", () => {
    const controller = new DiagnosticAutoStartController();
    const locationKey = "/presentation/project-1?animationDebug=1";

    expect(
      controller.reconcile({
        locationKey,
        mode: "off",
        shouldAutoStart: true
      })
    ).toBe("start");
    expect(
      controller.reconcile({
        locationKey,
        mode: "full",
        shouldAutoStart: true
      })
    ).toBeNull();

    controller.block(locationKey);
    expect(
      controller.reconcile({
        locationKey,
        mode: "off",
        shouldAutoStart: true
      })
    ).toBeNull();
    expect(
      controller.reconcile({
        locationKey: "/project/project-1",
        mode: "off",
        shouldAutoStart: false
      })
    ).toBeNull();
    expect(
      controller.reconcile({
        locationKey,
        mode: "off",
        shouldAutoStart: true
      })
    ).toBe("start");
  });

  it("stops an active session at a route boundary", () => {
    const controller = new DiagnosticAutoStartController();
    controller.markStarted("/presentation/project-1?animationDebug=1");

    expect(
      controller.reconcile({
        locationKey: "/project/project-1",
        mode: "full",
        shouldAutoStart: false
      })
    ).toBe("stop");
  });
});
