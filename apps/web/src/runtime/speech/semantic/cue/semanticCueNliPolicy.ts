import type { SemanticMatchDecisionReason } from "../semanticUtteranceDecision";
import { semanticCueRuntimeConfig } from "./semanticCueRuntimeConfig";

export type SemanticCueNliRunReason =
  | "ad_lib_candidate"
  | "ambiguous_candidate"
  | "partial_coverage";

export type SemanticCueNliSkipReason =
  | "feature_disabled"
  | "semantic_matching_disabled"
  | "not_final"
  | "exact_keyword_match"
  | "phrase_match"
  | "semantic_embedding_match"
  | "no_match"
  | "throttled"
  | "low_priority";

export type SemanticCueNliPolicyDecision =
  | { run: true; reason: SemanticCueNliRunReason }
  | { run: false; reason: SemanticCueNliSkipReason };

export function shouldRunSemanticCueNli(options: {
  nliFeatureEnabled: boolean;
  semanticMatchingEnabled: boolean;
  isFinal: boolean;
  phraseMatched: boolean;
  keywordCoverage: number;
  semanticDecisionReason: SemanticMatchDecisionReason | "no_match";
  cuePriority: 1 | 2 | 3;
  cueRetrievalScore?: number;
  isRequired: boolean;
  nowMs: number;
  lastNliRunAtMs: number | null;
  throttleMs?: number;
}): SemanticCueNliPolicyDecision {
  if (!options.nliFeatureEnabled) {
    return { run: false, reason: "feature_disabled" };
  }

  if (!options.semanticMatchingEnabled) {
    return { run: false, reason: "semantic_matching_disabled" };
  }

  if (!options.isFinal) {
    return { run: false, reason: "not_final" };
  }

  if (options.phraseMatched) {
    return { run: false, reason: "phrase_match" };
  }

  if (options.keywordCoverage >= 0.95) {
    return { run: false, reason: "exact_keyword_match" };
  }

  const throttleMs = options.throttleMs ?? 2_500;
  if (
    options.lastNliRunAtMs !== null &&
    options.nowMs - options.lastNliRunAtMs < throttleMs
  ) {
    return { run: false, reason: "throttled" };
  }

  if (options.semanticDecisionReason === "ad-lib") {
    if (options.isRequired || options.cuePriority <= 2) {
      return { run: true, reason: "ad_lib_candidate" };
    }
    return { run: false, reason: "low_priority" };
  }

  if (options.semanticDecisionReason === "rejected-ambiguous") {
    if (options.isRequired || options.cuePriority === 1) {
      return { run: true, reason: "ambiguous_candidate" };
    }
    return { run: false, reason: "low_priority" };
  }

  if (options.keywordCoverage > 0 || options.semanticDecisionReason === "rejected-low-score") {
    return { run: true, reason: "partial_coverage" };
  }

  if (
    options.semanticDecisionReason === "accepted-exact" ||
    options.semanticDecisionReason === "accepted-paraphrase"
  ) {
    return { run: false, reason: "semantic_embedding_match" };
  }

  if (
    (options.cueRetrievalScore ?? 0) >=
    semanticCueRuntimeConfig.candidateEligibility.retrieval
  ) {
    if (options.isRequired || options.cuePriority <= 2) {
      return { run: true, reason: "ambiguous_candidate" };
    }
    return { run: false, reason: "low_priority" };
  }

  return { run: false, reason: "no_match" };
}
