import { describe, expect, it } from "vitest";

import type { ActivityElementRuntime } from "./ActivityElementRuntimeContext";
import { resolveActivityQrElementAudienceUrl } from "./activityQrElementRuntime";

describe("editable activity QR element runtime", () => {
  it("uses the read-only rehearsal lookup when no live runtime is injected", () => {
    expect(
      resolveActivityQrElementAudienceUrl({
        activityId: "activity_1",
        lookupState: {
          status: "ready",
          audienceUrl: "https://orbit.example/audience/session_1/a/activity_1"
        },
        runtime: null
      })
    ).toBe("https://orbit.example/audience/session_1/a/activity_1");
  });

  it("keeps an injected live runtime authoritative", () => {
    const runtime: ActivityElementRuntime = {
      audienceUrl: "https://orbit.example/audience/session_live",
      displayPasscode: "4821"
    };

    expect(
      resolveActivityQrElementAudienceUrl({
        activityId: "activity_1",
        lookupState: {
          status: "ready",
          audienceUrl: "https://orbit.example/audience/session_stale/a/activity_1"
        },
        runtime
      })
    ).toBe("https://orbit.example/audience/session_live/a/activity_1");
  });
});
