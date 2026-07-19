import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processPptxOoxmlGenerationJob } from "./pptx-ooxml-generation.processor";

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const payload = {
  jobId: "job-ooxml",
  projectId: "project-a",
  request: {
    fileId: "file_template"
  }
};

const storage: Pick<StoragePort, "getSignedReadUrl" | "putObject"> = {
  getSignedReadUrl: vi.fn(async () => "http://storage.local/template.pptx"),
  putObject: vi.fn(async (input: { key: string; contentType: string }) => ({
    key: input.key,
    url: "http://storage.local/design-asset",
    contentType: input.contentType,
    purpose: "design-asset" as const,
    size: 3
  }))
};

function createTransactionalDataSource(query: ReturnType<typeof vi.fn>) {
  const manager = { query };
  return {
    query,
    transaction: async (
      run: (transactionManager: typeof manager) => Promise<unknown>
    ) => run(manager)
  } as unknown as DataSource;
}

describe("processPptxOoxmlGenerationJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stores editable visual elements, render thumbnails, current package, template blueprint, and job result", async () => {
    const insertedDecks: unknown[] = [];
    const insertedBlueprints: unknown[] = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE jobs")) {
        return [
          jobRow(
            params[1] as "running" | "succeeded" | "failed",
            params[2] as number,
            params[4] as Record<string, unknown> | null,
            params[5] as { code: string; message: string } | null
          )
        ];
      }
      if (sql.includes("FROM project_assets")) {
        return [
          {
            file_id: "file_template",
            project_id: "project-a",
            storage_key: "projects/project-a/assets/file_template-template.pptx",
            mime_type: pptxMimeType,
            original_name: "template.pptx",
            size: 12,
            purpose: "pptx-import",
            status: "uploaded"
          }
        ];
      }
      if (sql.includes("INSERT INTO decks")) {
        insertedDecks.push(params[2]);
      }
      if (sql.includes("INSERT INTO template_blueprints")) {
        insertedBlueprints.push(params[4]);
      }
      return [];
    });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://storage.local/template.pptx") {
        return new Response("pptx-bytes");
      }
      if (url.endsWith("/ai/pptx-ooxml-generation")) {
        const form = init?.body as FormData;
        expect(Array.from(form.keys())).toEqual(["file_id", "file"]);
        expect(form.get("file_id")).toBe("file_template");
        return new Response(JSON.stringify(workerResponse()));
      }

      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processPptxOoxmlGenerationJob(
      createTransactionalDataSource(query),
      storage,
      "http://localhost:8000",
      payload
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(storage.putObject).toHaveBeenCalledTimes(3);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/png", purpose: "design-asset" })
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: pptxMimeType, purpose: "design-asset" })
    );

    const deck = insertedDecks[0] as {
      metadata: {
        thumbnailSource?: string;
      };
      slides: Array<{
        elements: Array<Record<string, unknown>>;
        transition?: { type: string; durationMs: number };
        animations: Array<Record<string, unknown>>;
        ooxmlMotionCapabilities?: Record<string, unknown>;
        thumbnailUrl: string;
        style: { backgroundImage?: { src?: string; fit?: string; opacity?: number } };
      }>;
    };
    expect(deck.metadata.thumbnailSource).toBe("import-render");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE projects"),
      ["project-a", "template"]
    );
    expect(deck.slides[0].thumbnailUrl).toMatch(
      /\/api\/v1\/projects\/project-a\/assets\/file_.*\/content/
    );
    expect(deck.slides[0].style.backgroundImage).toBeUndefined();
    expect(deck.slides[0].transition).toEqual({
      type: "fade",
      durationMs: 700
    });
    expect(deck.slides[0].animations).toEqual([
      expect.objectContaining({
        animationId: "anim_imported_title",
        elementId: "el_slot_title",
        startMode: "on-click"
      })
    ]);
    expect(deck.slides[0].ooxmlMotionCapabilities).toEqual({
      transitionWritable: true,
      importedMainSequenceCoverage: "complete"
    });
    expect(deck.slides[0].elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "el_imported_1_background",
          type: "rect",
          role: "background"
        }),
        expect.objectContaining({
          elementId: "el_slot_title",
          type: "text",
          role: "title",
          locked: false,
          props: expect.objectContaining({
            text: "Editable PPTX Title"
          })
        }),
        expect.objectContaining({
          elementId: "el_slot_media",
          type: "image",
          role: "media",
          locked: false,
          props: expect.objectContaining({
            src: expect.stringMatching(
              /\/api\/v1\/projects\/project-a\/assets\/file_.*\/content/
            )
          })
        })
      ])
    );
    expect(deck.slides[0].elements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ elementId: "el_ooxml_1_render" })
      ])
    );
    expect(deck.slides[0].elements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "el_slot_title",
          type: "rect",
          props: expect.objectContaining({
            fill: "transparent",
            stroke: "transparent"
          })
        })
      ])
    );

    const blueprint = insertedBlueprints[0] as {
      sourceFileId: string;
      sourcePackageFileId: string;
      currentPackageFileId: string;
      slides: Array<{ slideId: string; renderAssetFileId: string }>;
    };
    expect(blueprint.sourceFileId).toBe("file_template");
    expect(blueprint.sourcePackageFileId).toBe("file_template");
    expect(blueprint.currentPackageFileId).toMatch(/^file_/);
    expect(blueprint.currentPackageFileId).not.toBe(
      blueprint.sourcePackageFileId
    );
    expect(blueprint.slides[0].slideId).toBe(
      "slide_ooxml_file_template_1"
    );
    expect(blueprint.slides[0].renderAssetFileId).toMatch(/^file_/);
    expect(job.result).toMatchObject({
      deckId: "deck_ooxml_file_template",
      templateId: "template_file_template",
      sourceFileId: "file_template",
      currentPackageFileId: blueprint.currentPackageFileId
    });
  });

  it("uses the rendered slide background when fallback image assets are unresolved", async () => {
    const insertedDecks: unknown[] = [];
    const insertedBlueprints: unknown[] = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE jobs")) {
        return [
          jobRow(
            params[1] as "running" | "succeeded" | "failed",
            params[2] as number,
            params[4] as Record<string, unknown> | null,
            params[5] as { code: string; message: string } | null
          )
        ];
      }
      if (sql.includes("FROM project_assets")) {
        return [
          {
            file_id: "file_template",
            project_id: "project-a",
            storage_key: "projects/project-a/assets/file_template-template.pptx",
            mime_type: pptxMimeType,
            original_name: "template.pptx",
            size: 12,
            purpose: "pptx-import",
            status: "uploaded"
          }
        ];
      }
      if (sql.includes("INSERT INTO decks")) {
        insertedDecks.push(params[2]);
      }
      if (sql.includes("INSERT INTO template_blueprints")) {
        insertedBlueprints.push(params[4]);
      }
      return [];
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "http://storage.local/template.pptx") {
        return new Response("pptx-bytes");
      }
      if (url.endsWith("/ai/pptx-ooxml-generation")) {
        return new Response(JSON.stringify(workerResponseWithUnresolvedFallback()));
      }

      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processPptxOoxmlGenerationJob(
      createTransactionalDataSource(query),
      storage,
      "http://localhost:8000",
      payload
    );

    const deck = insertedDecks[0] as {
      slides: Array<{
        elements: Array<Record<string, unknown>>;
        animations: Array<Record<string, unknown>>;
        ooxmlMotionCapabilities: {
          importedMainSequenceCoverage: string;
        };
        style: { backgroundImage?: { src?: string; fit?: string; opacity?: number } };
      }>;
    };
    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(deck.slides[0].style.backgroundImage).toMatchObject({
      src: expect.stringMatching(
        /\/api\/v1\/projects\/project-a\/assets\/file_.*\/content/
      ),
      fit: "stretch",
      opacity: 1
    });
    expect(deck.slides[0].elements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "el_ooxml_1_slide_99_fallback_image"
        })
      ])
    );
    expect(deck.slides[0].elements).toEqual([]);
    expect(deck.slides[0].animations).toEqual([]);
    expect(
      deck.slides[0].ooxmlMotionCapabilities.importedMainSequenceCoverage
    ).toBe("partial");
    expect(insertedBlueprints[0]).toMatchObject({
      slides: [
        expect.objectContaining({
          ooxmlMotionCapabilities: expect.objectContaining({
            importedMainSequenceCoverage: "partial"
          })
        })
      ]
    });
    expect(job.result).toMatchObject({
      warnings: [
        expect.stringContaining(
          "OOXML visual tree importer failed; python-pptx fallback used:"
        )
      ]
    });
  });

  it("keeps resolved object fallback images as editable image elements", async () => {
    const insertedDecks: unknown[] = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE jobs")) {
        return [
          jobRow(
            params[1] as "running" | "succeeded" | "failed",
            params[2] as number,
            params[4] as Record<string, unknown> | null,
            params[5] as { code: string; message: string } | null
          )
        ];
      }
      if (sql.includes("FROM project_assets")) {
        return [
          {
            file_id: "file_template",
            project_id: "project-a",
            storage_key: "projects/project-a/assets/file_template-template.pptx",
            mime_type: pptxMimeType,
            original_name: "template.pptx",
            size: 12,
            purpose: "pptx-import",
            status: "uploaded"
          }
        ];
      }
      if (sql.includes("INSERT INTO decks")) {
        insertedDecks.push(params[2]);
      }
      return [];
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "http://storage.local/template.pptx") {
        return new Response("pptx-bytes");
      }
      if (url.endsWith("/ai/pptx-ooxml-generation")) {
        return new Response(JSON.stringify(workerResponseWithResolvedFallback()));
      }

      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processPptxOoxmlGenerationJob(
      createTransactionalDataSource(query),
      storage,
      "http://localhost:8000",
      payload
    );

    const deck = insertedDecks[0] as {
      slides: Array<{
        elements: Array<{ elementId: string; props?: { src?: string } }>;
        style: { backgroundImage?: { src?: string } };
      }>;
    };
    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(deck.slides[0].style.backgroundImage).toBeUndefined();
    expect(deck.slides[0].elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: "el_ooxml_1_slide_99_fallback_image",
          type: "image",
          props: expect.objectContaining({
            src: expect.stringMatching(
              /\/api\/v1\/projects\/project-a\/assets\/file_.*\/content/
            )
          })
        })
      ])
    );
  });

  it("fails when the source asset is not a PPTX import upload", async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE jobs")) {
        return [
          jobRow(
            params[1] as "running" | "succeeded" | "failed",
            params[2] as number,
            params[4] as Record<string, unknown> | null,
            params[5] as { code: string; message: string } | null
          )
        ];
      }
      if (sql.includes("FROM project_assets")) {
        return [
          {
            file_id: "file_template",
            project_id: "project-a",
            storage_key: "projects/project-a/assets/file_template.pdf",
            mime_type: "application/pdf",
            original_name: "template.pdf",
            size: 12,
            purpose: "reference-material",
            status: "uploaded"
          }
        ];
      }
      return [];
    });
    vi.stubGlobal("fetch", vi.fn());

    const job = await processPptxOoxmlGenerationJob(
      { query } as unknown as DataSource,
      storage,
      "http://localhost:8000",
      payload
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("PPTX_OOXML_GENERATION_SOURCE_FAILED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["topic", "prompt", "extraField"])(
    "rejects unsupported queue request field %s before source loading",
    async (field) => {
      const query = vi.fn(async (_sql: string, params: unknown[]) => [
        jobRow(
          params[1] as "running" | "succeeded" | "failed",
          params[2] as number,
          params[4] as Record<string, unknown> | null,
          params[5] as { code: string; message: string } | null
        )
      ]);
      vi.stubGlobal("fetch", vi.fn());

      const job = await processPptxOoxmlGenerationJob(
        { query } as unknown as DataSource,
        storage,
        "http://localhost:8000",
        {
          ...payload,
          request: { fileId: "file_template", [field]: "legacy value" }
        }
      );

      expect(job.status).toBe("failed");
      expect(job.error?.code).toBe("PPTX_OOXML_GENERATION_PAYLOAD_INVALID");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});

function workerResponse() {
  return {
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9"
    },
    templateBlueprint: {
      templateId: "template_file_template",
      sourceFileId: "file_template",
      sourcePackageFileId: "file_template",
      currentPackageFileId: "asset:current_package",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          sourceSlidePart: "ppt/slides/slide1.xml",
          ooxmlOrigin: "imported",
          ooxmlMotionCapabilities: {
            transitionWritable: true,
            importedMainSequenceCoverage: "complete"
          },
          renderAssetFileId: "asset:slide_render_1",
          slots: [
            {
              elementId: "el_slot_title",
              usage: "content-slot",
              slotRole: "title",
              replaceMode: "replace",
              confidence: 0.95,
              bounds: { x: 100, y: 80, width: 800, height: 120 },
              source: {
                type: "placeholder",
                placeholderType: "title",
                slidePart: "ppt/slides/slide1.xml",
                shapeId: "2"
              }
            },
            {
              elementId: "el_slot_media",
              usage: "media-slot",
              slotRole: "image",
              replaceMode: "replace",
              confidence: 0.7,
              bounds: { x: 900, y: 200, width: 420, height: 240 },
              source: {
                type: "image",
                slidePart: "ppt/slides/slide1.xml",
                shapeId: "5",
                relationshipId: "rId2"
              }
            }
          ]
        }
      ]
    },
    blueprint: {
      theme: {
        name: "Imported PPTX",
        fontFamily: "Inter",
        backgroundColor: "#ffffff",
        textColor: "#111827",
        accentColor: "#2563eb",
        palette: {
          primary: "#2563eb",
          secondary: "#7c3aed",
          surface: "#ffffff",
          muted: "#f3f4f6",
          border: "#d1d5db"
        },
        typography: {
          headingFontFamily: "Inter",
          bodyFontFamily: "Inter",
          titleSize: 56,
          headingSize: 40,
          bodySize: 24,
          captionSize: 16
        },
        effects: { borderRadius: 8 }
      },
      slides: [
        {
          sourceSlideIndex: 1,
          transition: { type: "fade", durationMs: 700 },
          animations: [
            {
              animationId: "anim_imported_title",
              elementId: "el_slot_title",
              type: "fade-in",
              order: 1,
              durationMs: 500,
              delayMs: 0,
              easing: "ease-out",
              startMode: "on-click"
            }
          ],
          style: {
            layout: "title-content",
            backgroundColor: "#ffffff",
            textColor: "#111827",
            accentColor: "#2563eb",
            fontFamily: "Inter"
          },
          elements: [
            {
              elementId: "el_imported_1_background",
              type: "rect",
              role: "background",
              x: 0,
              y: 0,
              width: 1920,
              height: 1080,
              rotation: 0,
              opacity: 1,
              zIndex: 0,
              locked: true,
              visible: true,
              props: {
                fill: "#ffffff",
                stroke: "transparent",
                strokeWidth: 0,
                borderRadius: 0
              }
            },
            {
              elementId: "el_slot_title",
              type: "text",
              role: "title",
              x: 100,
              y: 80,
              width: 800,
              height: 120,
              rotation: 0,
              opacity: 1,
              zIndex: 1,
              locked: false,
              visible: true,
              props: {
                text: "Editable PPTX Title",
                fontFamily: "Inter",
                fontSize: 44,
                fontWeight: "bold",
                color: "#111827",
                align: "left",
                verticalAlign: "top",
                lineHeight: 1.2
              }
            },
            {
              elementId: "el_slot_media",
              type: "image",
              role: "media",
              x: 900,
              y: 200,
              width: 420,
              height: 240,
              rotation: 0,
              opacity: 1,
              zIndex: 2,
              locked: false,
              visible: true,
              props: {
                src: "asset:image_1",
                alt: "Imported image",
                fit: "contain",
                focusX: 0.5,
                focusY: 0.5
              }
            }
          ]
        }
      ]
    },
    qualityReport: qualityReport(),
    assets: [
      {
        assetId: "slide_render_1",
        fileName: "slide-01.png",
        mimeType: "image/png",
        contentBase64: Buffer.from("png").toString("base64")
      },
      {
        assetId: "current_package",
        fileName: "template.pptx",
        mimeType: pptxMimeType,
        contentBase64: Buffer.from("pptx").toString("base64")
      },
      {
        assetId: "image_1",
        fileName: "image-01.png",
        mimeType: "image/png",
        contentBase64: Buffer.from("image").toString("base64")
      }
    ],
    warnings: ["media slot preserved"]
  };
}

