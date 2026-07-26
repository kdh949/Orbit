import type {
  SemanticCueNliDecision,
  SemanticCueNliProvider,
  SemanticCueNliProviderInfo
} from "./semanticCueNliProvider";

export type MockSemanticCueNliScores = Pick<
  SemanticCueNliDecision,
  "entailmentScore" | "neutralScore" | "contradictionScore"
>;

export function createMockSemanticCueNliProvider(options: {
  scoresByCueId?: Record<string, MockSemanticCueNliScores>;
  defaultScores?: MockSemanticCueNliScores;
  modelId?: string;
  now?: () => number;
} = {}): SemanticCueNliProvider {
  const modelId = options.modelId ?? "mock-semantic-cue-nli";
  const now = options.now ?? (() => Date.now());
  const defaultScores =
    options.defaultScores ??
    Object.freeze({
      entailmentScore: 0.1,
      neutralScore: 0.8,
      contradictionScore: 0.1
    });

  return {
    async load(): Promise<SemanticCueNliProviderInfo> {
      return {
        provider: "mock",
        status: "ready",
        modelId,
        loadedAtMs: now()
      };
    },
    async evaluate(input) {
      return input.hypotheses.map((hypothesis) => {
        const scores = options.scoresByCueId?.[hypothesis.cueId] ?? defaultScores;

        return {
          cueId: hypothesis.cueId,
          hypothesis: hypothesis.hypothesis,
          provider: "mock",
          modelId,
          latencyMs: 0,
          ...scores
        };
      });
    }
  };
}
