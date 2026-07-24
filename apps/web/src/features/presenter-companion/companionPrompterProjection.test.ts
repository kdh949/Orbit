import {
  presentationCompanionMaxPrompterRowLength,
  presentationCompanionMaxPrompterRows,
} from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  createCompanionPrompterProjection,
  getCompanionPrompterTrackingStatus,
} from "./companionPrompterProjection";

describe("createCompanionPrompterProjection", () => {
  it("projects the current slide rows and clamps progress", () => {
    expect(
      createCompanionPrompterProjection({
        progressPercent: 63.7,
        rows: [
          {
            isFocusTarget: false,
            sentenceId: "sentence_1",
            status: "covered",
            text: "  지나간 문장  ",
          },
          {
            isFocusTarget: true,
            sentenceId: "sentence_2",
            status: "current",
            text: "현재 문장",
          },
        ],
        slideId: "slide_1",
        slideIndex: 0,
        trackingStatus: "listening",
      }),
    ).toEqual({
      availability: "ready",
      focusSentenceId: "sentence_2",
      progressPercent: 64,
      rows: [
        {
          sentenceId: "sentence_1",
          status: "covered",
          text: "지나간 문장",
        },
        {
          sentenceId: "sentence_2",
          status: "current",
          text: "현재 문장",
        },
      ],
      slideId: "slide_1",
      slideIndex: 0,
      trackingStatus: "listening",
    });
  });

  it("does not expose rows when the current slide script is empty", () => {
    expect(
      createCompanionPrompterProjection({
        progressPercent: Number.NaN,
        rows: [],
        slideId: "slide_1",
        slideIndex: 0,
        trackingStatus: "waiting",
      }),
    ).toMatchObject({
      availability: "empty",
      focusSentenceId: null,
      progressPercent: 0,
      rows: [],
    });
  });

  it("replaces oversized script payloads with a bounded state", () => {
    const tooManyRows = Array.from(
      { length: presentationCompanionMaxPrompterRows + 1 },
      (_, index) => ({
        isFocusTarget: index === 0,
        sentenceId: `sentence_${index}`,
        status: "pending" as const,
        text: "문장",
      }),
    );
    expect(
      createCompanionPrompterProjection({
        progressPercent: 0,
        rows: tooManyRows,
        slideId: "slide_1",
        slideIndex: 0,
        trackingStatus: "waiting",
      }).availability,
    ).toBe("too-large");
    expect(
      createCompanionPrompterProjection({
        progressPercent: 0,
        rows: [
          {
            isFocusTarget: true,
            sentenceId: "sentence_1",
            status: "current",
            text: "가".repeat(
              presentationCompanionMaxPrompterRowLength + 1,
            ),
          },
        ],
        slideId: "slide_1",
        slideIndex: 0,
        trackingStatus: "waiting",
      }).rows,
    ).toEqual([]);
  });
});

describe("getCompanionPrompterTrackingStatus", () => {
  it("maps desktop speech states without exposing transcript details", () => {
    expect(getCompanionPrompterTrackingStatus("starting")).toBe(
      "listening",
    );
    expect(getCompanionPrompterTrackingStatus("paused")).toBe("paused");
    expect(getCompanionPrompterTrackingStatus("error")).toBe("error");
    expect(getCompanionPrompterTrackingStatus("idle")).toBe("waiting");
  });
});
