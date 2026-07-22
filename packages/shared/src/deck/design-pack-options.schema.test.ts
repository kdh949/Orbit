import { describe, expect, it } from "vitest";

import {
  designPackOptionsRequestSchema,
  designPackOptionsResponseSchema,
  systemDesignPackSelectionSchema
} from "./design-pack-options.schema";

describe("design pack option contracts", () => {
  it("accepts a strict request and at most three versioned options", () => {
    expect(
      designPackOptionsRequestSchema.parse({
        topic: "분기 경영 보고",
        purpose: "report",
        profile: "executive-report",
        tone: "concise",
        slideCount: 9,
        mediaPolicy: "minimal"
      })
    ).toMatchObject({ slideCount: 9, mediaPolicy: "minimal" });

    expect(
      designPackOptionsResponseSchema.parse({
        catalogVersion: 1,
        options: [
          {
            id: "executive-review",
            version: 1,
            name: "Executive Review",
            family: "executive-review",
            rationale: "경영 보고 구조에 적합합니다.",
            preview: {
              manifestId: "preview-executive-review-v1",
              coverPreviewId: "preview-executive-cover-01-v1",
              bodyPreviewId: "preview-executive-summary-01-v1"
            }
          }
        ],
        fallbackUsed: false
      }).options
    ).toHaveLength(1);
  });

  it("rejects unknown option fields and more than three candidates", () => {
    const option = {
      id: "neutral-light",
      version: 1,
      name: "Neutral",
      family: "neutral",
      rationale: "안전한 기본값입니다.",
      preview: {
        manifestId: "preview-neutral-light-v1",
        coverPreviewId: "preview-neutral-cover-01-v1",
        bodyPreviewId: "preview-neutral-content-01-v1"
      }
    };
    expect(
      designPackOptionsResponseSchema.safeParse({
        catalogVersion: 1,
        options: [{ ...option, unknown: true }],
        fallbackUsed: false
      }).success
    ).toBe(false);
    expect(
      designPackOptionsResponseSchema.safeParse({
        catalogVersion: 1,
        options: [option, option, option, option],
        fallbackUsed: false
      }).success
    ).toBe(false);
  });

  it("accepts only immutable catalog id and version pairs", () => {
    expect(
      systemDesignPackSelectionSchema.parse({
        id: "editorial-insight",
        version: 1
      })
    ).toEqual({ id: "editorial-insight", version: 1 });
    expect(
      systemDesignPackSelectionSchema.safeParse({
        id: "editorial-insight",
        version: 2
      }).success
    ).toBe(false);
    expect(
      systemDesignPackSelectionSchema.safeParse({ id: "unknown", version: 1 })
        .success
    ).toBe(false);
  });
});
