import { Module } from "@nestjs/common";
import { DatabaseReadinessService } from "../database/database-readiness.service";
import { HealthController } from "./health.controller";

@Module({
  controllers: [HealthController],
  providers: [DatabaseReadinessService],
  exports: [DatabaseReadinessService]
})
export class HealthModule {}
