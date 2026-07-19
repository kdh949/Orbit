import { describe, expect, it } from "vitest";

import {
  pptxOoxmlGenerationJobResultSchema,
  pptxOoxmlGenerationRequestSchema,
  pptxOoxmlSyncJobResultSchema,
  pptxImportJobResultSchema,
  qualityReportSchema,
  recoverTemplateBlueprintSlideIds,
  templateBlueprintSchema,
} from "../index";

const qualityReport = {
  compositeScore: 84,
  metrics: {
    geometry: 90,
    text: 80,
    color: 85,
    layer: 90,
    editability: 70,
    pixelSimilarity: null,
  },
  weights: {
    geometry: 25,
    text: 15,
    color: 10,
    layer: 10,
    editability: 10,
    pixelSimilarity: 30,
  },
  editabilityCoverage: 0.7,
  appliedCap: null,
  notes: ["pixel renderer unavailable"],
};

describe("templateBlueprintSchema", () => {
  it("accepts replaceable content and media slots without changing deck elements", () => {
    const blueprint = templateBlueprintSchema.parse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          slideRole: "cover",
          layoutType: "title",
          contentCapacity: "medium",
          selectionReason: "cover title matched",
          slots: [
            {
              elementId: "el_title",
              usage: "content-slot",
              slotRole: "title",
              replaceMode: "replace",
              confidence: 0.95,
              bounds: { x: 120, y: 80, width: 800, height: 120 },
              source: {
                type: "placeholder",
                placeholderType: "title",
                slidePart: "ppt/slides/slide1.xml",
                shapeId: "2",
              },
            },
            {
              elementId: "el_logo",
              usage: "decoration",
              slotRole: "logo",
              replaceMode: "ignore",
              confidence: 0.8,
              bounds: { x: 1600, y: 40, width: 200, height: 80 },
              source: { type: "master", name: "Logo" },
            },
          ],
        },
      ],
    });

    expect(blueprint.slides[0].slots[0].usage).toBe("content-slot");
    expect(blueprint.slides[0].slideRole).toBe("cover");
  });

  it("accepts OOXML package tracking fields", () => {
    const blueprint = templateBlueprintSchema.parse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      sourcePackageFileId: "file_1",
      currentPackageFileId: "file_current",
      ooxmlSyncedDeckVersion: 2,
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          sourceSlidePart: "ppt/slides/slide1.xml",
          ooxmlOrigin: "imported",
          renderAssetFileId: "file_slide_1",
          fallbackRenderAssetFileId: "file_fallback_1",
          elementSources: [
            {
              elementId: "el_title",
              elementType: "text",
              ooxmlOrigin: "imported",
              ooxmlEditCapabilities: {
                richText: "none",
                crop: "none",
                tableCellText: false,
                frame: true,
                delete: false,
                imageSource: false,
              },
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "2",
              sourceType: "placeholder",
              writable: true,
            },
          ],
          slots: [],
        },
      ],
    });

    expect(blueprint.currentPackageFileId).toBe("file_current");
    expect(blueprint.ooxmlSyncedDeckVersion).toBe(2);
    expect(blueprint.slides[0].renderAssetFileId).toBe("file_slide_1");
    expect(blueprint.slides[0].ooxmlOrigin).toBe("imported");
    expect(
      blueprint.slides[0].elementSources[0]?.ooxmlEditCapabilities?.frame,
    ).toBe(true);
    expect(blueprint.slides[0].elementSources[0]?.writable).toBe(true);
  });

  it("keeps OOXML provenance optional for existing blueprints", () => {
    const blueprint = templateBlueprintSchema.parse({
      templateId: "template_legacy",
      sourceFileId: "file_legacy",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_legacy",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "2",
              sourceType: "shape",
              writable: true,
            },
          ],
          slots: [],
        },
      ],
    });

    expect(blueprint.slides[0].ooxmlOrigin).toBeUndefined();
    expect(
      blueprint.slides[0].elementSources[0]?.ooxmlEditCapabilities,
    ).toBeUndefined();
  });

  it("rejects writable motion capability without an unambiguous slide locator", () => {
    const withoutLocator = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          ooxmlMotionCapabilities: {
            transitionWritable: true,
            importedMainSequenceCoverage: "partial",
          },
        },
      ],
    });
    expect(withoutLocator.success).toBe(false);

    const duplicateLocator = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [1, 2].map((slideIndex) => ({
        slideIndex,
        sourceSlideIndex: slideIndex,
        sourceSlidePart: "ppt/slides/slide1.xml",
        ooxmlMotionCapabilities: {
          transitionWritable: false,
          importedMainSequenceCoverage: "complete",
        },
      })),
    });
    expect(duplicateLocator.success).toBe(false);
  });

  it("derives a writable motion slide locator from one authoritative element source", () => {
    const parsed = templateBlueprintSchema.parse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          ooxmlMotionCapabilities: {
            transitionWritable: true,
            importedMainSequenceCoverage: "complete",
          },
          elementSources: [
            {
              elementId: "el_title",
              elementType: "text",
              slidePart: "ppt/slides/slide7.xml",
              shapeId: "2",
              sourceType: "shape",
              writable: true,
            },
          ],
        },
      ],
    });

    expect(parsed.slides[0]?.sourceSlidePart).toBe("ppt/slides/slide7.xml");
  });

  it("rejects a writable locator shared with a non-writable motion slide", () => {
    const parsed = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          sourceSlidePart: "ppt/slides/slide1.xml",
          ooxmlMotionCapabilities: {
            transitionWritable: true,
            importedMainSequenceCoverage: "complete",
          },
        },
        {
          slideIndex: 2,
          sourceSlideIndex: 2,
          sourceSlidePart: "ppt/slides/slide1.xml",
          ooxmlMotionCapabilities: {
            transitionWritable: false,
            importedMainSequenceCoverage: "partial",
          },
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts bounded row-major table cell locators", () => {
    const blueprint = templateBlueprintSchema.parse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              elementType: "table",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 0,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
                {
                  rowIndex: 0,
                  columnIndex: 1,
                  fingerprint: "b".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(blueprint.slides[0].elementSources[0]?.tableCellLocators).toEqual([
      { rowIndex: 0, columnIndex: 0, fingerprint: "a".repeat(64) },
      { rowIndex: 0, columnIndex: 1, fingerprint: "b".repeat(64) },
    ]);
  });

  it("rejects duplicate table cell coordinates", () => {
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 0,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
                {
                  rowIndex: 0,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects table cell locators that are not in row-major order", () => {
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              elementType: "table",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 1,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
                {
                  rowIndex: 0,
                  columnIndex: 1,
                  fingerprint: "b".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects table cell locators that do not start at the origin", () => {
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              elementType: "table",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 0,
                  columnIndex: 1,
                  fingerprint: "a".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects table cell locator column gaps", () => {
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              elementType: "table",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 0,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
                {
                  rowIndex: 0,
                  columnIndex: 2,
                  fingerprint: "b".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects jagged table cell locator rows", () => {
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              elementType: "table",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 0,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
                {
                  rowIndex: 0,
                  columnIndex: 1,
                  fingerprint: "b".repeat(64),
                },
                {
                  rowIndex: 1,
                  columnIndex: 0,
                  fingerprint: "c".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects table cell locators on a non-table source", () => {
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_title",
              elementType: "text",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "2",
              sourceType: "shape",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 0,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["missing locators", { tableCellLocators: undefined }],
    ["read-only source", { writable: false }],
    ["fallback source", { fallbackReason: "render fallback" }],
    ["wrong element type", { elementType: "text" }],
    ["wrong source type", { sourceType: "shape" }],
  ])("rejects table cell text capability with a %s", (_, sourceOverride) => {
    const tableCellLocators = [
      {
        rowIndex: 0,
        columnIndex: 0,
        fingerprint: "a".repeat(64),
      },
    ];
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              elementType: "table",
              ooxmlEditCapabilities: {
                richText: "none",
                crop: "none",
                tableCellText: true,
              },
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators,
              ...sourceOverride,
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects table cell locators outside the bounded grid", () => {
    const result = templateBlueprintSchema.safeParse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          elementSources: [
            {
              elementId: "el_table",
              slidePart: "ppt/slides/slide1.xml",
              shapeId: "7",
              sourceType: "table",
              writable: true,
              tableCellLocators: [
                {
                  rowIndex: 1000,
                  columnIndex: 0,
                  fingerprint: "a".repeat(64),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("qualityReportSchema", () => {
  it("allows a missing pixel similarity score", () => {
    const parsed = qualityReportSchema.parse(qualityReport);

    expect(parsed.metrics.pixelSimilarity).toBeNull();
    expect(parsed.slideReports).toEqual([]);
  });

  it("accepts slide-level vectorization failure reports", () => {
    const parsed = qualityReportSchema.parse({
      ...qualityReport,
      metrics: {
        ...qualityReport.metrics,
        pixelSimilarity: 91,
      },
      slideReports: [
        {
          slideIndex: 1,
          status: "passed",
          ssim: 0.97,
          reasons: [],
        },
        {
          slideIndex: 2,
          status: "vectorization_failed",
          ssim: 0.91,
          reasons: ["gradient fill mismatch", "unsupported blur effect"],
          fallback: "rendered-background",
        },
      ],
    });

    expect(parsed.slideReports[1]).toMatchObject({
      status: "vectorization_failed",
      fallback: "rendered-background",
    });
  });

  it("accepts bounded aggregate motion diagnostics", () => {
    const parsed = qualityReportSchema.parse({
      ...qualityReport,
      motionDiagnostics: {
        total: 20,
        unsupported: 2,
        downgraded: 15,
        unresolved: 1,
        excluded: 2,
        details: [
          {
            slideIndex: 8,
            code: "PPTX_MOTION_PARAGRAPH_BUILD_DOWNGRADED",
            count: 15,
          },
          {
            slideIndex: 8,
            code: "PPTX_MOTION_PRESET_UNSUPPORTED",
            count: 2,
          },
          {
            slideIndex: 8,
            code: "PPTX_MOTION_TARGET_UNRESOLVED",
            count: 1,
          },
          {
            slideIndex: 8,
            code: "PPTX_MOTION_MEDIA_EXCLUDED",
            count: 2,
          },
        ],
      },
    });

    expect(parsed.motionDiagnostics?.total).toBe(20);
    expect(parsed.motionDiagnostics?.details).toHaveLength(4);
  });

  it("rejects free-text or unbounded motion diagnostic details", () => {
    const base = {
      ...qualityReport,
      motionDiagnostics: {
        total: 1,
        unsupported: 1,
        downgraded: 0,
        unresolved: 0,
        excluded: 0,
      },
    };
    expect(
      qualityReportSchema.safeParse({
        ...base,
        motionDiagnostics: {
          ...base.motionDiagnostics,
          details: [
            {
              slideIndex: 1,
              code: "arbitrary user text",
              count: 1,
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      qualityReportSchema.safeParse({
        ...base,
        motionDiagnostics: {
          ...base.motionDiagnostics,
          details: Array.from({ length: 501 }, () => ({
            slideIndex: 1,
            code: "PPTX_MOTION_EFFECT_UNSUPPORTED",
            count: 1,
          })),
        },
      }).success,
    ).toBe(false);
  });
});

describe("pptxImportJobResultSchema", () => {
  it("validates the saved PPTX import job result contract", () => {
    const result = pptxImportJobResultSchema.parse({
      deckId: "deck_imported_1",
      templateId: "template_file_1",
      qualityReport,
      warnings: ["Unsupported chart was skipped"],
    });

    expect(result.qualityReport.compositeScore).toBe(84);
  });
});

describe("pptxOoxmlGeneration schemas", () => {
  it("validates request and job result contracts", () => {
    expect(
      pptxOoxmlGenerationRequestSchema.parse({
        fileId: "file_1",
      }),
    ).toEqual({ fileId: "file_1" });

    for (const field of ["topic", "prompt", "extraField"]) {
      expect(
        pptxOoxmlGenerationRequestSchema.safeParse({
          fileId: "file_1",
          [field]: "legacy value",
        }).success,
      ).toBe(false);
    }

    const result = pptxOoxmlGenerationJobResultSchema.parse({
      deckId: "deck_ooxml_1",
      templateId: "template_file_1",
      sourceFileId: "file_1",
      currentPackageFileId: "file_current",
      qualityReport,
      warnings: ["media slot preserved"],
    });

    expect(result.currentPackageFileId).toBe("file_current");
  });

  it("validates sync job result contracts", () => {
    const result = pptxOoxmlSyncJobResultSchema.parse({
      deckId: "deck_ooxml_1",
      templateId: "template_file_1",
      currentPackageFileId: "file_current",
      renderAssetFileIds: ["file_slide_1"],
      syncedDeckVersion: 2,
      warnings: [],
    });

    expect(result.syncedDeckVersion).toBe(2);
  });

  it("keeps logical group IDs as package-neutral blueprint sidecar data", () => {
    const blueprint = templateBlueprintSchema.parse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      logicalGroupElementIds: ["el_group_1"],
      slides: [{ slideIndex: 1, sourceSlideIndex: 1 }],
    });

    expect(blueprint.logicalGroupElementIds).toEqual(["el_group_1"]);
    expect(
      templateBlueprintSchema.parse({
        templateId: "template_file_legacy",
        sourceFileId: "file_legacy",
        slides: [{ slideIndex: 1, sourceSlideIndex: 1 }],
      }).logicalGroupElementIds,
    ).toEqual([]);
  });

  it("recovers legacy slide mappings from deck order without parsing slide IDs", () => {
    const blueprint = templateBlueprintSchema.parse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          sourceSlidePart: "ppt/slides/slide7.xml",
        },
        {
          slideIndex: 2,
          sourceSlideIndex: 2,
          sourceSlidePart: "ppt/slides/slide11.xml",
        },
      ],
    });

    const recovered = recoverTemplateBlueprintSlideIds(blueprint, [
      { slideId: "slide_cover", order: 1 },
      { slideId: "slide_appendix", order: 2 },
    ]);

    expect(recovered).toMatchObject({
      recovered: true,
      blueprint: {
        slides: [
          { slideId: "slide_cover", sourceSlidePart: "ppt/slides/slide7.xml" },
          {
            slideId: "slide_appendix",
            sourceSlidePart: "ppt/slides/slide11.xml",
          },
        ],
      },
    });
  });

  it("recovers legacy imported slide mappings when the deck has an authored slide", () => {
    const blueprint = templateBlueprintSchema.parse({
      templateId: "template_file_1",
      sourceFileId: "file_1",
      slides: [
        {
          slideIndex: 1,
          sourceSlideIndex: 1,
          sourceSlidePart: "ppt/slides/slide7.xml",
        },
        {
          slideIndex: 2,
          sourceSlideIndex: 2,
          sourceSlidePart: "ppt/slides/slide11.xml",
        },
      ],
    });

    const recovered = recoverTemplateBlueprintSlideIds(blueprint, [
      { slideId: "slide_cover", order: 1 },
      { slideId: "slide_appendix", order: 2 },
      { slideId: "slide_authored", order: 3 },
    ]);

    expect(recovered).toMatchObject({
      recovered: true,
      blueprint: {
        slides: [
          { slideId: "slide_cover", sourceSlidePart: "ppt/slides/slide7.xml" },
          {
            slideId: "slide_appendix",
            sourceSlidePart: "ppt/slides/slide11.xml",
          },
        ],
      },
    });
  });
});