function workerResponseWithUnresolvedFallback() {
  const response = workerResponse();
  response.warnings = [
    "OOXML visual tree importer failed; python-pptx fallback used: synthetic importer failure"
  ];
  response.blueprint.slides[0].elements = [
    {
      elementId: "el_ooxml_1_slide_99_fallback_image",
      type: "image",
      role: "decoration",
      x: 120,
      y: 90,
      width: 480,
      height: 260,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
      locked: false,
      visible: true,
      props: {
        src: "asset:shape_render_1_slide_99",
        alt: "Unsupported preset",
        fit: "stretch",
        focusX: 0.5,
        focusY: 0.5
      }
    }
  ];
  response.assets = response.assets.filter((asset) => asset.assetId !== "image_1");
  return response;
}

function workerResponseWithResolvedFallback() {
  const response = workerResponseWithUnresolvedFallback();
  response.assets.push({
    assetId: "shape_render_1_slide_99",
    fileName: "shape-render.png",
    mimeType: "image/png",
    contentBase64: Buffer.from("shape").toString("base64")
  });
  return response;
}

function jobRow(
  status: "running" | "succeeded" | "failed",
  progress: number,
  result: Record<string, unknown> | null,
  error: { code: string; message: string } | null
) {
  return {
    job_id: "job-ooxml",
    project_id: "project-a",
    type: "pptx-ooxml-generation",
    status,
    progress,
    message: status,
    result,
    error,
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:01.000Z"
  };
}

function qualityReport() {
  return {
    compositeScore: 82,
    metrics: {
      geometry: 90,
      text: 80,
      color: 80,
      layer: 90,
      editability: 60,
      pixelSimilarity: null
    },
    weights: {
      geometry: 25,
      text: 15,
      color: 10,
      layer: 10,
      editability: 10,
      pixelSimilarity: 30
    },
    editabilityCoverage: 0.6,
    appliedCap: null,
    notes: ["OOXML package rendered to slide PNG"]
  };
}
