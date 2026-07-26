import { generateDeckStoredJobPayloadSchema } from "@orbit/shared/deck";
import { allowedAssetMimeTypes } from "@orbit/shared/files";
import {
  aiDeckGenerationStageMessageSchema,
  jobErrorSchema,
  type AiDeckGenerationStageMessage,
  type Job,
  type JobError,
} from "@orbit/shared/jobs";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { z } from "zod";

import { parseSingleReferenceFileWithPython } from "../reference-extract-python-client";
import {
  AiDeckStageFencingLostError,
  completeAiDeckReferenceExtractionStage,
  recoverAiDeckReferenceExtractionJoin,
} from "./reference-extraction-join";
import {
  AiDeckGenerationStageCheckpointRepository,
  type AiDeckGenerationStageCheckpoint,
} from "./stage-checkpoint-repository";
import { planAiDeckInitialStages } from "./staged-coordinator";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const referenceStageMessageSchema = aiDeckGenerationStageMessageSchema.refine(
  (message) => message.stage === "reference-extract-file",
  { message: "reference-extract-file stage required" },
);
const assetRowSchema = z.object({
  file_id: z.string().min(1),
  project_id: z.string().min(1),
  storage_key: z.string().min(1),
  original_name: z.string().min(1),
  mime_type: z.string().min(1),
  purpose: z.string().min(1),
  status: z.string().min(1),
  payload: z.unknown(),
});
const referenceMimeTypes = new Set<string>(
  allowedAssetMimeTypes.filter(
    (mimeType) =>
      mimeType === "application/pdf" ||
      mimeType ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType.startsWith("image/"),
  ),
);

export interface AiDeckReferenceExtractionStageOptions {
  fetchImpl?: FetchLike;
  heartbeatIntervalMs?: number;
  claimedCheckpoint?: AiDeckGenerationStageCheckpoint;
  recoverJoin?: (
    dataSource: DataSource,
    message: AiDeckGenerationStageMessage,
  ) => Promise<Job | void>;
}

