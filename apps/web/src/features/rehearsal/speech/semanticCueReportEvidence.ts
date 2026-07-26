import type { RehearsalSemanticCueDecision } from "@orbit/shared";

import type { SemanticCueCandidate } from "./semanticCueCandidateSelector";
import type { SemanticCueScoreCombination } from "./semanticCueScoreCombiner";
import type { SemanticCueNliDecision } from "../../../runtime/speech/semantic/nli/semanticCueNliProvider";

export function buildSemanticCueReportEvidence(options: {
  slideId: string;
  candidate: SemanticCueCandidate;
  nliDecision: SemanticCueNliDecision;
  combination: SemanticCueScoreCombination;
  premise: string;
  at?: string;
}): RehearsalSemanticCueDecision {
  return {
    slideId: options.slideId,
    cueId: options.candidate.cue.cueId,
    label: options.combination.label,
    finalScore: options.combination.finalScore,
    lexicalScore: options.candidate.lexicalScore,
    conceptCoverage: options.candidate.conceptCoverage,
    entailmentScore: options.nliDecision.entailmentScore,
    neutralScore: options.nliDecision.neutralScore,
    contradictionScore: options.nliDecision.contradictionScore,
    premise: normalizeBoundedText(options.premise, 600),
    hypothesis: normalizeBoundedText(options.nliDecision.hypothesis, 300),
    matchedBy: "nli",
    measurementMode: "full",
    fallbackUsed: false,
    provider: options.nliDecision.provider,
    ...(options.nliDecision.modelId === undefined
      ? {}
      : { modelId: options.nliDecision.modelId }),
    reasonCodes: options.combination.reasonCodes,
    ...(options.at === undefined ? {} : { at: options.at })
  };
}

export function normalizeBoundedText(value: string, maxLength: number) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
