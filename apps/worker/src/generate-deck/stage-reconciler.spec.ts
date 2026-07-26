import type { Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { reconcileExpiredAiDeckStageLeases } from "./stage-reconciler";

describe("reconcileExpiredAiDeckStageLeases", () => {
  it.each([
    [4, "queued", 1, 0],
    [5, "failed", 0, 1],
  ] as const)(
    "locks the parent first and reconciles attempt %i to %s",
    async (attempt, status, requeued, failed) => {
      const outerQuery = vi.fn(async () => [expiredRow(attempt)]);
      const transactionQuery = vi.fn(
        async (sql: string, parameters?: unknown[]) => {
          const compact = compactSql(sql);
          if (compact.includes("FROM jobs") && compact.includes("FOR UPDATE")) {
            return [{ job_id: "job-ai-deck-1" }];
          }
          if (compact.startsWith("UPDATE ai_deck_generation_stages")) {
            return [
              checkpointRow(
                status,
                attempt,
                parameters?.[status === "queued" ? 5 : 6],
              ),
            ];
          }
          throw new Error(`Unexpected query: ${compact}`);
        },
      );
      const transaction = vi.fn(
        async (
          work: (manager: { query: typeof transactionQuery }) => unknown,
        ) => work({ query: transactionQuery }),
      );
      const recoveredParent = failedParentJob();
      const terminalJobs = status === "failed" ? [recoveredParent] : [];
      const recoverJoin = vi.fn(async () => recoveredParent);
      const dataSource = {
        query: outerQuery,
        transaction,
      } as unknown as DataSource;

      await expect(
        reconcileExpiredAiDeckStageLeases(dataSource, { recoverJoin }),
      ).resolves.toEqual({ scanned: 1, requeued, failed, terminalJobs });

      expect(compactSql(transactionQuery.mock.calls[0]?.[0])).toContain(
        "FOR UPDATE",
      );
      expect(transactionQuery.mock.calls[1]?.[1]?.[4]).toBe(attempt);
      expect(recoverJoin).toHaveBeenCalledTimes(failed);
    },
  );

  it("fails the parent directly when planning lease retries are exhausted", async () => {
    const outerQuery = vi.fn(async () => [
      expiredRow(5, "source-grounding", ""),
    ]);
    const transactionQuery = vi.fn(
      async (sql: string, parameters?: unknown[]) => {
        const compact = compactSql(sql);
        if (compact.includes("FROM jobs") && compact.includes("FOR UPDATE")) {
          return [{ job_id: "job-ai-deck-1" }];
        }
        if (compact.startsWith("UPDATE ai_deck_generation_stages")) {
          return [
            checkpointRow("failed", 5, parameters?.[6], "source-grounding", ""),
          ];
        }
        if (compact.startsWith("UPDATE jobs")) {
          return [
            {
              ...failedParentJobRow(parameters?.[2]),
              progress: 25,
            },
          ];
        }
        throw new Error(`Unexpected query: ${compact}`);
      },
    );
    const dataSource = {
      query: outerQuery,
      transaction: vi.fn(
        async (
          work: (manager: { query: typeof transactionQuery }) => unknown,
        ) => work({ query: transactionQuery }),
      ),
    } as unknown as DataSource;
    const recoverJoin = vi.fn();

    const result = await reconcileExpiredAiDeckStageLeases(dataSource, {
      recoverJoin,
    });

    expect(result).toMatchObject({ scanned: 1, requeued: 0, failed: 1 });
    expect(result.terminalJobs[0]).toMatchObject({
      status: "failed",
      error: {
        code: "AI_DECK_PLANNING_LEASE_EXHAUSTED",
        failedStage: "source-grounding",
        retryable: true,
      },
    });
    expect(recoverJoin).not.toHaveBeenCalled();
  });
});

function failedParentJob(): Job {
  return {
    jobId: "job-ai-deck-1",
    projectId: "project-a",
    type: "ai-deck-generation",
    status: "failed",
    progress: 10,
    message: "AI deck generation failed.",
    result: null,
    error: {
      code: "SOURCE_GROUNDING_REQUIRED",
      message: "The selected reference policy requires usable grounding.",
      failedStage: "reference-extract-file",
      retryable: false,
    },
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T01:00:00.000Z",
  };
}

function expiredRow(
  attempt: number,
  stage = "reference-extract-file",
  shardKey = "file-a",
) {
  return {
    ...checkpointRow("running", attempt, null, stage, shardKey),
    project_id: "project-a",
    lease_owner: "worker-a:7dc4ed60-2d85-4f13-b3ca-c6bb4ed54f8a",
    lease_expires_at: "2026-07-15T00:59:00.000Z",
  };
}

function checkpointRow(
  status: string,
  attempt: number,
  error: unknown,
  stage = "reference-extract-file",
  shardKey = "file-a",
) {
  return {
    pipeline_job_id: "job-ai-deck-1",
    stage,
    shard_key: shardKey,
    status,
    attempt,
    input_ref_json: {},
    result_ref_json: null,
    error_json: error,
    lease_owner: status === "running" ? "worker-a:lease" : null,
    lease_expires_at: status === "running" ? "2026-07-15T00:59:00.000Z" : null,
    dispatched_at: null,
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T01:00:00.000Z",
  };
}

function failedParentJobRow(error: unknown) {
  return {
    job_id: "job-ai-deck-1",
    project_id: "project-a",
    type: "ai-deck-generation",
    status: "failed",
    progress: 10,
    message: "AI deck generation failed.",
    result: null,
    error,
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T01:00:00.000Z",
  };
}

function compactSql(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}
