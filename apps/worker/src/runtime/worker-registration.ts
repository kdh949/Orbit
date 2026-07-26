import type { Job as OrbitJob } from "@orbit/shared/jobs";
import type { Job as BullMqJob } from "bullmq";

export interface WorkerRegistration {
  queueName: string;
  handler(job: BullMqJob): Promise<OrbitJob | void>;
}
