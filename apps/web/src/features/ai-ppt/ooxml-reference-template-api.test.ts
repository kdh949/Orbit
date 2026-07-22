import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOoxmlReferenceTemplateGenerationRequest,
  requestOoxmlReferenceTemplateOptions,
} from "./ooxml-reference-template-api";

describe("OOXML reference template API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds a separate exact-version request without generic design selectors", () => {
    const request = buildOoxmlReferenceTemplateGenerationRequest({
      topic: " 운영 리뷰 ",
      content: " 핵심 지표와 실행 과제 ",
      audience: "경영진",
      tone: "professional",
      allowWebResearch: false,
      referenceFileIds: ["file-1"],
      targetDurationMinutes: 10,
      slideCountRange: { min: 5, max: 8 },
      template: { templateId: "operating-review", version: 1 },
    });

    expect(request).toMatchObject({
      topic: "운영 리뷰",
      prompt: "핵심 지표와 실행 과제",
      referencePolicy: "references-only",
      templateSelection: {
        mode: "user",
        templateId: "operating-review",
        version: 1,
      },
    });
    expect(request).not.toHaveProperty("generationMode");
    expect(request).not.toHaveProperty("templateBlueprintId");
    expect(request).not.toHaveProperty("designReferences");
    expect(request).not.toHaveProperty("design");
  });

  it("rejects catalog responses that expose private fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            options: [
              {
                templateId: "operating-review",
                version: 1,
                name: "Operating Review",
                description: "운영 리뷰",
                preview: {
                  coverAssetId: "cover",
                  bodyAssetId: "body",
                  storageKey: "private/source.pptx",
                },
                editableRanges: [
                  {
                    contentType: "text",
                    mutationPolicy: "text-content",
                    slotCount: 4,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(requestOoxmlReferenceTemplateOptions()).rejects.toThrow();
  });
});
