import { generateDeckRequestSchema } from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import {
  initializePendingAiDeckGenerationJobs,
  planAiDeckInitialStages,
  processAiDeckStagedCoordinatorJob,
} from "./staged-coordinator";

describe("planAiDeckInitialStages", () => {
  it("uses the documented policy precedence and fans out only uncovered files", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "staged OCR",
      referencePolicy: "references-first",
      design: { referencePolicy: "references-only" },
      brief: { referencePolicy: "research-first" },
      referenceFileIds: ["file-a", "file-b", "file-a", "file-c"],
      referenceContext: [
        { fileId: "file-b", title: "B", content: "already extracted" },
      ],
    });

    expect(planAiDeckInitialStages(request)).toEqual({
      referencePolicy: "references-first",
      selectedReferenceFileIds: ["file-a", "file-b", "file-c"],
      uncoveredReferenceFileIds: ["file-a", "file-c"],
    });
  });

  it("uses public references as the canonical selector before referenceFileIds", () => {
    const request = generateDeckRequestSchema.parse({
      topic: "selector parity",
      referencePolicy: "references-only",
      references: [{ fileId: "file-public" }, { fileId: "file-public" }],
      referenceFileIds: ["file-internal"],
    });

    expect(planAiDeckInitialStages(request)).toEqual({
      referencePolicy: "references-only",
      selectedReferenceFileIds: ["file-public"],
      uncoveredReferenceFileIds: ["file-public"],
    });
  });

  it.each(["topic-only", "user-input-only"] as const)(
    "skips OCR for %s",
    (referencePolicy) => {
      const request = generateDeckRequestSchema.parse({
        topic: "skip OCR",
        referencePolicy,
        referenceFileIds: ["file-a"],
      });

      expect(planAiDeckInitialStages(request)).toEqual({
        referencePolicy,
        selectedReferenceFileIds: ["file-a"],
        uncoveredReferenceFileIds: [],
      });
    },
  );
});

