import type {
  SemanticCapability,
  SemanticCapabilityEvent
} from "@orbit/shared/rehearsals";

import { getSemanticCapabilityCopy } from "./semanticCapabilityCopy";
import type { SemanticCapabilityStatusItem } from "../../../runtime/speech/semantic/semanticCapabilityStatus";

export type { SemanticCapabilityStatusItem } from "../../../runtime/speech/semantic/semanticCapabilityStatus";

const capabilityPriority: SemanticCapability[] = [
  "stt",
  "semantic_runtime",
  "cue_freshness",
  "server_evaluation",
  "nli",
  "transcript_evidence",
  "embedding"
];

export function createSemanticCapabilityStatusItems(
  events: readonly SemanticCapabilityEvent[],
  options: { nowMs?: number; recoveryVisibleMs?: number } = {}
): SemanticCapabilityStatusItem[] {
  const nowMs = options.nowMs ?? Date.now();
  const recoveryVisibleMs = options.recoveryVisibleMs ?? 3_000;
  const latestByCapability = new Map<SemanticCapability, SemanticCapabilityEvent>();
  for (const event of events) {
    latestByCapability.set(event.capability, event);
  }

  return capabilityPriority.flatMap((capability) => {
    const event = latestByCapability.get(capability);
    if (!event) {
      return [];
    }
    const recovered = event.toState === "available";
    if (
      recovered &&
      nowMs - Date.parse(event.at) > recoveryVisibleMs
    ) {
      return [];
    }
    const copy = getSemanticCapabilityCopy(event);
    return [
      {
        key: capability,
        severity: recovered
          ? "info"
          : event.toState === "unavailable"
            ? "error"
            : "warning",
        shortLabel: copy.shortLabel,
        detail: copy.detail,
        retryable: event.retryable,
        affectedCount: event.cueIds.length,
        source: copy.source,
        ...(copy.actionLabel === undefined ? {} : { actionLabel: copy.actionLabel }),
        recovered,
        measurementMode: event.measurementMode
      }
    ];
  });
}

export function getNextSemanticCapabilityRecoveryDelay(
  events: readonly SemanticCapabilityEvent[],
  nowMs: number,
  recoveryVisibleMs = 3_000
) {
  const latestByCapability = new Map<SemanticCapability, SemanticCapabilityEvent>();
  for (const event of events) {
    latestByCapability.set(event.capability, event);
  }
  const delays = Array.from(latestByCapability.values())
    .filter((event) => event.toState === "available")
    .map((event) => Date.parse(event.at) + recoveryVisibleMs - nowMs)
    .filter((delay) => delay >= 0);
  return delays.length > 0 ? Math.min(...delays) : null;
}

export function isSemanticAutoActionAllowed(
  items: readonly SemanticCapabilityStatusItem[]
) {
  return items.every((item) => item.recovered);
}
