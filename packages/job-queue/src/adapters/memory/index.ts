import { demoIds, nowIso } from "@orbit/shared/common";
import { jobSchema, type Job } from "@orbit/shared/jobs";

import type {
  EnqueueJobInput,
  JobQueuePort,
  UpdateJobInput,
} from "../../ports";

export class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs = new Map<string, Job>();
  private jobSequence = 0;

  async enqueue(input: EnqueueJobInput): Promise<Job> {
    const now = nowIso();
    this.jobSequence += 1;
    const job = jobSchema.parse({
      jobId: `job_${Date.now()}_${this.jobSequence}`,
      projectId: input.projectId ?? demoIds.projectId,
      type: input.type,
      status: "queued",
      progress: 0,
      message: "작업 대기 중",
      result: input.payload ?? null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });

    this.jobs.set(job.jobId, job);
    return job;
  }

  async get(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async update(jobId: string, patch: UpdateJobInput): Promise<Job | null> {
    const current = this.jobs.get(jobId);
    if (!current) {
      return null;
    }

    const job = jobSchema.parse({
      ...current,
      ...patch,
      updatedAt: nowIso(),
    });
    this.jobs.set(jobId, job);
    return job;
  }
}
