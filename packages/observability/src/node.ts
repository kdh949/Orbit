import {
  context,
  isSpanContextValid,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
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

export const TRACE_SAMPLE_RATIO_ATTRIBUTE = "orbit.trace.sample_ratio";

export type ActiveSpanAttributeWriter = (
  attributes: Record<string, string | number | boolean>,
) => void;

export type TraceExemplarLabels = Record<"spanID" | "traceID", string>;

export function captureActiveTraceExemplarLabels():
  | TraceExemplarLabels
  | undefined {
  const span = trace.getSpan(context.active());
  if (!span?.isRecording()) return undefined;

  const spanContext = span.spanContext();
  if (
    !isSpanContextValid(spanContext) ||
    (spanContext.traceFlags & TraceFlags.SAMPLED) === 0
  ) {
    return undefined;
  }

  return {
    spanID: spanContext.spanId,
    traceID: spanContext.traceId,
  };
}

export function captureActiveSpanAttributeWriter():
  | ActiveSpanAttributeWriter
  | undefined {
  const span = trace.getSpan(context.active());
  if (!span?.isRecording()) return undefined;

  return (attributes) => {
    if (span.isRecording()) span.setAttributes(attributes);
  };
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

export function createNodeTelemetryResourceAttributes(
  config: NodeTelemetryConfig,
): Record<string, string | number> {
  return {
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_NAMESPACE]: "orbit",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    [TRACE_SAMPLE_RATIO_ATTRIBUTE]: config.sampleRatio,
    ...(config.serviceVersion
      ? { [ATTR_SERVICE_VERSION]: config.serviceVersion }
      : {}),
  };
}

export function startNodeTelemetry(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeSDK | null {
  const config = resolveNodeTelemetryConfig(serviceName, env);
  if (!config) return null;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes(
      createNodeTelemetryResourceAttributes(config),
    ),
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
