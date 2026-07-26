import {
  type AiDeckGenerationStage,
  type AiDeckGenerationStageMessage,
  aiDeckGenerationStageMessageSchema,
} from "@orbit/shared/jobs";

export const referenceExtractQueueName = "reference-extract";
export const referenceExtractJobName = "reference-extract";
export const rehearsalSttQueueName = "rehearsal-stt";
export const rehearsalSttJobName = "rehearsal-stt";
export const presentationAnalysisQueueName = "presentation-analysis";
export const presentationAnalysisJobName = "presentation-analysis";
export const rehearsalSemanticEvaluationQueueName =
  "rehearsal-semantic-evaluation";
export const rehearsalSemanticEvaluationJobName =
  "rehearsal-semantic-evaluation";
export const focusedPracticeAnalysisQueueName = "focused-practice-analysis";
export const focusedPracticeAnalysisJobName = "focused-practice-analysis";
export const slidePracticeAnalysisQueueName = "slide-practice-analysis";
export const slidePracticeAnalysisJobName = "slide-practice-analysis";
export const challengeQnaGenerationQueueName = "challenge-qna-generation";
export const challengeQnaGenerationJobName = "challenge-qna-generation";
export const challengeQnaAnswerAnalysisQueueName =
  "challenge-qna-answer-analysis";
export const challengeQnaAnswerAnalysisJobName =
  "challenge-qna-answer-analysis";
export const slideQuestionGuideGenerationQueueName =
  "slide-question-guide-generation";
export const slideQuestionGuideGenerationJobName =
  "slide-question-guide-generation";
export const generateDeckQueueName = "generate-deck";
export const generateDeckJobName = "generate-deck";
export const generateDeckStagedCoordinatorJobName =
  "generate-deck-staged-coordinator";
export const aiDeckResearchContentQueueName = "ai-deck-research-content";
export const aiDeckDesignLayoutQueueName = "ai-deck-design-layout";
export const aiDeckImageQueueName = "ai-deck-image";
export const aiDeckQaFinalizeQueueName = "ai-deck-qa-finalize";
export const deckExportQueueName = "deck-export";
export const deckExportJobName = "deck-export";
export const semanticCueExtractionQueueName = "semantic-cue-extraction";
export const semanticCueExtractionJobName = "semantic-cue-extraction";
export const speakerNotesSuggestionQueueName = "speaker-notes-suggestion";
export const speakerNotesSuggestionJobName = "speaker-notes-suggestion";
export const designImageGenerationQueueName = "design-image-generation";
export const designImageGenerationJobName = "design-image-generation";
export const pptxOoxmlGenerationQueueName = "pptx-ooxml-generation";
export const pptxOoxmlGenerationJobName = "pptx-ooxml-generation";
export const pptxOoxmlSyncQueueName = "pptx-ooxml-sync";
export const pptxOoxmlSyncJobName = "pptx-ooxml-sync";
export const workerHealthCheckQueueName = "worker-health-check";
export const workerHealthCheckJobName = "worker-health-check";
export const activityResponseRetentionQueueName = "activity-response-retention";
export const activityResponseRetentionJobName = "activity-response-retention";

export function aiDeckGenerationStageJobId(
  input: AiDeckGenerationStageMessage,
): string {
  const message = aiDeckGenerationStageMessageSchema.parse(input);
  return `${message.pipelineJobId}:${message.stage}:${message.shardKey}`;
}

export function aiDeckGenerationStageQueueName(
  stage: AiDeckGenerationStage,
): string {
  switch (stage) {
    case "reference-extract-file":
      return referenceExtractQueueName;
    case "source-grounding":
    case "content-planning":
      return aiDeckResearchContentQueueName;
    case "design-planning":
    case "layout-compile":
      return aiDeckDesignLayoutQueueName;
    case "cover-slide":
    case "image-slide":
      return aiDeckImageQueueName;
    case "semantic-quality":
    case "rendered-visual-quality":
    case "publication":
      return aiDeckQaFinalizeQueueName;
  }
}
