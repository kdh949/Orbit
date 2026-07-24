import { describe, expect, it } from "vitest";
import type { AudienceStreamBridgeWindow } from "../rehearsal/presenter/audienceStreamBridge";
import { resolveAudienceStreamObservationTarget } from "./useLivePresentationOutput";

describe("resolveAudienceStreamObservationTarget", () => {
  const audienceWindow = {} as AudienceStreamBridgeWindow;
  const selfWindow = {} as AudienceStreamBridgeWindow;
  const resolve = (
    displayRole: "presenter" | "slide-receiver" | "slide-surface",
    audienceWindowConnected: boolean,
  ) =>
    resolveAudienceStreamObservationTarget({
      audienceWindowConnected,
      displayRole,
      getAudienceWindow: () => audienceWindow,
      getSelfWindow: () => selfWindow,
    });

  it("observes the child audience window while presenting", () => {
    expect(resolve("presenter", true)).toBe(audienceWindow);
  });

  it("observes nothing until the child audience window connects", () => {
    expect(resolve("presenter", false)).toBeNull();
  });

  it("observes this window once it becomes the audience surface", () => {
    // The presenter remote window attaches its capture to `window.opener`,
    // which is this window, so there is no child window to observe.
    expect(resolve("slide-surface", false)).toBe(selfWindow);
    expect(resolve("slide-receiver", false)).toBe(selfWindow);
  });
});
