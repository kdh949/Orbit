import type { Deck } from "../deck/deck.schema";
import {
  extractScriptEnglishTerms,
  normalizeSourceText,
} from "./extract-script-english-terms";
import { normalizePronunciationText } from "./normalize-pronunciation-text";
import {
  pronunciationLexiconSnapshotSchema,
  type PronunciationAliasCandidate,
  type PronunciationAliasOrigin,
  type PronunciationLexiconEntry,
  type PronunciationLexiconSnapshot,
} from "./pronunciation.schema";
import {
  normalizeDictionaryKey,
  staticPronunciationDictionary,
} from "./static-pronunciation-dictionary";

export const PRONUNCIATION_GENERATOR_VERSION = "deterministic-v1";

const alphabetNames: Readonly<Record<string, string>> = {
  A: "에이",
  B: "비",
  C: "씨",
  D: "디",
  E: "이",
  F: "에프",
  G: "지",
  H: "에이치",
  I: "아이",
  J: "제이",
  K: "케이",
  L: "엘",
  M: "엠",
  N: "엔",
  O: "오",
  P: "피",
  Q: "큐",
  R: "알",
  S: "에스",
  T: "티",
  U: "유",
  V: "브이",
  W: "더블유",
  X: "엑스",
  Y: "와이",
  Z: "지",
};

export function generatePronunciationLexicon(
  deck: Pick<Deck, "deckId" | "version" | "slides">,
): PronunciationLexiconSnapshot {
  const extractedTerms = extractScriptEnglishTerms(deck.slides);
  const grouped = new Map<string, PronunciationLexiconEntry>();

  for (const term of extractedTerms) {
    const groupKey = normalizeDictionaryKey(term.sourceText);
    const current = grouped.get(groupKey);
    if (current) {
      current.scriptOccurrences.push(term.occurrence);
      continue;
    }

    const dictionaryEntry = staticPronunciationDictionary.get(groupKey);
    const aliases: PronunciationAliasCandidate[] = [];
    if (dictionaryEntry) {
      for (const alias of dictionaryEntry.aliases) {
        addAlias(
          aliases,
          alias,
          dictionaryEntry.origin,
          dictionaryEntry.confidence,
        );
      }
    } else if (term.category === "acronym") {
      const acronymAlias = generateAcronymAlias(term.sourceText);
      if (acronymAlias) {
        addAlias(aliases, acronymAlias, "rule", 0.98);
      }
    }

    grouped.set(groupKey, {
      id: `pron_${stableHash64(groupKey).slice(0, 12)}`,
      sourceText: dictionaryEntry?.source ?? term.sourceText,
      normalizedSource: normalizeSourceText(
        dictionaryEntry?.source ?? term.sourceText,
      ),
      canonicalText: dictionaryEntry?.source ?? term.sourceText,
      canonicalKey: groupKey,
      category: dictionaryEntry?.category ?? term.category,
      aliases,
      confidence:
        aliases.length > 0
          ? Math.max(...aliases.map((alias) => alias.confidence))
          : 0,
      status: aliases.length > 0 ? "active" : "needs-review",
      scriptOccurrences: [term.occurrence],
    });
  }

  mergeExistingAliases(deck, grouped);

  return pronunciationLexiconSnapshotSchema.parse({
    schemaVersion: 1,
    generatorVersion: PRONUNCIATION_GENERATOR_VERSION,
    deckId: deck.deckId,
    deckVersion: deck.version,
    sourceHash: stableHash64(
      JSON.stringify({
        deckId: deck.deckId,
        deckVersion: deck.version,
        slides: deck.slides.map((slide) => ({
          slideId: slide.slideId,
          speakerNotes: slide.speakerNotes,
          keywords: slide.keywords,
          semanticAliases: slide.semanticCues.map((cue) => cue.aliases),
        })),
      }),
    ),
    entries: [...grouped.values()],
  });
}

function mergeExistingAliases(
  deck: Pick<Deck, "slides">,
  grouped: Map<string, PronunciationLexiconEntry>,
): void {
  for (const slide of deck.slides) {
    for (const keyword of slide.keywords) {
      const entry = grouped.get(normalizeDictionaryKey(keyword.text));
      if (!entry) {
        continue;
      }
      for (const alias of [...keyword.synonyms, ...keyword.abbreviations]) {
        if (containsHangul(alias)) {
          addAlias(entry.aliases, alias, "existing-keyword", 1);
        }
      }
      refreshEntryStatus(entry);
    }

    for (const cue of slide.semanticCues) {
      for (const [source, aliases] of Object.entries(cue.aliases)) {
        const entry = grouped.get(normalizeDictionaryKey(source));
        if (!entry) {
          continue;
        }
        for (const alias of aliases) {
          if (containsHangul(alias)) {
            addAlias(entry.aliases, alias, "existing-semantic-cue", 0.95);
          }
        }
        refreshEntryStatus(entry);
      }
    }
  }
}

function refreshEntryStatus(entry: PronunciationLexiconEntry): void {
  entry.confidence = entry.aliases.length
    ? Math.max(...entry.aliases.map((alias) => alias.confidence))
    : 0;
  entry.status = entry.aliases.some((alias) => alias.enabled)
    ? "active"
    : "needs-review";
}

function addAlias(
  aliases: PronunciationAliasCandidate[],
  text: string,
  origin: PronunciationAliasOrigin,
  confidence: number,
): void {
  const trimmed = text.trim();
  const normalizedText = normalizePronunciationText(trimmed).compactText;
  if (!trimmed || !normalizedText) {
    return;
  }
  if (aliases.some((alias) => alias.normalizedText === normalizedText)) {
    return;
  }
  aliases.push({
    text: trimmed,
    normalizedText,
    origin,
    confidence,
    enabled: true,
  });
}

function generateAcronymAlias(sourceText: string): string | null {
  if (!/^[A-Z]{2,6}$/.test(sourceText)) {
    return null;
  }
  const names = [...sourceText].map((letter) => alphabetNames[letter]);
  return names.every(Boolean) ? names.join("") : null;
}

function containsHangul(text: string): boolean {
  return /[가-힣]/u.test(text);
}

export function stableHash64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}
