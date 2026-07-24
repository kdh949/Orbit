import { loadOrbitConfig } from "@orbit/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { resolveAllowedWebOrigins } from "./common/web-origin";
import { configureHttpTrustProxy } from "./common/http-trust-proxy";
import { DatabaseReadinessService } from "./database/database-readiness.service";
import { writeBootstrapError } from "./logging";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";

async function bootstrap() {
  const config = loadOrbitConfig(process.env, { service: "api" });
  const allowedWebOrigins = resolveAllowedWebOrigins(config.WEB_ORIGIN);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false
  });
  const logger = app.get(Logger);
  const databaseReadiness = app.get(DatabaseReadinessService);
  app.useLogger(logger);
  configureHttpTrustProxy(app, config.API_TRUST_PROXY_HOPS);

  app.useBodyParser("json", { limit: config.API_JSON_BODY_LIMIT_BYTES });
  app.useBodyParser("urlencoded", {
    extended: true,
    limit: config.API_JSON_BODY_LIMIT_BYTES
  });
  app.use(helmet());
  app.use(cookieParser(config.COOKIE_SECRET));

  app.enableCors({
    credentials: true,
    origin: allowedWebOrigins
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("ORBIT API")
    .setDescription("ORBIT local-first platform API")
    .setVersion("0.1.0")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  await databaseReadiness.assertReady();
  const redisIoAdapter = new RedisIoAdapter({
    app,
    config,
    logger,
  });
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  app.enableShutdownHooks();
  await app.listen(config.API_PORT, "0.0.0.0");
  logger.log(
    {
      event: "api.ready",
      port: config.API_PORT,
      webOrigin: config.WEB_ORIGIN,
      allowedWebOrigins
    },
    "API ready."
  );
}

void bootstrap().catch((error: unknown) => {
  writeBootstrapError("api", error);
  process.exit(1);
});
