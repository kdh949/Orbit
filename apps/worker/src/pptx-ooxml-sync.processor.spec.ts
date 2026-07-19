import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendJsonFilePart,
  OoxmlSyncTransportError,
  processPptxOoxmlSyncJob,
} from "./pptx-ooxml-sync.processor";

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const payload = {
  jobId: "job-sync",
  projectId: "project-a",
  deckId: "deck_a",
  changeId: "change-a",
  targetDeckVersion: 2,
};

const storage: Pick<StoragePort, "getSignedReadUrl" | "putObject"> = {
  getSignedReadUrl: vi.fn(async (key: string) =>
    key.endsWith("image.png")
      ? "http://storage.local/image.png"
      : "http://storage.local/current.pptx",
  ),
  putObject: vi.fn(async (input: { key: string; contentType: string }) => ({
    key: input.key,
    url: "http://storage.local/design-asset",
    contentType: input.contentType,
    purpose: "design-asset" as const,
    size: 3,
  })),
};

describe("processPptxOoxmlSyncJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("coalesces to the latest stored version, embeds project images, and conditionally compacts patches", async () => {
    let savedBlueprint: Record<string, unknown> | null = null;
    const { dataSource, query } = createDataSource({
      deckVersion: 3,
      syncedVersion: 1,
      operations: [
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_title",
          props: { text: "Updated title" },
        },
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_image",
          props: {
            src: "/api/v1/projects/project-a/assets/file_image/content",
          },
        },
      ],
      onBlueprintUpdate: (blueprint) => {
        savedBlueprint = blueprint;
        return true;
      },
    });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("current.pptx")) return new Response("pptx-bytes");
      if (url.endsWith("image.png")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      if (url.endsWith("/ai/pptx-ooxml-sync")) {
        const form = init?.body as FormData;
        expect(form.get("synced_deck_version")).toBe("3");
        expect(form.get("template_blueprint")).toBeNull();
        expect(form.get("operations")).toBeNull();
        expect(form.get("deck_canvas")).toBeNull();
        const operationsPart = form.get("operations_file");
        expect(operationsPart).toBeInstanceOf(Blob);
        expect((operationsPart as Blob).type).toBe("application/json");
        expect(JSON.parse(await (operationsPart as Blob).text())).toEqual([
          expect.objectContaining({
            type: "update_element_props",
            props: { text: "Updated title" },
          }),
          expect.objectContaining({
            type: "update_element_props",
            props: { src: "data:image/png;base64,AQID" },
          }),
        ]);
        return new Response(
          JSON.stringify(
            workerResponse([
              {
                operationType: "update_element_props",
                slideId: "slide_1",
                elementId: "el_title",
              },
              {
                operationType: "update_element_props",
                slideId: "slide_1",
                elementId: "el_image",
              },
            ]),
          ),
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({ syncedDeckVersion: 3 });
    expect(savedBlueprint).toMatchObject({
      currentPackageFileId: expect.stringMatching(/^file_/),
      ooxmlSyncedDeckVersion: 3,
    });
    expect(query).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["project-a:deck_a"],
    );
    const conditionalUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE template_blueprints"),
    );
    expect(String(conditionalUpdate?.[0])).toContain(
      "ooxmlSyncedDeckVersion')::integer, 0) < $5",
    );
    expect(conditionalUpdate?.[1]?.[4]).toBe(3);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM deck_patches"),
      ["project-a", "deck_a", 3],
    );
  });

  it("keeps logical group operations out of the OOXML package", async () => {
    let savedBlueprint: Record<string, unknown> | null = null;
    const { dataSource } = createDataSource({
      blueprint: {
        ...templateBlueprint(1),
        logicalGroupElementIds: ["el_group_old"],
      },
      deckElements: [
        {
          elementId: "el_group_new",
          type: "group",
          role: "decoration",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 10,
          locked: false,
          visible: true,
          props: { childElementIds: ["el_title"] },
        },
      ],
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "add_element",
          slideId: "slide_1",
          element: {
            elementId: "el_group_new",
            type: "group",
            role: "decoration",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            zIndex: 10,
            locked: false,
            visible: true,
            props: { childElementIds: ["el_title"] },
          },
        },
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_group_new",
          frame: { x: 20 },
        },
        {
          type: "delete_element",
          slideId: "slide_1",
          elementId: "el_group_old",
        },
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_title",
          frame: { x: 120 },
        },
      ],
      onBlueprintUpdate: (blueprint) => {
        savedBlueprint = blueprint;
        return true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("current.pptx")) {
          return new Response("pptx-bytes");
        }
        const operationsPart = (init?.body as FormData).get("operations_file");
        expect(JSON.parse(await (operationsPart as Blob).text())).toEqual([
          expect.objectContaining({
            type: "update_element_frame",
            slideId: "slide_1",
            elementId: "el_title",
            frame: { x: 120 },
          }),
        ]);
        return new Response(
          JSON.stringify(
            workerResponse([
              {
                operationType: "update_element_frame",
                slideId: "slide_1",
                elementId: "el_title",
              },
            ]),
          ),
        );
      }),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(savedBlueprint).toMatchObject({
      logicalGroupElementIds: ["el_group_new"],
    });
  });

  it("compacts a transient element that is added and deleted before sync", async () => {
    const { dataSource } = createDataSource({
      deckVersion: 4,
      syncedVersion: 1,
      operations: [
        {
          type: "add_element",
          slideId: "slide_1",
          element: {
            elementId: "el_transient_chart",
            type: "chart",
            role: "chart",
            x: 100,
            y: 100,
            width: 500,
            height: 280,
            rotation: 0,
            opacity: 1,
            zIndex: 2,
            locked: false,
            visible: true,
            props: { type: "bar", title: "Temporary", data: [] },
          },
        },
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_transient_chart",
          frame: { x: 120 },
        },
        {
          type: "delete_element",
          slideId: "slide_1",
          elementId: "el_transient_chart",
        },
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_title",
          props: { text: "Current title" },
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("current.pptx")) {
          return new Response("pptx-bytes");
        }
        const operationsPart = (init?.body as FormData).get("operations_file");
        expect(JSON.parse(await (operationsPart as Blob).text())).toEqual([
          expect.objectContaining({
            type: "update_element_props",
            slideId: "slide_1",
            elementId: "el_title",
          }),
        ]);
        return new Response(
          JSON.stringify(
            workerResponse([
              {
                operationType: "update_element_props",
                slideId: "slide_1",
                elementId: "el_title",
              },
            ]),
          ),
        );
      }),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  });

  it("sends operations larger than the parser's former 1 MiB limit as a JSON file part", async () => {
    const largeText = "x".repeat(1024 * 1024 + 32);
    const { dataSource } = createDataSource({
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_title",
          props: { text: largeText },
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("current.pptx")) {
          return new Response("pptx-bytes");
        }
        const form = init?.body as FormData;
        const operationsPart = form.get("operations_file");
        expect(operationsPart).toBeInstanceOf(Blob);
        expect((operationsPart as Blob).size).toBeGreaterThan(1024 * 1024);
        const sentOperations = JSON.parse(
          await (operationsPart as Blob).text(),
        ) as Array<{ props: { text: string } }>;
        expect(sentOperations[0]?.props.text).toBe(largeText);
        return new Response(
          JSON.stringify(
            workerResponse([
              {
                operationType: "update_element_props",
                slideId: "slide_1",
                elementId: "el_title",
              },
            ]),
          ),
        );
      }),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  });

  it("coalesces motion patches into the latest slide full-state file part", async () => {
    const baseBlueprint = templateBlueprint(1);
    const blueprint = {
      ...baseBlueprint,
      slides: baseBlueprint.slides.map((slide) => ({
        ...slide,
        ooxmlOrigin: "imported" as const,
        ooxmlMotionCapabilities: {
          transitionWritable: true,
          importedMainSequenceCoverage: "complete" as const,
        },
      })),
    };
    const animation = {
      animationId: "anim_1",
      elementId: "el_title",
      type: "fade-in" as const,
      order: 1,
      durationMs: 500,
      delayMs: 0,
      easing: "ease-out" as const,
      startMode: "on-click" as const,
    };
    const { dataSource } = createDataSource({
      blueprint,
      deckSlides: [
        {
          slideId: "slide_1",
          ooxmlOrigin: "imported",
          ooxmlSourceSlidePart: "ppt/slides/slide1.xml",
          ooxmlMotionCapabilities: {
            transitionWritable: true,
            importedMainSequenceCoverage: "complete",
          },
          order: 1,
          title: "Slide 1",
          elements: [],
          transition: { type: "fade", durationMs: 700 },
          animations: [animation],
        },
      ],
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "update_slide_transition",
          slideId: "slide_1",
          transition: { type: "fade", durationMs: 700 },
        },
        { type: "add_animation", slideId: "slide_1", animation },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("current.pptx")) {
          return new Response("pptx-bytes");
        }
        const form = init?.body as FormData;
        const motionPart = form.get("slide_motion_file");
        expect(motionPart).toBeInstanceOf(Blob);
        expect((motionPart as Blob).type).toBe("application/json");
        expect(JSON.parse(await (motionPart as Blob).text())).toEqual([
          {
            slideId: "slide_1",
            sourceSlidePart: "ppt/slides/slide1.xml",
            transition: { type: "fade", durationMs: 700 },
            animations: [animation],
            capabilities: {
              transitionWritable: true,
              importedMainSequenceCoverage: "complete",
            },
            touched: { transition: true, animations: true },
          },
        ]);
        return new Response(
          JSON.stringify({
            ...workerResponse(),
            appliedSlideMotion: [
              { slideId: "slide_1", transition: true, animations: true },
            ],
          }),
        );
      }),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({ syncedDeckVersion: 2 });
  });

  it.each([
    [
      "an unsupported scope",
      {
        unsupportedSlideMotion: [
          {
            slideId: "slide_1",
            scope: "transition",
            reasonCode: "SLIDE_TRANSITION_UNSUPPORTED",
          },
        ],
      },
    ],
    ["a missing acknowledgment", { appliedSlideMotion: [] }],
  ])(
    "fails closed without persistence when Python returns %s",
    async (_caseName, responsePatch) => {
      const baseBlueprint = templateBlueprint(1);
      const blueprint = {
        ...baseBlueprint,
        slides: baseBlueprint.slides.map((slide) => ({
          ...slide,
          ooxmlOrigin: "imported" as const,
          ooxmlMotionCapabilities: {
            transitionWritable: true,
            importedMainSequenceCoverage: "absent" as const,
          },
        })),
      };
      const { dataSource, query } = createDataSource({
        blueprint,
        deckSlides: [
          {
            slideId: "slide_1",
            ooxmlOrigin: "imported",
            ooxmlSourceSlidePart: "ppt/slides/slide1.xml",
            ooxmlMotionCapabilities: {
              transitionWritable: true,
              importedMainSequenceCoverage: "absent",
            },
            order: 1,
            title: "Slide 1",
            elements: [],
            transition: { type: "fade", durationMs: 700 },
            animations: [],
          },
        ],
        deckVersion: 2,
        syncedVersion: 1,
        operations: [
          {
            type: "update_slide_transition",
            slideId: "slide_1",
            transition: { type: "fade", durationMs: 700 },
          },
        ],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) =>
          String(input).endsWith("current.pptx")
            ? new Response("pptx-bytes")
            : new Response(
                JSON.stringify({
                  ...workerResponse(),
                  ...responsePatch,
                }),
              ),
        ),
      );

      const job = await processPptxOoxmlSyncJob(
        dataSource,
        storage,
        "http://localhost:8000",
        payload,
      );

      expect(job.status).toBe("failed");
      expect(job.error).toMatchObject({
        code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
      });
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes("UPDATE template_blueprints"),
        ),
      ).toBe(false);
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes("DELETE FROM deck_patches"),
        ),
      ).toBe(false);
    },
  );

  it("syncs a slide reorder with unique source slide locators and a large blueprint", async () => {
    const blueprint = reorderTemplateBlueprint(1);
    const slideIds = ["slide_cover", "slide_metrics", "slide_close"];
    blueprint.slides = blueprint.slides.map((slide, index) => ({
      ...slide,
      slideId: slideIds[index],
    }));
    blueprint.slides[0]!.elementSources = Array.from(
      { length: 9_000 },
      (_, index) => ({
        elementId: `el_large_${index}`,
        slidePart: "ppt/slides/slide1.xml",
        shapeId: String(index + 1),
        sourceType: "slide" as const,
        writable: true,
      }),
    );
    const { dataSource } = createDataSource({
      blueprint,
      deckSlideIds: ["slide_close", "slide_cover", "slide_metrics"],
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "reorder_slides",
          slideOrders: [
            { slideId: "slide_close", order: 1 },
            { slideId: "slide_cover", order: 2 },
            { slideId: "slide_metrics", order: 3 },
          ],
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("current.pptx")) {
          return new Response("pptx-bytes");
        }
        const form = init?.body as FormData;
        const blueprintPart = form.get("template_blueprint_file") as Blob;
        expect(blueprintPart.size).toBeGreaterThan(1024 * 1024);
        const operationsPart = form.get("operations_file") as Blob;
        expect(JSON.parse(await operationsPart.text())).toEqual([
          {
            type: "reorder_slides",
            slideOrders: [
              {
                slideId: "slide_close",
                order: 1,
                sourceSlidePart: "ppt/slides/slide3.xml",
              },
              {
                slideId: "slide_cover",
                order: 2,
                sourceSlidePart: "ppt/slides/slide1.xml",
              },
              {
                slideId: "slide_metrics",
                order: 3,
                sourceSlidePart: "ppt/slides/slide2.xml",
              },
            ],
          },
        ]);
        return new Response(
          JSON.stringify(workerResponse([{ operationType: "reorder_slides" }])),
        );
      }),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({ syncedDeckVersion: 2 });
  });

  it("replays mixed slide lifecycle operations before compacting to the final reorder", async () => {
    const finalSlideIds = [
      "slide_ooxml_file_3",
      "slide_ooxml_file_1",
      "slide_ooxml_file_2",
    ];
    const restoredSlide = {
      slideId: "slide_ooxml_file_2",
      order: 2,
      title: "Restored slide",
      speakerNotes: "",
      elements: [],
      animations: [],
      actions: [],
      keywords: [],
      semanticCues: [],
    };
    const duplicateSlide = {
      ...restoredSlide,
      slideId: "slide_duplicate",
      order: 3,
      title: "Duplicate slide",
      ooxmlOrigin: "authored" as const,
    };
    const { dataSource } = createDataSource({
      blueprint: reorderTemplateBlueprint(1),
      deckSlideIds: finalSlideIds,
      deckVersion: 9,
      syncedVersion: 1,
      operations: [
        { type: "add_slide", slide: duplicateSlide },
        {
          type: "reorder_slides",
          slideOrders: [
            "slide_ooxml_file_1",
            "slide_ooxml_file_2",
            "slide_duplicate",
            "slide_ooxml_file_3",
          ].map((slideId, index) => ({ slideId, order: index + 1 })),
        },
        { type: "delete_slide", slideId: "slide_ooxml_file_2" },
        {
          type: "reorder_slides",
          slideOrders: [
            "slide_ooxml_file_1",
            "slide_duplicate",
            "slide_ooxml_file_3",
          ].map((slideId, index) => ({ slideId, order: index + 1 })),
        },
        { type: "add_slide", slide: restoredSlide },
        {
          type: "reorder_slides",
          slideOrders: [
            "slide_ooxml_file_3",
            "slide_ooxml_file_1",
            "slide_ooxml_file_2",
            "slide_duplicate",
          ].map((slideId, index) => ({ slideId, order: index + 1 })),
        },
        { type: "delete_slide", slideId: "slide_duplicate" },
        {
          type: "reorder_slides",
          slideOrders: finalSlideIds.map((slideId, index) => ({
            slideId,
            order: index + 1,
          })),
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("current.pptx")) {
          return new Response("pptx-bytes");
        }
        const operationsPart = (init?.body as FormData).get(
          "operations_file",
        ) as Blob;
        expect(JSON.parse(await operationsPart.text())).toEqual([
          {
            type: "reorder_slides",
            slideOrders: [
              {
                slideId: "slide_ooxml_file_3",
                order: 1,
                sourceSlidePart: "ppt/slides/slide3.xml",
              },
              {
                slideId: "slide_ooxml_file_1",
                order: 2,
                sourceSlidePart: "ppt/slides/slide1.xml",
              },
              {
                slideId: "slide_ooxml_file_2",
                order: 3,
                sourceSlidePart: "ppt/slides/slide2.xml",
              },
            ],
          },
        ]);
        return new Response(
          JSON.stringify(workerResponse([{ operationType: "reorder_slides" }])),
        );
      }),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      { ...payload, targetDeckVersion: 9 },
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(job.result).toMatchObject({ syncedDeckVersion: 9 });
  });

  it("rejects a JSON part over its explicit limit before adding it to multipart", () => {
    const form = new FormData();

    expect(() =>
      appendJsonFilePart(
        form,
        "deck_canvas_file",
        "deck-canvas.json",
        "deck_canvas",
        { padding: "x".repeat(4 * 1024) },
      ),
    ).toThrow(
      new OoxmlSyncTransportError(
        "PPTX_OOXML_SYNC_PART_TOO_LARGE",
        "deck_canvas",
        4 * 1024,
      ),
    );
    expect(form.get("deck_canvas_file")).toBeNull();
  });

  it("persists refreshed authored table locators returned by Python", async () => {
    let savedBlueprint: Record<string, unknown> | null = null;
    const initialBlueprint = templateBlueprint(1);
    initialBlueprint.slides[0]!.elementSources = [
      tableElementSource("el_table", 2, 2),
    ];
    const { dataSource } = createDataSource({
      blueprint: initialBlueprint,
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_table",
          props: {
            rows: [
              [{ text: "A" }, { text: "B" }, { text: "C" }],
              [{ text: "D" }, { text: "E" }, { text: "F" }],
            ],
            columnWidths: [100, 100, 100],
            rowHeights: [60, 60],
          },
        },
      ],
      onBlueprintUpdate: (blueprint) => {
        savedBlueprint = blueprint;
        return true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("current.pptx")
          ? new Response("pptx-bytes")
          : new Response(
              JSON.stringify({
                ...workerResponse([
                  {
                    operationType: "update_element_props",
                    slideId: "slide_1",
                    elementId: "el_table",
                  },
                ]),
                elementSources: [tableElementSource("el_table", 2, 3)],
              }),
            ),
      ),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    const savedSources = ((
      savedBlueprint as unknown as {
        slides?: Array<{ elementSources?: unknown[] }>;
      }
    ).slides?.[0]?.elementSources ?? []) as Array<{
      elementId?: string;
      tableCellLocators?: unknown[];
    }>;
    expect(
      savedSources.find((source) => source.elementId === "el_table")
        ?.tableCellLocators,
    ).toHaveLength(6);
  });

  it("treats a lower queued version as a no-op after a newer package is synced", async () => {
    const { dataSource, query } = createDataSource({
      deckVersion: 3,
      syncedVersion: 3,
      operations: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({
      currentPackageFileId: "file_current",
      syncedDeckVersion: 3,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE template_blueprints"),
      ),
    ).toBe(false);
  });

  it("does not compact patches when the conditional blueprint update loses to a newer version", async () => {
    const { dataSource, query } = createDataSource({
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_title",
          props: { text: "Version two" },
        },
      ],
      onBlueprintUpdate: () => false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("current.pptx")
          ? new Response("pptx-bytes")
          : new Response(
              JSON.stringify(
                workerResponse([
                  {
                    operationType: "update_element_props",
                    slideId: "slide_1",
                    elementId: "el_title",
                  },
                ]),
              ),
            ),
      ),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("PPTX_OOXML_SYNC_FAILED");
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM deck_patches"),
      ),
    ).toBe(false);
  });

  it("fails without saving assets or advancing freshness when Python rejects an operation", async () => {
    const { dataSource, query } = createDataSource({
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_title",
          props: { fontSize: 42 },
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("current.pptx")
          ? new Response("pptx-bytes")
          : new Response(
              JSON.stringify({
                ...workerResponse(),
                unsupportedOperations: [
                  {
                    operationType: "update_element_props",
                    slideId: "slide_1",
                    elementId: "el_title",
                    reasonCode: "RICH_TEXT_CAPABILITY_UNSAFE",
                  },
                ],
              }),
            ),
      ),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.error).toMatchObject({
      code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
      retryable: false,
    });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO project_assets"),
      ),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE template_blueprints"),
      ),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM deck_patches"),
      ),
    ).toBe(false);
  });

  it("keeps assets and freshness unchanged for a bounded Python transport failure", async () => {
    const { dataSource, query } = createDataSource({
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "update_element_props",
          slideId: "slide_1",
          elementId: "el_title",
          props: { text: "private deck text" },
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("current.pptx")
          ? new Response("pptx-bytes")
          : new Response(
              JSON.stringify({
                detail: {
                  code: "PPTX_OOXML_SYNC_JSON_INVALID",
                  field: "operations",
                },
              }),
              { status: 400, headers: { "content-type": "application/json" } },
            ),
      ),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.error).toEqual({
      code: "PPTX_OOXML_SYNC_JSON_INVALID",
      message: "PPTX_OOXML_SYNC_JSON_INVALID:operations",
      retryable: false,
    });
    expect(JSON.stringify(job.error)).not.toContain("private deck text");
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO project_assets"),
      ),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE template_blueprints"),
      ),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM deck_patches"),
      ),
    ).toBe(false);
  });

  it.each([
    "TABLE_CELL_CAPABILITY_UNSAFE",
    "TABLE_STRUCTURE_UNSUPPORTED",
  ] as const)(
    "parses %s as a non-retryable table edit failure without exposing cell text",
    async (reasonCode) => {
      const privateCellText = "비공개 표 셀 내용";
      const { dataSource, query } = createDataSource({
        deckVersion: 2,
        syncedVersion: 1,
        operations: [
          {
            type: "update_element_props",
            slideId: "slide_1",
            elementId: "el_table",
            props: { rows: [[{ text: privateCellText }]] },
          },
        ],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) =>
          String(input).endsWith("current.pptx")
            ? new Response("pptx-bytes")
            : new Response(
                JSON.stringify({
                  ...workerResponse([]),
                  unsupportedOperations: [
                    {
                      operationType: "update_element_props",
                      slideId: "slide_1",
                      elementId: "el_table",
                      reasonCode,
                    },
                  ],
                }),
              ),
        ),
      );

      const job = await processPptxOoxmlSyncJob(
        dataSource,
        storage,
        "http://localhost:8000",
        payload,
      );

      expect(job.status).toBe("failed");
      expect(job.error).toEqual({
        code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
        message: `update_element_props:${reasonCode}:slide_1:el_table`,
        retryable: false,
      });
      expect(JSON.stringify(job.error)).not.toContain(privateCellText);
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes("UPDATE template_blueprints"),
        ),
      ).toBe(false);
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes("DELETE FROM deck_patches"),
        ),
      ).toBe(false);
    },
  );

  it("rejects an incomplete applied-operation acknowledgement", async () => {
    const { dataSource, query } = createDataSource({
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "update_element_frame",
          slideId: "slide_1",
          elementId: "el_title",
          frame: { x: 120 },
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("current.pptx")
          ? new Response("pptx-bytes")
          : new Response(JSON.stringify(workerResponse())),
      ),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.error).toMatchObject({
      code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
      retryable: false,
    });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE template_blueprints"),
      ),
    ).toBe(false);
  });

  it("rejects a reordered applied-operation acknowledgement without advancing freshness", async () => {
    const { dataSource, query } = createDataSource({
      blueprint: reorderTemplateBlueprint(1),
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "reorder_slides",
          slideOrders: [
            { slideId: "slide_ooxml_file_3", order: 1 },
            { slideId: "slide_ooxml_file_1", order: 2 },
            { slideId: "slide_ooxml_file_2", order: 3 },
          ],
        },
        {
          type: "update_element_props",
          slideId: "slide_ooxml_file_1",
          elementId: "el_title",
          props: { text: "Updated" },
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("current.pptx")
          ? new Response("pptx-bytes")
          : new Response(
              JSON.stringify(
                workerResponse([
                  {
                    operationType: "update_element_props",
                    slideId: "slide_ooxml_file_1",
                    elementId: "el_title",
                  },
                  { operationType: "reorder_slides" },
                ]),
              ),
            ),
      ),
    );

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.error).toMatchObject({
      code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
      retryable: false,
    });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE template_blueprints"),
      ),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM deck_patches"),
      ),
    ).toBe(false);
  });

  it("rejects an incomplete reorder permutation before downloading the package", async () => {
    const { dataSource, query } = createDataSource({
      blueprint: reorderTemplateBlueprint(1),
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "reorder_slides",
          slideOrders: [
            { slideId: "slide_ooxml_file_3", order: 1 },
            { slideId: "slide_ooxml_file_1", order: 2 },
          ],
        },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.error).toEqual({
      code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
      message: "reorder_slides:SLIDE_REORDER_PERMUTATION_INVALID",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE template_blueprints"),
      ),
    ).toBe(false);
  });

  it("creates an authored slide and embeds an image from the same sync batch", async () => {
    let savedBlueprint: Record<string, unknown> | null = null;
    const { dataSource } = createDataSource({
      deckSlideIds: ["slide_1", "slide_authored"],
      deckVersion: 2,
      syncedVersion: 1,
      operations: [
        {
          type: "add_slide",
          slide: {
            slideId: "slide_authored",
            order: 2,
            title: "Authored slide",
            speakerNotes: "",
            elements: [],
            animations: [],
            actions: [],
            keywords: [],
            semanticCues: [],
          },
        },
        {
          type: "add_element",
          slideId: "slide_authored",
          element: {
            elementId: "el_authored_image",
            type: "image",
            x: 100,
            y: 100,
            width: 320,
            height: 180,
            rotation: 0,
            opacity: 1,
            zIndex: 0,
            locked: false,
            visible: true,
            ooxmlOrigin: "authored",
            props: {
              src: "/api/v1/projects/project-a/assets/file_image/content",
              fit: "contain",
            },
          },
        },
      ],
      onBlueprintUpdate: (blueprint) => {
        savedBlueprint = blueprint;
        return true;
      },
    });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("current.pptx")) return new Response("pptx-bytes");
      if (url.endsWith("image.png")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      if (url.endsWith("/ai/pptx-ooxml-sync")) {
        const form = init?.body as FormData;
        const operations = JSON.parse(
          await (form.get("operations_file") as Blob).text(),
        );
        expect(operations).toEqual([
          expect.objectContaining({
            type: "add_slide",
            sourceSlidePart: "ppt/slides/slide2.xml",
          }),
          expect.objectContaining({
            type: "add_element",
            slideId: "slide_authored",
            sourceSlidePart: "ppt/slides/slide2.xml",
            element: expect.objectContaining({
              props: expect.objectContaining({
                src: "data:image/png;base64,AQID",
              }),
            }),
          }),
          {
            type: "reorder_slides",
            slideOrders: [
              expect.objectContaining({ slideId: "slide_1", order: 1 }),
              expect.objectContaining({ slideId: "slide_authored", order: 2 }),
            ],
          },
        ]);
        return new Response(
          JSON.stringify({
            ...workerResponse([
              { operationType: "add_slide", slideId: "slide_authored" },
              {
                operationType: "add_element",
                slideId: "slide_authored",
                elementId: "el_authored_image",
              },
              { operationType: "reorder_slides" },
            ]),
            elementSources: [
              {
                elementId: "el_authored_image",
                elementType: "image",
                ooxmlOrigin: "authored",
                slidePart: "ppt/slides/slide2.xml",
                shapeId: "2",
                relationshipId: "rId2",
                sourceType: "image",
                writable: true,
              },
            ],
          }),
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    expect(savedBlueprint).toMatchObject({
      slides: expect.arrayContaining([
        expect.objectContaining({
          slideId: "slide_authored",
          sourceSlidePart: "ppt/slides/slide2.xml",
          ooxmlOrigin: "authored",
          elementSources: [
            expect.objectContaining({ elementId: "el_authored_image" }),
          ],
        }),
      ]),
    });
  });
});

