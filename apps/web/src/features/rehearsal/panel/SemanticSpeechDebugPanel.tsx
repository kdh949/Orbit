import type { SemanticUtteranceDebugState } from "../speech/semanticSpeechDebug";

export const semanticSpeechDebugPanelStorageKey =
  "orbit.semanticSpeech.debugPanel";

export function SemanticSpeechDebugPanel(props: {
  liveTranscript?: string;
  semanticMatchingEnabled: boolean;
  state: SemanticUtteranceDebugState;
}) {
  const transcript = props.state.transcript.trim();
  const decision = props.state.decision;
  const acceptedSentenceId = decision?.acceptedMatch?.sentenceId ?? null;
  const acceptedRank = decision?.acceptedMatch?.rank ?? null;
  const outcomeLabel =
    decision?.outcome ?? (decision ? "rejected" : "pending");
  const decisionDisposition = decision
    ? decision.accepted
      ? "accepted"
      : "rejected"
    : "no-decision";

  return (
    <aside
      className="semantic-speech-debug-panel"
      aria-label="Semantic STT debug panel"
    >
      <header>
        <strong>Semantic STT</strong>
        <span>{props.state.status}</span>
      </header>

      <section>
        <span>실시간 전체 인식</span>
        <p aria-live="polite">
          {props.liveTranscript?.trim() || "아직 인식된 음성이 없습니다."}
        </p>
      </section>

      <section>
        <span>방금 인식</span>
        <p>{transcript || "아직 final STT 문장이 없습니다."}</p>
      </section>

      {props.state.error && (
        <p className="semantic-speech-debug-error">{props.state.error}</p>
      )}

      <section>
        <span>Decision</span>
        <p>
          {outcomeLabel} · {decisionDisposition} ·{" "}
          {decision?.reason ?? "no-decision"}
          {decision ? (
            <>
              {" "}
              · threshold {decision.scoreThreshold.toFixed(3)} · margin{" "}
              {decision.ambiguousMargin.toFixed(3)}
            </>
          ) : null}
        </p>
      </section>

      <ol>
        {props.state.topMatches.map((match) => {
          const isApplied =
            props.semanticMatchingEnabled &&
            acceptedSentenceId === match.sentenceId &&
            acceptedRank === match.rank &&
            decision?.accepted === true &&
            props.state.status === "ready";
          return (
            <li key={`${match.rank}-${match.sentenceId}`}>
              <div>
                <strong>
                  #{match.rank} · {match.similarity.toFixed(3)} · 문장{" "}
                  {match.sentenceIndex + 1}
                </strong>
                <span>{isApplied ? "적용" : "참고"}</span>
              </div>
              <p>{match.text}</p>
              {match.covered && <small>covered</small>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function shouldShowSemanticSpeechDebugPanel(options: {
  isDevelopment: boolean;
  storage?: Pick<Storage, "getItem"> | null;
}) {
  try {
    return options.storage?.getItem(semanticSpeechDebugPanelStorageKey) === "1";
  } catch {
    return false;
  }
}
