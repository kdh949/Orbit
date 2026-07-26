import { scoreBiasMatch } from "./koreanTextSimilarity";
import type { LiveSttAlternative, LiveSttBiasPhrase } from "../../../runtime/speech/stt/liveSttPort";

export type RerankDecision = {
  selected: LiveSttAlternative;
  selectedIndex: number;
  originalScore: number;
  selectedScore: number;
  changed: boolean;
};

export function rerankAlternatives(
  alternatives: readonly LiveSttAlternative[],
  phrases: readonly LiveSttBiasPhrase[]
): RerankDecision | null {
  const original = alternatives[0];
  if (!original) {
    return null;
  }

  const originalScore = scoreBiasMatch(original.text, phrases);
  if (alternatives.length === 1 || phrases.length === 0) {
    return {
      selected: original,
      selectedIndex: 0,
      originalScore,
      selectedScore: originalScore,
      changed: false
    };
  }

  const best = alternatives.reduce(
    (currentBest, alternative, index) => {
      const score = scoreBiasMatch(alternative.text, phrases);
      if (isBetterAlternative({ alternative, index, score }, currentBest)) {
        return { alternative, index, score };
      }

      return currentBest;
    },
    { alternative: original, index: 0, score: originalScore }
  );

  const changed = best.score > originalScore && best.score >= 0.75;
  return {
    selected: changed ? best.alternative : original,
    selectedIndex: changed ? best.index : 0,
    originalScore,
    selectedScore: changed ? best.score : originalScore,
    changed
  };
}

function isBetterAlternative(
  candidate: {
    alternative: LiveSttAlternative;
    index: number;
    score: number;
  },
  current: {
    alternative: LiveSttAlternative;
    index: number;
    score: number;
  }
) {
  if (candidate.score !== current.score) {
    return candidate.score > current.score;
  }

  const candidateConfidence = candidate.alternative.confidence ?? 0;
  const currentConfidence = current.alternative.confidence ?? 0;
  if (candidateConfidence !== currentConfidence) {
    return candidateConfidence > currentConfidence;
  }

  return candidate.index < current.index;
}
