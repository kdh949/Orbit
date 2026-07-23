import { rerankAlternatives } from "./alternativeReranker";
import type { DiagnosticSink } from "../../diagnostics/diagnosticTypes";
import {
  normalizeLiveSttBiasPhrases,
  type LiveSttBiasPhrase,
  type LiveSttError,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "./liveSttPort";

export class RerankingLiveSttPort implements LiveSttPort {
  private biasPhrases: LiveSttBiasPhrase[] = [];

  constructor(
    private readonly inner: LiveSttPort,
    private readonly diagnostics?: DiagnosticSink
  ) {}

  get engineId() {
    return this.inner.engineId;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  async start(config: LiveSttSessionConfig) {
    this.biasPhrases = normalizeLiveSttBiasPhrases(config.biasPhrases);
    await this.inner.start({
      ...config,
      biasPhrases: this.biasPhrases
    });
  }

  stop() {
    return this.inner.stop();
  }

  updateBiasPhrases(phrases: readonly LiveSttBiasPhrase[]) {
    this.biasPhrases = normalizeLiveSttBiasPhrases(phrases);
    return this.inner.updateBiasPhrases(this.biasPhrases);
  }

  onResult(cb: (result: LiveSttResult) => void): LiveSttUnsubscribe {
    return this.inner.onResult((result) => cb(this.rerankResult(result)));
  }

  onError(cb: (error: LiveSttError) => void): LiveSttUnsubscribe {
    return this.inner.onError(cb);
  }

  dispose() {
    return this.inner.dispose();
  }

  private rerankResult(result: LiveSttResult): LiveSttResult {
    const { alternatives: _alternatives, ...resultWithoutAlternatives } = result;
    const reason = getRerankSkipReason(result, this.biasPhrases);
    if (reason) {
      this.emitRerankDecision(result, {
        changed: false,
        reason,
        selectedIndex: 0
      });
      return resultWithoutAlternatives;
    }

    const alternatives = result.alternatives ?? [];
    const decision = rerankAlternatives(alternatives, this.biasPhrases);
    if (!decision?.changed) {
      this.emitRerankDecision(result, {
        changed: false,
        reason: decision
          ? decision.selectedScore < 0.75
            ? "SELECTED_SCORE_BELOW_THRESHOLD"
            : "NO_SCORE_IMPROVEMENT"
          : "NO_ALTERNATIVES",
        selectedIndex: decision?.selectedIndex ?? 0,
        originalScore: decision?.originalScore,
        selectedScore: decision?.selectedScore
      });
      return resultWithoutAlternatives;
    }

    this.emitRerankDecision(result, {
      changed: true,
      selectedIndex: decision.selectedIndex,
      originalScore: decision.originalScore,
      selectedScore: decision.selectedScore
    });
    const { confidence: _confidence, ...baseResult } = resultWithoutAlternatives;
    return {
      ...baseResult,
      text: decision.selected.text,
      ...(typeof decision.selected.confidence === "number"
        ? { confidence: decision.selected.confidence }
        : {})
    };
  }

  private emitRerankDecision(
    result: LiveSttResult,
    decision: {
      changed: boolean;
      reason?: string;
      selectedIndex: number;
      originalScore?: number;
      selectedScore?: number;
    }
  ) {
    this.diagnostics?.emit({
      stage: "bias",
      name: "bias.rerank_evaluated",
      outcome: decision.changed ? "accepted" : "skipped",
      reason: decision.reason,
      trace: result.diagnosticTrace,
      data: {
        isFinal: result.isFinal,
        biasPhraseCount: this.biasPhrases.length,
        alternativeCount: result.alternatives?.length ?? 0,
        selectedIndex: decision.selectedIndex,
        changed: decision.changed,
        originalScore: decision.originalScore ?? null,
        selectedScore: decision.selectedScore ?? null,
        requiredScore: 0.75
      }
    });
  }
}

function getRerankSkipReason(
  result: LiveSttResult,
  biasPhrases: readonly LiveSttBiasPhrase[]
) {
  if (!result.isFinal) return "NOT_FINAL";
  if (!result.alternatives) return "NO_ALTERNATIVES";
  if (result.alternatives.length < 2) return "ONLY_ONE_ALTERNATIVE";
  if (biasPhrases.length === 0) return "NO_BIAS_PHRASES";
  return null;
}
