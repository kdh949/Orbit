import {
  deckSchema,
  ooxmlReferenceTemplateGenerationJobPayloadSchema,
  ooxmlReferenceTemplateGenerationJobResultSchema,
  ooxmlReferenceTemplateGenerationStageSchema,
  ooxmlTemplateSnapshotSchema,
  qualityReportSchema,
  templateBlueprintSchema,
  type Job,
  type OoxmlReferenceTemplateGenerationStage,
} from "@orbit/shared";
import type { DataSource } from "typeorm";
import { z } from "zod";

import {
  OoxmlReferencePythonClientError,
  runOoxmlReferencePythonStage,
  type OoxmlReferencePythonStageArtifact,
  type RunOoxmlReferencePythonStageInput,
} from "./ooxml-reference-template-generation.python-client";
import {
  OoxmlReferenceTemplateArtifactRepository,
} from "./ooxml-reference-template/artifact-repository";
import {
  publishOoxmlReferenceMaterialization,
  type OoxmlReferenceMaterializationPublication,
} from "./ooxml-reference-template/materialization";

const pythonStages = ooxmlReferenceTemplateGenerationStageSchema
  .exclude(["publication"])
  .options;

const stageProgress: Record<
  Exclude<OoxmlReferenceTemplateGenerationStage, "publication">,
  number
> = {
  "reference-extract-file": 12,
  "source-grounding": 24,
  "content-planning": 36,
  "template-planning": 48,
  "package-generation": 60,
  "render-validation": 72,
  materialization: 88,
};

const storedStagePayloadSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    metrics: z
      .object({
        sourceSlideCount: z.number().int().nonnegative().max(500),
        slotCount: z.number().int().nonnegative().max(10_000),
      })
      .strict(),
    issueCodes: z
      .array(z.string().regex(/^OOXML_REFERENCE_[A-Z0-9_]+$/))
      .max(500),
  })
  .strict();

const generatedAssetRefSchema = z
  .object({
    fileId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    originalName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !/[\\/]/.test(value)),
    size: z.number().int().nonnegative(),
  })
  .strict();

const materializationArtifactSchema = z
  .object({
    deck: deckSchema,
    templateBlueprint: templateBlueprintSchema,
    templateSnapshot: ooxmlTemplateSnapshotSchema,
    baselinePackage: generatedAssetRefSchema,
    currentPackage: generatedAssetRefSchema,
    renderAssets: z.array(generatedAssetRefSchema).max(500),
    qualityReport: qualityReportSchema,
    jobResult: ooxmlReferenceTemplateGenerationJobResultSchema,
  })
  .strict();

type StageRunner = (
  input: RunOoxmlReferencePythonStageInput,
) => ReturnType<typeof runOoxmlReferencePythonStage>;

type ArtifactRecord = {
  payload: OoxmlReferencePythonStageArtifact["payload"];
};

type ArtifactRepository = {
  findSucceeded(identity: unknown): Promise<ArtifactRecord | undefined>;
  storeSucceeded(
    identity: unknown,
    payload: OoxmlReferencePythonStageArtifact["payload"],
  ): Promise<ArtifactRecord>;
};

type EventSink = {
  info: (event: Record<string, unknown>) => void;
  error: (event: Record<string, unknown>) => void;
};

export type OoxmlReferenceTemplateGenerationProcessorOptions = {
  artifactRepository?: ArtifactRepository;
  runStage?: StageRunner;
  publish?: (input: OoxmlReferenceMaterializationPublication) => Promise<void>;
  eventSink?: EventSink;
};

type JobRow = {
  job_id: string;
  project_id: string;
  type: Job["type"];
  status: Job["status"];
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: Job["error"];
  created_at: Date | string;
  updated_at: Date | string;
};

