import { describe, expect, it } from "vitest";

import { resolveNodeTelemetryConfig } from "./node";

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
