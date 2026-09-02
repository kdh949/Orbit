import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LoggerModule } from "nestjs-pino";
import { workerDatabaseOptions } from "./database";
import { createWorkerLoggerParams } from "./logging";
import { WorkerService } from "./worker.service";
import { WorkerMetricsService } from "./metrics/worker-metrics.service";
import { WorkerDatabaseMetricsLifecycle } from "./metrics/worker-database-metrics.lifecycle";

@Module({
  imports: [
    LoggerModule.forRoot(createWorkerLoggerParams()),
    TypeOrmModule.forRoot(workerDatabaseOptions()),
  ],
  providers: [
    WorkerMetricsService,
    WorkerDatabaseMetricsLifecycle,
    { provide: "WORKER_METRICS", useExisting: WorkerMetricsService },
    WorkerService,
  ],
})
export class WorkerModule {}
