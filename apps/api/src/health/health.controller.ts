import { demoIds } from "@orbit/shared";
import { Controller, Get } from "@nestjs/common";
import { DatabaseReadinessService } from "../database/database-readiness.service";

@Controller("health")
export class HealthController {
  constructor(private readonly databaseReadiness: DatabaseReadinessService) {}

  @Get()
  health() {
    return {
      status: "ok",
      app: "orbit-api",
      demo: demoIds
    };
  }

  @Get("readiness")
  async readiness() {
    await this.databaseReadiness.assertReady();
    return {
      status: "ready",
      dependencies: {
        postgres: "configured",
        redis: "configured",
        minio: "configured"
      }
    };
  }
}
