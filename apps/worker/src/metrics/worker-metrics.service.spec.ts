import { describe, expect, it } from "vitest";

import {
  mergePrometheusText,
  WorkerMetricsService,
} from "./worker-metrics.service";

describe("WorkerMetricsService", () => {
  it("records bounded job labels without job identifiers", async () => {
    const metrics = new WorkerMetricsService();

    metrics.recordJobStarted("rehearsal-stt", "rehearsal-stt");
    metrics.recordJobCompleted(
      "rehearsal-stt",
      "rehearsal-stt",
      "succeeded",
      0.25,
    );
    const output = await metrics.metrics();

    expect(output).toContain('queue_name="rehearsal-stt"');
    expect(output).toContain('outcome="succeeded"');
    expect(output).not.toContain("job_private_123");
  });

  it("deduplicates BullMQ metric metadata across queues", () => {
    const output = mergePrometheusText([
      '# HELP bullmq_job_count Number of jobs\n# TYPE bullmq_job_count gauge\nbullmq_job_count{queue="a"} 1\n',
      '# HELP bullmq_job_count Number of jobs\n# TYPE bullmq_job_count gauge\nbullmq_job_count{queue="b"} 2\n',
    ]);

    expect(output.match(/# HELP bullmq_job_count/g)).toHaveLength(1);
    expect(output).toContain('queue="a"');
    expect(output).toContain('queue="b"');
  });
});
