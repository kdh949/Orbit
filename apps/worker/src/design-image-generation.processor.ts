import { designImageGenerationJobPayloadSchema } from "@orbit/shared/deck";
import { jobSchema, type Job } from "@orbit/shared/jobs";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import {
  generateDesignImageAsset,
  type ImageAssetRuntime,
} from "./image-asset-pipeline";

export async function processDesignImageGenerationJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "putObject" | "getSignedReadUrl">,
  runtime: ImageAssetRuntime,
  rawPayload: unknown,
): Promise<Job> {
  const parsed = designImageGenerationJobPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const jobId = readPayloadJobId(rawPayload);
    if (!jobId) throw new Error(parsed.error.message);
    return failJob(dataSource, jobId, 0, "DESIGN_IMAGE_PAYLOAD_INVALID", "Image generation request is invalid.");
  }

  const payload = parsed.data;
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 20,
    message: "Generating image.",
    result: null,
    error: null,
  });

  try {
    const result = await generateDesignImageAsset(
      dataSource,
      storage,
      runtime,
      payload,
    );
    return updateJob(dataSource, payload.jobId, {
      status: "succeeded",
      progress: 100,
      message: "Image generation completed.",
      result,
      error: null,
    });
  } catch (error) {
    const failure = classifyFailure(error);
    return failJob(
      dataSource,
      payload.jobId,
      20,
      failure.code,
      failure.message,
    );
  }
}

function classifyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Image generation failed";
  if (message.includes("Daily image generation limit")) {
    return { code: "DESIGN_IMAGE_DAILY_LIMIT_EXCEEDED", message };
  }
  if (message.includes("provider is disabled")) {
    return { code: "DESIGN_IMAGE_PROVIDER_UNAVAILABLE", message };
  }
  if (message.includes("resolution") || message.includes("MIME") || message.includes("size")) {
    return { code: "DESIGN_IMAGE_RESULT_INVALID", message };
  }
  if (message.includes("storage")) {
    return { code: "DESIGN_IMAGE_STORAGE_FAILED", message };
  }
  return { code: "DESIGN_IMAGE_PROVIDER_FAILED", message: "Image provider request failed." };
}

function failJob(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  code: string,
  message: string,
) {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "Image generation failed.",
    result: null,
    error: { code, message },
  });
}

async function updateJob(
  dataSource: DataSource,
  jobId: string,
  patch: Pick<Job, "status" | "progress" | "message" | "result" | "error">,
) {
  const rows = await dataSource.query(
    `UPDATE jobs SET status=$2, progress=$3, message=$4, result=$5, error=$6,
      updated_at=now() WHERE job_id=$1 RETURNING *`,
    [jobId, patch.status, patch.progress, patch.message, patch.result, patch.error],
  );
  const raw = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
  if (!raw) throw new Error(`Job not found: ${jobId}`);
  return jobSchema.parse({
    jobId: raw.job_id,
    projectId: raw.project_id,
    type: raw.type,
    status: raw.status,
    progress: raw.progress,
    message: raw.message,
    result: raw.result,
    error: raw.error,
    createdAt: new Date(raw.created_at).toISOString(),
    updatedAt: new Date(raw.updated_at).toISOString(),
  });
}

function readPayloadJobId(value: unknown) {
  return value && typeof value === "object" && "jobId" in value &&
    typeof value.jobId === "string"
    ? value.jobId
    : "";
}
