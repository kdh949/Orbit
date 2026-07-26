import type { Job, ActiveJobType } from "@orbit/shared/jobs";

export interface EnqueueJobInput {
  projectId?: string;
  type: ActiveJobType;
  payload?: Record<string, unknown>;
}

export interface JobQueuePort {
  enqueue(input: EnqueueJobInput): Promise<Job>;
  update(jobId: string, patch: UpdateJobInput): Promise<Job | null>;
  get(jobId: string): Promise<Job | null>;
}

export type UpdateJobInput = Partial<
  Pick<Job, "status" | "progress" | "message" | "result" | "error">
>;
