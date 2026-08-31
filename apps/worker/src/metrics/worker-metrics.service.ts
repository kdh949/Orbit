import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "@prometheus-io/client";
import { Injectable } from "@nestjs/common";
import { redisConnectionOptions } from "@orbit/job-queue";
import { Queue } from "bullmq";
import { createServer, type Server } from "node:http";

const durationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30, 60, 300];

@Injectable()
export class WorkerMetricsService {
  readonly registry = new Registry();
  private readonly jobsStarted = new Counter({
    name: "orbit_worker_jobs_started_total",
    help: "Worker job processing attempts started.",
    labelNames: ["queue_name", "job_name"] as const,
    registers: [this.registry],
  });
  private readonly jobsCompleted = new Counter({
    name: "orbit_worker_jobs_completed_total",
    help: "Worker job processing attempts completed by outcome.",
    labelNames: ["queue_name", "job_name", "outcome"] as const,
    registers: [this.registry],
  });
  private readonly jobDuration = new Histogram({
    name: "orbit_worker_job_duration_seconds",
    help: "Worker job processing attempt duration in seconds.",
    labelNames: ["queue_name", "job_name", "outcome"] as const,
    buckets: durationBuckets,
    registers: [this.registry],
  });
  private readonly activeJobs = new Gauge({
    name: "orbit_worker_active_jobs",
    help: "Worker jobs currently being processed.",
    labelNames: ["queue_name"] as const,
    registers: [this.registry],
  });
  private queues: Queue[] = [];
  private server: Server | null = null;

  constructor() {
    collectDefaultMetrics({
      prefix: "orbit_worker_process_",
      register: this.registry,
    });
  }

  recordJobStarted(queueName: string, jobName: string): void {
    this.jobsStarted.inc({ queue_name: queueName, job_name: jobName });
    this.activeJobs.inc({ queue_name: queueName });
  }

  recordJobCompleted(
    queueName: string,
    jobName: string,
    outcome: "succeeded" | "failed" | "progressed",
    durationSeconds: number,
  ): void {
    const labels = {
      queue_name: queueName,
      job_name: jobName,
      outcome,
    };
    this.jobsCompleted.inc(labels);
    this.jobDuration.observe(labels, durationSeconds);
    this.activeJobs.dec({ queue_name: queueName });
  }

  start(input: { queueNames: string[]; redisUrl: string; port: number }): void {
    if (this.server) return;
    this.queues = [...new Set(input.queueNames)].map(
      (queueName) =>
        new Queue(queueName, {
          connection: redisConnectionOptions(input.redisUrl),
        }),
    );
    this.server = createServer(async (request, response) => {
      if (request.method !== "GET" || request.url !== "/metrics") {
        response.writeHead(404).end();
        return;
      }
      try {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": this.registry.contentType,
        });
        response.end(await this.metrics());
      } catch {
        response.writeHead(500).end("metrics collection failed\n");
      }
    });
    this.server.listen(input.port, "0.0.0.0");
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    await Promise.all(this.queues.map((queue) => queue.close()));
    this.queues = [];
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async metrics(): Promise<string> {
    const queueMetrics = await Promise.all(
      this.queues.map((queue) =>
        queue.exportPrometheusMetrics({ service: "worker" }),
      ),
    );
    return mergePrometheusText([
      await this.registry.metrics(),
      ...queueMetrics,
    ]);
  }
}

export function mergePrometheusText(documents: string[]): string {
  const metadata = new Set<string>();
  const lines: string[] = [];
  for (const document of documents) {
    for (const line of document.trim().split("\n")) {
      if (
        (line.startsWith("# HELP ") || line.startsWith("# TYPE ")) &&
        metadata.has(line)
      ) {
        continue;
      }
      if (line.startsWith("# HELP ") || line.startsWith("# TYPE ")) {
        metadata.add(line);
      }
      if (line.length > 0) lines.push(line);
    }
  }
  return `${lines.join("\n")}\n`;
}
