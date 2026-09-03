import { trace, TraceFlags, type Span } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureActiveTraceExemplarLabels,
  createNodeTelemetryResourceAttributes,
  resolveNodeTelemetryConfig,
} from "./node";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureActiveTraceExemplarLabels", () => {
  it("returns trace and span IDs only for an active sampled span", () => {
    vi.spyOn(trace, "getSpan").mockReturnValue({
      isRecording: () => true,
      spanContext: () => ({
        isRemote: false,
        spanId: "0123456789abcdef",
        traceFlags: TraceFlags.SAMPLED,
        traceId: "0123456789abcdef0123456789abcdef",
      }),
    } as Span);

    expect(captureActiveTraceExemplarLabels()).toEqual({
      spanID: "0123456789abcdef",
      traceID: "0123456789abcdef0123456789abcdef",
    });
  });

  it.each([
    { isRecording: false, traceFlags: TraceFlags.SAMPLED },
    { isRecording: true, traceFlags: TraceFlags.NONE },
  ])(
    "returns no exemplar for a non-recording or unsampled span",
    ({ isRecording, traceFlags }) => {
      vi.spyOn(trace, "getSpan").mockReturnValue({
        isRecording: () => isRecording,
        spanContext: () => ({
          isRemote: false,
          spanId: "0123456789abcdef",
          traceFlags,
          traceId: "0123456789abcdef0123456789abcdef",
        }),
      } as Span);

      expect(captureActiveTraceExemplarLabels()).toBeUndefined();
    },
  );

  it("returns no exemplar without an active span", () => {
    vi.spyOn(trace, "getSpan").mockReturnValue(undefined);

    expect(captureActiveTraceExemplarLabels()).toBeUndefined();
  });

  it("returns no exemplar for an invalid span context", () => {
    vi.spyOn(trace, "getSpan").mockReturnValue({
      isRecording: () => true,
      spanContext: () => ({
        isRemote: false,
        spanId: "0000000000000000",
        traceFlags: TraceFlags.SAMPLED,
        traceId: "00000000000000000000000000000000",
      }),
    } as Span);

    expect(captureActiveTraceExemplarLabels()).toBeUndefined();
  });
});

describe("resolveNodeTelemetryConfig", () => {
  it("keeps telemetry disabled when no OTLP endpoint is configured", () => {
    expect(resolveNodeTelemetryConfig("orbit-api", {})).toBeNull();
  });

  it("resolves a bounded sampling configuration", () => {
    expect(
      resolveNodeTelemetryConfig("orbit-worker", {
        APP_ENV: "staging",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://alloy:4318/v1/traces",
        OTEL_SERVICE_VERSION: "test-sha",
        OTEL_TRACES_SAMPLER_ARG: "0.05",
      }),
    ).toEqual({
      endpoint: "http://alloy:4318/v1/traces",
      environment: "staging",
      sampleRatio: 0.05,
      serviceName: "orbit-worker",
      serviceVersion: "test-sha",
    });
  });

  it.each(["-0.1", "1.1", "not-a-number"])(
    "rejects an invalid sampling ratio: %s",
    (sampleRatio) => {
      expect(() =>
        resolveNodeTelemetryConfig("orbit-api", {
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://alloy:4318/v1/traces",
          OTEL_TRACES_SAMPLER_ARG: sampleRatio,
        }),
      ).toThrow(/OTEL_TRACES_SAMPLER_ARG/);
    },
  );

  it("rejects non-HTTP exporters", () => {
    expect(() =>
      resolveNodeTelemetryConfig("orbit-api", {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "file:///tmp/traces",
      }),
    ).toThrow(/must use http or https/);
  });
});

describe("createNodeTelemetryResourceAttributes", () => {
  it.each([0, 0.05, 1])(
    "records sampling ratio %s as a numeric resource attribute",
    (sampleRatio) => {
      const attributes = createNodeTelemetryResourceAttributes({
        endpoint: "http://alloy:4318/v1/traces",
        environment: "staging",
        sampleRatio,
        serviceName: "orbit-api",
      });

      expect(attributes["orbit.trace.sample_ratio"]).toBe(sampleRatio);
      expect(typeof attributes["orbit.trace.sample_ratio"]).toBe("number");
      expect(Object.keys(attributes)).not.toContain("user.id");
      expect(Object.keys(attributes)).not.toContain("session.id");
      expect(Object.keys(attributes)).not.toContain("job.id");
    },
  );
});
