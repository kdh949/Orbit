import {
  matchPronunciationAliases,
  normalizePronunciationText,
  type PronunciationLexiconEntry,
  type PronunciationLexiconSnapshot,
} from "@orbit/shared";

import { defaultSpeechTrackingConfig } from "./speechTrackingConfig";
import { normalizeSpeechText } from "./phraseExtractor";

export type PhraseMatchMethod = "substring" | "dice" | "none";

export type PhraseMatchResult = {
  matched: boolean;
  method: PhraseMatchMethod;
  score: number;
};

export type KeywordAliasInput = {
  keywordId: string;
  aliases: readonly string[];
};

export type KeywordAliasMatch = {
  keywordId: string;
  matchedAlias: string;
};

export function createFinalSegmentWindow(options: {
  previousFinalTranscript: string;
  latestFinalSegment: string;
  tailCharacters?: number;
}) {
  const tailCharacters =
    options.tailCharacters ?? defaultSpeechTrackingConfig.matchingTailCharacters;
  const previousTail = Array.from(options.previousFinalTranscript)
    .slice(-tailCharacters)
    .join("")
    .trim();
  return [previousTail, options.latestFinalSegment.trim()]
    .filter(Boolean)
    .join(" ");
}

export function matchPhraseCandidate(options: {
  candidateText: string;
  finalSegmentWindow: string;
  diceThreshold?: number;
}): PhraseMatchResult {
  const candidate = normalizeSpeechText(options.candidateText);
  const transcript = normalizeSpeechText(options.finalSegmentWindow);
  if (!candidate || !transcript) {
    return { matched: false, method: "none", score: 0 };
  }

  if (transcript.includes(candidate)) {
    return { matched: true, method: "substring", score: 1 };
  }

  const score = bestDiceScore(candidate, transcript);
  const threshold = options.diceThreshold ?? defaultSpeechTrackingConfig.diceThreshold;
  if (score >= threshold) {
    return { matched: true, method: "dice", score };
  }

  return { matched: false, method: "none", score: 0 };
}

export function matchKeywordAliases(options: {
  transcript: string;
  keywords: readonly KeywordAliasInput[];
  pronunciationLexicon?: PronunciationLexiconSnapshot;
  pronunciationEntries?: readonly PronunciationLexiconEntry[];
  slideId?: string;
}): KeywordAliasMatch[] {
  const normalizedTranscript = normalizeSpeechText(options.transcript);
  const matches: KeywordAliasMatch[] = [];
  const pronunciationEntries =
    options.pronunciationEntries ?? options.pronunciationLexicon?.entries ?? [];
  const pronunciationEvidence =
    pronunciationEntries.length === 0
      ? []
      : matchPronunciationAliases(
          options.transcript,
          options.pronunciationLexicon ?? {
            schemaVersion: 1,
            generatorVersion: "runtime-subset",
            deckId: "runtime",
            deckVersion: 1,
            sourceHash: "0000000000000000",
            entries: [...pronunciationEntries],
          },
          options.slideId ? { slideIds: [options.slideId] } : {},
        ).evidence;

  for (const keyword of options.keywords) {
    const matchedAlias = keyword.aliases.find((alias) => {
      const trimmedAlias = alias.trim();
      const normalizedAlias = normalizeSpeechText(trimmedAlias);
      if (!normalizedAlias) {
        return false;
      }

      if (requiresEnglishWordBoundary(trimmedAlias)) {
        return hasEnglishWordBoundaryMatch(options.transcript, trimmedAlias);
      }

      return normalizedTranscript.includes(normalizedAlias);
    });

    if (matchedAlias) {
      matches.push({ keywordId: keyword.keywordId, matchedAlias });
      continue;
    }

    const canonicalKeys = new Set(
      keyword.aliases
        .map((alias) => normalizePronunciationText(alias).compactText)
        .filter(Boolean),
    );
    const matchedEvidence = pronunciationEvidence.find((evidence) =>
      canonicalKeys.has(evidence.canonicalKey),
    );
    if (matchedEvidence) {
      matches.push({
        keywordId: keyword.keywordId,
        matchedAlias: matchedEvidence.matchedText,
      });
    }
  }

  return matches;
}

export function calculateWordMultisetRecall(options: {
  scriptText: string;
  transcriptText: string;
}) {
  const scriptWords = tokenizeSpeechRecallWords(options.scriptText);
  if (scriptWords.length === 0) {
    return 0;
  }

  const transcriptCounts = countWords(
    tokenizeSpeechRecallWords(options.transcriptText)
  );
  let matched = 0;

  for (const [word, scriptCount] of countWords(scriptWords).entries()) {
    matched += Math.min(scriptCount, transcriptCounts.get(word) ?? 0);
  }

  return matched / scriptWords.length;
}

function bestDiceScore(candidate: string, transcript: string) {
  const candidateLength = Array.from(candidate).length;
  const transcriptChars = Array.from(transcript);
  if (transcriptChars.length <= candidateLength + 2) {
    return diceCoefficient(candidate, transcript);
  }

  let best = 0;
  const minLength = Math.max(2, candidateLength - 2);
  const maxLength = candidateLength + 2;

  for (let start = 0; start < transcriptChars.length; start += 1) {
    for (let length = minLength; length <= maxLength; length += 1) {
      const window = transcriptChars.slice(start, start + length).join("");
      if (window.length < minLength) {
        continue;
      }
      best = Math.max(best, diceCoefficient(candidate, window));
    }
  }

  return best;
}

function diceCoefficient(left: string, right: string) {
  const leftBigrams = toBigramCounts(left);
  const rightBigrams = toBigramCounts(right);
  const leftTotal = sumCounts(leftBigrams);
  const rightTotal = sumCounts(rightBigrams);
  if (leftTotal === 0 || rightTotal === 0) {
    return left === right ? 1 : 0;
  }

  let overlap = 0;
  for (const [bigram, leftCount] of leftBigrams.entries()) {
    overlap += Math.min(leftCount, rightBigrams.get(bigram) ?? 0);
  }

  return (2 * overlap) / (leftTotal + rightTotal);
}

function toBigramCounts(value: string) {
  const chars = Array.from(value);
  const counts = new Map<string, number>();
  if (chars.length < 2) {
    counts.set(value, 1);
    return counts;
  }

  for (let index = 0; index < chars.length - 1; index += 1) {
    const bigram = `${chars[index]}${chars[index + 1]}`;
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }

  return counts;
}

function sumCounts(counts: Map<string, number>) {
  return Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
}

function requiresEnglishWordBoundary(alias: string) {
  return /^[A-Za-z]{1,2}$/.test(alias.trim());
}

function hasEnglishWordBoundaryMatch(transcript: string, alias: string) {
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escapedAlias}($|[^A-Za-z0-9])`, "i").test(
    transcript
  );
}

export function tokenizeSpeechRecallWords(value: string) {
  return value
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .split(/\s+/)
    .map((word) => normalizeSpeechText(word))
    .filter(Boolean);
}

function countWords(words: string[]) {
  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}
