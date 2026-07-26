import { InMemoryJobQueue } from "../memory";

export class BullMqJobQueue extends InMemoryJobQueue {
  readonly driver = "bullmq" as const;
}
