import type {
  SpeechAnimationRuntimeDecision
} from "../rehearsal/playback/speechAnimationRuntime";
import type {
  KeywordOccurrenceEvaluation
} from "../rehearsal/speech/keywordOccurrenceRuntime";
import type {
  DiagnosticSink,
  DiagnosticTrace
} from "./diagnosticTypes";

export function emitKeywordOccurrenceEvaluations(args: {
  diagnostics: DiagnosticSink;
  evaluations: readonly KeywordOccurrenceEvaluation[];
  slideId: string;
  trace?: DiagnosticTrace | null;
}) {
  for (const evaluation of args.evaluations) {
    args.diagnostics.emit({
      stage: "matcher",
      name: "matcher.occurrence.evaluated",
      outcome: evaluation.outcome,
      ...(evaluation.reasons[0] === undefined
        ? {}
        : { reason: evaluation.reasons[0] }),
      trace: {
        ...(args.trace ?? {}),
        keywordId: evaluation.keywordId,
        occurrenceId: evaluation.occurrenceId,
        slideId: args.slideId
      },
      data: {
        ...evaluation.evidence,
        reasons: evaluation.reasons
      }
    });
  }
}

export function emitSpeechAnimationRuntimeDecisions(args: {
  decisions: readonly SpeechAnimationRuntimeDecision[];
  diagnostics: DiagnosticSink;
  slideId: string;
}) {
  for (const decision of args.decisions) {
    args.diagnostics.emit({
      stage: decision.name.startsWith("action_") ? "action" : "runtime",
      name: getRuntimeDiagnosticName(decision.name),
      outcome: decision.outcome,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      trace: {
        slideId: args.slideId,
        ...(decision.triggerTraceId === undefined
          ? {}
          : { triggerTraceId: decision.triggerTraceId }),
        ...(decision.actionId === undefined
          ? {}
          : { actionId: decision.actionId }),
        ...(decision.animationId === undefined
          ? {}
          : { animationId: decision.animationId }),
        ...(decision.occurrenceId === undefined
          ? {}
          : { occurrenceId: decision.occurrenceId })
      },
      data: {
        currentStepIndex: decision.currentStepIndex,
        ...(decision.requiredStepIndex === undefined
          ? {}
          : { requiredStepIndex: decision.requiredStepIndex }),
        ...(decision.triggerKey === undefined
          ? {}
          : { triggerKey: decision.triggerKey })
      }
    });
  }
}

function getRuntimeDiagnosticName(
  name: SpeechAnimationRuntimeDecision["name"]
) {
  switch (name) {
    case "action_resolved":
      return "action.resolved";
    case "action_rejected":
      return "action.rejected";
    case "intent_queued":
      return "runtime.intent.queued";
    case "intent_executed":
      return "runtime.intent.executed";
    case "transition_settled":
      return "runtime.transition.settled";
    case "transition_settle_rejected":
      return "runtime.transition.settle_rejected";
    case "trigger_received":
      return "runtime.trigger.received";
    case "trigger_ignored":
      return "runtime.trigger.ignored";
    case "queue_blocked":
      return "runtime.queue.blocked";
  }
}
