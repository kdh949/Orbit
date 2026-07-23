import { describe, expect, it, vi } from "vitest";

import { runOoxmlReferencePythonStage } from "./ooxml-reference-template-generation.python-client";

const input = {
  pythonWorkerUrl: "http://python-worker:8000",
  jobId: "job-1",
  projectId: "project-1",
  stage: "content-planning" as const,
  templateId: "operating-review-v1",
  templateVersion: 1,
  request: {
    topic: "운영 리뷰",
    targetDurationMinutes: 10,
    slideCountRange: { min: 5, max: 8 },
    metadata: {
      audience: "general" as const,
      purpose: "inform" as const,
      tone: "professional" as const,
    },
    referencePolicy: "topic-only" as const,
    referenceFileIds: [],
    templateSelection: {
      mode: "user" as const,
      templateId: "operating-review-v1",
      version: 1,
    },
  },
  dependencies: [],
};

describe("runOoxmlReferencePythonStage", () => {
  it("validates a bounded stage response with matching identity", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          stage: input.stage,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          sourceSlideCount: 4,
          slotCount: 9,
          artifact: { outline: [{ order: 1, title: "운영 리뷰" }] },
          issueCodes: [],
        }),
        { status: 200 },
      ),
    );

    const result = await runOoxmlReferencePythonStage({ ...input, fetchImpl });

    expect(result.sourceSlideCount).toBe(4);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://python-worker:8000/internal/ai/ooxml-reference-template-generation/stage",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    { stage: "template-planning", expected: "identity" },
    { artifact: { storageKey: "private/source.pptx" }, expected: "invalid" },
    { issueCodes: ["provider-secret"], expected: "invalid" },
  ])("rejects an invalid or mismatched response", async (override) => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          stage: input.stage,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          sourceSlideCount: 4,
          slotCount: 9,
          artifact: {},
          issueCodes: [],
          ...override,
        }),
        { status: 200 },
      ),
    );

    await expect(
      runOoxmlReferencePythonStage({ ...input, fetchImpl }),
    ).rejects.toMatchObject({
      code: "OOXML_REFERENCE_PYTHON_INVALID_RESPONSE",
      retryable: false,
    });
  });

  it("maps timeout and transport errors to a retryable bounded error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timed out", "AbortError");
    });

    await expect(
      runOoxmlReferencePythonStage({ ...input, fetchImpl }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "OOXML_REFERENCE_PYTHON_UNAVAILABLE",
        retryable: true,
      }),
    );
  });

  it.each([
    [400, false],
    [429, true],
    [503, true],
  ])("maps HTTP %i without exposing its response body", async (status, retryable) => {
    const fetchImpl = vi.fn(async () =>
      new Response("provider secret detail", { status }),
    );

    await expect(
      runOoxmlReferencePythonStage({ ...input, fetchImpl }),
    ).rejects.toMatchObject({
      code: "OOXML_REFERENCE_PYTHON_FAILED",
      retryable,
    });
  });

  it("preserves a bounded Python issue code without exposing provider detail", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          detail: {
            code: "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
            retryable: false,
          },
        }),
        { status: 409 },
      ),
    );

    await expect(
      runOoxmlReferencePythonStage({ ...input, fetchImpl }),
    ).rejects.toMatchObject({
      code: "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
      retryable: false,
    });
  });
});
