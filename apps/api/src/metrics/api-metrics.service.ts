import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "@prometheus-io/client";
import { Injectable } from "@nestjs/common";

const httpDurationBuckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

@Injectable()
export class ApiMetricsService {
  readonly registry = new Registry();
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
  private readonly audienceJoinBypasses = new Counter({
    name: "orbit_audience_join_rate_limit_bypass_total",
    help: "Authorized passcode audience join rate-limit bypasses.",
    registers: [this.registry],
  });

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
