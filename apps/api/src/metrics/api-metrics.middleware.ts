import { Injectable, type NestMiddleware } from "@nestjs/common";
import {
  captureActiveSpanAttributeWriter,
  captureActiveTraceExemplarLabels,
} from "@orbit/observability";
import type { NextFunction, Request, Response } from "express";

import { ApiMetricsService } from "./api-metrics.service";

type RoutedRequest = Request & {
  route?: { path?: string };
};

@Injectable()
export class ApiMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: ApiMetricsService) {}

  use(request: RoutedRequest, response: Response, next: NextFunction): void {
    if (request.path === "/internal/metrics") {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    const annotateSpan = captureActiveSpanAttributeWriter();
    const exemplarLabels = captureActiveTraceExemplarLabels();
    const originalWrite = response.write;
    const originalEnd = response.end;
    let bodyBytes = 0;
    let firstWriteAt: bigint | undefined;
    let finalized = false;
    let invokingEnd = false;

    const markFirstWrite = () => {
      firstWriteAt ??= process.hrtime.bigint();
    };
    const countChunk = (chunk: unknown, encoding: unknown) => {
      if (!responseCanHaveBody(request.method, response.statusCode)) return;
      bodyBytes += chunkByteLength(chunk, encoding);
    };

    response.write = ((...args: unknown[]) => {
      markFirstWrite();
      if (!invokingEnd) countChunk(args[0], args[1]);
      return Reflect.apply(originalWrite, response, args) as boolean;
    }) as Response["write"];
    response.end = ((...args: unknown[]) => {
      markFirstWrite();
      countChunk(args[0], args[1]);
      invokingEnd = true;
      try {
        return Reflect.apply(originalEnd, response, args) as Response;
      } finally {
        invokingEnd = false;
      }
    }) as Response["end"];

    this.metrics.markHttpRequestStarted();

    const finalizeResponse = (outcome: "completed" | "aborted") => {
      if (finalized) return;
      finalized = true;

      const finishedAt = process.hrtime.bigint();
      const durationSeconds = secondsBetween(startedAt, finishedAt);
      const controllerPath = request.route?.path;
      const route = controllerPath
        ? `${request.baseUrl || ""}${controllerPath}`
        : undefined;
      const handlerCompletedAt =
        this.metrics.takeHttpHandlerCompletedAt(response);
      const responseWriteDurationSeconds = firstWriteAt
        ? secondsBetween(firstWriteAt, finishedAt)
        : undefined;
      const postHandlerDurationSeconds = handlerCompletedAt
        ? secondsBetween(handlerCompletedAt, finishedAt)
        : undefined;
      const responseBodyBytes = responseCanHaveBody(
        request.method,
        response.statusCode,
      )
        ? bodyBytes
        : 0;

      this.metrics.recordHttpResponse({
        durationSeconds,
        exemplarLabels,
        headersSent: response.headersSent,
        method: request.method,
        outcome,
        postHandlerDurationSeconds,
        responseBodyBytes,
        responseWriteDurationSeconds,
        route: route ?? "unmatched",
        statusCode: response.statusCode,
      });

      const traceAttributes: Record<string, string | number | boolean> = {
        "http.response.body.size": responseBodyBytes,
        "orbit.http.response.outcome": outcome,
      };
      if (responseWriteDurationSeconds !== undefined) {
        traceAttributes["orbit.http.response.write.duration_ms"] =
          responseWriteDurationSeconds * 1_000;
      }
      if (postHandlerDurationSeconds !== undefined) {
        traceAttributes["orbit.http.response.post_handler.duration_ms"] =
          postHandlerDurationSeconds * 1_000;
      }
      annotateSpan?.(traceAttributes);
    };

    response.prependOnceListener("finish", () => finalizeResponse("completed"));
    response.prependOnceListener("close", () => {
      if (!response.writableFinished) finalizeResponse("aborted");
    });

    try {
      next();
    } catch (error) {
      finalizeResponse("aborted");
      throw error;
    }
  }
}

function secondsBetween(startedAt: bigint, finishedAt: bigint): number {
  return Number(finishedAt - startedAt) / 1_000_000_000;
}

function responseCanHaveBody(method: string, statusCode: number): boolean {
  if (method.trim().toUpperCase() === "HEAD") return false;
  return !(
    (statusCode >= 100 && statusCode < 200) ||
    statusCode === 204 ||
    statusCode === 304
  );
}

function chunkByteLength(chunk: unknown, encoding: unknown): number {
  if (typeof chunk === "string") {
    const bufferEncoding =
      typeof encoding === "string" && Buffer.isEncoding(encoding)
        ? encoding
        : "utf8";
    return Buffer.byteLength(chunk, bufferEncoding);
  }
  return chunk instanceof Uint8Array ? chunk.byteLength : 0;
}
