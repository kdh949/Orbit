import { deckSchema } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import { imageSlideArtifactPayloadSchema } from "./execution-stage-contract";
import {
  contentPlanningArtifactPayloadSchema,
  layoutCompileArtifactPayloadSchema,
} from "./planning-stage-contract";

describe("versioned AI deck stage artifacts", () => {
  it("keeps legacy content and layout artifacts readable", () => {
    const deck = testDeck();
    expect(
      contentPlanningArtifactPayloadSchema.safeParse({
        rawInput: {},
        contentPlan: {},
      }).success,
    ).toBe(true);
    expect(
      layoutCompileArtifactPayloadSchema.safeParse({
        layoutResult: {},
        visualRequirements: {},
        workerPayload: {
          deck,
          warnings: [],
          validation: {
            passed: true,
            layoutIssues: [],
            contentIssues: [],
            designIssues: [],
            presentationIssues: [],
          },
        },
      }).success,
    ).toBe(true);
  });

  it("validates v2 manifest and completed slide identity", () => {
    const deck = testDeck();
    const slide = { ...deck.slides[0]!, order: 1, slideId: "slide_1" };
    const deckShell = (({ slides: ignoredSlides, ...shell }) => {
      void ignoredSlides;
      return shell;
    })(deck);
    expect(
      layoutCompileArtifactPayloadSchema.safeParse({
        artifactVersion: 2,
        deckShell,
        slides: [
          {
            sourceOrder: 1,
            order: 1,
            slideId: "slide_1",
            shardKey: "001-slide_1",
          },
        ],
        warnings: [],
      }).success,
    ).toBe(true);
    const completed = {
      artifactVersion: 2,
      sourceOrder: 1,
      order: 1,
      slideId: "slide_1",
      slide,
      warnings: [],
      validation: {
        passed: true,
        layoutIssues: [],
        contentIssues: [],
        designIssues: [],
        presentationIssues: [],
      },
    };
    expect(imageSlideArtifactPayloadSchema.safeParse(completed).success).toBe(
      true,
    );
    expect(
      imageSlideArtifactPayloadSchema.safeParse({
        ...completed,
        slideId: "slide_2",
      }).success,
    ).toBe(false);
  });
});

function testDeck() {
  return deckSchema.parse({
    deckId: "deck_test",
    projectId: "project-test",
    title: "Test deck",
    version: 1,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "First",
        elements: [],
        keywords: [],
      },
    ],
  });
}
