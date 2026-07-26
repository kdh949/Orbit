import type { OrbitConfig } from "@orbit/config";
import {
  activityResponseRetentionQueueName,
  aiDeckDesignLayoutQueueName,
  aiDeckImageQueueName,
  aiDeckQaFinalizeQueueName,
  aiDeckResearchContentQueueName,
  challengeQnaAnswerAnalysisQueueName,
  challengeQnaGenerationQueueName,
  deckExportQueueName,
  designImageGenerationQueueName,
  focusedPracticeAnalysisQueueName,
  generateDeckQueueName,
  pptxOoxmlGenerationQueueName,
  pptxOoxmlSyncQueueName,
  presentationAnalysisQueueName,
  referenceExtractQueueName,
  rehearsalSemanticEvaluationQueueName,
  rehearsalSttQueueName,
  semanticCueExtractionQueueName,
  slidePracticeAnalysisQueueName,
  slideQuestionGuideGenerationQueueName,
  speakerNotesSuggestionQueueName,
  workerHealthCheckQueueName,
} from "@orbit/job-queue";

type WorkerQueueSelectionConfig = Pick<
  OrbitConfig,
  "AI_DECK_EXECUTION_MODE" | "AI_DECK_WORKER_QUEUE"
>;

export interface WorkerQueueRuntimeOptions {
  concurrency?: number;
  maxStalledCount?: number;
}

export const allWorkerQueueNames = [
  referenceExtractQueueName,
  rehearsalSttQueueName,
  presentationAnalysisQueueName,
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
] as const;

const aiDeckStageQueueNames = new Set<string>([
  generateDeckQueueName,
  aiDeckResearchContentQueueName,
  aiDeckDesignLayoutQueueName,
  aiDeckImageQueueName,
  aiDeckQaFinalizeQueueName,
]);

export function selectWorkerQueueNames(
  config: WorkerQueueSelectionConfig,
): string[] {
  switch (config.AI_DECK_WORKER_QUEUE) {
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
      return config.AI_DECK_EXECUTION_MODE === "pg"
        ? allWorkerQueueNames.filter(
            (queueName) => !aiDeckStageQueueNames.has(queueName),
          )
        : [...allWorkerQueueNames];
  }
}

export function workerQueueRuntimeOptions(
  queueName: string,
): WorkerQueueRuntimeOptions {
  return {
    ...([pptxOoxmlGenerationQueueName, pptxOoxmlSyncQueueName].includes(
      queueName,
    )
      ? { maxStalledCount: 4 }
      : {}),
    ...(queueName === slideQuestionGuideGenerationQueueName
      ? { concurrency: 2 }
      : {}),
  };
}
