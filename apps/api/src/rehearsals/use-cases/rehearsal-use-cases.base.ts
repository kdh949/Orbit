import type {
  EnqueueRehearsalSemanticEvaluationJobInput,
  EnqueueRehearsalSttJobInput,
} from "@orbit/job-queue";
import { loadOrbitConfig } from "@orbit/config";
import { type RehearsalFocusProfile } from "@orbit/shared/coaching";
import { createAssetUploadUrlRequestSchema } from "@orbit/shared/files";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { Repository } from "typeorm";
import { DecksService } from "../../decks/decks.service";
import { FilesService } from "../../files/files.service";
import { JobsService } from "../../jobs/jobs.service";
import { ProjectEntity } from "../../projects/project.entity";
import { ProjectsService } from "../../projects/projects.service";
import { PresentationBriefsService } from "../../presentation-briefs/presentation-briefs.service";
import { RehearsalRunEntity } from "../rehearsal-run.entity";
import { RedisRehearsalTranscriptCache } from "../rehearsal-transcript-cache";
import { toRehearsalFocusProfile } from "../mappers/rehearsal-run.mapper";

export type RehearsalSttEnqueueJob = (
  input: EnqueueRehearsalSttJobInput,
) => Promise<void>;
export type RehearsalSemanticEvaluationEnqueueJob = (
  input: EnqueueRehearsalSemanticEvaluationJobInput,
) => Promise<void>;

export const REHEARSAL_STT_ENQUEUE_JOB = "REHEARSAL_STT_ENQUEUE_JOB";
export const REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_JOB =
  "REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_JOB";

export const rehearsalAudioRetentionMs = 14 * 24 * 60 * 60 * 1000;
export const playbackUrlMaximumExpiresInSeconds = 15 * 60;

export class RehearsalUseCasesBase {
  protected readonly config = loadOrbitConfig(process.env, { service: "api" });
  protected readonly rehearsalAudioUploadRequestSchema =
    createAssetUploadUrlRequestSchema({
      maxRehearsalAudioUploadSizeBytes: this.config.REHEARSAL_AUDIO_MAX_BYTES,
      allowedPrivatePurpose: "rehearsal-audio",
    });

  constructor(
    protected readonly rehearsalRuns: Repository<RehearsalRunEntity>,
    protected readonly projects: Repository<ProjectEntity>,
    protected readonly decksService: DecksService,
    protected readonly projectsService: ProjectsService,
    protected readonly presentationBriefs: PresentationBriefsService,
    protected readonly filesService: FilesService,
    protected readonly jobsService: JobsService,
    protected readonly enqueueJob: RehearsalSttEnqueueJob,
    protected readonly enqueueSemanticEvaluationJob: RehearsalSemanticEvaluationEnqueueJob,
    protected readonly transcriptCache: RedisRehearsalTranscriptCache,
    protected readonly logger: PinoLogger,
  ) {}

  protected async resolveFocusProfile(
    projectId: string,
  ): Promise<RehearsalFocusProfile | null> {
    const rows = await this.rehearsalRuns.query(
      `SELECT profile_id, project_id, revision, items_json,
              created_by, updated_by, created_at, updated_at
       FROM rehearsal_focus_profiles
       WHERE project_id = $1
       LIMIT 1`,
      [projectId],
    );
    return toRehearsalFocusProfile(Array.isArray(rows) ? rows[0] : null);
  }

  protected async resolveSlideSnapshotUrls(
    projectId: string,
    deckSlideIds: readonly string[],
    snapshots: readonly { slideId: string; fileId: string }[] | undefined,
  ) {
    const urls = new Map<string, string>();
    if (!snapshots?.length) {
      return urls;
    }

    const validSlideIds = new Set(deckSlideIds);
    for (const snapshot of snapshots) {
      if (!validSlideIds.has(snapshot.slideId)) {
        throw new BadRequestException(
          `slideSnapshots references an unknown slideId: ${snapshot.slideId}`,
        );
      }

      const asset = await this.filesService.getUploadedAsset(
        projectId,
        snapshot.fileId,
        "rehearsal-slide-snapshot",
      );
      if (!asset.mimeType.startsWith("image/")) {
        throw new BadRequestException(
          "Rehearsal slide snapshots must be image assets.",
        );
      }

      urls.set(
        snapshot.slideId,
        `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(snapshot.fileId)}/content`,
      );
    }

    return urls;
  }

