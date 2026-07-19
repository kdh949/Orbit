import type { PronunciationLexiconEntry, SemanticCue } from "@orbit/shared";

import { defaultSpeechTrackingConfig } from "./speechTrackingConfig";
import { normalizeSpeechText } from "./phraseExtractor";

export type SpeechBiasSource =
  | "control-phrase"
  | "final-trigger"
  | "cue-trigger"
  | "keyword"
  | "synonym"
  | "abbreviation"
  | "semantic-cue-term"
  | "semantic-cue-alias"
  | "pronunciation-source"
  | "pronunciation-alias"
  | "representative-phrase"
  | "legacy";

export type SpeechBiasTerm = {
  text: string;
  source: SpeechBiasSource;
  weight: number;
  keywordId?: string;
  canonicalText?: string;
};

export type SpeechBiasKeyword = {
  keywordId: string;
  text: string;
  synonyms: readonly string[];
  abbreviations: readonly string[];
};

export type BuildSpeechTrackingBiasPhrasesInput = {
  budget?: number;
  controlPhrases?: readonly string[];
  finalTriggerPhrases?: readonly string[];
  cuePhrases?: readonly string[];
  keywords?: readonly SpeechBiasKeyword[];
  representativePhrases?: readonly string[];
  legacyPhrases?: readonly string[];
  semanticCues?: readonly SemanticCue[];
  adjacentSemanticCues?: readonly SemanticCue[];
  pronunciationEntries?: readonly PronunciationLexiconEntry[];
  adjacentPronunciationEntries?: readonly PronunciationLexiconEntry[];
  semanticCueTermBudget?: number;
};

export const DEFAULT_SEMANTIC_CUE_BIAS_TERM_BUDGET = 12;

