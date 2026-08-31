import {
  Global,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";

import { AUDIENCE_RATE_LIMIT_METRICS } from "../presentation-sessions/audience-rate-limit.service";
import { ApiMetricsController } from "./api-metrics.controller";
import { ApiMetricsMiddleware } from "./api-metrics.middleware";
import { ApiMetricsService } from "./api-metrics.service";

@Global()
@Module({
  controllers: [ApiMetricsController],
  providers: [
    ApiMetricsService,
    ApiMetricsMiddleware,
    {
      provide: AUDIENCE_RATE_LIMIT_METRICS,
      useExisting: ApiMetricsService,
    },
  ],
  exports: [ApiMetricsService, AUDIENCE_RATE_LIMIT_METRICS],
})
export class ApiMetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ApiMetricsMiddleware)
      .forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
