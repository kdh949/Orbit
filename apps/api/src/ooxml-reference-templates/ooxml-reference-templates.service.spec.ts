import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OoxmlReferenceTemplatesService } from "./ooxml-reference-templates.service";

describe("OoxmlReferenceTemplatesService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns only the strict public catalog projection", async () => {
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
                description: "운영 지표와 실행 과제 보고",
                preview: { coverAssetId: "cover", bodyAssetId: "body" },
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

    await expect(service().listOptions()).resolves
      .toMatchObject({
        options: [
          {
            templateId: "operating-review",
            preview: { coverAssetId: "cover", bodyAssetId: "body" },
          },
        ],
      });
  });

  it("fails closed when the global rollout is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      service({ enabled: false, allowlist: new Set() }).listOptions(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters options by exact template ID and version", async () => {
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
                description: "운영 지표와 실행 과제 보고",
                preview: { coverAssetId: "cover", bodyAssetId: "body" },
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
        ),
      ),
    );

    await expect(
      service({
        enabled: true,
        allowlist: new Set(["operating-review@2"]),
      }).listOptions(),
    ).resolves.toEqual({ options: [] });
  });

  it("fails closed when the catalog leaks a storage locator", async () => {
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
                description: "운영 지표와 실행 과제 보고",
                preview: {
                  coverAssetId: "cover",
                  bodyAssetId: "body",
                  storageKey: "private/source.pptx",
                },
                editableRanges: [],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      service().listOptions(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("proxies only a bounded PNG preview", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const fetchMock = vi.fn(async (_input: string | URL) =>
      new Response(png, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await service().readPreview(
      "operating-review",
      "1",
      "cover",
    );

    expect(result).toEqual({ body: png, contentType: "image/png" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/internal/ai/ooxml-reference-templates/operating-review/versions/1/previews/cover",
    );
  });

  it.each([
    ["text/plain", new Uint8Array([1, 2, 3])],
    ["image/png", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
  ])("rejects invalid preview bytes", async (contentType, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(body, { status: 200, headers: { "content-type": contentType } }),
      ),
    );

    await expect(
      service().readPreview(
        "operating-review",
        "1",
        "cover",
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

function service(
  rollout = {
    enabled: true,
    allowlist: new Set(["operating-review@1"]),
  },
): OoxmlReferenceTemplatesService {
  return new OoxmlReferenceTemplatesService(
    "http://python-worker:8000",
    rollout,
  );
}
