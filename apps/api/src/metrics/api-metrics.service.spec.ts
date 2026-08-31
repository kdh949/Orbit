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

  it("counts authorized audience join bypasses without identifier labels", async () => {
    const metrics = new ApiMetricsService();

    metrics.recordJoinBypass();
    const output = await metrics.metrics();

    expect(output).toContain("orbit_audience_join_rate_limit_bypass_total 1");
  });
});
