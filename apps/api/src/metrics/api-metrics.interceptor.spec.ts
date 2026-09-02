import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { describe, expect, it } from "vitest";

import { ApiMetricsInterceptor } from "./api-metrics.interceptor";
import { ApiMetricsService } from "./api-metrics.service";

function contextWithResponse(response: object): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getResponse: () => response }),
  } as ExecutionContext;
}

describe("ApiMetricsInterceptor", () => {
  it("marks the handler completion after a successful controller result", async () => {
    const metrics = new ApiMetricsService();
    const interceptor = new ApiMetricsInterceptor(metrics);
    const response = {};
    const next = { handle: () => of({ ok: true }) } as CallHandler;

    await lastValueFrom(
      interceptor.intercept(contextWithResponse(response), next),
    );

    expect(typeof metrics.takeHttpHandlerCompletedAt(response)).toBe("bigint");
  });

  it("marks the handler completion when the controller stream fails", async () => {
    const metrics = new ApiMetricsService();
    const interceptor = new ApiMetricsInterceptor(metrics);
    const response = {};
    const next = {
      handle: () => throwError(() => new Error("controller failed")),
    } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(contextWithResponse(response), next)),
    ).rejects.toThrow("controller failed");
    expect(typeof metrics.takeHttpHandlerCompletedAt(response)).toBe("bigint");
  });

  it("leaves non-HTTP handler streams unchanged", async () => {
    const metrics = new ApiMetricsService();
    const interceptor = new ApiMetricsInterceptor(metrics);
    const response = {};
    const context = {
      getType: () => "ws",
      switchToHttp: () => {
        throw new Error("HTTP context must not be accessed");
      },
    } as unknown as ExecutionContext;
    const next = { handle: () => of("socket result") } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toBe("socket result");
    expect(metrics.takeHttpHandlerCompletedAt(response)).toBeUndefined();
  });
});
