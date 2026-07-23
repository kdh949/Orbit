import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { OoxmlReferencePythonClientError } from "./ooxml-reference-template-generation.python-client";
import type { RunOoxmlReferencePythonStageInput } from "./ooxml-reference-template-generation.python-client";
import type { OoxmlReferencePythonStageArtifact } from "./ooxml-reference-template-generation.python-client";
import { processOoxmlReferenceTemplateGenerationJob } from "./ooxml-reference-template-generation.processor";

const now = "2026-07-22T00:00:00.000Z";
const payload = {
  jobId: "job_ooxml_reference_1",
  projectId: "project_1",
  request: {
    topic: "운영 리뷰",
    targetDurationMinutes: 10,
    slideCountRange: { min: 5, max: 8 },
    metadata: {
      audience: "general" as const,
      purpose: "inform" as const,
      tone: "professional" as const,
    },
    referencePolicy: "topic-only" as const,
    referenceFileIds: [],
    templateSelection: {
      mode: "user" as const,
      templateId: "operating-review-v1",
      version: 1,
    },
  },
};

describe("processOoxmlReferenceTemplateGenerationJob", () => {
  it("reuses immutable stages and publishes only after every fidelity gate passes", async () => {
    const database = fakeDatabase();
    const artifacts = fakeArtifacts([
      storedArtifact("reference-extract-file", { extracted: true }),
      storedArtifact("source-grounding", { grounded: true }),
    ]);
    const runStage = vi.fn(async (input: RunOoxmlReferencePythonStageInput) => {
      const artifact: JsonPayload =
        input.stage === "materialization"
          ? materializationArtifact()
          : input.stage === "render-validation"
            ? {
                fidelityReport: passedFidelityReport(),
                renderAssets: [
                  {
                    fileId: "file_render_001",
                    originalName: "slide-001.png",
                    size: 100,
                  },
                  {
                    fileId: "file_render_002",
                    originalName: "slide-002.png",
                    size: 100,
                  },
                ],
              }
          : { completedStage: input.stage };
      return {
        stage: input.stage,
        templateId: "operating-review-v1",
        templateVersion: 1,
        sourceSlideCount: 3,
        slotCount: 5,
        artifact,
        issueCodes: [],
      };
    });
    const publish = vi.fn(async () => {
      database.row.status = "succeeded";
      database.row.progress = 100;
      database.row.message = "OOXML reference template generation completed.";
      database.row.result = materializationArtifact().jobResult;
    });
    const eventSink = { info: vi.fn(), error: vi.fn() };

    const result = await processOoxmlReferenceTemplateGenerationJob(
      database.dataSource,
      "http://python-worker:8000",
      payload,
      { artifactRepository: artifacts, runStage, publish, eventSink },
    );

    expect(result.status).toBe("succeeded");
    expect(runStage).toHaveBeenCalledTimes(5);
    expect(runStage.mock.calls[0]?.[0].stage).toBe("content-planning");
    expect(runStage.mock.calls[0]?.[0].dependencies).toHaveLength(2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(artifacts.storeSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "publication" }),
      materializationArtifact().jobResult,
    );
    expect(artifacts.storeSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "slide-render", shardKey: "001" }),
      {
        slideId: "file_render_001",
        order: 1,
        renderAssetFileId: "file_render_001",
      },
    );
    expect(artifacts.storeSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "slide-render", shardKey: "002" }),
      {
        slideId: "file_render_002",
        order: 2,
        renderAssetFileId: "file_render_002",
      },
    );
    expect(eventSink.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ooxml-reference-template.job.succeeded",
        templateId: "operating-review-v1",
        templateVersion: 1,
        sourceSlideCount: 1,
        slotCount: 1,
      }),
    );
  });

  it("fails terminally without publication or System Design Pack fallback", async () => {
    const database = fakeDatabase();
    const artifacts = fakeArtifacts();
    const runStage = vi.fn(async (input: RunOoxmlReferencePythonStageInput) => {
      if (input.stage === "package-generation") {
        throw new OoxmlReferencePythonClientError(
          "OOXML_REFERENCE_PYTHON_FAILED",
          true,
          "private provider detail",
        );
      }
      return {
        stage: input.stage as "reference-extract-file",
        templateId: "operating-review-v1",
        templateVersion: 1,
        sourceSlideCount: 2,
        slotCount: 4,
        artifact: { completedStage: input.stage },
        issueCodes: [],
      };
    });
    const publish = vi.fn();
    const eventSink = { info: vi.fn(), error: vi.fn() };

    const result = await processOoxmlReferenceTemplateGenerationJob(
      database.dataSource,
      "http://python-worker:8000",
      payload,
      { artifactRepository: artifacts, runStage, publish, eventSink },
    );

    expect(result).toMatchObject({
      status: "failed",
      result: null,
      error: {
        code: "OOXML_REFERENCE_PYTHON_FAILED",
        failedStage: "package-generation",
        retryable: true,
      },
    });
    expect(publish).not.toHaveBeenCalled();
    expect(JSON.stringify(database.row)).not.toContain("private provider detail");
    expect(JSON.stringify(eventSink.error.mock.calls)).not.toContain(
      "private provider detail",
    );
  });

  it("does not publish a partial Deck when the fidelity report is not passed", async () => {
    const database = fakeDatabase();
    const artifacts = fakeArtifacts();
    const invalidMaterialization = materializationArtifact();
    invalidMaterialization.jobResult.fidelityReport.status = "not-run";
    invalidMaterialization.jobResult.fidelityReport.structuralGate.passed = false;
    const runStage = vi.fn(async (input: RunOoxmlReferencePythonStageInput) => {
      const artifact: JsonPayload =
        input.stage === "materialization"
          ? invalidMaterialization
          : input.stage === "render-validation"
            ? { renderAssets: [] }
          : { completedStage: input.stage };
      return {
        stage: input.stage,
        templateId: "operating-review-v1",
        templateVersion: 1,
        sourceSlideCount: 2,
        slotCount: 4,
        artifact,
        issueCodes: [],
      };
    });
    const publish = vi.fn();

    const result = await processOoxmlReferenceTemplateGenerationJob(
      database.dataSource,
      "http://python-worker:8000",
      payload,
      { artifactRepository: artifacts, runStage, publish },
    );

    expect(result).toMatchObject({
      status: "failed",
      result: null,
      error: {
        code: "OOXML_REFERENCE_PUBLICATION_FAILED",
        failedStage: "publication",
      },
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

function fakeDatabase() {
  const row = {
    job_id: payload.jobId,
    project_id: payload.projectId,
    type: "ooxml-reference-template-generation" as const,
    status: "queued" as "queued" | "running" | "succeeded" | "failed",
    progress: 0,
    message: "Queued.",
    result: null as Record<string, unknown> | null,
    error: null as Record<string, unknown> | null,
    created_at: now,
    updated_at: now,
  };
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("UPDATE jobs")) {
      row.status = params?.[2] as typeof row.status;
      row.progress = Number(params?.[3]);
      row.message = String(params?.[4]);
      row.result = params?.[5] as Record<string, unknown> | null;
      row.error = params?.[6] as Record<string, unknown> | null;
    }
    return [{ ...row }];
  });
  return { row, dataSource: { query } as unknown as DataSource };
}

type JsonPayload = OoxmlReferencePythonStageArtifact["payload"];

function fakeArtifacts(initial: ReturnType<typeof storedArtifact>[] = []) {
  const values = new Map(initial.map((artifact) => [artifact.stage, artifact]));
  return {
    findSucceeded: vi.fn(async (identity: { stage: string }) =>
      values.get(identity.stage),
    ),
    storeSucceeded: vi.fn(
      async (identity: { stage: string }, artifactPayload: JsonPayload) => {
        const artifact = {
          artifactId: `artifact-${identity.stage}`,
          jobId: payload.jobId,
          projectId: payload.projectId,
          stage: identity.stage,
          shardKey: "",
          payload: artifactPayload,
        };
        values.set(identity.stage, artifact as ReturnType<typeof storedArtifact>);
        return artifact as ReturnType<typeof storedArtifact>;
      },
    ),
  };
}

function storedArtifact(stage: string, data: JsonPayload) {
  return {
    artifactId: `artifact-${stage}`,
    jobId: payload.jobId,
    projectId: payload.projectId,
    stage,
    shardKey: "",
    payload: {
      data,
      metrics: { sourceSlideCount: 2, slotCount: 4 },
      issueCodes: [],
    },
  };
}

function materializationArtifact() {
  const templateSnapshot = {
    catalogTemplateId: "operating-review-v1",
    catalogTemplateVersion: 1,
    sourceSha256: "a".repeat(64),
    sourceSlideIds: ["cover-01"],
    slotAssignmentCount: 1,
  };
  const fidelityReport = passedFidelityReport();
  return {
    deck: {
      deckId: "deck_reference_1",
      projectId: payload.projectId,
      title: "운영 리뷰",
      version: 1,
      metadata: {
        language: "ko",
        locale: "ko-KR",
        createdFrom: { topic: "운영 리뷰", references: [], designReferences: [] },
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
          order: 1,
          title: "운영 리뷰",
          style: {},
          speakerNotes: "",
          elements: [],
          keywords: [],
          animations: [],
          aiNotes: { emphasisPoints: [], sourceEvidence: [] },
          ooxmlOrigin: "imported",
          ooxmlSourceSlidePart: "ppt/slides/slide1.xml",
        },
      ],
    },
    templateBlueprint: {
      templateId: "template_reference_1",
      sourceFileId: "file_baseline",
      sourcePackageFileId: "file_baseline",
      currentPackageFileId: "file_current",
      referenceTemplateSnapshot: templateSnapshot,
      slides: [
        {
          slideId: "slide_reference_1",
          slideIndex: 1,
          sourceSlideIndex: 1,
          sourceSlidePart: "ppt/slides/slide1.xml",
          elementSources: [],
          slots: [],
        },
      ],
    },
    templateSnapshot,
    baselinePackage: {
      fileId: "file_baseline",
      originalName: "baseline.pptx",
      size: 1024,
    },
    currentPackage: {
      fileId: "file_current",
      originalName: "current.pptx",
      size: 1024,
    },
    renderAssets: [],
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
    jobResult: {
      deckId: "deck_reference_1",
      templateId: "template_reference_1",
      currentPackageFileId: "file_current",
      renderAssetFileIds: [],
      templateSnapshot,
      fidelityReport,
      warningCodes: [],
    },
  };
}

function passedFidelityReport() {
  return {
    status: "passed" as "passed" | "not-run",
    structuralGate: { passed: true, issueCodes: [] as string[] },
    identityControl: {
      status: "passed" as const,
      evaluatedSlideCount: 1,
      packageWarningCount: 0,
      lockedGeometryDriftCount: 0,
    },
    generatedComparison: {
      status: "passed" as const,
      evaluatedSlideCount: 1,
      lockedRegionDriftCount: 0,
      slotOverflowCount: 0,
    },
    warningCodes: [] as string[],
  };
}
