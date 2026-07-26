import {
  generateDeckResearchIssueCodeSchema,
  generateDeckResearchQualitySchema,
  generateDeckRequestSchema,
  generateDeckStoredJobPayloadSchema,
  referenceExtractionResultSchema,
  type GenerateDeckRequest,
} from "@orbit/shared/deck";
import {
  aiDeckGenerationStageMessageSchema,
  jobErrorSchema,
  jobSchema,
  jobStatusSchema,
  type AiDeckGenerationStageMessage,
  type Job,
  type JobError,
} from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { z } from "zod";

import { AiDeckPlanningArtifactRepository } from "./planning-artifact-repository";
import { coverSlideArtifactPayloadSchema } from "./execution-stage-contract";
import {
  contentPlanningArtifactPayloadSchema,
  designPlanningArtifactPayloadSchema,
  isAiDeckPlanningStage,
  isLayoutCompileV2Artifact,
  layoutCompileArtifactPayloadSchema,
  sourceGroundingArtifactPayloadSchema,
  type AiDeckPlanningArtifactPayload,
  type AiDeckPlanningStage,
} from "./planning-stage-contract";
import {
  AiDeckPlanningStageError,
  contentPlanningStageInput,
  designPlanningStageInput,
  executeAiDeckPlanningStage,
  layoutCompileStageInput,
  sourceGroundingStageInput,
  type AiDeckPlanningStagePythonClientOptions,
} from "./planning-stage-python-client";
import {
  AiDeckGenerationStageCheckpointRepository,
  type AiDeckGenerationStageCheckpoint,
} from "./stage-checkpoint-repository";
import {
  compactDiagnostics,
  contractErrorDiagnostics,
  emitStageEvent,
  stageEventFields,
  unknownErrorDiagnostics,
  type AiDeckStageEventLogger,
  type SafeStageErrorDiagnostics,
} from "./stage-diagnostics";