function createDataSource(input: {
  blueprint?: ReturnType<typeof templateBlueprint> & {
    logicalGroupElementIds?: string[];
  };
  deckElements?: unknown[];
  deckSlides?: unknown[];
  deckSlideIds?: string[];
  deckVersion: number;
  syncedVersion: number;
  operations: unknown[];
  onBlueprintUpdate?: (blueprint: Record<string, unknown>) => boolean;
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
    if (sql.includes("FROM template_blueprints")) {
      return [
        {
          template_id: "template_a",
          blueprint_json:
            input.blueprint ?? templateBlueprint(input.syncedVersion),
          quality_report_json: {},
        },
      ];
    }
    if (sql.includes("SELECT deck_json, version")) {
      const slideIds =
        input.deckSlideIds ??
        (input.blueprint?.slides.length === 3
          ? ["slide_ooxml_file_1", "slide_ooxml_file_2", "slide_ooxml_file_3"]
          : ["slide_1"]);
      return [
        {
          deck_json: {
            deckId: "deck_a",
            projectId: "project-a",
            title: "Imported deck",
            version: input.deckVersion,
            metadata: { sourceType: "import" },
            canvas: {
              preset: "wide-16-9",
              width: 1920,
              height: 1080,
              aspectRatio: "16:9",
            },
            slides:
              input.deckSlides ??
              slideIds.map((slideId, index) => ({
                slideId,
                order: index + 1,
                title: `Slide ${index + 1}`,
                elements: index === 0 ? (input.deckElements ?? []) : [],
              })),
          },
          version: input.deckVersion,
        },
      ];
    }
    if (sql.includes("FROM project_assets") && sql.includes("ANY($1)")) {
      return [
        {
          file_id: "file_image",
          project_id: "project-a",
          storage_key: "projects/project-a/assets/image.png",
          mime_type: "image/png",
          status: "uploaded",
        },
      ];
    }
    if (sql.includes("FROM project_assets")) {
      return [
        {
          file_id: "file_current",
          project_id: "project-a",
          storage_key: "projects/project-a/assets/current.pptx",
          mime_type: pptxMimeType,
          original_name: "current.pptx",
          size: 12,
          purpose: "design-asset",
          status: "uploaded",
        },
      ];
    }
    if (sql.includes("FROM deck_patches")) {
      return [{ operations: input.operations }];
    }
    if (sql.includes("INSERT INTO project_assets")) return [];
    if (sql.includes("UPDATE template_blueprints")) {
      const accepted =
        input.onBlueprintUpdate?.(params[3] as Record<string, unknown>) ?? true;
      return accepted ? [{ template_id: "template_a" }] : [];
    }
    if (sql.includes("DELETE FROM deck_patches")) return [];
    return [];
  });
  const manager = { query };
  const dataSource = {
    query,
    transaction: vi.fn(async (callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
  } as unknown as DataSource;
  return { dataSource, query };
}

function templateBlueprint(syncedVersion: number) {
  return {
    templateId: "template_a",
    sourceFileId: "file_source",
    sourcePackageFileId: "file_source",
    currentPackageFileId: "file_current",
    ooxmlSyncedDeckVersion: syncedVersion,
    slides: [
      {
        slideId: "slide_1",
        slideIndex: 1,
        sourceSlideIndex: 1,
        sourceSlidePart: "ppt/slides/slide1.xml",
        renderAssetFileId: "file_render_1",
        elementSources: [
          {
            elementId: "el_title",
            slidePart: "ppt/slides/slide1.xml",
            shapeId: "2",
            sourceType: "slide",
            writable: true,
          },
          {
            elementId: "el_image",
            slidePart: "ppt/slides/slide1.xml",
            shapeId: "3",
            relationshipId: "rId2",
            sourceType: "image",
            writable: true,
          },
        ],
        slots: [],
      },
    ],
  };
}

function reorderTemplateBlueprint(syncedVersion: number) {
  const blueprint = templateBlueprint(syncedVersion);
  blueprint.slides = Array.from({ length: 3 }, (_, index) => ({
    slideId: `slide_ooxml_file_${index + 1}`,
    slideIndex: index + 1,
    sourceSlideIndex: index + 1,
    sourceSlidePart: `ppt/slides/slide${index + 1}.xml`,
    renderAssetFileId: `file_render_${index + 1}`,
    ooxmlOrigin: "imported" as const,
    elementSources:
      index === 0
        ? [
            {
              elementId: "el_title",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "2",
              sourceType: "slide" as const,
              writable: true,
            },
          ]
        : [],
    slots: [],
  }));
  return blueprint;
}

function tableElementSource(
  elementId: string,
  rowCount: number,
  columnCount: number,
) {
  return {
    elementId,
    elementType: "table" as const,
    ooxmlOrigin: "authored" as const,
    ooxmlEditCapabilities: {
      richText: "none" as const,
      crop: "none" as const,
      tableCellText: true,
      frame: true,
      delete: true,
      imageSource: false,
    },
    slidePart: "ppt/slides/slide1.xml",
    shapeId: "9",
    sourceType: "table" as const,
    writable: true,
    tableCellLocators: Array.from(
      { length: rowCount * columnCount },
      (_, index) => ({
        rowIndex: Math.floor(index / columnCount),
        columnIndex: index % columnCount,
        fingerprint: index.toString(16).padStart(64, "0"),
      }),
    ),
  };
}

function workerResponse(
  appliedOperations: Array<{
    operationType:
      | "add_element"
      | "add_slide"
      | "update_element_frame"
      | "update_element_props"
      | "delete_element"
      | "reorder_slides";
    slideId?: string;
    elementId?: string;
  }> = [],
) {
  return {
    assets: [
      {
        assetId: "current_package",
        fileName: "current.pptx",
        mimeType: pptxMimeType,
        contentBase64: Buffer.from("pptx").toString("base64"),
      },
    ],
    elementSources: [],
    appliedOperations,
    unsupportedOperations: [],
    warnings: [],
  };
}

function jobRow(
  status: "running" | "succeeded" | "failed",
  progress: number,
  result: Record<string, unknown> | null,
  error: { code: string; message: string } | null,
) {
  return {
    job_id: "job-sync",
    project_id: "project-a",
    type: "pptx-ooxml-sync",
    status,
    progress,
    message: status,
    result,
    error,
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:01.000Z",
  };
}
