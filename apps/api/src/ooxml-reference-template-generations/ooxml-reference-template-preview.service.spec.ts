import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { OoxmlReferenceTemplatePreviewService } from "./ooxml-reference-template-preview.service";

const templateSnapshot = {
  catalogTemplateId: "operating-review",
  catalogTemplateVersion: 1,
  sourceSha256: "a".repeat(64),
  sourceSlideIds: ["cover-01", "closing-02"],
  slotAssignmentCount: 2,
};

describe("OoxmlReferenceTemplatePreviewService", () => {
  it("returns only the continuous completed slide prefix", async () => {
    const { service, query } = fixture({
      artifacts: [
        contentArtifact(),
        renderArtifact(1),
        renderArtifact(3),
      ],
    });

    const preview = await service.getPreview("project-1", "job-1");

    expect(preview).toMatchObject({
      status: "rendering",
      editable: false,
      completedSlides: [
        {
          slideId: "slide_1",
          order: 1,
          renderAssetFileId: "file-render-1",
        },
      ],
      pendingSlideOrders: [2, 3],
      deckId: null,
      error: null,
    });
    expect(query.mock.calls.every(([sql]) => String(sql).includes("SELECT"))).toBe(
      true,
    );
  });

  it("maps a failed Job to a bounded issue without exposing its message", async () => {
    const { service } = fixture({
      job: {
        status: "failed",
        progress: 59,
        error: {
          code: "OOXML_REFERENCE_CAPACITY_TEXT_OVERFLOW",
          message: "private slot content",
          retryable: false,
        },
      },
      artifacts: [contentArtifact()],
    });

    const preview = await service.getPreview("project-1", "job-1");

    expect(preview).toMatchObject({
      status: "failed",
      error: {
        code: "OOXML_REFERENCE_CAPACITY_TEXT_OVERFLOW",
        retryable: false,
      },
    });
    expect(JSON.stringify(preview)).not.toContain("private slot content");
  });

  it("becomes editor-ready only when result and canonical Deck IDs match", async () => {
    const { service } = fixture({
      job: { status: "succeeded", progress: 100, result: jobResult() },
      artifacts: [contentArtifact(), renderArtifact(1), renderArtifact(2), renderArtifact(3)],
      deckId: "deck_reference_1",
    });

    await expect(service.getPreview("project-1", "job-1")).resolves.toMatchObject({
      status: "succeeded",
      progress: 100,
      deckId: "deck_reference_1",
    });
  });

  it("fails closed when a succeeded Job does not match the canonical Deck", async () => {
    const { service } = fixture({
      job: { status: "succeeded", progress: 100, result: jobResult() },
      artifacts: [contentArtifact()],
      deckId: null,
    });

    await expect(service.getPreview("project-1", "job-1")).resolves.toMatchObject({
      status: "failed",
      progress: 99,
      deckId: null,
      error: {
        code: "OOXML_REFERENCE_PUBLICATION_IDENTITY_MISMATCH",
        retryable: false,
      },
    });
  });
});

function fixture(options: {
  job?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  deckId?: string | null;
}) {
  const job = {
    job_id: "job-1",
    project_id: "project-1",
    status: "running",
    progress: 72,
    result: null,
    error: null,
    updated_at: "2026-07-22T01:00:00.000Z",
    ...options.job,
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM jobs")) return [job];
    if (sql.includes("FROM ooxml_reference_template_generation_artifacts")) {
      return options.artifacts ?? [];
    }
    if (sql.includes("FROM decks")) {
      return options.deckId ? [{ deck_id: options.deckId }] : [];
    }
    throw new Error("Unexpected query");
  });
  return {
    service: new OoxmlReferenceTemplatePreviewService({ query } as unknown as DataSource),
    query,
  };
}

function contentArtifact() {
  return {
    stage: "content-planning",
    shard_key: "",
    payload_json: {
      data: {
        outline: [
          { order: 1, title: "표지" },
          { order: 2, title: "핵심 지표" },
          { order: 3, title: "마무리" },
        ],
      },
      metrics: { sourceSlideCount: 3, slotCount: 4 },
      issueCodes: [],
    },
  };
}

function renderArtifact(order: number) {
  return {
    stage: "slide-render",
    shard_key: String(order).padStart(3, "0"),
    payload_json: {
      slideId: `slide_${order}`,
      order,
      renderAssetFileId: `file-render-${order}`,
    },
  };
}

function jobResult() {
  const fidelityReport = {
    status: "passed",
    structuralGate: { passed: true, issueCodes: [] },
    identityControl: {
      status: "passed",
      evaluatedSlideCount: 3,
      packageWarningCount: 0,
      lockedGeometryDriftCount: 0,
    },
    generatedComparison: {
      status: "passed",
      evaluatedSlideCount: 3,
      lockedRegionDriftCount: 0,
      slotOverflowCount: 0,
    },
    warningCodes: [],
  };
  return {
    deckId: "deck_reference_1",
    templateId: "template_reference_1",
    currentPackageFileId: "file-current",
    renderAssetFileIds: ["file-render-1", "file-render-2", "file-render-3"],
    templateSnapshot,
    fidelityReport,
    warningCodes: [],
  };
}
