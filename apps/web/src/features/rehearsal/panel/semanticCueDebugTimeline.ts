import type {
  SemanticCapability,
  SemanticCapabilityEvent,
  SemanticCapabilityState,
  SemanticFallbackReason,
  SemanticMeasurementMode
} from "@orbit/shared";

import type { SemanticCueDebugEvent } from "../../../runtime/speech/semantic/cue/semanticCueDebugEvents";

export type SemanticCueDebugTimelineEntry =
  | {
      kind: "capability";
      eventId: string;
      timestamp: number;
      capability: SemanticCapability;
      fromState: SemanticCapabilityState | null;
      toState: SemanticCapabilityState;
      reason?: SemanticFallbackReason;
      measurementMode: SemanticMeasurementMode;
      retryable: boolean;
      slideId?: string;
      affectedCueIds: string[];
      provider?: string;
      latencyMs?: number;
    }
  | {
      kind: "decision";
      eventId: string;
      timestamp: number;
      slideId: string;
      decisionLabel: SemanticCueDebugEvent["decision"]["label"];
      decisionReasonCodes: string[];
      affectedCueIds: string[];
      skippedReasons: string[];
      provider?: string;
      latencyMs?: number;
      fallbackUsed: boolean;
      fallbackReason?: SemanticFallbackReason;
      measurementMode?: SemanticMeasurementMode;
      actionAllowed: boolean;
      actionBlockedReasons: string[];
      transcriptExcerpt?: string;
    };

export function createSemanticCueDebugTimeline(options: {
  capabilityEvents?: readonly SemanticCapabilityEvent[];
  decisionEvents: readonly SemanticCueDebugEvent[];
  includeTranscriptExcerpt?: boolean;
}): SemanticCueDebugTimelineEntry[] {
  const capabilityEntries: SemanticCueDebugTimelineEntry[] = (
    options.capabilityEvents ?? []
  ).map((event) => ({
    kind: "capability",
    eventId: event.eventId,
    timestamp: Date.parse(event.at),
    capability: event.capability,
    fromState: event.fromState,
    toState: event.toState,
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    measurementMode: event.measurementMode,
    retryable: event.retryable,
    ...(event.slideId === undefined ? {} : { slideId: event.slideId }),
    affectedCueIds: [...event.cueIds],
    ...(event.provider === undefined ? {} : { provider: event.provider }),
    ...(event.latencyMs === undefined ? {} : { latencyMs: event.latencyMs })
  }));
  const decisionEntries: SemanticCueDebugTimelineEntry[] =
    options.decisionEvents.map((event) => ({
      kind: "decision",
      eventId: event.eventId,
      timestamp: event.timestamp,
      slideId: event.slideId,
      decisionLabel: event.decision.label,
      decisionReasonCodes: [...event.decision.reasonCodes],
      affectedCueIds: event.candidates.map((candidate) => candidate.cueId),
      skippedReasons: Array.from(
        new Set(
          event.candidates.flatMap((candidate) =>
            candidate.nliSkippedReason ? [candidate.nliSkippedReason] : []
          )
        )
      ),
      ...(event.nli?.provider === undefined
        ? {}
        : { provider: event.nli.provider }),
      ...(event.nli?.latencyMs === undefined
        ? {}
        : { latencyMs: event.nli.latencyMs }),
      fallbackUsed: event.fallback?.used ?? false,
      ...(event.fallback?.reason === undefined
        ? {}
        : { fallbackReason: event.fallback.reason }),
      ...(event.fallback?.measurementMode === undefined
        ? {}
        : { measurementMode: event.fallback.measurementMode }),
      actionAllowed: event.actionGate?.allowed ?? false,
      actionBlockedReasons: [...(event.actionGate?.blockedReasons ?? [])],
      ...(options.includeTranscriptExcerpt
        ? {
            transcriptExcerpt: normalizeExcerpt(
              event.transcript.final ?? event.transcript.stableWindow,
              160
            )
          }
        : {})
    }));

  return [...capabilityEntries, ...decisionEntries].sort(
    (left, right) => right.timestamp - left.timestamp
  );
}

export function serializeSemanticCueDebugTimeline(options: {
  capabilityEvents?: readonly SemanticCapabilityEvent[];
  decisionEvents: readonly SemanticCueDebugEvent[];
  includeTranscriptExcerpt?: boolean;
}) {
  return JSON.stringify(
    { timeline: createSemanticCueDebugTimeline(options) },
    null,
    2
  );
}

function normalizeExcerpt(value: string, maxLength: number) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
