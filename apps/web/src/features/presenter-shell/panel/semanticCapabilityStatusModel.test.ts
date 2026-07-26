import type { SemanticCapabilityEvent } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  createSemanticCapabilityStatusItems,
  isSemanticAutoActionAllowed
} from "./semanticCapabilityStatusModel";

describe("semanticCapabilityStatusModel", () => {
  it("capability별 최신 상태를 정해진 우선순위로 정렬한다", () => {
    const items = createSemanticCapabilityStatusItems(
      [
        event({ capability: "nli", reason: "timeout", cueIds: ["a"] }),
        event({ capability: "stt", reason: "permission_denied", cueIds: ["a", "b"] }),
        event({ capability: "cue_freshness", reason: "stale_cue", cueIds: ["c"] })
      ],
      { nowMs: Date.parse("2026-07-10T00:00:01.000Z") }
    );

    expect(items.map((item) => item.key)).toEqual([
      "stt",
      "cue_freshness",
      "nli"
    ]);
    expect(items[0]).toMatchObject({
      affectedCount: 2,
      actionLabel: "마이크 권한 확인",
      severity: "error",
      source: "system-status"
    });
  });

  it("복구 상태를 3초간 같은 row로 유지한 뒤 제거한다", () => {
    const recovered = event({
      capability: "semantic_runtime",
      fromState: "unavailable",
      toState: "available",
      reason: undefined,
      at: "2026-07-10T00:00:03.000Z"
    });

    expect(
      createSemanticCapabilityStatusItems([recovered], {
        nowMs: Date.parse("2026-07-10T00:00:05.999Z")
      })
    ).toEqual([
      expect.objectContaining({
        key: "semantic_runtime",
        recovered: true,
        shortLabel: "복구됨"
      })
    ]);
    expect(
      createSemanticCapabilityStatusItems([recovered], {
        nowMs: Date.parse("2026-07-10T00:00:06.001Z")
      })
    ).toEqual([]);
  });

  it("raw transcript나 cue ID를 view-model에 복사하지 않는다", () => {
    const items = createSemanticCapabilityStatusItems(
      [event({ cueIds: ["scue_private"] })],
      { nowMs: Date.parse("2026-07-10T00:00:01.000Z") }
    );
    const serialized = JSON.stringify(items);

    expect(serialized).not.toContain("scue_private");
    expect(serialized).not.toContain("transcript");
  });

  it("활성 fallback 상태에서는 semantic auto action을 보수적으로 차단한다", () => {
    const active = createSemanticCapabilityStatusItems(
      [event({ capability: "nli", reason: "timeout" })],
      { nowMs: Date.parse("2026-07-10T00:00:01.000Z") }
    );

    expect(isSemanticAutoActionAllowed(active)).toBe(false);
    expect(
      isSemanticAutoActionAllowed(
        active.map((item) => ({ ...item, recovered: true }))
      )
    ).toBe(true);
  });
});

function event(overrides: Partial<SemanticCapabilityEvent>): SemanticCapabilityEvent {
  return {
    eventId: `cap_${overrides.capability ?? "nli"}`,
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
