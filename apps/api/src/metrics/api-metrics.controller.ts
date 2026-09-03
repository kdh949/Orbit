import { Registry } from "@prometheus-io/client";
import { Controller, Get, Header } from "@nestjs/common";

import { ApiMetricsService } from "./api-metrics.service";

@Controller("internal")
export class ApiMetricsController {
  constructor(private readonly metrics: ApiMetricsService) {}

  @Get("metrics")
  @Header("Cache-Control", "no-store")
  @Header("Content-Type", Registry.OPENMETRICS_CONTENT_TYPE)
  getMetrics(): Promise<string> {
    return this.metrics.metrics();
  }
}
