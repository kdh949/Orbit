import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { ApiMetricsMiddleware } from "./api-metrics.middleware";
import { ApiMetricsService } from "./api-metrics.service";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableFinished = false;

  write(_chunk: unknown): boolean {
    this.headersSent = true;
    return true;
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) this.write(chunk);
    return this;
  }
}

function request(method = "GET"): Request & { route?: { path?: string } } {
  return {
    baseUrl: "",
    method,
    path: "/api/v1/projects/project_private_123/deck",
    route: { path: "/api/v1/projects/:projectId/deck" },
  } as Request & { route?: { path?: string } };
}

function response(): FakeResponse & Response {
  return new FakeResponse() as FakeResponse & Response;
}

function finish(target: FakeResponse): void {
  target.writableFinished = true;
  target.emit("finish");
  target.emit("close");
}

describe("ApiMetricsMiddleware", () => {
  it("records multi-chunk body bytes and completion phases once", async () => {
    const metrics = new ApiMetricsService();
    const middleware = new ApiMetricsMiddleware(metrics);
    const req = request();
    const res = response();
    const next = vi.fn();

    middleware.use(req, res, next as NextFunction);
    metrics.markHttpHandlerCompleted(res);
    res.write("hello");
    res.end(Buffer.from(" world"));
    finish(res);

    const output = await metrics.metrics();

    expect(next).toHaveBeenCalledOnce();
    expect(output).toContain(
      'orbit_api_http_response_body_size_bytes_sum{method="GET",route="/api/v1/projects/:projectId/deck",status_class="2xx",outcome="completed"} 11',
    );
    expect(output).toContain(
      'orbit_api_http_response_write_duration_seconds_count{method="GET",route="/api/v1/projects/:projectId/deck",status_class="2xx",outcome="completed"} 1',
    );
    expect(output).toContain(
      'orbit_api_http_response_post_handler_duration_seconds_count{method="GET",route="/api/v1/projects/:projectId/deck",status_class="2xx",outcome="completed"} 1',
    );
    expect(output).toContain("orbit_api_http_in_flight_requests 0");
    expect(output).not.toContain("project_private_123");
    expect(output).not.toContain("orbit_api_http_response_aborts_total{");
  });

  it("records a zero response body for HEAD even when end receives a chunk", async () => {
    const metrics = new ApiMetricsService();
    const middleware = new ApiMetricsMiddleware(metrics);
    const req = request("HEAD");
    const res = response();

    middleware.use(req, res, vi.fn());
    res.end("not transmitted");
    finish(res);

    expect(await metrics.metrics()).toContain(
      'orbit_api_http_response_body_size_bytes_sum{method="HEAD",route="/api/v1/projects/:projectId/deck",status_class="2xx",outcome="completed"} 0',
    );
  });

  it("records an early close as an aborted response without completing the request", async () => {
    const metrics = new ApiMetricsService();
    const middleware = new ApiMetricsMiddleware(metrics);
    const req = request();
    const res = response();

    middleware.use(req, res, vi.fn());
    res.write("part");
    res.emit("close");
    res.emit("finish");

    const output = await metrics.metrics();

    expect(output).toContain(
      'orbit_api_http_response_aborts_total{method="GET",route="/api/v1/projects/:projectId/deck",status_class="2xx"} 1',
    );
    expect(output).toContain('outcome="aborted"');
    expect(output).not.toContain("orbit_api_http_requests_total{");
    expect(output).toContain("orbit_api_http_in_flight_requests 0");
  });

  it("does not invent post-handler timing when the handler marker is absent", async () => {
    const metrics = new ApiMetricsService();
    const middleware = new ApiMetricsMiddleware(metrics);
    const req = request();
    const res = response();

    middleware.use(req, res, vi.fn());
    res.end();
    finish(res);

    expect(await metrics.metrics()).not.toContain(
      "orbit_api_http_response_post_handler_duration_seconds_count{",
    );
  });

  it("uses an unmatched route label instead of a raw request path", async () => {
    const metrics = new ApiMetricsService();
    const middleware = new ApiMetricsMiddleware(metrics);
    const req = request();
    const res = response();
    req.route = undefined;

    middleware.use(req, res, vi.fn());
    res.end();
    finish(res);

    const output = await metrics.metrics();

    expect(output).toContain('route="unmatched"');
    expect(output).not.toContain("project_private_123");
  });
});
