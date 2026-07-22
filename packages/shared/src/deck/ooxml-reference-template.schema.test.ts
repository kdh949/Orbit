import { describe, expect, it } from "vitest";

import {
  ooxmlReferenceTemplateGenerationJobResultSchema,
  ooxmlReferenceTemplateGenerationJobPayloadSchema,
  ooxmlReferenceTemplateGenerationRequestSchema,
  ooxmlReferenceTemplateManifestSchema,
  ooxmlReferenceTemplatePreviewResponseSchema,
  ooxmlSourceSlideSchema,
  ooxmlTemplateFidelityReportSchema,
  ooxmlTemplateSelectionSchema,
  ooxmlTemplateSlotSchema,
  ooxmlTemplateSnapshotSchema
} from "./ooxml-reference-template.schema";

const sha256 = "a".repeat(64);

const createTextSlot = (overrides: Record<string, unknown> = {}) => ({
  slotId: "operating-review-v1-slide-01-title",
  semanticRole: "title",
  contentType: "text",
  required: true,
  locator: {
    slidePart: "ppt/slides/slide1.xml",
    shapeId: "2",
    placeholderType: "title",
    relationshipId: null
  },
  capacity: { maxChars: 80, maxLines: 2 },
  mutationPolicy: ["text-content"],
  replacementPolicy: { overflow: "fail" },
  ...overrides
});

const createSourceSlide = (overrides: Record<string, unknown> = {}) => ({
  sourceSlideId: "cover-01",
  sourceSlidePart: "ppt/slides/slide1.xml",
  sourceOrder: 1,
  semanticRole: "cover",
  relationships: {
    layoutPart: "ppt/slideLayouts/slideLayout1.xml",
    masterPart: "ppt/slideMasters/slideMaster1.xml",
    themePart: "ppt/theme/theme1.xml"
  },
  capacity: {
    textSlotCount: 1,
    imageSlotCount: 0,
    tableSlotCount: 0,
    chartSlotCount: 0
  },
  previewId: "cover",
  lockedInventorySha256: sha256,
  slots: [createTextSlot()],
  ...overrides
});

const createManifest = (overrides: Record<string, unknown> = {}) => ({
  templateId: "operating-review",
  version: 1,
  status: "active",
  sourceFormat: "pptx",
  sourceSha256: sha256,
  slideCount: 2,
  canvas: {
    aspectRatio: "16:9",
    widthEmu: 12_192_000,
    heightEmu: 6_858_000
  },
  name: "Operating Review",
  description: "경영 보고와 KPI 중심",
  preview: {
    coverPreviewId: "cover",
    coverPreviewSha256: sha256,
    bodyPreviewId: "body",
    bodyPreviewSha256: sha256
  },
  sourceSlides: [
    createSourceSlide(),
    createSourceSlide({
      sourceSlideId: "closing-02",
      sourceSlidePart: "ppt/slides/slide2.xml",
      sourceOrder: 2,
      semanticRole: "closing",
      previewId: "body",
      slots: []
    })
  ],
  provenance: { authorizationStatus: "approved", inventoryVersion: 1 },
  ...overrides
});

const templateSnapshot = {
  catalogTemplateId: "operating-review",
  catalogTemplateVersion: 1,
  sourceSha256: sha256,
  sourceSlideIds: ["cover-01", "closing-02"],
  slotAssignmentCount: 1
};

const fidelityReport = {
  status: "passed",
  structuralGate: { passed: true, issueCodes: [] },
  identityControl: {
    status: "passed",
    evaluatedSlideCount: 2,
    packageWarningCount: 0,
    lockedGeometryDriftCount: 0
  },
  generatedComparison: {
    status: "passed",
    evaluatedSlideCount: 2,
    lockedRegionDriftCount: 0,
    slotOverflowCount: 0
  },
  warningCodes: []
};

