import type { SemanticCue } from "@orbit/shared";

import type { E5EmbeddingService } from "../../../runtime/speech/semantic/e5EmbeddingService";

export type SemanticCueEmbeddingIndexSnapshot = {
  slideId: string;
  signature: string;
  cueCount: number;
  vectorCount: number;
};

export type SemanticCueEmbeddingIndex = {
  prepareSlide: (input: {
    slideId: string;
    cues: readonly SemanticCue[];
  }) => Promise<SemanticCueEmbeddingIndexSnapshot>;
  retrieveScores: (input: {
    slideId: string;
    transcript: string;
  }) => Promise<ReadonlyMap<string, number>>;
};

type IndexedCueVectors = {
  cueId: string;
  vectors: Float32Array[];
};

type IndexedSlide = SemanticCueEmbeddingIndexSnapshot & {
  cues: IndexedCueVectors[];
};

export function createSemanticCueEmbeddingIndex(options: {
  embeddingService: E5EmbeddingService;
}): SemanticCueEmbeddingIndex {
  const entries = new Map<
    string,
    { signature: string; promise: Promise<IndexedSlide> }
  >();

  return {
    prepareSlide(input) {
      const cues = matchableCues(input.slideId, input.cues);
      const signature = cueIndexSignature(cues);
      const cached = entries.get(input.slideId);
      if (cached?.signature === signature) {
        return cached.promise;
      }

      const promise = buildIndexedSlide({
        slideId: input.slideId,
        signature,
        cues,
        embeddingService: options.embeddingService
      });
      entries.set(input.slideId, { signature, promise });
      return promise;
    },

    async retrieveScores(input) {
      const entry = entries.get(input.slideId);
      if (!entry) {
        return new Map();
      }
      const indexedSlide = await entry.promise;
      const transcript = normalizeEmbeddingText(input.transcript);
      if (!transcript) {
        return new Map(indexedSlide.cues.map((cue) => [cue.cueId, 0]));
      }
      const queryVector = await options.embeddingService.embedQuery(transcript);
      return new Map(
        indexedSlide.cues.map((cue) => [
          cue.cueId,
          cue.vectors.reduce(
            (best, vector) => Math.max(best, cosineSimilarity(queryVector, vector)),
            0
          )
        ])
      );
    }
  };
}

async function buildIndexedSlide(options: {
  slideId: string;
  signature: string;
  cues: readonly SemanticCue[];
  embeddingService: E5EmbeddingService;
}): Promise<IndexedSlide> {
  const textsByCue = options.cues.map((cue) => ({
    cueId: cue.cueId,
    texts: uniqueEmbeddingTexts([
      cue.meaning,
      ...cue.nliHypotheses,
      ...cue.requiredConcepts
    ])
  }));
  const texts = textsByCue.flatMap((cue) => cue.texts);
  const vectors = await options.embeddingService.embedPassages(texts);
  if (vectors.length !== texts.length) {
    throw new Error("Unexpected Semantic Cue embedding output");
  }

  let vectorIndex = 0;
  const cues = textsByCue.map((cue) => {
    const cueVectors = vectors.slice(vectorIndex, vectorIndex + cue.texts.length);
    vectorIndex += cue.texts.length;
    return { cueId: cue.cueId, vectors: cueVectors };
  });
  return {
    slideId: options.slideId,
    signature: options.signature,
    cueCount: cues.length,
    vectorCount: vectors.length,
    cues
  };
}

function matchableCues(slideId: string, cues: readonly SemanticCue[]) {
  return cues
    .filter(
      (cue) =>
        cue.slideId === slideId &&
        cue.reviewStatus === "approved" &&
        cue.freshness === "current"
    )
    .sort((left, right) => left.cueId.localeCompare(right.cueId));
}

function cueIndexSignature(cues: readonly SemanticCue[]) {
  return JSON.stringify(
    cues.map((cue) => ({
      cueId: cue.cueId,
      revision: cue.revision,
      meaning: normalizeEmbeddingText(cue.meaning),
      hypotheses: uniqueEmbeddingTexts(cue.nliHypotheses),
      concepts: uniqueEmbeddingTexts(cue.requiredConcepts)
    }))
  );
}

function uniqueEmbeddingTexts(texts: readonly string[]) {
  return Array.from(
    new Set(texts.map(normalizeEmbeddingText).filter((text) => text.length > 0))
  );
}

function normalizeEmbeddingText(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function cosineSimilarity(left: Float32Array, right: Float32Array) {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  if (denominator === 0) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, dotProduct / denominator)) * 1000) / 1000;
}
