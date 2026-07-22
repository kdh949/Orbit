import type { OoxmlReferenceTemplatePreviewResponse } from "@orbit/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nextReferenceRevealCount,
  OoxmlReferenceGenerationContent,
  referenceErrorPresentation,
  referencePreviewAssetUrl,
} from "./OoxmlReferenceGenerationPage";
import { requestOoxmlReferenceTemplatePreview } from "./ooxml-reference-template-api";

const preview: OoxmlReferenceTemplatePreviewResponse = {
  jobId: "job_1",
  projectId: "project_1",
  status: "rendering",
  progress: 50,
  editable: false,
  outline: [
    { order: 1, title: "표지" },
    { order: 2, title: "현황" },
    { order: 3, title: "계획" },
  ],
  completedSlides: [
    { slideId: "slide_1", order: 1, renderAssetFileId: "file_1" },
    { slideId: "slide_2", order: 2, renderAssetFileId: "file_2" },
  ],
  pendingSlideOrders: [3],
  deckId: null,
  updatedAt: "2026-07-22T00:00:00.000Z",
  error: null,
};

describe("OoxmlReferenceGenerationPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the dedicated authenticated preview contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => preview,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestOoxmlReferenceTemplatePreview("project /1", "job /1"),
    ).resolves.toEqual(preview);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/projects/project%20%2F1/ooxml-reference-template-generations/job%20%2F1/preview",
      { credentials: "include" },
    );
  });

  it("reveals the completed prefix in order and keeps pending slides hidden", () => {
    const html = renderToStaticMarkup(
      createElement(OoxmlReferenceGenerationContent, {
        preview,
        revealedCount: 2,
        requestError: "",
        onRefresh: vi.fn(),
        onReturn: vi.fn(),
      }),
    );

    const firstAsset = referencePreviewAssetUrl("project_1", "file_1");
    const secondAsset = referencePreviewAssetUrl("project_1", "file_2");
    expect(html.indexOf(firstAsset)).toBeLessThan(html.indexOf(secondAsset));
    expect(html).toContain(firstAsset);
    expect(html).toContain(secondAsset);
    expect(html).toContain("계획");
    expect(html).toContain("생성 대기");
    expect(html).not.toContain("편집하기");
  });

  it("reveals all available slides immediately for reduced motion", () => {
    expect(nextReferenceRevealCount(0, 3, true)).toBe(3);
    expect(nextReferenceRevealCount(0, 3, false)).toBe(1);
    expect(nextReferenceRevealCount(3, 3, false)).toBe(3);
  });

  it.each([
    ["OOXML_REFERENCE_CAPACITY_TEXT_EXCEEDED", "콘텐츠 분량"],
    ["OOXML_REFERENCE_SOURCE_NO_ELIGIBLE_CANDIDATE", "원본 슬라이드"],
    ["OOXML_REFERENCE_FONT_UNAVAILABLE", "글꼴"],
    ["OOXML_REFERENCE_CAPACITY_IMAGE_ASPECT_RATIO", "이미지 비율"],
    ["OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED", "PPTX 패키지"],
    ["OOXML_REFERENCE_SYNC_STALE", "동기화"],
    ["OOXML_REFERENCE_EXPORT_FAILED", "내보내기"],
  ])("maps %s to a bounded user message", (code, expected) => {
    expect(referenceErrorPresentation(code).title).toContain(expected);
  });

  it("offers same-job refresh only for retryable failures", () => {
    const retryable = renderToStaticMarkup(
      createElement(OoxmlReferenceGenerationContent, {
        preview: {
          ...preview,
          status: "failed",
          error: {
            code: "OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED",
            retryable: true,
          },
        },
        revealedCount: 2,
        requestError: "",
        onRefresh: vi.fn(),
        onReturn: vi.fn(),
      }),
    );
    const nonRetryable = renderToStaticMarkup(
      createElement(OoxmlReferenceGenerationContent, {
        preview: {
          ...preview,
          status: "failed",
          error: {
            code: "OOXML_REFERENCE_SOURCE_NO_ELIGIBLE_CANDIDATE",
            retryable: false,
          },
        },
        revealedCount: 2,
        requestError: "",
        onRefresh: vi.fn(),
        onReturn: vi.fn(),
      }),
    );

    expect(retryable).toContain("같은 작업 다시 확인");
    expect(nonRetryable).not.toContain("같은 작업 다시 확인");
    expect(nonRetryable).toContain("입력 화면으로 돌아가기");
    expect(retryable).not.toContain("AI 추천");
    expect(nonRetryable).not.toContain("AI 추천");
  });
});
