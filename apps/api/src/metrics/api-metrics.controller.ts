import { Controller, Get, Header } from "@nestjs/common";

import { ApiMetricsService } from "./api-metrics.service";

@Controller("internal")
export class ApiMetricsController {
  constructor(private readonly metrics: ApiMetricsService) {}

  @Get("metrics")
  @Header("Cache-Control", "no-store")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  getMetrics(): Promise<string> {
    return this.metrics.metrics();
  }
}