describe("OOXML reference template manifest contract", () => {
  it("accepts an active manifest with cover, closing, previews and an editable slot", () => {
    const manifest = ooxmlReferenceTemplateManifestSchema.parse(
      createManifest()
    );

    expect(manifest.sourceSlides.map((slide) => slide.semanticRole)).toEqual([
      "cover",
      "closing"
    ]);
    expect(manifest.sourceSlides[0].slots[0].mutationPolicy).toEqual([
      "text-content"
    ]);
  });

  it("rejects duplicate source slide IDs and source slide parts", () => {
    const duplicateId = createManifest({
      sourceSlides: [
        createSourceSlide(),
        createSourceSlide({ sourceOrder: 2, semanticRole: "closing" })
      ]
    });
    const duplicatePart = createManifest({
      sourceSlides: [
        createSourceSlide(),
        createSourceSlide({
          sourceSlideId: "closing-02",
          sourceOrder: 2,
          semanticRole: "closing"
        })
      ]
    });

    expect(ooxmlReferenceTemplateManifestSchema.safeParse(duplicateId).success).toBe(
      false
    );
    expect(
      ooxmlReferenceTemplateManifestSchema.safeParse(duplicatePart).success
    ).toBe(false);
  });

  it("rejects duplicate slot IDs and duplicate authoritative locators", () => {
    const duplicateSlotId = createManifest({
      sourceSlides: [
        createSourceSlide({
          slots: [
            createTextSlot(),
            createTextSlot({
              locator: {
                slidePart: "ppt/slides/slide1.xml",
                shapeId: "3",
                placeholderType: "body",
                relationshipId: null
              }
            })
          ]
        }),
        createSourceSlide({
          sourceSlideId: "closing-02",
          sourceSlidePart: "ppt/slides/slide2.xml",
          sourceOrder: 2,
          semanticRole: "closing",
          slots: []
        })
      ]
    });
    const duplicateLocator = createManifest({
      sourceSlides: [
        createSourceSlide({
          slots: [
            createTextSlot(),
            createTextSlot({
              slotId: "operating-review-v1-slide-01-subtitle"
            })
          ]
        }),
        createSourceSlide({
          sourceSlideId: "closing-02",
          sourceSlidePart: "ppt/slides/slide2.xml",
          sourceOrder: 2,
          semanticRole: "closing",
          slots: []
        })
      ]
    });

    expect(
      ooxmlReferenceTemplateManifestSchema.safeParse(duplicateSlotId).success
    ).toBe(false);
    expect(
      ooxmlReferenceTemplateManifestSchema.safeParse(duplicateLocator).success
    ).toBe(false);
  });

  it("rejects incomplete slot locators and non-positive text capacity", () => {
    const incompleteLocator = createTextSlot({
      locator: {
        slidePart: "ppt/slides/slide1.xml",
        placeholderType: "title",
        relationshipId: null
      }
    });
    const invalidCapacity = createTextSlot({
      capacity: { maxChars: 0, maxLines: 0 }
    });

    expect(ooxmlTemplateSlotSchema.safeParse(incompleteLocator).success).toBe(
      false
    );
    expect(ooxmlTemplateSlotSchema.safeParse(invalidCapacity).success).toBe(
      false
    );
  });

  it("rejects an active manifest without cover, closing or editable slots", () => {
    const noCover = createManifest({
      sourceSlides: [
        createSourceSlide({
          sourceSlideId: "body-01",
          semanticRole: "statement"
        }),
        createSourceSlide({
          sourceSlideId: "closing-02",
          sourceSlidePart: "ppt/slides/slide2.xml",
          sourceOrder: 2,
          semanticRole: "closing",
          slots: []
        })
      ]
    });
    const noClosing = createManifest({
      sourceSlides: [createSourceSlide()]
    });
    const noEditableSlots = createManifest({
      sourceSlides: [
        createSourceSlide({ slots: [] }),
        createSourceSlide({
          sourceSlideId: "closing-02",
          sourceSlidePart: "ppt/slides/slide2.xml",
          sourceOrder: 2,
          semanticRole: "closing",
          slots: []
        })
      ]
    });

    expect(ooxmlReferenceTemplateManifestSchema.safeParse(noCover).success).toBe(
      false
    );
    expect(
      ooxmlReferenceTemplateManifestSchema.safeParse(noClosing).success
    ).toBe(false);
    expect(
      ooxmlReferenceTemplateManifestSchema.safeParse(noEditableSlots).success
    ).toBe(false);
  });
});

