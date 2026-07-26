import type { AppendDeckPatchRequest, Deck, Keyword } from "@orbit/shared/deck";
import {
  appendDeckPatchRequestSchema,
  deckSchema,
  keywordSchema,
} from "@orbit/shared/deck";

export type KeywordValidationIssue = {
  field: "keyword" | "synonym" | "abbreviation";
  message: string;
};

type KeywordIdFactory = () => string;

const defaultKeywordIdFactory: KeywordIdFactory = () => `kw_${crypto.randomUUID()}`;

export function createKeyword(
  text: string,
  createKeywordId: KeywordIdFactory = defaultKeywordIdFactory
): Keyword {
  return keywordSchema.parse({
    keywordId: createKeywordId(),
    text: text.trim(),
    synonyms: [],
    abbreviations: [],
    required: true
  });
}

export function addKeyword(
  keywords: Keyword[],
  text: string,
  createKeywordId?: KeywordIdFactory
): Keyword[] {
  return [...keywords, createKeyword(text, createKeywordId)];
}

export function deleteKeyword(keywords: Keyword[], keywordId: string): Keyword[] {
  return keywords.filter((keyword) => keyword.keywordId !== keywordId);
}

export function updateKeywordText(
  keywords: Keyword[],
  keywordId: string,
  text: string
): Keyword[] {
  return keywords.map((keyword) =>
    keyword.keywordId === keywordId ? { ...keyword, text } : keyword
  );
}

export function updateKeywordTerms(
  keywords: Keyword[],
  keywordId: string,
  field: "synonyms" | "abbreviations",
  value: string
): Keyword[] {
  const terms = parseTermInput(value);

  return keywords.map((keyword) =>
    keyword.keywordId === keywordId ? { ...keyword, [field]: terms } : keyword
  );
}

export function formatTermInput(terms: string[]): string {
  return terms.join(", ");
}

export function sanitizeKeywords(keywords: Keyword[]): Keyword[] {
  const normalizedKeywords = keywords.map((keyword) => ({
      ...keyword,
      text: keyword.text.trim(),
      synonyms: keyword.synonyms.map((term) => term.trim()),
      abbreviations: keyword.abbreviations.map((term) => term.trim())
    }));
  const validationIssues = validateSlideKeywords(normalizedKeywords);

  if (validationIssues.length > 0) {
    throw new Error(validationIssues.map((issue) => issue.message).join("\n"));
  }

  return normalizedKeywords.map((keyword) => keywordSchema.parse(keyword));
}

export function validateSlideKeywords(
  keywords: Keyword[]
): KeywordValidationIssue[] {
  const issues: KeywordValidationIssue[] = [];
  const terms = new Set<string>();

  for (const keyword of keywords) {
    const text = keyword.text.trim();

    if (!text) {
      issues.push({ field: "keyword", message: "빈 키워드는 저장할 수 없습니다." });
    } else if (hasSeen(terms, text)) {
      issues.push({ field: "keyword", message: duplicateTermMessage });
    }

    for (const synonym of keyword.synonyms) {
      const value = synonym.trim();

      if (!value) {
        issues.push({ field: "synonym", message: "빈 동의어는 저장할 수 없습니다." });
      } else if (hasSeen(terms, value)) {
        issues.push({ field: "synonym", message: duplicateTermMessage });
      }
    }

    for (const abbreviation of keyword.abbreviations) {
      const value = abbreviation.trim();

      if (!value) {
        issues.push({
          field: "abbreviation",
          message: "빈 약어는 저장할 수 없습니다."
        });
      } else if (hasSeen(terms, value)) {
        issues.push({
          field: "abbreviation",
          message: duplicateTermMessage
        });
      }
    }
  }

  return issues;
}

const duplicateTermMessage =
  "같은 슬라이드에 같은 키워드, 동의어 또는 약어가 이미 있습니다.";

export function buildReplaceKeywordsRequest(
  deck: Deck,
  slideId: string,
  keywords: Keyword[]
): AppendDeckPatchRequest {
  const normalizedKeywords = sanitizeKeywords(keywords);

  return appendDeckPatchRequestSchema.parse({
    patch: {
      deckId: deck.deckId,
      baseVersion: deck.version,
      source: "user",
      operations: [
        {
          type: "replace_keywords",
          slideId,
          keywords: normalizedKeywords
        }
      ]
    },
    snapshotReason: "patch-applied"
  });
}

export function applyKeywordsToDeck(
  deck: Deck,
  slideId: string,
  keywords: Keyword[]
): Deck {
  const normalizedKeywords = sanitizeKeywords(keywords);

  return deckSchema.parse({
    ...deck,
    slides: deck.slides.map((slide) =>
      slide.slideId === slideId
        ? { ...slide, keywords: normalizedKeywords }
        : slide
    )
  });
}

function parseTermInput(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  return value.split(",").map((term) => term.trim());
}

function hasSeen(values: Set<string>, rawValue: string): boolean {
  const value = rawValue.toLocaleLowerCase("ko-KR");

  if (values.has(value)) {
    return true;
  }

  values.add(value);
  return false;
}
