import type { OrbitConfig } from "@orbit/config";
import {
  deckExportJobName,
  deckExportQueueName,
  pptxOoxmlGenerationJobName,
  pptxOoxmlGenerationQueueName,
  pptxOoxmlSyncJobName,
  pptxOoxmlSyncQueueName,
  presentationAnalysisJobName,
  presentationAnalysisQueueName,
  referenceExtractJobName,
  referenceExtractQueueName,
  rehearsalSemanticEvaluationJobName,
  rehearsalSemanticEvaluationQueueName,
  rehearsalSttJobName,
  rehearsalSttQueueName,
  semanticCueExtractionJobName,
  semanticCueExtractionQueueName,
  speakerNotesSuggestionJobName,
  speakerNotesSuggestionQueueName,
  workerHealthCheckJobName,
  workerHealthCheckQueueName,
} from "@orbit/job-queue";
import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";

import { processDeckExportJob } from "../../deck-export.processor";
import { processAiDeckReferenceExtractionStage } from "../../generate-deck/reference-extract-stage";
import { processPptxOoxmlGenerationJob } from "../../pptx-ooxml-generation.processor";
import { processPptxOoxmlSyncJob } from "../../pptx-ooxml-sync.processor";
import { processPresentationAnalysisJob } from "../../presentation-analysis.processor";
import { processReferenceExtractJob } from "../../reference-extract.processor";
import { processRehearsalSemanticEvaluationJob } from "../../rehearsal-semantic-evaluation.processor";
import { processRehearsalSttJob } from "../../rehearsal-stt.processor";
import type { RedisRehearsalTranscriptCache } from "../../rehearsal-transcript-cache";
import { processSemanticCueExtractionJob } from "../../semantic-cue-extraction.processor";
import { processSpeakerNotesSuggestionJob } from "../../speaker-notes-suggestion.processor";
import { processWorkerHealthCheckJob } from "../../worker-health-check.processor";
import {
  createAiDeckTerminalRecovery,
  createPptxTerminalRecovery,
} from "../terminal-recoveries";
import type { WorkerDescriptor } from "../worker-descriptor";

interface CoreWorkerDescriptorContext {
  config: Pick<OrbitConfig, "APP_ENV" | "PYTHON_WORKER_URL">;
  dataSource: DataSource;
  logger: PinoLogger;
  storage: StoragePort;
  transcriptCache: RedisRehearsalTranscriptCache | null;
  workerId: string;
}

export function createCoreWorkerDescriptors(
  context: CoreWorkerDescriptorContext,
): WorkerDescriptor[] {
  return [
    {
      acceptedJobNames: [referenceExtractJobName, "reference-extract-file"],
      queueName: referenceExtractQueueName,
      terminalRecovery: createAiDeckTerminalRecovery(
        context.dataSource,
        context.logger,
        referenceExtractQueueName,
      ),
      handler: (job) =>
        job.name === referenceExtractJobName
          ? processReferenceExtractJob(
              context.dataSource,
              context.config.PYTHON_WORKER_URL,
              job.data,
            )
          : processAiDeckReferenceExtractionStage(
              context.dataSource,
              context.storage,
              context.config.PYTHON_WORKER_URL,
              context.workerId,
              job.data,
            ),
    },
    {
      acceptedJobNames: [rehearsalSttJobName],
      queueName: rehearsalSttQueueName,
      handler: (job) =>
        processRehearsalSttJob(
          context.dataSource,
          context.storage,
          context.config.PYTHON_WORKER_URL,
          job.data,
          context.transcriptCache ?? undefined,
          (event) => {
            const level = event.event.endsWith(".partial") ? "warn" : "info";
            context.logger[level](
              event,
              "Rehearsal semantic evaluation updated.",
            );
          },
          (event) => {
            const { segments, ...summary } = event;
            const level =
              event.measurementState === "measured" ? "info" : "warn";
            context.logger[level](
              summary,
              "Rehearsal silence analysis completed.",
            );
            if (context.config.APP_ENV === "local" && segments.length > 0) {
              context.logger.debug(
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
            const level = event.event.endsWith(".unmeasured") ? "warn" : "info";
            context.logger[level](
              event,
              "Rehearsal slide speaking rate analyzed.",
            );
          },
          (event) => {
            const level = event.event.endsWith(".failed") ? "error" : "info";
            context.logger[level](
              event,
              "Rehearsal transcript artifacts updated.",
            );
          },
        ),
    },
    {
      acceptedJobNames: [presentationAnalysisJobName],
      queueName: presentationAnalysisQueueName,
      handler: (job) =>
        processPresentationAnalysisJob(
          context.dataSource,
          context.storage,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
    {
      acceptedJobNames: [rehearsalSemanticEvaluationJobName],
      queueName: rehearsalSemanticEvaluationQueueName,
      handler: (job) =>
        processRehearsalSemanticEvaluationJob(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          job.data,
          context.transcriptCache!,
          (event) => {
            const level = event.event.endsWith(".retry_failed")
              ? "error"
              : "info";
            context.logger[level](
              event,
              "Rehearsal semantic evaluation retry updated.",
            );
          },
        ),
    },
    {
      acceptedJobNames: [deckExportJobName],
      queueName: deckExportQueueName,
      handler: (job) =>
        processDeckExportJob(
          context.dataSource,
          context.storage,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
    {
      acceptedJobNames: [semanticCueExtractionJobName],
      queueName: semanticCueExtractionQueueName,
      handler: (job) =>
        processSemanticCueExtractionJob(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
    {
      acceptedJobNames: [speakerNotesSuggestionJobName],
      queueName: speakerNotesSuggestionQueueName,
      handler: (job) =>
        processSpeakerNotesSuggestionJob(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
    createPptxGenerationDescriptor(context),
    createPptxSyncDescriptor(context),
    {
      acceptedJobNames: [workerHealthCheckJobName],
      queueName: workerHealthCheckQueueName,
      handler: (job) =>
        processWorkerHealthCheckJob(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
  ];
}

function createPptxGenerationDescriptor(
  context: CoreWorkerDescriptorContext,
): WorkerDescriptor {
  return {
    acceptedJobNames: [pptxOoxmlGenerationJobName],
    queueName: pptxOoxmlGenerationQueueName,
    runtimeOptions: { maxStalledCount: 4 },
    terminalRecovery: createPptxTerminalRecovery(
      context.dataSource,
      context.logger,
      pptxOoxmlGenerationQueueName,
    ),
    handler: (job) =>
      processPptxOoxmlGenerationJob(
        context.dataSource,
        context.storage,
        context.config.PYTHON_WORKER_URL,
        job.data,
      ),
  };
}

function createPptxSyncDescriptor(
  context: CoreWorkerDescriptorContext,
): WorkerDescriptor {
  return {
    acceptedJobNames: [pptxOoxmlSyncJobName],
    queueName: pptxOoxmlSyncQueueName,
    runtimeOptions: { maxStalledCount: 4 },
    terminalRecovery: createPptxTerminalRecovery(
      context.dataSource,
      context.logger,
      pptxOoxmlSyncQueueName,
    ),
    handler: (job) =>
      processPptxOoxmlSyncJob(
        context.dataSource,
        context.storage,
        context.config.PYTHON_WORKER_URL,
        job.data,
      ),
  };
}
