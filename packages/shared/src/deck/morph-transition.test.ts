import { describe, expect, it } from "vitest";

import type { Slide } from "./deck.schema";
import {
  deckHasMorphTransition,
  evaluateMorphTransitionSupport
} from "./morph-transition";

function createSlide(
  slideId: string,
  order: number,
  overrides: Partial<Slide> = {}
): Slide {
  return {
    kind: "content",
    slideId,
    order,
    title: "",
    thumbnailUrl: "",
    style: {},
    speakerNotes: "",
    elements: [],
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
    ...overrides
  } as Slide;
}

describe("morph transition support", () => {
  it("supports adjacent authored content slides", () => {
    expect(
      evaluateMorphTransitionSupport({
        sourceType: "manual",
        previousSlide: createSlide("slide_1", 1),
        destinationSlide: createSlide("slide_2", 2)
      })
    ).toEqual({ supported: true });
  });

  it.each([
    {
      sourceType: "import" as const,
      previousSlide: createSlide("slide_1", 1),
      destinationSlide: createSlide("slide_2", 2),
      reason: "imported-deck"
    },
    {
      sourceType: "manual" as const,
      previousSlide: undefined,
      destinationSlide: createSlide("slide_1", 1),
      reason: "first-slide"
    },
    {
      sourceType: "manual" as const,
      previousSlide: createSlide("slide_1", 1, {
        importRenderMode: "snapshot"
      }),
      destinationSlide: createSlide("slide_2", 2),
      reason: "snapshot-slide"
    },
    {
      sourceType: "manual" as const,
      previousSlide: createSlide("slide_1", 1),
      destinationSlide: {
        ...createSlide("slide_2", 2),
        kind: "activity-results",
        activityResult: {
          sourceActivityId: "activity_1",
          display: "live",
          layout: "chart"
        }
      } as Slide,
      reason: "unsupported-slide-kind"
    }
  ])("rejects unsupported morph context: $reason", (input) => {
    expect(evaluateMorphTransitionSupport(input)).toMatchObject({
      supported: false,
      reason: input.reason
    });
  });

  it("detects decks containing a morph transition", () => {
    expect(
      deckHasMorphTransition({
        slides: [
          createSlide("slide_1", 1),
          createSlide("slide_2", 2, {
            transition: {
              type: "morph",
              durationMs: 1000,
              mode: "object"
            }
          })
        ]
      })
    ).toBe(true);
  });
});
