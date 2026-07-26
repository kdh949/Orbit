import type { SemanticCapabilityEvent } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import type { SemanticCueDebugEvent } from "../../../runtime/speech/semantic/cue/semanticCueDebugEvents";
import {
  createSemanticCueDebugTimeline,
  serializeSemanticCueDebugTimeline
} from "./semanticCueDebugTimeline";

describe("semanticCueDebugTimeline", () => {
  it("fallback, skipped reason, provider, action block과 capability 복구를 재현한다", () => {
    const timeline = createSemanticCueDebugTimeline({
      capabilityEvents: [capabilityEvent()],
      decisionEvents: [decisionEvent()]
    });

    expect(timeline).toEqual([
      expect.objectContaining({
        kind: "decision",
        fallbackReason: "timeout",
        provider: "browser-transformersjs",
        actionBlockedReasons: ["semantic-fallback-manual-only"],
        skippedReasons: ["throttled"]
      }),
      expect.objectContaining({
        kind: "capability",
        capability: "nli",
        fromState: "degraded",
        toState: "available"
      })
    ]);
  });

  it("기본 export에서 transcript, premise, meaning, hypothesis 원문을 제외한다", () => {
    const json = serializeSemanticCueDebugTimeline({
      capabilityEvents: [capabilityEvent()],
      decisionEvents: [decisionEvent()]
    });

    expect(json).not.toContain("민감한 final transcript");
    expect(json).not.toContain("민감한 premise");
    expect(json).not.toContain("민감한 cue meaning");
    expect(json).not.toContain("민감한 hypothesis");
    expect(JSON.parse(json)).toMatchObject({
      timeline: [
        expect.objectContaining({ fallbackReason: "timeout" }),
        expect.objectContaining({ capability: "nli" })
      ]
    });
  });
});

function capabilityEvent(): SemanticCapabilityEvent {
  return {
    eventId: "cap_recovered",
    capability: "nli",
    fromState: "degraded",
    toState: "available",
    measurementMode: "full",
    retryable: false,
    cueIds: ["scue_1"],
    provider: "browser-transformersjs",
    latencyMs: 44,
    at: "2026-07-10T00:00:01.000Z"
  };
}

function decisionEvent(): SemanticCueDebugEvent {
  return {
    eventId: "debug_timeout",
    timestamp: Date.parse("2026-07-10T00:00:02.000Z"),
    deckId: "deck_1",
    slideId: "slide_1",
    transcript: {
      final: "민감한 final transcript",
      stableWindow: "민감한 premise"
    },
    candidates: [
      {
        cueId: "scue_1",
        meaning: "민감한 cue meaning",
        selectedForNli: false,
        nliSkippedReason: "throttled"
      }
    ],
    nli: {
      provider: "browser-transformersjs",
      premise: "민감한 premise",
      hypotheses: [
        {
          cueId: "scue_1",
          hypothesis: "민감한 hypothesis",
          entailmentScore: 0,
          neutralScore: 1,
          contradictionScore: 0
        }
      ],
      latencyMs: 1_200
    },
    decision: {
      finalScore: 0,
      label: "no_candidate",
      reasonCodes: ["timeout"]
    },
    fallback: {
      used: true,
      reason: "timeout",
      measurementMode: "basic"
    },
    actionGate: {
      allowed: false,
      blockedReasons: ["semantic-fallback-manual-only"]
    }
  };
}
