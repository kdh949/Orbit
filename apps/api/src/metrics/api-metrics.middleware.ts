import { Injectable, type NestMiddleware } from "@nestjs/common";
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
    response.once("finish", () => {
      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      const controllerPath = request.route?.path;
      const route = controllerPath
        ? `${request.baseUrl || ""}${controllerPath}`
        : undefined;
      this.metrics.recordHttpRequest({
        method: request.method,
        route: route ?? "unmatched",
        statusCode: response.statusCode,
        durationSeconds,
      });
    });
    next();
  }
}
