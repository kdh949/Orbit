import { generateDeckJobResultSchema } from "@orbit/shared";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import {
  mergeSlideValidations,
  publishAtomically,
} from "./execution-stage.processor";
import { completedSlideV2ArtifactPayloadSchema } from "./execution-stage-contract";
import {
  createTestDeck,
  createVisualQualityBaselineFixture,
  visualQualityBaselineSnapshot,
} from "./test-deck.fixture";

const now = "2026-07-16T00:00:00.000Z";
const artifactId = "2e42f833-a1ca-47d0-a410-d25ca9ba4d2e";
const message = {
  pipelineJobId: "job-ai-deck-1",
  projectId: "project-a",
  stage: "publication" as const,
  shardKey: "",
};

describe("publishAtomically", () => {
  it("commits the artifact, checkpoint, Deck, and parent success in one transaction", async () => {
    const deck = createTestDeck(message.projectId);
    const result = generateDeckJobResultSchema.parse({
      deckId: deck.deckId,
      deck,
      warnings: [],
      validation: {
        passed: true,
        layoutIssues: [],
        contentIssues: [],
        designIssues: [],
        presentationIssues: [],
      },
      diagnostics: {},
      coachingProvenance: null,
    });
    const sqlOrder: string[] = [];
    const query = vi.fn(async (sql: string) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      sqlOrder.push(compact);
      if (compact.includes("INSERT INTO ai_deck_execution_artifacts")) {
        return [artifactRow({ result })];
      }
      if (
        compact.includes("UPDATE ai_deck_generation_stages") &&
        compact.includes("SET status = 'succeeded'")
      ) {
        return [checkpointRow()];
      }
      if (compact.includes("INSERT INTO decks")) return [];
      if (compact.includes("UPDATE jobs")) return [parentRow(result)];
      throw new Error(`Unexpected SQL: ${compact}`);
    });
    const transaction = vi.fn(
      async (run: (manager: { query: typeof query }) => unknown) =>
        run({ query }),
    );
    const eventLogger = vi.fn();

    await expect(
      publishAtomically(
        { query, transaction } as unknown as DataSource,
        message,
        "worker-a:lease",
        1,
        result,
        eventLogger,
      ),
    ).resolves.toMatchObject({ status: "succeeded", progress: 100 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      sqlOrder.findIndex((sql) => sql.includes("INSERT INTO decks")),
    ).toBeLessThan(sqlOrder.findIndex((sql) => sql.includes("UPDATE jobs")));
    expect(eventLogger).toHaveBeenCalledWith(
      "ai-ppt.deck.published",
      expect.objectContaining({ jobId: message.pipelineJobId }),
    );
  });
});

describe("mergeSlideValidations", () => {
  it("maps shard-local issues to their actual slide and removes invalid shard-wide checks", () => {
    const second = completedSlideArtifact(2, {
      contentIssues: [
        validationIssue("BODY_CONTENT_DENSE", "slide", "slides.0.elements"),
      ],
      presentationIssues: [
        validationIssue("CTA_MISSING", "slide", "slides.0"),
        validationIssue("SPEAKER_NOTES_SHORT", "deck", "slides"),
      ],
    });
    const third = completedSlideArtifact(3, {
      designIssues: [
        validationIssue(
          "TEXT_CONTRAST_LOW",
          "element",
          "slides.0.elements.2.props.color",
        ),
        validationIssue("FOCAL_POINT_WEAK", "slide", "slides.2"),
      ],
      presentationIssues: [
        validationIssue("CTA_MISSING", "slide", "slides.0"),
      ],
    });

    const validation = mergeSlideValidations([second, third]);

    expect(validation.contentIssues[0]?.path).toBe("slides.1.elements");
    expect(validation.designIssues.map((issue) => issue.path)).toEqual([
      "slides.2.elements.2.props.color",
      "slides.2",
    ]);
    expect(validation.presentationIssues).toEqual([
      expect.objectContaining({ code: "CTA_MISSING", path: "slides.2" }),
    ]);
  });
});

describe("visual quality baseline fixture", () => {
  it("freezes the failing eight-slide composition and validation summary", () => {
    const { deck, validation } = createVisualQualityBaselineFixture();

    expect(deck.metadata.designProgramSnapshot?.compositionIds).toEqual(
      visualQualityBaselineSnapshot.compositionSequence,
    );
    expect(deck.slides).toHaveLength(8);
    expect({
      passed: validation.passed,
      layoutIssueCount: validation.layoutIssues.length,
      contentIssueCount: validation.contentIssues.length,
      designIssueCodes: validation.designIssues.map((issue) => issue.code),
      presentationIssueCount: validation.presentationIssues.length,
    }).toEqual(visualQualityBaselineSnapshot.validationSummary);
  });
});

function completedSlideArtifact(
  order: number,
  issues: Partial<{
    layoutIssues: ReturnType<typeof validationIssue>[];
    contentIssues: ReturnType<typeof validationIssue>[];
    designIssues: ReturnType<typeof validationIssue>[];
    presentationIssues: ReturnType<typeof validationIssue>[];
  }>,
) {
  const slide = {
    ...structuredClone(createTestDeck().slides[0]),
    slideId: `slide_${order}`,
    order,
  };
  const issueCount = Object.values(issues).reduce(
    (count, value) => count + (value?.length ?? 0),
    0,
  );
  return completedSlideV2ArtifactPayloadSchema.parse({
    artifactVersion: 2,
    sourceOrder: order,
    order,
    slideId: slide.slideId,
    slide,
    warnings: [],
    validation: {
      passed: issueCount === 0,
      layoutIssues: issues.layoutIssues ?? [],
      contentIssues: issues.contentIssues ?? [],
      designIssues: issues.designIssues ?? [],
      presentationIssues: issues.presentationIssues ?? [],
    },
  });
}

function validationIssue(
  code: string,
  scope: "deck" | "slide" | "element",
  path: string,
) {
  return {
    code,
    scope,
    severity: "warning" as const,
    blocking: false,
    path,
    message: `${code} warning`,
  };
}

function artifactRow(payload: unknown) {
  return {
    artifact_id: artifactId,
    pipeline_job_id: message.pipelineJobId,
    project_id: message.projectId,
    stage: message.stage,
    shard_key: "",
    payload_json: payload,
  };
}

function checkpointRow() {
  return {
    pipeline_job_id: message.pipelineJobId,
    stage: message.stage,
    shard_key: "",
    status: "succeeded",
    attempt: 1,
    input_ref_json: { executionArtifactId: artifactId },
    result_ref_json: { executionArtifactId: artifactId },
    error_json: null,
    lease_owner: null,
    lease_expires_at: null,
    dispatched_at: now,
    created_at: now,
    updated_at: now,
  };
}

function parentRow(result: unknown) {
  return {
    job_id: message.pipelineJobId,
    project_id: message.projectId,
    type: "ai-deck-generation",
    status: "succeeded",
    progress: 100,
    message: "AI deck generation completed.",
    result,
    error: null,
    created_at: now,
    updated_at: now,
  };
}
