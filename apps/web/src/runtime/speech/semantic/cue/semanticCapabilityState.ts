import {
  semanticCapabilityEventSchema,
  type SemanticCapability,
  type SemanticCapabilityEvent,
  type SemanticCapabilityState,
  type SemanticFallbackReason,
  type SemanticMeasurementMode
} from "@orbit/shared";

export type SemanticCapabilityStatuses = Record<
  SemanticCapability,
  SemanticCapabilityState
>;

export type SemanticCapabilityTransition = {
  capability: SemanticCapability;
  toState: SemanticCapabilityState;
  reason?: SemanticFallbackReason;
  measurementMode: SemanticMeasurementMode;
  retryable: boolean;
  slideId?: string;
  cueIds: readonly string[];
  provider?: string;
  latencyMs?: number;
};

export function createSemanticCapabilityState(options: {
  now?: () => number;
  initial?: Partial<SemanticCapabilityStatuses>;
} = {}) {
  const now = options.now ?? (() => Date.now());
  let sequence = 0;
  const statuses: SemanticCapabilityStatuses = {
    stt: "unavailable",
    semantic_runtime: "available",
    embedding: "available",
    nli: "available",
    server_evaluation: "unavailable",
    cue_freshness: "available",
    transcript_evidence: "unavailable",
    ...options.initial
  };

  function transition(
    input: SemanticCapabilityTransition
  ): SemanticCapabilityEvent | null {
    const fromState = statuses[input.capability];
    if (fromState === input.toState) {
      return null;
    }

    const atMs = now();
    const event = semanticCapabilityEventSchema.parse({
      eventId: `semantic_cap_${Math.round(atMs)}_${sequence++}`,
      capability: input.capability,
      fromState,
      toState: input.toState,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      measurementMode: input.measurementMode,
      retryable: input.retryable,
      ...(input.slideId === undefined ? {} : { slideId: input.slideId }),
      cueIds: [...new Set(input.cueIds)],
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
      at: new Date(atMs).toISOString()
    });
    statuses[input.capability] = input.toState;
    return event;
  }

  return {
    transition,
    snapshot: (): SemanticCapabilityStatuses => ({ ...statuses })
  };
}
