import {
  matchPronunciationAliases,
  type PronunciationLexiconEntry,
} from "@orbit/shared";

export function toCanonicalPronunciationMatchingText(
  originalText: string,
  pronunciationEntries: readonly PronunciationLexiconEntry[] = [],
  slideId?: string,
): string {
  if (!originalText || pronunciationEntries.length === 0) {
    return originalText;
  }

  const entriesById = new Map(
    pronunciationEntries.map((entry) => [entry.id, entry]),
  );
  const result = matchPronunciationAliases(
    originalText,
    {
      schemaVersion: 1,
      generatorVersion: "web-matching-adapter",
      deckId: "runtime",
      deckVersion: 1,
      sourceHash: "0000000000000000",
      entries: [...pronunciationEntries],
    },
    slideId ? { slideIds: [slideId] } : {},
  );

  let matchingText = originalText;
  for (const evidence of [...result.evidence].sort(
    (left, right) => right.originalStart - left.originalStart,
  )) {
    const entry = entriesById.get(evidence.entryId);
    if (!entry) {
      continue;
    }
    matchingText =
      matchingText.slice(0, evidence.originalStart) +
      entry.canonicalText +
      matchingText.slice(evidence.originalEnd);
  }
  return matchingText;
}
