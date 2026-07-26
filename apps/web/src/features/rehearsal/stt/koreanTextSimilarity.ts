import { normalizeLiveTranscriptText } from "../../../runtime/speech/stt/liveTranscriptText";
import type { LiveSttBiasPhrase } from "../../../runtime/speech/stt/liveSttPort";

export const KOREAN_BIAS_SIMILARITY_THRESHOLD = 0.75;

export function normalizeKoreanBiasText(value: string) {
  return normalizeLiveTranscriptText(value).normalize("NFD");
}

export function jamoEditSimilarity(left: string, right: string) {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const distance = editDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

export function scoreBiasMatch(
  candidateText: string,
  phrases: readonly LiveSttBiasPhrase[]
) {
  const normalizedCandidate = normalizeKoreanBiasText(candidateText);
  if (!normalizedCandidate || phrases.length === 0) {
    return 0;
  }

  return phrases.reduce((score, phrase) => {
    if (phrase.weight <= 0) {
      return score;
    }

    const normalizedPhrase = normalizeKoreanBiasText(phrase.text);
    if (!normalizedPhrase) {
      return score;
    }

    const similarity = scorePhraseSimilarity(normalizedCandidate, normalizedPhrase);
    if (similarity < KOREAN_BIAS_SIMILARITY_THRESHOLD) {
      return score;
    }

    return score + similarity * phrase.weight;
  }, 0);
}

function scorePhraseSimilarity(candidate: string, phrase: string) {
  if (candidate.includes(phrase)) {
    return 1;
  }

  let best = 0;
  const minLength = Math.max(1, phrase.length - 2);
  const maxLength = phrase.length + 2;
  for (let windowLength = minLength; windowLength <= maxLength; windowLength += 1) {
    if (windowLength > candidate.length) {
      continue;
    }

    for (let start = 0; start <= candidate.length - windowLength; start += 1) {
      const window = candidate.slice(start, start + windowLength);
      best = Math.max(best, jamoEditSimilarity(window, phrase));
    }
  }

  return best;
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }

  return previous[right.length] ?? 0;
}
