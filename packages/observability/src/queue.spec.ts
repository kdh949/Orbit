import { context, propagation, trace, TraceFlags } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { afterEach, describe, expect, it } from "vitest";

import { bullMqTelemetry, isRedactedBullMqAttribute } from "./queue";

afterEach(() => {
  propagation.disable();
});

describe("bullMqTelemetry", () => {
  it.each([
    "bullmq.job.id",
    "bullmq.job.ids",
    "bullmq.job.key",
    "bullmq.job.result",
    "bullmq.job.failed.reason",
    "bullmq.worker.id",
  ])("redacts unbounded or sensitive attribute %s", (attribute) => {
    expect(isRedactedBullMqAttribute(attribute)).toBe(true);
  });

  it.each([
    "bullmq.queue.name",
    "bullmq.queue.operation",
    "bullmq.job.name",
    "bullmq.job.status",
  ])("keeps bounded attribute %s", (attribute) => {
    expect(isRedactedBullMqAttribute(attribute)).toBe(false);
  });

  it("round-trips W3C trace context through BullMQ metadata", () => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    const spanContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };
    const source = trace.setSpanContext(context.active(), spanContext);

    const metadata = bullMqTelemetry.contextManager.getMetadata(source);
    const restored = bullMqTelemetry.contextManager.fromMetadata(
      context.active(),
      metadata,
    );

    expect(metadata).toContain("traceparent");
    expect(trace.getSpanContext(restored)).toEqual({
      ...spanContext,
      isRemote: true,
    });
  });
});
