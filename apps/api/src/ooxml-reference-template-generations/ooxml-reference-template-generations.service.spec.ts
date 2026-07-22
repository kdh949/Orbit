import type { Job } from "@orbit/shared";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobsService } from "../jobs/jobs.service";
import type { ProjectsService } from "../projects/projects.service";
import { OoxmlReferenceTemplateGenerationsService } from "./ooxml-reference-template-generations.service";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    JOB_QUEUE_DRIVER: "bullmq",
    REDIS_URL: "redis://test",
  }),
}));

describe("OoxmlReferenceTemplateGenerationsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the dedicated active job and enqueues the exact user template version", async () => {
    const job = queuedJob();
    const jobs = {
      create: vi.fn(async () => job),
      update: vi.fn(),
    } as unknown as JobsService;
    const enqueue = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const service = new OoxmlReferenceTemplateGenerationsService(
      jobs,
      accessibleProjects(),
      enqueue,
      logger as never,
    );

    const response = await service.createGeneration("project-a", validRequest());

    expect(response).toEqual({ job });
    expect(jobs.create).toHaveBeenCalledWith({
      projectId: "project-a",
      type: "ooxml-reference-template-generation",
      payload: { request: validRequest() },
    });
    expect(enqueue).toHaveBeenCalledWith({
      driver: "bullmq",
      redisUrl: "redis://test",
      jobId: "job-reference-1",
      projectId: "project-a",
      request: validRequest(),
    });
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "ooxml_reference_template.generation.enqueued",
        jobId: "job-reference-1",
        projectId: "project-a",
        templateId: "operating-review",
        templateVersion: 1,
      },
      "OOXML reference template generation job enqueued.",
    );
  });

  it("rejects auto template selection during the first rollout before creating a job", async () => {
    const jobs = { create: vi.fn(), update: vi.fn() } as unknown as JobsService;
    const enqueue = vi.fn();
    const service = new OoxmlReferenceTemplateGenerationsService(
      jobs,
      accessibleProjects(),
      enqueue,
      { info: vi.fn(), error: vi.fn() } as never,
    );

    await expect(
      service.createGeneration("project-a", {
        ...validRequest(),
        templateSelection: { mode: "auto" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["general generation mode", { generationMode: "ooxml-reference" }],
    ["template blueprint", { templateBlueprintId: "blueprint-1" }],
    ["design references", { designReferences: [] }],
    ["recipe selector", { slidePresetId: "process-horizontal" }],
  ])("rejects forbidden %s fields before creating a job", async (_name, field) => {
    const jobs = { create: vi.fn(), update: vi.fn() } as unknown as JobsService;
    const enqueue = vi.fn();
    const service = new OoxmlReferenceTemplateGenerationsService(
      jobs,
      accessibleProjects(),
      enqueue,
      { info: vi.fn(), error: vi.fn() } as never,
    );

    await expect(
      service.createGeneration("project-a", { ...validRequest(), ...field }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("marks the job failed with a bounded OOXML_REFERENCE code when enqueue fails", async () => {
    const job = queuedJob();
    const jobs = {
      create: vi.fn(async () => job),
      update: vi.fn(async () => ({
        ...job,
        status: "failed",
        error: {
          code: "OOXML_REFERENCE_ENQUEUE_FAILED",
          message: "OOXML reference template generation could not be queued.",
        },
      })),
    } as unknown as JobsService;
    const sensitiveFailure = new Error(
      "signedUrl=https://storage.invalid/private?secret=do-not-log",
    );
    const logger = { info: vi.fn(), error: vi.fn() };
    const service = new OoxmlReferenceTemplateGenerationsService(
      jobs,
      accessibleProjects(),
      vi.fn(async () => {
        throw sensitiveFailure;
      }),
      logger as never,
    );

    await expect(
      service.createGeneration("project-a", validRequest()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(jobs.update).toHaveBeenCalledWith("job-reference-1", {
      status: "failed",
      progress: 0,
      message: "OOXML reference template generation enqueue failed.",
      error: {
        code: "OOXML_REFERENCE_ENQUEUE_FAILED",
        message: "OOXML reference template generation could not be queued.",
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "ooxml_reference_template.generation.enqueue_failed",
        jobId: "job-reference-1",
        projectId: "project-a",
        templateId: "operating-review",
        templateVersion: 1,
        issueCode: "OOXML_REFERENCE_ENQUEUE_FAILED",
      },
      "OOXML reference template generation enqueue failed.",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("do-not-log");
  });
});

function validRequest() {
  return {
    topic: "2026 하반기 운영 리뷰",
    prompt: "핵심 KPI와 실행 과제를 정리",
    targetDurationMinutes: 10,
    slideCountRange: { min: 8, max: 10 },
    metadata: {
      audience: "executive" as const,
      purpose: "report" as const,
      tone: "professional" as const,
    },
    referencePolicy: "references-first" as const,
    referenceFileIds: ["file-reference-1"],
    templateSelection: {
      mode: "user" as const,
      templateId: "operating-review",
      version: 1,
    },
  };
}

function accessibleProjects() {
  return {
    getAccessibleProject: vi.fn(async () => ({ projectId: "project-a" })),
  } as unknown as ProjectsService;
}

function queuedJob(): Job {
  return {
    jobId: "job-reference-1",
    projectId: "project-a",
    type: "ooxml-reference-template-generation",
    status: "queued",
    progress: 0,
    message: "Job queued",
    result: null,
    error: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
