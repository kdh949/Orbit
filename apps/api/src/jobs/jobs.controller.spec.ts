import type { Job } from "@orbit/shared/jobs";
import { PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { authSessionCookieName } from "../auth/auth.constants";
import type { AuthService } from "../auth/auth.service";
import type { SignedCookieRequest } from "../auth/current-user";
import type { ProjectsService } from "../projects/projects.service";
import { JobsController } from "./jobs.controller";
import type { JobsService } from "./jobs.service";

const job: Job = {
  jobId: "job-1",
  projectId: "project-a",
  type: "ai-deck-generation",
  status: "queued",
  progress: 0,
  message: "Job queued",
  result: null,
  error: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

describe("JobsController", () => {
  it("exposes the generic and v1 job polling routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, JobsController)).toEqual([
      "jobs",
      "api/v1/jobs",
    ]);
  });

  it("requires project write permission before creating a generic job", async () => {
    const { controller, jobsService, projectsService } = createController();

    await controller.createJob(
      { projectId: "project-a", type: "worker-health-check" },
      signedRequest(),
    );

    expect(projectsService.assertCanWriteProject).toHaveBeenCalledWith(
      "project-a",
      "user-1",
    );
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: "project-a",
      type: "worker-health-check",
    });
  });

  it("rejects internal coaching job types on the public endpoint", async () => {
    const { controller, jobsService } = createController();

    await expect(
      controller.createJob(
        {
          projectId: "project-a",
          type: "focused-practice-analysis",
          payload: { attemptId: "attempt-1" },
        },
        signedRequest(),
      ),
    ).rejects.toThrow();
    expect(jobsService.create).not.toHaveBeenCalled();
  });

  it("rejects legacy job types on the public endpoint", async () => {
    for (const type of ["pptx-import", "ai-template-deck-generation"] as const) {
      const { controller, jobsService } = createController();

      await expect(
        controller.createJob({ projectId: "project-a", type }, signedRequest())
      ).rejects.toThrow();
      expect(jobsService.create).not.toHaveBeenCalled();
    }
  });

  it("requires project read permission before returning a job result", async () => {
    const { controller, jobsService, projectsService } = createController();

    await controller.getJob("job-1", signedRequest());

    expect(jobsService.get).toHaveBeenCalledWith("job-1");
    expect(projectsService.assertCanReadProject).toHaveBeenCalledWith(
      "project-a",
      "user-1",
    );
    expect(
      jobsService.get.mock.invocationCallOrder[0],
    ).toBeLessThan(projectsService.assertCanReadProject.mock.invocationCallOrder[0]);
  });
});

function createController() {
  const authService = {
    me: vi.fn(async () => ({
      user: { userId: "user-1", email: "user@example.com" },
    })),
  } as unknown as AuthService;
  const jobsService = {
    create: vi.fn(async () => job),
    get: vi.fn(async () => job),
  };
  const projectsService = {
    assertCanReadProject: vi.fn(async () => ({ projectId: "project-a" })),
    assertCanWriteProject: vi.fn(async () => ({ projectId: "project-a" })),
  };

  return {
    controller: new JobsController(
      authService,
      jobsService as unknown as JobsService,
      projectsService as unknown as ProjectsService,
    ),
    jobsService,
    projectsService,
  };
}

function signedRequest(): SignedCookieRequest {
  return {
    signedCookies: {
      [authSessionCookieName]: "session-1",
    },
  } as unknown as SignedCookieRequest;
}
