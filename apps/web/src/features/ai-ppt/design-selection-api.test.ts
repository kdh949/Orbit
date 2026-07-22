import { afterEach, describe, expect, it, vi } from "vitest";

import { requestDesignPackOptions } from "./design-selection-api";

describe("design pack option API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts a strict request and validates the response", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
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
              bodyPreviewId: "preview-executive-summary-01-v1",
            },
          },
        ],
        fallbackUsed: false,
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const response = await requestDesignPackOptions("project / 1", {
      topic: "분기 경영 보고",
      purpose: "report",
      profile: "executive-report",
      tone: "concise",
      slideCount: 9,
      mediaPolicy: "minimal",
    });

    expect(response.options[0]?.id).toBe("executive-review");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project%20%2F%201/design-pack-options",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
