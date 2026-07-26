import type { SemanticCapabilityEvent } from "@orbit/shared/rehearsals";

import type { SemanticCueDebugEvent } from "../../../runtime/speech/semantic/cue/semanticCueDebugEvents";
import {
  createSemanticCueDebugTimeline,
  serializeSemanticCueDebugTimeline,
  type SemanticCueDebugTimelineEntry
} from "./semanticCueDebugTimeline";

export const semanticCueDebugPanelQueryKey = "semanticCueDebug";

export function SemanticCueDebugPanel(props: {
  capabilityEvents?: readonly SemanticCapabilityEvent[];
  events: readonly SemanticCueDebugEvent[];
  onCopyJson?: (json: string) => void;
  onExportJson?: (json: string) => void;
}) {
  const timeline = createSemanticCueDebugTimeline({
    capabilityEvents: props.capabilityEvents,
    decisionEvents: props.events
  });
  const json = serializeSemanticCueDebugTimeline({
    capabilityEvents: props.capabilityEvents,
    decisionEvents: props.events
  });

  return (
    <aside
      className="semantic-speech-debug-panel semantic-cue-debug-panel"
      aria-label="Semantic cue fallback debug panel"
    >
      <header>
        <strong>Semantic Cue NLI fallback timeline</strong>
        <span>{timeline.length} events</span>
      </header>

      <div className="semantic-cue-debug-actions">
        <button type="button" onClick={() => props.onCopyJson?.(json)}>
          Copy JSON
        </button>
        <button type="button" onClick={() => props.onExportJson?.(json)}>
          Export JSON
        </button>
      </div>

      {timeline.length > 0 ? (
        <ol className="semantic-cue-debug-timeline">
          {timeline.map((entry) => (
            <li key={`${entry.kind}:${entry.eventId}`}>
              {entry.kind === "capability" ? (
                <CapabilityTimelineEntry entry={entry} />
              ) : (
                <DecisionTimelineEntry entry={entry} />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <section>
          <span>Timeline</span>
          <p>아직 semantic cue fallback 이벤트가 없습니다.</p>
        </section>
      )}
    </aside>
  );
}

function CapabilityTimelineEntry(props: {
  entry: Extract<SemanticCueDebugTimelineEntry, { kind: "capability" }>;
}) {
  const { entry } = props;
  return (
    <>
      <div>
        <strong>{entry.capability}</strong>
        <span>{entry.toState === "available" ? "복구" : "상태 변경"}</span>
      </div>
      <p>
        {entry.fromState ?? "unknown"} → {entry.toState}
        {entry.reason ? ` · ${entry.reason}` : ""}
      </p>
      <small>
        {entry.measurementMode}
        {entry.provider ? ` · ${entry.provider}` : ""}
        {entry.latencyMs === undefined ? "" : ` · ${entry.latencyMs}ms`}
        {entry.affectedCueIds.length > 0
          ? ` · cues ${entry.affectedCueIds.join(", ")}`
          : ""}
      </small>
    </>
  );
}

function DecisionTimelineEntry(props: {
  entry: Extract<SemanticCueDebugTimelineEntry, { kind: "decision" }>;
}) {
  const { entry } = props;
  return (
    <>
      <div>
        <strong>{entry.decisionLabel}</strong>
        <span>{entry.fallbackUsed ? "fallback" : "decision"}</span>
      </div>
      <p>
        {entry.decisionReasonCodes.join(", ") || "no reason"}
        {entry.fallbackReason ? ` · ${entry.fallbackReason}` : ""}
      </p>
      <small>
        {entry.provider ?? "provider not run"}
        {entry.latencyMs === undefined ? "" : ` · ${entry.latencyMs}ms`}
        {entry.skippedReasons.length > 0
          ? ` · skipped ${entry.skippedReasons.join(", ")}`
          : ""}
        {entry.affectedCueIds.length > 0
          ? ` · cues ${entry.affectedCueIds.join(", ")}`
          : ""}
        {entry.actionAllowed
          ? " · action allowed"
          : ` · action blocked ${entry.actionBlockedReasons.join(", ") || "unknown"}`}
      </small>
    </>
  );
}

export function shouldShowSemanticCueDebugPanel(options: {
  flagEnabled: boolean;
  locationSearch?: string;
}) {
  if (options.flagEnabled) {
    return true;
  }

  const search = options.locationSearch ?? "";
  if (!search) {
    return false;
  }

  return new URLSearchParams(search).get(semanticCueDebugPanelQueryKey) === "1";
}

export function serializeSemanticCueDebugEvents(
  events: readonly SemanticCueDebugEvent[]
) {
  return serializeSemanticCueDebugTimeline({ decisionEvents: events });
}
