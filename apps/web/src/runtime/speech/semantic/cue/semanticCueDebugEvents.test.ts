import { describe, expect, it } from "vitest";

import {
  createSemanticCueDebugEvent,
  createSemanticCueDebugRingBuffer
} from "./semanticCueDebugEvents";

describe("semantic cue debug events", () => {
  it("keeps a bounded in-memory ring buffer", () => {
    const buffer = createSemanticCueDebugRingBuffer(2);

    buffer.push(debugEvent("event_1"));
    buffer.push(debugEvent("event_2"));
    buffer.push(debugEvent("event_3"));

    expect(buffer.snapshot().map((event) => event.eventId)).toEqual([
      "event_2",
      "event_3"
    ]);
  });

  it("builds skipped and blocked decision context without persistence side effects", () => {
    const event = createSemanticCueDebugEvent({
      eventId: "event_1",
      timestamp: 1_000,
      deckId: "deck_1",
      slideId: "slide_1",
      transcript: {
        stableWindow: "CAC는 중요한 지표입니다"
      },
      candidates: [
        {
          cueId: "scue_1",
          meaning: "CAC 원인 설명",
          selectedForNli: false,
          nliSkippedReason: "exact_keyword_match"
        }
      ],
      decision: {
        finalScore: 0,
        label: "no_candidate",
        reasonCodes: ["exact_keyword_match"]
      },
      actionGate: {
        allowed: false,
        blockedReasons: ["nli-cannot-advance-slide-alone"]
      }
    });

    expect(event.candidates[0]?.nliSkippedReason).toBe("exact_keyword_match");
    expect(event.actionGate?.blockedReasons).toContain(
      "nli-cannot-advance-slide-alone"
    );
  });
});

function debugEvent(eventId: string) {
  return createSemanticCueDebugEvent({
    eventId,
    timestamp: 1_000,
    deckId: "deck_1",
    slideId: "slide_1",
    transcript: {
      stableWindow: "final"
    },
    candidates: [],
    decision: {
      finalScore: 0,
      label: "no_candidate",
      reasonCodes: ["no-candidate"]
    }
  });
}
