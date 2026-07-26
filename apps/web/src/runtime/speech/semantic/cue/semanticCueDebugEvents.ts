import type {
  SemanticFallbackReason,
  SemanticMeasurementMode
} from "@orbit/shared";

import type { SemanticCueNliProviderId } from "../nli/semanticCueNliProvider";

export type SemanticCueDebugEvent = {
  eventId: string;
  timestamp: number;
  deckId: string;
  slideId: string;
  slideTitle?: string;
  transcript: {
    partial?: string;
    final?: string;
    stableWindow: string;
    stabilityScore?: number;
  };
  candidates: SemanticCueDebugCandidate[];
  nli?: {
    provider: SemanticCueNliProviderId;
    modelId?: string;
    premise: string;
    hypotheses: Array<{
      cueId: string;
      hypothesis: string;
      entailmentScore: number;
      neutralScore: number;
      contradictionScore: number;
    }>;
    latencyMs: number;
  };
  decision: {
    cueId?: string;
    finalScore: number;
    label: "covered" | "partial" | "not_covered" | "contradicted" | "no_candidate";
    reasonCodes: string[];
  };
  fallback?: {
    used: boolean;
    reason: SemanticFallbackReason;
    measurementMode: SemanticMeasurementMode;
  };
  actionGate?: {
    requestedAction?: string;
    allowed: boolean;
    blockedReasons: string[];
    cooldownUntil?: number;
    requiredCueCoverage?: number;
  };
};

export type SemanticCueDebugCandidate = {
  cueId: string;
  meaning: string;
  lexicalScore?: number;
  keywordCoverage?: number;
  conceptCoverage?: number;
  embeddingScore?: number;
  selectedForNli: boolean;
  nliSkippedReason?: string;
};

export function createSemanticCueDebugEvent(
  event: SemanticCueDebugEvent
): SemanticCueDebugEvent {
  return event;
}

export function createSemanticCueDebugRingBuffer(limit = 100) {
  const events: SemanticCueDebugEvent[] = [];

  return {
    push(event: SemanticCueDebugEvent) {
      events.push(event);
      if (events.length > limit) {
        events.splice(0, events.length - limit);
      }
    },
    snapshot() {
      return [...events];
    },
    clear() {
      events.length = 0;
    }
  };
}
