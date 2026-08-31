import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeterministicImageProvider,
  OfficialWebImageProvider,
  OpenAiGeneratedImageProvider,
  OpenversePublicImageSearchProvider,
} from "./image-providers";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

describe("image providers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns deterministic schema-valid PNGs without network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DeterministicImageProvider({
      seed: 42,
      delayMs: 0,
      errorRatePercent: 0,
    });

    const first = await provider.generate({ prompt: "load-test visual" });
    const second = await provider.generate({ prompt: "load-test visual" });

    expect(first.provider).toBe("deterministic-load-test");
    expect(first.mimeType).toBe("image/png");
    expect(Array.from(first.body)).toEqual(Array.from(second.body));
    expect(first.body.slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(first.body.slice(16, 24)).toEqual(
      new Uint8Array([0, 0, 5, 0, 0, 0, 2, 208]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decodes OpenAI image output without exposing the API key", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from([1, 2]).toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiGeneratedImageProvider(
      "secret-key",
    ).generate({
      prompt: "presentation visual",
      aspectRatio: "portrait",
    });

    expect(Array.from(result.body)).toEqual([1, 2]);
    expect(result.mimeType).toBe("image/png");
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(requestBody).not.toContain("secret-key");
    expect(JSON.parse(requestBody)).toMatchObject({ size: "1024x1536" });
  });

  it("sends reference images through the OpenAI image edit endpoint", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from([3, 4]).toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiGeneratedImageProvider(
      "secret-key",
    ).generate({
      prompt: "reference based visual",
      referenceImages: [
        {
          body: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
          fileName: "reference.png",
          inputFidelity: "high",
        },
      ],
    });

    expect(Array.from(result.body)).toEqual([3, 4]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.openai.com/v1/images/edits",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(String(fetchMock.mock.calls[0]?.[1]?.headers)).not.toContain(
      "secret-key",
    );
  });

  it("returns Openverse attribution and license metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/image.jpg",
                creator: "Creator",
                license: "cc-by",
                license_url: "https://creativecommons.org/licenses/by/4.0/",
                foreign_landing_url: "https://example.com/source",
                title: "Product",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenversePublicImageSearchProvider().search({
      query: "product",
    });

    expect(result).toMatchObject({
      author: "Creator",
      license: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://example.com/source",
      provider: "openverse",
    });
    const searchUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(searchUrl.searchParams.get("size")).toBe("large,medium");
    expect(searchUrl.searchParams.get("aspect_ratio")).toBe("wide");
  });

  it("skips Openverse candidates below the presentation minimum", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/small.jpg",
                width: 320,
                height: 180,
                license: "cc-by",
                foreign_landing_url: "https://example.com/small",
                title: "Small wide product",
              },
              {
                url: "https://images.example.com/large.jpg",
                width: 1280,
                height: 720,
                creator: "Large Creator",
                license: "cc-by",
                foreign_landing_url: "https://example.com/large",
                title: "Large wide product",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenversePublicImageSearchProvider().search({
      query: "wide product",
    });

    expect(result).toMatchObject({
      author: "Large Creator",
      sourceUrl: "https://example.com/large",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://images.example.com/large.jpg",
    );
  });

  it("falls back to another licensed Openverse candidate when download fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/unavailable.jpg",
                license: "cc-by",
                foreign_landing_url: "https://example.com/unavailable",
                title: "Unavailable product",
              },
              {
                url: "https://images.example.com/available.jpg",
                creator: "Second Creator",
                license: "cc0",
                foreign_landing_url: "https://example.com/available",
                title: "Available product",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenversePublicImageSearchProvider().search({
      query: "product",
    });

    expect(result).toMatchObject({
      author: "Second Creator",
      license: "cc0",
      sourceUrl: "https://example.com/available",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("skips an Openverse asset already used in the same deck", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/used.jpg",
                width: 1280,
                height: 720,
                license: "cc-by",
                foreign_landing_url: "https://example.com/used",
                title: "Library education workshop",
              },
              {
                url: "https://images.example.com/fresh.jpg",
                width: 1280,
                height: 720,
                license: "cc-by",
                foreign_landing_url: "https://example.com/fresh",
                title: "Library education classroom",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenversePublicImageSearchProvider().search({
      query: "library education",
      excludeSourceAssetUrls: ["https://images.example.com/used.jpg"],
    });

    expect(result.sourceAssetUrl).toBe("https://images.example.com/fresh.jpg");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://images.example.com/fresh.jpg",
    );
  });

  it("skips an unrelated laptop and selects a Git branching candidate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/laptop.jpg",
                width: 1280,
                height: 720,
                license: "cc-by",
                foreign_landing_url: "https://example.com/laptop",
                title: "Eee PC HackBook screen side",
                tags: [{ name: "linux" }, { name: "laptop" }],
              },
              {
                url: "https://images.example.com/branching.jpg",
                width: 1280,
                height: 720,
                license: "cc-by",
                foreign_landing_url: "https://example.com/branching",
                title: "Git branching workflow",
                tags: [{ name: "repository" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenversePublicImageSearchProvider().search({
      query: "Git branching workflow diagram",
    });

    expect(result.sourceUrl).toBe("https://example.com/branching");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://images.example.com/branching.jpg",
    );
  });

  it("retries a specific compact query when a detailed prompt has no results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/louvre.jpg",
                width: 1280,
                height: 720,
                license: "cc-by",
                foreign_landing_url: "https://example.com/louvre",
                title: "Louvre Pyramid Paris",
                tags: [{ name: "museum" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenversePublicImageSearchProvider().search({
      query: "Louvre Pyramid exterior Paris at night photo-realistic",
    });

    expect(result.sourceUrl).toBe("https://example.com/louvre");
    expect(
      new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("q"),
    ).toBe("louvre pyramid paris");
  });

  it("falls back to the leading identity token for sparse branded results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/splatoon.jpg",
                width: 1024,
                height: 683,
                license: "cc-by",
                foreign_landing_url: "https://example.com/splatoon",
                title: "Splatoon amiibo",
                tags: [{ name: "nintendo" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenversePublicImageSearchProvider().search({
      query: "Splatoon fans celebrating none",
    });

    expect(result.sourceUrl).toBe("https://example.com/splatoon");
    expect(
      new URL(String(fetchMock.mock.calls[2]?.[0])).searchParams.get("q"),
    ).toBe("splatoon");
  });

  it("rejects candidates that match only generic presentation words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [
                {
                  url: "https://images.example.com/generic.jpg",
                  width: 1280,
                  height: 720,
                  license: "cc-by",
                  foreign_landing_url: "https://example.com/generic",
                  title: "Presentation visual diagram",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      new OpenversePublicImageSearchProvider().search({
        query: "Git branching presentation diagram",
      }),
    ).rejects.toThrow("no licensed image candidate");
  });

  it("blocks private Openverse asset URLs before download", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                url: "http://127.0.0.1/private.jpg",
                width: 1280,
                height: 720,
                license: "cc-by",
                foreign_landing_url: "https://example.com/private",
                title: "Private product",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OpenversePublicImageSearchProvider().search({ query: "product" }),
    ).rejects.toThrow("private network");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("blocks Openverse asset redirects to private networks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://images.example.com/product.jpg",
                width: 1280,
                height: 720,
                license: "cc-by",
                foreign_landing_url: "https://example.com/product",
                title: "Product",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/internal.jpg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OpenversePublicImageSearchProvider().search({ query: "product" }),
    ).rejects.toThrow("private network");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("loads an official representative image with distinct provenance URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<html><head><meta property="og:image" content="/media/key-art.jpg"></head></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OfficialWebImageProvider().fetch({
      sourceUrls: ["https://official.example/game"],
      query: "Splatoon Raiders key art ".repeat(30),
    });

    expect(result).toMatchObject({
      provider: "official-web",
      sourceUrl: "https://official.example/game",
      sourceAssetUrl: "https://official.example/media/key-art.jpg",
      sourceAuthority: "official",
      usageBasis: "official-reference",
    });
    expect(result.fileName.length).toBeLessThanOrEqual(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers an official embedded trailer thumbnail over a logo social image", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<meta property="og:image" content="/media/Game_Logo.png">' +
            '<script>{"contentType":{"sys":{"id":"youTubeVideo"}},' +
            '"fields":{"internalName":"Official trailer","id":"d7ve2zWmkEA"}}</script>',
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OfficialWebImageProvider().fetch({
      sourceUrls: ["https://official.example/game"],
      query: "Game key art",
    });

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://i.ytimg.com/vi/d7ve2zWmkEA/maxresdefault.jpg",
    );
    expect(result.sourceAssetUrl).toBe(
      "https://i.ytimg.com/vi/d7ve2zWmkEA/maxresdefault.jpg",
    );
  });

  it("blocks private official source URLs before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OfficialWebImageProvider().fetch({
        sourceUrls: ["http://127.0.0.1/admin"],
        query: "private",
      }),
    ).rejects.toThrow("private network");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks redirects from official pages to private networks", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/internal.png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OfficialWebImageProvider().fetch({
        sourceUrls: ["https://official.example/game"],
        query: "redirect",
      }),
    ).rejects.toThrow("private network");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
