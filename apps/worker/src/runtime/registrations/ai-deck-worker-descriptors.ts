import type { OrbitConfig } from "@orbit/config";
import {
  aiDeckDesignLayoutQueueName,
  aiDeckImageQueueName,
  aiDeckQaFinalizeQueueName,
  aiDeckResearchContentQueueName,
  designImageGenerationJobName,
  designImageGenerationQueueName,
  generateDeckJobName,
  generateDeckQueueName,
  generateDeckStagedCoordinatorJobName,
} from "@orbit/job-queue";
import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";

import { processDesignImageGenerationJob } from "../../design-image-generation.processor";
import { processGenerateDeckJob } from "../../generate-deck.processor";
import { processAiDeckExecutionStage } from "../../generate-deck/execution-stage.processor";
import { processAiDeckPlanningStage } from "../../generate-deck/planning-stage.processor";
import { processAiDeckStagedCoordinatorJob } from "../../generate-deck/staged-coordinator";
import type { ImageAssetRuntime } from "../../image-asset-pipeline";
import { createAiDeckTerminalRecovery } from "../terminal-recoveries";
import type { WorkerDescriptor } from "../worker-descriptor";

interface AiDeckWorkerDescriptorContext {
  config: Pick<OrbitConfig, "PYTHON_WORKER_URL">;
  dataSource: DataSource;
  eventLogger(event: string, fields: Record<string, unknown>): void;
  imageRuntime: ImageAssetRuntime;
  logger: PinoLogger;
  storage: StoragePort;
  workerId: string;
}

export function createAiDeckWorkerDescriptors(
  context: AiDeckWorkerDescriptorContext,
): WorkerDescriptor[] {
  return [
    {
      acceptedJobNames: [
        generateDeckJobName,
        generateDeckStagedCoordinatorJobName,
      ],
      queueName: generateDeckQueueName,
      terminalRecovery: recovery(context, generateDeckQueueName),
      handler: (job) =>
        job.name === generateDeckJobName
          ? processGenerateDeckJob(
              context.dataSource,
              context.storage,
              context.config.PYTHON_WORKER_URL,
              job.data,
              context.imageRuntime,
              (event, fields) =>
                context.logger.info(
                  { event, ...fields },
                  "AI PPT generation event.",
                ),
            )
          : processAiDeckStagedCoordinatorJob(context.dataSource, job.data),
    },
    {
      acceptedJobNames: ["source-grounding", "content-planning"],
      queueName: aiDeckResearchContentQueueName,
      terminalRecovery: recovery(context, aiDeckResearchContentQueueName),
      handler: (job) =>
        processAiDeckPlanningStage(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          context.workerId,
          job.data,
          { eventLogger: context.eventLogger },
        ),
    },
    {
      acceptedJobNames: ["design-planning", "layout-compile"],
      queueName: aiDeckDesignLayoutQueueName,
      terminalRecovery: recovery(context, aiDeckDesignLayoutQueueName),
      handler: (job) =>
        processAiDeckPlanningStage(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          context.workerId,
          job.data,
          { eventLogger: context.eventLogger },
        ),
    },
    {
      acceptedJobNames: ["cover-slide", "image-slide"],
      queueName: aiDeckImageQueueName,
      terminalRecovery: recovery(context, aiDeckImageQueueName),
      handler: (job) =>
        processAiDeckExecutionStage(
          context.dataSource,
          context.storage,
          context.config.PYTHON_WORKER_URL,
          context.workerId,
          job.data,
          context.imageRuntime,
          { eventLogger: context.eventLogger },
        ),
    },
    {
      acceptedJobNames: [designImageGenerationJobName],
      queueName: designImageGenerationQueueName,
      terminalRecovery: recovery(context, designImageGenerationQueueName),
      handler: (job) =>
        processDesignImageGenerationJob(
          context.dataSource,
          context.storage,
          context.imageRuntime,
          job.data,
        ),
    },
    {
      acceptedJobNames: [
        "semantic-quality",
        "rendered-visual-quality",
        "publication",
      ],
      queueName: aiDeckQaFinalizeQueueName,
      terminalRecovery: recovery(context, aiDeckQaFinalizeQueueName),
      handler: (job) =>
        processAiDeckExecutionStage(
          context.dataSource,
          context.storage,
          context.config.PYTHON_WORKER_URL,
          context.workerId,
          job.data,
          context.imageRuntime,
          { eventLogger: context.eventLogger },
        ),
    },
  ];
}

function recovery(context: AiDeckWorkerDescriptorContext, queueName: string) {
  return createAiDeckTerminalRecovery(
    context.dataSource,
    context.logger,
    queueName,
  );
}
