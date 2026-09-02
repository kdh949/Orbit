import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { finalize } from "rxjs";

import { ApiMetricsService } from "./api-metrics.service";

@Injectable()
export class ApiMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: ApiMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const response = context.switchToHttp().getResponse<object>();
    return next
      .handle()
      .pipe(finalize(() => this.metrics.markHttpHandlerCompleted(response)));
  }
}
