import { calculateWordMultisetRecall, tokenizeSpeechRecallWords } from "./speechMatcher";

export type PrompterLexicalSentence = {
  sentenceId: string;
  text: string;
};

export type PrompterLexicalEvidenceSnapshot = {
  sentenceId: string;
  lexicalRecall: number;
  meaningfulTokenCount: number;
  matchedMeaningfulTokenCount: number;
  terminalAnchorTokenCount: number;
  terminalAnchorMatched: boolean;
  sentenceProgressRatio: number;
  stableResultCount: number;
  updatedAtMs: number | null;
};

export type PrompterLexicalEvidenceAccumulator = {
  acceptResult: (result: {
    sentenceId: string;
    transcriptText: string;
    sentenceProgressRatio: number;
    atMs: number;
  }) => PrompterLexicalEvidenceSnapshot;
  reset: (sentence: PrompterLexicalSentence) => PrompterLexicalEvidenceSnapshot;
  snapshot: () => PrompterLexicalEvidenceSnapshot;
};

export function createPrompterLexicalEvidenceAccumulator(
  initialSentence: PrompterLexicalSentence
): PrompterLexicalEvidenceAccumulator {
  let sentence = initialSentence;
  let scriptWords = tokenizeSpeechRecallWords(sentence.text);
  let scriptWordCounts = countWords(scriptWords);
  let terminalAnchorCounts = getTerminalAnchorCounts(scriptWords);
  let observedWordCounts = new Map<string, number>();
  let sentenceProgressRatio = 0;
  let stableResultCount = 0;
  let previousEvidenceSignature: string | null = null;
  let updatedAtMs: number | null = null;

  function acceptResult(result: {
    sentenceId: string;
    transcriptText: string;
    sentenceProgressRatio: number;
    atMs: number;
  }) {
    if (result.sentenceId !== sentence.sentenceId) {
      return snapshot();
    }

    const resultCounts = countWords(tokenizeSpeechRecallWords(result.transcriptText));
    let hasRelevantResultToken = false;
    let evidenceIncreased = false;
    for (const [word, count] of resultCounts.entries()) {
      const maximumUsefulCount = scriptWordCounts.get(word) ?? 0;
      if (maximumUsefulCount === 0) {
        continue;
      }

      hasRelevantResultToken = true;
      const previousObservedCount = observedWordCounts.get(word) ?? 0;
      const nextObservedCount = Math.min(
        maximumUsefulCount,
        Math.max(previousObservedCount, count)
      );
      if (nextObservedCount > previousObservedCount) {
        evidenceIncreased = true;
      }
      observedWordCounts.set(word, nextObservedCount);
    }

    const nextSentenceProgressRatio = Math.max(
      sentenceProgressRatio,
      clampRatio(result.sentenceProgressRatio)
    );
    const progressAdvanced = nextSentenceProgressRatio > sentenceProgressRatio;
    sentenceProgressRatio = nextSentenceProgressRatio;
    if (evidenceIncreased || progressAdvanced) {
      updatedAtMs = result.atMs;
    }

    const nextSnapshot = snapshot();
    const signature = [
      nextSnapshot.lexicalRecall,
      nextSnapshot.terminalAnchorMatched,
      nextSnapshot.sentenceProgressRatio
    ].join(":");
    if (hasRelevantResultToken || progressAdvanced) {
      stableResultCount =
        nextSnapshot.matchedMeaningfulTokenCount === 0
          ? 0
          : signature === previousEvidenceSignature
            ? stableResultCount + 1
            : 1;
      previousEvidenceSignature = signature;
    }
    return snapshot();
  }

  function reset(nextSentence: PrompterLexicalSentence) {
    sentence = nextSentence;
    scriptWords = tokenizeSpeechRecallWords(sentence.text);
    scriptWordCounts = countWords(scriptWords);
    terminalAnchorCounts = getTerminalAnchorCounts(scriptWords);
    observedWordCounts = new Map();
    sentenceProgressRatio = 0;
    stableResultCount = 0;
    previousEvidenceSignature = null;
    updatedAtMs = null;
    return snapshot();
  }

  function snapshot(): PrompterLexicalEvidenceSnapshot {
    const transcriptText = expandWordCounts(observedWordCounts).join(" ");
    const lexicalRecall = calculateWordMultisetRecall({
      scriptText: sentence.text,
      transcriptText
    });
    const matchedMeaningfulTokenCount = Math.round(lexicalRecall * scriptWords.length);

    return {
      sentenceId: sentence.sentenceId,
      lexicalRecall,
      meaningfulTokenCount: scriptWords.length,
      matchedMeaningfulTokenCount,
      terminalAnchorTokenCount: sumCounts(terminalAnchorCounts),
      terminalAnchorMatched:
        terminalAnchorCounts.size > 0 &&
        Array.from(terminalAnchorCounts.entries()).every(
          ([word, count]) => (observedWordCounts.get(word) ?? 0) >= count
        ),
      sentenceProgressRatio,
      stableResultCount,
      updatedAtMs
    };
  }

  return { acceptResult, reset, snapshot };
}

function getTerminalAnchorCounts(words: readonly string[]) {
  const anchorLength = Math.min(3, words.length);
  return countWords(words.slice(-anchorLength));
}

function countWords(words: readonly string[]) {
  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

function expandWordCounts(counts: ReadonlyMap<string, number>) {
  const words: string[] = [];
  for (const [word, count] of counts.entries()) {
    for (let index = 0; index < count; index += 1) {
      words.push(word);
    }
  }
  return words;
}

function sumCounts(counts: ReadonlyMap<string, number>) {
  return Array.from(counts.values()).reduce((total, count) => total + count, 0);
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}