const planningMessageSchema = aiDeckGenerationStageMessageSchema.refine(
  (message) => isAiDeckPlanningStage(message.stage),
  { message: "Planning stage required" },
);
const extractionRowSchema = z.object({ extraction_json: z.unknown() });
const sourceGroundingResearchDiagnosticsSchema = z.object({
  research_quality: generateDeckResearchQualitySchema,
  research_issue_codes: z.array(generateDeckResearchIssueCodeSchema),
  research_attempts: z.number().int().nonnegative(),
  relevant_web_source_count: z.number().int().nonnegative(),
  official_web_source_count: z.number().int().nonnegative(),
  independent_web_source_count: z.number().int().nonnegative(),
  research_fact_coverage_satisfied: z.boolean(),
  web_research_timed_out: z.boolean().default(false),
  web_research_elapsed_ms: z.number().int().nonnegative().default(0),
});
const contentFactDiagnosticsSchema = z.object({
  factValidationDurationMs: z.number().int().nonnegative().default(0),
  factRepairAttempted: z.boolean().default(false),
  factRepairSucceeded: z.boolean().default(false),
  factRepairDurationMs: z.number().int().nonnegative().default(0),
  factRepairEligibleSlideOrders: z
    .array(z.number().int().positive())
    .default([]),
  factQualityIssues: z
    .array(
      z.object({
        code: z.string(),
        slideOrder: z.number().int().positive(),
      }),
    )
    .default([]),
});
const coverFactContextSchema = z.object({
  criticalFacts: z
    .array(
      z.object({
        factId: z.string(),
        canonicalText: z.string(),
        sourceRefs: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  evidenceObligations: z
    .array(
      z.object({
        obligationId: z.string(),
        canonicalText: z.string(),
        sourceRefs: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  communicationContract: z
    .object({
      placementConstraints: z
        .array(
          z.object({
            targetId: z.string(),
            slideRole: z.enum(["cover", "body", "closing"]),
            elementRole: z.enum(["title", "subtitle", "message", "body"]),
            slideOrder: z.number().int().positive().nullable().default(null),
          }),
        )
        .default([]),
    })
    .default({ placementConstraints: [] }),
  factQualityIssues: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        slideOrder: z.number().int().positive(),
      }),
    )
    .default([]),
  sourceRecords: z
    .array(
      z
        .object({
          sourceId: z.string(),
          sourceType: z.enum(["topic", "uploaded", "web", "generated", "none"]),
          fileId: z.string().nullable().optional(),
          chunkId: z.string().nullable().optional(),
          url: z.string().nullable().optional(),
          title: z.string().default(""),
          authority: z.enum(["official", "independent", "unknown"]).default("unknown"),
          confidence: z.number().min(0).max(1).default(0.5),
        })
        .passthrough(),
    )
    .default([]),
});
const coverStoryContextSchema = z.object({
  slidePlans: z
    .array(
      z.object({
        order: z.number().int().positive(),
        title: z.string(),
        message: z.string(),
      }).passthrough(),
    )
    .min(1),
});
const timestampSchema = z.union([z.date(), z.string().min(1)]);
const parentJobRowSchema = z.object({
  job_id: z.string().min(1),
  project_id: z.string().min(1),
  type: z.literal("ai-deck-generation"),
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  result: z.record(z.unknown()).nullable(),
  error: jobErrorSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

const nextStageByStage: Partial<
  Record<AiDeckPlanningStage, AiDeckPlanningStage>
> = {
  "source-grounding": "content-planning",
  "content-planning": "design-planning",
  "design-planning": "layout-compile",
};
const progressByStage: Record<AiDeckPlanningStage, number> = {
  "source-grounding": 25,
  "content-planning": 40,
  "design-planning": 50,
  "layout-compile": 60,
};

export interface AiDeckPlanningStageProcessorOptions extends AiDeckPlanningStagePythonClientOptions {
  heartbeatIntervalMs?: number;
  eventLogger?: AiDeckStageEventLogger;
  claimedCheckpoint?: AiDeckGenerationStageCheckpoint;
}

export async function processAiDeckPlanningStage(
  dataSource: DataSource,
  pythonWorkerUrl: string,
  workerId: string,
  rawMessage: unknown,
  options: AiDeckPlanningStageProcessorOptions = {},
): Promise<Job | void> {
  const parsedMessage = planningMessageSchema.parse(rawMessage);
  if (!isAiDeckPlanningStage(parsedMessage.stage)) {
    throw new Error("Planning stage required.");
  }
  const message = { ...parsedMessage, stage: parsedMessage.stage };
  const checkpoints = new AiDeckGenerationStageCheckpointRepository(dataSource);
  const claimed =
    options.claimedCheckpoint ?? (await checkpoints.claim(message, workerId));
  if (!claimed) return;
  assertClaimMatches(message, claimed);
  if (!claimed.leaseOwner) {
    throw new Error("Claimed stage is missing its lease owner.");
  }
  const startedAt = Date.now();
  emitStageEvent(
    options.eventLogger,
    "ai-ppt.stage.started",
    stageEventFields(message, workerId, claimed.attempt, startedAt),
  );

  const controller = new AbortController();
  let leaseLost = false;
  let heartbeatRunning = false;
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || leaseLost) return;
    heartbeatRunning = true;
    void checkpoints
      .renewLease(message, claimed.leaseOwner!, claimed.attempt)
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
    const input = await buildStageInput(dataSource, message, claimed.inputRef);
    const payload = await executeAiDeckPlanningStage(
      pythonWorkerUrl,
      message.stage,
      input,
      {
        fetchImpl: options.fetchImpl,
        signal: AbortSignal.any([
          controller.signal,
          options.signal ?? AbortSignal.timeout(180_000),
        ]),
      },
    );
    if (leaseLost) return;
    if (message.stage === "source-grounding") {
      const sourcePayload = sourceGroundingArtifactPayloadSchema.parse(payload);
      const research = sourceGroundingResearchDiagnosticsSchema.safeParse(
        sourcePayload.rawInput,
      );
      if (
        research.success &&
        (research.data.research_quality !== "not-run" ||
          research.data.research_attempts > 0 ||
          research.data.web_research_timed_out)
      ) {
        emitStageEvent(
          options.eventLogger,
          "ai-ppt.web-research.completed",
          {
            pipelineJobId: message.pipelineJobId,
            projectId: message.projectId,
            quality: research.data.research_quality,
            issueCodes: research.data.research_issue_codes,
            attempts: research.data.research_attempts,
            relevantSourceCount: research.data.relevant_web_source_count,
            officialSourceCount: research.data.official_web_source_count,
            independentSourceCount:
              research.data.independent_web_source_count,
            factCoverageSatisfied:
              research.data.research_fact_coverage_satisfied,
            timedOut: research.data.web_research_timed_out,
            elapsedMs: research.data.web_research_elapsed_ms,
          },
        );
      }
    }
    if (message.stage === "content-planning") {
      const contentPayload = contentPlanningArtifactPayloadSchema.parse(payload);
      const diagnostics = contentFactDiagnosticsSchema.parse(
        contentPayload.rawInput,
      );
      emitStageEvent(
        options.eventLogger,
        "ai-ppt.fact-validation.completed",
        {
          pipelineJobId: message.pipelineJobId,
          projectId: message.projectId,
          durationMs: diagnostics.factValidationDurationMs,
          issueCodes: [
            ...new Set(diagnostics.factQualityIssues.map((issue) => issue.code)),
          ],
          slideOrders: [
            ...new Set(
              diagnostics.factQualityIssues.map((issue) => issue.slideOrder),
            ),
          ],
        },
      );
      if (diagnostics.factRepairAttempted) {
        emitStageEvent(
          options.eventLogger,
          "ai-ppt.fact-repair.attempted",
          {
            pipelineJobId: message.pipelineJobId,
            projectId: message.projectId,
            durationMs: diagnostics.factRepairDurationMs,
            slideOrders: diagnostics.factRepairEligibleSlideOrders,
            repairCount: diagnostics.factRepairEligibleSlideOrders.length,
            succeeded: diagnostics.factRepairSucceeded,
          },
        );
      }
    }
    const result = await completeStage(
      dataSource,
      message,
      claimed.leaseOwner,
      claimed.attempt,
      payload,
    );
    emitStageEvent(
      options.eventLogger,
      "ai-ppt.stage.succeeded",
      stageEventFields(message, workerId, claimed.attempt, startedAt),
    );
    return result;
  } catch (error) {
    if (leaseLost || error instanceof AiDeckStageFencingLostError) return;
    if (isRetrySignal(error)) throw error;
    const normalized = normalizeStageError(error, message.stage);
    const diagnostics = planningErrorDiagnostics(error, normalized);
    if (normalized.retryable && claimed.attempt < 5) {
      const released = await checkpoints.releaseForRetry(
        message,
        claimed.leaseOwner,
        claimed.attempt,
        normalized,
      );
      if (released) {
        emitStageEvent(
          options.eventLogger,
          "ai-ppt.stage.attempt-failed",
          stageEventFields(
            message,
            workerId,
            claimed.attempt,
            startedAt,
            false,
            diagnostics,
          ),
        );
        throw retrySignal();
      }
      return;
    }
    const result = await failStageAndParent(
      dataSource,
      message,
      claimed.leaseOwner,
      claimed.attempt,
      normalized,
    );
    if (result) {
      emitStageEvent(
        options.eventLogger,
        "ai-ppt.stage.failed",
        stageEventFields(
          message,
          workerId,
          claimed.attempt,
          startedAt,
          true,
          diagnostics,
        ),
      );
    }
    return result;
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

async function buildStageInput(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: AiDeckPlanningStage },
  inputRef: Record<string, unknown>,
): Promise<unknown> {
  const artifacts = new AiDeckPlanningArtifactRepository(dataSource);
  switch (message.stage) {
    case "source-grounding":
      const groundingInput = await loadGroundingRequest(dataSource, message);
      return sourceGroundingStageInput(
        message.projectId,
        groundingInput.request,
        groundingInput.savedDesignPreferences,
      );
    case "content-planning": {
      const artifact = await artifacts.get(
        message,
        inputRef,
        "source-grounding",
      );
      return contentPlanningStageInput(
        sourceGroundingArtifactPayloadSchema.parse(artifact.payload),
      );
    }
    case "design-planning": {
      const artifact = await artifacts.get(
        message,
        inputRef,
        "content-planning",
      );
      return designPlanningStageInput(
        await applySelectedDesign(dataSource, message, artifact.payload),
        true,
      );
    }
    case "layout-compile": {
      const design = await artifacts.get(message, inputRef, "design-planning");
      const content = await artifacts.getByStage(message, "content-planning");
      const source = await artifacts.getByStage(message, "source-grounding");
      return layoutCompileStageInput(
        contentPlanningArtifactPayloadSchema.parse(content.payload),
        designPlanningArtifactPayloadSchema.parse(design.payload),
        sourceGroundingArtifactPayloadSchema.parse(source.payload).warnings,
      );
    }
  }
}

async function applySelectedDesign(
  dataSource: Pick<DataSource, "query">,
  message: AiDeckGenerationStageMessage,
  rawContent: unknown,
) {
  const content = contentPlanningArtifactPayloadSchema.parse(rawContent);
  const parent = firstQueryRow(
    await dataSource.query(
      `SELECT payload FROM jobs
       WHERE job_id = $1 AND project_id = $2 AND type = 'ai-deck-generation'`,
      [message.pipelineJobId, message.projectId],
    ),
  );
  if (!parent || typeof parent !== "object" || !("payload" in parent)) {
    throw new Error("AI deck generation parent job not found.");
  }
  const stored = generateDeckStoredJobPayloadSchema.parse(parent.payload);
  if (!stored.designSelection) return content;
  const rawInput = z.record(z.unknown()).parse(content.rawInput);
  const rawDesign = z.record(z.unknown()).catch({}).parse(rawInput.design);
  return contentPlanningArtifactPayloadSchema.parse({
    ...content,
    rawInput: {
      ...rawInput,
      designPrompt:
        stored.designSelection.designPrompt ?? stored.request.designPrompt ?? "",
      design: {
        ...rawDesign,
        paletteOverride: stored.designSelection.paletteOverride,
        fontOverride: stored.designSelection.fontOverride,
      },
    },
  });
}

async function loadGroundingRequest(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage,
): Promise<{
  request: GenerateDeckRequest;
  savedDesignPreferences: Record<string, unknown>;
}> {
  const parentRows = await dataSource.query(
    `
      SELECT payload
      FROM jobs
      WHERE job_id = $1
        AND project_id = $2
        AND type = 'ai-deck-generation'
        AND status IN ('queued','running')
    `,
    [message.pipelineJobId, message.projectId],
  );
  const rawParent = firstQueryRow(parentRows);
  if (
    !rawParent ||
    typeof rawParent !== "object" ||
    !("payload" in rawParent)
  ) {
    throw new Error("AI deck generation parent job not found.");
  }
  const storedPayload = generateDeckStoredJobPayloadSchema.parse(
    rawParent.payload,
  );
  const request = storedPayload.request;
  const extractionRows = await dataSource.query(
    `
      SELECT extraction_json
      FROM ai_deck_reference_extraction_artifacts
      WHERE pipeline_job_id = $1
        AND project_id = $2
        AND usable = true
      ORDER BY file_id
    `,
    [message.pipelineJobId, message.projectId],
  );
  const savedDesignPreferences =
    storedPayload.designPackSnapshot?.preferences ?? {};
  if (!Array.isArray(extractionRows)) {
    return { request, savedDesignPreferences };
  }
  const covered = new Set(request.referenceContext.map((item) => item.fileId));
  const extractedContexts = extractionRows.flatMap((rawRow) => {
    const row = extractionRowSchema.parse(rawRow);
    const result = referenceExtractionResultSchema.parse({
      files: [row.extraction_json],
    });
    const extraction = result.files[0];
    if (!extraction || covered.has(extraction.fileId)) return [];
    const content = (extraction.cleanedText || extraction.rawText).trim();
    if (!extraction.usable || !content) return [];
    covered.add(extraction.fileId);
    return [
      {
        fileId: extraction.fileId,
        title: extraction.fileName,
        content,
        sourceId: `reference:${extraction.fileId}`,
      },
    ];
  });
  return {
    request: generateDeckRequestSchema.parse({
      ...request,
      referenceContext: [...request.referenceContext, ...extractedContexts],
    }),
    savedDesignPreferences,
  };
}

async function completeStage(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: AiDeckPlanningStage },
  leaseOwner: string,
  attempt: number,
  payload: AiDeckPlanningArtifactPayload,
): Promise<Job> {
  return dataSource.transaction(async (manager) => {
    const artifacts = new AiDeckPlanningArtifactRepository(manager);
    const checkpoints = new AiDeckGenerationStageCheckpointRepository(manager);
    const resultRef = await artifacts.upsert(message, payload);
    const succeeded = await checkpoints.succeed(
      message,
      leaseOwner,
      attempt,
      resultRef,
    );
    if (!succeeded) throw new AiDeckStageFencingLostError();

    if (
      message.stage === "content-planning" &&
      !(await canStartDesignPlanning(manager, message))
    ) {
      return updateParentProgress(
        manager,
        message,
        progressByStage[message.stage],
      );
    }

    const nextStage = nextStageByStage[message.stage];
    if (nextStage) {
      const next = await checkpoints.ensureQueued(
        { ...message, stage: nextStage },
        resultRef,
      );
      if (!next)
        throw new Error("Next AI deck planning checkpoint was not created.");
    } else {
      await ensureImageOrSemanticCheckpoints(
        manager,
        checkpoints,
        message,
        payload,
        resultRef,
      );
    }
    return updateParentProgress(
      manager,
      message,
      progressByStage[message.stage],
    );
  });
}

async function canStartDesignPlanning(
  manager: Pick<DataSource, "query">,
  message: AiDeckGenerationStageMessage,
): Promise<boolean> {
  const parent = firstQueryRow(
    await manager.query(
      `
        SELECT payload
        FROM jobs
        WHERE job_id = $1 AND project_id = $2
          AND type = 'ai-deck-generation'
        FOR UPDATE
      `,
      [message.pipelineJobId, message.projectId],
    ),
  );
  if (!parent || typeof parent !== "object" || !("payload" in parent)) {
    return false;
  }
  const stored = generateDeckStoredJobPayloadSchema.parse(parent.payload);
  if (!stored.designSelection) return false;
  if (!stored.coverPlan) return true;
  const cover = firstQueryRow(
    await manager.query(
      `SELECT status FROM ai_deck_generation_stages
       WHERE pipeline_job_id = $1
         AND stage = 'cover-slide' AND shard_key = ''`,
      [message.pipelineJobId],
    ),
  );
  return Boolean(
    cover &&
      typeof cover === "object" &&
      "status" in cover &&
      (cover.status === "succeeded" || cover.status === "failed"),
  );
}

async function ensureImageOrSemanticCheckpoints(
  db: Pick<DataSource, "query">,
  checkpoints: AiDeckGenerationStageCheckpointRepository,
  message: AiDeckGenerationStageMessage & { stage: AiDeckPlanningStage },
  payload: AiDeckPlanningArtifactPayload,
  layoutReference: Record<string, unknown>,
): Promise<void> {
  if (message.stage !== "layout-compile") return;
  const layout = layoutCompileArtifactPayloadSchema.parse(payload);
  if (isLayoutCompileV2Artifact(layout)) {
    const coverSourceOrder = await finalizeCoverForLayout(
      db,
      message,
      layout,
    );
    let queued = 0;
    for (const slide of layout.slides) {
      if (slide.sourceOrder === coverSourceOrder) continue;
      const next = await checkpoints.ensureQueued(
        {
          ...message,
          stage: "image-slide",
          shardKey: slide.shardKey,
        },
        layoutReference,
      );
      if (!next) {
        throw new Error("Next AI deck slide checkpoint was not created.");
      }
      queued += 1;
    }
    if (queued === 0 && coverSourceOrder !== null) {
      await checkpoints.ensureQueued(
        { ...message, stage: "semantic-quality", shardKey: "" },
        layoutReference,
      );
    }
    return;
  }
  const visualRequirements = z
    .object({
      items: z.array(
        z.object({
          slideId: z.string().min(1),
          visualPlan: z
            .object({ imageNeeded: z.boolean().optional() })
            .passthrough(),
        }),
      ),
    })
    .parse(layout.visualRequirements);
  const slideIds = visualRequirements.items
    .filter((item) => item.visualPlan.imageNeeded === true)
    .map((item) => item.slideId);
  const nextMessages =
    slideIds.length > 0
      ? slideIds.map((slideId) => ({
          ...message,
          stage: "image-slide" as const,
          shardKey: slideId,
        }))
      : [
          {
            ...message,
            stage: "semantic-quality" as const,
            shardKey: "",
          },
        ];
  for (const nextMessage of nextMessages) {
    const next = await checkpoints.ensureQueued(nextMessage, layoutReference);
    if (!next)
      throw new Error("Next AI deck execution checkpoint was not created.");
  }
}

async function finalizeCoverForLayout(
  db: Pick<DataSource, "query">,
  message: AiDeckGenerationStageMessage,
  layout: Extract<
    ReturnType<typeof layoutCompileArtifactPayloadSchema.parse>,
    { artifactVersion: 2 }
  >,
): Promise<number | null> {
  const descriptor = [...layout.slides].sort(
    (left, right) => left.order - right.order,
  )[0];
  if (!descriptor || descriptor.order !== 1) return null;
  const rawCover = firstQueryRow(
    await db.query(
      `SELECT artifacts.payload_json
       FROM ai_deck_execution_artifacts artifacts
       JOIN ai_deck_generation_stages stages
         ON stages.pipeline_job_id = artifacts.pipeline_job_id
        AND stages.stage = artifacts.stage
        AND stages.shard_key = artifacts.shard_key
       WHERE artifacts.pipeline_job_id = $1 AND artifacts.project_id = $2
         AND artifacts.stage = 'cover-slide' AND stages.status = 'succeeded'`,
      [message.pipelineJobId, message.projectId],
    ),
  );
  if (
    !rawCover ||
    typeof rawCover !== "object" ||
    !("payload_json" in rawCover)
  ) return null;
  const cover = coverSlideArtifactPayloadSchema.parse(rawCover.payload_json);
  const sourceSlide = cover.deck.slides[0];
  if (!sourceSlide) return null;
  const factContext = await loadCoverFactContext(db, message);
  const slide = applyCoverFactContext({
    ...sourceSlide,
    slideId: descriptor.slideId,
    order: descriptor.order,
  }, factContext);
  const appliedCoverPlacement =
    factContext.raw.communicationContract.placementConstraints.some(
      (constraint) =>
        constraint.slideRole === "cover" &&
        ["title", "subtitle"].includes(constraint.elementRole),
    );
  const contentIssues = factContext.raw.factQualityIssues
    .filter(
      (issue) =>
        issue.slideOrder === 1 &&
        !(appliedCoverPlacement && issue.code === "FACT_PLACEMENT_MISMATCH"),
    )
    .map((issue) => ({
      code: issue.code,
      scope: "slide" as const,
      severity: "warning" as const,
      blocking: false,
      path: "slides.0.content",
      message: issue.message,
    }));
  const mergedContentIssues = [
    ...cover.validation.contentIssues,
    ...contentIssues,
  ];
  const finalizedCover = coverSlideArtifactPayloadSchema.parse({
    deck: { ...cover.deck, slides: [slide] },
    warnings: cover.warnings,
    validation: {
      ...cover.validation,
      passed: cover.validation.passed && mergedContentIssues.length === 0,
      contentIssues: mergedContentIssues,
    },
  });
  const updatedRows = await db.query(
    `UPDATE ai_deck_execution_artifacts
     SET payload_json = $3::jsonb, updated_at = now()
     WHERE pipeline_job_id = $1 AND project_id = $2
       AND stage = 'cover-slide' AND shard_key = ''
     RETURNING artifact_id`,
    [
      message.pipelineJobId,
      message.projectId,
      finalizedCover,
    ],
  );
  return firstQueryRow(updatedRows) ? descriptor.sourceOrder : null;
}

async function loadCoverFactContext(
  db: Pick<DataSource, "query">,
  message: AiDeckGenerationStageMessage,
) {
  const row = firstQueryRow(
    await db.query(
      `SELECT payload_json
       FROM ai_deck_planning_artifacts
       WHERE pipeline_job_id = $1 AND project_id = $2
         AND stage = 'content-planning' AND shard_key = ''`,
      [message.pipelineJobId, message.projectId],
    ),
  );
  const payload = contentPlanningArtifactPayloadSchema.parse(
    z.object({ payload_json: z.unknown() }).parse(row).payload_json,
  );
  return {
    raw: coverFactContextSchema.parse(payload.rawInput),
    story: coverStoryContextSchema.parse(payload.contentPlan),
  };
}

function applyCoverFactContext(
  slide: ReturnType<typeof coverSlideArtifactPayloadSchema.parse>["deck"]["slides"][number],
  context: Awaited<ReturnType<typeof loadCoverFactContext>>,
) {
  const placements = context.raw.communicationContract.placementConstraints.filter(
    (constraint) =>
      constraint.slideRole === "cover" &&
      (constraint.slideOrder === null || constraint.slideOrder === 1),
  );
  const targets = new Map<
    string,
    { canonicalText: string; sourceRefs: string[] }
  >();
  for (const fact of context.raw.criticalFacts) targets.set(fact.factId, fact);
  for (const obligation of context.raw.evidenceObligations) {
    targets.set(obligation.obligationId, obligation);
  }
  const titlePlacement = placements.find(
    (constraint) => constraint.elementRole === "title",
  );
  const subtitlePlacement = placements.find(
    (constraint) => constraint.elementRole === "subtitle",
  );
  const titleTarget = titlePlacement
    ? targets.get(titlePlacement.targetId)
    : undefined;
  const subtitleTarget = subtitlePlacement
    ? targets.get(subtitlePlacement.targetId)
    : undefined;
  const story = context.story.slidePlans[0];
  const title = titleTarget?.canonicalText || slide.title || story.title;
  const subtitle = subtitleTarget?.canonicalText || "";
  const titleElement = slide.elements.find(
    (element) => element.elementId === "el_cover_title" && element.type === "text",
  );
  const elements = slide.elements.map((element) =>
    element === titleElement && element.type === "text"
      ? {
          ...element,
          height: subtitle ? 350 : element.height,
          props: { ...element.props, text: title },
        }
      : element,
  );
  if (subtitle && titleElement?.type === "text") {
    elements.push({
      elementId: "el_cover_subtitle",
      type: "text",
      role: "subtitle",
      x: titleElement.x,
      y: 730,
      width: Math.min(titleElement.width, 1120),
      height: 150,
      rotation: 0,
      opacity: 1,
      zIndex: titleElement.zIndex + 1,
      locked: false,
      visible: true,
      props: {
        ...titleElement.props,
        text: subtitle,
        fontSize: 34,
        fontWeight: "medium",
        lineHeight: 1.3,
      },
    });
  }
  const placedTargets = [titleTarget, subtitleTarget].filter(
    (target): target is NonNullable<typeof target> => Boolean(target),
  );
  const sourceMap = new Map(
    context.raw.sourceRecords.map((source) => [source.sourceId, source]),
  );
  const sourceLedger = placedTargets.flatMap((target) => {
    const source = target.sourceRefs.map((sourceId) => sourceMap.get(sourceId)).find(Boolean);
    if (!source) return [];
    return [{
      claim: target.canonicalText,
      source: source.title || source.sourceId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      ...(source.fileId ? { fileId: source.fileId } : {}),
      ...(source.chunkId ? { chunkId: source.chunkId } : {}),
      ...(source.url ? { url: source.url } : {}),
      ...(source.title ? { title: source.title } : {}),
      authority: source.authority,
      confidence: source.confidence,
      usedInSlideId: slide.slideId,
    }];
  });
  return {
    ...slide,
    title,
    elements,
    aiNotes: {
      ...slide.aiNotes,
      emphasisPoints: [...new Set([title, subtitle, story.message].filter(Boolean))],
      ...(sourceLedger.length > 0 ? { sourceLedger } : {}),
    },
  };
}

async function failStageAndParent(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: AiDeckPlanningStage },
  leaseOwner: string,
  attempt: number,
  rawError: JobError,
): Promise<Job | void> {
  const error = jobErrorSchema.parse(rawError);
  return dataSource.transaction(async (manager) => {
    const failed = await new AiDeckGenerationStageCheckpointRepository(
      manager,
    ).fail(message, leaseOwner, attempt, error);
    if (!failed) return;
    const rows = await manager.query(
      `
        UPDATE jobs
        SET status = 'failed',
            message = 'AI deck generation failed.',
            error = $3::jsonb,
            updated_at = now()
        WHERE job_id = $1
          AND project_id = $2
          AND type = 'ai-deck-generation'
          AND status IN ('queued','running')
        RETURNING *
      `,
      [message.pipelineJobId, message.projectId, error],
    );
    return parentJobFromQuery(rows);
  });
}

async function updateParentProgress(
  db: Pick<DataSource, "query">,
  message: AiDeckGenerationStageMessage,
  progress: number,
): Promise<Job> {
  const rows = await db.query(
    `
      UPDATE jobs
      SET status = 'running',
          progress = GREATEST(progress, $3),
          message = 'AI deck staged generation running.',
          error = NULL,
          updated_at = now()
      WHERE job_id = $1
        AND project_id = $2
        AND type = 'ai-deck-generation'
        AND status IN ('queued','running')
      RETURNING *
    `,
    [message.pipelineJobId, message.projectId, progress],
  );
  const job = parentJobFromQuery(rows);
  if (!job) throw new Error("AI deck generation parent job is not runnable.");
  return job;
}

function normalizeStageError(
  error: unknown,
  stage: AiDeckPlanningStage,
): JobError {
  if (error instanceof AiDeckPlanningStageError) {
    return jobErrorSchema.parse({
      code: error.code,
      message: error.message,
      failedStage: stage,
      retryable: error.retryable,
    });
  }
  if (error instanceof z.ZodError) {
    return jobErrorSchema.parse({
      code: "AI_DECK_PLANNING_CONTRACT_INVALID",
      message: "AI deck planning stage contract is invalid.",
      failedStage: stage,
      retryable: false,
    });
  }
  return jobErrorSchema.parse({
    code: "AI_DECK_PLANNING_INTERNAL_ERROR",
    message: "AI deck planning stage could not be completed.",
    failedStage: stage,
    retryable: true,
  });
}

function planningErrorDiagnostics(
  error: unknown,
  normalized: JobError,
): SafeStageErrorDiagnostics {
  if (error instanceof AiDeckPlanningStageError) {
    return compactDiagnostics({
      code: normalized.code,
      reasonCode: error.diagnostics.reasonCode,
      name: error.name,
      httpStatus: error.diagnostics.httpStatus,
      providerHttpStatus: error.diagnostics.providerHttpStatus,
      provider: error.diagnostics.provider,
      providerRequestId: error.diagnostics.providerRequestId,
      retryAfterMs: error.diagnostics.retryAfterMs,
    });
  }
  if (error instanceof z.ZodError) {
    return contractErrorDiagnostics(
      error,
      normalized.code,
      "PLANNING_RESPONSE_CONTRACT_INVALID",
    );
  }
  return unknownErrorDiagnostics(
    error,
    normalized.code,
    "PLANNING_FAILURE_UNCLASSIFIED",
  );
}

class AiDeckStageFencingLostError extends Error {
  constructor() {
    super("AI deck planning stage lease fencing was lost.");
    this.name = "AiDeckStageFencingLostError";
  }
}

function retrySignal(): Error {
  const error = new Error("AI_DECK_STAGE_RETRY");
  error.name = "AiDeckStageRetrySignal";
  return error;
}

function isRetrySignal(error: unknown): boolean {
  return error instanceof Error && error.message === "AI_DECK_STAGE_RETRY";
}

function parentJobFromQuery(queryResult: unknown): Job | void {
  const raw = firstQueryRow(queryResult);
  if (!raw) return;
  const row = parentJobRowSchema.parse(raw);
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
    updatedAt: toIso(row.updated_at),
  });
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
