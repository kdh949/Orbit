import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SemanticCueDebugPanel,
  serializeSemanticCueDebugEvents,
  shouldShowSemanticCueDebugPanel
} from "./SemanticCueDebugPanel";
import type { SemanticCueDebugEvent } from "../../../runtime/speech/semantic/cue/semanticCueDebugEvents";
import type { SemanticCapabilityEvent } from "@orbit/shared";

describe("SemanticCueDebugPanel", () => {
  it("renders NLI execution and blocked action reasons", () => {
    const html = renderToStaticMarkup(
      <SemanticCueDebugPanel
        capabilityEvents={[capabilityEvent()]}
        events={[debugEvent()]}
      />
    );

    expect(html).toContain("Semantic Cue NLI");
    expect(html).toContain("covered");
    expect(html).toContain("browser-transformersjs");
    expect(html).toContain("nli-cannot-advance-slide-alone");
    expect(html).toContain("scue_intro_1");
    expect(html).toContain("degraded → available");
    expect(html).toContain("timeout");
    expect(html).toContain("복구");
  });

  it("serializes ring buffer snapshots for copy and export", () => {
    const json = serializeSemanticCueDebugEvents([debugEvent()]);

    expect(JSON.parse(json)).toMatchObject({
      timeline: [expect.objectContaining({ eventId: "scue_dbg_1" })]
    });
    expect(json).not.toContain("bounded premise");
  });
});

describe("shouldShowSemanticCueDebugPanel", () => {
  it("uses only feature flag or query opt-in", () => {
    expect(
      shouldShowSemanticCueDebugPanel({
        flagEnabled: false,
        locationSearch: ""
      })
    ).toBe(false);
    expect(
      shouldShowSemanticCueDebugPanel({
        flagEnabled: true,
        locationSearch: ""
      })
    ).toBe(true);
    expect(
      shouldShowSemanticCueDebugPanel({
        flagEnabled: false,
        locationSearch: "?semanticCueDebug=1"
      })
    ).toBe(true);
  });
});

function debugEvent(): SemanticCueDebugEvent {
  return {
    eventId: "scue_dbg_1",
    timestamp: 1,
    deckId: "deck_1",
    slideId: "slide_1",
    transcript: {
      final: "bounded premise",
      stableWindow: "bounded premise"
    },
    candidates: [
      {
        cueId: "scue_intro_1",
        meaning: "문제 정의를 설명했다",
        lexicalScore: 0.2,
        conceptCoverage: 0.6,
        selectedForNli: true
      }
    ],
    nli: {
      provider: "browser-transformersjs",
      modelId: "model",
      premise: "bounded premise",
      hypotheses: [
        {
          cueId: "scue_intro_1",
          hypothesis: "문제 정의를 설명했다",
          entailmentScore: 0.9,
          neutralScore: 0.05,
          contradictionScore: 0.05
        }
      ],
      latencyMs: 42
    },
    decision: {
      cueId: "scue_intro_1",
      finalScore: 0.78,
      label: "covered",
      reasonCodes: ["nli-entailment"]
    },
    fallback: {
      used: true,
      reason: "timeout",
      measurementMode: "basic"
    },
    actionGate: {
      allowed: false,
      blockedReasons: ["nli-cannot-advance-slide-alone"]
    }
  };
}

function capabilityEvent(): SemanticCapabilityEvent {
  return {
    eventId: "cap_1",
    capability: "nli",
    fromState: "degraded",
    toState: "available",
    measurementMode: "full",
    retryable: false,
    cueIds: ["scue_intro_1"],
    provider: "browser-transformersjs",
    latencyMs: 42,
    at: new Date(2).toISOString()
  };
}
