import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LoggerModule } from "nestjs-pino";
import { workerDatabaseOptions } from "./database";
import { createWorkerLoggerParams } from "./logging";
import { WorkerService } from "./worker.service";
import { WorkerMetricsService } from "./metrics/worker-metrics.service";

@Module({
  imports: [
    LoggerModule.forRoot(createWorkerLoggerParams()),
    TypeOrmModule.forRoot(workerDatabaseOptions()),
  ],
  providers: [
    WorkerMetricsService,
    { provide: "WORKER_METRICS", useExisting: WorkerMetricsService },
    WorkerService,
  ],
})
export class WorkerModule {}
