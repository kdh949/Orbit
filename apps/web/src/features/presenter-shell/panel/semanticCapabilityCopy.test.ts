import type { SemanticCapabilityEvent } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { getSemanticCapabilityCopy } from "./semanticCapabilityCopy";

describe("semanticCapabilityCopy", () => {
  it.each([
    ["stt", "user_disabled", "음성 인식 꺼짐"],
    ["stt", "permission_denied", "마이크 권한 필요"],
    ["semantic_runtime", "runtime_error", "의미 체크 오프라인"],
    ["nli", "timeout", "정밀 판정 비활성"],
    ["cue_freshness", "stale_cue", "Cue 재검토 필요"],
    ["transcript_evidence", "transcript_incomplete", "근거 부족"],
    ["nli", "provider_unavailable", "정밀 판정 비활성"]
  ] as const)("%s/%s를 system-status copy로 매핑한다", (capability, reason, label) => {
    const copy = getSemanticCapabilityCopy(
      capabilityEvent({ capability, reason })
    );

    expect(copy.shortLabel).toBe(label);
    expect(copy.source).toBe("system-status");
    expect(copy.detail.length).toBeGreaterThan(0);
  });

  it("복구 이벤트는 기존 장애와 같은 자리에 표시할 copy를 만든다", () => {
    expect(
      getSemanticCapabilityCopy(
        capabilityEvent({
          capability: "nli",
          fromState: "degraded",
          toState: "available",
          reason: undefined
        })
      )
    ).toMatchObject({
      shortLabel: "복구됨",
      source: "system-status"
    });
  });
});

function capabilityEvent(
  overrides: Partial<SemanticCapabilityEvent> = {}
): SemanticCapabilityEvent {
  return {
    eventId: "cap_1",
    capability: "nli",
    fromState: "available",
    toState: "unavailable",
    reason: "timeout",
    measurementMode: "none",
    retryable: true,
    cueIds: [],
    at: "2026-07-10T00:00:00.000Z",
    ...overrides
  };
}
