import { describe, expect, it, vi } from "vitest";

import type { E5EmbeddingService } from "./e5EmbeddingService";
import {
  createSemanticUtteranceMatcher,
  DEFAULT_SEMANTIC_SPEECH_CONFIG,
  dotProduct
} from "./semanticUtteranceMatcher";

describe("dotProduct", () => {
  it("두 정규화 벡터의 공통 길이 기준 dot product를 계산한다", () => {
    expect(
      dotProduct(new Float32Array([0.8, 0.6]), new Float32Array([1, 0]))
    ).toBeCloseTo(0.8);
  });
});

describe("createSemanticUtteranceMatcher", () => {
  it("현재 슬라이드 speakerNotes 문장을 인덱싱하고 top 3 similarity를 순위화한다", async () => {
    const embeddingService = createFakeEmbeddingService({
      Intro: [1, 0],
      Middle: [0.8, 0.6],
      Outro: [0, 1],
      "latest final transcript": [1, 0]
    });
    const matcher = createSemanticUtteranceMatcher({ embeddingService });

    const index = await matcher.prepareSlide({
      slideId: "slide_1",
      speakerNotes: "Intro. Middle. Outro."
    });
    const result = await matcher.matchFinalTranscript({
      slideId: "slide_1",
      transcript: "latest final transcript",
      coveredSentenceIds: new Set(["sentence_2"])
    });

    expect(index).toMatchObject({
      slideId: "slide_1",
      modelId: "Xenova/multilingual-e5-small",
      dimensions: 384
    });
    expect(result.accepted).toBe(true);
    expect(result.topMatches.map((match) => match.text)).toEqual([
      "Intro",
      "Middle",
      "Outro"
    ]);
    expect(result.topMatches.map((match) => match.covered)).toEqual([
      false,
      true,
      false
    ]);
    expect(result.topMatches.map((match) => match.similarity)).toEqual([1, 0.8, 0]);
  });

  it("speakerNotesHash가 같으면 slide index embedding을 재사용한다", async () => {
    const embeddingService = createFakeEmbeddingService({
      One: [1, 0],
      Two: [0, 1],
      query: [1, 0]
    });
    const matcher = createSemanticUtteranceMatcher({ embeddingService });

    await matcher.prepareSlide({ slideId: "slide_1", speakerNotes: "One. Two." });
    await matcher.prepareSlide({ slideId: "slide_1", speakerNotes: "One. Two." });

    expect(embeddingService.embedPassages).toHaveBeenCalledTimes(1);
  });

  it("threshold 미만이거나 ambiguous margin 안이면 accepted false로 둔다", async () => {
    const belowThreshold = createSemanticUtteranceMatcher({
      embeddingService: createFakeEmbeddingService({
        One: [0.7, 0],
        Two: [0, 1],
        query: [1, 0]
      })
    });
    await belowThreshold.prepareSlide({ slideId: "slide_1", speakerNotes: "One. Two." });

    await expect(
      belowThreshold.matchFinalTranscript({
        slideId: "slide_1",
        transcript: "query",
        coveredSentenceIds: new Set()
      })
    ).resolves.toMatchObject({ accepted: false });

    const ambiguous = createSemanticUtteranceMatcher({
      embeddingService: createFakeEmbeddingService({
        One: [0.9, 0],
        Two: [0.88, 0],
        query: [1, 0]
      })
    });
    await ambiguous.prepareSlide({ slideId: "slide_1", speakerNotes: "One. Two." });

    await expect(
      ambiguous.matchFinalTranscript({
        slideId: "slide_1",
        transcript: "query",
        coveredSentenceIds: new Set()
      })
    ).resolves.toMatchObject({ accepted: false });
  });

  it("빈 문장, 너무 짧은 final transcript, covered top match는 coverage 대상에서 제외한다", async () => {
    const embeddingService = createFakeEmbeddingService({
      One: [1, 0],
      Two: [0, 1],
      okay: [1, 0]
    });
    const matcher = createSemanticUtteranceMatcher({ embeddingService });
    await matcher.prepareSlide({ slideId: "slide_1", speakerNotes: "One. Two." });

    await expect(
      matcher.matchFinalTranscript({
        slideId: "slide_1",
        transcript: "",
        coveredSentenceIds: new Set()
      })
    ).resolves.toEqual({ accepted: false, topMatches: [], decision: null });
    await expect(
      matcher.matchFinalTranscript({
        slideId: "slide_1",
        transcript: "abc",
        coveredSentenceIds: new Set()
      })
    ).resolves.toEqual({ accepted: false, topMatches: [], decision: null });
    await expect(
      matcher.matchFinalTranscript({
        slideId: "slide_1",
        transcript: "okay",
        coveredSentenceIds: new Set(["sentence_1"])
      })
    ).resolves.toMatchObject({ accepted: false });
  });

  it("semantic 기본 설정을 spec 결정값으로 고정한다", () => {
    expect(DEFAULT_SEMANTIC_SPEECH_CONFIG).toEqual({
      enabled: false,
      modelId: "Xenova/multilingual-e5-small",
      threshold: 0.89,
      exactLexicalThreshold: 0.55,
      ambiguousMargin: 0.04,
      topK: 3,
      maxTokens: 512
    });
  });
});

function createFakeEmbeddingService(
  vectorsByText: Record<string, readonly number[]>
): E5EmbeddingService {
  return {
    embedQuery: vi.fn(async (text: string) => toVector(vectorsByText[text] ?? [0, 0])),
    embedPassages: vi.fn(async (texts: readonly string[]) =>
      texts.map((text) => toVector(vectorsByText[text] ?? [0, 0]))
    )
  };
}

function toVector(values: readonly number[]) {
  return new Float32Array(values);
}
