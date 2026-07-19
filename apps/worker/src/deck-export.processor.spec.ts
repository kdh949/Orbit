import type { Deck, Job } from "@orbit/shared";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embedDeckImageAssets,
  processDeckExportJob,
} from "./deck-export.processor";

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const zipMimeType = "application/zip";

const storage: Pick<StoragePort, "putObject" | "getSignedReadUrl"> = {
  getSignedReadUrl: vi.fn(async () => "http://storage.local/current.pptx"),
  putObject: vi.fn(async (input: { key: string; contentType: string }) => ({
    key: input.key,
    url: "http://storage.local/export.pptx",
    contentType: input.contentType,
    purpose: "export-result" as const,
    size: 4,
  })),
};

describe("processDeckExportJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("copies a fresh imported current package into a separate export asset", async () => {
    const deck = createDeck("import");
    const { dataSource, query } = createExportDataSource({
      deckVersion: 2,
      blueprint: templateBlueprint(2),
      packageProjectId: "project-a",
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe("http://storage.local/current.pptx");
      return new Response("current-package-bytes");
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck),
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({ deckId: deck.deckId, format: "pptx" });
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://localhost:8000/ai/export-deck-pptx",
      expect.anything(),
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: Buffer.from("current-package-bytes"),
        purpose: "export-result",
      }),
    );
    expect(query).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["project-a:deck_a"],
    );
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes("SELECT version"),
      ),
    ).toHaveLength(2);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("FOR SHARE")),
    ).toBe(true);
    expect(
      query.mock.calls.some(
        ([sql]) =>
          String(sql).includes("FROM project_assets") &&
          String(sql).includes("FOR SHARE"),
      ),
    ).toBe(true);
  });

  it("uses the generic exporter for imported Activity decks and sends only static content", async () => {
    const deck = createActivityDeck("import");
    const original = structuredClone(deck);
    const { dataSource, query, transaction } = createExportDataSource({
      deckVersion: 2,
      blueprint: templateBlueprint(2),
      packageProjectId: "project-a",
    });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:8000/ai/export-deck-pptx");
      const body = JSON.parse(String(init?.body));
      expect(JSON.stringify(body)).toContain(
        "실시간 참여는 발표 중 제공됩니다.",
      );
      expect(JSON.stringify(body)).toContain(
        "발표 세션을 선택하면 결과를 포함할 수 있습니다",
      );
      expect(
        body.deck.slides.every(
          (slide: Deck["slides"][number]) => slide.kind === "content",
        ),
      ).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/speaker secret|joinCode|qr/i);
      return new Response(
        JSON.stringify({
          contentBase64: Buffer.from("generic-pptx").toString("base64"),
          warnings: [],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck),
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(deck).toEqual(original);
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("FROM template_blueprints"),
      ),
    ).toBe(false);
  });

  it("renders a generic deck PPTX into an all-slide PNG ZIP", async () => {
    const deck = createDeck("ai");
    const { dataSource, query } = createExportDataSource({
      deckVersion: 1,
      blueprint: null,
    });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input) === "http://localhost:8000/ai/export-deck-pptx") {
        expect(JSON.parse(String(init?.body))).toMatchObject({ format: "pptx" });
        return new Response(
          JSON.stringify({
            contentBase64: Buffer.from("materialized-pptx").toString("base64"),
            warnings: ["pptx warning"],
          }),
        );
      }
      expect(String(input)).toBe("http://localhost:8000/ai/export-pptx-png-zip");
      expect(JSON.parse(String(init?.body))).toEqual({
        contentBase64: Buffer.from("materialized-pptx").toString("base64"),
      });
      return new Response(
        JSON.stringify({
          contentBase64: Buffer.from("png-zip").toString("base64"),
          warnings: ["render warning"],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck, "png"),
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({
      format: "png",
      warnings: ["pptx warning", "render warning"],
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: Buffer.from("png-zip"),
        contentType: zipMimeType,
        key: expect.stringMatching(/\.zip$/),
      }),
    );
    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO project_assets"),
    );
    expect(insertCall?.[1]).toEqual(
      expect.arrayContaining(["Export.zip", zipMimeType]),
    );
  });

  it("renders the current imported OOXML package directly into a PNG ZIP", async () => {
    const deck = createDeck("import");
    const { dataSource } = createExportDataSource({
      deckVersion: 2,
      blueprint: templateBlueprint(2),
      packageProjectId: "project-a",
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input) === "http://storage.local/current.pptx") {
        return new Response("current-package-bytes");
      }
      expect(String(input)).toBe("http://localhost:8000/ai/export-pptx-png-zip");
      return new Response(
        JSON.stringify({
          contentBase64: Buffer.from("imported-png-zip").toString("base64"),
          warnings: [],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck, "png"),
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({ format: "png" });
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://localhost:8000/ai/export-deck-pptx",
      expect.anything(),
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ body: Buffer.from("imported-png-zip") }),
    );
  });

  it.each([
    ["a different current deck", "deck_b"],
    ["no current deck row", null],
  ])(
    "keeps the generic Python exporter when the database has %s",
    async (_caseName, storedDeckId) => {
      const deck = createDeck("ai");
      const { dataSource, query, transaction } = createExportDataSource({
        deckVersion: 1,
        blueprint: null,
        storedDeckId,
      });
      const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
        expect(String(input)).toBe("http://localhost:8000/ai/export-deck-pptx");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          format: "pptx",
          deck: { deckId: deck.deckId },
        });
        return new Response(
          JSON.stringify({
            contentBase64: Buffer.from("generic-pptx").toString("base64"),
            warnings: [],
          }),
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const job = await processDeckExportJob(
        dataSource,
        storage,
        "http://localhost:8000",
        exportPayload(deck),
        { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
      );

      expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8000/ai/export-deck-pptx",
        expect.objectContaining({ method: "POST" }),
      );
      expect(transaction).not.toHaveBeenCalled();
      expect(
        query.mock.calls.some(([sql]) => String(sql).includes("SELECT version")),
      ).toBe(false);
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes("pg_advisory_xact_lock"),
        ),
      ).toBe(false);
    },
  );

  it("fails before persistence when the generic exporter reports motion loss", async () => {
    const deck = createDeck("ai");
    const { dataSource } = createExportDataSource({
      deckVersion: 1,
      blueprint: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              contentBase64:
                Buffer.from("lossy-generic-pptx").toString("base64"),
              warnings: [],
              motionDiagnostics: [
                {
                  code: "PPTX_MOTION_EFFECT_UNSUPPORTED",
                  slideIndex: 1,
                  elementId: "el_1",
                },
              ],
            }),
          ),
      ),
    );

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck),
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status).toBe("failed");
    expect(job.error).toMatchObject({
      code: "DECK_EXPORT_MOTION_PRESERVATION_FAILED",
      message: expect.stringContaining("PPTX_MOTION_EFFECT_UNSUPPORTED"),
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("exports flattened group motion through the supported fallback with a bounded warning", async () => {
    const deck = createDeck("ai");
    const { dataSource } = createExportDataSource({
      deckVersion: 1,
      blueprint: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              contentBase64: Buffer.from("flattened-group-pptx").toString(
                "base64",
              ),
              warnings: [],
              motionDiagnostics: [
                {
                  code: "PPTX_MOTION_TARGET_FLATTENED",
                  slideIndex: 1,
                  count: 2,
                },
              ],
            }),
          ),
      ),
    );

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck),
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({
      warnings: [expect.stringContaining("PPTX_MOTION_TARGET_FLATTENED: 2")],
    });
    expect(storage.putObject).toHaveBeenCalledOnce();
  });

  it("fails explicitly after bounded waits instead of exporting a stale package", async () => {
    const deck = createDeck("import");
    const { dataSource } = createExportDataSource({
      deckVersion: 3,
      blueprint: templateBlueprint(2),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck),
      { ooxmlReadyAttempts: 2, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status).toBe("failed");
    expect(job.error).toMatchObject({ code: "DECK_EXPORT_OOXML_SYNC_STALE" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects a current package asset owned by another project", async () => {
    const deck = createDeck("import");
    const { dataSource } = createExportDataSource({
      deckVersion: 2,
      blueprint: templateBlueprint(2),
      packageProjectId: "project-b",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await processDeckExportJob(
      dataSource,
      storage,
      "http://localhost:8000",
      exportPayload(deck),
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );

    expect(job.status).toBe("failed");
    expect(job.error).toMatchObject({
      code: "DECK_EXPORT_OOXML_PACKAGE_INVALID",
      message: expect.stringContaining("project mismatch"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});

describe("embedDeckImageAssets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("embeds project image bytes without mutating the stored deck", async () => {
    const deck = createDeck("ai");
    deck.slides[0].elements.push({
      elementId: "el_image",
      type: "image",
      role: "media",
      x: 100,
      y: 100,
      width: 400,
      height: 240,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
      locked: false,
      visible: true,
      props: {
        src: "/api/v1/projects/project-a/assets/file_image/content",
        alt: "Product",
        fit: "cover",
        focusX: 0.5,
        focusY: 0.5,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
    );
    const query = vi.fn(async () => [
      {
        file_id: "file_image",
        storage_key: "projects/project-a/assets/file_image.png",
        mime_type: "image/png",
      },
    ]);

    const embedded = await embedDeckImageAssets(
      { query } as unknown as DataSource,
      storage,
      "project-a",
      deck,
    );

    const embeddedImage = embedded.slides[0].elements.find(
      (element) => element.type === "image",
    );
    const originalImage = deck.slides[0].elements.find(
      (element) => element.type === "image",
    );
    expect(embeddedImage?.props.src).toBe("data:image/png;base64,AQID");
    expect(originalImage?.props.src).toBe(
      "/api/v1/projects/project-a/assets/file_image/content",
    );
  });
});

function createExportDataSource(input: {
  deckVersion: number;
  blueprint: ReturnType<typeof templateBlueprint> | null;
  packageProjectId?: string;
  storedDeckId?: string | null;
}) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("UPDATE jobs")) {
      return [
        jobRow(
          params[1] as "running" | "succeeded" | "failed",
          params[2] as number,
          params[4] as Record<string, unknown> | null,
          params[5] as { code: string; message: string } | null,
        ),
      ];
    }
    if (sql.includes("pg_advisory_xact_lock")) return [{ locked: true }];
    if (sql.includes("SELECT version")) {
      const storedDeckId =
        input.storedDeckId === undefined ? "deck_a" : input.storedDeckId;
      return storedDeckId === params[1] ? [{ version: input.deckVersion }] : [];
    }
    if (sql.includes("FROM template_blueprints")) {
      return input.blueprint ? [{ blueprint_json: input.blueprint }] : [];
    }
    if (sql.includes("FROM project_assets")) {
      return [
        {
          file_id: "file_current",
          project_id: input.packageProjectId ?? "project-a",
          storage_key: "projects/project-a/assets/current.pptx",
          mime_type: pptxMimeType,
          original_name: "current.pptx",
          purpose: "design-asset",
          status: "uploaded",
        },
      ];
    }
    if (sql.includes("INSERT INTO project_assets")) return [];
    return [];
  });
  const manager = { query };
  const transaction = vi.fn(
    async (callback: (value: typeof manager) => unknown) => callback(manager),
  );
  const dataSource = {
    query,
    transaction,
  } as unknown as DataSource;
  return { dataSource, query, transaction };
}

function templateBlueprint(syncedDeckVersion: number) {
  return {
    templateId: "template_a",
    sourceFileId: "file_source",
    sourcePackageFileId: "file_source",
    currentPackageFileId: "file_current",
    ooxmlSyncedDeckVersion: syncedDeckVersion,
    slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
  };
}

function exportPayload(deck: Deck, format: "pptx" | "png" = "pptx") {
  return {
    jobId: "job-export",
    projectId: "project-a",
    deck,
    format,
  };
}

function createDeck(sourceType: "ai" | "import"): Deck {
  return {
    deckId: "deck_a",
    projectId: "project-a",
    title: "Export",
    version: 1,
    targetDurationMinutes: 10,
    metadata: {
      language: "ko",
      locale: "ko-KR",
      sourceType,
      generatedBy: "ai",
    },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    theme: {
      name: "brandlogy-modern",
      fontFamily: "Pretendard",
      backgroundColor: "#FFFFFF",
      textColor: "#111827",
      accentColor: "#2563EB",
      palette: {
        primary: "#2563EB",
        secondary: "#F472B6",
        surface: "#FFFFFF",
        muted: "#F8FAFC",
        border: "#DBEAFE",
      },
      typography: {
        headingFontFamily: "Pretendard",
        bodyFontFamily: "Pretendard",
        titleSize: 56,
        headingSize: 40,
        bodySize: 24,
        captionSize: 16,
      },
      effects: { borderRadius: 8 },
    },
    slides: [
      {
        kind: "content",
        slideId: "slide_1",
        order: 1,
        title: "Opening",
        thumbnailUrl: "",
        style: {
          backgroundColor: "#FFFFFF",
          textColor: "#111827",
          accentColor: "#2563EB",
          layout: "title",
        },
        speakerNotes: "",
        elements: [],
        keywords: [],
        semanticCues: [],
        animations: [],
        actions: [],
      },
    ],
  };
}

function createActivityDeck(sourceType: "ai" | "import"): Deck {
  const deck = createDeck(sourceType);
  const base = deck.slides[0];
  return {
    ...deck,
    slides: [
      {
        ...base,
        kind: "activity",
        title: "참여",
        speakerNotes: "speaker secret",
        activity: {
          activityId: "activity_1",
          template: "satisfaction",
          title: "발표 만족도",
          description: "",
          questions: [
            {
              questionId: "question_1",
              type: "rating",
              prompt: "발표가 유익했나요?",
              required: true,
              leftLabel: "아니요",
              rightLabel: "그래요",
            },
          ],
          allowDisplayName: false,
          hideResultsUntilReveal: true,
        },
      },
      {
        ...base,
        slideId: "slide_2",
        order: 2,
        kind: "activity-results",
        title: "결과",
        speakerNotes: "speaker secret",
        activityResult: {
          sourceActivityId: "activity_1",
          display: "live",
          layout: "summary",
        },
      },
    ],
  };
}

function jobRow(
  status: Job["status"],
  progress: number,
  result: Record<string, unknown> | null,
  error: { code: string; message: string } | null,
) {
  return {
    job_id: "job-export",
    project_id: "project-a",
    type: "deck-export",
    status,
    progress,
    message: status,
    result,
    error,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}
