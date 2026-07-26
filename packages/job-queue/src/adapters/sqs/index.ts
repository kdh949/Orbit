import type { Job } from "@orbit/shared/jobs";

import type {
  EnqueueJobInput,
  JobQueuePort,
  UpdateJobInput,
} from "../../ports";

export class SqsJobQueue implements JobQueuePort {
  async enqueue(_input: EnqueueJobInput): Promise<Job> {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  async get(_jobId: string): Promise<Job | null> {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  async update(_jobId: string, _patch: UpdateJobInput): Promise<Job | null> {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }
}