describe("processAiDeckStagedCoordinatorJob", () => {
  it("creates every initial checkpoint and moves the parent to running in one transaction", async () => {
    const query = vi
      .fn<QueryFunction>()
      .mockResolvedValueOnce([parentJobRow()])
      .mockResolvedValueOnce([parentJobRow({ status: "running", progress: 10 })])
      .mockResolvedValueOnce([checkpointRow("file-a")])
      .mockResolvedValueOnce([checkpointRow("file-b")]);
    const transaction = vi.fn(async (work: (manager: { query: QueryFunction }) => unknown) =>
      work({ query }),
    );

    const result = await processAiDeckStagedCoordinatorJob(
      { transaction } as unknown as DataSource,
      { jobId: "job-ai-deck-1", projectId: "project-a" },
    );

    expect(result).toMatchObject({
      jobId: "job-ai-deck-1",
      projectId: "project-a",
      status: "running",
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(4);
    expect(compactSql(query.mock.calls[0]?.[0])).toContain("FOR UPDATE");
    const insertCalls = query.mock.calls.slice(2);
    expect(insertCalls.map((call) => call[1]?.slice(0, 4))).toEqual([
      ["job-ai-deck-1", "project-a", "reference-extract-file", "file-a"],
      ["job-ai-deck-1", "project-a", "reference-extract-file", "file-b"],
    ]);
  });

  it("reuses existing checkpoints when a stalled coordinator runs again after commit", async () => {
    const query = vi
      .fn<QueryFunction>()
      .mockResolvedValueOnce([
        parentJobRow({ status: "running", progress: 10 }),
      ])
      .mockResolvedValueOnce([parentJobRow({ status: "running", progress: 10 })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([checkpointRow("file-a")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([checkpointRow("file-b")]);
    const transaction = vi.fn(
      async (work: (manager: { query: QueryFunction }) => unknown) =>
        work({ query }),
    );

    const result = await processAiDeckStagedCoordinatorJob(
      { transaction } as unknown as DataSource,
      { jobId: "job-ai-deck-1", projectId: "project-a" },
    );

    expect(result).toMatchObject({ status: "running", progress: 10 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(6);
    expect(compactSql(query.mock.calls[2]?.[0])).toContain(
      "ON CONFLICT (pipeline_job_id, stage, shard_key) DO NOTHING",
    );
    expect(compactSql(query.mock.calls[3]?.[0])).toContain(
      "SELECT stages.*",
    );
    expect(compactSql(query.mock.calls[4]?.[0])).toContain(
      "ON CONFLICT (pipeline_job_id, stage, shard_key) DO NOTHING",
    );
    expect(compactSql(query.mock.calls[5]?.[0])).toContain(
      "SELECT stages.*",
    );
  });

  it("creates source-grounding directly when every requested file is already covered", async () => {
    const query = vi
      .fn<QueryFunction>()
      .mockResolvedValueOnce([
        parentJobRow({
          payload: {
            request: generateDeckRequestSchema.parse({
              topic: "reuse OCR",
              referencePolicy: "references-first",
              referenceFileIds: ["file-a"],
              referenceContext: [
                { fileId: "file-a", content: "existing extraction" },
              ],
            }),
          },
        }),
      ])
      .mockResolvedValueOnce([parentJobRow({ status: "running", progress: 10 })])
      .mockResolvedValueOnce([
        { ...checkpointRow(""), stage: "source-grounding", shard_key: "" },
      ]);
    const transaction = vi.fn(async (work: (manager: { query: QueryFunction }) => unknown) =>
      work({ query }),
    );

    await processAiDeckStagedCoordinatorJob(
      { transaction } as unknown as DataSource,
      { jobId: "job-ai-deck-1", projectId: "project-a" },
    );

    expect(query.mock.calls[2]?.[1]?.slice(0, 4)).toEqual([
      "job-ai-deck-1",
      "project-a",
      "source-grounding",
      "",
    ]);
  });

  it("fans out references-only files selected through the public references field", async () => {
    const request = generateDeckRequestSchema.parse({
      topic: "public references",
      referencePolicy: "references-only",
      references: [{ fileId: "file-public" }],
    });
    const query = vi
      .fn<QueryFunction>()
      .mockResolvedValueOnce([parentJobRow({ payload: { request } })])
      .mockResolvedValueOnce([parentJobRow({ status: "running", progress: 10 })])
      .mockResolvedValueOnce([checkpointRow("file-public")]);
    const transaction = vi.fn(
      async (work: (manager: { query: QueryFunction }) => unknown) =>
        work({ query }),
    );

    const result = await processAiDeckStagedCoordinatorJob(
      { transaction } as unknown as DataSource,
      { jobId: "job-ai-deck-1", projectId: "project-a" },
    );

    expect(result.status).toBe("running");
    expect(query.mock.calls[2]?.[1]?.slice(0, 4)).toEqual([
      "job-ai-deck-1",
      "project-a",
      "reference-extract-file",
      "file-public",
    ]);
  });

  it.each(["references-first", "references-only"] as const)(
    "fails %s before source-grounding when no usable source exists",
    async (referencePolicy) => {
      const request = generateDeckRequestSchema.parse({
        topic: "strict grounding",
        referencePolicy,
      });
      const terminalError = {
        code: "SOURCE_GROUNDING_REQUIRED",
        message: "The selected reference policy requires usable grounding.",
        failedStage: "reference-extract-file",
        retryable: false,
      };
      const query = vi
        .fn<QueryFunction>()
        .mockResolvedValueOnce([
          parentJobRow({ payload: { request } }),
        ])
        .mockResolvedValueOnce([
          parentJobRow({
            status: "failed",
            message: "AI deck generation failed.",
            payload: { request },
            error: terminalError,
          }),
        ]);
      const transaction = vi.fn(
        async (work: (manager: { query: QueryFunction }) => unknown) =>
          work({ query }),
      );

      const result = await processAiDeckStagedCoordinatorJob(
        { transaction } as unknown as DataSource,
        { jobId: "job-ai-deck-1", projectId: "project-a" },
      );

      expect(result).toMatchObject({
        status: "failed",
        error: terminalError,
      });
      expect(query).toHaveBeenCalledTimes(2);
      expect(compactSql(query.mock.calls[1]?.[0])).toContain("UPDATE jobs");
      expect(
        query.mock.calls.some((call) =>
          compactSql(call[0]).includes("INSERT INTO ai_deck_generation_stages"),
        ),
      ).toBe(false);
    },
  );

  it("fails references-only when context exists without a selected reference", async () => {
    const request = generateDeckRequestSchema.parse({
      topic: "strict selector",
      referencePolicy: "references-only",
      referenceContext: [
        { fileId: "context-only", content: "unselected context" },
      ],
    });
    const terminalError = {
      code: "SOURCE_GROUNDING_REQUIRED",
      message: "The selected reference policy requires usable grounding.",
      failedStage: "reference-extract-file",
      retryable: false,
    };
    const query = vi
      .fn<QueryFunction>()
      .mockResolvedValueOnce([parentJobRow({ payload: { request } })])
      .mockResolvedValueOnce([
        parentJobRow({
          status: "failed",
          message: "AI deck generation failed.",
          payload: { request },
          error: terminalError,
        }),
      ]);
    const transaction = vi.fn(
      async (work: (manager: { query: QueryFunction }) => unknown) =>
        work({ query }),
    );

    const result = await processAiDeckStagedCoordinatorJob(
      { transaction } as unknown as DataSource,
      { jobId: "job-ai-deck-1", projectId: "project-a" },
    );

    expect(result).toMatchObject({ status: "failed", error: terminalError });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects coordinator payload fields beyond the ID-only contract", async () => {
    const transaction = vi.fn();

    await expect(
      processAiDeckStagedCoordinatorJob(
        { transaction } as unknown as DataSource,
        {
          jobId: "job-ai-deck-1",
          projectId: "project-a",
          request: { topic: "must stay in DB" },
        },
      ),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("initializePendingAiDeckGenerationJobs", () => {
  it("initializes planning when only the cover stage exists", async () => {
    const request = generateDeckRequestSchema.parse({
      topic: "cover race",
      referencePolicy: "user-input-only",
    });
    const query = vi
      .fn<QueryFunction>()
      .mockResolvedValue([
        { job_id: "job-ai-deck-1", project_id: "project-a" },
      ]);
    const transactionQuery = vi
      .fn<QueryFunction>()
      .mockResolvedValueOnce([
        parentJobRow({ status: "running", payload: { request } }),
      ])
      .mockResolvedValueOnce([
        parentJobRow({ status: "running", progress: 10, payload: { request } }),
      ])
      .mockResolvedValueOnce([
        { ...checkpointRow(""), stage: "source-grounding", shard_key: "" },
      ]);
    const transaction = vi.fn(
      async (work: (manager: { query: QueryFunction }) => unknown) =>
        work({ query: transactionQuery }),
    );

    await expect(
      initializePendingAiDeckGenerationJobs({
        query,
        transaction,
      } as unknown as DataSource),
    ).resolves.toEqual({ scanned: 1, initialized: 1 });

    expect(compactSql(query.mock.calls[0]?.[0])).toContain(
      "stages.stage IN ( 'reference-extract-file', 'source-grounding', 'content-planning' )",
    );
    expect(transactionQuery.mock.calls[2]?.[1]?.slice(0, 4)).toEqual([
      "job-ai-deck-1",
      "project-a",
      "source-grounding",
      "",
    ]);
  });
});

type QueryFunction = (
  sql: string,
  parameters?: unknown[],
) => Promise<unknown[]>;

function parentJobRow(overrides: Record<string, unknown> = {}) {
  const now = "2026-07-15T01:00:00.000Z";
  return {
    job_id: "job-ai-deck-1",
    project_id: "project-a",
    type: "ai-deck-generation" satisfies Job["type"],
    status: "queued" satisfies Job["status"],
    progress: 0,
    message: "queued",
    payload: {
      request: generateDeckRequestSchema.parse({
        topic: "staged OCR",
        referencePolicy: "references-first",
        referenceFileIds: ["file-a", "file-b"],
      }),
    },
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function checkpointRow(fileId: string) {
  const now = "2026-07-15T01:00:00.000Z";
  return {
    pipeline_job_id: "job-ai-deck-1",
    stage: "reference-extract-file",
    shard_key: fileId,
    status: "queued",
    attempt: 0,
    input_ref_json: {},
    result_ref_json: null,
    error_json: null,
    lease_owner: null,
    lease_expires_at: null,
    dispatched_at: null,
    created_at: now,
    updated_at: now,
  };
}

function compactSql(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}
