import { describe, expect, it } from "vitest";
import { RehearsalsService } from "./rehearsals.service";
import { RehearsalComparisonUseCases } from "./use-cases/rehearsal-comparison.use-cases";
import { RehearsalCreationUseCases } from "./use-cases/rehearsal-creation.use-cases";
import { RehearsalLifecycleUseCases } from "./use-cases/rehearsal-lifecycle.use-cases";
import { RehearsalReportUseCases } from "./use-cases/rehearsal-report.use-cases";
import { RehearsalRetryUseCases } from "./use-cases/rehearsal-retry.use-cases";
import { RehearsalUploadUseCases } from "./use-cases/rehearsal-upload.use-cases";

function publicMethods(target: object): string[] {
  return Object.getOwnPropertyNames(target)
    .filter((name) => name !== "constructor")
    .sort();
}

describe("RehearsalsService architecture", () => {
  it("keeps the injectable service as a constructor-only facade", () => {
    expect(publicMethods(RehearsalsService.prototype)).toEqual([]);
  });

  it("owns public workflows in capability-specific use cases", () => {
    expect(publicMethods(RehearsalCreationUseCases.prototype)).toEqual([
      "createRun",
    ]);
    expect(publicMethods(RehearsalUploadUseCases.prototype)).toEqual([
      "completeAudioUpload",
      "createAudioUploadUrl",
    ]);
    expect(publicMethods(RehearsalLifecycleUseCases.prototype)).toEqual([
      "cancelRun",
      "updateRunMeta",
    ]);
    expect(publicMethods(RehearsalReportUseCases.prototype)).toEqual([
      "getAudioClip",
      "getAudioPlaybackUrl",
      "getDownload",
      "getReport",
      "getRun",
      "getRunProjectId",
      "getSummary",
      "listRuns",
    ]);
    expect(publicMethods(RehearsalComparisonUseCases.prototype)).toEqual([
      "getComparison",
    ]);
    expect(publicMethods(RehearsalRetryUseCases.prototype)).toEqual([
      "retrySemanticEvaluation",
    ]);
  });
});