describe("OOXML reference template selection and generation contracts", () => {
  it("requires an exact template ID and version for user selection", () => {
    expect(
      ooxmlTemplateSelectionSchema.safeParse({
        mode: "user",
        templateId: "operating-review",
        version: 1
      }).success
    ).toBe(true);
    expect(
      ooxmlTemplateSelectionSchema.safeParse({
        mode: "user",
        version: 1
      }).success
    ).toBe(false);
    expect(
      ooxmlTemplateSelectionSchema.safeParse({
        mode: "user",
        templateId: "operating-review"
      }).success
    ).toBe(false);
  });

  it("accepts auto selection only without a pinned template", () => {
    expect(ooxmlTemplateSelectionSchema.safeParse({ mode: "auto" }).success).toBe(
      true
    );
    expect(
      ooxmlTemplateSelectionSchema.safeParse({
        mode: "auto",
        templateId: "operating-review",
        version: 1
      }).success
    ).toBe(false);
  });

  it("accepts the separate generation request without GenerateDeck design selectors", () => {
    const request = ooxmlReferenceTemplateGenerationRequestSchema.parse({
      topic: "2026 하반기 운영 리뷰",
      prompt: "핵심 KPI와 실행 과제를 정리",
      targetDurationMinutes: 10,
      slideCountRange: { min: 8, max: 10 },
      metadata: {
        audience: "executive",
        purpose: "report",
        tone: "professional"
      },
      referencePolicy: "references-first",
      referenceFileIds: ["file_1"],
      templateSelection: {
        mode: "user",
        templateId: "operating-review",
        version: 1
      }
    });

    expect(request.templateSelection).toEqual({
      mode: "user",
      templateId: "operating-review",
      version: 1
    });
  });

  it.each([
    ["general generation mode", { generationMode: "ooxml-reference" }],
    ["design object", { design: { stylePackId: "brandlogy-modern" } }],
    ["style pack", { stylePackId: "brandlogy-modern" }],
    ["palette override", { paletteOverride: { primary: "#2563EB" } }],
    ["font override", { fontOverride: { fontId: "pretendard" } }],
    ["template blueprint", { templateBlueprintId: "template_file_1" }],
    ["design references", { designReferences: [{ fileId: "file_1" }] }],
    ["recipe selector", { slidePresetId: "process-horizontal" }]
  ])("rejects forbidden %s input", (_name, forbiddenInput) => {
    const result = ooxmlReferenceTemplateGenerationRequestSchema.safeParse({
      topic: "운영 리뷰",
      templateSelection: {
        mode: "user",
        templateId: "operating-review",
        version: 1
      },
      ...forbiddenInput
    });

    expect(result.success).toBe(false);
  });
});

