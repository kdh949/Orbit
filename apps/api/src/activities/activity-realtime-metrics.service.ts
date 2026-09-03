import { Counter, Histogram } from "@prometheus-io/client";
import { Injectable } from "@nestjs/common";

import { ApiMetricsService } from "../metrics/api-metrics.service";

const payloadSizeBuckets = [
  64, 128, 256, 512, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576,
];
const recipientBuckets = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000];

export type ActivityRealtimeEventName =
  | "active-activity-changed"
  | "activity-state-changed"
  | "activity-results-updated";

export type ActivityRealtimeRoomRole = "presenter" | "audience";
type ActivityRealtimeMetricLabel = "event" | "room_role";

@Injectable()
export class ActivityRealtimeMetricsService {
  private readonly emits: Counter<ActivityRealtimeMetricLabel>;
  private readonly payloadSize: Histogram<ActivityRealtimeMetricLabel>;
  private readonly recipientsPerEmit: Histogram<ActivityRealtimeMetricLabel>;
  private readonly deliveries: Counter<ActivityRealtimeMetricLabel>;
  private readonly logicalPayloadBytes: Counter<ActivityRealtimeMetricLabel>;

  constructor(apiMetrics: ApiMetricsService) {
    const metricOptions = {
      labelNames: ["event", "room_role"] as const,
      registers: [apiMetrics.registry],
    };
    this.emits = new Counter({
      name: "orbit_api_realtime_emits_total",
      help: "Activity realtime events handed to the Socket.IO adapter.",
      ...metricOptions,
    });
    this.payloadSize = new Histogram({
      name: "orbit_api_realtime_payload_size_bytes",
      help: "Serialized activity realtime payload size before Socket.IO framing.",
      buckets: payloadSizeBuckets,
      ...metricOptions,
    });
    this.recipientsPerEmit = new Histogram({
      name: "orbit_api_realtime_recipients_per_emit",
      help: "Local Socket.IO room recipients observed for an activity realtime emit.",
      buckets: recipientBuckets,
      ...metricOptions,
    });
    this.deliveries = new Counter({
      name: "orbit_api_realtime_deliveries_total",
      help: "Logical local recipient deliveries for activity realtime events.",
      ...metricOptions,
    });
    this.logicalPayloadBytes = new Counter({
      name: "orbit_api_realtime_logical_payload_bytes_total",
      help: "Serialized activity realtime payload bytes multiplied by local recipients.",
      ...metricOptions,
    });
  }

  recordEmit(input: {
    event: ActivityRealtimeEventName;
    roomRole: ActivityRealtimeRoomRole;
    payloadBytes: number;
    recipientCount: number;
  }): void {
    const labels = {
      event: input.event,
      room_role: input.roomRole,
    };
    const payloadBytes = nonNegativeInteger(input.payloadBytes);
    const recipientCount = nonNegativeInteger(input.recipientCount);

    this.emits.inc(labels);
    this.payloadSize.observe(labels, payloadBytes);
    this.recipientsPerEmit.observe(labels, recipientCount);
    this.deliveries.inc(labels, recipientCount);
    this.logicalPayloadBytes.inc(labels, payloadBytes * recipientCount);
  }
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
