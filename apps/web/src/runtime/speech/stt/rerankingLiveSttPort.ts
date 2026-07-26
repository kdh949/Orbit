import { rerankAlternatives } from "./alternativeReranker";
import {
  normalizeLiveSttBiasPhrases,
  type LiveSttBiasPhrase,
  type LiveSttError,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe,
} from "./liveSttPort";

export class RerankingLiveSttPort implements LiveSttPort {
  private biasPhrases: LiveSttBiasPhrase[] = [];

  constructor(private readonly inner: LiveSttPort) {}

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
      biasPhrases: this.biasPhrases,
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
    const { alternatives: _alternatives, ...resultWithoutAlternatives } =
      result;
    if (
      !result.isFinal ||
      !result.alternatives ||
      result.alternatives.length < 2 ||
      this.biasPhrases.length === 0
    ) {
      return resultWithoutAlternatives;
    }

    const decision = rerankAlternatives(result.alternatives, this.biasPhrases);
    if (!decision?.changed) {
      return resultWithoutAlternatives;
    }

    const { confidence: _confidence, ...baseResult } =
      resultWithoutAlternatives;
    return {
      ...baseResult,
      text: decision.selected.text,
      ...(typeof decision.selected.confidence === "number"
        ? { confidence: decision.selected.confidence }
        : {}),
    };
  }
}