export async function processOoxmlReferenceTemplateGenerationJob(
  dataSource: DataSource,
  pythonWorkerUrl: string,
  rawPayload: unknown,
  options: OoxmlReferenceTemplateGenerationProcessorOptions = {},
): Promise<Job> {
  const parsed = ooxmlReferenceTemplateGenerationJobPayloadSchema.safeParse(
    rawPayload,
  );
  if (!parsed.success) {
    const identity = partialIdentity(rawPayload);
    if (!identity) throw new Error("OOXML reference generation payload is invalid.");
    return failJob(
      dataSource,
      identity.jobId,
      identity.projectId,
      0,
      "reference-extract-file",
      "OOXML_REFERENCE_PAYLOAD_INVALID",
      false,
    );
  }

  const payload = parsed.data;
  const current = await loadJob(dataSource, payload.jobId, payload.projectId);
  if (current.status === "succeeded") return current;
  if (payload.request.templateSelection.mode !== "user") {
    return failJob(
      dataSource,
      payload.jobId,
      payload.projectId,
      0,
      "template-planning",
      "OOXML_REFERENCE_TEMPLATE_SELECTION_REQUIRED",
      false,
    );
  }
  const templateId = payload.request.templateSelection.templateId;
  const templateVersion = payload.request.templateSelection.version;
  const repository =
    options.artifactRepository ??
    new OoxmlReferenceTemplateArtifactRepository(dataSource);
  const runStage = options.runStage ?? runOoxmlReferencePythonStage;
  const publish =
    options.publish ??
    ((input) => publishOoxmlReferenceMaterialization(dataSource, input));

  await updateJob(dataSource, payload.jobId, payload.projectId, {
    status: "running",
    progress: 5,
    message: "OOXML reference template generation started.",
    result: null,
    error: null,
  });
  options.eventSink?.info(
    eventFields("ooxml-reference-template.job.started", payload, {
      templateId,
      templateVersion,
    }),
  );

  const dependencies: OoxmlReferencePythonStageArtifact[] = [];
  let failedStage: OoxmlReferenceTemplateGenerationStage =
    "reference-extract-file";
  try {
    for (const stage of pythonStages) {
      failedStage = stage;
      const identity = {
        jobId: payload.jobId,
        projectId: payload.projectId,
        stage,
        shardKey: "",
      } as const;
      let artifact = await repository.findSucceeded(identity);
      if (!artifact) {
        const response = await runStage({
          pythonWorkerUrl,
          jobId: payload.jobId,
          projectId: payload.projectId,
          stage,
          templateId,
          templateVersion,
          request: payload.request,
          dependencies: [...dependencies],
        });
        artifact = await repository.storeSucceeded(identity, {
          data: response.artifact,
          metrics: {
            sourceSlideCount: response.sourceSlideCount,
            slotCount: response.slotCount,
          },
          issueCodes: response.issueCodes,
        });
      }
      const stored = storedStagePayloadSchema.parse(artifact.payload);
      dependencies.push({ stage, payload: artifact.payload });
      await updateJob(dataSource, payload.jobId, payload.projectId, {
        status: "running",
        progress: stageProgress[stage],
        message: `OOXML reference template stage completed: ${stage}.`,
        result: null,
        error: null,
      });
      options.eventSink?.info(
        eventFields("ooxml-reference-template.stage.succeeded", payload, {
          templateId,
          templateVersion,
          stage,
          sourceSlideCount: stored.metrics.sourceSlideCount,
          slotCount: stored.metrics.slotCount,
          issueCode: stored.issueCodes[0],
        }),
      );
    }

    const materialization = parseMaterialization(dependencies);
    failedStage = "publication";
    if (
      materialization.jobResult.fidelityReport.status !== "passed" ||
      !materialization.jobResult.fidelityReport.structuralGate.passed
    ) {
      throw new Error("generation fidelity gate did not pass");
    }
    const publicationIdentity = {
      jobId: payload.jobId,
      projectId: payload.projectId,
      stage: "publication" as const,
      shardKey: "",
    };
    const existingPublication = await repository.findSucceeded(
      publicationIdentity,
    );
    const publicationResult = existingPublication
      ? ooxmlReferenceTemplateGenerationJobResultSchema.parse(
          existingPublication.payload,
        )
      : materialization.jobResult;
    if (!existingPublication) {
      await repository.storeSucceeded(publicationIdentity, publicationResult);
    }
    await publish(
      publicationInput(payload.projectId, payload.jobId, materialization),
    );
    options.eventSink?.info(
      eventFields("ooxml-reference-template.job.succeeded", payload, {
        templateId,
        templateVersion,
        sourceSlideCount: materialization.templateSnapshot.sourceSlideIds.length,
        slotCount: materialization.templateSnapshot.slotAssignmentCount,
      }),
    );
    return loadJob(dataSource, payload.jobId, payload.projectId);
  } catch (error) {
    const failure = boundedFailure(error, failedStage);
    options.eventSink?.error(
      eventFields("ooxml-reference-template.stage.failed", payload, {
        templateId,
        templateVersion,
        stage: failedStage,
        issueCode: failure.code,
        retryable: failure.retryable,
      }),
    );
    const failed = await failJob(
      dataSource,
      payload.jobId,
      payload.projectId,
      failedStage === "publication" ? 94 : stageProgress[failedStage] - 1,
      failedStage,
      failure.code,
      failure.retryable,
    );
    options.eventSink?.error(
      eventFields("ooxml-reference-template.job.failed", payload, {
        templateId,
        templateVersion,
        issueCode: failure.code,
        retryable: failure.retryable,
      }),
    );
    return failed;
  }
}

function parseMaterialization(
  dependencies: OoxmlReferencePythonStageArtifact[],
): z.infer<typeof materializationArtifactSchema> {
  const artifact = dependencies.find(
    (dependency) => dependency.stage === "materialization",
  );
  if (!artifact) throw new Error("materialization artifact is missing");
  return materializationArtifactSchema.parse(
    storedStagePayloadSchema.parse(artifact.payload).data,
  );
}

