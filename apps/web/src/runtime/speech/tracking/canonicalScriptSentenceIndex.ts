import { splitFocusedPracticeSentences } from "@orbit/shared/coaching";

export type CanonicalScriptSentence = {
  sentenceId: string;
  text: string;
  index: number;
  startOffset: number;
  endOffset: number;
  isFinalTrigger: boolean;
};

export type CanonicalScriptSentenceIndex = {
  sourceText: string;
  sentences: CanonicalScriptSentence[];
};

export function createCanonicalScriptSentenceIndex(
  speakerNotes: string
): CanonicalScriptSentenceIndex {
  const sentenceTexts = splitFocusedPracticeSentences(speakerNotes);
  const sourceText = sentenceTexts.join(" ");
  let nextOffset = 0;

  const sentences = sentenceTexts.map((text, index) => {
    const startOffset = nextOffset;
    const endOffset = startOffset + countUnicodeCodePoints(text);
    nextOffset = endOffset + 1;

    return {
      sentenceId: `sentence_${index + 1}`,
      text,
      index,
      startOffset,
      endOffset,
      isFinalTrigger: index === sentenceTexts.length - 1
    };
  });

  return {
    sourceText,
    sentences
  };
}

function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function splitCanonicalScriptSentences(speakerNotes: string): string[] {
  return createCanonicalScriptSentenceIndex(speakerNotes).sentences.map(
    (sentence) => sentence.text
  );
}
