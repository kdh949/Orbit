import { describe, expect, it } from "vitest";

import { ApiMetricsService } from "../metrics/api-metrics.service";
import { ActivityRealtimeMetricsService } from "./activity-realtime-metrics.service";

describe("ActivityRealtimeMetricsService", () => {
  it("exports bounded event, payload, recipient, and logical byte metrics", async () => {
    const apiMetrics = new ApiMetricsService();
    const metrics = new ActivityRealtimeMetricsService(apiMetrics);

    metrics.recordEmit({
      event: "activity-results-updated",
      roomRole: "audience",
      payloadBytes: 128,
      recipientCount: 50,
    });

    const output = await apiMetrics.metrics();
    const labels = 'event="activity-results-updated",room_role="audience"';

    expect(output).toContain(`orbit_api_realtime_emits_total{${labels}} 1`);
    expect(output).toContain(
      `orbit_api_realtime_payload_size_bytes_sum{${labels}} 128`,
    );
    expect(output).toContain(
      `orbit_api_realtime_recipients_per_emit_sum{${labels}} 50`,
    );
    expect(output).toContain(
      `orbit_api_realtime_deliveries_total{${labels}} 50`,
    );
    expect(output).toContain(
      `orbit_api_realtime_logical_payload_bytes_total{${labels}} 6400`,
    );
    expect(output).not.toContain("session_1");
  });
});
