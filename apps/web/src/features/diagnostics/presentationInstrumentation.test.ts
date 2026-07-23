import { describe, expect, it } from "vitest";

import { OrbitDiagnosticRecorder } from "./diagnosticRecorder";
import {
  emitKeywordOccurrenceEvaluations,
  emitSpeechAnimationRuntimeDecisions
} from "./presentationInstrumentation";

describe("presentation diagnostic trace", () => {
  it("keeps one utterance trace across STT, matcher, runtime, React, and transition", () => {
    const diagnostics = new OrbitDiagnosticRecorder({
      createId: () => "session-1"
    });
    diagnostics.start({ mode: "full", surface: "presentation" });
    const triggerTraceId = "speech:item-1:0";
    const baseTrace = {
      itemId: "item-1",
      contentIndex: 0,
      triggerTraceId
    };
    diagnostics.emit({
      stage: "stt",
      name: "stt.result.normalized",
      outcome: "accepted",
      trace: baseTrace
    });
    emitKeywordOccurrenceEvaluations({
      diagnostics,
      slideId: "slide-1",
      trace: baseTrace,
      evaluations: [
        {
          keywordId: "keyword-1",
          occurrenceId: "occurrence-1",
          outcome: "accepted",
          reasons: [],
          evidence: {
            latestTranscript: "orbit",
            normalizedLatestTranscript: "orbit",
            confidenceAvailable: false,
            confidenceValue: null,
            confidenceThreshold: 0.7,
            confidencePassed: true,
            confidencePolicy: "BYPASS_THRESHOLD_WHEN_UNAVAILABLE",
            keywordTerms: ["orbit"],
            matchedTerms: ["orbit"],
            keywordHitCount: 1,
            previousCharOffset: 0,
            currentCharOffset: 5,
            occurrenceStart: 0,
            occurrenceEnd: 5,
            windowBeforeChars: 24,
            windowAfterChars: 36,
            isTarget: true,
            alreadyConfirmed: false,
            withinProgressWindow: true,
            selectedForTranscriptSpan: true
          }
        }
      ]
    });
    emitSpeechAnimationRuntimeDecisions({
      diagnostics,
      slideId: "slide-1",
      decisions: [
        {
          name: "intent_executed",
          outcome: "accepted",
          triggerTraceId,
          currentStepIndex: 0,
          requiredStepIndex: 0
        }
      ]
    });
    diagnostics.emit({
      stage: "react",
      name: "react.presenter_step.committed",
      outcome: "committed",
      trace: {
        slideId: "slide-1",
        stateTransitionId: "state-1",
        triggerTraceId
      }
    });
    diagnostics.emit({
      stage: "transition",
      name: "transition.settled",
      outcome: "settled",
      trace: {
        slideId: "slide-1",
        stateTransitionId: "state-1",
        transitionId: "transition-1",
        triggerTraceId
      }
    });

    const tracedEvents = diagnostics
      .snapshot()
      .recentEvents.filter(
        (event) => event.trace.triggerTraceId === triggerTraceId
      );
    expect(tracedEvents.map((event) => event.name)).toEqual([
      "stt.result.normalized",
      "matcher.occurrence.evaluated",
      "runtime.intent.executed",
      "react.presenter_step.committed",
      "transition.settled"
    ]);
  });
});
