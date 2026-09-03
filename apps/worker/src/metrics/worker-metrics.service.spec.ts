import { Registry } from "@prometheus-io/client";
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

  it("exports sampled job latency exemplars as OpenMetrics", async () => {
    const metrics = new WorkerMetricsService();

    metrics.recordJobStarted("rehearsal-stt", "rehearsal-stt");
    metrics.recordJobCompleted(
      "rehearsal-stt",
      "rehearsal-stt",
      "succeeded",
      0.25,
      {
        traceID: "0123456789abcdef0123456789abcdef",
        spanID: "0123456789abcdef",
      },
    );
    const output = await metrics.metrics();

    expect(metrics.registry.contentType).toBe(
      Registry.OPENMETRICS_CONTENT_TYPE,
    );
    expect(output).toContain(
      '# {traceID="0123456789abcdef0123456789abcdef",spanID="0123456789abcdef"} 0.25',
    );
    expect(output.endsWith("# EOF\n")).toBe(true);
  });

  it("deduplicates BullMQ metric metadata across queues", () => {
    const output = mergePrometheusText([
      '# HELP bullmq_job_count Number of jobs\n# TYPE bullmq_job_count gauge\nbullmq_job_count{queue="a"} 1\n# EOF\n',
      '# HELP bullmq_job_count Number of jobs\n# TYPE bullmq_job_count gauge\nbullmq_job_count{queue="b"} 2\n',
    ]);

    expect(output.match(/# HELP bullmq_job_count/g)).toHaveLength(1);
    expect(output).toContain('queue="a"');
    expect(output).toContain('queue="b"');
    expect(output.match(/# EOF/g)).toHaveLength(1);
    expect(output.endsWith("# EOF\n")).toBe(true);
  });

  it("normalizes BullMQ counter metadata for OpenMetrics", () => {
    const output = mergePrometheusText([
      [
        "# HELP bullmq_job_completed_total Total number of completed jobs",
        "# TYPE bullmq_job_completed_total counter",
        'bullmq_job_completed_total{queue="a"} 3',
        "# HELP bullmq_job_failed_total Total number of failed jobs",
        "# TYPE bullmq_job_failed_total counter",
        'bullmq_job_failed_total{queue="a"} 1',
      ].join("\n"),
    ]);

    expect(output).toContain(
      "# HELP bullmq_job_completed Total number of completed jobs",
    );
    expect(output).toContain("# TYPE bullmq_job_completed counter");
    expect(output).toContain('bullmq_job_completed_total{queue="a"} 3');
    expect(output).toContain(
      "# HELP bullmq_job_failed Total number of failed jobs",
    );
    expect(output).toContain("# TYPE bullmq_job_failed counter");
    expect(output).toContain('bullmq_job_failed_total{queue="a"} 1');
    expect(output).not.toContain("# TYPE bullmq_job_completed_total counter");
    expect(output).not.toContain("# TYPE bullmq_job_failed_total counter");
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
