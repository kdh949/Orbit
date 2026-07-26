export type SemanticCueRuntimeConfig = {
  candidateWeights: {
    lexical: number;
    conceptCoverage: number;
    retrieval: number;
    importance: number;
  };
  candidateEligibility: {
    lexical: number;
    retrieval: number;
  };
  maxCandidates: number;
  maxNliCandidates: number;
  maxHypothesesPerCue: number;
  maxNliTokens: number;
  nliTimeoutMs: number;
  nliThrottleMs: number;
  basicCoveredRetrieval: number;
  basicPartialScore: number;
  basicPartialConceptCoverage: number;
};

export const semanticCueRuntimeConfig: SemanticCueRuntimeConfig = {
  candidateWeights: {
    lexical: 0.2,
    conceptCoverage: 0.25,
    retrieval: 0.45,
    importance: 0.1
  },
  candidateEligibility: {
    lexical: 0.2,
    retrieval: 0.55
  },
  maxCandidates: 3,
  maxNliCandidates: 2,
  maxHypothesesPerCue: 2,
  maxNliTokens: 96,
  nliTimeoutMs: 1_200,
  nliThrottleMs: 2_500,
  basicCoveredRetrieval: 0.6,
  basicPartialScore: 0.62,
  basicPartialConceptCoverage: 0.34
};
