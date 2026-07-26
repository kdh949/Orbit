import type { Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { z } from "zod";

const workerHealthCheckPayloadSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1)
});

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  app: z.literal("orbit-python-worker"),
  checked_at: z.string().min(1)
});

type JobRow = {
  job_id: string;
  project_id: string;
  type: Job["type"];
  status: Job["status"];
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function processWorkerHealthCheckJob(
  dataSource: DataSource,
  pythonWorkerUrl: string,
  rawPayload: unknown
): Promise<Job> {
  const payloadResult = workerHealthCheckPayloadSchema.safeParse(rawPayload);
  if (!payloadResult.success) {
    const jobId =
      rawPayload &&
      typeof rawPayload === "object" &&
      "jobId" in rawPayload &&
      typeof rawPayload.jobId === "string"
        ? rawPayload.jobId
        : "";

    if (!jobId) {
      throw new Error(payloadResult.error.message);
    }

    return failJob(
      dataSource,
      jobId,
      0,
      "WORKER_HEALTH_CHECK_PAYLOAD_INVALID",
      payloadResult.error.message
    );
  }

  const payload = payloadResult.data;
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 50,
    message: "Python worker health check running.",
    result: null,
    error: null
  });

  let response: Response;
  try {
    response = await fetch(workerUrl(pythonWorkerUrl, "/health"), {
      method: "GET",
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      50,
      "PYTHON_WORKER_HEALTH_CHECK_UNAVAILABLE",
      error instanceof Error ? error.message : "Python worker health check failed."
    );
  }

  if (!response.ok) {
    const message =
      (await response.text()) || "Python worker health check failed.";
    return failJob(
      dataSource,
      payload.jobId,
      50,
      "PYTHON_WORKER_HEALTH_CHECK_FAILED",
      message
    );
  }

  try {
    const workerPayload = healthResponseSchema.parse(await response.json());
    return updateJob(dataSource, payload.jobId, {
      status: "succeeded",
      progress: 100,
      message: "Python worker health check completed.",
      result: {
        status: workerPayload.status,
        app: workerPayload.app,
        checkedAt: workerPayload.checked_at
      },
      error: null
    });
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      50,
      "PYTHON_WORKER_HEALTH_CHECK_INVALID_RESPONSE",
      error instanceof Error
        ? error.message
        : "Python worker returned invalid health check response."
    );
  }
}

async function failJob(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  code: string,
  message: string
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "Python worker health check failed.",
    result: null,
    error: { code, message }
  });
}

async function updateJob(
  dataSource: DataSource,
  jobId: string,
  patch: {
    status: "running" | "succeeded" | "failed";
    progress: number;
    message: string;
    result: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  }
): Promise<Job> {
  const rows = await dataSource.query(
    `
      UPDATE jobs
      SET status = $2,
          progress = $3,
          message = $4,
          result = $5,
          error = $6,
          updated_at = now()
      WHERE job_id = $1
      RETURNING *
    `,
    [jobId, patch.status, patch.progress, patch.message, patch.result, patch.error]
  );

  const row = readFirstQueryRow<JobRow>(rows);
  if (!row) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return rowToJob(row);
}

function readFirstQueryRow<T>(queryResult: unknown): T | null {
  if (!Array.isArray(queryResult)) {
    return null;
  }

  const first = queryResult[0];
  if (Array.isArray(first)) {
    return (first[0] as T | undefined) ?? null;
  }

  return (first as T | undefined) ?? null;
}

function rowToJob(row: JobRow): Job {
  return {
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
  };
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }

  return date.toISOString();
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();
}
