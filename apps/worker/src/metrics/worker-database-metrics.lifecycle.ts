import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { attachTypeOrmQuerySubscriber } from "@orbit/observability";
import type { DataSource } from "typeorm";

import { WorkerMetricsService } from "./worker-metrics.service";

@Injectable()
export class WorkerDatabaseMetricsLifecycle
  implements OnModuleInit, OnModuleDestroy
{
  private detach: (() => void) | undefined;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly metrics: WorkerMetricsService,
  ) {}

  onModuleInit(): void {
    this.detach = attachTypeOrmQuerySubscriber(
      this.dataSource,
      this.metrics.databaseQuerySubscriber,
    );
  }

  onModuleDestroy(): void {
    this.detach?.();
    this.detach = undefined;
  }
}
