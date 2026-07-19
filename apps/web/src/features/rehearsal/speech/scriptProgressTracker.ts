import type { PronunciationLexiconEntry } from "@orbit/shared";
import type { LiveSttResult } from "../stt/liveSttPort";
import { createCanonicalScriptSentenceIndex } from "./canonicalScriptSentenceIndex";
import { toCanonicalPronunciationMatchingText } from "./pronunciationMatchingAdapter";
import type { ScriptProgressSnapshot } from "./speechTrackingEvents";

const MATCH_RESULT_TOLERANCE = 20;
const AGREEMENT_TOLERANCE = 10;
const SMALL_FORWARD_STEP = 15;
const RECENT_CANDIDATE_LIMIT = 3;

export type ScriptProgressTracker = {
  acceptResult: (
    result: Pick<LiveSttResult, "text" | "isFinal">,
  ) => ScriptProgressSnapshot;
  reset: () => void;
  snapshot: () => ScriptProgressSnapshot;
};

export function createScriptProgressTracker(
  speakerNotes: string,
  options: {
    pronunciationEntries?: readonly PronunciationLexiconEntry[];
    slideId?: string;
  } = {},
): ScriptProgressTracker {
  const sentenceIndex = createCanonicalScriptSentenceIndex(speakerNotes);
  const sourceText = sentenceIndex.sourceText;
  const sourceCharacters = Array.from(sourceText);
  let committedOffset = 0;
  let segmentBaseOffset = 0;
  let recentCandidates: number[] = [];
  let confidence: ScriptProgressSnapshot["confidence"] = "none";

  function acceptResult(
    result: Pick<LiveSttResult, "text" | "isFinal">,
  ): ScriptProgressSnapshot {
    const spoken = normalizeSourceText(
      toCanonicalPronunciationMatchingText(
        result.text,
        options.pronunciationEntries,
        options.slideId,
      ),
    );
    if (!spoken || sourceCharacters.length === 0) {
      if (result.isFinal) {
        finishSegment();
      }
      return snapshot();
    }

    const remainingSource = sourceCharacters.slice(segmentBaseOffset).join("");
    const characterResult = characterLevelMatch(remainingSource, spoken);
    const wordResult = wordLevelMatch(remainingSource, spoken);
    const matchedCharacters =
      Math.abs(characterResult - wordResult) <= MATCH_RESULT_TOLERANCE
        ? Math.round((characterResult + wordResult) / 2)
        : Math.min(characterResult, wordResult);
    const candidate = Math.min(
      segmentBaseOffset + matchedCharacters,
      sourceCharacters.length,
    );

    if (candidate > committedOffset) {
      recentCandidates.push(candidate);
      if (recentCandidates.length > RECENT_CANDIDATE_LIMIT) {
        recentCandidates.shift();
      }

      const hasAgreement =
        recentCandidates.filter(
          (position) => Math.abs(position - candidate) <= AGREEMENT_TOLERANCE,
        ).length >= 2;
      const isSmallStep = candidate - committedOffset <= SMALL_FORWARD_STEP;

      if (hasAgreement || isSmallStep) {
        committedOffset = candidate;
        confidence = "confirmed";
      } else {
        confidence = "candidate";
      }
    }

    if (result.isFinal) {
      finishSegment();
    }

    return snapshot();
  }

  function finishSegment() {
    segmentBaseOffset = committedOffset;
    recentCandidates = [];
  }

  function reset() {
    committedOffset = 0;
    segmentBaseOffset = 0;
    recentCandidates = [];
    confidence = "none";
  }

  function snapshot(): ScriptProgressSnapshot {
    const totalChars = sourceCharacters.length;
    const currentSentence =
      sentenceIndex.sentences.find(
        (sentence) => committedOffset <= sentence.endOffset + 1
      ) ?? null;
    const sentenceTotalChars = currentSentence
      ? currentSentence.endOffset - currentSentence.startOffset
      : 0;
    const sentenceCharOffset = currentSentence
      ? Math.min(
          Math.max(committedOffset - currentSentence.startOffset, 0),
          sentenceTotalChars
        )
      : 0;

    return {
      charOffset: committedOffset,
      totalChars,
      ratio: totalChars === 0 ? 0 : committedOffset / totalChars,
      confidence,
      sentenceId: currentSentence?.sentenceId ?? null,
      sentenceCharOffset,
      sentenceTotalChars,
      sentenceRatio:
        sentenceTotalChars === 0 ? 0 : sentenceCharOffset / sentenceTotalChars
    };
  }

  return { acceptResult, reset, snapshot };
}

