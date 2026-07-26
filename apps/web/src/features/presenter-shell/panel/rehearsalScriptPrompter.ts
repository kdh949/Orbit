import type { ExtractedSentence } from "../../../runtime/speech/tracking/speechTrackingEvents";
import type { PrompterProgressSnapshot } from "../../../runtime/speech/tracking/prompterProgressTracker";

export type RehearsalScriptPrompterRowStatus =
  | "covered"
  | "current"
  | "next"
  | "paraphrased"
  | "pending"
  | "unmatchable";

export type RehearsalScriptPrompterRow = {
  sentence: ExtractedSentence;
  status: RehearsalScriptPrompterRowStatus;
  coverageStatus: "covered" | "paraphrased" | null;
  isCommitted: boolean;
  isFocusTarget: boolean;
};

export function createRehearsalScriptPrompterRows(input: {
  sentences: readonly ExtractedSentence[];
  coveredSentenceIds: ReadonlySet<string> | readonly string[];
  coveredSentenceMatchKinds?: Readonly<Record<string, "covered" | "paraphrased">>;
  prompterProgress?: PrompterProgressSnapshot;
}): RehearsalScriptPrompterRow[] {
  const coveredSentenceIds =
    input.coveredSentenceIds instanceof Set
      ? input.coveredSentenceIds
      : new Set(input.coveredSentenceIds);
  const committedSentenceIds = new Set(
    input.prompterProgress?.committedSentenceIds ?? coveredSentenceIds
  );
  const matchableSentences = input.sentences.filter((sentence) => sentence.matchable);
  const trackingSentence = findCurrentMatchableSentence(
    matchableSentences,
    input.prompterProgress
  );
  const finalFocusSentence =
    !trackingSentence && input.prompterProgress?.finalSentenceCommitted
      ? (matchableSentences.at(-1) ?? null)
      : null;
  const leadingDisplaySentence = findLeadingUnmatchableDisplaySentence(
    input.sentences,
    trackingSentence,
    input.prompterProgress
  );
  const focusSentence =
    leadingDisplaySentence ?? trackingSentence ?? finalFocusSentence;
  const nextSentence = leadingDisplaySentence
    ? trackingSentence
    : trackingSentence
      ? findNextMatchableSentence(
        matchableSentences,
        trackingSentence.sentenceId
      )
      : null;

  return input.sentences.map((sentence) => {
    const covered = coveredSentenceIds.has(sentence.sentenceId);
    const isCommitted = committedSentenceIds.has(sentence.sentenceId);
    const matchKind = input.coveredSentenceMatchKinds?.[sentence.sentenceId];
    const coverageStatus = covered
      ? matchKind === "paraphrased"
        ? "paraphrased"
        : "covered"
      : null;

    if (sentence.sentenceId === focusSentence?.sentenceId) {
      return {
        sentence,
        status: "current",
        coverageStatus,
        isCommitted,
        isFocusTarget: true
      };
    }

    if (sentence.sentenceId === nextSentence?.sentenceId) {
      return {
        sentence,
        status: "next",
        coverageStatus,
        isCommitted,
        isFocusTarget: false
      };
    }

    if (!sentence.matchable) {
      return {
        sentence,
        status: "unmatchable",
        coverageStatus,
        isCommitted,
        isFocusTarget: false
      };
    }

    if (isCommitted) {
      return {
        sentence,
        status: coverageStatus === "paraphrased" ? "paraphrased" : "covered",
        coverageStatus,
        isCommitted,
        isFocusTarget: false
      };
    }

    return {
      sentence,
      status: "pending",
      coverageStatus,
      isCommitted,
      isFocusTarget: false
    };
  });
}

function findLeadingUnmatchableDisplaySentence(
  sentences: readonly ExtractedSentence[],
  trackingSentence: ExtractedSentence | null,
  prompterProgress?: PrompterProgressSnapshot
) {
  if (!trackingSentence) {
    return null;
  }

  const hasReachedTrackingSentence =
    prompterProgress?.hasCurrentLexicalEvidence === true ||
    prompterProgress?.candidateSentenceId === trackingSentence.sentenceId ||
    (prompterProgress?.committedSentenceIds.length ?? 0) > 0;
  if (hasReachedTrackingSentence) {
    return null;
  }

  const leadingSentences = sentences.filter(
    (sentence) => sentence.index < trackingSentence.index
  );
  if (
    leadingSentences.length === 0 ||
    leadingSentences.some((sentence) => sentence.matchable)
  ) {
    return null;
  }

  return leadingSentences[0] ?? null;
}

export function getRehearsalScriptFocusSentenceId(
  sentences: readonly ExtractedSentence[],
  prompterProgress?: PrompterProgressSnapshot
) {
  return (
    createRehearsalScriptPrompterRows({
      sentences,
      coveredSentenceIds: [],
      prompterProgress
    }).find((row) => row.isFocusTarget)?.sentence.sentenceId ?? null
  );
}

function findCurrentMatchableSentence(
  sentences: readonly ExtractedSentence[],
  prompterProgress?: PrompterProgressSnapshot
) {
  if (!prompterProgress) {
    return sentences[0] ?? null;
  }

  if (prompterProgress.currentSentenceId) {
    return (
      sentences.find(
        (sentence) =>
          sentence.sentenceId === prompterProgress.currentSentenceId
      ) ??
      sentences[0] ??
      null
    );
  }

  return prompterProgress.finalSentenceCommitted
    ? null
    : (sentences[0] ?? null);
}

function findNextMatchableSentence(
  sentences: readonly ExtractedSentence[],
  currentSentenceId: string
) {
  const currentIndex = sentences.findIndex(
    (sentence) => sentence.sentenceId === currentSentenceId
  );

  if (currentIndex === -1) {
    return null;
  }

  return sentences[currentIndex + 1] ?? null;
}
