import {
  generateDeckResponseSchema,
  generateDeckStoredJobPayloadSchema,
} from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { z } from "zod";
import type { ImageAssetRuntime } from "./image-asset-pipeline";
import {
  processGenerateDeckPipeline,
  type GenerateDeckEventLogger,
} from "./generate-deck/pipeline";
import {
  failGenerateDeckJob,
  updateGenerateDeckJob,
} from "./generate-deck/publication";

export type { GenerateDeckEventLogger } from "./generate-deck/pipeline";

const generateDeckPayloadSchema = generateDeckStoredJobPayloadSchema
  .extend({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();

const generateDeckTimeoutMs = 300_000;

export async function processGenerateDeckJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">,
  pythonWorkerUrl: string,
  rawPayload: unknown,
  imageRuntime?: ImageAssetRuntime,
  eventLogger?: GenerateDeckEventLogger,
): Promise<Job> {
  const payloadResult = generateDeckPayloadSchema.safeParse(rawPayload);
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

    return failGenerateDeckJob(
      dataSource,
      jobId,
      0,
      "GENERATE_DECK_PAYLOAD_INVALID",
      payloadResult.error.message,
    );
  }

  const payload = payloadResult.data;
  await updateGenerateDeckJob(dataSource, payload.jobId, {
    status: "running",
    progress: 15,
    message: "AI deck generation running.",
    result: null,
    error: null,
  });

  let response: Response;
  try {
    response = await fetch(workerUrl(pythonWorkerUrl, "/ai/generate-deck"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: payload.projectId,
        ...payload.request,
        design: {
          ...payload.request.design,
          ...(!payload.request.design?.stylePackId &&
          payload.designPackSnapshot?.baseStylePackId
            ? { stylePackId: payload.designPackSnapshot.baseStylePackId }
            : {}),
        },
        designProgramContext: {
          savedDesignPreferences: payload.designPackSnapshot?.preferences ?? {},
        },
      }),
      signal: AbortSignal.timeout(generateDeckTimeoutMs),
    });
  } catch (error) {
    return failGenerateDeckJob(
      dataSource,
      payload.jobId,
      15,
      "PYTHON_WORKER_GENERATE_DECK_UNAVAILABLE",
      error instanceof Error ? error.message : "Python worker unavailable.",
    );
  }

  if (!response.ok) {
    const message =
      (await response.text()) || "Python worker deck generation failed.";
    return failGenerateDeckJob(
      dataSource,
      payload.jobId,
      15,
      "PYTHON_WORKER_GENERATE_DECK_FAILED",
      message,
    );
  }

  try {
    const workerPayload = generateDeckResponseSchema.parse(
      await response.json(),
    );
    return processGenerateDeckPipeline({
      dataSource,
      storage,
      pythonWorkerUrl,
      jobId: payload.jobId,
      projectId: payload.projectId,
      request: payload.request,
      designPackSnapshot: payload.designPackSnapshot,
      imageAssetScope: payload.imageAssetScope,
      workerPayload,
      imageRuntime,
      eventLogger,
    });
  } catch (error) {
    return failGenerateDeckJob(
      dataSource,
      payload.jobId,
      75,
      "PYTHON_WORKER_GENERATE_DECK_INVALID_RESPONSE",
      error instanceof Error
        ? error.message
        : "Python worker returned invalid deck generation response.",
    );
  }
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}
