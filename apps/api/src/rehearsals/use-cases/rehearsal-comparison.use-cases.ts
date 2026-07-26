import {
  getRehearsalRunComparisonResponseSchema,
  rehearsalReportSchema,
} from "@orbit/shared/rehearsals";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { LessThan } from "typeorm";
import { buildRehearsalRunComparison } from "../rehearsal-run-comparison";
import { RehearsalReportUseCases } from "./rehearsal-report.use-cases";

export class RehearsalComparisonUseCases extends RehearsalReportUseCases {
  async getComparison(projectId: string, runId: string) {
    await this.projectsService.getAccessibleProject(projectId);
    const currentRun = await this.rehearsalRuns.findOne({ where: { runId } });
    if (!currentRun || currentRun.projectId !== projectId) {
      throw new NotFoundException(`Rehearsal run not found: ${runId}`);
    }
    if (
      currentRun.status !== "succeeded" ||
      currentRun.rehearsalReport === null
    ) {
      throw new ConflictException({
        code: "REHEARSAL_COMPARISON_NOT_READY",
        message: "Rehearsal comparison is available after the report succeeds.",
      });
    }

    const currentReport = rehearsalReportSchema.safeParse(
      currentRun.rehearsalReport,
    );
    if (!currentReport.success) {
      throw new ConflictException({
        code: "REHEARSAL_COMPARISON_REPORT_INVALID",
        message: "The current rehearsal report cannot be compared.",
      });
    }

    const previousRun = await this.rehearsalRuns.findOne({
      where: {
        projectId,
        status: "succeeded",
        createdAt: LessThan(currentRun.createdAt),
      },
      order: { createdAt: "DESC" },
    });
    const previousReport = previousRun?.rehearsalReport
      ? rehearsalReportSchema.safeParse(previousRun.rehearsalReport)
      : null;
    const comparison = buildRehearsalRunComparison({
      currentReport: currentReport.data,
      currentRunId: currentRun.runId,
      previousReport: previousReport?.success ? previousReport.data : null,
      previousRunId: previousReport?.success
        ? (previousRun?.runId ?? null)
        : null,
    });

    return getRehearsalRunComparisonResponseSchema.parse(comparison);
  }
}
