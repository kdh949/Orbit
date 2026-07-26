import type {
  EnqueueJobInput,
  JobQueuePort,
  UpdateJobInput
} from "@orbit/job-queue";
import { demoIds, nowIso } from "@orbit/shared/common";
import { jobSchema, type Job } from "@orbit/shared/jobs";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

type JobRow = {
  job_id: string;
  project_id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class DbJobQueue implements JobQueuePort {
  constructor(private readonly dataSource: DataSource) {}

  async enqueue(input: EnqueueJobInput): Promise<Job> {
    const now = nowIso();
    const rows = await this.dataSource.query(
      `
        INSERT INTO jobs (
          job_id, project_id, type, status, progress, message,
          payload, result, error, created_at, updated_at
        )
        VALUES ($1, $2, $3, 'queued', 0, $4, $5, null, null, $6, $6)
        RETURNING *
      `,
      [
        `job_${randomUUID()}`,
        input.projectId ?? demoIds.projectId,
        input.type,
        "Job queued",
        input.payload ?? null,
        now
      ]
    );

    return rowToJob(rows[0]);
  }

  async get(jobId: string): Promise<Job | null> {
    const rows = await this.dataSource.query(
      `SELECT * FROM jobs WHERE job_id = $1`,
      [jobId]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async update(jobId: string, patch: UpdateJobInput): Promise<Job | null> {
    const keys = (Object.keys(patch) as (keyof UpdateJobInput)[]).filter(
      (key) => patch[key] !== undefined
    );
    const assignments = keys.map(
      (key, index) => `${jobColumnNames[key]} = $${index + 2}`
    );
    const rows = await this.dataSource.query(
      `
        UPDATE jobs
        SET ${[...assignments, `updated_at = $${keys.length + 2}`].join(", ")}
        WHERE job_id = $1
        RETURNING *
      `,
      [jobId, ...keys.map((key) => patch[key]), nowIso()]
    );

    return rows[0] ? rowToJob(rows[0]) : null;
  }
}

const jobColumnNames: Record<keyof UpdateJobInput, string> = {
  status: "status",
  progress: "progress",
  message: "message",
  result: "result",
  error: "error"
};

function rowToJob(row: JobRow): Job {
  return jobSchema.parse({
    jobId: row.job_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
