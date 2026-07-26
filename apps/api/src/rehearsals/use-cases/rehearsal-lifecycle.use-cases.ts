import {
  cancelRehearsalRunResponseSchema,
  updateRehearsalRunMetaRequestSchema,
  updateRehearsalRunMetaResponseSchema,
} from "@orbit/shared/rehearsals";
import { BadRequestException } from "@nestjs/common";
import { parseRequest } from "../../common/zod-request";
import { toRehearsalRun } from "../mappers/rehearsal-run.mapper";
import { RehearsalUploadUseCases } from "./rehearsal-upload.use-cases";

export class RehearsalLifecycleUseCases extends RehearsalUploadUseCases {
  async updateRunMeta(runId: string, body: unknown) {
    const request = parseRequest(updateRehearsalRunMetaRequestSchema, body);
    const run = await this.getRunEntity(runId);

    if (!["created", "uploading"].includes(run.status)) {
      throw new BadRequestException(
        "Rehearsal run is not accepting meta updates.",
      );
    }

    run.metaJson = request;
    run.updatedAt = new Date();
    const savedRun = await this.rehearsalRuns.save(run);

    return updateRehearsalRunMetaResponseSchema.parse({
      run: toRehearsalRun(savedRun),
    });
  }

  async cancelRun(runId: string) {
    const run = await this.getRunEntity(runId);
    if (run.status === "cancelled") {
      return cancelRehearsalRunResponseSchema.parse({
        run: toRehearsalRun(run),
      });
    }

    if (!["created", "uploading"].includes(run.status) || run.jobId !== null) {
      throw new BadRequestException(
        "Rehearsal run cannot be cancelled after audio processing starts.",
      );
    }

    const result = await this.rehearsalRuns.update(
      {
        runId: run.runId,
        projectId: run.projectId,
        status: run.status,
      },
      {
        status: "cancelled",
        error: null,
        updatedAt: new Date(),
      },
    );

    if (!result.affected) {
      throw new BadRequestException(
        "Rehearsal run cannot be cancelled after audio processing starts.",
      );
    }

    const cancelled = await this.getRunEntity(run.runId);
    return cancelRehearsalRunResponseSchema.parse({
      run: toRehearsalRun(cancelled),
    });
  }
}
