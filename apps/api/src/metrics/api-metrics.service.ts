import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "@prometheus-io/client";
import { Injectable } from "@nestjs/common";
import { createTypeOrmQueryMetrics } from "@orbit/observability";

const httpDurationBuckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const responseSizeBuckets = [
  512, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216,
];

export type HttpResponseOutcome = "completed" | "aborted";

@Injectable()
export class ApiMetricsService {
  readonly registry = new Registry();
  private readonly databaseQueryMetrics = createTypeOrmQueryMetrics({
    registry: this.registry,
  });
  readonly databaseQuerySubscriber = this.databaseQueryMetrics.subscriber;
  private readonly httpRequests = new Counter({
    name: "orbit_api_http_requests_total",
    help: "Completed API HTTP requests.",
    labelNames: ["method", "route", "status_class"] as const,
    registers: [this.registry],
  });
  private readonly httpDuration = new Histogram({
    name: "orbit_api_http_request_duration_seconds",
    help: "API HTTP request duration in seconds.",
    labelNames: ["method", "route", "status_class"] as const,
    buckets: httpDurationBuckets,
    registers: [this.registry],
  });
  private readonly responseBodySize = new Histogram({
    name: "orbit_api_http_response_body_size_bytes",
    help: "API HTTP response body bytes written before completion or abort.",
    labelNames: ["method", "route", "status_class", "outcome"] as const,
    buckets: responseSizeBuckets,
    registers: [this.registry],
  });
  private readonly responseWriteDuration = new Histogram({
    name: "orbit_api_http_response_write_duration_seconds",
    help: "Time from the first API response write to the Node finish event.",
    labelNames: ["method", "route", "status_class", "outcome"] as const,
    buckets: httpDurationBuckets,
    registers: [this.registry],
  });
  private readonly responsePostHandlerDuration = new Histogram({
    name: "orbit_api_http_response_post_handler_duration_seconds",
    help: "Time from controller completion to the Node finish event.",
    labelNames: ["method", "route", "status_class", "outcome"] as const,
    buckets: httpDurationBuckets,
    registers: [this.registry],
  });
  private readonly inFlightRequests = new Gauge({
    name: "orbit_api_http_in_flight_requests",
    help: "API HTTP requests that have not finished or aborted.",
    registers: [this.registry],
  });
  private readonly responseAborts = new Counter({
    name: "orbit_api_http_response_aborts_total",
    help: "API HTTP responses closed before the Node finish event.",
    labelNames: ["method", "route", "status_class"] as const,
    registers: [this.registry],
  });
  private readonly audienceJoinBypasses = new Counter({
    name: "orbit_audience_join_rate_limit_bypass_total",
    help: "Authorized passcode audience join rate-limit bypasses.",
    registers: [this.registry],
  });
  private readonly handlerCompletedAt = new WeakMap<object, bigint>();

  constructor() {
    collectDefaultMetrics({
      prefix: "orbit_api_process_",
      register: this.registry,
    });
  }

  recordHttpRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
  }): void {
    const labels = {
      method: normalizeMethod(input.method),
      route: normalizeRoute(input.route),
      status_class: statusClass(input.statusCode),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, input.durationSeconds);
  }

  markHttpRequestStarted(): void {
    this.inFlightRequests.inc();
  }

  markHttpHandlerCompleted(
    response: object,
    completedAt: bigint = process.hrtime.bigint(),
  ): void {
    if (!this.handlerCompletedAt.has(response)) {
      this.handlerCompletedAt.set(response, completedAt);
    }
  }

  takeHttpHandlerCompletedAt(response: object): bigint | undefined {
    const completedAt = this.handlerCompletedAt.get(response);
    this.handlerCompletedAt.delete(response);
    return completedAt;
  }

  recordHttpResponse(input: {
    durationSeconds: number;
    headersSent: boolean;
    method: string;
    outcome: HttpResponseOutcome;
    postHandlerDurationSeconds?: number;
    responseBodyBytes: number;
    responseWriteDurationSeconds?: number;
    route: string;
    statusCode: number;
  }): void {
    const labels = {
      method: normalizeMethod(input.method),
      route: normalizeRoute(input.route),
      status_class:
        input.outcome === "aborted" && !input.headersSent
          ? "uncommitted"
          : statusClass(input.statusCode),
    };
    const outcomeLabels = { ...labels, outcome: input.outcome };

    if (input.outcome === "completed") {
      this.httpRequests.inc(labels);
      this.httpDuration.observe(labels, nonNegative(input.durationSeconds));
    } else {
      this.responseAborts.inc(labels);
    }

    this.responseBodySize.observe(
      outcomeLabels,
      nonNegative(input.responseBodyBytes),
    );
    if (input.responseWriteDurationSeconds !== undefined) {
      this.responseWriteDuration.observe(
        outcomeLabels,
        nonNegative(input.responseWriteDurationSeconds),
      );
    }
    if (input.postHandlerDurationSeconds !== undefined) {
      this.responsePostHandlerDuration.observe(
        outcomeLabels,
        nonNegative(input.postHandlerDurationSeconds),
      );
    }
    this.inFlightRequests.dec();
  }

  recordJoinBypass(): void {
    this.audienceJoinBypasses.inc();
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}

export function normalizeRoute(route: string | undefined): string {
  if (!route || !route.startsWith("/")) return "unmatched";
  return route.replace(/\/+/, "/").replace(/\/$/, "") || "/";
}

function normalizeMethod(method: string): string {
  const normalized = method.trim().toUpperCase();
  return /^[A-Z]{3,10}$/.test(normalized) ? normalized : "OTHER";
}

function statusClass(statusCode: number): string {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return "other";
  }
  return `${Math.floor(statusCode / 100)}xx`;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
