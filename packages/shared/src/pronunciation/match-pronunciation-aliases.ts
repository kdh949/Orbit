import { normalizePronunciationTextWithMap } from "./normalize-pronunciation-text";
import type {
  CanonicalTermEvidence,
  PronunciationAliasOrigin,
  PronunciationLexiconEntry,
  PronunciationLexiconSnapshot,
} from "./pronunciation.schema";

export type PronunciationAliasAmbiguity = {
  matchedText: string;
  originalStart: number;
  originalEnd: number;
  entryIds: string[];
};

export type PronunciationAliasMatchResult = {
  originalText: string;
  evidence: CanonicalTermEvidence[];
  ambiguities: PronunciationAliasAmbiguity[];
};

export type PronunciationAliasMatchOptions = {
  slideIds?: readonly string[];
  segmentIndex?: number;
  startSeconds?: number;
  endSeconds?: number;
};

type MatchableAlias = {
  entry: PronunciationLexiconEntry;
  compactText: string;
  origin: PronunciationAliasOrigin | "source";
  confidence: number;
};

type PendingMatch = MatchableAlias & {
  compactStart: number;
  compactEnd: number;
  originalStart: number;
  originalEnd: number;
};

type AliasTrieNode = {
  children: Map<string, AliasTrieNode>;
  outputs: MatchableAlias[];
};

export function matchPronunciationAliases(
  originalText: string,
  lexicon: PronunciationLexiconSnapshot,
  options: PronunciationAliasMatchOptions = {},
): PronunciationAliasMatchResult {
  if (!originalText || lexicon.entries.length === 0) {
    return { originalText, evidence: [], ambiguities: [] };
  }

  const normalized = normalizePronunciationTextWithMap(originalText);
  const activeEntries = selectActiveEntries(lexicon.entries, options.slideIds);
  const aliases = buildMatchableAliases(activeEntries);
  const ambiguousKeys = findAmbiguousAliasKeys(aliases);
  const pendingMatches = findPendingMatches(
    originalText,
    normalized.compactText,
    normalized.compactMap,
    aliases,
  );
  const ambiguities: PronunciationAliasAmbiguity[] = [];
  const candidates: PendingMatch[] = [];

  for (const match of pendingMatches) {
    const ambiguousEntries = ambiguousKeys.get(match.compactText);
    if (ambiguousEntries) {
      if (
        !ambiguities.some(
          (item) =>
            item.originalStart === match.originalStart &&
            item.originalEnd === match.originalEnd &&
            item.matchedText ===
              originalText.slice(match.originalStart, match.originalEnd),
        )
      ) {
        ambiguities.push({
          matchedText: originalText.slice(
            match.originalStart,
            match.originalEnd,
          ),
          originalStart: match.originalStart,
          originalEnd: match.originalEnd,
          entryIds: [...ambiguousEntries].sort(),
        });
      }
      continue;
    }
    candidates.push(match);
  }

  candidates.sort(
    (left, right) =>
      left.originalStart - right.originalStart ||
      right.compactText.length - left.compactText.length ||
      originRank(right.origin) - originRank(left.origin) ||
      right.confidence - left.confidence,
  );

  const accepted: PendingMatch[] = [];
  for (const candidate of candidates) {
    if (
      accepted.some(
        (match) =>
          candidate.originalStart < match.originalEnd &&
          candidate.originalEnd > match.originalStart,
      )
    ) {
      continue;
    }
    accepted.push(candidate);
  }
  accepted.sort((left, right) => left.originalStart - right.originalStart);

  return {
    originalText,
    evidence: accepted.map((match) => ({
      entryId: match.entry.id,
      canonicalKey: match.entry.canonicalKey,
      matchedText: originalText.slice(match.originalStart, match.originalEnd),
      originalStart: match.originalStart,
      originalEnd: match.originalEnd,
      ...(options.segmentIndex === undefined
        ? {}
        : { segmentIndex: options.segmentIndex }),
      ...(options.startSeconds === undefined
        ? {}
        : { startSeconds: options.startSeconds }),
      ...(options.endSeconds === undefined
        ? {}
        : { endSeconds: options.endSeconds }),
      matchOrigin: match.origin,
      confidence: match.confidence,
    })),
    ambiguities,
  };
}

