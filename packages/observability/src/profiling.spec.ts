import { describe, expect, it, vi } from "vitest";

import { resolveNodeProfilingConfig, startNodeProfiling } from "./profiling";

describe("resolveNodeProfilingConfig", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(resolveNodeProfilingConfig("orbit-api", {})).toBeNull();
  });

  it("uses bounded tags and a conservative sample interval", () => {
    expect(
      resolveNodeProfilingConfig("orbit-api", {
        APP_ENV: "staging",
        OTEL_SERVICE_VERSION: "test-sha",
        PYROSCOPE_ENABLED: "true",
        PYROSCOPE_SERVER_ADDRESS: "http://monitoring.internal:4040",
      }),
    ).toEqual({
      applicationName: "orbit-api",
      environment: "staging",
      sampleIntervalMicros: 20_000,
      serverAddress: "http://monitoring.internal:4040",
      serviceVersion: "test-sha",
    });
  });

  it.each([
    "http://monitoring.internal:4040",
    "http://monitoring.internal:4040/",
  ])("removes a trailing slash from server address %s", (serverAddress) => {
    expect(
      resolveNodeProfilingConfig("orbit-api", {
        PYROSCOPE_ENABLED: "true",
        PYROSCOPE_SERVER_ADDRESS: serverAddress,
      })?.serverAddress,
    ).toBe("http://monitoring.internal:4040");
  });

  it.each(["9999", "1000001", "20.5", "invalid"])(
    "rejects invalid sample interval %s",
    (sampleInterval) => {
      expect(() =>
        resolveNodeProfilingConfig("orbit-api", {
          PYROSCOPE_ENABLED: "true",
          PYROSCOPE_SERVER_ADDRESS: "http://monitoring.internal:4040",
          PYROSCOPE_CPU_SAMPLE_INTERVAL_MICROS: sampleInterval,
        }),
      ).toThrow(/PYROSCOPE_CPU_SAMPLE_INTERVAL_MICROS/);
    },
  );

  it("rejects credentials in the server address", () => {
    expect(() =>
      resolveNodeProfilingConfig("orbit-api", {
        PYROSCOPE_ENABLED: "true",
        PYROSCOPE_SERVER_ADDRESS:
          "http://profiling-user:profiling-password@monitoring.internal:4040",
      }),
    ).toThrow(/must not contain credentials/);
  });
});

describe("startNodeProfiling", () => {
  it("starts CPU profiling without starting heap profiling", async () => {
    const init = vi.fn();
    const startCpuProfiling = vi.fn();

    await expect(
      startNodeProfiling(
        "orbit-worker",
        {
          APP_ENV: "staging",
          PYROSCOPE_ENABLED: "true",
          PYROSCOPE_SERVER_ADDRESS: "http://monitoring.internal:4040",
        },
        async () => ({ init, startCpuProfiling }),
      ),
    ).resolves.toBe(true);

    expect(init).toHaveBeenCalledWith({
      appName: "orbit-worker",
      serverAddress: "http://monitoring.internal:4040",
      tags: { environment: "staging" },
      wall: {
        collectCpuTime: true,
        samplingIntervalMicros: 20_000,
      },
    });
    expect(startCpuProfiling).toHaveBeenCalledTimes(1);
  });
});
