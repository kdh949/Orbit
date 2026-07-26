import type { ActivityResponseRetentionJobPayload } from "@orbit/shared/activities";
import type { AiDeckExecutionMode } from "@orbit/shared/config";
import type {
  Deck,
  DeckExportFormat,
  DesignImageGenerationJobPayload,
  GenerateDeckRequest,
  PptxOoxmlGenerationRequest,
  SavedDesignPackSnapshot,
  SemanticCueExtractionJobPayload,
  SpeakerNotesSuggestionJobPayload,
} from "@orbit/shared/deck";
import type { AiDeckGenerationStageMessage } from "@orbit/shared/jobs";
import type { PresentationAnalysisJobPayload } from "@orbit/shared/presentation";
import type {
  RehearsalSemanticEvaluationJobPayload,
  SlideTranscriptSnapshot,
} from "@orbit/shared/rehearsals";

export interface ReferenceExtractBullMqFile {
  fileId: string;
  originalName: string;
  mimeType: string;
  contentBase64: string;
}

export interface ReferenceExtractBullMqPayload {
  jobId: string;
  projectId: string;
  files: ReferenceExtractBullMqFile[];
}

export interface EnqueueReferenceExtractJobInput extends ReferenceExtractBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export interface RehearsalSttBullMqPayload {
  jobId: string;
  projectId: string;
  runId: string;
  deckId: string;
  audioFileId: string;
  liveTranscript?: string | null;
  slideTranscriptSnapshots?: SlideTranscriptSnapshot[];
}

export interface EnqueueRehearsalSttJobInput extends RehearsalSttBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export type PresentationAnalysisBullMqPayload = PresentationAnalysisJobPayload;

export type EnqueuePresentationAnalysisJobInput =
  PresentationAnalysisBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export type RehearsalSemanticEvaluationBullMqPayload =
  RehearsalSemanticEvaluationJobPayload;

export type EnqueueRehearsalSemanticEvaluationJobInput =
  RehearsalSemanticEvaluationBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export type EnqueueFocusedPracticeAnalysisJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  practiceSessionId: string;
  attemptId: string;
  audioFileId: string;
};

export type EnqueueSlidePracticeAnalysisJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  analysisId: string;
};

export type EnqueueChallengeQnaGenerationJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  qnaSessionId: string;
  generationRevision: number;
};

export type EnqueueChallengeQnaAnswerAnalysisJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  answerAttemptId: string;
};

export type EnqueueSlideQuestionGuideGenerationJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  guideId: string;
};

export interface GenerateDeckBullMqPayload {
  jobId: string;
  projectId: string;
  request: GenerateDeckRequest;
  designPackSnapshot?: SavedDesignPackSnapshot;
  requestedByUserId?: string;
  imageAssetScope?: {
    userId: string;
  };
}

export interface EnqueueGenerateDeckJobInput extends GenerateDeckBullMqPayload {
  driver: "bullmq" | "sqs";
  executionMode?: AiDeckExecutionMode;
  redisUrl: string;
}

export interface AiDeckStagedCoordinatorBullMqPayload {
  jobId: string;
  projectId: string;
}

export interface EnqueueAiDeckGenerationStageJobInput {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  message: AiDeckGenerationStageMessage;
}

export interface AiDeckGenerationStageEnqueueResult {
  jobId: string;
  state: string;
}

export interface DeckExportBullMqPayload {
  jobId: string;
  projectId: string;
  deck: Deck;
  format: DeckExportFormat;
  presentationSessionId?: string;
}

export interface EnqueueDeckExportJobInput extends DeckExportBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export type SemanticCueExtractionBullMqPayload =
  SemanticCueExtractionJobPayload;

export type EnqueueSemanticCueExtractionJobInput =
  SemanticCueExtractionBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export type SpeakerNotesSuggestionBullMqPayload =
  SpeakerNotesSuggestionJobPayload;

export type EnqueueSpeakerNotesSuggestionJobInput =
  SpeakerNotesSuggestionBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export type DesignImageGenerationBullMqPayload =
  DesignImageGenerationJobPayload;

export type EnqueueDesignImageGenerationJobInput =
  DesignImageGenerationBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export interface PptxOoxmlGenerationBullMqPayload {
  jobId: string;
  projectId: string;
  request: PptxOoxmlGenerationRequest;
}

export interface EnqueuePptxOoxmlGenerationJobInput extends PptxOoxmlGenerationBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export interface PptxOoxmlSyncBullMqPayload {
  jobId: string;
  projectId: string;
  deckId: string;
  changeId: string;
  targetDeckVersion: number;
  syncCapabilityVersion: number;
}

export interface EnqueuePptxOoxmlSyncJobInput extends PptxOoxmlSyncBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export interface WorkerHealthCheckBullMqPayload {
  jobId: string;
  projectId: string;
}

export interface EnqueueWorkerHealthCheckJobInput extends WorkerHealthCheckBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export type ActivityResponseRetentionBullMqPayload =
  ActivityResponseRetentionJobPayload;

export type EnqueueActivityResponseRetentionJobInput =
  ActivityResponseRetentionBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };
