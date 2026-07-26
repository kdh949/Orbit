import { normalizeLiveTranscriptText } from "../stt/liveTranscriptText";
import {
  E5_EMBEDDING_DIMENSIONS,
  E5_MODEL_ID,
  type E5EmbeddingService
} from "./e5EmbeddingService";
import {
  splitSpeakerNotesIntoSemanticSentences,
  type SemanticScriptSentence as SplitSemanticScriptSentence
} from "./semanticSentenceSplitter";
import {
  decideSemanticUtteranceOutcome,
  SEMANTIC_OUTCOME_POLICY,
  type SemanticOutcomePolicy,
  type SemanticUtteranceDecision
} from "./semanticUtteranceDecision";
import type { SemanticUtteranceMatch } from "./semanticUtterance.types";

export type { SemanticUtteranceMatch } from "./semanticUtterance.types";

export type SemanticSpeechConfig = {
  enabled: boolean;
  modelId: typeof E5_MODEL_ID;
  threshold: number;
  exactLexicalThreshold: number;
  ambiguousMargin: number;
  topK: number;
  maxTokens: number;
};

export type SemanticScriptSentence = SplitSemanticScriptSentence & {
  slideId: string;
};

export type SemanticScriptSentenceEmbedding = SemanticScriptSentence & {
  embedding: Float32Array;
};

export type SemanticScriptIndex = {
  slideId: string;
  speakerNotesHash: string;
  modelId: typeof E5_MODEL_ID;
  dimensions: 384;
  sentences: SemanticScriptSentenceEmbedding[];
  builtAtMs: number;
};

export type SemanticUtteranceMatcher = {
  prepareSlide: (input: {
    slideId: string;
    speakerNotes: string;
  }) => Promise<SemanticScriptIndex>;
  matchFinalTranscript: (input: {
    slideId: string;
    transcript: string;
    coveredSentenceIds: ReadonlySet<string>;
  }) => Promise<{
    accepted: boolean;
    topMatches: SemanticUtteranceMatch[];
    decision: SemanticUtteranceDecision | null;
  }>;
};

export const DEFAULT_SEMANTIC_SPEECH_CONFIG: SemanticSpeechConfig = Object.freeze({
  enabled: false,
  modelId: E5_MODEL_ID,
  threshold: SEMANTIC_OUTCOME_POLICY.adLibRejectThreshold,
  exactLexicalThreshold: SEMANTIC_OUTCOME_POLICY.exactLexicalThreshold,
  ambiguousMargin: SEMANTIC_OUTCOME_POLICY.ambiguousMargin,
  topK: 3,
  maxTokens: 512
});

export function createSemanticUtteranceMatcher(input: {
  embeddingService: E5EmbeddingService;
  config?: Partial<SemanticSpeechConfig>;
  now?: () => number;
}): SemanticUtteranceMatcher {
  const config = { ...DEFAULT_SEMANTIC_SPEECH_CONFIG, ...input.config };
  const now = input.now ?? (() => Date.now());
  const indexCache = new Map<string, SemanticScriptIndex>();

  async function prepareSlide(options: {
    slideId: string;
    speakerNotes: string;
  }): Promise<SemanticScriptIndex> {
    const speakerNotesHash = hashSpeakerNotes(options.speakerNotes);
    const cached = indexCache.get(options.slideId);
    if (cached?.speakerNotesHash === speakerNotesHash) {
      return cached;
    }

    const sentences = splitSpeakerNotesIntoSemanticSentences(options.speakerNotes).map(
      (sentence) => ({
        ...sentence,
        slideId: options.slideId
      })
    );
    const embeddings = await input.embeddingService.embedPassages(
      sentences.map((sentence) => sentence.text)
    );
    const index: SemanticScriptIndex = {
      slideId: options.slideId,
      speakerNotesHash,
      modelId: config.modelId,
      dimensions: E5_EMBEDDING_DIMENSIONS,
      sentences: sentences.map((sentence, sentenceIndex) => ({
        ...sentence,
        embedding: embeddings[sentenceIndex] ?? new Float32Array()
      })),
      builtAtMs: now()
    };

    indexCache.set(options.slideId, index);
    return index;
  }

  async function matchFinalTranscript(inputOptions: {
    slideId: string;
    transcript: string;
    coveredSentenceIds: ReadonlySet<string>;
  }) {
    const normalizedTranscript = normalizeLiveTranscriptText(inputOptions.transcript);
    if (!inputOptions.transcript.trim() || normalizedTranscript.length < 4) {
      return { accepted: false, topMatches: [], decision: null };
    }

    const index = indexCache.get(inputOptions.slideId);
    if (!index || index.sentences.length === 0) {
      return { accepted: false, topMatches: [], decision: null };
    }

    const queryEmbedding = await input.embeddingService.embedQuery(inputOptions.transcript);
    const topMatches = rankTopSemanticMatches({
      index,
      queryEmbedding,
      coveredSentenceIds: inputOptions.coveredSentenceIds,
      topK: config.topK
    });
    const decision = decideSemanticUtteranceOutcome({
      slideId: inputOptions.slideId,
      transcript: inputOptions.transcript,
      topMatches,
      policy: semanticOutcomePolicy(config)
    });

    return { accepted: decision.accepted, topMatches, decision };
  }

  return {
    prepareSlide,
    matchFinalTranscript
  };
}

export function rankTopSemanticMatches(options: {
  index: SemanticScriptIndex;
  queryEmbedding: Float32Array;
  coveredSentenceIds: ReadonlySet<string>;
  topK?: number;
}): SemanticUtteranceMatch[] {
  return options.index.sentences
    .map((sentence) => ({
      sentence,
      similarity: roundSimilarity(dotProduct(options.queryEmbedding, sentence.embedding))
    }))
    .sort((left, right) => {
      if (right.similarity !== left.similarity) {
        return right.similarity - left.similarity;
      }
      return left.sentence.index - right.sentence.index;
    })
    .slice(0, options.topK ?? DEFAULT_SEMANTIC_SPEECH_CONFIG.topK)
    .map(({ sentence, similarity }, index) => ({
      rank: index + 1,
      sentenceId: sentence.sentenceId,
      sentenceIndex: sentence.index,
      text: sentence.text,
      similarity,
      covered: options.coveredSentenceIds.has(sentence.sentenceId)
    }));
}

export function dotProduct(left: Float32Array, right: Float32Array) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function hashSpeakerNotes(speakerNotes: string) {
  const normalized = speakerNotes.normalize("NFC").replace(/\r\n?/g, "\n");
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function roundSimilarity(value: number) {
  return Math.round(value * 1000000) / 1000000;
}

function semanticOutcomePolicy(config: SemanticSpeechConfig): SemanticOutcomePolicy {
  return {
    adLibRejectThreshold: config.threshold,
    ambiguousMargin: config.ambiguousMargin,
    exactLexicalThreshold: config.exactLexicalThreshold
  };
}