function characterLevelMatch(source: string, spoken: string) {
  const sourceCharacters = Array.from(source.toLocaleLowerCase("ko-KR"));
  const spokenCharacters = Array.from(spoken.toLocaleLowerCase("ko-KR"));
  let sourceIndex = 0;
  let spokenIndex = 0;
  let lastMatchedSourceIndex = 0;

  while (
    sourceIndex < sourceCharacters.length &&
    spokenIndex < spokenCharacters.length
  ) {
    const sourceCharacter = sourceCharacters[sourceIndex] ?? "";
    const spokenCharacter = spokenCharacters[spokenIndex] ?? "";

    if (!isLetterOrNumber(sourceCharacter)) {
      sourceIndex += 1;
      continue;
    }
    if (!isLetterOrNumber(spokenCharacter)) {
      spokenIndex += 1;
      continue;
    }

    if (sourceCharacter === spokenCharacter) {
      sourceIndex += 1;
      spokenIndex += 1;
      lastMatchedSourceIndex = sourceIndex;
      continue;
    }

    const spokenResync = findMatchingOffset(
      spokenCharacters,
      spokenIndex,
      sourceCharacter,
    );
    if (spokenResync !== null) {
      spokenIndex = spokenResync;
      continue;
    }

    const sourceResync = findMatchingOffset(
      sourceCharacters,
      sourceIndex,
      spokenCharacter,
    );
    if (sourceResync !== null) {
      sourceIndex = sourceResync;
      continue;
    }

    spokenIndex += 1;
  }

  return lastMatchedSourceIndex;
}

function findMatchingOffset(
  characters: readonly string[],
  currentIndex: number,
  expected: string,
) {
  const maxSkip = Math.min(3, characters.length - currentIndex - 1);
  for (let skip = 1; skip <= maxSkip; skip += 1) {
    const candidateIndex = currentIndex + skip;
    if (characters[candidateIndex] === expected) {
      return candidateIndex;
    }
  }

  return null;
}

function wordLevelMatch(source: string, spoken: string) {
  const sourceWords = source.split(" ").filter(Boolean);
  const spokenWords = spoken.split(" ").filter(Boolean);
  let sourceIndex = 0;
  let spokenIndex = 0;
  let matchedCharCount = 0;

  while (sourceIndex < sourceWords.length && spokenIndex < spokenWords.length) {
    const sourceWord = sourceWords[sourceIndex] ?? "";
    const spokenWord = spokenWords[spokenIndex] ?? "";
    const normalizedSourceWord = normalizeWord(sourceWord);
    const normalizedSpokenWord = normalizeWord(spokenWord);

    if (isFuzzyWordMatch(normalizedSourceWord, normalizedSpokenWord)) {
      matchedCharCount += countUnicodeCodePoints(sourceWord);
      sourceIndex += 1;
      spokenIndex += 1;
      if (sourceIndex < sourceWords.length) {
        matchedCharCount += 1;
      }
      continue;
    }

    const spokenResync = findFuzzyWordOffset(
      spokenWords,
      spokenIndex,
      normalizedSourceWord,
    );
    if (spokenResync !== null) {
      spokenIndex = spokenResync;
      continue;
    }

    const sourceResync = findFuzzyWordOffset(
      sourceWords,
      sourceIndex,
      normalizedSpokenWord,
    );
    if (sourceResync !== null) {
      for (let index = sourceIndex; index < sourceResync; index += 1) {
        matchedCharCount +=
          countUnicodeCodePoints(sourceWords[index] ?? "") + 1;
      }
      sourceIndex = sourceResync;
      continue;
    }

    spokenIndex += 1;
  }

  return matchedCharCount;
}

function findFuzzyWordOffset(
  words: readonly string[],
  currentIndex: number,
  expectedWord: string,
) {
  const maxSkip = Math.min(3, words.length - currentIndex - 1);
  for (let skip = 1; skip <= maxSkip; skip += 1) {
    const candidateIndex = currentIndex + skip;
    if (
      isFuzzyWordMatch(normalizeWord(words[candidateIndex] ?? ""), expectedWord)
    ) {
      return candidateIndex;
    }
  }

  return null;
}

function isFuzzyWordMatch(left: string, right: string) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }

  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const shorterLength = Math.min(leftCharacters.length, rightCharacters.length);
  if (
    shorterLength >= 3 &&
    (left.startsWith(right) || right.startsWith(left))
  ) {
    return true;
  }

  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < shorterLength &&
    leftCharacters[sharedPrefixLength] === rightCharacters[sharedPrefixLength]
  ) {
    sharedPrefixLength += 1;
  }
  if (
    shorterLength >= 3 &&
    sharedPrefixLength >= Math.max(3, Math.floor((shorterLength * 3) / 5))
  ) {
    return true;
  }

  const distance = editDistance(leftCharacters, rightCharacters);
  if (shorterLength <= 2) {
    return false;
  }
  if (shorterLength <= 4) {
    return distance <= 1;
  }
  if (shorterLength <= 8) {
    return distance <= 2;
  }
  return (
    distance <=
    Math.floor(Math.max(leftCharacters.length, rightCharacters.length) / 3)
  );
}

function editDistance(left: readonly string[], right: readonly string[]) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array<number>(right.length + 1);
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length] ?? 0;
}

function normalizeSourceText(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeWord(value: string) {
  return Array.from(value.toLocaleLowerCase("ko-KR"))
    .filter(isLetterOrNumber)
    .join("");
}

function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

function isLetterOrNumber(value: string) {
  return /[\p{L}\p{N}]/u.test(value);
}
