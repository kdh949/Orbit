import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { SocketIoInstrumentation } from "@opentelemetry/instrumentation-socket.io";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export interface NodeTelemetryConfig {
  endpoint: string;
  environment: string;
  sampleRatio: number;
  serviceName: string;
  serviceVersion?: string;
}

export function resolveNodeTelemetryConfig(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeTelemetryConfig | null {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return null;

  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (!endpoint) return null;

  const parsedEndpoint = new URL(endpoint);
  if (!["http:", "https:"].includes(parsedEndpoint.protocol)) {
    throw new Error(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must use http or https",
    );
  }

  const sampleRatioValue = env.OTEL_TRACES_SAMPLER_ARG?.trim() || "1";
  const sampleRatio = Number(sampleRatioValue);
  if (!Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1) {
    throw new Error("OTEL_TRACES_SAMPLER_ARG must be between 0 and 1");
  }

  const serviceVersion = env.OTEL_SERVICE_VERSION?.trim();
  return {
    endpoint: parsedEndpoint.toString(),
    environment: env.APP_ENV?.trim() || "local",
    sampleRatio,
    serviceName,
    ...(serviceVersion ? { serviceVersion } : {}),
  };
}

export function startNodeTelemetry(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeSDK | null {
  const config = resolveNodeTelemetryConfig(serviceName, env);
  if (!config) return null;

  const attributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_NAMESPACE]: "orbit",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
  };
  if (config.serviceVersion) {
    attributes[ATTR_SERVICE_VERSION] = config.serviceVersion;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes(attributes),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.sampleRatio),
    }),
    traceExporter: new OTLPTraceExporter({ url: config.endpoint }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
      new SocketIoInstrumentation(),
      new UndiciInstrumentation(),
      new PinoInstrumentation({
        disableLogSending: true,
        logKeys: {
          traceId: "traceId",
          spanId: "spanId",
          traceFlags: "traceFlags",
        },
      }),
    ],
  });

  sdk.start();
  return sdk;
}
