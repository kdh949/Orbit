import { describe, expect, it } from "vitest";
import {
  activeJobTypeSchema,
  historicalJobTypeSchema,
  internalCoachingJobTypeSchema,
  jobSchema,
  jobTypeSchema,
  publicCreatableJobTypeSchema,
} from "./job.schema";

describe("jobTypeSchema", () => {
  it("accepts worker health check jobs", () => {
    expect(jobTypeSchema.parse("worker-health-check")).toBe(
      "worker-health-check",
    );
  });

  it("accepts PPTX OOXML generation jobs", () => {
    expect(jobTypeSchema.parse("pptx-ooxml-generation")).toBe(
      "pptx-ooxml-generation",
    );
  });

  it("keeps legacy job types readable but blocks active and public creation", () => {
    for (const type of ["pptx-import", "ai-template-deck-generation"] as const) {
      expect(historicalJobTypeSchema.parse(type)).toBe(type);
      expect(jobTypeSchema.parse(type)).toBe(type);
      expect(activeJobTypeSchema.safeParse(type).success).toBe(false);
      expect(publicCreatableJobTypeSchema.safeParse(type).success).toBe(false);
      expect(
        jobSchema.parse({
          jobId: `job-${type}`,
          projectId: "project-a",
          type,
          status: "succeeded",
          progress: 100,
          message: "done",
          result: null,
          error: null,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z",
        }).type
      ).toBe(type);
    }
  });

  it("accepts PPTX OOXML sync jobs", () => {
    expect(jobTypeSchema.parse("pptx-ooxml-sync")).toBe("pptx-ooxml-sync");
  });

  it("accepts rehearsal semantic evaluation retry jobs", () => {
    expect(jobTypeSchema.parse("rehearsal-semantic-evaluation")).toBe(
      "rehearsal-semantic-evaluation"
    );
  });

  it("accepts speaker notes suggestions without exposing generic creation", () => {
    expect(activeJobTypeSchema.parse("speaker-notes-suggestion")).toBe(
      "speaker-notes-suggestion"
    );
    expect(
      publicCreatableJobTypeSchema.safeParse("speaker-notes-suggestion").success
    ).toBe(false);
  });

  it("keeps design image generation internal to its dedicated API", () => {
    expect(activeJobTypeSchema.parse("design-image-generation")).toBe(
      "design-image-generation",
    );
    expect(
      publicCreatableJobTypeSchema.safeParse("design-image-generation").success,
    ).toBe(false);
  });

  it("accepts internal coaching jobs but never exposes them as public create types", () => {
    for (const type of internalCoachingJobTypeSchema.options) {
      expect(jobTypeSchema.parse(type)).toBe(type);
      expect(activeJobTypeSchema.parse(type)).toBe(type);
      expect(publicCreatableJobTypeSchema.safeParse(type).success).toBe(false);
    }
  });

  it("keeps activity retention internal while allowing worker execution", () => {
    expect(activeJobTypeSchema.parse("activity-response-retention")).toBe(
      "activity-response-retention",
    );
    expect(
      publicCreatableJobTypeSchema.safeParse("activity-response-retention").success,
    ).toBe(false);
  });
});

describe("jobSchema error metadata", () => {
  const baseJob = {
    jobId: "job-ai-deck-1",
    projectId: "project-a",
    type: "ai-deck-generation" as const,
    status: "failed" as const,
    progress: 40,
    message: "failed",
    result: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };

  it("keeps legacy error rows readable", () => {
    expect(
      jobSchema.parse({
        ...baseJob,
        error: { code: "LEGACY_FAILURE", message: "legacy failure" },
      }).error,
    ).toEqual({ code: "LEGACY_FAILURE", message: "legacy failure" });
  });

  it("preserves failed stage and retryability metadata", () => {
    expect(
      jobSchema.parse({
        ...baseJob,
        error: {
          code: "WEB_RESEARCH_PROVIDER_FAILED",
          message: "provider unavailable",
          failedStage: "source-grounding",
          retryable: true,
        },
      }).error,
    ).toEqual({
      code: "WEB_RESEARCH_PROVIDER_FAILED",
      message: "provider unavailable",
      failedStage: "source-grounding",
      retryable: true,
    });
  });

  it("preserves the OOXML sync capability that produced a failure", () => {
    expect(
      jobSchema.parse({
        ...baseJob,
        error: {
          code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
          message: "unsupported operation",
          retryable: false,
          syncCapabilityVersion: 2,
        },
      }).error,
    ).toEqual({
      code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
      message: "unsupported operation",
      retryable: false,
      syncCapabilityVersion: 2,
    });
  });

  it("rejects unknown failed stage values", () => {
    expect(
      jobSchema.safeParse({
        ...baseJob,
        error: {
          code: "STAGE_FAILED",
          message: "stage failed",
          failedStage: "unknown-stage",
          retryable: false,
        },
      }).success,
    ).toBe(false);
  });
});
