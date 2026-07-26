import { describe, expect, it } from "vitest";

import { createSemanticCapabilityState } from "./semanticCapabilityState";

describe("semanticCapabilityState", () => {
  it("상태가 실제로 바뀔 때만 안전한 capability event를 만든다", () => {
    const state = createSemanticCapabilityState({
      now: () => 1_000
    });

    const recovered = state.transition({
      capability: "stt",
      toState: "available",
      measurementMode: "full",
      retryable: false,
      cueIds: []
    });
    const duplicate = state.transition({
      capability: "stt",
      toState: "available",
      measurementMode: "full",
      retryable: false,
      cueIds: []
    });

    expect(recovered).toMatchObject({
      capability: "stt",
      fromState: "unavailable",
      toState: "available",
      measurementMode: "full",
      at: new Date(1_000).toISOString()
    });
    expect(duplicate).toBeNull();
    expect(state.snapshot().stt).toBe("available");
    expect(JSON.stringify(recovered)).not.toContain("transcript");
  });

  it("degraded 전환에는 구체적 fallback reason과 영향 cue만 기록한다", () => {
    const state = createSemanticCapabilityState({ now: () => 2_000 });

    expect(
      state.transition({
        capability: "cue_freshness",
        toState: "degraded",
        reason: "stale_cue",
        measurementMode: "none",
        retryable: false,
        slideId: "slide_1",
        cueIds: ["scue_1", "scue_1"]
      })
    ).toMatchObject({
      capability: "cue_freshness",
      fromState: "available",
      toState: "degraded",
      reason: "stale_cue",
      cueIds: ["scue_1"]
    });
  });
});
