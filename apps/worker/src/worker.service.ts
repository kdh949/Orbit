import {
  deckExportQueueName,
  generateDeckJobName,
  generateDeckQueueName,
  generateDeckStagedCoordinatorJobName,
  pptxOoxmlGenerationQueueName,
  pptxOoxmlSyncQueueName,
  redisConnectionOptions,
  referenceExtractJobName,
  referenceExtractQueueName,
  rehearsalSemanticEvaluationQueueName,
  rehearsalSttQueueName,
  semanticCueExtractionQueueName,
  speakerNotesSuggestionQueueName,
  workerHealthCheckQueueName,
  focusedPracticeAnalysisQueueName,
  slidePracticeAnalysisQueueName,
  challengeQnaGenerationQueueName,
  challengeQnaAnswerAnalysisQueueName,
  slideQuestionGuideGenerationQueueName,
  aiDeckResearchContentQueueName,
  aiDeckDesignLayoutQueueName,
  aiDeckImageQueueName,
  aiDeckQaFinalizeQueueName,
  designImageGenerationJobName,
  designImageGenerationQueueName,
  activityResponseRetentionQueueName,
  enqueueActivityResponseRetentionJob,
} from "@orbit/job-queue";
import { loadOrbitConfig } from "@orbit/config";
import type { Job as OrbitJob } from "@orbit/shared";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { type Job as BullMqJob, Worker as BullMqWorker } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { processDeckExportJob } from "./deck-export.processor";
import { processGenerateDeckJob } from "./generate-deck.processor";
import {
  type FailedCoordinatorScanCursor,
  reconcileFailedAiDeckCoordinatorJobs,
} from "./generate-deck/coordinator-failure-reconciler";
import { processAiDeckReferenceExtractionStage } from "./generate-deck/reference-extract-stage";
import { processAiDeckPlanningStage } from "./generate-deck/planning-stage.processor";
import { processAiDeckExecutionStage } from "./generate-deck/execution-stage.processor";
import { AiDeckPostgresStageRunner } from "./generate-deck/postgres-stage-runner";
import { dispatchAiDeckGenerationStages } from "./generate-deck/stage-dispatcher";
import { AiDeckGenerationStageCheckpointRepository } from "./generate-deck/stage-checkpoint-repository";
import { reconcileExpiredAiDeckStageLeases } from "./generate-deck/stage-reconciler";
import {
  initializePendingAiDeckGenerationJobs,
  processAiDeckStagedCoordinatorJob,
} from "./generate-deck/staged-coordinator";
import { recoverAiDeckBullMqFinalFailure } from "./generate-deck/transport-failure-recovery";
import { createImageAssetRuntime } from "./image-providers";
import { serializeLogError } from "./logging";
import { processPptxOoxmlGenerationJob } from "./pptx-ooxml-generation.processor";
import { processPptxOoxmlSyncJob } from "./pptx-ooxml-sync.processor";
import { processReferenceExtractJob } from "./reference-extract.processor";
import { RedisRehearsalTranscriptCache } from "./rehearsal-transcript-cache";
import { processRehearsalSemanticEvaluationJob } from "./rehearsal-semantic-evaluation.processor";
import { processRehearsalSttJob } from "./rehearsal-stt.processor";
import { processSemanticCueExtractionJob } from "./semantic-cue-extraction.processor";
import { processSpeakerNotesSuggestionJob } from "./speaker-notes-suggestion.processor";
import { workerStorage } from "./storage";
import { processWorkerHealthCheckJob } from "./worker-health-check.processor";
import { processFocusedPracticeAnalysisJob } from "./focused-practice-analysis.processor";
import { processSlidePracticeAnalysisJob } from "./slide-practice-analysis.processor";
import {
  enqueueExpiredRehearsalAudioDeletions,
  enqueueExpiredSlidePracticeAudioDeletions,
  reconcileStorageDeletionOutbox,
} from "./storage-deletion-reconciler";
import { processChallengeQnaGenerationJob } from "./challenge-qna-generation.processor";
import { processChallengeQnaAnswerJob } from "./challenge-qna-answer.processor";
import { ChallengeQnaEvidenceCache } from "./challenge-qna-evidence-cache";
import { processSlideQuestionGuideGenerationJob } from "./slide-question-guide-generation.processor";
import { deleteExpiredSlidePracticeData } from "./slide-practice-retention";
import { processDesignImageGenerationJob } from "./design-image-generation.processor";
import { dispatchDueActivityRetentionJobs } from "./activity-retention.dispatcher";
import { processActivityResponseRetentionJob } from "./activity-retention.processor";

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly config = loadOrbitConfig(process.env, { service: "worker" });
  private readonly allQueueNames = [
    referenceExtractQueueName,
    rehearsalSttQueueName,
    rehearsalSemanticEvaluationQueueName,
    generateDeckQueueName,
    deckExportQueueName,
    semanticCueExtractionQueueName,
    speakerNotesSuggestionQueueName,
    pptxOoxmlGenerationQueueName,
    pptxOoxmlSyncQueueName,
    workerHealthCheckQueueName,
    focusedPracticeAnalysisQueueName,
    slidePracticeAnalysisQueueName,
    challengeQnaGenerationQueueName,
    challengeQnaAnswerAnalysisQueueName,
    slideQuestionGuideGenerationQueueName,
    aiDeckResearchContentQueueName,
    aiDeckDesignLayoutQueueName,
    aiDeckImageQueueName,
    aiDeckQaFinalizeQueueName,
    designImageGenerationQueueName,
    activityResponseRetentionQueueName,
  ];
  private readonly workerId = `worker-${randomUUID()}`;
  private queueNames: string[] = [];
  private workers: BullMqWorker[] = [];
  private transcriptCache: RedisRehearsalTranscriptCache | null = null;
  private challengeQnaEvidenceCache: ChallengeQnaEvidenceCache | null = null;
  private storageDeletionTimer: ReturnType<typeof setInterval> | null = null;
  private activityRetentionTimer: ReturnType<typeof setInterval> | null = null;
  private aiDeckMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private aiDeckMaintenanceInFlight: Promise<void> | null = null;
  private aiDeckPostgresRunner: AiDeckPostgresStageRunner | null = null;
  private aiDeckFailedCoordinatorScanCursor: FailedCoordinatorScanCursor = {
    redisCursor: "0",
    pendingJobIds: [],
  };
  private readonly aiPptEventLogger = (
    event: string,
    fields: Record<string, unknown>,
  ) => {
    const level =
      event === "ai-ppt.stage.failed"
        ? "error"
        : event === "ai-ppt.stage.attempt-failed" ||
            event === "ai-ppt.image-asset.fallback"
          ? "warn"
          : "info";
    this.logger[level]({ event, ...fields }, "AI PPT generation event.");
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectPinoLogger(WorkerService.name)
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    if (this.config.JOB_QUEUE_DRIVER === "sqs") {
      throw new Error("SqsJobQueue adapter is not implemented yet.");
    }
    if (this.config.AI_DECK_EXECUTION_MODE === "sqs") {
      throw new Error("AI Deck SQS transport is not implemented yet.");
    }
    if (
      this.config.AI_DECK_WORKER_QUEUE !== "all" &&
      ![
        "reference-extract",
        "research-content",
        "design-layout",
        "image",
        "qa-finalize",
      ].includes(this.config.AI_DECK_WORKER_QUEUE)
    ) {
      throw new Error(
        `AI Deck worker role ${this.config.AI_DECK_WORKER_QUEUE} is not implemented.`,
      );
    }
    if (
      this.config.AI_DECK_WORKER_QUEUE !== "all" &&
      this.config.AI_DECK_EXECUTION_MODE !== "bullmq"
    ) {
      throw new Error(
        "Dedicated AI Deck worker roles are not implemented outside bullmq execution mode.",
      );
    }

    this.queueNames = this.aiDeckQueueNames();
    const storage = workerStorage();
    const imageRuntime = createImageAssetRuntime(this.config);
    const reconcileDeletions = () => {
      void (async () => {
        await enqueueExpiredRehearsalAudioDeletions(this.dataSource);
        await enqueueExpiredSlidePracticeAudioDeletions(this.dataSource);
        await reconcileStorageDeletionOutbox(this.dataSource, storage);
        const deleted = await deleteExpiredSlidePracticeData(this.dataSource);
        if (deleted.analysisCount > 0 || deleted.reportCount > 0 || deleted.baselineCount > 0) {
          this.logger.info({
            event: "slide_practice.retention_deleted",
            analysisCount: deleted.analysisCount,
            reportCount: deleted.reportCount,
            baselineCount: deleted.baselineCount,
          }, "Expired slide practice data deleted.");
        }
      })().catch(
        (error) => {
          this.logger.error(
            {
              event: "storage_deletion.reconcile_failed",
              error: serializeLogError(error),
            },
            "Storage deletion reconciliation failed.",
          );
        },
      );
    };
    if (this.config.AI_DECK_WORKER_QUEUE === "all") {
      reconcileDeletions();
      this.storageDeletionTimer = setInterval(reconcileDeletions, 30_000);
      const dispatchRetention = () => {
        void dispatchDueActivityRetentionJobs(
          this.dataSource,
          (payload) =>
            enqueueActivityResponseRetentionJob({
              ...payload,
              driver: this.config.JOB_QUEUE_DRIVER,
              redisUrl: this.config.REDIS_URL,
            }),
        )
          .then((result) => {
            if (result.scanned === 0 && result.normalizedExpired === 0) return;
            this.logger.info(
              { event: "activity_retention.dispatched", ...result },
              "Activity response retention jobs dispatched.",
            );
          })
          .catch((error) => {
            this.logger.error(
              {
                event: "activity_retention.dispatch_failed",
                error: serializeLogError(error),
              },
              "Activity response retention dispatch failed.",
            );
          });
      };
      dispatchRetention();
      this.activityRetentionTimer = setInterval(dispatchRetention, 30_000);
      this.transcriptCache = new RedisRehearsalTranscriptCache(
        this.config.PRIVATE_EVIDENCE_REDIS_URL,
      );
      this.challengeQnaEvidenceCache = new ChallengeQnaEvidenceCache(
        this.config.PRIVATE_EVIDENCE_REDIS_URL,
      );
    }

    const registrations: Array<{
      queueName: string;
      handler: (job: BullMqJob) => Promise<OrbitJob | void>;
    }> = [
      {
        queueName: referenceExtractQueueName,
        handler: (job) => {
          if (job.name === referenceExtractJobName) {
            return processReferenceExtractJob(
              this.dataSource,
              this.config.PYTHON_WORKER_URL,
              job.data,
            );
          }
          if (job.name === "reference-extract-file") {
            return processAiDeckReferenceExtractionStage(
              this.dataSource,
              storage,
              this.config.PYTHON_WORKER_URL,
              this.workerId,
              job.data,
            );
          }
          throw new Error(`Unsupported BullMQ job name: ${job.name}`);
        },
      },
      {
        queueName: rehearsalSttQueueName,
        handler: (job) =>
          processRehearsalSttJob(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            job.data,
            this.transcriptCache ?? undefined,
            (event) => {
              const level = event.event.endsWith(".partial") ? "warn" : "info";
              this.logger[level](
                event,
                "Rehearsal semantic evaluation updated.",
              );
            },
            (event) => {
              const { segments, ...summary } = event;
              const level =
                event.measurementState === "measured" ? "info" : "warn";
              this.logger[level](
                summary,
                "Rehearsal silence analysis completed.",
              );
              if (this.config.APP_ENV === "local" && segments.length > 0) {
                this.logger.debug(
                  {
                    event: "rehearsal.silence_analysis.segments",
                    runId: event.runId,
                    jobId: event.jobId,
                    segments,
                  },
                  "Rehearsal silence segments detected.",
                );
              }
            },
            (event) => {
              const level = event.event.endsWith(".unmeasured")
                ? "warn"
                : "info";
              this.logger[level](
                event,
                "Rehearsal slide speaking rate analyzed.",
              );
            },
            (event) => {
              const level = event.event.endsWith(".failed") ? "error" : "info";
              this.logger[level](event, "Rehearsal transcript artifacts updated.");
            },
          ),
      },
      {
        queueName: rehearsalSemanticEvaluationQueueName,
        handler: (job) =>
          processRehearsalSemanticEvaluationJob(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            job.data,
            this.transcriptCache!,
            (event) => {
              const level = event.event.endsWith(".retry_failed")
                ? "error"
                : "info";
              this.logger[level](
                event,
                "Rehearsal semantic evaluation retry updated.",
              );
            },
          ),
      },
      {
        queueName: generateDeckQueueName,
        handler: (job) => {
          if (job.name === generateDeckJobName) {
            return processGenerateDeckJob(
              this.dataSource,
              storage,
              this.config.PYTHON_WORKER_URL,
              job.data,
              imageRuntime,
              (event, fields) =>
                this.logger.info(
                  { event, ...fields },
                  "AI PPT generation event.",
                ),
            );
          }
          if (job.name === generateDeckStagedCoordinatorJobName) {
            return processAiDeckStagedCoordinatorJob(this.dataSource, job.data);
          }
          throw new Error(`Unsupported BullMQ job name: ${job.name}`);
        },
      },
      {
        queueName: aiDeckResearchContentQueueName,
        handler: (job) => {
          if (
            job.name !== "source-grounding" &&
            job.name !== "content-planning"
          ) {
            throw new Error(`Unsupported BullMQ job name: ${job.name}`);
          }
          return processAiDeckPlanningStage(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            this.workerId,
            job.data,
            { eventLogger: this.aiPptEventLogger },
          );
        },
      },
      {
        queueName: aiDeckDesignLayoutQueueName,
        handler: (job) => {
          if (job.name !== "design-planning" && job.name !== "layout-compile") {
            throw new Error(`Unsupported BullMQ job name: ${job.name}`);
          }
          return processAiDeckPlanningStage(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            this.workerId,
            job.data,
            { eventLogger: this.aiPptEventLogger },
          );
        },
      },
      {
        queueName: aiDeckImageQueueName,
        handler: (job) => {
          if (job.name !== "cover-slide" && job.name !== "image-slide") {
            throw new Error(`Unsupported BullMQ job name: ${job.name}`);
          }
          return processAiDeckExecutionStage(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            this.workerId,
            job.data,
            imageRuntime,
            {
              eventLogger: this.aiPptEventLogger,
            },
          );
        },
      },
      {
        queueName: designImageGenerationQueueName,
        handler: (job) => {
          if (job.name !== designImageGenerationJobName) {
            throw new Error(`Unsupported BullMQ job name: ${job.name}`);
          }
          return processDesignImageGenerationJob(
            this.dataSource,
            storage,
            imageRuntime,
            job.data,
          );
        },
      },
      {
        queueName: aiDeckQaFinalizeQueueName,
        handler: (job) => {
          if (
            job.name !== "semantic-quality" &&
            job.name !== "rendered-visual-quality" &&
            job.name !== "publication"
          ) {
            throw new Error(`Unsupported BullMQ job name: ${job.name}`);
          }
          return processAiDeckExecutionStage(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            this.workerId,
            job.data,
            imageRuntime,
            {
              eventLogger: this.aiPptEventLogger,
            },
          );
        },
      },
      {
        queueName: deckExportQueueName,
        handler: (job) =>
          processDeckExportJob(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: semanticCueExtractionQueueName,
        handler: (job) =>
          processSemanticCueExtractionJob(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: speakerNotesSuggestionQueueName,
        handler: (job) =>
          processSpeakerNotesSuggestionJob(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: pptxOoxmlGenerationQueueName,
        handler: (job) =>
          processPptxOoxmlGenerationJob(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: pptxOoxmlSyncQueueName,
        handler: (job) =>
          processPptxOoxmlSyncJob(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: workerHealthCheckQueueName,
        handler: (job) =>
          processWorkerHealthCheckJob(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: focusedPracticeAnalysisQueueName,
        handler: (job) =>
          processFocusedPracticeAnalysisJob(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: slidePracticeAnalysisQueueName,
        handler: (job) =>
          processSlidePracticeAnalysisJob(
            this.dataSource,
            storage,
            this.config.PYTHON_WORKER_URL,
            job.data,
            (event) => {
              const level = event.status === "unavailable" ? "warn" : "info";
              this.logger[level](
                event,
                "Slide practice coaching completed.",
              );
            },
          ),
      },
      {
        queueName: challengeQnaGenerationQueueName,
        handler: (job) =>
          processChallengeQnaGenerationJob(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: challengeQnaAnswerAnalysisQueueName,
        handler: (job) =>
          processChallengeQnaAnswerJob(
            this.dataSource,
            storage,
            this.challengeQnaEvidenceCache!,
            this.config.PYTHON_WORKER_URL,
            job.data,
          ),
      },
      {
        queueName: slideQuestionGuideGenerationQueueName,
        handler: (job) =>
          processSlideQuestionGuideGenerationJob(
            this.dataSource,
            this.config.PYTHON_WORKER_URL,
            job.data,
            (event) => {
              if (event.event === "slide_question_guide.generation.failed") {
                this.logger.error(
                  event,
                  "Slide question guide generation failed.",
                );
                return;
              }
              this.logger.info(
                event,
                "Slide question guide web research completed.",
              );
            },
          ),
      },
      {
        queueName: activityResponseRetentionQueueName,
        handler: (job) =>
          processActivityResponseRetentionJob(this.dataSource, job.data),
      },
    ];
    const selectedQueues = new Set(this.queueNames);
    this.workers = registrations
      .filter(({ queueName }) => selectedQueues.has(queueName))
      .map(({ queueName, handler }) => this.createWorker(queueName, handler));

    if (this.config.AI_DECK_EXECUTION_MODE === "pg") {
      if (
        this.config.AI_DECK_WORKER_CONCURRENCY === 1 ||
        this.config.AI_DECK_USER_CONCURRENCY === 1
      ) {
        this.logger.warn(
          {
            event: "ai_ppt.cover_preview.concurrency_limited",
            workerConcurrency: this.config.AI_DECK_WORKER_CONCURRENCY,
            userConcurrency: this.config.AI_DECK_USER_CONCURRENCY,
          },
          "AI deck cover preview can be delayed when PostgreSQL stage concurrency is 1.",
        );
      }
      this.aiDeckPostgresRunner = new AiDeckPostgresStageRunner({
        dataSource: this.dataSource,
        storage,
        pythonWorkerUrl: this.config.PYTHON_WORKER_URL,
        workerId: this.workerId,
        concurrency: this.config.AI_DECK_WORKER_CONCURRENCY,
        userConcurrency: this.config.AI_DECK_USER_CONCURRENCY,
        imageRuntime,
        eventLogger: this.aiPptEventLogger,
        onError: (error, claimed) => {
          const retryScheduled = isAiDeckStageRetrySignal(error);
          this.logger[retryScheduled ? "warn" : "error"](
            {
              event: retryScheduled
                ? "ai-ppt.stage.retry-scheduled"
                : "ai-ppt.stage.runner-failed",
              pipelineJobId: claimed.message.pipelineJobId,
              projectId: claimed.message.projectId,
              stage: claimed.message.stage,
              shardKey: claimed.message.shardKey,
              ...(retryScheduled ? {} : { error: serializeLogError(error) }),
            },
            retryScheduled
              ? "PostgreSQL AI deck stage retry scheduled."
              : "PostgreSQL AI deck stage runner failed.",
          );
        },
      });
      this.aiDeckPostgresRunner.start();
    }

    if (
      this.config.AI_DECK_EXECUTION_MODE === "bullmq" ||
      this.config.AI_DECK_EXECUTION_MODE === "pg"
    ) {
      const maintainAiDeckStages = () => {
        this.scheduleAiDeckStageMaintenance();
      };
      maintainAiDeckStages();
      this.aiDeckMaintenanceTimer = setInterval(maintainAiDeckStages, 5_000);
    }

    this.logger.info(
      {
        event: "worker.ready",
        workerId: this.workerId,
        driver: this.config.JOB_QUEUE_DRIVER,
        aiDeckExecutionMode: this.config.AI_DECK_EXECUTION_MODE,
        aiDeckWorkerQueue: this.config.AI_DECK_WORKER_QUEUE,
        aiDeckWorkerConcurrency:
          this.config.AI_DECK_EXECUTION_MODE === "pg"
            ? this.config.AI_DECK_WORKER_CONCURRENCY
            : undefined,
        aiDeckUserConcurrency:
          this.config.AI_DECK_EXECUTION_MODE === "pg"
            ? this.config.AI_DECK_USER_CONCURRENCY
            : undefined,
        queueNames: this.queueNames,
      },
      "Worker ready.",
    );
  }

  async onModuleDestroy() {
    if (this.storageDeletionTimer) clearInterval(this.storageDeletionTimer);
    if (this.activityRetentionTimer) clearInterval(this.activityRetentionTimer);
    if (this.aiDeckMaintenanceTimer) clearInterval(this.aiDeckMaintenanceTimer);
    await this.aiDeckPostgresRunner?.stop();
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.aiDeckMaintenanceInFlight;
    await this.transcriptCache?.close();
    await this.challengeQnaEvidenceCache?.close();
    this.logger.info(
      {
        event: "worker.stopped",
        queueNames: this.queueNames,
      },
      "Worker stopped.",
    );
  }

  private createWorker(
    queueName: string,
    handler: (job: BullMqJob) => Promise<OrbitJob | void>,
  ): BullMqWorker {
    const worker = new BullMqWorker(
      queueName,
      (job) => this.processJob(queueName, job, () => handler(job)),
      {
        connection: redisConnectionOptions(this.config.REDIS_URL),
        ...(queueName === slideQuestionGuideGenerationQueueName
          ? { concurrency: 2 }
          : {}),
      },
    );

    worker.on("failed", (job, error) => {
      if (isAiDeckStageRetrySignal(error)) {
        this.logger.warn(
          {
            event: "bullmq.job.retry-scheduled",
            queueName,
            bullJobId: job?.id,
            attemptsMade: job?.attemptsMade,
            ...jobPayloadFields(job?.data),
          },
          "BullMQ job retry scheduled.",
        );
        return;
      }
      this.logger.error(
        {
          event: "bullmq.job.failed",
          queueName,
          bullJobId: job?.id,
          attemptsMade: job?.attemptsMade,
          ...jobPayloadFields(job?.data),
          error: serializeLogError(error),
        },
        "BullMQ job failed.",
      );
    });

    return worker;
  }

  private async processJob(
    queueName: string,
    job: BullMqJob,
    handler: () => Promise<OrbitJob | void>,
  ): Promise<OrbitJob | void> {
    const startedAt = Date.now();
    const baseFields = {
      queueName,
      bullJobId: job.id,
      attemptsMade: job.attemptsMade,
      ...jobPayloadFields(job.data),
    };

    this.logger.info(
      {
        event: "job.started",
        ...baseFields,
      },
      "Job started.",
    );

    try {
      const result = await handler();
      const durationMs = Date.now() - startedAt;
      if (
        !result ||
        result.status === "queued" ||
        result.status === "running"
      ) {
        this.logger.info(
          {
            event: "job.progressed",
            ...baseFields,
            jobId: result?.jobId,
            jobType: result?.type,
            projectId: result?.projectId,
            status: result?.status,
            durationMs,
          },
          "Job progressed.",
        );
        return result;
      }
      const event = result.status === "failed" ? "job.failed" : "job.succeeded";
      const level = result.status === "failed" ? "error" : "info";

      this.logger[level](
        {
          event,
          ...baseFields,
          jobId: result.jobId,
          jobType: result.type,
          projectId: result.projectId,
          status: result.status,
          durationMs,
          ...jobDiagnosticFields(result.result),
          error: result.error ?? undefined,
        },
        "Job finished.",
      );
      if (queueName === semanticCueExtractionQueueName) {
        const versionConflict =
          result.error?.code === "SEMANTIC_CUE_DECK_VERSION_CONFLICT";
        const semanticEvent =
          result.status === "succeeded"
            ? "semantic_cue.extraction.succeeded"
            : versionConflict
              ? "semantic_cue.extraction.version_conflict"
              : "semantic_cue.extraction.failed";
        const semanticLevel =
          result.status === "succeeded"
            ? "info"
            : versionConflict
              ? "warn"
              : "error";
        this.logger[semanticLevel](
          {
            event: semanticEvent,
            ...baseFields,
            jobId: result.jobId,
            jobType: result.type,
            projectId: result.projectId,
            status: result.status,
            durationMs,
            reason: result.error?.code,
          },
          "Semantic cue extraction finished.",
        );
      }
      return result;
    } catch (error) {
      if (isAiDeckStageRetrySignal(error)) throw error;
      await this.recoverAiDeckTransportFailure(queueName, job);
      this.logger.error(
        {
          event: "job.failed",
          ...baseFields,
          durationMs: Date.now() - startedAt,
          error: serializeLogError(error),
        },
        "Job failed.",
      );
      throw error;
    }
  }

  private async recoverAiDeckTransportFailure(
    queueName: string,
    job: BullMqJob,
  ): Promise<void> {
    if (!isFinalBullMqAttempt(job)) return;
    try {
      const result = await recoverAiDeckBullMqFinalFailure(this.dataSource, {
        queueName,
        jobName: job.name,
        data: job.data,
      });
      if (result.outcome === "ignored") return;
      this.logTerminalFailures(result.terminalJob ? [result.terminalJob] : []);
      this.logger.warn(
        {
          event: "ai_deck.transport_failure.recovered",
          queueName,
          bullJobId: job.id,
          attemptsMade: job.attemptsMade,
          recovery: result.outcome,
          ...jobPayloadFields(job.data),
        },
        "AI deck transport failure recovered.",
      );
    } catch (error) {
      this.logger.error(
        {
          event: "ai_deck.transport_failure.recovery_failed",
          queueName,
          bullJobId: job.id,
          attemptsMade: job.attemptsMade,
          ...jobPayloadFields(job.data),
          error: serializeLogError(error),
        },
        "AI deck transport failure recovery failed.",
      );
    }
  }

  private scheduleAiDeckStageMaintenance(): void {
    if (this.aiDeckMaintenanceInFlight) return;
    const task = this.runAiDeckStageMaintenance();
    this.aiDeckMaintenanceInFlight = task;
    void task.finally(() => {
      if (this.aiDeckMaintenanceInFlight === task) {
        this.aiDeckMaintenanceInFlight = null;
      }
    });
  }

  private async runAiDeckStageMaintenance(): Promise<void> {
    if (this.config.AI_DECK_EXECUTION_MODE === "pg") {
      await this.runAiDeckPostgresMaintenance();
      return;
    }
    const repository = new AiDeckGenerationStageCheckpointRepository(
      this.dataSource,
    );
    try {
      const result = await reconcileFailedAiDeckCoordinatorJobs(
        this.dataSource,
        {
          redisUrl: this.config.REDIS_URL,
          cursor: this.aiDeckFailedCoordinatorScanCursor,
          onError: (error, job) =>
            this.logger.error(
              {
                event: "ai_deck.coordinator.reconcile_failed",
                bullJobId: job.id,
                attemptsMade: job.attemptsMade,
                ...jobPayloadFields(job.data),
                error: serializeLogError(error),
              },
              "AI deck coordinator reconciliation failed.",
            ),
        },
      );
      this.aiDeckFailedCoordinatorScanCursor = result.nextCursor;
      this.logTerminalFailures(result.terminalJobs);
      if (result.recovered > 0 || result.removed > 0) {
        this.logger.warn(
          {
            event: "ai_deck.coordinator.reconciled",
            scanned: result.scanned,
            recovered: result.recovered,
            resumed: result.resumed,
            removed: result.removed,
            redisCursor: result.nextCursor.redisCursor,
            pendingJobCount: result.nextCursor.pendingJobIds.length,
          },
          "AI deck failed coordinators reconciled.",
        );
      }
    } catch (error) {
      this.logger.error(
        {
          event: "ai_deck.coordinator.reconcile_scan_failed",
          error: serializeLogError(error),
        },
        "AI deck coordinator reconciliation scan failed.",
      );
    }
    try {
      await dispatchAiDeckGenerationStages(repository, {
        driver: "bullmq",
        redisUrl: this.config.REDIS_URL,
        onError: (error, message) =>
          this.logger.error(
            {
              event: "ai_deck.stage.dispatch_failed",
              pipelineJobId: message.pipelineJobId,
              projectId: message.projectId,
              stage: message.stage,
              shardKey: message.shardKey,
              error: serializeLogError(error),
            },
            "AI deck stage dispatch failed.",
          ),
      });
    } catch (error) {
      this.logger.error(
        {
          event: "ai_deck.stage.dispatch_scan_failed",
          error: serializeLogError(error),
        },
        "AI deck stage dispatch scan failed.",
      );
    }
    try {
      const result = await reconcileExpiredAiDeckStageLeases(this.dataSource, {
        onError: (error, message) =>
          this.logger.error(
            {
              event: "ai_deck.stage.reconcile_failed",
              pipelineJobId: message.pipelineJobId,
              projectId: message.projectId,
              stage: message.stage,
              shardKey: message.shardKey,
              error: serializeLogError(error),
            },
            "AI deck stage reconciliation failed.",
          ),
      });
      this.logTerminalFailures(result.terminalJobs);
    } catch (error) {
      this.logger.error(
        {
          event: "ai_deck.stage.reconcile_scan_failed",
          error: serializeLogError(error),
        },
        "AI deck stage reconciliation scan failed.",
      );
    }
  }

  private async runAiDeckPostgresMaintenance(): Promise<void> {
    try {
      const result = await initializePendingAiDeckGenerationJobs(
        this.dataSource,
        {
          onError: (error, parent) =>
            this.logger.error(
              {
                event: "ai_deck.postgres_initialization_failed",
                jobId: parent.jobId,
                projectId: parent.projectId,
                error: serializeLogError(error),
              },
              "PostgreSQL AI deck parent initialization failed.",
            ),
        },
      );
      if (result.initialized > 0) {
        this.logger.info(
          {
            event: "ai_deck.postgres_initialized",
            scanned: result.scanned,
            initialized: result.initialized,
          },
          "PostgreSQL AI deck parents initialized.",
        );
      }
    } catch (error) {
      this.logger.error(
        {
          event: "ai_deck.postgres_initialization_scan_failed",
          error: serializeLogError(error),
        },
        "PostgreSQL AI deck parent initialization scan failed.",
      );
    }

    try {
      const result = await reconcileExpiredAiDeckStageLeases(this.dataSource, {
        onError: (error, message) =>
          this.logger.error(
            {
              event: "ai_deck.stage.reconcile_failed",
              pipelineJobId: message.pipelineJobId,
              projectId: message.projectId,
              stage: message.stage,
              shardKey: message.shardKey,
              error: serializeLogError(error),
            },
            "AI deck stage reconciliation failed.",
          ),
      });
      this.logTerminalFailures(result.terminalJobs);
    } catch (error) {
      this.logger.error(
        {
          event: "ai_deck.stage.reconcile_scan_failed",
          error: serializeLogError(error),
        },
        "AI deck stage reconciliation scan failed.",
      );
    }
  }

  private logTerminalFailures(jobs: OrbitJob[]): void {
    for (const job of jobs) {
      if (job.status !== "failed") continue;
      this.logger.error(
        {
          event: "job.failed",
          jobId: job.jobId,
          jobType: job.type,
          projectId: job.projectId,
          status: job.status,
          error: job.error ?? undefined,
        },
        "Job finished.",
      );
    }
  }

  private aiDeckQueueNames(): string[] {
    switch (this.config.AI_DECK_WORKER_QUEUE) {
      case "reference-extract":
        return [generateDeckQueueName, referenceExtractQueueName];
      case "research-content":
        return [aiDeckResearchContentQueueName];
      case "design-layout":
        return [aiDeckDesignLayoutQueueName];
      case "image":
        return [aiDeckImageQueueName, designImageGenerationQueueName];
      case "qa-finalize":
        return [aiDeckQaFinalizeQueueName];
      default:
        return this.config.AI_DECK_EXECUTION_MODE === "pg"
          ? this.allQueueNames.filter(
              (queueName) =>
                queueName !== generateDeckQueueName &&
                queueName !== aiDeckResearchContentQueueName &&
                queueName !== aiDeckDesignLayoutQueueName &&
                queueName !== aiDeckImageQueueName &&
                queueName !== aiDeckQaFinalizeQueueName,
            )
          : this.allQueueNames;
    }
  }
}

function isFinalBullMqAttempt(job: BullMqJob): boolean {
  const configuredAttempts =
    typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= Math.max(1, configuredAttempts);
}

function isAiDeckStageRetrySignal(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "AiDeckStageRetrySignal" &&
    error.message === "AI_DECK_STAGE_RETRY"
  );
}

function jobPayloadFields(data: unknown) {
  const payload = isRecord(data) ? data : {};
  const request = isRecord(payload.request) ? payload.request : {};
  return {
    jobId: readString(payload, "jobId"),
    jobType: readString(payload, "type"),
    projectId: readString(payload, "projectId"),
    runId: readString(payload, "runId"),
    deckId: readString(payload, "deckId") ?? readString(request, "deckId"),
    deckVersion: readNumber(request, "baseVersion"),
    force: readBoolean(request, "force"),
    audioFileId: readString(payload, "audioFileId"),
    fileId: readString(payload, "fileId"),
    pipelineJobId: readString(payload, "pipelineJobId"),
    stage: readString(payload, "stage"),
    shardKey: readString(payload, "shardKey"),
    fileCount: Array.isArray(payload.files) ? payload.files.length : undefined,
  };
}

function jobDiagnosticFields(result: unknown) {
  if (!isRecord(result) || !isRecord(result.diagnostics)) return {};
  const diagnostics = result.diagnostics;
  return {
    referencePolicy: readString(diagnostics, "referencePolicy"),
    uploadedSourceCount: readNonNegativeNumber(
      diagnostics,
      "uploadedSourceCount",
    ),
    webSourceCount: readNonNegativeNumber(diagnostics, "webSourceCount"),
    repairAttempted:
      typeof diagnostics.repairAttempted === "boolean"
        ? diagnostics.repairAttempted
        : undefined,
    validationIssueCount: readNonNegativeNumber(
      diagnostics,
      "validationIssueCount",
    ),
    visualQaStatus: readString(diagnostics, "visualQaStatus"),
    visualReviewAttempts: readNonNegativeNumber(
      diagnostics,
      "visualReviewAttempts",
    ),
    visualRepairAttempts: readNonNegativeNumber(
      diagnostics,
      "visualRepairAttempts",
    ),
    visualIssueCodes: readStringArray(diagnostics, "visualIssueCodes"),
  };
}

function readNonNegativeNumber(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "number" && candidate >= 0
    ? candidate
    : undefined;
}

function readString(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function readStringArray(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
    return undefined;
  }
  return raw;
}

function readNumber(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readBoolean(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