export function buildSpeechTrackingBiasPhrases(
  input: BuildSpeechTrackingBiasPhrasesInput
): SpeechBiasTerm[] {
  const budget = Math.max(
    0,
    input.budget ?? defaultSpeechTrackingConfig.biasPhraseBudget
  );
  const terms: SpeechBiasTerm[] = [];
  const seen = new Set<string>();

  const addTerm = (term: SpeechBiasTerm) => {
    if (terms.length >= budget) {
      return false;
    }

    const text = normalizeDisplayText(term.text);
    const key = normalizeSpeechText(text);
    if (!text || !key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    terms.push({ ...term, text });
    return true;
  };

  // P3-D13 우선순위: 명령/종결/큐/키워드는 레거시 slide context보다 먼저 예산을 확보한다.
  for (const phrase of input.controlPhrases ?? []) {
    addTerm({ text: phrase, source: "control-phrase", weight: 1 });
  }

  for (const phrase of input.finalTriggerPhrases ?? []) {
    addTerm({ text: phrase, source: "final-trigger", weight: 0.98 });
  }

  for (const phrase of input.cuePhrases ?? []) {
    addTerm({ text: phrase, source: "cue-trigger", weight: 0.96 });
  }

  for (const keyword of input.keywords ?? []) {
    addTerm({
      text: keyword.text,
      source: "keyword",
      weight: 0.94,
      keywordId: keyword.keywordId,
      canonicalText: keyword.text
    });
    for (const synonym of keyword.synonyms) {
      addTerm({
        text: synonym,
        source: "synonym",
        weight: 0.92,
        keywordId: keyword.keywordId,
        canonicalText: keyword.text
      });
    }
    for (const abbreviation of keyword.abbreviations) {
      addTerm({
        text: abbreviation,
        source: "abbreviation",
        weight: 0.9,
        keywordId: keyword.keywordId,
        canonicalText: keyword.text
      });
    }
  }

  addPronunciationEntries(input.pronunciationEntries ?? [], {
    sourceWeight: 0.93,
    aliasWeight: 0.9,
  });
  addPronunciationEntries(input.adjacentPronunciationEntries ?? [], {
    sourceWeight: 0.78,
    aliasWeight: 0.74,
  });

  const semanticCueTermBudget = Math.max(
    0,
    input.semanticCueTermBudget ?? DEFAULT_SEMANTIC_CUE_BIAS_TERM_BUDGET
  );
  let semanticCueTermCount = 0;
  const addSemanticCueTerms = (
    cues: readonly SemanticCue[],
    weights: { canonical: number; alias: number }
  ) => {
    for (const cue of cues) {
      if (
        cue.reviewStatus !== "approved" ||
        cue.freshness !== "current" ||
        cue.importance !== "core"
      ) {
        continue;
      }
      for (const group of technicalCueTermGroups(cue)) {
        if (semanticCueTermCount >= semanticCueTermBudget) {
          return;
        }
        if (
          addTerm({
            text: group.canonical,
            source: "semantic-cue-term",
            weight: weights.canonical,
            canonicalText: group.canonical
          })
        ) {
          semanticCueTermCount += 1;
        }
        for (const alias of group.aliases) {
          if (semanticCueTermCount >= semanticCueTermBudget) {
            return;
          }
          if (
            addTerm({
              text: alias,
              source: "semantic-cue-alias",
              weight: weights.alias,
              canonicalText: group.canonical
            })
          ) {
            semanticCueTermCount += 1;
          }
        }
      }
    }
  };

  addSemanticCueTerms(input.semanticCues ?? [], {
    canonical: 0.93,
    alias: 0.91
  });
  addSemanticCueTerms(input.adjacentSemanticCues ?? [], {
    canonical: 0.85,
    alias: 0.82
  });

  for (const phrase of input.representativePhrases ?? []) {
    addTerm({ text: phrase, source: "representative-phrase", weight: 0.75 });
  }

  for (const phrase of input.legacyPhrases ?? []) {
    addTerm({ text: phrase, source: "legacy", weight: 0.45 });
  }

  return terms;

  function addPronunciationEntries(
    entries: readonly PronunciationLexiconEntry[],
    weights: { sourceWeight: number; aliasWeight: number },
  ) {
    for (const entry of entries) {
      if (entry.status !== "active") {
        continue;
      }
      addTerm({
        text: entry.sourceText,
        source: "pronunciation-source",
        weight: weights.sourceWeight,
        canonicalText: entry.canonicalText,
      });
      for (const alias of entry.aliases) {
        if (!alias.enabled || alias.confidence < 0.8) {
          continue;
        }
        addTerm({
          text: alias.text,
          source: "pronunciation-alias",
          weight: weights.aliasWeight * alias.confidence,
          canonicalText: entry.canonicalText,
        });
      }
    }
  }
}

function technicalCueTermGroups(cue: SemanticCue) {
  const groups: Array<{ canonical: string; aliases: string[] }> = [];
  const seenCanonical = new Set<string>();
  const addGroup = (canonical: string, aliases: readonly string[]) => {
    const normalizedCanonical = normalizeDisplayText(canonical);
    const key = normalizeSpeechText(normalizedCanonical);
    if (
      !isTechnicalCanonicalTerm(normalizedCanonical) ||
      !key ||
      seenCanonical.has(key)
    ) {
      return;
    }
    seenCanonical.add(key);
    const uniqueAliases = Array.from(
      new Map(
        aliases
          .map(normalizeDisplayText)
          .filter(Boolean)
          .map((alias) => [normalizeSpeechText(alias), alias] as const)
      ).values()
    ).filter((alias) => normalizeSpeechText(alias) !== key);
    groups.push({ canonical: normalizedCanonical, aliases: uniqueAliases });
  };

  for (const [canonical, aliases] of Object.entries(cue.aliases)) {
    addGroup(canonical, aliases);
  }
  for (const keyword of cue.candidateKeywords) {
    addGroup(keyword, cue.aliases[keyword] ?? []);
  }
  return groups;
}

function isTechnicalCanonicalTerm(value: string) {
  return value.length >= 2 && value.length <= 64 && /[A-Za-z0-9_-]/.test(value);
}

function normalizeDisplayText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
