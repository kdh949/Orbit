import type { Job as OrbitJob } from "@orbit/shared";
import type { Job as BullMqJob } from "bullmq";

export interface WorkerRegistration {
  queueName: string;
  handler(job: BullMqJob): Promise<OrbitJob | void>;
}