function publicationInput(
  projectId: string,
  generationId: string,
  artifact: z.infer<typeof materializationArtifactSchema>,
): OoxmlReferenceMaterializationPublication {
  const withStorageKey = (
    asset: z.infer<typeof generatedAssetRefSchema>,
    mimeType: string,
  ) => ({
    ...asset,
    mimeType,
    storageKey: generatedStorageKey(
      projectId,
      generationId,
      asset.fileId,
      asset.originalName,
    ),
  });
  return {
    projectId,
    generationId,
    deck: artifact.deck,
    templateBlueprint: artifact.templateBlueprint,
    templateSnapshot: artifact.templateSnapshot,
    baselinePackage: withStorageKey(
      artifact.baselinePackage,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    currentPackage: withStorageKey(
      artifact.currentPackage,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    renderAssets: artifact.renderAssets.map((asset) =>
      withStorageKey(asset, "image/png"),
    ),
    qualityReport: artifact.qualityReport,
    jobResult: artifact.jobResult,
  };
}

export function generatedStorageKey(
  projectId: string,
  generationId: string,
  fileId: string,
  originalName: string,
): string {
  for (const [label, value] of Object.entries({
    projectId,
    generationId,
    fileId,
  })) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
      throw new Error(`Invalid ${label} for generated storage key.`);
    }
  }
  if (!originalName || /[\\/]/.test(originalName)) {
    throw new Error("Invalid originalName for generated storage key.");
  }
  return `projects/${projectId}/ooxml-reference-generations/${generationId}/${fileId}/${encodeURIComponent(originalName)}`;
}

function boundedFailure(
  error: unknown,
  stage: OoxmlReferenceTemplateGenerationStage,
): { code: string; retryable: boolean } {
  if (error instanceof OoxmlReferencePythonClientError) {
    return { code: error.code, retryable: error.retryable };
  }
  return {
    code:
      stage === "publication"
        ? "OOXML_REFERENCE_PUBLICATION_FAILED"
        : "OOXML_REFERENCE_STAGE_FAILED",
    retryable: false,
  };
}

function partialIdentity(
  value: unknown,
): { jobId: string; projectId: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record.jobId === "string" &&
    record.jobId.length > 0 &&
    typeof record.projectId === "string" &&
    record.projectId.length > 0
    ? { jobId: record.jobId, projectId: record.projectId }
    : null;
}

function eventFields(
  event: string,
  payload: { jobId: string; projectId: string },
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    event,
    jobId: payload.jobId,
    projectId: payload.projectId,
    ...fields,
  };
}

async function failJob(
  dataSource: DataSource,
  jobId: string,
  projectId: string,
  progress: number,
  failedStage: OoxmlReferenceTemplateGenerationStage,
  code: string,
  retryable: boolean,
): Promise<Job> {
  return updateJob(dataSource, jobId, projectId, {
    status: "failed",
    progress: Math.max(0, progress),
    message: "OOXML reference template generation failed.",
    result: null,
    error: {
      code,
      message: "OOXML reference template generation failed.",
      failedStage,
      retryable,
    },
  });
}

async function loadJob(
  dataSource: DataSource,
  jobId: string,
  projectId: string,
): Promise<Job> {
  const rows = await dataSource.query(
    `
      SELECT * FROM jobs
      WHERE job_id = $1 AND project_id = $2
        AND type = 'ooxml-reference-template-generation'
      LIMIT 1
    `,
    [jobId, projectId],
  );
  const row = firstRow<JobRow>(rows);
  if (!row) throw new Error("OOXML reference template generation Job not found.");
  return rowToJob(row);
}

async function updateJob(
  dataSource: DataSource,
  jobId: string,
  projectId: string,
  patch: {
    status: "running" | "failed";
    progress: number;
    message: string;
    result: Record<string, unknown> | null;
    error: Job["error"];
  },
): Promise<Job> {
  const rows = await dataSource.query(
    `
      UPDATE jobs
      SET status = $3, progress = $4, message = $5,
          result = $6, error = $7, updated_at = now()
      WHERE job_id = $1 AND project_id = $2
        AND type = 'ooxml-reference-template-generation'
        AND status IN ('queued', 'running', 'failed')
      RETURNING *
    `,
    [
      jobId,
      projectId,
      patch.status,
      patch.progress,
      patch.message,
      patch.result,
      patch.error,
    ],
  );
  const row = firstRow<JobRow>(rows);
  if (!row) throw new Error("OOXML reference template generation Job is not writable.");
  return rowToJob(row);
}

function firstRow<T>(result: unknown): T | null {
  if (!Array.isArray(result)) return null;
  const first = result[0];
  if (Array.isArray(first)) return (first[0] as T | undefined) ?? null;
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
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Job timestamp.");
  return date.toISOString();
}
