import "./telemetry";

import { loadOrbitConfig } from "@orbit/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import "reflect-metadata";
import { writeBootstrapError } from "./logging";
import { WorkerModule } from "./worker.module";

async function bootstrap() {
  loadOrbitConfig(process.env, { service: "worker" });
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
}

void bootstrap().catch((error: unknown) => {
  writeBootstrapError("worker", error);
  process.exit(1);
});
