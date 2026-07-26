import type { SemanticCue } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";

import { semanticCueEmbeddingRecallFixture } from "./__fixtures__/semanticCueEmbeddingFixture";
import type { E5EmbeddingService } from "../e5EmbeddingService";
import { createSemanticCueEmbeddingIndex } from "./semanticCueEmbeddingIndex";

describe("createSemanticCueEmbeddingIndex", () => {
  it("Korean fixture에서 approved cue top-1 recall 90% 이상을 유지한다", async () => {
    const service = fixtureEmbeddingService();
    const index = createSemanticCueEmbeddingIndex({ embeddingService: service });
    const cues = semanticCueEmbeddingRecallFixture.cues.map((cue) =>
      semanticCue({
        cueId: cue.cueId,
        meaning: cue.meaning,
        requiredConcepts: [...cue.concepts],
        nliHypotheses: [...cue.hypotheses]
      })
    );
    await index.prepareSlide({ slideId: "slide_1", cues });

    let hits = 0;
    for (const query of semanticCueEmbeddingRecallFixture.queries) {
      const scores = await index.retrieveScores({
        slideId: "slide_1",
        transcript: query.transcript
      });
      const topCueId = [...scores.entries()].sort(
        (left, right) => right[1] - left[1]
      )[0]?.[0];
      if (topCueId === query.expectedCueId) {
        hits += 1;
      }
    }

    expect(hits / semanticCueEmbeddingRecallFixture.queries.length).toBeGreaterThanOrEqual(
      0.9
    );
  });

  it("approved/current cue만 index하고 같은 revision은 cache하며 변경 시 invalidate한다", async () => {
    const embedPassages = vi.fn(async (texts: readonly string[]) =>
      texts.map(() => new Float32Array([1, 0, 0, 0]))
    );
    const index = createSemanticCueEmbeddingIndex({
      embeddingService: {
        embedQuery: vi.fn(async () => new Float32Array([1, 0, 0, 0])),
        embedPassages
      }
    });
    const approved = semanticCue({ cueId: "scue_approved" });
    const cues = [
      approved,
      semanticCue({ cueId: "scue_suggested", reviewStatus: "suggested" }),
      semanticCue({ cueId: "scue_stale", freshness: "stale" }),
      semanticCue({ cueId: "scue_excluded", reviewStatus: "excluded" })
    ];

    await index.prepareSlide({ slideId: "slide_1", cues });
    await index.prepareSlide({ slideId: "slide_1", cues });
    expect(embedPassages).toHaveBeenCalledTimes(1);
    expect(embedPassages.mock.calls[0]?.[0]).toEqual([
      approved.meaning,
      ...approved.nliHypotheses,
      ...approved.requiredConcepts
    ]);

    await index.prepareSlide({
      slideId: "slide_1",
      cues: [
        {
          ...approved,
          meaning: "RSP가 변경된 파일 정책을 설명합니다",
          revision: approved.revision + 1
        }
      ]
    });
    expect(embedPassages).toHaveBeenCalledTimes(2);
  });

  it("unrelated query에는 모든 cue retrieval score를 0으로 유지한다", async () => {
    const index = createSemanticCueEmbeddingIndex({
      embeddingService: fixtureEmbeddingService()
    });
    await index.prepareSlide({
      slideId: "slide_1",
      cues: semanticCueEmbeddingRecallFixture.cues.map((cue) =>
        semanticCue({
          cueId: cue.cueId,
          meaning: cue.meaning,
          requiredConcepts: [...cue.concepts],
          nliHypotheses: [...cue.hypotheses]
        })
      )
    });

    const scores = await index.retrieveScores({
      slideId: "slide_1",
      transcript: semanticCueEmbeddingRecallFixture.unrelatedQuery.transcript
    });

    expect([...scores.values()]).toEqual([0, 0, 0]);
  });
});

function fixtureEmbeddingService(): E5EmbeddingService {
  const fixture = semanticCueEmbeddingRecallFixture;
  const vectorsByText = new Map<string, readonly number[]>();
  for (const cue of fixture.cues) {
    for (const text of [cue.meaning, ...cue.hypotheses, ...cue.concepts]) {
      vectorsByText.set(text, cue.vector);
    }
  }
  for (const query of fixture.queries) {
    vectorsByText.set(query.transcript, query.vector);
  }
  vectorsByText.set(fixture.unrelatedQuery.transcript, fixture.unrelatedQuery.vector);

  return {
    embedQuery: async (text) => new Float32Array(vectorsByText.get(text) ?? []),
    embedPassages: async (texts) =>
      texts.map((text) => new Float32Array(vectorsByText.get(text) ?? []))
  };
}

function semanticCue(overrides: Partial<SemanticCue> = {}): SemanticCue {
  return {
    cueId: "scue_1",
    slideId: "slide_1",
    meaning: "RSP가 런타임에서 파일 쓰기를 차단합니다",
    importance: "core",
    reviewStatus: "approved",
    freshness: "current",
    origin: "manual",
    revision: 1,
    sourceRefs: [],
    qualityWarnings: [],
    required: true,
    priority: 1,
    candidateKeywords: [],
    aliases: {},
    requiredConcepts: ["RSP", "파일 쓰기 차단"],
    nliHypotheses: ["발표자는 RSP의 파일 쓰기 차단 정책을 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides
  };
}
