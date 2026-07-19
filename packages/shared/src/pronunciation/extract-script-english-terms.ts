import type { PronunciationTermCategory } from "./pronunciation.schema";
import {
  normalizeDictionaryKey,
  staticPronunciationDictionary,
} from "./static-pronunciation-dictionary";

export type ScriptSourceSlide = {
  slideId: string;
  speakerNotes: string;
};

export type ExtractedEnglishTerm = {
  sourceText: string;
  normalizedSource: string;
  category: PronunciationTermCategory;
  occurrence: {
    slideId: string;
    start: number;
    end: number;
  };
};

const englishExpressionPattern =
  /[A-Za-z][A-Za-z0-9]*(?:(?:[./-][A-Za-z0-9]+)|[+#]+)*/g;

export function extractScriptEnglishTerms(
  slides: readonly ScriptSourceSlide[],
): ExtractedEnglishTerm[] {
  const terms: ExtractedEnglishTerm[] = [];

  for (const slide of slides) {
    for (const match of slide.speakerNotes.matchAll(englishExpressionPattern)) {
      const sourceText = match[0];
      const start = match.index;
      if (!sourceText || start === undefined) {
        continue;
      }

      terms.push({
        sourceText,
        normalizedSource: normalizeSourceText(sourceText),
        category: classifyEnglishTerm(sourceText),
        occurrence: {
          slideId: slide.slideId,
          start,
          end: start + sourceText.length,
        },
      });
    }
  }

  return terms;
}

export function classifyEnglishTerm(
  sourceText: string,
): PronunciationTermCategory {
  const dictionaryEntry = staticPronunciationDictionary.get(
    normalizeDictionaryKey(sourceText),
  );
  if (dictionaryEntry) {
    return dictionaryEntry.category;
  }

  if (/\//.test(sourceText)) {
    return "mixed";
  }
  if (/[0-9.+#-]/.test(sourceText)) {
    return "numeric-symbol";
  }
  if (/^[A-Z]{2,6}$/.test(sourceText)) {
    return "acronym";
  }
  return "word";
}

export function normalizeSourceText(sourceText: string): string {
  return sourceText.normalize("NFKC").toLocaleLowerCase("en-US").trim();
}
