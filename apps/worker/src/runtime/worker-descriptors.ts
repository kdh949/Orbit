import type { OrbitConfig } from "@orbit/config";
import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";

import type { ChallengeQnaEvidenceCache } from "../challenge-qna-evidence-cache";
import type { ImageAssetRuntime } from "../image-asset-pipeline";
import type { RedisRehearsalTranscriptCache } from "../rehearsal-transcript-cache";
import { createAiDeckWorkerDescriptors } from "./registrations/ai-deck-worker-descriptors";
import { createCoreWorkerDescriptors } from "./registrations/core-worker-descriptors";
import { createPracticeWorkerRegistrations } from "./registrations/practice-worker-registrations";
import type { WorkerDescriptor } from "./worker-descriptor";

interface WorkerDescriptorContext {
  challengeQnaEvidenceCache: ChallengeQnaEvidenceCache | null;
  config: OrbitConfig;
  dataSource: DataSource;
  eventLogger(event: string, fields: Record<string, unknown>): void;
  imageRuntime: ImageAssetRuntime;
  logger: PinoLogger;
  storage: StoragePort;
  transcriptCache: RedisRehearsalTranscriptCache | null;
  workerId: string;
}

export function createWorkerDescriptors(
  context: WorkerDescriptorContext,
): WorkerDescriptor[] {
  return [
    ...createCoreWorkerDescriptors(context),
    ...createAiDeckWorkerDescriptors(context),
    ...createPracticeWorkerRegistrations({
      challengeQnaEvidenceCache: context.challengeQnaEvidenceCache!,
      config: context.config,
      dataSource: context.dataSource,
      logger: context.logger,
      storage: context.storage,
    }),
  ];
}