function selectActiveEntries(
  entries: readonly PronunciationLexiconEntry[],
  slideIds: readonly string[] | undefined,
): PronunciationLexiconEntry[] {
  if (!slideIds) {
    return entries.filter((entry) => entry.status === "active");
  }
  const activeSlideIds = new Set(slideIds);
  return entries.filter(
    (entry) =>
      entry.status === "active" &&
      entry.scriptOccurrences.some((occurrence) =>
        activeSlideIds.has(occurrence.slideId),
      ),
  );
}

function buildMatchableAliases(
  entries: readonly PronunciationLexiconEntry[],
): MatchableAlias[] {
  const aliases: MatchableAlias[] = [];
  for (const entry of entries) {
    aliases.push({
      entry,
      compactText: entry.canonicalKey,
      origin: "source",
      confidence: 1,
    });
    for (const alias of entry.aliases) {
      if (alias.enabled) {
        aliases.push({
          entry,
          compactText: alias.normalizedText,
          origin: alias.origin,
          confidence: alias.confidence,
        });
      }
    }
  }
  return aliases.sort(
    (left, right) => right.compactText.length - left.compactText.length,
  );
}

function findAmbiguousAliasKeys(
  aliases: readonly MatchableAlias[],
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const alias of aliases) {
    const entryIds = owners.get(alias.compactText) ?? new Set<string>();
    entryIds.add(alias.entry.id);
    owners.set(alias.compactText, entryIds);
  }
  return new Map([...owners].filter(([, entryIds]) => entryIds.size > 1));
}

function findPendingMatches(
  originalText: string,
  compactText: string,
  compactMap: ReadonlyArray<{ start: number; end: number }>,
  aliases: readonly MatchableAlias[],
): PendingMatch[] {
  const matches: PendingMatch[] = [];
  const trie = buildAliasTrie(aliases);

  for (let compactStart = 0; compactStart < compactText.length; compactStart += 1) {
    let node = trie;
    for (let cursor = compactStart; cursor < compactText.length; cursor += 1) {
      const next = node.children.get(compactText[cursor]!);
      if (!next) {
        break;
      }
      node = next;
      if (node.outputs.length === 0) {
        continue;
      }

      const compactEnd = cursor + 1;
      const first = compactMap[compactStart];
      const last = compactMap[cursor];
      if (!first || !last) {
        continue;
      }
      for (const alias of node.outputs) {
        if (
          hasSafeBoundary(originalText, first.start, last.end, alias.compactText)
        ) {
          matches.push({
            ...alias,
            compactStart,
            compactEnd,
            originalStart: first.start,
            originalEnd: last.end,
          });
        }
      }
    }
  }
  return matches;
}

function buildAliasTrie(aliases: readonly MatchableAlias[]): AliasTrieNode {
  const root = createAliasTrieNode();
  for (const alias of aliases) {
    if (!alias.compactText) {
      continue;
    }
    let node = root;
    for (const character of alias.compactText) {
      const next = node.children.get(character) ?? createAliasTrieNode();
      node.children.set(character, next);
      node = next;
    }
    node.outputs.push(alias);
  }
  return root;
}

function createAliasTrieNode(): AliasTrieNode {
  return { children: new Map(), outputs: [] };
}

function hasSafeBoundary(
  originalText: string,
  start: number,
  end: number,
  alias: string,
): boolean {
  const before = start > 0 ? originalText.slice(start - 1, start) : "";
  const after =
    end < originalText.length ? originalText.slice(end, end + 1) : "";
  if (/^[a-z0-9]+$/i.test(alias)) {
    return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
  }
  if (!/[가-힣]/u.test(alias)) {
    return true;
  }
  const safeBefore = !before || /[\s\p{P}\p{S}]/u.test(before);
  const safeAfter =
    !after ||
    /[\s\p{P}\p{S}]/u.test(after) ||
    /^[은는이가을를와과도만의에로서부터까지께]/u.test(after);
  return safeBefore && safeAfter;
}

function originRank(origin: PronunciationAliasOrigin | "source"): number {
  switch (origin) {
    case "user":
      return 7;
    case "domain":
      return 6;
    case "static":
      return 5;
    case "existing-keyword":
      return 4;
    case "existing-semantic-cue":
      return 3;
    case "rule":
      return 2;
    case "source":
      return 1;
    case "llm":
      return 0;
  }
}
