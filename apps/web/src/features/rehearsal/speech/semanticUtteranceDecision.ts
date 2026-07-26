import { calculateWordMultisetRecall } from "../../../runtime/speech/tracking/speechMatcher";
import type { SemanticUtteranceMatch } from "./semanticUtterance.types";

export type UtteranceOutcomeKind = "covered" | "paraphrased" | "ad-lib" | "missed";

export type RuntimeUtteranceOutcomeKind = Exclude<UtteranceOutcomeKind, "missed">;

export type SemanticMatchDecisionReason =
  | "accepted-exact"
  | "accepted-paraphrase"
  | "rejected-low-score"
  | "rejected-ambiguous"
  | "rejected-covered"
  | "ad-lib";

export type SemanticOutcomePolicy = {
  adLibRejectThreshold: number;
  ambiguousMargin: number;
  exactLexicalThreshold: number;
};

export type SemanticUtteranceDecision = {
  accepted: boolean;
  slideId: string;
  transcript: string;
  isFinal: true;
  topMatches: SemanticUtteranceMatch[];
  acceptedMatch: SemanticUtteranceMatch | null;
  reason: SemanticMatchDecisionReason;
  outcome: RuntimeUtteranceOutcomeKind | null;
  scoreThreshold: number;
  ambiguousMargin: number;
  lexicalOverlap: number;
};

export const SEMANTIC_OUTCOME_POLICY: SemanticOutcomePolicy = Object.freeze({
  adLibRejectThreshold: 0.89,
  ambiguousMargin: 0.04,
  exactLexicalThreshold: 0.55
});

export function decideSemanticUtteranceOutcome(options: {
  slideId: string;
  transcript: string;
  topMatches: readonly SemanticUtteranceMatch[];
  policy?: SemanticOutcomePolicy;
}): SemanticUtteranceDecision {
  const policy = options.policy ?? SEMANTIC_OUTCOME_POLICY;
  const topMatches = [...options.topMatches];
  const [first, second] = topMatches;
  const base = {
    slideId: options.slideId,
    transcript: options.transcript,
    isFinal: true as const,
    topMatches,
    scoreThreshold: policy.adLibRejectThreshold,
    ambiguousMargin: policy.ambiguousMargin
  };

  if (!first || first.similarity < policy.adLibRejectThreshold) {
    return {
      ...base,
      accepted: false,
      acceptedMatch: null,
      reason: "ad-lib",
      outcome: "ad-lib",
      lexicalOverlap: 0
    };
  }

  if (first.covered) {
    return {
      ...base,
      accepted: false,
      acceptedMatch: null,
      reason: "rejected-covered",
      outcome: null,
      lexicalOverlap: calculateLexicalOverlap(options.transcript, first.text)
    };
  }

  if (second && first.similarity - second.similarity < policy.ambiguousMargin) {
    return {
      ...base,
      accepted: false,
      acceptedMatch: null,
      reason: "rejected-ambiguous",
      outcome: null,
      lexicalOverlap: calculateLexicalOverlap(options.transcript, first.text)
    };
  }

  const lexicalOverlap = calculateLexicalOverlap(options.transcript, first.text);
  const outcome =
    lexicalOverlap >= policy.exactLexicalThreshold ? "covered" : "paraphrased";

  return {
    ...base,
    accepted: true,
    acceptedMatch: first,
    reason: outcome === "covered" ? "accepted-exact" : "accepted-paraphrase",
    outcome,
    lexicalOverlap
  };
}

function calculateLexicalOverlap(transcript: string, scriptSentence: string) {
  return calculateWordMultisetRecall({
    scriptText: scriptSentence,
    transcriptText: transcript
  });
}
