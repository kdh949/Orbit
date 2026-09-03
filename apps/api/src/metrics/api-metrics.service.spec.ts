import { Registry } from "@prometheus-io/client";
import { describe, expect, it } from "vitest";

import { ApiMetricsController } from "./api-metrics.controller";
import { ApiMetricsService } from "./api-metrics.service";

describe("ApiMetricsService", () => {
  it("renders the internal endpoint with bounded route labels", async () => {
    const metrics = new ApiMetricsService();
    const controller = new ApiMetricsController(metrics);

    metrics.recordHttpRequest({
      method: "get",
      route: "/api/v1/projects/:projectId/deck",
      statusCode: 200,
      durationSeconds: 0.125,
    });
    const output = await controller.getMetrics();

    expect(output).toContain("orbit_api_http_requests_total");
    expect(output).toContain('route="/api/v1/projects/:projectId/deck"');
    expect(output).toContain('status_class="2xx"');
    expect(output).not.toContain("project_private_123");
  });

  it("exports sampled request latency exemplars as OpenMetrics", async () => {
    const metrics = new ApiMetricsService();

    metrics.recordHttpRequest({
      method: "get",
      route: "/api/v1/projects/:projectId/deck",
      statusCode: 200,
      durationSeconds: 0.125,
      exemplarLabels: {
        traceID: "0123456789abcdef0123456789abcdef",
        spanID: "0123456789abcdef",
      },
    });
    const output = await metrics.metrics();

    expect(metrics.registry.contentType).toBe(
      Registry.OPENMETRICS_CONTENT_TYPE,
    );
    expect(output).toContain(
      '# {traceID="0123456789abcdef0123456789abcdef",spanID="0123456789abcdef"} 0.125',
    );
    expect(output.endsWith("# EOF\n")).toBe(true);
  });

  it("counts authorized audience join bypasses without identifier labels", async () => {
    const metrics = new ApiMetricsService();

    metrics.recordJoinBypass();
    const output = await metrics.metrics();

    expect(output).toContain("orbit_audience_join_rate_limit_bypass_total 1");
  });

  it("exports shared database query metrics without SQL labels", async () => {
    const metrics = new ApiMetricsService();
    const queryRunner = {};

    metrics.databaseQuerySubscriber.beforeQuery({
      query: "SELECT * FROM decks WHERE project_id = $1",
      queryRunner,
    });
    metrics.databaseQuerySubscriber.afterQuery({
      query: "SELECT * FROM decks WHERE project_id = $1",
      queryRunner,
      success: true,
      executionTime: 12,
    });

    const output = await metrics.metrics();

    expect(output).toContain("orbit_db_client_queries_total");
    expect(output).toContain('operation="select",outcome="success"');
    expect(output).not.toContain("project_id");
  });
});