export async function processAiDeckReferenceExtractionStage(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl">,
  pythonWorkerUrl: string,
  workerId: string,
  rawMessage: unknown,
  options: AiDeckReferenceExtractionStageOptions = {},
): Promise<Job | void> {
  const message = referenceStageMessageSchema.parse(rawMessage);
  const checkpoints = new AiDeckGenerationStageCheckpointRepository(dataSource);
  const claimed =
    options.claimedCheckpoint ?? (await checkpoints.claim(message, workerId));
  if (!claimed) {
    return (options.recoverJoin ?? recoverAiDeckReferenceExtractionJoin)(
      dataSource,
      message,
    );
  }
  assertClaimMatches(message, claimed);
  if (!claimed.leaseOwner) throw new Error("Claimed stage is missing its lease owner.");

  const controller = new AbortController();
  let leaseLost = false;
  let heartbeatRunning = false;
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || leaseLost) return;
    heartbeatRunning = true;
    void checkpoints
      .renewLease(message, claimed.leaseOwner, claimed.attempt)
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
          controller.abort();
        }
      })
      .catch(() => {
        leaseLost = true;
        controller.abort();
      })
      .finally(() => {
        heartbeatRunning = false;
      });
  }, options.heartbeatIntervalMs ?? 60_000);
  heartbeat.unref?.();

  try {
    const asset = await loadReferenceMaterialAsset(dataSource, message);
    let signedUrl: string;
    try {
      signedUrl = await storage.getSignedReadUrl(asset.storageKey);
    } catch {
      throw stageError(
        "REFERENCE_STORAGE_UNAVAILABLE",
        "Reference asset storage is temporarily unavailable.",
        true,
      );
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    let download: Response;
    try {
      download = await fetchImpl(signedUrl, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(120_000),
        ]),
      });
    } catch {
      if (leaseLost) return;
      throw stageError(
        "REFERENCE_STORAGE_UNAVAILABLE",
        "Reference asset download is temporarily unavailable.",
        true,
      );
    }
    if (!download.ok) {
      throw stageError(
        "REFERENCE_STORAGE_DOWNLOAD_FAILED",
        "Reference asset download failed.",
        download.status === 429 || download.status >= 500,
      );
    }
    const body = new Uint8Array(await download.arrayBuffer());
    const extraction = await parseSingleReferenceFileWithPython({
      pythonWorkerUrl,
      projectId: message.projectId,
      file: {
        fileId: message.shardKey,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        body,
      },
      fetchImpl,
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(120_000),
      ]),
    });
    if (leaseLost) return;

    if (!extraction.usable) {
      const unusableError: JobError = {
        code: "REFERENCE_EXTRACTION_UNUSABLE",
        message: "Reference extraction did not produce usable content.",
        failedStage: "reference-extract-file",
        retryable: claimed.attempt < 5,
      };
      if (claimed.attempt < 5) {
        await releaseForRetryOrReturn(
          checkpoints,
          message,
          claimed.leaseOwner,
          claimed.attempt,
          unusableError,
        );
        return;
      }
      return await completeAiDeckReferenceExtractionStage(dataSource, {
        message,
        leaseOwner: claimed.leaseOwner,
        attempt: claimed.attempt,
        extraction,
        error: { ...unusableError, retryable: false },
      });
    }

    return await completeAiDeckReferenceExtractionStage(dataSource, {
      message,
      leaseOwner: claimed.leaseOwner,
      attempt: claimed.attempt,
      extraction,
    });
  } catch (error) {
    if (leaseLost || error instanceof AiDeckStageFencingLostError) return;
    if (isRetrySignal(error)) throw error;
    const normalized = normalizeStageError(error);
    if (normalized.error.retryable && claimed.attempt < 5) {
      await releaseForRetryOrReturn(
        checkpoints,
        message,
        claimed.leaseOwner,
        claimed.attempt,
        normalized.error,
      );
      return;
    }
    return await completeAiDeckReferenceExtractionStage(dataSource, {
      message,
      leaseOwner: claimed.leaseOwner,
      attempt: claimed.attempt,
      error: { ...normalized.error, retryable: false },
      fatalParent: normalized.fatalParent,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

function assertClaimMatches(
  message: AiDeckGenerationStageMessage,
  claimed: AiDeckGenerationStageCheckpoint,
): void {
  if (
    claimed.pipelineJobId !== message.pipelineJobId ||
    claimed.stage !== message.stage ||
    claimed.shardKey !== message.shardKey ||
    claimed.status !== "running"
  ) {
    throw new Error("Preclaimed AI deck checkpoint identity mismatch.");
  }
}

interface ReferenceMaterialAsset {
  storageKey: string;
  originalName: string;
  mimeType: string;
}

async function loadReferenceMaterialAsset(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage,
): Promise<ReferenceMaterialAsset> {
  const rows = await dataSource.query(
    `
      SELECT assets.file_id,
             assets.project_id,
             assets.storage_key,
             assets.original_name,
             assets.mime_type,
             assets.purpose,
             assets.status,
             jobs.payload
      FROM project_assets assets
      JOIN jobs
        ON jobs.job_id = $1
       AND jobs.project_id = $2
       AND jobs.type = 'ai-deck-generation'
       AND jobs.status IN ('queued','running')
      WHERE assets.project_id = $2
        AND assets.file_id = $3
    `,
    [message.pipelineJobId, message.projectId, message.shardKey],
  );
  const raw = firstQueryRow(rows);
  if (!raw) {
    throw stageError(
      "REFERENCE_ASSET_INVALID",
      "Reference asset is not available to this pipeline.",
      false,
      true,
    );
  }
  const row = assetRowSchema.parse(raw);
  const request = generateDeckStoredJobPayloadSchema.parse(row.payload).request;
  if (
    row.file_id !== message.shardKey ||
    row.project_id !== message.projectId ||
    row.purpose !== "reference-material" ||
    row.status !== "uploaded" ||
    !referenceMimeTypes.has(row.mime_type) ||
    !planAiDeckInitialStages(request).uncoveredReferenceFileIds.includes(
      message.shardKey,
    )
  ) {
    throw stageError(
      "REFERENCE_ASSET_INVALID",
      "Reference asset does not satisfy the staged extraction contract.",
      false,
      true,
    );
  }
  return {
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
  };
}

async function releaseForRetryOrReturn(
  checkpoints: AiDeckGenerationStageCheckpointRepository,
  message: AiDeckGenerationStageMessage,
  leaseOwner: string,
  attempt: number,
  rawError: JobError,
): Promise<void> {
  const error = jobErrorSchema.parse({ ...rawError, retryable: true });
  const released = await checkpoints.releaseForRetry(
    message,
    leaseOwner,
    attempt,
    error,
  );
  if (released) {
    const retrySignal = new Error("AI_DECK_STAGE_RETRY");
    retrySignal.name = "AiDeckStageRetrySignal";
    throw retrySignal;
  }
}

class AiDeckReferenceStageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly fatalParent: boolean,
  ) {
    super(message);
    this.name = "AiDeckReferenceStageError";
  }
}

function stageError(
  code: string,
  message: string,
  retryable: boolean,
  fatalParent = false,
): AiDeckReferenceStageError {
  return new AiDeckReferenceStageError(code, message, retryable, fatalParent);
}

function normalizeStageError(error: unknown): {
  error: JobError;
  fatalParent: boolean;
} {
  if (error instanceof AiDeckReferenceStageError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        failedStage: "reference-extract-file",
        retryable: error.retryable,
      },
      fatalParent: error.fatalParent,
    };
  }
  if (isStageProviderError(error)) {
    return {
      error: {
        code: error.code,
        message: "Reference extraction provider failed.",
        failedStage: "reference-extract-file",
        retryable: error.retryable,
      },
      fatalParent: false,
    };
  }
  return {
    error: {
      code: "REFERENCE_EXTRACTION_INTERNAL_ERROR",
      message: "Reference extraction could not be completed.",
      failedStage: "reference-extract-file",
      retryable: true,
    },
    fatalParent: false,
  };
}

function isStageProviderError(
  value: unknown,
): value is { code: string; retryable: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "retryable" in value &&
    typeof value.retryable === "boolean"
  );
}

function isRetrySignal(error: unknown): boolean {
  return error instanceof Error && error.message === "AI_DECK_STAGE_RETRY";
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}
