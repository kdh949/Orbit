import type { SemanticCueDebugTimelineEntry } from "../panel/semanticCueDebugTimeline";

export function SemanticCueEventTimeline(props: {
  entries: readonly SemanticCueDebugTimelineEntry[];
}) {
  if (props.entries.length === 0) {
    return (
      <p className="scue-lab-empty" data-testid="timeline-empty">
        아직 semantic event가 없습니다.
      </p>
    );
  }

  return (
    <ol className="scue-lab-timeline" data-testid="event-timeline">
      {props.entries.map((entry) => (
        <li key={`${entry.kind}:${entry.eventId}`} className={`scue-lab-timeline-item scue-lab-timeline-${entry.kind}`}>
          {entry.kind === "capability" ? (
            <>
              <div className="scue-lab-timeline-head">
                <span className="scue-lab-timeline-kind">capability</span>
                <strong>{entry.capability}</strong>
                <span>
                  {entry.fromState ?? "unknown"} → {entry.toState}
                </span>
              </div>
              <p>
                {entry.reason ? `사유 ${entry.reason} · ` : ""}
                mode {entry.measurementMode}
                {entry.retryable ? " · 재시도 가능" : ""}
                {entry.provider ? ` · ${entry.provider}` : ""}
                {entry.latencyMs === undefined ? "" : ` · ${entry.latencyMs}ms`}
              </p>
            </>
          ) : (
            <>
              <div className="scue-lab-timeline-head">
                <span className="scue-lab-timeline-kind">decision</span>
                <strong>{entry.decisionLabel}</strong>
                <span>{entry.fallbackUsed ? "fallback" : "decision"}</span>
              </div>
              <p>
                {entry.decisionReasonCodes.join(", ") || "no reason"}
                {entry.fallbackReason ? ` · ${entry.fallbackReason}` : ""}
                {entry.skippedReasons.length > 0 ? ` · skip ${entry.skippedReasons.join(", ")}` : ""}
                {entry.actionAllowed
                  ? " · action allowed"
                  : ` · action blocked (${entry.actionBlockedReasons.join(", ") || "unknown"})`}
              </p>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
