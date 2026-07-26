import {
  createRehearsalAudioClipRequestSchema,
  getRehearsalProjectSummaryResponseSchema,
  getRehearsalReportResponseSchema,
  getRehearsalRunResponseSchema,
  rehearsalAudioPlaybackUrlResponseSchema,
  rehearsalReportSchema,
} from "@orbit/shared/rehearsals";
import {
  BadRequestException,
  ConflictException,
  GoneException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Not } from "typeorm";
import { parseRequest } from "../../common/zod-request";
import { serializeLogError } from "../../logging";
import { buildRehearsalProjectSummary } from "../rehearsal-project-summary";
import { toRehearsalRun } from "../mappers/rehearsal-run.mapper";
import { RehearsalLifecycleUseCases } from "./rehearsal-lifecycle.use-cases";
import { playbackUrlMaximumExpiresInSeconds } from "./rehearsal-use-cases.base";

export class RehearsalReportUseCases extends RehearsalLifecycleUseCases {
  async listRuns(projectId: string, query: Record<string, string> = {}) {
    await this.projectsService.getAccessibleProject(projectId);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 1), 100);
    const page = Math.max(Number(query.page) || 1, 1);
    const where: Record<string, unknown> = {
      projectId,
      status: Not("cancelled"),
    };
    if (query.status) {
      where["status"] = query.status;
    }
    const [runs, total] = await this.rehearsalRuns.findAndCount({
      where,
      order: { createdAt: "DESC" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { runs: runs.map(toRehearsalRun), total, page, pageSize };
  }

  async getRun(runId: string) {
    const run = await this.getRunEntity(runId);
    return getRehearsalRunResponseSchema.parse({ run: toRehearsalRun(run) });
  }

  async getRunProjectId(runId: string) {
    const run = await this.getRunEntity(runId);
    return run.projectId;
  }

  async getReport(runId: string) {
    const run = await this.getRunEntity(runId);
    const report =
      run.status === "succeeded" && run.rehearsalReport
        ? run.rehearsalReport
        : null;
    const responseReport = report
      ? {
          ...report,
          transcriptRetained: false,
          transcript: null,
        }
      : null;
    const audioPlaybackAvailable = await this.isAudioPlaybackAvailable(run);
    const transcriptDownloadAvailable =
      await this.isTranscriptDownloadAvailable(run);

    return getRehearsalReportResponseSchema.parse({
      run: toRehearsalRun(run),
      report: responseReport,
      audioPlaybackAvailable,
      transcriptDownloadAvailable,
    });
  }

  async getAudioClip(runId: string, body: unknown) {
    const request = parseRequest(createRehearsalAudioClipRequestSchema, body);
    const run = await this.getRunEntity(runId);
    const retentionExpiresAt = run.rawAudioDeleteDeadlineAt;
    if (
      run.status !== "succeeded" ||
      !run.audioFileId ||
      run.rawAudioDeletedAt ||
      !retentionExpiresAt ||
      retentionExpiresAt.getTime() <= Date.now()
    ) {
      throw new GoneException({
        code: "REHEARSAL_AUDIO_EXPIRED",
        message: "Rehearsal audio is no longer available.",
      });
    }

    const parsedReport = run.rehearsalReport
      ? rehearsalReportSchema.safeParse(run.rehearsalReport)
      : null;
    const reportDurationSeconds = parsedReport?.success
      ? parsedReport.data.metrics.durationSeconds
      : undefined;
    if (
      reportDurationSeconds !== undefined &&
      request.endSeconds > reportDurationSeconds + 1
    ) {
      throw new BadRequestException(
        "Audio clip range exceeds the recording duration.",
      );
    }

    const startMs = Math.round(request.startSeconds * 1000);
    const endMs = Math.round(request.endSeconds * 1000);
    const derivativeFileName = `volume-${startMs}-${endMs}.wav`;
    const clip = await this.filesService.getOrCreatePrivateAudioDerivative(
      run.projectId,
      run.audioFileId,
      "rehearsal-audio",
      derivativeFileName,
      async (source) => {
        const form = new FormData();
        form.append(
          "file",
          new Blob([source.body], { type: source.contentType }),
          "rehearsal-audio",
        );
        form.append("startSeconds", String(startMs / 1000));
        form.append("endSeconds", String(endMs / 1000));

        let response: Response;
        try {
          response = await fetch(
            new URL("/audio/clip", this.config.PYTHON_WORKER_URL),
            {
              method: "POST",
              body: form,
              signal: AbortSignal.timeout(60_000),
            },
          );
        } catch (error) {
          this.logger.error(
            {
              event: "rehearsal.audio_clip.generation_failed",
              projectId: run.projectId,
              runId: run.runId,
              error: serializeLogError(error),
            },
            "Rehearsal audio clip generation request failed.",
          );
          throw new UnprocessableEntityException(
            "Audio clip generation failed.",
          );
        }
        if (!response.ok) {
          this.logger.warn(
            {
              event: "rehearsal.audio_clip.generation_rejected",
              projectId: run.projectId,
              runId: run.runId,
              statusCode: response.status,
            },
            "Rehearsal audio clip generation was rejected.",
          );
          throw new UnprocessableEntityException(
            "Audio clip generation failed.",
          );
        }
        return new Uint8Array(await response.arrayBuffer());
      },
    );

    const storageKeyHash = createHash("sha256")
      .update(clip.storageKey)
      .digest("hex");
    await this.rehearsalRuns.query(
      `INSERT INTO storage_deletion_outbox (
        deletion_id, project_id, file_id, storage_key, storage_key_hash,
        purpose, status, attempt_count, next_attempt_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,'rehearsal-audio-clip','pending',0,$6,now())
      ON CONFLICT (storage_key_hash) DO NOTHING`,
      [
        `deletion_${storageKeyHash.slice(0, 32)}`,
        run.projectId,
        `clip_${storageKeyHash.slice(0, 32)}`,
        clip.storageKey,
        storageKeyHash,
        retentionExpiresAt.toISOString(),
      ],
    );

    this.logger.info(
      {
        event: clip.created
          ? "rehearsal.audio_clip.created"
          : "rehearsal.audio_clip.cache_hit",
        projectId: run.projectId,
        runId: run.runId,
        startMs,
        endMs,
      },
      "Rehearsal audio clip is ready.",
    );
    return { body: Buffer.from(clip.body), contentType: clip.contentType };
  }
  async getAudioPlaybackUrl(runId: string) {
    const run = await this.getRunEntity(runId);
    if (run.status !== "succeeded") {
      throw new ConflictException({
        code: "REHEARSAL_AUDIO_NOT_READY",
        message:
          "Rehearsal audio playback is available after processing succeeds.",
      });
    }

    const retentionExpiresAt = run.rawAudioDeleteDeadlineAt;
    const now = Date.now();
    if (
      !run.audioFileId ||
      run.rawAudioDeletedAt ||
      !retentionExpiresAt ||
      retentionExpiresAt.getTime() <= now
    ) {
      this.logger.warn(
        {
          event: "rehearsal.audio_playback.unavailable",
          projectId: run.projectId,
          runId: run.runId,
          retentionExpiresAt: retentionExpiresAt?.toISOString() ?? null,
        },
        "Rehearsal audio playback is unavailable.",
      );
      throw new GoneException({
        code: "REHEARSAL_AUDIO_EXPIRED",
        message: "Rehearsal audio is no longer available.",
      });
    }

    const remainingSeconds = Math.floor(
      (retentionExpiresAt.getTime() - now) / 1000,
    );
    if (remainingSeconds < 1) {
      throw new GoneException({
        code: "REHEARSAL_AUDIO_EXPIRED",
        message: "Rehearsal audio is no longer available.",
      });
    }
    const expiresInSeconds = Math.min(
      playbackUrlMaximumExpiresInSeconds,
      remainingSeconds,
    );
    const playbackUrl = await this.filesService.createPrivateAudioReadUrl(
      run.projectId,
      run.audioFileId,
      "rehearsal-audio",
      expiresInSeconds,
    );
    const expiresAt = new Date(now + expiresInSeconds * 1000);

    this.logger.info(
      {
        event: "rehearsal.audio_playback_url.created",
        projectId: run.projectId,
        runId: run.runId,
        retentionExpiresAt: retentionExpiresAt.toISOString(),
      },
      "Rehearsal audio playback URL created.",
    );

    return rehearsalAudioPlaybackUrlResponseSchema.parse({
      playbackUrl,
      expiresAt: expiresAt.toISOString(),
      retentionExpiresAt: retentionExpiresAt.toISOString(),
    });
  }

  async getDownload(
    runId: string,
    artifact: "audio" | "transcript",
  ): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const run = await this.getRunEntity(runId);
    if (run.status !== "succeeded") {
      throw new ConflictException({
        code: "REHEARSAL_DOWNLOAD_NOT_READY",
        message: "Rehearsal downloads are available after processing succeeds.",
      });
    }

    if (artifact === "transcript") {
      if (!run.transcriptRetained || !run.transcriptTextFileId) {
        throw new GoneException({
          code: "REHEARSAL_TRANSCRIPT_UNAVAILABLE",
          message: "Rehearsal transcript is no longer available.",
        });
      }
      const file = await this.filesService.readOwnerOnlyAssetContent(
        run.projectId,
        run.transcriptTextFileId,
        "rehearsal-transcript-text",
      );
      return { ...file, fileName: "transcript.txt" };
    }

    if (
      !run.audioFileId ||
      run.rawAudioDeletedAt ||
      !run.rawAudioDeleteDeadlineAt ||
      run.rawAudioDeleteDeadlineAt.getTime() <= Date.now()
    ) {
      throw new GoneException({
        code: "REHEARSAL_AUDIO_EXPIRED",
        message: "Rehearsal audio is no longer available.",
      });
    }
    const file = await this.filesService.readOwnerOnlyAssetContent(
      run.projectId,
      run.audioFileId,
      "rehearsal-audio",
    );
    return { ...file, fileName: "rehearsal.webm" };
  }

  async getSummary(projectId: string) {
    await this.projectsService.getAccessibleProject(projectId);

    const [runs, project] = await Promise.all([
      this.rehearsalRuns.find({
        where: { projectId, status: "succeeded" },
        order: { createdAt: "ASC" },
      }),
      this.projects.findOne({ where: { projectId } }),
    ]);

    if (runs.length === 0) {
      return getRehearsalProjectSummaryResponseSchema.parse({ summary: null });
    }

    return getRehearsalProjectSummaryResponseSchema.parse({
      summary: buildRehearsalProjectSummary({
        projectId,
        runs,
        progressComment: project?.progressComment ?? null,
      }),
    });
  }
}
