import type { AiDeckPreviewResponse, Deck } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import {
  aiDeckPlaybackDurationMs,
  aiDeckPreviewDisplayState,
  previewBannerText,
  readySlidePrefix,
} from "./ai-deck-preview-api";

describe("readySlidePrefix", () => {
  it("exposes only the contiguous completed prefix", () => {
    const deck = {
      slides: [
        { slideId: "slide-1" },
        { slideId: "slide-2" },
        { slideId: "slide-3" },
      ],
    } as Deck;

    expect(readySlidePrefix(deck, ["slide-2", "slide-3"])).toBe(0);
    expect(readySlidePrefix(deck, ["slide-1", "slide-3"])).toBe(1);
    expect(readySlidePrefix(deck, ["slide-1", "slide-2", "slide-3"])).toBe(3);
  });
});

describe("previewBannerText", () => {
  const preview = {
    jobId: "job-1",
    projectId: "project-1",
    status: "grounding",
    progress: 10,
    expectedSlideCountRange: { min: 5, max: 8 },
    editable: false,
    outline: [],
    deck: null,
    completedSlideIds: ["slide-1"],
    pendingSlideIds: [],
    updatedAt: "2026-07-17T00:00:00.000Z",
    error: null,
  } satisfies AiDeckPreviewResponse;

  it("mentions all slides only during quality review", () => {
    expect(previewBannerText({ ...preview, status: "grounding" })).not.toContain(
      "모든 슬라이드를 만들었습니다",
    );
    expect(
      previewBannerText({ ...preview, status: "quality-check" }),
    ).toContain("모든 슬라이드를 만들었습니다");
  });
});

describe("demo cache preview playback", () => {
  it("keeps a backend-ready deck in rendering state until every slide is revealed", () => {
    const preview = previewFixture({ status: "ready", progress: 100 });
    expect(aiDeckPreviewDisplayState(preview, 0)).toEqual({
      status: "rendering",
      progress: 12,
    });
    expect(aiDeckPreviewDisplayState(preview, 1)).toEqual({
      status: "rendering",
      progress: 54,
    });
    expect(aiDeckPreviewDisplayState(preview, 2)).toEqual({
      status: "ready",
      progress: 100,
    });
  });

  it("uses the planned reveal and final-slide hold duration", () => {
    expect(aiDeckPlaybackDurationMs(8)).toBe(11_000);
    expect(aiDeckPlaybackDurationMs(5)).toBe(7_250);
    expect(aiDeckPlaybackDurationMs(0)).toBe(0);
  });
});

function previewFixture(
  overrides: Partial<AiDeckPreviewResponse> = {},
): AiDeckPreviewResponse {
  return {
    jobId: "job-demo",
    projectId: "project-target",
    status: "ready",
    progress: 100,
    expectedSlideCountRange: { min: 2, max: 2 },
    editable: false,
    outline: [
      { order: 1, title: "Cover", message: "Cover" },
      { order: 2, title: "Body", message: "Body" },
    ],
    deck: {
      slides: [{ slideId: "slide-1" }, { slideId: "slide-2" }],
    } as Deck,
    completedSlideIds: ["slide-1", "slide-2"],
    pendingSlideIds: [],
    updatedAt: "2026-07-20T00:00:00.000Z",
    error: null,
    ...overrides,
  };
}
