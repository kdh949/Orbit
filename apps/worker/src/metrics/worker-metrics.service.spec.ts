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

  it("exports shared database query metrics without SQL labels", async () => {
    const metrics = new WorkerMetricsService();
    const queryRunner = {};

    metrics.databaseQuerySubscriber.beforeQuery({
      query: "UPDATE jobs SET status = $1 WHERE id = $2",
      queryRunner,
    });
    metrics.databaseQuerySubscriber.afterQuery({
      query: "UPDATE jobs SET status = $1 WHERE id = $2",
      queryRunner,
      success: false,
      executionTime: 18,
    });

    const output = await metrics.metrics();

    expect(output).toContain("orbit_db_client_queries_total");
    expect(output).toContain('operation="update",outcome="error"');
    expect(output).not.toContain("jobs SET status");
  });
});