describe("OOXML reference template result and preview contracts", () => {
  it("accepts a strict identifier-and-request generation job payload", () => {
    const payload = ooxmlReferenceTemplateGenerationJobPayloadSchema.parse({
      jobId: "job_ooxml_reference_1",
      projectId: "project_1",
      request: {
        topic: "2026 하반기 운영 리뷰",
        slideCountRange: { min: 8, max: 10 },
        templateSelection: {
          mode: "user",
          templateId: "operating-review",
          version: 1,
        },
      },
    });

    expect(payload.request.templateSelection).toEqual({
      mode: "user",
      templateId: "operating-review",
      version: 1,
    });
    expect(payload).not.toHaveProperty("sourceText");
  });

  it.each([
    { unexpectedContractField: true },
    { sourceText: "private source" },
    { rawPackageXml: "<xml />" },
  ])("rejects private or unknown generation job payload fields", (extra) => {
    expect(
      ooxmlReferenceTemplateGenerationJobPayloadSchema.safeParse({
        jobId: "job_ooxml_reference_1",
        projectId: "project_1",
        request: {
          topic: "운영 리뷰",
          slideCountRange: { min: 8, max: 10 },
          templateSelection: {
            mode: "user",
            templateId: "operating-review",
            version: 1,
          },
        },
        ...extra,
      }).success,
    ).toBe(false);
  });

  it("accepts a bounded reproducibility snapshot and fidelity report", () => {
    expect(ooxmlTemplateSnapshotSchema.safeParse(templateSnapshot).success).toBe(
      true
    );
    expect(
      ooxmlTemplateFidelityReportSchema.safeParse(fidelityReport).success
    ).toBe(true);
  });

  it("rejects duplicate source slide IDs in a snapshot", () => {
    expect(
      ooxmlTemplateSnapshotSchema.safeParse({
        ...templateSnapshot,
        sourceSlideIds: ["cover-01", "cover-01"]
      }).success
    ).toBe(false);
  });

  it("accepts a bounded job result without source text, assignments or package XML", () => {
    const result = ooxmlReferenceTemplateGenerationJobResultSchema.parse({
      deckId: "deck_ooxml_reference_job_1",
      templateId: "template_job_1",
      currentPackageFileId: "file_current_package",
      renderAssetFileIds: ["file_slide_1", "file_slide_2"],
      templateSnapshot,
      fidelityReport,
      warningCodes: []
    });

    expect(result.templateSnapshot.sourceSha256).toBe(sha256);
    expect(result).not.toHaveProperty("slotAssignments");
  });

  it.each(["sourceText", "slotAssignments", "rawXml", "storageKey", "signedUrl"])(
    "rejects sensitive or private result field %s",
    (field) => {
      expect(
        ooxmlReferenceTemplateGenerationJobResultSchema.safeParse({
          deckId: "deck_ooxml_reference_job_1",
          templateId: "template_job_1",
          currentPackageFileId: "file_current_package",
          renderAssetFileIds: ["file_slide_1"],
          templateSnapshot,
          fidelityReport,
          warningCodes: [],
          [field]: "private"
        }).success
      ).toBe(false);
    }
  );

  it("accepts only an ordered, read-only generation preview projection", () => {
    const preview = ooxmlReferenceTemplatePreviewResponseSchema.parse({
      jobId: "job_1",
      projectId: "project_1",
      status: "rendering",
      progress: 50,
      editable: false,
      outline: [
        { order: 1, title: "운영 리뷰" },
        { order: 2, title: "요약" }
      ],
      completedSlides: [
        {
          slideId: "slide_1",
          order: 1,
          renderAssetFileId: "file_slide_1"
        }
      ],
      pendingSlideOrders: [2],
      deckId: null,
      updatedAt: "2026-07-22T01:00:00.000Z",
      error: null
    });

    expect(preview.editable).toBe(false);
    expect(preview.completedSlides.map((slide) => slide.order)).toEqual([1]);
  });

  it("rejects editable or out-of-order preview projections", () => {
    const basePreview = {
      jobId: "job_1",
      projectId: "project_1",
      status: "rendering",
      progress: 50,
      editable: false,
      outline: [
        { order: 1, title: "운영 리뷰" },
        { order: 2, title: "요약" }
      ],
      completedSlides: [
        {
          slideId: "slide_2",
          order: 2,
          renderAssetFileId: "file_slide_2"
        }
      ],
      pendingSlideOrders: [1],
      deckId: null,
      updatedAt: "2026-07-22T01:00:00.000Z",
      error: null
    };

    expect(
      ooxmlReferenceTemplatePreviewResponseSchema.safeParse({
        ...basePreview,
        editable: true
      }).success
    ).toBe(false);
    expect(
      ooxmlReferenceTemplatePreviewResponseSchema.safeParse(basePreview).success
    ).toBe(false);
  });
});

describe("OOXML reference template schemas are strict", () => {
  it.each([
    [ooxmlReferenceTemplateManifestSchema, createManifest()],
    [ooxmlSourceSlideSchema, createSourceSlide()],
    [ooxmlTemplateSlotSchema, createTextSlot()],
    [
      ooxmlTemplateSelectionSchema,
      { mode: "user", templateId: "operating-review", version: 1 }
    ],
    [ooxmlTemplateSnapshotSchema, templateSnapshot],
    [ooxmlTemplateFidelityReportSchema, fidelityReport],
    [
      ooxmlReferenceTemplateGenerationRequestSchema,
      {
        topic: "운영 리뷰",
        templateSelection: {
          mode: "user",
          templateId: "operating-review",
          version: 1
        }
      }
    ],
    [
      ooxmlReferenceTemplateGenerationJobResultSchema,
      {
        deckId: "deck_ooxml_reference_job_1",
        templateId: "template_job_1",
        currentPackageFileId: "file_current_package",
        renderAssetFileIds: ["file_slide_1"],
        templateSnapshot,
        fidelityReport,
        warningCodes: []
      }
    ],
    [
      ooxmlReferenceTemplatePreviewResponseSchema,
      {
        jobId: "job_1",
        projectId: "project_1",
        status: "planning",
        progress: 10,
        editable: false,
        outline: [],
        completedSlides: [],
        pendingSlideOrders: [],
        deckId: null,
        updatedAt: "2026-07-22T01:00:00.000Z",
        error: null
      }
    ]
  ])("rejects unknown fields", (schema, payload) => {
    expect(
      schema.safeParse({ ...payload, unexpectedContractField: true }).success
    ).toBe(false);
  });
});
