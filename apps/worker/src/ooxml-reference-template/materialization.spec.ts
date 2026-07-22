import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { publishOoxmlReferenceMaterialization } from "./materialization";

const sourceSha256 = "a".repeat(64);
const templateSnapshot = {
  catalogTemplateId: "operating-review",
  catalogTemplateVersion: 1,
  sourceSha256,
  sourceSlideIds: ["cover-01", "closing-02"],
  slotAssignmentCount: 1,
};

function deckFixture() {
  return {
    deckId: "deck_reference_generation_1",
    projectId: "project_1",
    title: "2026 하반기 운영 리뷰",
    version: 1,
    metadata: {
      language: "ko",
      locale: "ko-KR",
      createdFrom: {
        topic: "2026 하반기 운영 리뷰",
        references: [],
        designReferences: [],
      },
    },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_reference_1",
        ooxmlOrigin: "imported",
        ooxmlSourceSlidePart: "ppt/slides/slide1.xml",
        order: 1,
        title: "운영 리뷰",
        thumbnailUrl: "/assets/render-1",
        style: {},
        speakerNotes: "",
        elements: [],
        keywords: [],
        animations: [],
        aiNotes: { emphasisPoints: [], sourceEvidence: [] },
      },
    ],
  };
}

function blueprintFixture() {
  return {
    templateId: "template_reference_generation_1",
    sourceFileId: "file_reference_baseline",
    sourcePackageFileId: "file_reference_baseline",
    currentPackageFileId: "file_reference_current",
    referenceTemplateSnapshot: templateSnapshot,
    slotEditPolicies: [
      {
        slotId: "operating-review-v1-slide-01-title",
        elementId: "el_title",
        mutationPolicy: ["text-content"],
        frameLocked: true,
      },
    ],
    slides: [
      {
        slideId: "slide_reference_1",
        slideIndex: 1,
        sourceSlideIndex: 1,
        sourceSlidePart: "ppt/slides/slide1.xml",
        elementSources: [
          {
            elementId: "el_title",
            slidePart: "ppt/slides/slide1.xml",
            shapeId: "2",
            sourceType: "placeholder",
            writable: true,
          },
        ],
        slots: [],
      },
    ],
  };
}

type PublishedState = {
  projectAssets: Map<string, unknown>;
  decks: Map<string, unknown>;
  blueprints: Map<string, unknown>;
};

function transactionalRepository(options: { failBlueprint?: boolean } = {}) {
  const state: PublishedState = {
    projectAssets: new Map(),
    decks: new Map(),
    blueprints: new Map(),
  };
  const transaction = vi.fn(
    async (
      run: (manager: {
        query: (sql: string, params: unknown[]) => Promise<unknown[]>;
      }) => Promise<unknown>,
    ) => {
      const pending: PublishedState = {
        projectAssets: new Map(state.projectAssets),
        decks: new Map(state.decks),
        blueprints: new Map(state.blueprints),
      };
      const manager = {
        query: vi.fn(async (sql: string, params: unknown[]) => {
          if (sql.includes("INSERT INTO project_assets")) {
            pending.projectAssets.set(String(params[0]), params);
          }
          if (sql.includes("INSERT INTO decks")) {
            pending.decks.set(String(params[1]), params[2]);
          }
          if (sql.includes("INSERT INTO template_blueprints")) {
            if (options.failBlueprint) {
              throw new Error("blueprint publication failed");
            }
            pending.blueprints.set(String(params[0]), params[4]);
          }
          return [];
        }),
      };
      const result = await run(manager);
      state.projectAssets = pending.projectAssets;
      state.decks = pending.decks;
      state.blueprints = pending.blueprints;
      return result;
    },
  );
  return {
    state,
    dataSource: { transaction } as unknown as DataSource,
    transaction,
  };
}

function publicationInput() {
  return {
    projectId: "project_1",
    generationId: "job_ooxml_reference_1",
    deck: deckFixture(),
    templateBlueprint: blueprintFixture(),
    templateSnapshot,
    baselinePackage: {
      fileId: "file_reference_baseline",
      storageKey: "projects/project_1/design-assets/baseline.pptx",
      originalName: "reference-baseline.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1024,
    },
    currentPackage: {
      fileId: "file_reference_current",
      storageKey: "projects/project_1/design-assets/current.pptx",
      originalName: "reference-current.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1024,
    },
    qualityReport: {
      compositeScore: 100,
      metrics: {
        geometry: 100,
        text: 100,
        color: 100,
        layer: 100,
        editability: 100,
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
      editabilityCoverage: 1,
      appliedCap: null,
      slideReports: [],
      notes: [],
    },
  };
}

describe("publishOoxmlReferenceMaterialization", () => {
  it("publishes exact AI/import snapshots with baseline and current package in one transaction", async () => {
    const repository = transactionalRepository();
    const eventSink = { info: vi.fn() };

    await publishOoxmlReferenceMaterialization(
      repository.dataSource,
      publicationInput(),
      eventSink,
    );

    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.state.projectAssets.size).toBe(2);
    const deck = repository.state.decks.get(
      "deck_reference_generation_1",
    ) as ReturnType<typeof deckFixture>;
    expect(deck.metadata).toMatchObject({
      sourceType: "import",
      generatedBy: "ai",
      ooxmlReferenceTemplateSnapshot: {
        catalogTemplateId: "operating-review",
        catalogTemplateVersion: 1,
        sourceSha256,
        generationId: "job_ooxml_reference_1",
      },
      createdFrom: { designReferences: [] },
    });
    const blueprint = repository.state.blueprints.get(
      "template_reference_generation_1",
    ) as ReturnType<typeof blueprintFixture>;
    expect(blueprint.referenceTemplateSnapshot).toEqual(templateSnapshot);
    expect(blueprint.sourcePackageFileId).toBe("file_reference_baseline");
    expect(blueprint.currentPackageFileId).toBe("file_reference_current");
    expect(eventSink.info).toHaveBeenCalledWith({
      event: "ooxml_reference_materialization_published",
      projectId: "project_1",
      generationId: "job_ooxml_reference_1",
      deckId: "deck_reference_generation_1",
      templateId: "template_reference_generation_1",
      baselineFileId: "file_reference_baseline",
      currentFileId: "file_reference_current",
    });
  });

  it("rolls back assets, Deck, and TemplateBlueprint when any publication step fails", async () => {
    const repository = transactionalRepository({ failBlueprint: true });

    await expect(
      publishOoxmlReferenceMaterialization(
        repository.dataSource,
        publicationInput(),
      ),
    ).rejects.toThrow("blueprint publication failed");

    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.state.projectAssets.size).toBe(0);
    expect(repository.state.decks.size).toBe(0);
    expect(repository.state.blueprints.size).toBe(0);
  });
});