  protected async resolveAdaptiveBrief(
    projectId: string,
    briefRef:
      | { mode: "generic" }
      | { mode: "briefed"; briefId: string; expectedRevision: number },
    evaluatorLensRef:
      | {
          lensId: "general-novice" | "decision-maker" | "strict-reviewer";
          revision: 1;
        }
      | undefined,
  ) {
    if (!evaluatorLensRef) {
      throw new BadRequestException(
        "Evaluator Lens is required for adaptive rehearsal.",
      );
    }
    if (briefRef.mode === "generic") {
      if (evaluatorLensRef.lensId !== "general-novice") {
        throw new ConflictException({
          code: "SOURCE_INCOMPATIBLE",
          message:
            "Generic rehearsal must use the general novice evaluator lens.",
        });
      }
      return null;
    }

    const brief = await this.presentationBriefs.getCurrent(projectId);
    if (
      !brief ||
      brief.briefId !== briefRef.briefId ||
      brief.revision !== briefRef.expectedRevision ||
      brief.evaluatorLensRef.lensId !== evaluatorLensRef.lensId ||
      brief.evaluatorLensRef.revision !== evaluatorLensRef.revision
    ) {
      throw new ConflictException({
        code: "SOURCE_INCOMPATIBLE",
        message: "Brief or evaluator lens revision is no longer current.",
      });
    }
    return brief;
  }

  protected async resolveSourceGoalSetRef(
    projectId: string,
    goalSetId: string | null,
  ) {
    if (!goalSetId) return null;
    const rows = await this.rehearsalRuns.manager.query(
      `
        SELECT sets.goal_set_id, sets.revision
        FROM practice_goal_sets sets
        JOIN practice_goal_heads heads
          ON heads.project_id = sets.project_id
         AND heads.current_goal_set_id = sets.goal_set_id
        WHERE sets.project_id = $1
          AND sets.goal_set_id = $2
          AND sets.analysis_state = 'final'
      `,
      [projectId, goalSetId],
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (
      !row ||
      typeof row.goal_set_id !== "string" ||
      typeof row.revision !== "number"
    ) {
      throw new ConflictException({
        code: "SOURCE_INCOMPATIBLE",
        message:
          "The selected practice goal set is no longer current and final.",
      });
    }
    return { goalSetId: row.goal_set_id, revision: row.revision };
  }

  protected async isTranscriptDownloadAvailable(
    run: RehearsalRunEntity,
  ): Promise<boolean> {
    if (
      run.status !== "succeeded" ||
      !run.transcriptRetained ||
      !run.transcriptTextFileId
    ) {
      return false;
    }

    return this.filesService.isOwnerOnlyAssetAvailable(
      run.projectId,
      run.transcriptTextFileId,
      "rehearsal-transcript-text",
    );
  }

  protected async isAudioPlaybackAvailable(
    run: RehearsalRunEntity,
  ): Promise<boolean> {
    const retentionExpiresAt = run.rawAudioDeleteDeadlineAt;
    if (
      run.status !== "succeeded" ||
      !run.audioFileId ||
      run.rawAudioDeletedAt ||
      !retentionExpiresAt ||
      retentionExpiresAt.getTime() <= Date.now()
    ) {
      return false;
    }

    return this.filesService.isPrivateAudioAvailable(
      run.projectId,
      run.audioFileId,
      "rehearsal-audio",
    );
  }

  protected async getRunEntity(runId: string) {
    const run = await this.rehearsalRuns.findOne({ where: { runId } });
    if (!run) {
      throw new NotFoundException(`Rehearsal run not found: ${runId}`);
    }

    await this.projectsService.getAccessibleProject(run.projectId);

    return run;
  }

  protected async claimAudioUpload(
    run: RehearsalRunEntity,
    fileId: string,
    rawAudioDeleteDeadlineAt: Date,
  ) {
    const result = await this.rehearsalRuns.update(
      {
        runId: run.runId,
        projectId: run.projectId,
        audioFileId: fileId,
        status: "uploading",
      },
      {
        status: "processing",
        error: null,
        rawAudioDeleteDeadlineAt,
        updatedAt: new Date(),
      },
    );

    if (!result.affected) {
      return null;
    }

    return this.getRunEntity(run.runId);
  }

  protected async cleanupAfterEnqueueFailure(
    run: RehearsalRunEntity,
    fileId: string,
    enqueueError: unknown,
  ): Promise<{
    error: { code: string; message: string };
    jobMessage: string;
    rawAudioDeletedAt: Date | null;
    cleanupError?: unknown;
  }> {
    try {
      const rawAudioDeletedAt = await this.filesService.deleteUploadedAsset(
        run.projectId,
        fileId,
        "rehearsal-audio",
      );

      return {
        error: {
          code: "REHEARSAL_STT_ENQUEUE_FAILED",
          message:
            enqueueError instanceof Error
              ? enqueueError.message
              : "Rehearsal STT enqueue failed.",
        },
        jobMessage: "Rehearsal STT enqueue failed.",
        rawAudioDeletedAt: new Date(rawAudioDeletedAt),
      };
    } catch (cleanupError) {
      return {
        error: {
          code: "RAW_AUDIO_DELETE_FAILED",
          message:
            cleanupError instanceof Error
              ? cleanupError.message
              : "Raw audio deletion failed.",
        },
        jobMessage: "Rehearsal raw audio cleanup failed.",
        rawAudioDeletedAt: run.rawAudioDeletedAt,
        cleanupError,
      };
    }
  }
}
